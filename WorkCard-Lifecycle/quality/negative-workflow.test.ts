import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { demoPassport, demoUsers } from '../apps/api/src/demo-fixtures.js';
import { testApi } from './api.js';
import {
  businessSnapshot,
  isolatedDatabase,
  referenceFixtures,
  type TestDatabase,
} from './database.js';

let db: TestDatabase;
let api: Awaited<ReturnType<typeof testApi>>;
const assigneeId = demoUsers.find((user) => user.roleCode === 'WORKER')!.id;

beforeAll(async () => {
  db = await isolatedDatabase('negative_workflow');
  await referenceFixtures(db, true);
  // Three cards leave two fresh serial candidates after first-article acceptance.
  await db.owner.query('UPDATE operation_plans SET planned_card_count = 3');
  api = await testApi(db);
});

afterAll(async () => {
  await api?.app.close();
  await db?.dispose();
});

async function succeed(role: string, path: string, body: object) {
  const response = await api.post(role, path, { ...body, commandId: randomUUID() });
  expect([200, 201]).toContain(response.statusCode);
  return response.json();
}

async function rejectUnchanged(
  role: string,
  path: string,
  body: object,
  status: number,
  code: string,
) {
  const before = await businessSnapshot(db);
  const response = await api.post(role, path, { ...body, commandId: randomUUID() });
  expect(response.statusCode).toBe(status);
  expect(response.json()).toMatchObject({ code });
  // Includes complete rows and versions of all roots, immutable results, events and receipts.
  expect(await businessSnapshot(db)).toEqual(before);
  return response.json();
}

async function stale(
  role: string,
  path: string,
  body: object,
  resourceType: string,
  resourceId: string,
  expectedVersion: number,
  actualVersion: number,
) {
  const problem = await rejectUnchanged(role, path, body, 409, 'VERSION_CONFLICT');
  expect(problem.conflicts).toEqual([{ resourceType, resourceId, expectedVersion, actualVersion }]);
}

async function releasedBatch(checkReleaseVersion = false) {
  const created = await succeed('PLANNER', '/production-batches', {
    productionPassportId: demoPassport.id,
    quantity: 112,
  });
  const batchId = created.batch.id as string;
  if (checkReleaseVersion) {
    await stale(
      'PLANNER',
      `/production-batches/${batchId}/release`,
      { expectedBatchVersion: 2 },
      'productionBatch',
      batchId,
      2,
      1,
    );
  }
  await succeed('PLANNER', `/production-batches/${batchId}/release`, {
    expectedBatchVersion: 1,
  });
  const sets = await db.owner.query<{ id: string; cards: string[] }>(
    `SELECT s.id, array_agg(c.id ORDER BY c.id) AS cards
     FROM work_card_sets s JOIN work_cards c ON c.work_card_set_id = s.id
     WHERE s.batch_id = $1 GROUP BY s.id ORDER BY s.id`,
    [batchId],
  );
  expect(sets.rows).toHaveLength(3);
  for (const set of sets.rows) expect(set.cards).toHaveLength(3);
  return { batchId, sets: sets.rows };
}

const assignment = (cards: string[], purpose = 'SERIAL', expectedSetVersion = 3) => ({
  assigneeId,
  purpose,
  expectedSetVersion,
  cards: cards.map((workCardId) => ({ workCardId, expectedVersion: 1 })),
});

async function acceptFirstArticle(setId: string, cardId: string, checkVersions = false) {
  await succeed(
    'MASTER',
    `/work-card-sets/${setId}/assignments`,
    assignment([cardId], 'FIRST_ARTICLE', 1),
  );
  for (const [action, version] of [
    ['start', 2],
    ['complete', 3],
  ] as const) {
    if (checkVersions) {
      await stale(
        'MASTER',
        `/work-cards/${cardId}/${action}`,
        { expectedCardVersion: version - 1 },
        'workCard',
        cardId,
        version - 1,
        version,
      );
    }
    await succeed('MASTER', `/work-cards/${cardId}/${action}`, {
      expectedCardVersion: version,
    });
  }
  if (checkVersions) {
    await stale(
      'QUALITY_CONTROLLER',
      `/work-card-sets/${setId}/first-article-acceptance`,
      { expectedSetVersion: 1, expectedCardVersion: 4 },
      'workCardSet',
      setId,
      1,
      2,
    );
    await stale(
      'QUALITY_CONTROLLER',
      `/work-card-sets/${setId}/first-article-acceptance`,
      { expectedSetVersion: 2, expectedCardVersion: 3 },
      'workCard',
      cardId,
      3,
      4,
    );
  }
  await succeed('QUALITY_CONTROLLER', `/work-card-sets/${setId}/first-article-acceptance`, {
    expectedSetVersion: 2,
    expectedCardVersion: 4,
  });
}

