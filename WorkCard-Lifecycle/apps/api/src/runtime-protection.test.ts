import { Writable } from 'node:stream';
import { expect, it } from 'vitest';

import { buildApp } from './app.js';
import { safeLogger } from './runtime-protection.js';

it('runtime logs and problem responses cannot expose headers, body, query or driver error secrets', async () => {
  const lines: string[] = [];
  const logger = safeLogger('info');
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
  app.post('/log-probe', async (request) => {
    observedHandlerTimeout = request.routeOptions.handlerTimeout;
    throw new Error('postgresql://owner:SECRET_DRIVER@database/example');
  });
  app.get('/timeout-probe', { handlerTimeout: 25 }, async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    return { late: true };
  });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/log-probe?token=SECRET_QUERY',
      headers: {
        cookie: 'SECRET_COOKIE',
        authorization: 'SECRET_AUTH',
        'x-csrf-token': 'SECRET_CSRF',
      },
      payload: { value: 'SECRET_BODY' },
    });
    expect(response.statusCode).toBe(500);
    expect(observedHandlerTimeout).toBe(20_000);
    expect(response.body).not.toContain('SECRET_');
    const output = lines.join('');
    expect(output).toContain('Internal operation failed');
    expect(output).not.toContain('SECRET_');
    expect(output).not.toContain('postgresql:');
    expect(output).not.toContain('"body"');
    expect(app.server.requestTimeout).toBe(15_000);
    expect(app.server.keepAliveTimeout).toBe(5_000);
    const timedOut = await app.inject('/timeout-probe');
    expect(timedOut.statusCode).toBe(503);
    expect(timedOut.json().code).toBe('SERVICE_UNAVAILABLE');
  } finally {
    await app.close();
  }
});
