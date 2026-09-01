import 'dotenv/config';

import { resolve } from 'node:path';

import { Pool } from 'pg';

import { buildApp } from './app.js';
import { loadAppConfig } from './config.js';
import { createDatabaseReadiness } from './readiness.js';

async function main(): Promise<void> {
  const config = loadAppConfig();
  const pool = new Pool({
    connectionString: config.databaseUrl,
    connectionTimeoutMillis: 3_000,
    idleTimeoutMillis: 10_000,
    max: 10,
  });
  const app = await buildApp({
    appVersion: config.appVersion,
    logger: {
      level: config.logLevel,
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie', 'req.headers.x-csrf-token'],
        censor: '[REDACTED]',
      },
    },
    readiness: createDatabaseReadiness(pool),
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

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Неизвестная ошибка запуска.';
  console.error(message);
  process.exitCode = 1;
});
