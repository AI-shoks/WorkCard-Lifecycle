import { describe, expect, it } from 'vitest';

import { loadAppConfig } from './config.js';

const databaseUrl = 'postgresql://runtime:local@localhost:5432/workcard';

describe('application security config', () => {
  it('разрешает только локальный development secret по умолчанию', () => {
    const config = loadAppConfig({ APP_ENV: 'development', DATABASE_URL: databaseUrl });

    expect(config.allowedOrigin).toBe('http://localhost:5173');
    expect(config.cookieSecure).toBe(false);
    expect(config.sessionSigningSecret.length).toBeGreaterThanOrEqual(32);
  });

  it('не запускает production без явного session secret', () => {
    expect(() => loadAppConfig({ APP_ENV: 'production', DATABASE_URL: databaseUrl })).toThrow(
      'SESSION_SIGNING_SECRET',
    );
  });

  it('включает Secure cookie для точного HTTPS origin', () => {
    const config = loadAppConfig({
      APP_ENV: 'production',
      APP_ORIGIN: 'https://work-card.example',
      DATABASE_URL: databaseUrl,
      SESSION_SIGNING_SECRET: 'production-session-secret-at-least-32',
    });

    expect(config.cookieSecure).toBe(true);
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
});
