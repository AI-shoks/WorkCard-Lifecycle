import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

import * as audit from '../apps/api/src/audit-event.js';
import { demoPassport } from '../apps/api/src/demo-fixtures.js';
import { testApi } from './api.js';
import {
  businessSnapshot,
  isolatedDatabase,
  referenceFixtures,
  type TestDatabase,
} from './database.js';

let db: TestDatabase;
let api: Awaited<ReturnType<typeof testApi>>;
beforeAll(async () => {
  db = await isolatedDatabase('audit_invariants');
  await referenceFixtures(db);
  api = await testApi(db);
});
afterAll(async () => {
  await api?.app.close();
  await db?.dispose();
});

async function createdBatch() {
  const response = await api.post('PLANNER', '/production-batches', {
    commandId: randomUUID(),
    productionPassportId: demoPassport.id,
    quantity: 112,
  });
  expect(response.statusCode).toBe(201);
  return response.json().batch.id as string;
}

async function rejectedRelease(batchId: string) {
  const before = await businessSnapshot(db);
  const response = await api.post('PLANNER', `/production-batches/${batchId}/release`, {
    commandId: randomUUID(),
    expectedBatchVersion: 1,
  });
  expect(response.statusCode).toBe(500);
  expect(response.json()).toMatchObject({ code: 'INTERNAL_ERROR' });
  expect(await businessSnapshot(db)).toEqual(before);
}

it.each(['payload', 'event version', 'missing aggregate'] as const)(
  'invalid %s rolls back a 250-card release before any success receipt',
  async (fault) => {
    const batchId = await createdBatch();
    const validate: typeof audit.assertValidAuditInsert = audit.assertValidAuditInsert;
    // Simulate a producer regression at the real validation boundary. The real
    // validator, version query, command executor and PostgreSQL still execute.
    const spy = vi.spyOn(audit, 'assertValidAuditInsert').mockImplementationOnce((event) => {
      validate(event);
      if (fault === 'payload') Object.assign(event, { data: { batchId } });
      if (fault === 'event version') event.aggregateVersion += 1;
      if (fault === 'missing aggregate') {
        const absentId = randomUUID();
        Object.assign(event, { aggregateId: absentId, data: { ...event.data, batchId: absentId } });
      }
      validate(event);
    });
    try {
      await rejectedRelease(batchId);
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  },
);

it.each(['version increment', 'stored version', 'suppressed event'] as const)(
  '%s invariant failure rolls back business rows, versions, events and receipt',
  async (fault) => {
    const batchId = await createdBatch();
    const table = fault === 'suppressed event' ? 'audit_events' : 'production_batches';
    const timing = fault === 'stored version' ? 'AFTER' : 'BEFORE';
    const action = fault === 'suppressed event' ? 'INSERT' : 'UPDATE';
    const triggerBody =
      fault === 'version increment'
        ? 'NEW.version := NEW.version + 1; RETURN NEW;'
        : fault === 'stored version'
          ? `IF pg_trigger_depth() = 1 THEN
             UPDATE production_batches SET version = version + 1 WHERE id = NEW.id;
           END IF; RETURN NEW;`
          : "IF NEW.event_type = 'WorkCardReleased' THEN RETURN NULL; END IF; RETURN NEW;";
    await db.owner.query(
      `CREATE FUNCTION fa_audit_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN ${triggerBody} END; $$`,
    );
    await db.owner.query(
      `CREATE TRIGGER fa_audit_fault ${timing} ${action} ON ${table} FOR EACH ROW EXECUTE FUNCTION fa_audit_fault()`,
    );
    try {
      await rejectedRelease(batchId);
    } finally {
      await db.owner.query(`DROP TRIGGER fa_audit_fault ON ${table}`);
      await db.owner.query('DROP FUNCTION fa_audit_fault()');
    }
    const commandId = randomUUID();
    const body = { commandId, expectedBatchVersion: 1 };
    const success = await api.post('PLANNER', `/production-batches/${batchId}/release`, body);
    expect(success.statusCode).toBe(200);
    expect(success.json()).toMatchObject({ setCount: 3, actualCardCount: 250, batchVersion: 2 });
    const totals = await db.owner.query(
      `SELECT r.event_count, COUNT(e.id)::integer AS actual
       FROM command_receipts r JOIN audit_events e USING (command_id)
       WHERE r.command_id = $1 GROUP BY r.event_count`,
      [commandId],
    );
    expect(totals.rows).toEqual([{ event_count: 254, actual: 254 }]);
    const release = await db.owner.query<{
      payload: { workCardSetIds: string[]; setCount: number };
    }>(
      "SELECT payload FROM audit_events WHERE command_id = $1 AND event_type = 'ProductionBatchReleased'",
      [commandId],
    );
    const sets = await db.owner.query<{ id: string }>(
      'SELECT id FROM work_card_sets WHERE batch_id = $1 ORDER BY id',
      [batchId],
    );
    expect(release.rows[0]!.payload.workCardSetIds.toSorted()).toEqual(
      sets.rows.map((set) => set.id),
    );
    expect(release.rows[0]!.payload.setCount).toBe(3);
    const committed = await businessSnapshot(db);
    const replay = await api.post('PLANNER', `/production-batches/${batchId}/release`, body);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(success.json());
    expect(await businessSnapshot(db)).toEqual(committed);
  },
);
