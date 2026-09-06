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
  it('отвечает sanitized liveness без версии и зависимости от БД', async () => {
    const app = await buildApp({
      appVersion: 'test',
      readiness: readiness('down', null),
    });
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/health/live' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    expect(response.body).not.toContain('test');
  });

  it('отправляет принятые browser security headers', async () => {
    const app = await buildApp({
      appVersion: 'test',
      readiness: readiness('down', null),
    });
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/health/live' });

    expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(response.headers['permissions-policy']).toBe(
      'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
    );
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('подтверждает readiness только для доступной и мигрированной БД', async () => {
    const app = await buildApp({ appVersion: 'test', readiness: readiness('up', 3) });
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('возвращает 503 до готовности БД', async () => {
    const app = await buildApp({ appVersion: 'test', readiness: readiness('down', null) });
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'unavailable' });
    expect(response.body).not.toContain('migration');
    expect(response.body).not.toContain('database');
  });

  it('возвращает 503 без раскрытия номера отставшей migration', async () => {
    const app = await buildApp({ appVersion: 'test', readiness: readiness('up', 2) });
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'unavailable' });
  });
});
