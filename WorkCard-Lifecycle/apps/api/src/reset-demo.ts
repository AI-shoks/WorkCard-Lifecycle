import 'dotenv/config';

import { Client } from 'pg';

import { loadMaintenanceConfig } from './config.js';
import { resetDemoData } from './demo-maintenance.js';
import { createProcessLogger } from './runtime-protection.js';

const logger = createProcessLogger('reset');

async function main(): Promise<void> {
  logger.info({ outcome: 'started', phase: 'reset' }, 'demo reset job started');
  const config = loadMaintenanceConfig();
  const client = new Client({ connectionString: config.migrationDatabaseUrl });

  await client.connect();
  try {
    const removed = await resetDemoData(client);
    logger.info({ outcome: 'succeeded', phase: 'reset', removed }, 'demo reset job succeeded');
  } finally {
    await client.end();
  }
}

main().catch(() => {
  logger.error({ outcome: 'failed', phase: 'reset' }, 'demo reset job failed');
  process.exitCode = 1;
});
