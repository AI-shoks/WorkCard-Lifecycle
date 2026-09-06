import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import {
  createProcessLogger,
  proxyTrustPolicy,
  rateLimitKey,
  safeLogger,
} from './runtime-protection.js';

function parseLines(lines: string[]): Record<string, unknown>[] {
  return lines
    .join('')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('structured runtime logs', () => {
  it('сопоставляет все Pino levels с Cloud Logging severity', () => {
    const lines: string[] = [];
    const logger = createProcessLogger(
      'serve',
      { LOG_LEVEL: 'trace' },
      new Writable({
        write(chunk, _encoding, done) {
          lines.push(String(chunk));
          done();
        },
      }),
    );

    logger.trace('trace probe');
    logger.debug('debug probe');
    logger.info('info probe');
    logger.warn('warn probe');
    logger.error('error probe');
    logger.fatal('fatal probe');

    expect(
      Object.fromEntries(
        parseLines(lines).map((record) => [record['message'], record['severity']]),
      ),
    ).toEqual({
      'debug probe': 'DEBUG',
      'error probe': 'ERROR',
      'fatal probe': 'CRITICAL',
      'info probe': 'INFO',
      'trace probe': 'DEBUG',
      'warn probe': 'WARNING',
    });
  });

  it('пишет Cloud Logging severity и безопасный request context без секретных данных', async () => {
    const lines: string[] = [];
    const logger = safeLogger('info', {
      appVersion: '0123456789abcdef',
      revision: 'work-card-app-00001-example',
      service: 'work-card-app',
    });
    if (!logger || typeof logger !== 'object') throw new Error('Expected logger options');
    const app = await buildApp({
      appVersion: 'test',
      readiness: { check: async () => ({ database: 'down', migrationVersion: null }) },
      logger: {
        ...logger,
        stream: new Writable({
          write(chunk, _encoding, done) {
            lines.push(String(chunk));
            done();
          },
        }),
      },
    });
    let observedHandlerTimeout: number | undefined;
    app.post('/log-probe/:probeId', async (request) => {
      observedHandlerTimeout = request.routeOptions.handlerTimeout;
      throw new Error('postgresql://owner:SECRET_DRIVER@database/example SELECT SECRET_SQL');
    });
    app.get('/timeout-probe', { handlerTimeout: 25 }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { late: true };
    });
    try {
      app.log.warn(
        {
          databaseUrl: 'postgresql://owner:SECRET_DATABASE@database/example',
          error: new Error('SECRET_RAW_ERROR'),
          headers: { cookie: 'SECRET_DIRECT_COOKIE' },
        },
        'warning probe',
      );
      const response = await app.inject({
        method: 'POST',
        url: '/log-probe/SECRET_PATH?token=SECRET_QUERY',
        headers: {
          cookie: 'SECRET_COOKIE',
          authorization: 'SECRET_AUTH',
          'x-csrf-token': 'SECRET_CSRF',
          'x-request-id': 'SECRET_REQUEST_ID',
        },
        payload: { value: 'SECRET_BODY' },
      });
      expect(response.statusCode).toBe(500);
      expect(response.headers['x-request-id']).not.toBe('SECRET_REQUEST_ID');
      expect(observedHandlerTimeout).toBe(20_000);
      expect(response.body).not.toContain('SECRET_DRIVER');
      expect(response.body).not.toContain('SECRET_QUERY');
      expect(response.body).not.toContain('SECRET_BODY');

      const output = lines.join('');
      expect(output).toContain('Internal operation failed');
      expect(output).not.toContain('SECRET_');
      expect(output).not.toContain('postgresql:');
      expect(output).not.toContain('SELECT');
      expect(output).not.toContain('"body"');
      expect(output).not.toContain('"headers"');

      const records = parseLines(lines);
      expect(records.find((record) => record['message'] === 'warning probe')).toMatchObject({
        severity: 'WARNING',
      });
      const completion = records.find(
        (record) =>
          record['message'] === 'request completed' &&
          record['routeTemplate'] === '/log-probe/:probeId',
      );
      expect(completion).toMatchObject({
        appVersion: '0123456789abcdef',
        method: 'POST',
        requestId: response.headers['x-request-id'],
        revision: 'work-card-app-00001-example',
        routeTemplate: '/log-probe/:probeId',
        service: 'work-card-app',
        severity: 'ERROR',
        status: 500,
      });
      expect(completion).not.toHaveProperty('level');
      expect(completion?.['durationMs']).toEqual(expect.any(Number));
      expect(completion?.['time']).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      expect(app.server.requestTimeout).toBe(15_000);
      expect(app.server.keepAliveTimeout).toBe(5_000);
      const timedOut = await app.inject('/timeout-probe');
      expect(timedOut.statusCode).toBe(503);
      expect(timedOut.json().code).toBe('SERVICE_UNAVAILABLE');
    } finally {
      await app.close();
    }
  });

  it('оставляет migration diagnostics только в operator log, а не в health payload', async () => {
    const lines: string[] = [];
    const logger = safeLogger('info');
    if (!logger || typeof logger !== 'object') throw new Error('Expected logger options');
    const app = await buildApp({
      appVersion: 'SECRET_PUBLIC_VERSION',
      readiness: { check: async () => ({ database: 'up', migrationVersion: 2 }) },
      logger: {
        ...logger,
        stream: new Writable({
          write(chunk, _encoding, done) {
            lines.push(String(chunk));
            done();
          },
        }),
      },
    });
    try {
      const response = await app.inject('/health/ready');
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ status: 'unavailable' });
      expect(response.body).not.toContain('migration');
      expect(response.body).not.toContain('SECRET_PUBLIC_VERSION');

      expect(parseLines(lines)).toContainEqual(
        expect.objectContaining({
          databaseStatus: 'up',
          event: 'health.readiness',
          expectedMigrationVersion: 3,
          migrationVersion: 2,
          severity: 'WARNING',
        }),
      );
    } finally {
      await app.close();
    }
  });

  it('добавляет безопасный Cloud Run Job execution context без raw driver error', () => {
    const lines: string[] = [];
    const destination = new Writable({
      write(chunk, _encoding, done) {
        lines.push(String(chunk));
        done();
      },
    });
    const logger = createProcessLogger(
      'migrate',
      {
        APP_VERSION: '0123456789abcdef',
        CLOUD_RUN_EXECUTION: 'work-card-migrate-example',
        CLOUD_RUN_JOB: 'work-card-migrate',
        LOG_LEVEL: 'info',
      },
      destination,
    );

    logger.error(
      {
        err: new Error('SECRET_DRIVER_ERROR'),
        outcome: 'failed',
        phase: 'migration',
        sql: 'SELECT SECRET_SQL',
      },
      'migration job failed',
    );

    expect(lines.join('')).not.toContain('SECRET_');
    expect(parseLines(lines)).toContainEqual(
      expect.objectContaining({
        appVersion: '0123456789abcdef',
        command: 'migrate',
        executionId: 'work-card-migrate-example',
        message: 'migration job failed',
        outcome: 'failed',
        phase: 'migration',
        revision: 'work-card-migrate-example',
        service: 'work-card-migrate',
        severity: 'ERROR',
      }),
    );
  });
});

