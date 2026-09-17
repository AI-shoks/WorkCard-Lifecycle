import assert from 'node:assert/strict';

import type { Client } from 'pg';

import { ownerMutexKey, runtimeBarrierKey, type SqlClient } from './database-gate.js';
import { resetDemoData } from './demo-maintenance.js';
import { verifyDatabase } from './database-verification.js';
import { seedReferenceData } from './seed-data.js';

export type OwnerOperation = 'bootstrap' | 'reset' | 'verify' | 'release' | 'migrate' | 'seed';

/** Stop new admissions durably, then wait for every admitted runtime transaction. */
export async function closeMaintenanceGate(client: SqlClient): Promise<void> {
  const before = await client.query<{ name: string | null }>(
    "SELECT to_regclass('demo_maintenance_state') AS name",
  );
  if (before.rows[0]?.name) {
    // This autocommit must precede the drain. A timeout, lost connection or killed
    // owner while waiting for the exclusive barrier must not admit new work.
    await client.query(
      'UPDATE demo_maintenance_state SET maintenance_requested = true WHERE singleton',
    );
  }
  await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
  try {
    await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [runtimeBarrierKey]);
    const exists = await client.query<{ name: string | null }>(
      "SELECT to_regclass('demo_maintenance_state') AS name",
    );
    if (exists.rows[0]?.name) {
      await client.query(
        'UPDATE demo_maintenance_state SET maintenance = true, generation = generation + 1 WHERE singleton',
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function openVerifiedGate(
  client: SqlClient,
  resetVerified: boolean,
  signal?: AbortSignal,
): Promise<void> {
  await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
  try {
    await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [runtimeBarrierKey]);
    signal?.throwIfAborted();
    const result = await client.query(
      `UPDATE demo_maintenance_state SET maintenance = false, maintenance_requested = false,
         last_reset_verified_at = CASE WHEN $1 THEN clock_timestamp() ELSE last_reset_verified_at END
       WHERE singleton AND maintenance
         AND ($1 OR (last_reset_verified_at > clock_timestamp() - interval '26 hours'
                     AND last_reset_verified_at <= clock_timestamp()))`,
      [resetVerified],
    );
    assert.equal(result.rowCount, 1, 'Подтверждённый reset просрочен; требуется owner reset.');
    signal?.throwIfAborted();
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

export async function runOwnerOperation(
  client: Client,
  operation: OwnerOperation,
  options: {
    migrate?: () => Promise<void>;
    signal?: AbortSignal;
    verify?: () => Promise<void>;
  } = {},
): Promise<void> {
  let mutexHeld = false;
  let gateClosed = false;
  try {
    await client.query('SELECT pg_advisory_lock($1::bigint)', [ownerMutexKey]);
    mutexHeld = true;
    // verify is intentionally read-only and never changes the reset timestamp or gate.
    if (operation === 'verify') {
      options.signal?.throwIfAborted();
      await (options.verify?.() ?? verifyDatabase(client));
      return;
    }
    await closeMaintenanceGate(client);
    gateClosed = true;
    options.signal?.throwIfAborted();
    if (operation === 'bootstrap' || operation === 'release' || operation === 'migrate') {
      assert(options.migrate, 'Для этой операции требуется конфигурация миграций.');
      await options.migrate();
      options.signal?.throwIfAborted();
    }
    if (operation === 'migrate') return; // compatibility command deliberately leaves the gate closed
    let resetVerified = operation === 'reset';
    if (operation === 'bootstrap' || operation === 'seed') {
      const previous = await client.query<{ initial: boolean }>(
        'SELECT last_reset_verified_at IS NULL AS initial FROM demo_maintenance_state WHERE singleton',
      );
      assert(previous.rows[0], 'Maintenance state отсутствует.');
      resetVerified = previous.rows[0].initial;
      if (resetVerified) {
        // An unverified recovered database must contain only the clean synthetic seed.
        const mutable = await client.query<{ empty: boolean }>(
          `SELECT NOT EXISTS (SELECT 1 FROM production_batches)
             AND NOT EXISTS (SELECT 1 FROM demo_sessions)
             AND NOT EXISTS (SELECT 1 FROM command_receipts) AS empty`,
        );
        assert(
          mutable.rows[0]?.empty,
          'Initial bootstrap допускает только чистое синтетическое демо.',
        );
      }
      await seedReferenceData(client);
    } else if (operation === 'reset') {
      await resetDemoData(client);
    }
    options.signal?.throwIfAborted();
    await (options.verify?.() ?? verifyDatabase(client));
    options.signal?.throwIfAborted();
    await openVerifiedGate(client, resetVerified, options.signal);
    // A signal received while COMMIT was in flight must also fail closed.
    options.signal?.throwIfAborted();
  } finally {
    if (gateClosed && options.signal?.aborted) await closeMaintenanceGate(client);
    if (mutexHeld) await client.query('SELECT pg_advisory_unlock($1::bigint)', [ownerMutexKey]);
  }
}
