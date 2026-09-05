import 'dotenv/config';

import { resolve } from 'node:path';

import { Pool } from 'pg';

import { buildApp } from './app.js';
import { loadAppConfig } from './config.js';
import { createDatabaseReadiness } from './readiness.js';
import { databaseBudgets, safeLogger } from './runtime-protection.js';

async function main(): Promise<void> {
  const config = loadAppConfig();
  const pool = new Pool({
    connectionString: config.databaseUrl,
    ...databaseBudgets,
  });
  const app = await buildApp({
    appVersion: config.appVersion,
    logger: safeLogger(config.logLevel),
    pool,
    readiness: createDatabaseReadiness(pool),
    security: {
      allowedOrigin: config.allowedOrigin,
      cookieSecure: config.cookieSecure,
      signingSecret: config.sessionSigningSecret,
    },
    ...(config.webDistPath ? { webDistPath: resolve(config.webDistPath) } : {}),
  });

  app.addHook('onClose', async () => {
    await pool.end();
  });

  let closing = false;
  const close = async (signal: NodeJS.Signals) => {
    if (closing) return;
    closing = true;
    app.log.info({ signal }, 'graceful shutdown');
    await app.close();
  };

  process.once('SIGINT', () => void close('SIGINT'));
  process.once('SIGTERM', () => void close('SIGTERM'));

  await app.listen({ host: config.host, port: config.port });
}

main().catch(() => {
  console.error('Запуск не выполнен. Проверьте конфигурацию и доступность БД.');
  process.exitCode = 1;
});
