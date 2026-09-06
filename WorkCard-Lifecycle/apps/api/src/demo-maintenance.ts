import assert from 'node:assert/strict';

import type { Client } from 'pg';

import { demoOperations, demoPassport, demoUsers } from './demo-fixtures.js';

export const defaultDemoCapacity = Object.freeze({
  maximumBatches: 20,
  maximumSessions: 500,
});

export const demoMaintenanceLockKey = '7342910002';

type DemoDataCounts = {
  auditEvents: number;
  commandReceipts: number;
  demoSessions: number;
  finalBatchAcceptances: number;
  payrollRecords: number;
  productionBatches: number;
  workCardSets: number;
  workCards: number;
};

type CountRow = {
  audit_events: number;
  command_receipts: number;
  demo_sessions: number;
  final_batch_acceptances: number;
  payroll_records: number;
  production_batches: number;
  work_card_sets: number;
  work_cards: number;
};

type QueryClient = Pick<Client, 'query'>;

async function readDemoDataCounts(client: QueryClient): Promise<DemoDataCounts> {
  const result = await client.query<CountRow>(`
    SELECT
      (SELECT COUNT(*)::integer FROM demo_sessions) AS demo_sessions,
      (SELECT COUNT(*)::integer FROM production_batches) AS production_batches,
      (SELECT COUNT(*)::integer FROM work_card_sets) AS work_card_sets,
      (SELECT COUNT(*)::integer FROM work_cards) AS work_cards,
      (SELECT COUNT(*)::integer FROM command_receipts) AS command_receipts,
      (SELECT COUNT(*)::integer FROM final_batch_acceptances) AS final_batch_acceptances,
      (SELECT COUNT(*)::integer FROM payroll_records) AS payroll_records,
      (SELECT COUNT(*)::integer FROM audit_events) AS audit_events
  `);
  const row = result.rows[0];
  if (!row) throw new Error('БД не вернула счётчики demo-данных.');
  return {
    auditEvents: row.audit_events,
    commandReceipts: row.command_receipts,
    demoSessions: row.demo_sessions,
    finalBatchAcceptances: row.final_batch_acceptances,
    payrollRecords: row.payroll_records,
    productionBatches: row.production_batches,
    workCardSets: row.work_card_sets,
    workCards: row.work_cards,
  };
}

async function verifyReferenceFixtures(client: QueryClient): Promise<void> {
  const result = await client.query<{
    demo_users: number;
    operation_plans: number;
    production_passports: number;
  }>(
    `SELECT
       (SELECT COUNT(*)::integer FROM demo_users WHERE id = ANY($1::uuid[])) AS demo_users,
       (SELECT COUNT(*)::integer FROM production_passports WHERE id = $2) AS production_passports,
       (SELECT COUNT(*)::integer FROM operation_plans
        WHERE passport_id = $2 AND id = ANY($3::uuid[])) AS operation_plans`,
    [
      demoUsers.map((user) => user.id),
      demoPassport.id,
      demoOperations.map((operation) => operation.id),
    ],
  );
  assert.deepEqual(result.rows[0], {
    demo_users: demoUsers.length,
    production_passports: 1,
    operation_plans: demoOperations.length,
  });
}

export async function resetDemoData(client: QueryClient): Promise<DemoDataCounts> {
  await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  try {
    await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [demoMaintenanceLockKey]);
    const before = await readDemoDataCounts(client);
    await client.query(`
      TRUNCATE TABLE
        demo_sessions,
        audit_events,
        payroll_records,
        final_batch_acceptances,
        command_receipts,
        work_cards,
        work_card_sets,
        batch_operation_plan_snapshots,
        production_batches
    `);
    const after = await readDemoDataCounts(client);
    assert(
      Object.values(after).every((count) => count === 0),
      'После reset в БД остались изменяемые demo-данные.',
    );
    await verifyReferenceFixtures(client);
    await client.query('COMMIT');
    return before;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
