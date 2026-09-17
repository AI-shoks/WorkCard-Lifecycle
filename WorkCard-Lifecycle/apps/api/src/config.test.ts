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
const neonUrl =
  'postgresql://runtime:s%40fe@ep-demo-example.eu-central-1.aws.neon.tech:5432/workcard?sslmode=verify-full';
const neon = {
  APP_ENV: 'production',
  NEON_DATABASE_HOST: 'ep-demo-example.eu-central-1.aws.neon.tech',
  NEON_DATABASE_NAME: 'workcard',
};
const hosted = {
  ...neon,
  APP_ORIGIN: 'https://work-card.example',
  DATABASE_URL: neonUrl,
  RENDER: 'true',
  RENDER_INSTANCE_ID: 'srv-example-instance',
  RENDER_SERVICE_ID: 'srv-example',
  PROXY_TRUST_MODE: 'render',
  PROXY_TRUSTED_CIDRS: '10.0.2.0/24',
  SESSION_SIGNING_SECRET: 'synthetic-test-session-secret-at-least-32',
};

describe('application security config', () => {
  it('keeps local defaults and capacities; requires an explicit hosted secret', () => {
    expect(loadAppConfig({ DATABASE_URL: databaseUrl })).toMatchObject({
      allowedOrigin: 'http://localhost:5173',
      cookieSecure: false,
      proxyTrustMode: 'none',
      proxyTrustedCidrs: [],
      maximumDemoBatches: 20,
      maximumDemoSessions: 500,
      revision: 'local',
    });
    expect(() => loadAppConfig({ APP_ENV: 'production', DATABASE_URL: neonUrl })).toThrow(
      'SESSION_SIGNING_SECRET',
    );
  });
  it('accepts Render HTTPS with an explicit peer allowlist, independent of K_*', () => {
    expect(loadAppConfig(hosted)).toMatchObject({
      cookieSecure: true,
      proxyTrustMode: 'render',
      revision: 'srv-example-instance',
      serviceName: 'srv-example',
      proxyTrustedCidrs: ['10.0.2.0/24'],
    });
    expect(loadAppConfig({ ...hosted, K_SERVICE: 'ignored', K_REVISION: 'ignored' }).revision).toBe(
      'srv-example-instance',
    );
  });
  it('accepts temporary local staging app with direct TLS Neon DB', () => {
    expect(
      loadAppConfig({
        ...neon,
        APP_ENV: 'staging',
        APP_ORIGIN: 'http://127.0.0.1:3000',
        DATABASE_URL: neonUrl,
        SESSION_SIGNING_SECRET: hosted.SESSION_SIGNING_SECRET,
      }),
    ).toMatchObject({
      cookieSecure: false,
      proxyTrustMode: 'none',
    });
  });
  it.each([
    { PROXY_TRUST_MODE: 'none' },
    { PROXY_TRUST_MODE: 'true' },
    { PROXY_TRUSTED_CIDRS: '' },
    { PROXY_TRUSTED_CIDRS: '0.0.0.0/0' },
    { PROXY_TRUSTED_CIDRS: '::/0' },
    { PROXY_TRUSTED_CIDRS: '10.0.0.0/1' },
    { PROXY_TRUSTED_CIDRS: 'loopback' },
    { PROXY_TRUSTED_CIDRS: '10.0.0.1,10.0.0.1' },
    { RENDER: 'false' },
    { RENDER_SERVICE_ID: '' },
    { APP_ENV: 'test' },
    { APP_ORIGIN: 'http://example.test' },
    { APP_ORIGIN: 'https://example.test/path' },
    { APP_ORIGIN: 'https://user:pass@example.test' },
  ])('rejects unsafe hosted proxy/origin configuration %j', (override) => {
    expect(() => loadAppConfig({ ...hosted, ...override })).toThrow();
  });
  it('rejects owner credentials in runtime in local and hosted modes', () => {
    for (const base of [hosted, { APP_ENV: 'test', DATABASE_URL: databaseUrl }]) {
      expect(() => loadAppConfig({ ...base, MIGRATION_DATABASE_URL: neonUrl })).toThrow(
        'Owner credentials',
      );
      expect(() => loadAppConfig({ ...base, APP_DATABASE_PASSWORD: 'synthetic' })).toThrow(
        'Owner credentials',
      );
    }
  });
  it('validates hard shared-demo capacities and actual port', () => {
    expect(
      loadAppConfig({
        APP_ENV: 'test',
        DATABASE_URL: databaseUrl,
        PORT: '10000',
        DEMO_MAX_BATCHES: '7',
        DEMO_MAX_SESSIONS: '25',
      }),
    ).toMatchObject({ port: 10000, maximumDemoBatches: 7, maximumDemoSessions: 25 });
    for (const override of [
      { PORT: '0' },
      { DEMO_MAX_BATCHES: '101' },
      { DEMO_MAX_SESSIONS: '10001' },
    ]) {
      expect(() =>
        loadAppConfig({ APP_ENV: 'test', DATABASE_URL: databaseUrl, ...override }),
      ).toThrow();
    }
  });
});

