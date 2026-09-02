const appEnvironments = ['development', 'test', 'staging', 'production'] as const;
const logLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

type AppEnvironment = (typeof appEnvironments)[number];
type LogLevel = (typeof logLevels)[number];

export type AppConfig = {
  allowedOrigin: string;
  appEnvironment: AppEnvironment;
  appVersion: string;
  cookieSecure: boolean;
  databaseUrl: string;
  host: string;
  logLevel: LogLevel;
  port: number;
  sessionSigningSecret: string;
  webDistPath?: string;
};

export type MigrationConfig = {
  appDatabasePassword: string;
  appDatabaseUser: string;
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

export function loadAppConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const webDistPath = environment['WEB_DIST_PATH']?.trim();
  const appEnvironment = parseEnum(
    environment['APP_ENV']?.trim() || 'development',
    appEnvironments,
    'APP_ENV',
  );
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

  return {
    allowedOrigin,
    appEnvironment,
    appVersion: environment['APP_VERSION']?.trim() || '0.1.0-dev',
    cookieSecure: parsedOrigin.protocol === 'https:',
    databaseUrl: requireValue(environment, 'DATABASE_URL'),
    host: environment['HOST']?.trim() || '127.0.0.1',
    logLevel: parseEnum(environment['LOG_LEVEL']?.trim() || 'info', logLevels, 'LOG_LEVEL'),
    port,
    sessionSigningSecret,
    ...(webDistPath ? { webDistPath } : {}),
  };
}

export function loadMigrationConfig(environment: NodeJS.ProcessEnv = process.env): MigrationConfig {
  const appDatabaseUser = requireValue(environment, 'APP_DATABASE_USER');

  if (!/^[a-z_][a-z0-9_]*$/.test(appDatabaseUser)) {
    throw new Error('APP_DATABASE_USER должен быть безопасным PostgreSQL identifier.');
  }

  return {
    appDatabasePassword: requireValue(environment, 'APP_DATABASE_PASSWORD'),
    appDatabaseUser,
    migrationDatabaseUrl: requireValue(environment, 'MIGRATION_DATABASE_URL'),
  };
}

export function loadVerificationConfig(
  environment: NodeJS.ProcessEnv = process.env,
): VerificationConfig {
  return {
    appDatabaseUser: requireValue(environment, 'APP_DATABASE_USER'),
    databaseUrl: requireValue(environment, 'DATABASE_URL'),
  };
}
