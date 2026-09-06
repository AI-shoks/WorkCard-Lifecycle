import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { demoPassport, demoUsers } from '../apps/api/src/demo-fixtures.js';
import {
  businessSnapshot,
  isolatedDatabase,
  referenceFixtures,
  type TestDatabase,
} from './database.js';
import { testApi } from './api.js';

let db: TestDatabase;
let api: Awaited<ReturnType<typeof testApi>>;
beforeAll(async () => {
  db = await isolatedDatabase('transactions');
  await referenceFixtures(db, true);
  api = await testApi(db);
});
afterAll(async () => {
  await api?.app.close();
  await db?.dispose();
});

// The trigger executes inside the real PostgreSQL transaction, after business writes.
async function faultThenRetry(role: string, path: string, body: object, table = 'audit_events') {
  const payload = { ...body, commandId: randomUUID() };
  const before = await businessSnapshot(db);
  await db.owner.query(
    `CREATE FUNCTION q9_fail_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'quality injected failure' USING ERRCODE = 'P0001'; END; $$`,
  );
  await db.owner.query(
    `CREATE TRIGGER q9_fail_write BEFORE ${table === 'command_receipts' ? 'UPDATE' : 'INSERT'} ON ${table} FOR EACH ROW EXECUTE FUNCTION q9_fail_write()`,
  );
  try {
    const failed = await api.post(role, path, payload);
    expect(failed.statusCode).toBe(500);
    expect(failed.json()).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(failed.body).not.toContain('quality injected');
    expect(await businessSnapshot(db)).toEqual(before);
  } finally {
    await db.owner.query(`DROP TRIGGER q9_fail_write ON ${table}`);
    await db.owner.query('DROP FUNCTION q9_fail_write()');
  }
  const success = await api.post(role, path, payload);
  expect([200, 201]).toContain(success.statusCode);
  const committed = await businessSnapshot(db);
  const replay = await api.post(role, path, payload);
  expect(replay.statusCode).toBe(200);
  expect(replay.json()).toEqual(success.json());
  expect(await businessSnapshot(db)).toEqual(committed);
  const receipt = await db.owner.query(
    'SELECT state, event_count FROM command_receipts WHERE command_id = $1',
    [payload.commandId],
  );
  expect(receipt.rows).toEqual([{ state: 'SUCCEEDED', event_count: expect.any(Number) }]);
  return success.json();
}

it('audit insert failure rolls back every command, all roots, immutable results, events and receipts; same command can then succeed exactly once', async () => {
  const created = await faultThenRetry('PLANNER', '/production-batches', {
    productionPassportId: demoPassport.id,
    quantity: 112,
  });
  const batchId: string = created.batch.id;
  await faultThenRetry('PLANNER', `/production-batches/${batchId}/release`, {
    expectedBatchVersion: 1,
  });
  const batch = (await api.get('MASTER', `/production-batches/${batchId}`)).json();
  let lastCardId = '';
  for (const set of batch.sets as { id: string }[]) {
    const cards = (await api.get('MASTER', `/work-card-sets/${set.id}/work-cards`)).json()
      .items as { id: string }[];
    for (const [index, card] of cards.entries()) {
      await faultThenRetry('MASTER', `/work-card-sets/${set.id}/assignments`, {
        purpose: index === 0 ? 'FIRST_ARTICLE' : 'SERIAL',
        assigneeId: demoUsers[2].id,
        expectedSetVersion: index === 0 ? 1 : 3,
        cards: [{ workCardId: card.id, expectedVersion: 1 }],
      });
      await faultThenRetry('MASTER', `/work-cards/${card.id}/start`, { expectedCardVersion: 2 });
      await faultThenRetry('MASTER', `/work-cards/${card.id}/complete`, { expectedCardVersion: 3 });
      if (index === 0)
        await faultThenRetry(
          'QUALITY_CONTROLLER',
          `/work-card-sets/${set.id}/first-article-acceptance`,
          { expectedCardVersion: 4, expectedSetVersion: 2 },
        );
      else
        await faultThenRetry('QUALITY_CONTROLLER', `/work-cards/${card.id}/quality-confirmation`, {
          expectedCardVersion: 4,
        });
      lastCardId = card.id;
    }
  }
  await faultThenRetry('QUALITY_CONTROLLER', `/production-batches/${batchId}/final-acceptance`, {
    expectedBatchVersion: 2,
  });
  await faultThenRetry('ADMIN_AUDITOR', `/work-cards/${lastCardId}/payroll-export`, {
    expectedCardVersion: 5,
  });
});

it('late receipt failure and business insert failure also roll back the complete release', async () => {
  for (const table of ['command_receipts', 'work_cards']) {
    const created = await api.post('PLANNER', '/production-batches', {
      commandId: randomUUID(),
      productionPassportId: demoPassport.id,
      quantity: 112,
    });
    expect(created.statusCode).toBe(201);
    await faultThenRetry(
      'PLANNER',
      `/production-batches/${created.json().batch.id}/release`,
      { expectedBatchVersion: 1 },
      table,
    );
  }
});
