import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import process from 'node:process';
import { pathToFileURL, URL } from 'node:url';
import { Client } from 'pg';

import { recoveryDatabase } from './recovery-target.mjs';

export const compactPassportId = '20000000-0000-4000-8000-000000000002';
const canonicalPassportId = '20000000-0000-4000-8000-000000000001';
const ownerMutexKey = '7342910004';
const runtimeBarrierKey = '7342910003';
const compactPlans = [
  ['30000000-0000-4000-8000-000000000004', 10, 'Подготовительная операция', 2, 0.25, 'OP-010'],
  ['30000000-0000-4000-8000-000000000005', 20, 'Основная операция', 2, 0.5, 'OP-020'],
  ['30000000-0000-4000-8000-000000000006', 30, 'Контрольная операция', 2, 0.15, 'OP-030'],
];

export function assertCompactTarget(rawUrl, expectedHost, productionHost) {
  const target = new URL(rawUrl);
  assert(['postgres:', 'postgresql:'].includes(target.protocol));
  assert(expectedHost && productionHost);
  assert(/^ep-[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech$/.test(target.hostname));
  assert(!target.hostname.split('.')[0].includes('-pooler'));
  assert.equal(target.hostname, expectedHost);
  assert.notEqual(target.hostname, productionHost);
  assert.equal(target.username, 'workcard_owner');
  assert(target.password);
  assert.equal(target.pathname, `/${recoveryDatabase}`);
  assert.equal(target.search, '?sslmode=verify-full');
  assert.equal(target.hash, '');
  assert(!target.port || target.port === '5432');
  return target.toString();
}

async function assertCanonicalFixture(client) {
  const passport = await client.query(
    'SELECT product_code, planned_quantity FROM production_passports WHERE id = $1',
    [canonicalPassportId],
  );
  assert.deepEqual(passport.rows, [{ product_code: 'DEMO-250', planned_quantity: 250 }]);
  const plans = await client.query(
    'SELECT planned_card_count FROM operation_plans WHERE passport_id = $1 ORDER BY operation_number',
    [canonicalPassportId],
  );
  assert.deepEqual(plans.rows.map((row) => row.planned_card_count), [112, 112, 26]);
}

async function compactFixture(client) {
  const passport = await client.query(
    'SELECT product_code, product_name, revision, planned_quantity FROM production_passports WHERE id = $1',
    [compactPassportId],
  );
  const expectedPassport = {
    product_code: 'DEMO-COMPACT-6',
    product_name: 'Учебное изделие для компактной проверки',
    revision: 'A',
    planned_quantity: 6,
  };
  const plans = await client.query(
    `SELECT id, operation_number, operation_name, planned_card_count,
            norm_hours::double precision AS norm_hours, scope_code
       FROM operation_plans WHERE passport_id = $1 ORDER BY operation_number`,
    [compactPassportId],
  );
  const expectedPlans = compactPlans.map(
    ([id, operation_number, operation_name, planned_card_count, norm_hours, scope_code]) => ({
      id,
      operation_number,
      operation_name,
      planned_card_count,
      norm_hours,
      scope_code,
    }),
  );
  if (passport.rows.length === 0) {
    assert.deepEqual(plans.rows, []);
    return false;
  }
  assert.deepEqual(passport.rows, [expectedPassport]);
  assert.deepEqual(plans.rows, expectedPlans);
  return true;
}

export async function runCompactFixture(client, phase) {
  assert(['prepare', 'cleanup'].includes(phase));
  await client.query('SELECT pg_advisory_lock($1::bigint)', [ownerMutexKey]);
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    try {
      await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [runtimeBarrierKey]);
      const state = await client.query(
        `SELECT current_database() AS database_name,
                maintenance, maintenance_requested, last_reset_verified_at
           FROM demo_maintenance_state WHERE singleton`,
      );
      assert.equal(state.rows.length, 1);
      assert.equal(state.rows[0].database_name, recoveryDatabase);
      assert.equal(state.rows[0].maintenance, false);
      assert.equal(state.rows[0].maintenance_requested, false);
      assert(state.rows[0].last_reset_verified_at instanceof Date);
      const batches = await client.query('SELECT COUNT(*)::integer AS count FROM production_batches');
      assert.equal(batches.rows[0]?.count, 0);
      await assertCanonicalFixture(client);
      const exists = await compactFixture(client);
      if (phase === 'prepare') {
        if (!exists) {
          await client.query(
            `INSERT INTO production_passports
               (id, product_code, revision, product_name, planned_quantity)
             VALUES ($1, $2, $3, $4, $5)`,
            [
              compactPassportId,
              'DEMO-COMPACT-6',
              'A',
              'Учебное изделие для компактной проверки',
              6,
            ],
          );
          for (const [id, number, name, count, norm, scope] of compactPlans) {
            await client.query(
              `INSERT INTO operation_plans
                 (id, passport_id, operation_number, operation_name,
                  planned_card_count, norm_hours, scope_code)
               VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [id, compactPassportId, number, name, count, norm, scope],
            );
          }
        }
        assert.equal(await compactFixture(client), true);
      } else if (exists) {
        const deletedPlans = await client.query(
          'DELETE FROM operation_plans WHERE passport_id = $1 RETURNING id',
          [compactPassportId],
        );
        assert.equal(deletedPlans.rowCount, 3);
        const deletedPassport = await client.query(
          'DELETE FROM production_passports WHERE id = $1 RETURNING id',
          [compactPassportId],
        );
        assert.equal(deletedPassport.rowCount, 1);
        assert.equal(await compactFixture(client), false);
      }
      await assertCanonicalFixture(client);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1::bigint)', [ownerMutexKey]);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [phase, output] = process.argv.slice(2);
  if (!['prepare', 'cleanup'].includes(phase) || process.argv.length !== (phase === 'cleanup' ? 4 : 3))
    throw new Error('Usage: recovery-compact-fixture.mjs prepare | cleanup OUTPUT');
  let client;
  try {
    const target = assertCompactTarget(
      process.env.MIGRATION_DATABASE_URL,
      process.env.NEON_DATABASE_HOST,
      process.env.PRODUCTION_NEON_HOST,
    );
    client = new Client({ connectionString: target, connectionTimeoutMillis: 10_000 });
    await client.connect();
    await runCompactFixture(client, phase);
    if (phase === 'cleanup') {
      const report = {
        schemaVersion: 1,
        kind: 'workcard-recovery-compact-cleanup',
        database: recoveryDatabase,
        passportId: compactPassportId,
        status: 'passed',
        observedAt: new Date().toISOString(),
      };
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    }
    process.stdout.write(`Recovery compact fixture ${phase} passed.\n`);
  } catch {
    process.stderr.write(`Recovery compact fixture ${phase} failed; target details redacted.\n`);
    process.exitCode = 1;
  } finally {
    await client?.end().catch(() => {});
  }
}
