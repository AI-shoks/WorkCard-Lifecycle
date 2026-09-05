import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyServerOptions } from 'fastify';
import type { PoolConfig } from 'pg';

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

export function safeLogger(level: string): FastifyServerOptions['logger'] {
  return {
    level,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers.x-csrf-token',
        'req.body',
        'body',
        'databaseUrl',
        'DATABASE_URL',
        'password',
        'csrfToken',
        'sessionSigningSecret',
      ],
      censor: '[REDACTED]',
    },
    serializers: {
      req: (request) => ({
        method: request.method,
        url: request.routeOptions?.url ?? '[unmatched]',
        headers: {},
        hostname: '',
        remoteAddress: '',
        remotePort: 0,
      }),
      // Driver messages/stacks may contain SQL, credentials or request input.
      err: () => ({ type: 'Error', message: 'Internal operation failed', stack: '[REDACTED]' }),
    },
  };
}

export async function registerRateLimits(app: FastifyInstance) {
  const group = (method: string, path: string) =>
    path === '/api/v1/demo-session' && method === 'POST'
      ? 'session'
      : path.startsWith('/health/')
        ? 'health'
        : ['GET', 'HEAD'].includes(method)
          ? 'read'
          : 'mutation';
  const maximum = { session: 30, health: 600, read: 3000, mutation: 600 };
  await app.register(rateLimit, {
    global: true,
    timeWindow: 60_000,
    cache: 10_000,
    keyGenerator: (request) =>
      `${request.ip}:${group(request.method, request.url.split('?')[0] ?? '')}`,
    max: (request) => maximum[group(request.method, request.url.split('?')[0] ?? '')],
  });
}