async function readyBatch(checkVersions = false) {
  const fixture = await releasedBatch(checkVersions);
  for (const [setIndex, set] of fixture.sets.entries()) {
    const checkThisSet = checkVersions && setIndex === 0;
    await acceptFirstArticle(set.id, set.cards[0]!, checkThisSet);
    await succeed(
      'MASTER',
      `/work-card-sets/${set.id}/assignments`,
      assignment(set.cards.slice(1)),
    );
    for (const [cardIndex, cardId] of set.cards.slice(1).entries()) {
      await succeed('MASTER', `/work-cards/${cardId}/start`, { expectedCardVersion: 2 });
      await succeed('MASTER', `/work-cards/${cardId}/complete`, { expectedCardVersion: 3 });
      if (checkThisSet && cardIndex === 0) {
        await stale(
          'QUALITY_CONTROLLER',
          `/work-cards/${cardId}/quality-confirmation`,
          { expectedCardVersion: 3 },
          'workCard',
          cardId,
          3,
          4,
        );
      }
      await succeed('QUALITY_CONTROLLER', `/work-cards/${cardId}/quality-confirmation`, {
        expectedCardVersion: 4,
      });
    }
  }
  return fixture;
}

it('AC-ASG-002: invalid selections and mixed current/conflicting cards reject the whole assignment', async () => {
  const { sets } = await releasedBatch();
  const set = sets[0]!;
  const path = `/work-card-sets/${set.id}/assignments`;
  const [first, fresh, otherFresh] = set.cards as [string, string, string];
  const initial = assignment([first], 'FIRST_ARTICLE', 1);
  for (const [body, status, code] of [
    [{ ...initial, cards: [] }, 400, 'INVALID_REQUEST'],
    [{ ...initial, cards: [...initial.cards, ...initial.cards] }, 422, 'DUPLICATE_WORK_CARD'],
    [assignment([first, sets[1]!.cards[0]!], 'FIRST_ARTICLE', 1), 422, 'MIXED_WORK_CARD_SET'],
    [{ ...initial, assigneeId: randomUUID() }, 422, 'INVALID_ASSIGNEE'],
    [
      { ...initial, assigneeId: demoUsers.find((user) => user.roleCode === 'MASTER')!.id },
      422,
      'INVALID_ASSIGNEE',
    ],
    [assignment([first, fresh], 'FIRST_ARTICLE', 1), 422, 'INVALID_FIRST_ARTICLE_SELECTION'],
    [assignment([first, fresh], 'SERIAL', 1), 409, 'GATE_CLOSED'],
    [assignment([first, randomUUID()], 'FIRST_ARTICLE', 1), 404, 'RESOURCE_NOT_FOUND'],
  ] as const) {
    await rejectUnchanged('MASTER', path, body, status, code);
  }

  await acceptFirstArticle(set.id, first);
  await stale(
    'MASTER',
    path,
    assignment([fresh, otherFresh], 'SERIAL', 2),
    'workCardSet',
    set.id,
    2,
    3,
  );
  await succeed('MASTER', path, assignment([otherFresh]));
  // One current RELEASED card plus a stale already-assigned card must not partly assign.
  await stale('MASTER', path, assignment([fresh, otherFresh]), 'workCard', otherFresh, 1, 2);
  await rejectUnchanged(
    'MASTER',
    path,
    {
      ...assignment([fresh]),
      cards: [
        { workCardId: fresh, expectedVersion: 1 },
        { workCardId: otherFresh, expectedVersion: 2 },
      ],
    },
    409,
    'STATE_CONFLICT',
  );
});

it('AC-LIF-005: CLOSED cards and accepted first article remain terminal at current versions', async () => {
  const { sets } = await readyBatch();
  const set = sets[0]!;
  for (const cardId of set.cards.slice(0, 2)) {
    for (const [role, action] of [
      ['MASTER', 'start'],
      ['MASTER', 'complete'],
      ['QUALITY_CONTROLLER', 'quality-confirmation'],
    ]) {
      await rejectUnchanged(
        role!,
        `/work-cards/${cardId}/${action}`,
        { expectedCardVersion: 5 },
        409,
        'STATE_CONFLICT',
      );
    }
  }
  await rejectUnchanged(
    'QUALITY_CONTROLLER',
    `/work-card-sets/${set.id}/first-article-acceptance`,
    { expectedSetVersion: 3, expectedCardVersion: 5 },
    409,
    'STATE_CONFLICT',
  );
  // A separate released candidate tests the set terminal guard, not CLOSED validation.
  const freshFixture = await releasedBatch();
  const freshSet = freshFixture.sets[0]!;
  await acceptFirstArticle(freshSet.id, freshSet.cards[0]!);
  await rejectUnchanged(
    'MASTER',
    `/work-card-sets/${freshSet.id}/assignments`,
    assignment([freshSet.cards[1]!], 'FIRST_ARTICLE'),
    409,
    'STATE_CONFLICT',
  );
});

