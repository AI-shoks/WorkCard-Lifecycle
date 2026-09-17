import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest, FastifyServerOptions } from 'fastify';
import pino, { type DestinationStream, type Logger, type LoggerOptions } from 'pino';
import type { Pool, PoolConfig } from 'pg';

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
      level: (label, number) => ({ level: number, severity: severityByLevel[label] ?? 'DEFAULT' }),
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
  command: 'bootstrap' | 'release' | 'migrate' | 'reset' | 'seed' | 'serve' | 'verify',
  environment: NodeJS.ProcessEnv = process.env,
  destination?: DestinationStream,
): Logger {
  const executionId = safeProcessMetadata(environment['GITHUB_RUN_ID'], 'local');
  const context: RuntimeLogContext & Record<string, unknown> = {
    appVersion: safeProcessMetadata(environment['APP_VERSION'], 'unknown'),
    command,
    revision: safeProcessMetadata(
      environment['RENDER_INSTANCE_ID'] ?? environment['GITHUB_RUN_ID'],
      'local',
    ),
    service: safeProcessMetadata(
      environment['RENDER_SERVICE_ID'],
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

export function proxyTrustPolicy(
  mode: ProxyTrustMode,
  trustedCidrs: string[] = [],
): FastifyServerOptions['trustProxy'] {
  if (mode !== 'render') return false;
  if (trustedCidrs.length === 0) throw new Error('Render proxy peer allowlist is required.');
  // Fastify validates every peer against this explicit IP/CIDR allowlist. The
  // actual Render peer/forwarding chain must be qualified before public release.
  return trustedCidrs;
}

export function handleIdlePoolErrors(pool: Pool, logger: Pick<Logger, 'warn'>): void {
  // pg removes the failed idle connection. Log no driver message/client/URL and
  // let the next operation reconnect; a DB outage still fails readiness/gates.
  pool.on('error', () => {
    logger.warn(
      { event: 'database.idle_connection', outcome: 'disconnected' },
      'idle database connection closed',
    );
  });
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
