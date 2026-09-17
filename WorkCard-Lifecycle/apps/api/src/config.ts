import { isIP } from 'node:net';

import { Client } from 'pg';

import { defaultDemoCapacity } from './demo-maintenance.js';

const appEnvironments = ['development', 'test', 'staging', 'production'] as const;
const logLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
const proxyTrustModes = ['none', 'render', 'observe'] as const;
const directNeonHost = /^ep-[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech$/;
const localHosts = new Set(['localhost', '127.0.0.1', '[::1]', 'database', 'postgres']);

type AppEnvironment = (typeof appEnvironments)[number];
type LogLevel = (typeof logLevels)[number];
export type ProxyTrustMode = (typeof proxyTrustModes)[number];

export type DatabaseTarget = { host: string; database: string; transport: 'tcp' };
export type AppConfig = {
  allowedOrigin: string;
  appEnvironment: AppEnvironment;
  appVersion: string;
  cookieSecure: boolean;
  databaseUrl: string;
  maximumDemoBatches: number;
  maximumDemoSessions: number;
  host: string;
  logLevel: LogLevel;
  port: number;
  proxyTrustMode: ProxyTrustMode;
  proxyTrustedCidrs: string[];
  revision: string;
  serviceName: string;
  sessionSigningSecret: string;
  webDistPath?: string;
};
export type MigrationConfig = {
  appDatabasePassword: string;
  appDatabaseUser: string;
  migrationDatabaseUrl: string;
};
export type MaintenanceConfig = { migrationDatabaseUrl: string };
export type VerificationConfig = MaintenanceConfig & { appDatabaseUser: string };

function requireValue(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`Обязательная переменная окружения ${name} не задана.`);
  return value;
}

