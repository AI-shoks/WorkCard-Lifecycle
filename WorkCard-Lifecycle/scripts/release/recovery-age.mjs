import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Client } from 'pg';

import { recoveryDatabase } from './recovery-target.mjs';

export function assertRecoveryAge(row, phase) {
  assert(['stale', 'fresh'].includes(phase));
  assert.equal(row.database_name, recoveryDatabase);
  assert.equal(row.maintenance, false);
  assert.equal(row.maintenance_requested, false);
  assert(Number.isFinite(row.age_seconds) && row.age_seconds >= 0);
  if (phase === 'stale') assert(row.age_seconds > 26 * 60 * 60);
  else assert(row.age_seconds < 10 * 60);
  return {
    schemaVersion: 1,
    kind: 'workcard-recovery-reset-age',
    phase,
    database: recoveryDatabase,
    observedAt: row.observed_at.toISOString(),
    lastResetVerifiedAt: row.last_reset_verified_at.toISOString(),
    ageSeconds: row.age_seconds,
    maintenance: row.maintenance,
    maintenanceRequested: row.maintenance_requested,
  };
}

if (process.argv[1]?.endsWith('/recovery-age.mjs') || process.argv[1]?.endsWith('\\recovery-age.mjs')) {
  const [phase, output] = process.argv.slice(2);
  if (!['stale', 'fresh'].includes(phase) || !output || process.argv.length !== 4)
    throw new Error('Usage: recovery-age.mjs stale|fresh OUTPUT');
  let client;
  try {
    const target = new URL(process.env.MIGRATION_DATABASE_URL);
    if (
      target.pathname !== `/${recoveryDatabase}` ||
      target.hostname !== process.env.NEON_DATABASE_HOST ||
      target.username !== 'workcard_owner' ||
      target.search !== '?sslmode=verify-full' ||
      (target.port && target.port !== '5432')
    )
      throw new Error('Unexpected recovery target.');
    client = new Client({ connectionString: target.toString(), connectionTimeoutMillis: 10_000 });
    await client.connect();
    await client.query('BEGIN READ ONLY');
    const result = await client.query(`
      SELECT current_database() AS database_name, clock_timestamp() AS observed_at,
             last_reset_verified_at,
             EXTRACT(EPOCH FROM (clock_timestamp() - last_reset_verified_at))::double precision AS age_seconds,
             maintenance, maintenance_requested
      FROM demo_maintenance_state WHERE singleton
    `);
    assert.equal(result.rows.length, 1);
    const report = assertRecoveryAge(result.rows[0], phase);
    await client.query('COMMIT');
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    process.stdout.write(`Recovery ${phase} age verified: ${Math.floor(report.ageSeconds / 3600)}h.\n`);
  } catch {
    process.stderr.write(`Recovery ${phase} age verification failed; no database URL is logged.\n`);
    process.exitCode = 1;
  } finally {
    await client?.end().catch(() => {});
  }
}