describe('proxy trust and rate-limit identity', () => {
  it('игнорирует произвольный X-Forwarded-For вне hosted режима', async () => {
    const app = await buildApp({
      appVersion: 'test',
      readiness: { check: async () => ({ database: 'up', migrationVersion: 3 }) },
      trustProxy: proxyTrustPolicy('none'),
    });
    app.get('/ip-probe', async (request) => ({
      ip: request.ip,
      rateLimitKey: rateLimitKey(request),
    }));
    try {
      const response = await app.inject({
        headers: { 'x-forwarded-for': '203.0.113.250' },
        method: 'GET',
        remoteAddress: '198.51.100.20',
        url: '/ip-probe',
      });
      expect(response.json()).toEqual({
        ip: '198.51.100.20',
        rateLimitKey: '198.51.100.20:read',
      });
    } finally {
      await app.close();
    }
  });

  it('доверяет только непосредственному Cloud Run proxy и связывает rate limit с client IP', async () => {
    const app = await buildApp({
      appVersion: 'test',
      readiness: { check: async () => ({ database: 'up', migrationVersion: 3 }) },
      trustProxy: proxyTrustPolicy('cloud-run'),
    });
    app.post('/api/v1/demo-session', async (request) => ({
      ip: request.ip,
      rateLimitKey: rateLimitKey(request),
    }));
    const requestFrom = (clientIp: string, spoofedIp: string) =>
      app.inject({
        headers: { 'x-forwarded-for': `${spoofedIp}, ${clientIp}` },
        method: 'POST',
        remoteAddress: '169.254.1.1',
        url: '/api/v1/demo-session',
      });

    try {
      for (let index = 1; index <= 30; index += 1) {
        const response = await requestFrom('203.0.113.7', `192.0.2.${index}`);
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({
          ip: '203.0.113.7',
          rateLimitKey: '203.0.113.7:session',
        });
      }

      const limited = await requestFrom('203.0.113.7', '192.0.2.200');
      expect(limited.statusCode).toBe(429);

      const otherClient = await requestFrom('203.0.113.8', '192.0.2.200');
      expect(otherClient.statusCode).toBe(200);
      expect(otherClient.json()).toEqual({
        ip: '203.0.113.8',
        rateLimitKey: '203.0.113.8:session',
      });
    } finally {
      await app.close();
    }
  });
});
