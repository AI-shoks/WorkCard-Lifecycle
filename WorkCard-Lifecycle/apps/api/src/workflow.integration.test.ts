import { randomUUID } from 'node:crypto';

import type {
  AssignmentResponse,
  CreateBatchResponse,
  DemoSessionResponse,
  FinalBatchAcceptanceResponse,
  FirstArticleAcceptanceResponse,
  PayrollExportResponse,
  PayrollRecord,
  ProductionBatchDetail,
  ReleaseWorkCardsResponse,
  WorkCard,
  WorkCardCommandResponse,
} from '@work-card/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import { resetDemoData } from './demo-maintenance.js';
import { demoPassport, demoUsers } from './demo-fixtures.js';
import type { ReadinessService } from './readiness.js';

const integrationDatabaseUrl = process.env['INTEGRATION_DATABASE_URL'];
const integrationOwnerDatabaseUrl = process.env['INTEGRATION_MIGRATION_DATABASE_URL'];
const integrationEnabled = Boolean(integrationDatabaseUrl && integrationOwnerDatabaseUrl);
const appOrigin = 'http://integration.test';

type Session = {
  cookie: string;
  csrfToken: string;
};

function fixtureUser(roleCode: string) {
  const user = demoUsers.find((candidate) => candidate.roleCode === roleCode);
  if (!user) throw new Error(`Demo user ${roleCode} не найден.`);
  return user;
}

