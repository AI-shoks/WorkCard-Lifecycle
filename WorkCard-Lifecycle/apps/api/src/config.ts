import { Client } from 'pg';

import { defaultDemoCapacity } from './demo-maintenance.js';

const appEnvironments = ['development', 'test', 'staging', 'production'] as const;
const logLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
const proxyTrustModes = ['none', 'cloud-run'] as const;
const cloudSqlSocketPattern =
  /^\/cloudsql\/[a-z][a-z0-9-]{4,28}[a-z0-9]:[a-z]+(?:-[a-z0-9]+)+:[a-z](?:[a-z0-9-]{0,96}[a-z0-9])?$/;
const postgresSocketFile = '/.s.PGSQL.5432';

type AppEnvironment = (typeof appEnvironments)[number];
type LogLevel = (typeof logLevels)[number];
export type ProxyTrustMode = (typeof proxyTrustModes)[number];

export type DatabaseTarget = {
  host: string;
  transport: 'cloud-sql-unix' | 'tcp';
};

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

export type MaintenanceConfig = {
  migrationDatabaseUrl: string;
};

export type VerificationConfig = {
  appDatabaseUser: string;
  databaseUrl: string;
};

function requireValue(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();

  if (!value) {
    throw new Error(`Обязательная переменная окружения ${name} не задана.`);
  }

  return value;
}

function parsePort(raw: string): number {
  const port = Number(raw);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT должен быть целым числом от 1 до 65535.');
  }

  return port;
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
  if (!values.includes(raw)) {
    throw new Error(`${name} содержит неподдерживаемое значение.`);
  }

  return raw as T[number];
}

function safeMetadata(environment: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const value = environment[name]?.trim() || fallback;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
    throw new Error(`${name} должен быть безопасной короткой меткой.`);
  }
  return value;
}

function rawQueryValues(databaseUrl: string, name: string): Map<string, string[]> {
  const queryStart = databaseUrl.indexOf('?');
  if (queryStart === -1 || databaseUrl.includes('#')) {
    throw new Error(`${name} должен содержать корректные query parameters.`);
  }

  const values = new Map<string, string[]>();
  try {
    for (const pair of databaseUrl.slice(queryStart + 1).split('&')) {
      const separator = pair.indexOf('=');
      const rawKey = separator === -1 ? pair : pair.slice(0, separator);
      const rawValue = separator === -1 ? '' : pair.slice(separator + 1);
      const key = decodeURIComponent(rawKey.replaceAll('+', ' '));
      values.set(key, [...(values.get(key) ?? []), rawValue]);
    }
  } catch {
    throw new Error(`${name} содержит некорректное percent-encoding.`);
  }
  return values;
}

export function inspectDatabaseUrlForPg(
  databaseUrl: string,
  name = 'DATABASE_URL',
): DatabaseTarget {
  let client: Client;
  try {
    client = new Client({ connectionString: databaseUrl });
  } catch {
    throw new Error(`${name} должен быть корректным PostgreSQL connection URL.`);
  }

  if (
    !client.host ||
    !client.user ||
    !client.password ||
    !client.database ||
    !client.port ||
    client.port < 1 ||
    client.port > 65_535
  ) {
    throw new Error(`${name} должен задавать user, password, database, host и допустимый порт.`);
  }

  if (!client.host.startsWith('/cloudsql/')) {
    return { host: client.host, transport: 'tcp' };
  }

  if (!cloudSqlSocketPattern.test(client.host)) {
    throw new Error(
      `${name} должен указывать Unix socket /cloudsql/<project>:<region>:<instance>.`,
    );
  }
  if (client.port !== 5432) {
    throw new Error(`${name} для Cloud SQL должен использовать порт PostgreSQL 5432.`);
  }
  if (Buffer.byteLength(`${client.host}${postgresSocketFile}`, 'utf8') >= 108) {
    throw new Error(`${name} задаёт слишком длинный путь Unix socket.`);
  }

  const query = rawQueryValues(databaseUrl, name);
  const allowedQueryKeys = new Set(['host', 'sslmode']);
  if ([...query.keys()].some((key) => !allowedQueryKeys.has(key))) {
    throw new Error(`${name} для Cloud SQL содержит неподдерживаемые query parameters.`);
  }
  const rawHosts = query.get('host') ?? [];
  const sslModes = query.get('sslmode') ?? [];
  const expectedEncodedHost = encodeURIComponent(client.host).toUpperCase();
  if (
    rawHosts.length !== 1 ||
    rawHosts[0]?.toUpperCase() !== expectedEncodedHost ||
    sslModes.length !== 1 ||
    sslModes[0] !== 'disable' ||
    client.ssl !== false
  ) {
    throw new Error(`${name} должен задавать percent-encoded host Unix socket и sslmode=disable.`);
  }

  const schemeEnd = databaseUrl.indexOf('://');
  const pathStart = databaseUrl.indexOf('/', schemeEnd + 3);
  const authority = pathStart === -1 ? '' : databaseUrl.slice(schemeEnd + 3, pathStart);
  const networkAuthority = authority.slice(authority.lastIndexOf('@') + 1);
  if (!/^postgres(?:ql)?:\/\//.test(databaseUrl) || networkAuthority !== '') {
    throw new Error(`${name} для Cloud SQL не должен содержать TCP host в authority.`);
  }

  return { host: client.host, transport: 'cloud-sql-unix' };
}

