import { Client } from 'pg';
import { describe, expect, it } from 'vitest';

import {
  inspectDatabaseUrlForPg,
  loadAppConfig,
  loadMaintenanceConfig,
  loadMigrationConfig,
  loadVerificationConfig,
} from './config.js';

const databaseUrl = 'postgresql://runtime:local@localhost:5432/workcard';
const cloudSqlSocket = '/cloudsql/example-project:europe-west1:work-card';
const cloudSqlDatabaseUrl =
  'postgresql://runtime:s%40fe@/workcard?host=%2Fcloudsql%2Fexample-project%3Aeurope-west1%3Awork-card&sslmode=disable';
const hostedEnvironment = {
  APP_ENV: 'production',
  APP_ORIGIN: 'https://work-card.example',
  DATABASE_URL: cloudSqlDatabaseUrl,
  K_REVISION: 'work-card-app-00001-example',
  K_SERVICE: 'work-card-app',
  PROXY_TRUST_MODE: 'cloud-run',
  SESSION_SIGNING_SECRET: 'production-session-secret-at-least-32',
} as const;

describe('application security config', () => {
  it('разрешает только локальный development secret по умолчанию', () => {
    const config = loadAppConfig({ APP_ENV: 'development', DATABASE_URL: databaseUrl });

    expect(config.allowedOrigin).toBe('http://localhost:5173');
    expect(config.cookieSecure).toBe(false);
    expect(config.proxyTrustMode).toBe('none');
    expect(config.maximumDemoBatches).toBe(20);
    expect(config.maximumDemoSessions).toBe(500);
    expect(config.revision).toBe('local');
    expect(config.sessionSigningSecret.length).toBeGreaterThanOrEqual(32);
  });

  it('не запускает production без явного session secret', () => {
    expect(() => loadAppConfig({ APP_ENV: 'production', DATABASE_URL: databaseUrl })).toThrow(
      'SESSION_SIGNING_SECRET',
    );
  });

  it('включает Secure cookie для точного HTTPS origin', () => {
    const config = loadAppConfig(hostedEnvironment);

    expect(config.cookieSecure).toBe(true);
    expect(config.proxyTrustMode).toBe('cloud-run');
    expect(config.revision).toBe('work-card-app-00001-example');
  });

  it('отклоняет origin с path', () => {
    expect(() =>
      loadAppConfig({
        APP_ENV: 'test',
        APP_ORIGIN: 'http://localhost:3000/app',
        DATABASE_URL: databaseUrl,
      }),
    ).toThrow('APP_ORIGIN');
  });

  it('не разрешает Cloud Run proxy trust в local/test или без platform boundary', () => {
    expect(() =>
      loadAppConfig({
        APP_ENV: 'test',
        DATABASE_URL: databaseUrl,
        K_SERVICE: 'spoofed-service',
        PROXY_TRUST_MODE: 'cloud-run',
      }),
    ).toThrow('только для staging/production внутри Cloud Run');

    expect(() =>
      loadAppConfig({
        APP_ENV: 'production',
        APP_ORIGIN: 'https://work-card.example',
        DATABASE_URL: cloudSqlDatabaseUrl,
        PROXY_TRUST_MODE: 'cloud-run',
        SESSION_SIGNING_SECRET: 'production-session-secret-at-least-32',
      }),
    ).toThrow('только для staging/production внутри Cloud Run');
  });

  it('не разрешает отключить ограниченный proxy trust внутри Cloud Run', () => {
    expect(() => loadAppConfig({ ...hostedEnvironment, PROXY_TRUST_MODE: 'none' })).toThrow(
      'Cloud Run service должен использовать PROXY_TRUST_MODE=cloud-run',
    );
  });

  it('валидирует жёсткие лимиты общего demo-контура', () => {
    expect(
      loadAppConfig({
        APP_ENV: 'test',
        DATABASE_URL: databaseUrl,
        DEMO_MAX_BATCHES: '7',
        DEMO_MAX_SESSIONS: '25',
      }),
    ).toMatchObject({ maximumDemoBatches: 7, maximumDemoSessions: 25 });
    expect(() =>
      loadAppConfig({ APP_ENV: 'test', DATABASE_URL: databaseUrl, DEMO_MAX_BATCHES: '0' }),
    ).toThrow('DEMO_MAX_BATCHES');
    expect(() =>
      loadAppConfig({ APP_ENV: 'test', DATABASE_URL: databaseUrl, DEMO_MAX_SESSIONS: '10001' }),
    ).toThrow('DEMO_MAX_SESSIONS');
  });
});

describe('database connection config', () => {
  it('детерминированно разбирает percent-encoded Cloud SQL socket текущим pg', () => {
    expect(inspectDatabaseUrlForPg(cloudSqlDatabaseUrl)).toEqual({
      host: cloudSqlSocket,
      transport: 'cloud-sql-unix',
    });

    const pgClient = new Client({ connectionString: cloudSqlDatabaseUrl });
    expect(pgClient.host).toBe(cloudSqlSocket);
    expect(pgClient.port).toBe(5432);
    expect(pgClient.ssl).toBe(false);
  });

  it('требует Cloud SQL socket для hosted app, migrate и verify', () => {
    expect(() => loadAppConfig({ ...hostedEnvironment, DATABASE_URL: databaseUrl })).toThrow(
      'Cloud SQL Unix socket',
    );
    expect(() =>
      loadMigrationConfig({
        APP_DATABASE_PASSWORD: 'runtime-password',
        APP_DATABASE_USER: 'runtime',
        APP_ENV: 'staging',
        CLOUD_RUN_JOB: 'work-card-migrate',
        MIGRATION_DATABASE_URL: databaseUrl,
      }),
    ).toThrow('Cloud SQL Unix socket');
    expect(() =>
      loadVerificationConfig({
        APP_DATABASE_USER: 'runtime',
        APP_ENV: 'staging',
        CLOUD_RUN_JOB: 'work-card-verify',
        DATABASE_URL: databaseUrl,
      }),
    ).toThrow('Cloud SQL Unix socket');
    expect(() =>
      loadMaintenanceConfig({
        APP_ENV: 'production',
        CLOUD_RUN_JOB: 'work-card-reset',
        MIGRATION_DATABASE_URL: databaseUrl,
      }),
    ).toThrow('Cloud SQL Unix socket');
  });

  it('отклоняет raw, неоднозначный и неверный Cloud SQL host без раскрытия URL', () => {
    const rawHostUrl =
      'postgresql://runtime:safe@/workcard?host=/cloudsql/example-project:europe-west1:work-card&sslmode=disable';
    const extraOptionUrl = `${cloudSqlDatabaseUrl}&options=-c%20search_path%3Dprivate`;
    const malformedSocketUrl = cloudSqlDatabaseUrl.replace(
      'example-project%3Aeurope-west1%3Awork-card',
      'example-project%3Aeurope-west1%3Awork-card%2Fextra',
    );

    expect(() => inspectDatabaseUrlForPg(rawHostUrl)).toThrow('percent-encoded host');
    expect(() => inspectDatabaseUrlForPg(extraOptionUrl)).toThrow(
      'неподдерживаемые query parameters',
    );
    expect(() => inspectDatabaseUrlForPg(malformedSocketUrl)).toThrow(
      '/cloudsql/<project>:<region>:<instance>',
    );
    for (const value of [rawHostUrl, extraOptionUrl, malformedSocketUrl]) {
      try {
        inspectDatabaseUrlForPg(value);
      } catch (error) {
        expect(String(error)).not.toContain('runtime:safe');
        expect(String(error)).not.toContain('s%40fe');
      }
    }
  });
});