it.each(['pending gate', 'incomplete count', 'unclosed card'] as const)(
  'AC-FBA-002: %s alone prevents acceptance without any write',
  async (condition) => {
    const { batchId, sets } = await readyBatch();
    const set = sets[0]!;
    // Deliberate owner-only fixture corruption isolates each predicate. No runtime
    // bypass is added; every row still satisfies the applied SQL constraints.
    if (condition === 'pending gate') {
      await db.owner.query(
        `UPDATE work_card_sets SET gate_status = 'FIRST_ARTICLE_PENDING',
           first_article_controller_id = NULL, first_article_accepted_at = NULL WHERE id = $1`,
        [set.id],
      );
    } else if (condition === 'incomplete count') {
      await db.owner.query('DELETE FROM work_cards WHERE id = $1', [set.cards[1]]);
    } else {
      await db.owner.query(
        `UPDATE work_cards SET status = 'COMPLETED', closure_type = NULL,
           closed_at = NULL, closed_by = NULL WHERE id = $1`,
        [set.cards[1]],
      );
    }
    const predicates = await db.owner.query(
      `SELECT
         (SELECT COUNT(*)::integer FROM work_card_sets WHERE batch_id = $1) AS set_count,
         (SELECT COUNT(*)::integer FROM batch_operation_plan_snapshots WHERE batch_id = $1) AS snapshot_count,
         (SELECT COUNT(*)::integer FROM work_card_sets WHERE batch_id = $1 AND gate_status <> 'SERIAL_ALLOWED') AS pending_count,
         (SELECT COUNT(*)::integer FROM work_card_sets s WHERE batch_id = $1
            AND planned_card_count <> (SELECT COUNT(*) FROM work_cards c WHERE c.work_card_set_id = s.id)) AS incomplete_count,
         (SELECT COUNT(*)::integer FROM work_cards WHERE batch_id = $1 AND status <> 'CLOSED') AS unclosed_count`,
      [batchId],
    );
    expect(predicates.rows).toEqual([
      {
        set_count: 3,
        snapshot_count: 3,
        pending_count: condition === 'pending gate' ? 1 : 0,
        incomplete_count: condition === 'incomplete count' ? 1 : 0,
        unclosed_count: condition === 'unclosed card' ? 1 : 0,
      },
    ]);
    await rejectUnchanged(
      'QUALITY_CONTROLLER',
      `/production-batches/${batchId}/final-acceptance`,
      { expectedBatchVersion: 2 },
      409,
      'STATE_CONFLICT',
    );
  },
);

it('version conflicts reject release, lifecycle, both first-article roots, final acceptance and payroll without side effects', async () => {
  const { batchId, sets } = await readyBatch(true);
  await stale(
    'QUALITY_CONTROLLER',
    `/production-batches/${batchId}/final-acceptance`,
    { expectedBatchVersion: 1 },
    'productionBatch',
    batchId,
    1,
    2,
  );
  await succeed('QUALITY_CONTROLLER', `/production-batches/${batchId}/final-acceptance`, {
    expectedBatchVersion: 2,
  });
  await rejectUnchanged(
    'QUALITY_CONTROLLER',
    `/production-batches/${batchId}/final-acceptance`,
    { expectedBatchVersion: 3 },
    409,
    'STATE_CONFLICT',
  );
  const cardId = sets[0]!.cards[1]!;
  await stale(
    'ADMIN_AUDITOR',
    `/work-cards/${cardId}/payroll-export`,
    { expectedCardVersion: 4 },
    'workCard',
    cardId,
    4,
    5,
  );
  await succeed('ADMIN_AUDITOR', `/work-cards/${cardId}/payroll-export`, {
    expectedCardVersion: 5,
  });
  // Existing immutable payroll must not bypass version validation on a new command.
  await stale(
    'ADMIN_AUDITOR',
    `/work-cards/${cardId}/payroll-export`,
    { expectedCardVersion: 4 },
    'workCard',
    cardId,
    4,
    5,
  );
});