describe.skipIf(!integrationEnabled).sequential('backend vertical slice', () => {
  const runtimePool = new Pool({ connectionString: integrationDatabaseUrl });
  const ownerPool = new Pool({ connectionString: integrationOwnerDatabaseUrl });
  const readiness: ReadinessService = {
    check: async () => ({ database: 'up', migrationVersion: 3 }),
  };
  let app: Awaited<ReturnType<typeof buildApp>>;
  let planner: Session;
  let master: Session;
  let worker: Session;
  let quality: Session;
  let auditor: Session;
  let batchId = '';
  let releaseCorrelationId = '';
  let firstSetId = '';
  let firstArticleCardId = '';
  let serialCardId = '';
  let serialCardVersion = 0;

  const createSession = async (demoUserId: string): Promise<Session> => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/demo-session',
      headers: { origin: appOrigin },
      payload: { demoUserId },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json<DemoSessionResponse>();
    const setCookie = response.headers['set-cookie'];
    const cookieValue = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    if (!cookieValue) throw new Error('Demo session cookie не установлен.');
    return { cookie: cookieValue.split(';')[0] ?? cookieValue, csrfToken: body.csrfToken };
  };

  const mutationHeaders = (session: Session) => ({
    cookie: session.cookie,
    origin: appOrigin,
    'x-csrf-token': session.csrfToken,
  });

  const runWorkCardCommand = async (
    session: Session,
    workCardId: string,
    action: 'complete' | 'quality-confirmation' | 'start',
    expectedCardVersion: number,
  ): Promise<WorkCardCommandResponse> => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/work-cards/${workCardId}/${action}`,
      headers: mutationHeaders(session),
      payload: { commandId: randomUUID(), expectedCardVersion },
    });
    expect(response.statusCode).toBe(200);
    return response.json<WorkCardCommandResponse>();
  };

  beforeAll(async () => {
    app = await buildApp({
      appVersion: 'integration',
      pool: runtimePool,
      readiness,
      security: {
        allowedOrigin: appOrigin,
        cookieSecure: false,
        signingSecret: 'integration-test-session-signing-secret',
      },
    });
    planner = await createSession(fixtureUser('PLANNER').id);
    master = await createSession(fixtureUser('MASTER').id);
    worker = await createSession(fixtureUser('WORKER').id);
    quality = await createSession(fixtureUser('QUALITY_CONTROLLER').id);
    auditor = await createSession(fixtureUser('ADMIN_AUDITOR').id);
  });

  afterAll(async () => {
    await app.close();
    await Promise.all([runtimePool.end(), ownerPool.end()]);
  });

  it('T-API-SECURITY-ORDER: выполняет session, role и Origin/CSRF до schema validation', async () => {
    const unauthenticated = await app.inject({
      method: 'POST',
      url: '/api/v1/production-batches',
      payload: {},
    });
    expect(unauthenticated.statusCode).toBe(401);
    expect(unauthenticated.headers['content-type']).toContain('application/problem+json');
    expect(unauthenticated.json()).toMatchObject({
      type: 'https://work-card.example/problems/authentication-required',
      title: 'Требуется вход',
      status: 401,
      instance: '/api/v1/production-batches',
      code: 'AUTHENTICATION_REQUIRED',
      requestId: expect.any(String),
    });

    const forbiddenRole = await app.inject({
      method: 'POST',
      url: '/api/v1/production-batches',
      headers: mutationHeaders(worker),
      payload: {},
    });
    expect(forbiddenRole.statusCode).toBe(403);
    expect(forbiddenRole.json()).toMatchObject({ code: 'ACTION_FORBIDDEN' });

    const batchCountBefore = await ownerPool.query<{ count: number }>(
      'SELECT COUNT(*)::integer AS count FROM production_batches',
    );
    const invalidOriginCommandId = randomUUID();
    const invalidOrigin = await app.inject({
      method: 'POST',
      url: '/api/v1/production-batches',
      headers: {
        cookie: planner.cookie,
        origin: 'http://untrusted.example',
        'x-csrf-token': planner.csrfToken,
      },
      payload: {
        commandId: invalidOriginCommandId,
        productionPassportId: demoPassport.id,
        quantity: 1,
      },
    });
    expect(invalidOrigin.statusCode).toBe(403);
    expect(invalidOrigin.json()).toMatchObject({ code: 'ACTION_FORBIDDEN' });

    const invalidCsrfCommandId = randomUUID();
    const invalidCsrf = await app.inject({
      method: 'POST',
      url: '/api/v1/production-batches',
      headers: {
        cookie: planner.cookie,
        origin: appOrigin,
        'x-csrf-token': 'invalid-csrf-token',
      },
      payload: {
        commandId: invalidCsrfCommandId,
        productionPassportId: demoPassport.id,
        quantity: 1,
      },
    });
    expect(invalidCsrf.statusCode).toBe(403);
    expect(invalidCsrf.json()).toMatchObject({ code: 'ACTION_FORBIDDEN' });

    const rejectedSideEffects = await ownerPool.query<{
      event_count: number;
      receipt_count: number;
    }>(
      `SELECT
         (SELECT COUNT(*)::integer FROM command_receipts
          WHERE command_id = ANY($1::uuid[])) AS receipt_count,
         (SELECT COUNT(*)::integer FROM audit_events
          WHERE command_id = ANY($1::uuid[])) AS event_count`,
      [[invalidOriginCommandId, invalidCsrfCommandId]],
    );
    expect(rejectedSideEffects.rows[0]).toEqual({ receipt_count: 0, event_count: 0 });
    const batchCountAfter = await ownerPool.query<{ count: number }>(
      'SELECT COUNT(*)::integer AS count FROM production_batches',
    );
    expect(batchCountAfter.rows[0]?.count).toBe(batchCountBefore.rows[0]?.count);

    const invalidAuthorizedBody = await app.inject({
      method: 'POST',
      url: '/api/v1/production-batches',
      headers: mutationHeaders(planner),
      payload: {},
    });
    expect(invalidAuthorizedBody.statusCode).toBe(400);
    expect(invalidAuthorizedBody.json()).toMatchObject({ code: 'INVALID_REQUEST' });

    const unauthenticatedSensitiveQuery = await app.inject({
      method: 'GET',
      url: '/api/v1/audit-correlations/not-a-uuid',
    });
    expect(unauthenticatedSensitiveQuery.statusCode).toBe(401);

    const forbiddenSensitiveQuery = await app.inject({
      method: 'GET',
      url: '/api/v1/audit-correlations/not-a-uuid',
      headers: { cookie: planner.cookie },
    });
    expect(forbiddenSensitiveQuery.statusCode).toBe(403);

    const invalidAuthorizedSensitiveQuery = await app.inject({
      method: 'GET',
      url: '/api/v1/audit-correlations/not-a-uuid',
      headers: { cookie: auditor.cookie },
    });
    expect(invalidAuthorizedSensitiveQuery.statusCode).toBe(400);
  });

  it('T-API-BATCH/RELEASE: создаёт и атомарно выпускает 3 комплекта и 250 UUID-карточек', async () => {
    const openapiResponse = await app.inject({ method: 'GET', url: '/api/openapi.json' });
    expect(openapiResponse.statusCode).toBe(200);
    expect(openapiResponse.json<{ paths: Record<string, unknown> }>().paths).toHaveProperty(
      '/api/v1/production-batches/{batchId}/final-acceptance',
    );

    const passportResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/production-passports/${demoPassport.id}`,
      headers: { cookie: planner.cookie },
    });
    expect(passportResponse.statusCode).toBe(200);
    expect(passportResponse.json()).toMatchObject({ operationCount: 3, plannedCardCount: 250 });

    const tampered = await app.inject({
      method: 'POST',
      url: '/api/v1/production-batches',
      headers: mutationHeaders(planner),
      payload: {
        commandId: randomUUID(),
        productionPassportId: demoPassport.id,
        quantity: 112,
        role: 'ADMIN_AUDITOR',
      },
    });
    expect(tampered.statusCode).toBe(400);
    expect(tampered.json()).toMatchObject({ code: 'INVALID_REQUEST' });

    const missingCsrfCommandId = randomUUID();
    const missingCsrf = await app.inject({
      method: 'POST',
      url: '/api/v1/production-batches',
      headers: { cookie: planner.cookie, origin: appOrigin },
      payload: {
        commandId: missingCsrfCommandId,
        productionPassportId: demoPassport.id,
        quantity: 112,
      },
    });
    expect(missingCsrf.statusCode).toBe(403);
    const missingCsrfReceipt = await ownerPool.query(
      'SELECT 1 FROM command_receipts WHERE command_id = $1',
      [missingCsrfCommandId],
    );
    expect(missingCsrfReceipt.rowCount).toBe(0);

    const forbiddenCommandId = randomUUID();
    const forbidden = await app.inject({
      method: 'POST',
      url: '/api/v1/production-batches',
      headers: mutationHeaders(worker),
      payload: {
        commandId: forbiddenCommandId,
        productionPassportId: demoPassport.id,
        quantity: 112,
      },
    });
    expect(forbidden.statusCode).toBe(403);
    const forbiddenReceipt = await ownerPool.query(
      'SELECT 1 FROM command_receipts WHERE command_id = $1',
      [forbiddenCommandId],
    );
    expect(forbiddenReceipt.rowCount).toBe(0);

    const createCommandId = randomUUID();
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/production-batches',
      headers: mutationHeaders(planner),
      payload: {
        quantity: 112,
        productionPassportId: demoPassport.id,
        commandId: createCommandId,
      },
    });
    expect(created.statusCode).toBe(201);
    const createBody = created.json<CreateBatchResponse>();
    batchId = createBody.batch.id;
    expect(createBody.batch).toMatchObject({ quantity: 112, version: 1 });

    const createdReadBack = await app.inject({
      method: 'GET',
      url: `/api/v1/production-batches/${batchId}`,
      headers: { cookie: planner.cookie },
    });
    expect(createdReadBack.statusCode).toBe(200);
    expect(createdReadBack.json<ProductionBatchDetail>()).toMatchObject({
      counts: { actualCardCount: 0, plannedCardCount: 250, setCount: 0 },
      lifecycleStatus: 'CREATED',
      operationPlan: [
        { plannedCardCount: 112 },
        { plannedCardCount: 112 },
        { plannedCardCount: 26 },
      ],
      quantity: 112,
      sets: [],
      version: 1,
    });

    const replay = await app.inject({
      method: 'POST',
      url: '/api/v1/production-batches',
      headers: mutationHeaders(planner),
      payload: {
        commandId: createCommandId,
        productionPassportId: demoPassport.id,
        quantity: 112,
      },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.headers['idempotent-replay']).toBe('true');
    expect(replay.json()).toEqual(createBody);

    const released = await app.inject({
      method: 'POST',
      url: `/api/v1/production-batches/${batchId}/release`,
      headers: mutationHeaders(planner),
      payload: { commandId: randomUUID(), expectedBatchVersion: 1 },
    });
    expect(released.statusCode).toBe(200);
    const releaseBody = released.json<ReleaseWorkCardsResponse>();
    releaseCorrelationId = releaseBody.correlationId;
    expect(releaseBody).toMatchObject({
      setCount: 3,
      plannedCardCount: 250,
      actualCardCount: 250,
      batchVersion: 2,
    });

    const batchResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/production-batches/${batchId}`,
      headers: { cookie: planner.cookie },
    });
    expect(batchResponse.statusCode).toBe(200);
    const batch = batchResponse.json<{
      counts: {
        actualCardCount: number;
        closedCardCount: number;
        plannedCardCount: number;
        setCount: number;
      };
      sets: { id: string }[];
    }>();
    expect(batch.counts).toEqual({
      setCount: 3,
      plannedCardCount: 250,
      actualCardCount: 250,
      closedCardCount: 0,
    });
    expect(batch).not.toHaveProperty('normHours');
    expect(JSON.stringify(batch)).not.toContain('sequenceNumber');
    const snapshots = await ownerPool.query<{
      card_count: number;
      distinct_batch_quantities: number;
      distinct_norms: number;
      min_batch_quantity: number;
    }>(
      `SELECT COUNT(*)::integer AS card_count,
              COUNT(DISTINCT batch_quantity_snapshot)::integer AS distinct_batch_quantities,
              COUNT(DISTINCT norm_hours_snapshot)::integer AS distinct_norms,
              MIN(batch_quantity_snapshot)::integer AS min_batch_quantity
       FROM work_cards WHERE batch_id = $1`,
      [batchId],
    );
    expect(snapshots.rows[0]).toEqual({
      card_count: 250,
      distinct_batch_quantities: 1,
      distinct_norms: 3,
      min_batch_quantity: 112,
    });
    firstSetId = batch.sets[0]?.id ?? '';
    expect(firstSetId).not.toBe('');
  }, 30_000);

  it('T-API-ASSIGN/LIFECYCLE: защищает назначение, gate и lifecycle ролями и версиями', async () => {
    const cardsResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/work-card-sets/${firstSetId}/work-cards?limit=2`,
      headers: { cookie: master.cookie },
    });
    expect(cardsResponse.statusCode).toBe(200);
    const cards = cardsResponse.json<{ items: { id: string; version: number }[] }>().items;
    firstArticleCardId = cards[0]?.id ?? '';
    expect(firstArticleCardId).not.toBe('');

    const assignmentPayload = (commandId: string) => ({
      commandId,
      purpose: 'FIRST_ARTICLE',
      assigneeId: fixtureUser('WORKER').id,
      expectedSetVersion: 1,
      cards: [{ workCardId: firstArticleCardId, expectedVersion: 1 }],
    });
    const [left, right] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/api/v1/work-card-sets/${firstSetId}/assignments`,
        headers: mutationHeaders(master),
        payload: assignmentPayload(randomUUID()),
      }),
      app.inject({
        method: 'POST',
        url: `/api/v1/work-card-sets/${firstSetId}/assignments`,
        headers: mutationHeaders(master),
        payload: assignmentPayload(randomUUID()),
      }),
    ]);
    expect([left.statusCode, right.statusCode].sort()).toEqual([200, 409]);
    const assignment = (left.statusCode === 200 ? left : right).json<AssignmentResponse>();
    expect(assignment).toMatchObject({ assignedCount: 1, setVersion: 2 });

    const workerStart = await app.inject({
      method: 'POST',
      url: `/api/v1/work-cards/${firstArticleCardId}/start`,
      headers: mutationHeaders(worker),
      payload: { commandId: randomUUID(), expectedCardVersion: 2 },
    });
    expect(workerStart.statusCode).toBe(403);

    const started = await app.inject({
      method: 'POST',
      url: `/api/v1/work-cards/${firstArticleCardId}/start`,
      headers: mutationHeaders(master),
      payload: { commandId: randomUUID(), expectedCardVersion: 2 },
    });
    expect(started.statusCode).toBe(200);
    expect(started.json<WorkCardCommandResponse>().workCard.status).toBe('IN_PROGRESS');

    const completed = await app.inject({
      method: 'POST',
      url: `/api/v1/work-cards/${firstArticleCardId}/complete`,
      headers: mutationHeaders(master),
      payload: { commandId: randomUUID(), expectedCardVersion: 3 },
    });
    expect(completed.statusCode).toBe(200);
    expect(completed.json<WorkCardCommandResponse>().workCard.status).toBe('COMPLETED');

    const accepted = await app.inject({
      method: 'POST',
      url: `/api/v1/work-card-sets/${firstSetId}/first-article-acceptance`,
      headers: mutationHeaders(quality),
      payload: {
        commandId: randomUUID(),
        expectedSetVersion: 2,
        expectedCardVersion: 4,
      },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json<FirstArticleAcceptanceResponse>()).toMatchObject({
      gateStatus: 'SERIAL_ALLOWED',
      setVersion: 3,
      workCard: { status: 'CLOSED', closureType: 'FIRST_ARTICLE_ACCEPTANCE' },
    });

    const firstSerialPage = await app.inject({
      method: 'GET',
      url: `/api/v1/work-card-sets/${firstSetId}/work-cards?status=RELEASED&limit=100`,
      headers: { cookie: master.cookie },
    });
    expect(firstSerialPage.statusCode).toBe(200);
    const firstPageBody = firstSerialPage.json<{
      items: { id: string; version: number }[];
      nextCursor: string | null;
    }>();
    expect(firstPageBody.items).toHaveLength(100);
    expect(firstPageBody.nextCursor).not.toBeNull();
    const secondSerialPage = await app.inject({
      method: 'GET',
      url: `/api/v1/work-card-sets/${firstSetId}/work-cards?status=RELEASED&limit=100&cursor=${encodeURIComponent(firstPageBody.nextCursor ?? '')}`,
      headers: { cookie: master.cookie },
    });
    expect(secondSerialPage.statusCode).toBe(200);
    const secondPageBody = secondSerialPage.json<{
      items: { id: string; version: number }[];
      nextCursor: string | null;
    }>();
    expect(secondPageBody.items).toHaveLength(11);
    expect(secondPageBody.nextCursor).toBeNull();
    const serialCards = [...firstPageBody.items, ...secondPageBody.items];
    serialCardId = serialCards[0]?.id ?? '';
    expect(serialCardId).not.toBe('');
    const firstWorkerSerialCards = serialCards.slice(0, 59);
    const secondWorkerSerialCards = serialCards.slice(59);
    const workers = demoUsers.filter((user) => user.roleCode === 'WORKER');
    const secondWorker = workers[1];
    if (!secondWorker) throw new Error('В fixture отсутствует второй исполнитель.');

    const serialAssignment = await app.inject({
      method: 'POST',
      url: `/api/v1/work-card-sets/${firstSetId}/assignments`,
      headers: mutationHeaders(master),
      payload: {
        commandId: randomUUID(),
        purpose: 'SERIAL',
        assigneeId: fixtureUser('WORKER').id,
        expectedSetVersion: 3,
        cards: firstWorkerSerialCards.map((card) => ({
          workCardId: card.id,
          expectedVersion: card.version,
        })),
      },
    });
    expect(serialAssignment.statusCode).toBe(200);
    const assignedSerial = serialAssignment.json<AssignmentResponse>();
    expect(assignedSerial.assignedCount).toBe(59);
    expect(assignedSerial.setVersion).toBe(3);

    const secondSerialAssignment = await app.inject({
      method: 'POST',
      url: `/api/v1/work-card-sets/${firstSetId}/assignments`,
      headers: mutationHeaders(master),
      payload: {
        commandId: randomUUID(),
        purpose: 'SERIAL',
        assigneeId: secondWorker.id,
        expectedSetVersion: 3,
        cards: secondWorkerSerialCards.map((card) => ({
          workCardId: card.id,
          expectedVersion: card.version,
        })),
      },
    });
    expect(secondSerialAssignment.statusCode).toBe(200);
    expect(secondSerialAssignment.json<AssignmentResponse>().assignedCount).toBe(52);

    const distributionResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/work-card-sets/${firstSetId}`,
      headers: { cookie: master.cookie },
    });
    expect(distributionResponse.statusCode).toBe(200);
    const assignmentCounts = distributionResponse.json<{
      assignmentCounts: { assignee: { id: string }; count: number }[];
    }>().assignmentCounts;
    const totals = new Map<string, number>();
    for (const entry of assignmentCounts) {
      totals.set(entry.assignee.id, (totals.get(entry.assignee.id) ?? 0) + entry.count);
    }
    expect(totals.get(fixtureUser('WORKER').id)).toBe(60);
    expect(totals.get(secondWorker.id)).toBe(52);

    const workerSetResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/work-card-sets/${firstSetId}`,
      headers: { cookie: worker.cookie },
    });
    expect(workerSetResponse.statusCode).toBe(200);
    expect(
      workerSetResponse
        .json<{ assignmentCounts: { assignee: { id: string } }[] }>()
        .assignmentCounts.every((entry) => entry.assignee.id === fixtureUser('WORKER').id),
    ).toBe(true);

    const serialStarted = await app.inject({
      method: 'POST',
      url: `/api/v1/work-cards/${serialCardId}/start`,
      headers: mutationHeaders(master),
      payload: { commandId: randomUUID(), expectedCardVersion: 2 },
    });
    expect(serialStarted.statusCode).toBe(200);
    const serialCompleted = await app.inject({
      method: 'POST',
      url: `/api/v1/work-cards/${serialCardId}/complete`,
      headers: mutationHeaders(master),
      payload: { commandId: randomUUID(), expectedCardVersion: 3 },
    });
    expect(serialCompleted.statusCode).toBe(200);
    const serialClosed = await app.inject({
      method: 'POST',
      url: `/api/v1/work-cards/${serialCardId}/quality-confirmation`,
      headers: mutationHeaders(quality),
      payload: { commandId: randomUUID(), expectedCardVersion: 4 },
    });
    expect(serialClosed.statusCode).toBe(200);
    serialCardVersion = serialClosed.json<WorkCardCommandResponse>().workCard.version;
    expect(serialClosed.json<WorkCardCommandResponse>().workCard).toMatchObject({
      status: 'CLOSED',
      closureType: 'SERIAL_QUALITY_CONFIRMATION',
    });
  }, 30_000);

  it('T-API-FINAL/PAYROLL/AUDIT: защищает финальную приёмку, replay и immutable results', async () => {
    const prematureCommandId = randomUUID();
    const premature = await app.inject({
      method: 'POST',
      url: `/api/v1/production-batches/${batchId}/final-acceptance`,
      headers: mutationHeaders(quality),
      payload: { commandId: prematureCommandId, expectedBatchVersion: 2 },
    });
    expect(premature.statusCode).toBe(409);
    const prematureReceipt = await ownerPool.query(
      'SELECT 1 FROM command_receipts WHERE command_id = $1',
      [prematureCommandId],
    );
    expect(prematureReceipt.rowCount).toBe(0);

    const setRows = await ownerPool.query<{
      first_article_work_card_id: string | null;
      id: string;
    }>(
      `SELECT id, first_article_work_card_id
       FROM work_card_sets WHERE batch_id = $1 ORDER BY id`,
      [batchId],
    );
    const masterId = fixtureUser('MASTER').id;
    const workerId = fixtureUser('WORKER').id;
    const qualityId = fixtureUser('QUALITY_CONTROLLER').id;
    for (const cardSet of setRows.rows) {
      await ownerPool.query(
        `UPDATE work_cards
         SET purpose = 'SERIAL', status = 'CLOSED',
             closure_type = 'SERIAL_QUALITY_CONFIRMATION', assignee_id = $2,
             assigned_at = clock_timestamp(), started_at = clock_timestamp(),
             completed_at = clock_timestamp(), closed_at = clock_timestamp(),
             assigned_by = $3, started_by = $3, completed_by = $3, closed_by = $4,
             version = version + 1
         WHERE work_card_set_id = $1 AND status <> 'CLOSED'`,
        [cardSet.id, workerId, masterId, qualityId],
      );
      if (!cardSet.first_article_work_card_id) {
        const selected = await ownerPool.query<{ id: string }>(
          'SELECT id FROM work_cards WHERE work_card_set_id = $1 ORDER BY id LIMIT 1',
          [cardSet.id],
        );
        const selectedId = selected.rows[0]?.id;
        if (!selectedId) throw new Error('Комплект без карточек в integration fixture.');
        await ownerPool.query(
          `UPDATE work_cards
           SET purpose = 'FIRST_ARTICLE', closure_type = 'FIRST_ARTICLE_ACCEPTANCE'
           WHERE id = $1`,
          [selectedId],
        );
        await ownerPool.query(
          `UPDATE work_card_sets
           SET first_article_work_card_id = $2, gate_status = 'SERIAL_ALLOWED',
               first_article_controller_id = $3,
               first_article_accepted_at = clock_timestamp(), version = version + 1
           WHERE id = $1`,
          [cardSet.id, selectedId, qualityId],
        );
      }
    }

    const finalCommandIds = [randomUUID(), randomUUID()] as const;
    const finalResponses = await Promise.all(
      finalCommandIds.map(async (commandId) =>
        app.inject({
          method: 'POST',
          url: `/api/v1/production-batches/${batchId}/final-acceptance`,
          headers: mutationHeaders(quality),
          payload: { commandId, expectedBatchVersion: 2 },
        }),
      ),
    );
    expect(finalResponses.map((response) => response.statusCode).sort()).toEqual([201, 409]);
    const winnerIndex = finalResponses.findIndex((response) => response.statusCode === 201);
    const finalAccepted = finalResponses[winnerIndex];
    const finalCommandId = finalCommandIds[winnerIndex];
    if (!finalAccepted || !finalCommandId) throw new Error('Final acceptance winner не найден.');
    const acceptanceBody = finalAccepted.json<{
      acceptance: { id: string; resultingBatchVersion: number };
    }>();
    expect(acceptanceBody.acceptance.resultingBatchVersion).toBe(3);

    const finalReplay = await app.inject({
      method: 'POST',
      url: `/api/v1/production-batches/${batchId}/final-acceptance`,
      headers: mutationHeaders(quality),
      payload: { expectedBatchVersion: 2, commandId: finalCommandId },
    });
    expect(finalReplay.statusCode).toBe(200);
    expect(finalReplay.headers['idempotent-replay']).toBe('true');
    expect(finalReplay.json()).toEqual(finalAccepted.json());

    const payrollResponses = await Promise.all(
      [randomUUID(), randomUUID()].map(async (commandId) =>
        app.inject({
          method: 'POST',
          url: `/api/v1/work-cards/${serialCardId}/payroll-export`,
          headers: mutationHeaders(auditor),
          payload: { commandId, expectedCardVersion: serialCardVersion },
        }),
      ),
    );
    expect(payrollResponses.map((response) => response.statusCode).sort()).toEqual([200, 201]);
    const payroll = payrollResponses.find((response) => response.statusCode === 201);
    if (!payroll) throw new Error('Первый payroll export не найден.');
    const payrollBody = payroll.json<{ payrollRecord: { id: string } }>();
    const payrollReplay = await app.inject({
      method: 'POST',
      url: `/api/v1/work-cards/${serialCardId}/payroll-export`,
      headers: mutationHeaders(auditor),
      payload: { commandId: randomUUID(), expectedCardVersion: serialCardVersion },
    });
    expect(payrollReplay.statusCode).toBe(200);
    expect(payrollReplay.headers['idempotent-replay']).toBe('true');
    expect(payrollReplay.json<{ payrollRecord: { id: string } }>().payrollRecord.id).toBe(
      payrollBody.payrollRecord.id,
    );

    const audit = await app.inject({
      method: 'GET',
      url: `/api/v1/audit-correlations/${releaseCorrelationId}?limit=100`,
      headers: { cookie: auditor.cookie },
    });
    expect(audit.statusCode).toBe(200);
    expect(audit.json()).toMatchObject({ expectedEventCount: 254, totalEventCount: 254 });

    const immutableCounts = await ownerPool.query<{
      acceptance_count: number;
      final_event_count: number;
      payroll_count: number;
      payroll_event_count: number;
    }>(
      `SELECT
         (SELECT COUNT(*)::integer FROM final_batch_acceptances WHERE batch_id = $1)
           AS acceptance_count,
         (SELECT COUNT(*)::integer FROM audit_events
          WHERE aggregate_id = $1 AND event_type = 'FinalBatchAccepted')
           AS final_event_count,
         (SELECT COUNT(*)::integer FROM payroll_records WHERE work_card_id = $2)
           AS payroll_count,
         (SELECT COUNT(*)::integer FROM audit_events
          WHERE event_type = 'WorkCardExportedToPayroll'
            AND payload->>'workCardId' = $2::text)
           AS payroll_event_count`,
      [batchId, serialCardId],
    );
    expect(immutableCounts.rows[0]).toEqual({
      acceptance_count: 1,
      final_event_count: 1,
      payroll_count: 1,
      payroll_event_count: 1,
    });

    await expect(
      runtimePool.query(
        `UPDATE audit_events SET payload = payload
         WHERE correlation_id = $1`,
        [releaseCorrelationId],
      ),
    ).rejects.toMatchObject({ code: '42501' });
  }, 30_000);

  it('T-API-E2E-SMALL: проводит компактную партию через весь workflow только HTTP-командами', async () => {
    const fixturePassportId = randomUUID();
    const fixtureOperationId = randomUUID();
    const fixtureCode = `API-E2E-${fixturePassportId.slice(0, 8)}`;

    // Owner SQL создаёт только компактные reference data; lifecycle ниже меняется только через API.
    await ownerPool.query(
      `WITH inserted_passport AS (
         INSERT INTO production_passports(
           id, product_code, product_name, planned_quantity, data_provenance, revision
         ) VALUES ($1, $3, 'Компактная API fixture', 2, 'SYNTHETIC_DEMO', 'A')
         RETURNING id
       )
       INSERT INTO operation_plans(
         id, passport_id, operation_number, operation_name,
         planned_card_count, norm_hours, scope_code
       )
       SELECT $2, id, 10, 'Компактная операция', 2, 0.25, 'API-010'
       FROM inserted_passport`,
      [fixturePassportId, fixtureOperationId, fixtureCode],
    );

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/production-batches',
      headers: mutationHeaders(planner),
      payload: {
        commandId: randomUUID(),
        productionPassportId: fixturePassportId,
        quantity: 2,
      },
    });
    expect(created.statusCode).toBe(201);
    const createdBody = created.json<CreateBatchResponse>();
    const compactBatchId = createdBody.batch.id;
    expect(createdBody.batch).toMatchObject({
      lifecycleStatus: 'CREATED',
      version: 1,
      counts: { setCount: 0, plannedCardCount: 2, actualCardCount: 0, closedCardCount: 0 },
    });

    const released = await app.inject({
      method: 'POST',
      url: `/api/v1/production-batches/${compactBatchId}/release`,
      headers: mutationHeaders(planner),
      payload: { commandId: randomUUID(), expectedBatchVersion: 1 },
    });
    expect(released.statusCode).toBe(200);
    const releasedBody = released.json<ReleaseWorkCardsResponse>();
    expect(releasedBody).toMatchObject({
      setCount: 1,
      plannedCardCount: 2,
      actualCardCount: 2,
      batchVersion: 2,
    });

    const releasedBatch = await app.inject({
      method: 'GET',
      url: `/api/v1/production-batches/${compactBatchId}`,
      headers: { cookie: planner.cookie },
    });
    expect(releasedBatch.statusCode).toBe(200);
    const compactSetId = releasedBatch.json<ProductionBatchDetail>().sets[0]?.id;
    if (!compactSetId) throw new Error('API-only fixture не создала комплект карточек.');

    const releasedCards = await app.inject({
      method: 'GET',
      url: `/api/v1/work-card-sets/${compactSetId}/work-cards?limit=10`,
      headers: { cookie: master.cookie },
    });
    expect(releasedCards.statusCode).toBe(200);
    const cards = releasedCards.json<{ items: WorkCard[] }>().items;
    expect(cards).toHaveLength(2);
    const firstArticleCard = cards[0];
    const serialCard = cards[1];
    if (!firstArticleCard || !serialCard) {
      throw new Error('API-only fixture должна содержать две карточки.');
    }

    const firstArticleAssignment = await app.inject({
      method: 'POST',
      url: `/api/v1/work-card-sets/${compactSetId}/assignments`,
      headers: mutationHeaders(master),
      payload: {
        commandId: randomUUID(),
        purpose: 'FIRST_ARTICLE',
        assigneeId: fixtureUser('WORKER').id,
        expectedSetVersion: 1,
        cards: [{ workCardId: firstArticleCard.id, expectedVersion: 1 }],
      },
    });
    expect(firstArticleAssignment.statusCode).toBe(200);
    expect(firstArticleAssignment.json<AssignmentResponse>()).toMatchObject({
      assignedCount: 1,
      setVersion: 2,
    });

    const firstArticleStarted = await runWorkCardCommand(master, firstArticleCard.id, 'start', 2);
    expect(firstArticleStarted.workCard).toMatchObject({ status: 'IN_PROGRESS', version: 3 });
    const firstArticleCompleted = await runWorkCardCommand(
      master,
      firstArticleCard.id,
      'complete',
      3,
    );
    expect(firstArticleCompleted.workCard).toMatchObject({ status: 'COMPLETED', version: 4 });

    const firstArticleAccepted = await app.inject({
      method: 'POST',
      url: `/api/v1/work-card-sets/${compactSetId}/first-article-acceptance`,
      headers: mutationHeaders(quality),
      payload: {
        commandId: randomUUID(),
        expectedSetVersion: 2,
        expectedCardVersion: 4,
      },
    });
    expect(firstArticleAccepted.statusCode).toBe(200);
    expect(firstArticleAccepted.json<FirstArticleAcceptanceResponse>()).toMatchObject({
      gateStatus: 'SERIAL_ALLOWED',
      setVersion: 3,
      workCard: { status: 'CLOSED', version: 5 },
    });

    const serialAssignment = await app.inject({
      method: 'POST',
      url: `/api/v1/work-card-sets/${compactSetId}/assignments`,
      headers: mutationHeaders(master),
      payload: {
        commandId: randomUUID(),
        purpose: 'SERIAL',
        assigneeId: fixtureUser('WORKER').id,
        expectedSetVersion: 3,
        cards: [{ workCardId: serialCard.id, expectedVersion: 1 }],
      },
    });
    expect(serialAssignment.statusCode).toBe(200);
    expect(serialAssignment.json<AssignmentResponse>()).toMatchObject({
      assignedCount: 1,
      setVersion: 3,
    });

    const serialStarted = await runWorkCardCommand(master, serialCard.id, 'start', 2);
    expect(serialStarted.workCard).toMatchObject({ status: 'IN_PROGRESS', version: 3 });
    const serialCompleted = await runWorkCardCommand(master, serialCard.id, 'complete', 3);
    expect(serialCompleted.workCard).toMatchObject({ status: 'COMPLETED', version: 4 });
    const serialClosed = await runWorkCardCommand(
      quality,
      serialCard.id,
      'quality-confirmation',
      4,
    );
    expect(serialClosed.workCard).toMatchObject({
      status: 'CLOSED',
      closureType: 'SERIAL_QUALITY_CONFIRMATION',
      version: 5,
    });

    const finalAcceptance = await app.inject({
      method: 'POST',
      url: `/api/v1/production-batches/${compactBatchId}/final-acceptance`,
      headers: mutationHeaders(quality),
      payload: { commandId: randomUUID(), expectedBatchVersion: 2 },
    });
    expect(finalAcceptance.statusCode).toBe(201);
    const finalAcceptanceBody = finalAcceptance.json<FinalBatchAcceptanceResponse>();
    expect(finalAcceptanceBody).toMatchObject({
      batchLifecycleStatus: 'FINAL_ACCEPTED',
      acceptance: { batchId: compactBatchId, resultingBatchVersion: 3 },
    });

    const payrollExport = await app.inject({
      method: 'POST',
      url: `/api/v1/work-cards/${serialCard.id}/payroll-export`,
      headers: mutationHeaders(auditor),
      payload: { commandId: randomUUID(), expectedCardVersion: 5 },
    });
    expect(payrollExport.statusCode).toBe(201);
    const payrollExportBody = payrollExport.json<PayrollExportResponse>();
    expect(payrollExportBody.payrollRecord).toMatchObject({
      workCardId: serialCard.id,
      beneficiary: { id: fixtureUser('WORKER').id },
      normHoursSnapshot: '0.25',
    });

    const finalBatchReadBack = await app.inject({
      method: 'GET',
      url: `/api/v1/production-batches/${compactBatchId}`,
      headers: { cookie: auditor.cookie },
    });
    expect(finalBatchReadBack.statusCode).toBe(200);
    expect(finalBatchReadBack.json<ProductionBatchDetail>()).toMatchObject({
      lifecycleStatus: 'FINAL_ACCEPTED',
      version: 3,
      counts: { setCount: 1, plannedCardCount: 2, actualCardCount: 2, closedCardCount: 2 },
      finalAcceptance: { id: finalAcceptanceBody.acceptance.id },
    });

    const serialReadBack = await app.inject({
      method: 'GET',
      url: `/api/v1/work-cards/${serialCard.id}`,
      headers: { cookie: auditor.cookie },
    });
    expect(serialReadBack.statusCode).toBe(200);
    expect(serialReadBack.json<WorkCard>()).toMatchObject({
      id: serialCard.id,
      status: 'CLOSED',
      closureType: 'SERIAL_QUALITY_CONFIRMATION',
      version: 5,
    });

    const historyReadBack = await app.inject({
      method: 'GET',
      url: `/api/v1/work-cards/${serialCard.id}/history?limit=10`,
      headers: { cookie: auditor.cookie },
    });
    expect(historyReadBack.statusCode).toBe(200);
    expect(
      historyReadBack
        .json<{ events: { eventType: string }[] }>()
        .events.map((event) => event.eventType),
    ).toEqual([
      'WorkCardReleased',
      'WorkCardAssigned',
      'WorkCardStarted',
      'WorkCardCompleted',
      'WorkCardQualityConfirmed',
    ]);

    const releaseAuditReadBack = await app.inject({
      method: 'GET',
      url: `/api/v1/audit-correlations/${releasedBody.correlationId}?limit=10`,
      headers: { cookie: auditor.cookie },
    });
    expect(releaseAuditReadBack.statusCode).toBe(200);
    expect(releaseAuditReadBack.json()).toMatchObject({
      commandType: 'ReleaseWorkCards',
      expectedEventCount: 4,
      totalEventCount: 4,
    });

    const finalAuditReadBack = await app.inject({
      method: 'GET',
      url: `/api/v1/audit-correlations/${finalAcceptanceBody.correlationId}?limit=10`,
      headers: { cookie: auditor.cookie },
    });
    expect(finalAuditReadBack.statusCode).toBe(200);
    expect(finalAuditReadBack.json()).toMatchObject({
      commandType: 'RecordFinalBatchAcceptance',
      expectedEventCount: 1,
      totalEventCount: 1,
      events: [{ eventType: 'FinalBatchAccepted', aggregateId: compactBatchId }],
    });

    const payrollReadBack = await app.inject({
      method: 'GET',
      url: `/api/v1/work-cards/${serialCard.id}/payroll-record`,
      headers: { cookie: auditor.cookie },
    });
    expect(payrollReadBack.statusCode).toBe(200);
    expect(payrollReadBack.json<PayrollRecord>()).toEqual(payrollExportBody.payrollRecord);
  }, 30_000);

  it('T-API-DEMO-RETENTION: отклоняет новую партию на лимите и сбрасывает только изменяемые demo-данные', async () => {
    const batchCount = (
      await ownerPool.query('SELECT COUNT(*)::integer AS count FROM production_batches')
    ).rows[0].count as number;
    expect(batchCount).toBeGreaterThan(0);

    const cappedApp = await buildApp({
      appVersion: 'integration-capacity',
      demoCapacity: { maximumBatches: batchCount, maximumSessions: 500 },
      pool: runtimePool,
      readiness,
      security: {
        allowedOrigin: appOrigin,
        cookieSecure: false,
        signingSecret: 'integration-capacity-session-secret',
      },
    });
    try {
      const cappedSession = await cappedApp.inject({
        method: 'POST',
        url: '/api/v1/demo-session',
        headers: { origin: appOrigin },
        payload: { demoUserId: fixtureUser('PLANNER').id },
      });
      expect(cappedSession.statusCode).toBe(201);
      const rejected = await cappedApp.inject({
        method: 'POST',
        url: '/api/v1/production-batches',
        headers: {
          cookie: String(cappedSession.headers['set-cookie']).split(';')[0],
          origin: appOrigin,
          'x-csrf-token': cappedSession.json<DemoSessionResponse>().csrfToken,
        },
        payload: {
          commandId: randomUUID(),
          productionPassportId: demoPassport.id,
          quantity: 112,
        },
      });
      expect(rejected.statusCode).toBe(409);
      expect(rejected.json()).toMatchObject({ code: 'DEMO_CAPACITY_REACHED' });
    } finally {
      await cappedApp.close();
    }

    const resetClient = await ownerPool.connect();
    try {
      const removed = await resetDemoData(resetClient);
      expect(removed.productionBatches).toBe(batchCount);
      expect(removed.demoSessions).toBeGreaterThan(0);
    } finally {
      resetClient.release();
    }

    const remaining = await ownerPool.query<{
      batches: number;
      sessions: number;
      users: number;
    }>(
      `SELECT
         (SELECT COUNT(*)::integer FROM production_batches) AS batches,
         (SELECT COUNT(*)::integer FROM demo_sessions) AS sessions,
         (SELECT COUNT(*)::integer FROM demo_users WHERE enabled) AS users`,
    );
    expect(remaining.rows[0]).toEqual({
      batches: 0,
      sessions: 0,
      users: demoUsers.length,
    });
    expect(
      (await app.inject({ url: '/api/v1/demo-session', headers: { cookie: planner.cookie } }))
        .statusCode,
    ).toBe(401);
  });
});
