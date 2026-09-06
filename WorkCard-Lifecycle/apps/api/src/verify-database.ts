import 'dotenv/config';

import assert from 'node:assert/strict';

import { Client } from 'pg';

import { loadVerificationConfig } from './config.js';
import { demoOperations, demoPassport, demoUsers } from './demo-fixtures.js';
import { createProcessLogger } from './runtime-protection.js';

const logger = createProcessLogger('verify');

function postgresErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  const code = error.code;
  return typeof code === 'string' ? code : undefined;
}

async function verifyReadModel(client: Client, expectedRole: string): Promise<void> {
  const context = await client.query<{ migration_version: number; role_name: string }>(
    `SELECT current_user AS role_name,
            (SELECT COALESCE(MAX(version), 0)::integer FROM schema_migrations) AS migration_version`,
  );
  assert.equal(context.rows[0]?.role_name, expectedRole, 'Подключение использует не runtime-роль.');
  assert.equal(context.rows[0]?.migration_version, 3, 'Ожидается третья версия схемы.');

  const users = await client.query<{ fixture_count: number; role_count: number }>(
    `SELECT COUNT(*)::integer AS fixture_count,
            COUNT(DISTINCT role_code)::integer AS role_count
     FROM demo_users WHERE id = ANY($1::uuid[]) AND enabled`,
    [demoUsers.map((user) => user.id)],
  );
  assert.equal(users.rows[0]?.fixture_count, demoUsers.length, 'Не все demo users доступны.');
  assert.equal(users.rows[0]?.role_count, 5, 'Набор demo-ролей неполон.');

  const operations = await client.query<{
    operation_count: number;
    planned_card_count: number;
  }>(
    `SELECT COUNT(*)::integer AS operation_count,
            COALESCE(SUM(planned_card_count), 0)::integer AS planned_card_count
     FROM operation_plans WHERE passport_id = $1`,
    [demoPassport.id],
  );
  assert.equal(
    operations.rows[0]?.operation_count,
    demoOperations.length,
    'Состав demo-паспорта неполон.',
  );
  assert.equal(
    operations.rows[0]?.planned_card_count,
    demoOperations.reduce((sum, operation) => sum + operation.plannedCardCount, 0),
    'Плановое число карточек demo-паспорта изменилось.',
  );
}

async function verifyReadOnlyRole(client: Client): Promise<void> {
  await client.query('BEGIN');
  try {
    await client.query(
      'UPDATE production_passports SET product_name = product_name WHERE id = $1',
      [demoPassport.id],
    );
  } catch (error) {
    await client.query('ROLLBACK');
    assert.equal(
      postgresErrorCode(error),
      '42501',
      'Запись должна быть запрещена именно политикой доступа PostgreSQL.',
    );
    return;
  }

  await client.query('ROLLBACK');
  throw new Error('Runtime-роль неожиданно получила право изменять справочные данные.');
}

async function verifyBackendSchema(client: Client): Promise<void> {
  const forbiddenColumns = await client.query<{ count: number }>(
    `SELECT COUNT(*)::integer AS count
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND (
         (table_name = 'production_batches' AND column_name = 'norm_hours')
         OR column_name IN ('sequence_number', 'part_number')
       )`,
  );
  assert.equal(
    forbiddenColumns.rows[0]?.count,
    0,
    'Схема не должна моделировать норматив партии или идентичность физической детали.',
  );

  const normPrecision = await client.query<{
    numeric_precision: number;
    numeric_scale: number;
  }>(
    `SELECT numeric_precision, numeric_scale
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'operation_plans'
       AND column_name = 'norm_hours'`,
  );
  assert.deepEqual(normPrecision.rows[0], { numeric_precision: 8, numeric_scale: 2 });

  const privileges = await client.query<{
    audit_insert: boolean;
    audit_update: boolean;
    batch_update: boolean;
    final_delete: boolean;
    payroll_update: boolean;
  }>(
    `SELECT
       has_table_privilege(current_user, 'audit_events', 'INSERT') AS audit_insert,
       has_table_privilege(current_user, 'audit_events', 'UPDATE') AS audit_update,
       has_table_privilege(current_user, 'production_batches', 'UPDATE') AS batch_update,
       has_table_privilege(current_user, 'final_batch_acceptances', 'DELETE') AS final_delete,
       has_table_privilege(current_user, 'payroll_records', 'UPDATE') AS payroll_update`,
  );
  assert.deepEqual(privileges.rows[0], {
    audit_insert: true,
    audit_update: false,
    batch_update: true,
    final_delete: false,
    payroll_update: false,
  });
}

async function main(): Promise<void> {
  logger.info({ outcome: 'started', phase: 'verification' }, 'database verification started');
  const config = loadVerificationConfig();
  const client = new Client({ connectionString: config.databaseUrl });

  await client.connect();
  try {
    await verifyReadModel(client, config.appDatabaseUser);
    await verifyReadOnlyRole(client);
    await verifyBackendSchema(client);
    logger.info({ outcome: 'succeeded', phase: 'verification' }, 'database verification succeeded');
  } finally {
    await client.end();
  }
}

main().catch(() => {
  logger.error({ outcome: 'failed', phase: 'verification' }, 'database verification failed');
  process.exitCode = 1;
});
