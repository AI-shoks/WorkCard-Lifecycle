import 'dotenv/config';

import assert from 'node:assert/strict';

import { Client } from 'pg';

import { loadVerificationConfig } from './config.js';
import { demoOperations, demoPassport, demoUsers } from './demo-fixtures.js';

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
  assert.equal(context.rows[0]?.migration_version, 1, 'Ожидается первая версия схемы.');

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

async function main(): Promise<void> {
  const config = loadVerificationConfig();
  const client = new Client({ connectionString: config.databaseUrl });

  await client.connect();
  try {
    await verifyReadModel(client, config.appDatabaseUser);
    await verifyReadOnlyRole(client);
    console.info('Схема, синтетические данные и права runtime-роли проверены.');
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Неизвестная ошибка проверки БД.';
  console.error(message);
  process.exitCode = 1;
});
