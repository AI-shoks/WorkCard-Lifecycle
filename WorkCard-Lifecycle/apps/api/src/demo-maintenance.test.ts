import { describe, expect, it, vi } from 'vitest';

import { resetDemoData } from './demo-maintenance.js';
import { demoOperations, demoUsers } from './demo-fixtures.js';

const populatedCounts = {
  audit_events: 4,
  command_receipts: 3,
  demo_sessions: 2,
  final_batch_acceptances: 1,
  payroll_records: 1,
  production_batches: 1,
  work_card_sets: 3,
  work_cards: 6,
};

const emptyCounts = Object.fromEntries(Object.keys(populatedCounts).map((key) => [key, 0]));

describe('demo maintenance', () => {
  it('очищает mutable rows в одной транзакции и сохраняет reference fixtures', async () => {
    let countRead = 0;
    const query = vi.fn(async (statement: string) => {
      if (statement.includes('AS demo_sessions')) {
        return { rows: [countRead++ === 0 ? populatedCounts : emptyCounts] };
      }
      if (statement.includes('FROM demo_users WHERE')) {
        return {
          rows: [
            {
              demo_users: demoUsers.length,
              operation_plans: demoOperations.length,
              production_passports: 1,
            },
          ],
        };
      }
      return { rows: [] };
    });

    await expect(resetDemoData({ query } as never)).resolves.toEqual({
      auditEvents: 4,
      commandReceipts: 3,
      demoSessions: 2,
      finalBatchAcceptances: 1,
      payrollRecords: 1,
      productionBatches: 1,
      workCardSets: 3,
      workCards: 6,
    });

    const statements = query.mock.calls.map(([statement]) => String(statement));
    expect(statements[0]).toBe('BEGIN ISOLATION LEVEL SERIALIZABLE');
    expect(statements[1]).toContain('pg_advisory_xact_lock');
    expect(statements.some((statement) => statement.includes('TRUNCATE TABLE'))).toBe(true);
    expect(statements.at(-1)).toBe('COMMIT');
    expect(statements).not.toContain('ROLLBACK');
  });

  it('откатывает транзакцию при ошибке очистки', async () => {
    const query = vi.fn(async (statement: string) => {
      if (statement.includes('AS demo_sessions')) return { rows: [populatedCounts] };
      if (statement.includes('TRUNCATE TABLE')) throw new Error('reset failed');
      return { rows: [] };
    });

    await expect(resetDemoData({ query } as never)).rejects.toThrow('reset failed');
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
    expect(query.mock.calls.some(([statement]) => statement === 'COMMIT')).toBe(false);
  });
});
