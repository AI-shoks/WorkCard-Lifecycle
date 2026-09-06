import 'dotenv/config';

import { resolve } from 'node:path';

import { Pool } from 'pg';

import { buildApp } from './app.js';
import { loadAppConfig } from './config.js';
import { createDatabaseReadiness } from './readiness.js';
import {
  createProcessLogger,
  databaseBudgets,
  proxyTrustPolicy,
  safeLogger,
} from './runtime-protection.js';

const processLogger = createProcessLogger('serve');

async function main(): Promise<void> {
  const config = loadAppConfig();
  const pool = new Pool({
    connectionString: config.databaseUrl,
    ...databaseBudgets,
  });
  const app = await buildApp({
    appVersion: config.appVersion,
    demoCapacity: {
      maximumBatches: config.maximumDemoBatches,
      maximumSessions: config.maximumDemoSessions,
    },
    logger: safeLogger(config.logLevel, {
      appVersion: config.appVersion,
      revision: config.revision,
      service: config.serviceName,
    }),
    pool,
    readiness: createDatabaseReadiness(pool),
    security: {
      allowedOrigin: config.allowedOrigin,
      cookieSecure: config.cookieSecure,
      signingSecret: config.sessionSigningSecret,
    },
    trustProxy: proxyTrustPolicy(config.proxyTrustMode),
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
  app.log.info(
    { event: 'service.started', host: config.host, port: config.port },
    'service started',
  );
}

main().catch(() => {
  processLogger.fatal({ event: 'service.startup', outcome: 'failed' }, 'service startup failed');
  process.exitCode = 1;
});
