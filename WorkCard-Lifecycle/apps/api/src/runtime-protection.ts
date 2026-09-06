import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest, FastifyServerOptions } from 'fastify';
import pino, { type DestinationStream, type Logger, type LoggerOptions } from 'pino';
import type { PoolConfig } from 'pg';

import type { ProxyTrustMode } from './config.js';

// Resource budgets for this single-process demo, not business latency promises.
export const databaseBudgets: PoolConfig = {
  connectionTimeoutMillis: 3_000,
  idleTimeoutMillis: 10_000,
  max: 10,
  statement_timeout: 10_000,
  lock_timeout: 3_000,
  idle_in_transaction_session_timeout: 15_000,
  options: '-c transaction_timeout=15000',
};

export type RuntimeLogContext = {
  appVersion: string;
  revision: string;
  service: string;
};

const severityByLevel: Readonly<Record<string, string>> = {
  debug: 'DEBUG',
  error: 'ERROR',
  fatal: 'CRITICAL',
  info: 'INFO',
  trace: 'DEBUG',
  warn: 'WARNING',
};

const redactedPaths = [
  'req.headers',
  'req.query',
  'req.body',
  'request.headers',
  'request.query',
  'request.body',
  'headers',
  'query',
  'body',
  'cookie',
  'cookies',
  'authorization',
  'csrfToken',
  'sessionToken',
  'sessionSigningSecret',
  'databaseUrl',
  'migrationDatabaseUrl',
  'DATABASE_URL',
  'MIGRATION_DATABASE_URL',
  'connectionString',
  'password',
  'sql',
  'statement',
  'parameters',
] as const;

function genericError() {
  return { type: 'Error', message: 'Internal operation failed', stack: '[REDACTED]' };
}

function loggerOptions(
  level: string,
  context: RuntimeLogContext & Record<string, unknown>,
): LoggerOptions {
  return {
    base: context,
    formatters: {
      level: (label) => ({ severity: severityByLevel[label] ?? 'DEFAULT' }),
    },
    level,
    messageKey: 'message',
    redact: {
      paths: [...redactedPaths],
      remove: true,
    },
    serializers: {
      error: genericError,
      err: genericError,
      req: (request) => ({
        method: request.method,
        routeTemplate: request.routeOptions?.url ?? '[unmatched]',
      }),
      res: (reply) => ({ status: reply.statusCode }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  };
}

export function safeLogger(
  level: string,
  context: RuntimeLogContext = {
    appVersion: 'unknown',
    revision: 'local',
    service: 'work-card-api',
  },
): FastifyServerOptions['logger'] {
  return loggerOptions(level, context);
}

function safeProcessMetadata(raw: string | undefined, fallback: string): string {
  const value = raw?.trim();
  return value && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value) ? value : fallback;
}

export function createProcessLogger(
  command: 'migrate' | 'reset' | 'seed' | 'serve' | 'verify',
  environment: NodeJS.ProcessEnv = process.env,
  destination?: DestinationStream,
): Logger {
  const executionId = safeProcessMetadata(environment['CLOUD_RUN_EXECUTION'], 'local');
  const context: RuntimeLogContext & Record<string, unknown> = {
    appVersion: safeProcessMetadata(environment['APP_VERSION'], 'unknown'),
    command,
    revision: safeProcessMetadata(
      environment['K_REVISION'] ?? environment['CLOUD_RUN_EXECUTION'],
      'local',
    ),
    service: safeProcessMetadata(
      environment['K_SERVICE'] ?? environment['CLOUD_RUN_JOB'],
      command === 'serve' ? 'work-card-api' : `work-card-${command}`,
    ),
    ...(command === 'serve' ? {} : { executionId }),
  };
  const configuredLevel = safeProcessMetadata(environment['LOG_LEVEL'], 'info');
  const level =
    configuredLevel === 'silent' || configuredLevel in severityByLevel ? configuredLevel : 'info';
  const options = loggerOptions(level, context);
  return destination ? pino(options, destination) : pino(options);
}

export function proxyTrustPolicy(mode: ProxyTrustMode): FastifyServerOptions['trustProxy'] {
  if (mode === 'none') return false;

  // Direct run.app traffic has one application-visible proxy boundary. Trust only
  // the socket peer, so request.ip resolves to the right-most platform-added XFF
  // address and never to any earlier client-supplied value.
  return (_address: string, hop: number) => hop === 0;
}

type RateLimitRequest = Pick<FastifyRequest, 'ip' | 'method' | 'url'>;

function rateLimitGroup(method: string, path: string) {
  return path === '/api/v1/demo-session' && method === 'POST'
    ? 'session'
    : path.startsWith('/health/')
      ? 'health'
      : ['GET', 'HEAD'].includes(method)
        ? 'read'
        : 'mutation';
}

export function rateLimitKey(request: RateLimitRequest): string {
  const path = request.url.split('?')[0] ?? '';
  return `${request.ip}:${rateLimitGroup(request.method, path)}`;
}

export async function registerRateLimits(app: FastifyInstance) {
  const maximum = { session: 30, health: 600, read: 3000, mutation: 600 };
  await app.register(rateLimit, {
    global: true,
    timeWindow: 60_000,
    cache: 10_000,
    keyGenerator: rateLimitKey,
    max: (request) => {
      const path = request.url.split('?')[0] ?? '';
      return maximum[rateLimitGroup(request.method, path)];
    },
  });
}
