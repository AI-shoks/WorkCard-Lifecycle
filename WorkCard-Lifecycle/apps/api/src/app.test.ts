import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import type { ReadinessService } from './readiness.js';

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

function readiness(database: 'up' | 'down', migrationVersion: number | null): ReadinessService {
  return { check: async () => ({ database, migrationVersion }) };
}

describe('health routes', () => {
  it('отвечает liveness без зависимости от БД', async () => {
    const app = await buildApp({
      appVersion: 'test',
      readiness: readiness('down', null),
    });
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/health/live' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', service: 'work-card-api', version: 'test' });
  });

  it('подтверждает readiness только для доступной и мигрированной БД', async () => {
    const app = await buildApp({ appVersion: 'test', readiness: readiness('up', 1) });
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok', database: 'up', migrationVersion: 1 });
  });

  it('возвращает 503 до готовности БД', async () => {
    const app = await buildApp({ appVersion: 'test', readiness: readiness('down', null) });
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ status: 'unavailable', database: 'down' });
  });
});
