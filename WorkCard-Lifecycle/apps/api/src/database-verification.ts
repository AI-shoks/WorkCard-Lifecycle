import assert from 'node:assert/strict';

import { currentMigrationVersion, type SqlClient } from './database-gate.js';
import { assertRuntimeRoleBoundary } from './role-boundary.js';
import { verifySeedReferenceData } from './seed-data.js';
import { readMigrations } from './migration-runner.js';

/** Owner verification deliberately works while the runtime gate is closed. */
export async function verifyDatabase(client: SqlClient): Promise<void> {
  const migrations = await readMigrations();
  const history = await client.query<{ version: number; name: string; checksum: string }>(
    'SELECT version, name, checksum FROM schema_migrations ORDER BY version',
  );
  assert.deepEqual(
    history.rows,
    migrations.map(({ version, name, checksum }) => ({ version, name, checksum })),
  );
  assert.equal(history.rows.at(-1)?.version, currentMigrationVersion);
  const state = await client.query<{ runtime_role_name: string | null; generation: string }>(
    'SELECT runtime_role_name, generation::text FROM demo_maintenance_state WHERE singleton',
  );
  const runtimeRole = state.rows[0]?.runtime_role_name;
  assert(runtimeRole, 'В maintenance state не зарегистрирована runtime-роль.');
  await assertRuntimeRoleBoundary(client, runtimeRole);
  await verifySeedReferenceData(client);
  const privileges = await client.query<{
    audit_insert: boolean;
    audit_update: boolean;
    batch_update: boolean;
    final_delete: boolean;
    payroll_update: boolean;
    reference_update: boolean;
    maintenance_select: boolean;
    maintenance_write: boolean;
    schema_create: boolean;
  }>(
    `SELECT has_table_privilege($1, 'audit_events', 'INSERT') AS audit_insert,
            has_table_privilege($1, 'audit_events', 'UPDATE') AS audit_update,
            has_table_privilege($1, 'production_batches', 'UPDATE') AS batch_update,
            has_table_privilege($1, 'final_batch_acceptances', 'DELETE') AS final_delete,
            has_table_privilege($1, 'payroll_records', 'UPDATE') AS payroll_update,
            has_table_privilege($1, 'production_passports', 'UPDATE') AS reference_update,
            has_table_privilege($1, 'demo_maintenance_state', 'SELECT') AS maintenance_select,
            has_table_privilege($1, 'demo_maintenance_state', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS maintenance_write,
            has_schema_privilege($1, 'public', 'CREATE') AS schema_create`,
    [runtimeRole],
  );
  assert.deepEqual(privileges.rows[0], {
    audit_insert: true,
    audit_update: false,
    batch_update: true,
    final_delete: false,
    payroll_update: false,
    reference_update: false,
    maintenance_select: true,
    maintenance_write: false,
    schema_create: false,
  });
  const precision = await client.query(
    `SELECT numeric_precision, numeric_scale FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'operation_plans' AND column_name = 'norm_hours'`,
  );
  assert.deepEqual(precision.rows[0], { numeric_precision: 8, numeric_scale: 2 });
  const forbidden = await client.query<{ count: number }>(
    `SELECT COUNT(*)::integer AS count FROM information_schema.columns
     WHERE table_schema = 'public' AND (
       (table_name = 'production_batches' AND column_name = 'norm_hours')
       OR column_name IN ('sequence_number', 'part_number'))`,
  );
  assert.equal(forbidden.rows[0]?.count, 0);
}
