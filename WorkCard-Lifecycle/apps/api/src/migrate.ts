import 'dotenv/config';

import { loadMigrationConfig } from './config.js';
import { runMigrations } from './migration-runner.js';
import { createProcessLogger } from './runtime-protection.js';

const logger = createProcessLogger('migrate');

async function main(): Promise<void> {
  logger.info({ outcome: 'started', phase: 'migration' }, 'migration job started');
  await runMigrations(loadMigrationConfig(), undefined, logger);
  logger.info({ outcome: 'succeeded', phase: 'migration' }, 'migration job succeeded');
}

main().catch(() => {
  logger.error({ outcome: 'failed', phase: 'migration' }, 'migration job failed');
  process.exitCode = 1;
});
