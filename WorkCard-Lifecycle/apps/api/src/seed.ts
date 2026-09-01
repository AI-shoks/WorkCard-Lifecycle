import 'dotenv/config';

import assert from 'node:assert/strict';

import { Client } from 'pg';

import { loadMigrationConfig } from './config.js';
import { demoOperations, demoPassport, demoUsers } from './demo-fixtures.js';

async function main(): Promise<void> {
  const config = loadMigrationConfig();
  const client = new Client({ connectionString: config.migrationDatabaseUrl });

  await client.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');

    for (const user of demoUsers) {
      await client.query(
        `INSERT INTO demo_users(id, username, display_name, role_code)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO NOTHING`,
        [user.id, user.username, user.displayName, user.roleCode],
      );
    }

    await client.query(
      `INSERT INTO production_passports(id, product_code, product_name, planned_quantity)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO NOTHING`,
      [
        demoPassport.id,
        demoPassport.productCode,
        demoPassport.productName,
        demoPassport.plannedQuantity,
      ],
    );

    for (const operation of demoOperations) {
      await client.query(
        `INSERT INTO operation_plans(
           id, passport_id, operation_number, operation_name, planned_card_count, norm_hours
         ) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO NOTHING`,
        [
          operation.id,
          demoPassport.id,
          operation.operationNumber,
          operation.operationName,
          operation.plannedCardCount,
          operation.normHours,
        ],
      );
    }

    const storedUsers = await client.query<{
      display_name: string;
      id: string;
      role_code: string;
      username: string;
    }>(
      `SELECT id, username, display_name, role_code
       FROM demo_users
       WHERE id = ANY($1::uuid[])
       ORDER BY id`,
      [demoUsers.map((user) => user.id)],
    );
    assert.deepEqual(
      storedUsers.rows,
      demoUsers.map((user) => ({
        id: user.id,
        username: user.username,
        display_name: user.displayName,
        role_code: user.roleCode,
      })),
      'Существующие demo users отличаются от канонического seed.',
    );

    const storedPassport = await client.query<{
      id: string;
      planned_quantity: number;
      product_code: string;
      product_name: string;
    }>(
      `SELECT id, product_code, product_name, planned_quantity
       FROM production_passports WHERE id = $1`,
      [demoPassport.id],
    );
    assert.deepEqual(
      storedPassport.rows[0],
      {
        id: demoPassport.id,
        product_code: demoPassport.productCode,
        product_name: demoPassport.productName,
        planned_quantity: demoPassport.plannedQuantity,
      },
      'Существующий производственный паспорт отличается от канонического seed.',
    );

    const storedOperations = await client.query<{
      id: string;
      norm_hours: string;
      operation_name: string;
      operation_number: number;
      planned_card_count: number;
    }>(
      `SELECT id, operation_number, operation_name, planned_card_count,
              trim(trailing '0' FROM norm_hours::text) AS norm_hours
       FROM operation_plans
       WHERE passport_id = $1
       ORDER BY operation_number`,
      [demoPassport.id],
    );
    assert.deepEqual(
      storedOperations.rows,
      demoOperations.map((operation) => ({
        id: operation.id,
        operation_number: operation.operationNumber,
        operation_name: operation.operationName,
        planned_card_count: operation.plannedCardCount,
        norm_hours: operation.normHours.replace(/0+$/, '').replace(/\.$/, ''),
      })),
      'Существующий состав операций отличается от канонического seed.',
    );

    await client.query('COMMIT');
    console.info('Детерминированные синтетические demo-данные готовы.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Неизвестная ошибка seed.';
  console.error(message);
  process.exitCode = 1;
});
