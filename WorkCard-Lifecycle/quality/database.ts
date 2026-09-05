import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';

import { Client, Pool } from 'pg';

import { runMigrations } from '../apps/api/src/migration-runner.js';
import { databaseBudgets } from '../apps/api/src/runtime-protection.js';
import type { MigrationConfig } from '../apps/api/src/config.js';
import { demoOperations, demoPassport, demoUsers } from '../apps/api/src/demo-fixtures.js';

export async function isolatedDatabase(label: string, migrate = true) {
  const raw = process.env['QUALITY_OWNER_URL'];
  assert(raw, 'QUALITY_OWNER_URL is required; tests never fall back to the application database.');
  const url = new URL(raw);
  assert(
    ['localhost', '127.0.0.1', '[::1]', 'postgres', 'database'].includes(url.hostname),
    'Only an explicit local/CI PostgreSQL server is allowed.',
  );
  const name = `q9_${label}_${randomUUID().replaceAll('-', '')}`;
  assert(/^q9_[a-z_]+_[a-f0-9]{32}$/.test(name));
  const role = `${name}_app`;
  const control = new Client({ connectionString: raw });
  await control.connect();
  await control.query(`CREATE DATABASE "${name}"`);
  url.pathname = `/${name}`;
  const config: MigrationConfig = {
    migrationDatabaseUrl: url.href,
    appDatabaseUser: role,
    appDatabasePassword: randomBytes(24).toString('hex'),
  };
  const runtimeUrl = new URL(url);
  runtimeUrl.username = role;
  runtimeUrl.password = config.appDatabasePassword;
  const owner = new Pool({ connectionString: url.href });
  const runtime = new Pool({ connectionString: runtimeUrl.href, ...databaseBudgets });
  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    await Promise.all([owner.end(), runtime.end()]);
    try {
      // Exact identifiers are generated and owned by this invocation, never supplied by callers.
      await control.query(`DROP DATABASE "${name}"`);
      const exists = await control.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
      if (exists.rowCount) await control.query(`DROP ROLE "${role}"`);
    } finally {
      await control.end();
    }
  };
  try {
    if (migrate) await runMigrations(config);
    return { name, config, runtimeUrl: runtimeUrl.href, owner, runtime, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}

export type TestDatabase = Awaited<ReturnType<typeof isolatedDatabase>>;

// Reference fixtures only. Batches, cards and results are created by tested commands.
export async function referenceFixtures(db: TestDatabase, compact = false) {
  for (const user of demoUsers) {
    await db.owner.query(
      'INSERT INTO demo_users(id, username, display_name, role_code) VALUES ($1,$2,$3,$4)',
      [user.id, user.username, user.displayName, user.roleCode],
    );
  }
  const plans = compact
    ? demoOperations.map((plan) => ({ ...plan, plannedCardCount: 2 }))
    : demoOperations;
  await db.owner.query(
    'INSERT INTO production_passports(id, product_code, revision, product_name, planned_quantity) VALUES ($1,$2,$3,$4,$5)',
    [
      demoPassport.id,
      demoPassport.productCode,
      demoPassport.revision,
      demoPassport.productName,
      compact ? 6 : 250,
    ],
  );
  for (const plan of plans) {
    await db.owner.query(
      'INSERT INTO operation_plans(id, passport_id, operation_number, operation_name, planned_card_count, norm_hours, scope_code) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [
        plan.id,
        demoPassport.id,
        plan.operationNumber,
        plan.operationName,
        plan.plannedCardCount,
        plan.normHours,
        plan.scopeCode,
      ],
    );
  }
}

export async function businessSnapshot(db: TestDatabase) {
  const tables = [
    'production_batches',
    'batch_operation_plan_snapshots',
    'work_card_sets',
    'work_cards',
    'final_batch_acceptances',
    'payroll_records',
    'audit_events',
    'command_receipts',
  ];
  const result: Record<string, unknown[]> = {};
  for (const table of tables) {
    const rows = await db.owner.query(
      `SELECT to_jsonb(t) AS row FROM ${table} AS t ORDER BY to_jsonb(t)::text`,
    );
    result[table] = rows.rows.map((entry: { row: unknown }) => entry.row);
  }
  return result;
}