function parsePositiveInteger(raw: string, name: string, maximum: number): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} должен быть целым числом от 1 до ${maximum}.`);
  }
  return value;
}

function parseEnum<const T extends readonly string[]>(
  raw: string,
  values: T,
  name: string,
): T[number] {
  if (!values.includes(raw)) throw new Error(`${name} содержит неподдерживаемое значение.`);
  return raw as T[number];
}

function safeMetadata(environment: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const value = environment[name]?.trim() || fallback;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
    throw new Error(`${name} должен быть безопасной короткой меткой.`);
  }
  return value;
}

// pg query parameters override authority, TLS and startup options. Validate
// before the driver parses the URL; accept exactly one supported TLS parameter.
export function inspectDatabaseUrlForPg(
  databaseUrl: string,
  name = 'DATABASE_URL',
): DatabaseTarget {
  let url: URL;
  let database: string;
  let client: Client;
  try {
    url = new URL(databaseUrl);
    database = decodeURIComponent(url.pathname.slice(1));
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      url.hash ||
      /[\s\\]/.test(databaseUrl) ||
      !url.hostname ||
      !url.username ||
      !url.password ||
      !database ||
      database.includes('/') ||
      !/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,62}$/.test(database) ||
      (url.port && (!/^\d+$/.test(url.port) || Number(url.port) < 1 || Number(url.port) > 65535))
    ) {
      throw new Error('Invalid URL');
    }
    decodeURIComponent(url.username);
    decodeURIComponent(url.password);
    const keys = [...url.searchParams.keys()];
    if (
      keys.some((key) => key !== 'sslmode') ||
      keys.length > 1 ||
      (keys.length === 1 && !['disable', 'verify-full'].includes(url.searchParams.get('sslmode')!))
    ) {
      throw new Error('Ambiguous TLS or connection override');
    }
    client = new Client({ connectionString: databaseUrl });
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (
      client.host !== host ||
      client.database !== database ||
      client.user !== decodeURIComponent(url.username) ||
      client.password !== decodeURIComponent(url.password) ||
      client.port !== Number(url.port || 5432)
    ) {
      throw new Error('Driver URL mismatch');
    }
    const ssl: unknown = client.ssl;
    if (
      url.searchParams.get('sslmode') === 'verify-full' &&
      (!ssl ||
        (typeof ssl === 'object' &&
          (('rejectUnauthorized' in ssl && ssl.rejectUnauthorized === false) ||
            'checkServerIdentity' in ssl)))
    ) {
      throw new Error('Driver TLS downgrade');
    }
  } catch {
    // Do not expose URLs, credentials, query values or parser errors.
    throw new Error(
      `${name} должен задавать однозначный PostgreSQL TCP URL; разрешён только sslmode=verify-full (или disable локально).`,
    );
  }
  return { host: url.hostname, database, transport: 'tcp' };
}

function rejectConnectionOverrides(environment: NodeJS.ProcessEnv) {
  const overrides = Object.keys(environment).filter(
    (key) =>
      /^PG(?:HOST|HOSTADDR|PORT|DATABASE|USER|PASSWORD|PASSFILE|SERVICE|SERVICEFILE|SSLMODE|SSLROOTCERT|SSLCERT|SSLKEY|OPTIONS|APPNAME|CONNECT_TIMEOUT|CHANNELBINDING|REQUIRESSL|TARGETSESSIONATTRS)$/i.test(
        key,
      ) && environment[key] !== undefined,
  );
  if (overrides.length > 0)
    throw new Error('PG* connection overrides запрещены: используйте единственный явный URL.');
  if (
    environment['NODE_TLS_REJECT_UNAUTHORIZED'] !== undefined &&
    environment['NODE_TLS_REJECT_UNAUTHORIZED'] !== '1'
  ) {
    throw new Error('NODE_TLS_REJECT_UNAUTHORIZED не должен отключать проверку TLS.');
  }
}

function requireDatabaseUrl(
  environment: NodeJS.ProcessEnv,
  name: 'DATABASE_URL' | 'MIGRATION_DATABASE_URL',
): string {
  rejectConnectionOverrides(environment);
  const databaseUrl = requireValue(environment, name);
  const target = inspectDatabaseUrlForPg(databaseUrl, name);
  const url = new URL(databaseUrl);
  const appEnvironment = loadAppEnvironment(environment);
  const hosted =
    ['staging', 'production'].includes(appEnvironment) || environment['RENDER'] === 'true';
  if (hosted) {
    const expectedHost = requireValue(environment, 'NEON_DATABASE_HOST');
    const expectedDatabase = requireValue(environment, 'NEON_DATABASE_NAME');
    if (
      !directNeonHost.test(target.host) ||
      target.host.split('.')[0]!.includes('-pooler') ||
      target.host !== expectedHost ||
      target.database !== expectedDatabase ||
      url.search !== '?sslmode=verify-full' ||
      (url.port && url.port !== '5432')
    ) {
      throw new Error(
        `${name} должен указывать ожидаемые direct Neon host/database, порт 5432 и sslmode=verify-full.`,
      );
    }
  } else if (!localHosts.has(target.host)) {
    throw new Error(
      `${name} для development/test разрешён только с локальным disposable PostgreSQL.`,
    );
  }
  return databaseUrl;
}

function loadAppEnvironment(environment: NodeJS.ProcessEnv): AppEnvironment {
  return parseEnum(environment['APP_ENV']?.trim() || 'development', appEnvironments, 'APP_ENV');
}

function trustedCidrs(environment: NodeJS.ProcessEnv, mode: ProxyTrustMode): string[] {
  const raw = environment['PROXY_TRUSTED_CIDRS']?.trim();
  if (mode !== 'render') {
    if (raw) throw new Error('PROXY_TRUSTED_CIDRS требует PROXY_TRUST_MODE=render.');
    return [];
  }
  const values = requireValue(environment, 'PROXY_TRUSTED_CIDRS')
    .split(',')
    .map((value) => value.trim());
  if (
    values.length > 16 ||
    new Set(values).size !== values.length ||
    values.some((value) => {
      const [address, prefix, extra] = value.split('/');
      const family = isIP(address ?? '');
      return (
        !family ||
        extra !== undefined ||
        address === '0.0.0.0' ||
        address === '::' ||
        (prefix !== undefined &&
          (!/^\d+$/.test(prefix) ||
            Number(prefix) < (family === 4 ? 8 : 32) ||
            Number(prefix) > (family === 4 ? 32 : 128)))
      );
    })
  )
    throw new Error(
      'PROXY_TRUSTED_CIDRS должен содержать проверенный ограниченный список IP/CIDR proxy.',
    );
  return values;
}

export function loadAppConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const webDistPath = environment['WEB_DIST_PATH']?.trim();
  const appEnvironment = loadAppEnvironment(environment);
  const port = parsePositiveInteger(environment['PORT']?.trim() || '3000', 'PORT', 65_535);
  const sessionSigningSecret =
    environment['SESSION_SIGNING_SECRET']?.trim() ||
    (appEnvironment === 'development' || appEnvironment === 'test'
      ? 'local-development-session-secret-change-me'
      : '');
  if (sessionSigningSecret.length < 32)
    throw new Error('SESSION_SIGNING_SECRET должен содержать не менее 32 символов.');
  const allowedOrigin =
    environment['APP_ORIGIN']?.trim() ||
    (appEnvironment === 'development' ? 'http://localhost:5173' : `http://localhost:${port}`);
  const parsedOrigin = new URL(allowedOrigin);
  if (
    parsedOrigin.origin !== allowedOrigin ||
    parsedOrigin.pathname !== '/' ||
    !['http:', 'https:'].includes(parsedOrigin.protocol)
  ) {
    throw new Error('APP_ORIGIN должен содержать только точный HTTP(S) origin без path.');
  }
  if (appEnvironment === 'production' && parsedOrigin.protocol !== 'https:') {
    throw new Error('Production APP_ORIGIN должен использовать HTTPS.');
  }
  if (
    appEnvironment === 'staging' &&
    parsedOrigin.protocol !== 'https:' &&
    !['localhost', '127.0.0.1', '[::1]'].includes(parsedOrigin.hostname)
  ) {
    throw new Error('HTTP staging APP_ORIGIN разрешён только для локального Docker runner.');
  }
  const render = environment['RENDER'] === 'true';
  const proxyTrustMode = parseEnum(
    environment['PROXY_TRUST_MODE']?.trim() || 'none',
    proxyTrustModes,
    'PROXY_TRUST_MODE',
  );
  if (
    render &&
    (!['staging', 'production'].includes(appEnvironment) ||
      !['render', 'observe'].includes(proxyTrustMode) ||
      parsedOrigin.protocol !== 'https:' ||
      !environment['RENDER_SERVICE_ID'])
  ) {
    throw new Error(
      'Render требует hosted APP_ENV, HTTPS APP_ORIGIN, RENDER_SERVICE_ID и PROXY_TRUST_MODE=render|observe.',
    );
  }
  if (proxyTrustMode !== 'none' && !render) {
    throw new Error('PROXY_TRUST_MODE=render|observe разрешён только внутри Render.');
  }
  if (environment['MIGRATION_DATABASE_URL'] || environment['APP_DATABASE_PASSWORD']) {
    throw new Error('Owner credentials запрещены в runtime environment.');
  }
  return {
    allowedOrigin,
    appEnvironment,
    appVersion: safeMetadata(environment, 'APP_VERSION', '0.1.0-dev'),
    cookieSecure: parsedOrigin.protocol === 'https:',
    databaseUrl: requireDatabaseUrl(environment, 'DATABASE_URL'),
    maximumDemoBatches: parsePositiveInteger(
      environment['DEMO_MAX_BATCHES']?.trim() || String(defaultDemoCapacity.maximumBatches),
      'DEMO_MAX_BATCHES',
      100,
    ),
    maximumDemoSessions: parsePositiveInteger(
      environment['DEMO_MAX_SESSIONS']?.trim() || String(defaultDemoCapacity.maximumSessions),
      'DEMO_MAX_SESSIONS',
      10_000,
    ),
    host: environment['HOST']?.trim() || '127.0.0.1',
    logLevel: parseEnum(environment['LOG_LEVEL']?.trim() || 'info', logLevels, 'LOG_LEVEL'),
    port,
    proxyTrustMode,
    proxyTrustedCidrs: trustedCidrs(environment, proxyTrustMode),
    revision: safeMetadata(environment, 'RENDER_INSTANCE_ID', 'local'),
    serviceName: safeMetadata(environment, 'RENDER_SERVICE_ID', 'work-card-api'),
    sessionSigningSecret,
    ...(webDistPath ? { webDistPath } : {}),
  };
}

function runtimeRole(environment: NodeJS.ProcessEnv): string {
  const user = requireValue(environment, 'APP_DATABASE_USER');
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(user))
    throw new Error('APP_DATABASE_USER должен быть безопасным PostgreSQL identifier.');
  return user;
}

export function loadMigrationConfig(environment: NodeJS.ProcessEnv = process.env): MigrationConfig {
  return {
    appDatabasePassword: requireValue(environment, 'APP_DATABASE_PASSWORD'),
    appDatabaseUser: runtimeRole(environment),
    migrationDatabaseUrl: requireDatabaseUrl(environment, 'MIGRATION_DATABASE_URL'),
  };
}
export function loadMaintenanceConfig(
  environment: NodeJS.ProcessEnv = process.env,
): MaintenanceConfig {
  return { migrationDatabaseUrl: requireDatabaseUrl(environment, 'MIGRATION_DATABASE_URL') };
}
export function loadVerificationConfig(
  environment: NodeJS.ProcessEnv = process.env,
): VerificationConfig {
  return { ...loadMaintenanceConfig(environment), appDatabaseUser: runtimeRole(environment) };
}
