import 'dotenv/config';

import { Client } from 'pg';

import { loadMaintenanceConfig, loadMigrationConfig } from './config.js';
import { runMigrations } from './migration-runner.js';
import { runOwnerOperation, type OwnerOperation } from './owner-operations.js';
import { createProcessLogger } from './runtime-protection.js';

export async function ownerCli(operation: OwnerOperation): Promise<void> {
  const logger = createProcessLogger(operation);
  const cancellation = new AbortController();
  const onSignal = () => cancellation.abort(new Error('Owner operation cancelled.'));
  process.once('SIGTERM', onSignal);
  process.once('SIGINT', onSignal);
  let client: Client | undefined;
  try {
    const config = loadMaintenanceConfig();
    // The CLI accepts no SQL or URL arguments. Hosted target checks happen before connection.
    const migration = ['bootstrap', 'release', 'migrate'].includes(operation)
      ? loadMigrationConfig()
      : undefined;
    client = new Client({
      connectionString: config.migrationDatabaseUrl,
      connectionTimeoutMillis: 10_000,
      statement_timeout: 120_000,
      lock_timeout: 30_000,
      idle_in_transaction_session_timeout: 120_000,
      options:
        '-c statement_timeout=120000 -c lock_timeout=30000 -c idle_in_transaction_session_timeout=120000',
    });
    client.on('error', onSignal);
    await client.connect();
    const connected = client;
    logger.info({ outcome: 'started', phase: operation }, 'owner operation started');
    await runOwnerOperation(connected, operation, {
      signal: cancellation.signal,
      ...(migration
        ? { migrate: () => runMigrations(migration, undefined, logger, connected) }
        : {}),
    });
    logger.info({ outcome: 'succeeded', phase: operation }, 'owner operation succeeded');
  } catch {
    logger.error(
      { outcome: 'failed', phase: operation },
      'owner operation failed; gate is not reopened',
    );
    process.exitCode = 1;
  } finally {
    await client?.end();
    process.removeListener('SIGTERM', onSignal);
    process.removeListener('SIGINT', onSignal);
  }
}