describe('direct Neon TCP/TLS contract', () => {
  it('matches parsed pg target and keeps certificate and hostname verification enabled', () => {
    expect(inspectDatabaseUrlForPg(neonUrl)).toEqual({
      host: neon.NEON_DATABASE_HOST,
      database: 'workcard',
      transport: 'tcp',
    });
    const client = new Client({ connectionString: loadAppConfig(hosted).databaseUrl });
    expect(client.host).toBe(neon.NEON_DATABASE_HOST);
    expect(client.database).toBe('workcard');
    expect(client.ssl).toBeTruthy();
    expect(client.ssl).not.toMatchObject({ rejectUnauthorized: false });
    expect(client.ssl).not.toHaveProperty('checkServerIdentity');
  });
  it('owner seed/reset/verify config requires only owner URL and target metadata', () => {
    expect(loadMaintenanceConfig({ ...neon, MIGRATION_DATABASE_URL: neonUrl })).toEqual({
      migrationDatabaseUrl: neonUrl,
    });
    expect(
      loadMigrationConfig({
        ...neon,
        MIGRATION_DATABASE_URL: neonUrl,
        APP_DATABASE_USER: 'runtime',
        APP_DATABASE_PASSWORD: 'synthetic',
      }),
    ).toMatchObject({ appDatabaseUser: 'runtime', migrationDatabaseUrl: neonUrl });
    expect(
      loadVerificationConfig({
        ...neon,
        MIGRATION_DATABASE_URL: neonUrl,
        APP_DATABASE_USER: 'runtime',
      }),
    ).toMatchObject({ migrationDatabaseUrl: neonUrl });
  });
  it.each([
    neonUrl.replace('verify-full', 'require'),
    neonUrl.replace('verify-full', 'verify-ca'),
    neonUrl.replace('verify-full', 'disable'),
    neonUrl.replace('verify-full', 'no-verify'),
    neonUrl.replace('?sslmode=verify-full', ''),
    neonUrl.replace('ep-demo-example.', 'ep-demo-example-pooler.'),
    neonUrl.replace('/workcard?', '/wrong?'),
    neonUrl.replace('ep-demo-example.', 'ep-other.'),
    neonUrl.replace(':5432/', ':6432/'),
    neonUrl + '&sslmode=disable',
    neonUrl + '&ssl=true',
    neonUrl + '&host=localhost',
    neonUrl + '&database=wrong',
    neonUrl + '&user=owner',
    neonUrl + '&sslrootcert=/tmp/cert',
    neonUrl + '&sslcert=/tmp/cert',
    neonUrl + '&uselibpqcompat=true',
    neonUrl + '&options=-c%20statement_timeout%3D0',
    neonUrl + '#fragment',
    'postgresql://runtime:synthetic@/workcard?host=%2Fcloudsql%2Fexample&sslmode=disable',
  ])('rejects downgrade, pooler and ambiguous overrides without exposing URL %#', (value) => {
    for (const run of [
      () => loadAppConfig({ ...hosted, DATABASE_URL: value }),
      () => loadMaintenanceConfig({ ...neon, MIGRATION_DATABASE_URL: value }),
    ]) {
      expect(run).toThrow();
      try {
        run();
      } catch (error) {
        expect(String(error)).not.toMatch(/s%40fe|runtime:|postgresql:\/\//);
      }
    }
  });
  it.each([
    'PGHOST',
    'PGPORT',
    'PGDATABASE',
    'PGUSER',
    'PGPASSWORD',
    'PGSSLMODE',
    'PGOPTIONS',
    'PGSSLROOTCERT',
    'PGSERVICE',
  ])('rejects %s env override', (key) => {
    expect(() => loadAppConfig({ ...hosted, [key]: 'ignored' })).toThrow('PG*');
  });
  it('requires exact expected target and refuses env TLS downgrade or remote local-test targets', () => {
    expect(() => loadAppConfig({ ...hosted, NEON_DATABASE_HOST: '' })).toThrow(
      'NEON_DATABASE_HOST',
    );
    expect(() => loadAppConfig({ ...hosted, NEON_DATABASE_NAME: 'wrong' })).toThrow('ожидаемые');
    expect(() => loadAppConfig({ ...hosted, NODE_TLS_REJECT_UNAUTHORIZED: '0' })).toThrow('TLS');
    expect(() =>
      loadMaintenanceConfig({ APP_ENV: 'test', MIGRATION_DATABASE_URL: neonUrl }),
    ).toThrow('локальным');
    expect(() => inspectDatabaseUrlForPg('postgresql://runtime@localhost/workcard')).toThrow();
  });
});

describe('initial Render observation mode', () => {
  it('does not trust forwarding or require a guessed CIDR before peer observation', () => {
    expect(
      loadAppConfig({ ...hosted, PROXY_TRUST_MODE: 'observe', PROXY_TRUSTED_CIDRS: '' }),
    ).toMatchObject({ proxyTrustMode: 'observe', proxyTrustedCidrs: [] });
    expect(() => loadAppConfig({ ...hosted, PROXY_TRUST_MODE: 'observe' })).toThrow(
      'PROXY_TRUSTED_CIDRS',
    );
    expect(() =>
      loadAppConfig({
        ...hosted,
        RENDER: '',
        PROXY_TRUST_MODE: 'observe',
        PROXY_TRUSTED_CIDRS: '',
      }),
    ).toThrow('внутри Render');
    expect(() =>
      loadAppConfig({
        ...hosted,
        RENDER: '',
        PROXY_TRUST_MODE: 'none',
        PROXY_TRUSTED_CIDRS: '',
        APP_ORIGIN: 'http://localhost:3000',
      }),
    ).toThrow('HTTPS');
  });
});