function requireDatabaseUrl(
  environment: NodeJS.ProcessEnv,
  name: 'DATABASE_URL' | 'MIGRATION_DATABASE_URL',
  requireCloudSqlSocket: boolean,
): string {
  const databaseUrl = requireValue(environment, name);
  const target = inspectDatabaseUrlForPg(databaseUrl, name);
  if (requireCloudSqlSocket && target.transport !== 'cloud-sql-unix') {
    throw new Error(`${name} в hosted environment должен использовать Cloud SQL Unix socket.`);
  }
  return databaseUrl;
}

function loadAppEnvironment(environment: NodeJS.ProcessEnv): AppEnvironment {
  return parseEnum(environment['APP_ENV']?.trim() || 'development', appEnvironments, 'APP_ENV');
}

export function loadAppConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const webDistPath = environment['WEB_DIST_PATH']?.trim();
  const appEnvironment = loadAppEnvironment(environment);
  const port = parsePort(environment['PORT']?.trim() || '3000');
  const sessionSigningSecret =
    environment['SESSION_SIGNING_SECRET']?.trim() ||
    (appEnvironment === 'development' || appEnvironment === 'test'
      ? 'local-development-session-secret-change-me'
      : '');

  if (sessionSigningSecret.length < 32) {
    throw new Error('SESSION_SIGNING_SECRET должен содержать не менее 32 символов.');
  }

  const allowedOrigin =
    environment['APP_ORIGIN']?.trim() ||
    (appEnvironment === 'development' ? 'http://localhost:5173' : `http://localhost:${port}`);
  const parsedOrigin = new URL(allowedOrigin);
  if (parsedOrigin.origin !== allowedOrigin || parsedOrigin.pathname !== '/') {
    throw new Error('APP_ORIGIN должен содержать только точный origin без path.');
  }

  const cloudRunService = environment['K_SERVICE']?.trim();
  const proxyTrustMode = parseEnum(
    environment['PROXY_TRUST_MODE']?.trim() || (cloudRunService ? 'cloud-run' : 'none'),
    proxyTrustModes,
    'PROXY_TRUST_MODE',
  );
  if (
    proxyTrustMode === 'cloud-run' &&
    (appEnvironment === 'development' || appEnvironment === 'test' || !cloudRunService)
  ) {
    throw new Error(
      'PROXY_TRUST_MODE=cloud-run разрешён только для staging/production внутри Cloud Run.',
    );
  }
  if (cloudRunService && proxyTrustMode !== 'cloud-run') {
    throw new Error('Cloud Run service должен использовать PROXY_TRUST_MODE=cloud-run.');
  }

  return {
    allowedOrigin,
    appEnvironment,
    appVersion: safeMetadata(environment, 'APP_VERSION', '0.1.0-dev'),
    cookieSecure: parsedOrigin.protocol === 'https:',
    databaseUrl: requireDatabaseUrl(environment, 'DATABASE_URL', Boolean(cloudRunService)),
    host: environment['HOST']?.trim() || '127.0.0.1',
    logLevel: parseEnum(environment['LOG_LEVEL']?.trim() || 'info', logLevels, 'LOG_LEVEL'),
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
    port,
    proxyTrustMode,
    revision: safeMetadata(environment, 'K_REVISION', 'local'),
    serviceName: safeMetadata(environment, 'K_SERVICE', 'work-card-api'),
    sessionSigningSecret,
    ...(webDistPath ? { webDistPath } : {}),
  };
}

export function loadMigrationConfig(environment: NodeJS.ProcessEnv = process.env): MigrationConfig {
  const appEnvironment = loadAppEnvironment(environment);
  const cloudRunJob = environment['CLOUD_RUN_JOB']?.trim();
  if (cloudRunJob && (appEnvironment === 'development' || appEnvironment === 'test')) {
    throw new Error('Cloud Run Job должен использовать APP_ENV=staging|production.');
  }
  const appDatabaseUser = requireValue(environment, 'APP_DATABASE_USER');

  if (!/^[a-z_][a-z0-9_]*$/.test(appDatabaseUser)) {
    throw new Error('APP_DATABASE_USER должен быть безопасным PostgreSQL identifier.');
  }

  return {
    appDatabasePassword: requireValue(environment, 'APP_DATABASE_PASSWORD'),
    appDatabaseUser,
    migrationDatabaseUrl: requireDatabaseUrl(
      environment,
      'MIGRATION_DATABASE_URL',
      Boolean(cloudRunJob),
    ),
  };
}

export function loadMaintenanceConfig(
  environment: NodeJS.ProcessEnv = process.env,
): MaintenanceConfig {
  const appEnvironment = loadAppEnvironment(environment);
  const cloudRunJob = environment['CLOUD_RUN_JOB']?.trim();
  if (cloudRunJob && (appEnvironment === 'development' || appEnvironment === 'test')) {
    throw new Error('Cloud Run Job должен использовать APP_ENV=staging|production.');
  }
  return {
    migrationDatabaseUrl: requireDatabaseUrl(
      environment,
      'MIGRATION_DATABASE_URL',
      Boolean(cloudRunJob),
    ),
  };
}

export function loadVerificationConfig(
  environment: NodeJS.ProcessEnv = process.env,
): VerificationConfig {
  const appEnvironment = loadAppEnvironment(environment);
  const cloudRunJob = environment['CLOUD_RUN_JOB']?.trim();
  if (cloudRunJob && (appEnvironment === 'development' || appEnvironment === 'test')) {
    throw new Error('Cloud Run Job должен использовать APP_ENV=staging|production.');
  }
  return {
    appDatabaseUser: requireValue(environment, 'APP_DATABASE_USER'),
    databaseUrl: requireDatabaseUrl(environment, 'DATABASE_URL', Boolean(cloudRunJob)),
  };
}
