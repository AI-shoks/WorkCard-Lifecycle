import { createHash, randomUUID } from 'node:crypto';

import type {
  AcceptFirstArticleBody,
  AssignmentResponse,
  AssignWorkCardsBody,
  AuditEvent,
  BatchLifecycleStatus,
  CardVersionCommandBody,
  CommandName,
  CreateBatchResponse,
  CreateProductionBatchBody,
  FinalBatchAcceptance,
  FinalBatchAcceptanceResponse,
  FirstArticleAcceptanceResponse,
  GateStatus,
  OperationPlan,
  PayrollExportResponse,
  PayrollRecord,
  ProductionBatchDetail,
  ProductionBatchSummary,
  ProductionPassportDetail,
  ProductionPassportSummary,
  ReleaseWorkCardsBody,
  ReleaseWorkCardsResponse,
  Role,
  WorkCard,
  WorkCardCommandResponse,
  WorkCardPurpose,
  WorkCardSetDetail,
  WorkCardSetSummary,
  WorkCardStatus,
} from '@work-card/contracts';
import type { Pool, PoolClient } from 'pg';

import {
  DomainError,
  gateClosed,
  invalidBusinessInput,
  resourceNotFound,
  stateConflict,
  versionConflict,
} from './domain-error.js';
import { decodeCursor, encodeCursor, pageLimit, type PageInput } from './pagination.js';
import type { ActorContext } from './session-manager.js';

type Queryable = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

type CommandExecution<T> = {
  body: T;
  replay: boolean;
  status: number;
};

type CommandOutcome<T> = {
  body: T;
  eventCount: number;
  resultId?: string;
  resultType: string;
  status: number;
};

type CommandReceiptRow = {
  actor_id: string;
  actor_role: string;
  command_type: string;
  http_status: number | null;
  request_fingerprint: string;
  response_body: unknown;
  state: string;
};

type AuditInsert = {
  aggregateId: string;
  aggregateType: string;
  aggregateVersion: number;
  data: Record<string, unknown>;
  eventType: string;
};

type BatchRow = {
  created_at: Date | string;
  final_acceptance_id: string | null;
  final_accepted_at: Date | string | null;
  id: string;
  lifecycle_status: BatchLifecycleStatus;
  passport_code_snapshot: string;
  passport_revision_snapshot: string;
  product_name_snapshot: string;
  quantity: number;
  released_at: Date | string | null;
  version: number;
};

type SetRow = {
  batch_id: string;
  first_article_work_card_id: string | null;
  gate_status: GateStatus;
  id: string;
  norm_hours_snapshot: string;
  planned_card_count: number;
  scope_code_snapshot: string;
  scope_name_snapshot: string;
  version: number;
};

type CardRow = {
  assignee_display_name: string | null;
  assignee_id: string | null;
  assigned_at: Date | string | null;
  batch_id: string;
  batch_quantity_snapshot: number;
  closed_at: Date | string | null;
  closure_type: 'FIRST_ARTICLE_ACCEPTANCE' | 'SERIAL_QUALITY_CONFIRMATION' | null;
  completed_at: Date | string | null;
  first_article_work_card_id: string | null;
  gate_status: GateStatus;
  id: string;
  norm_hours_snapshot: string;
  purpose: WorkCardPurpose | null;
  released_at: Date | string;
  scope_code_snapshot: string;
  scope_name_snapshot: string;
  started_at: Date | string | null;
  status: WorkCardStatus;
  version: number;
  work_card_set_id: string;
};

type LockedCardRow = Omit<
  CardRow,
  'assignee_display_name' | 'first_article_work_card_id' | 'gate_status'
>;

type PayrollRow = {
  beneficiary_display_name: string;
  beneficiary_id: string;
  command_id: string;
  exported_at: Date | string;
  exported_by: string;
  exporter_display_name: string;
  id: string;
  norm_hours_snapshot: string;
  work_card_id: string;
};

type AuditRow = {
  actor_id: string;
  actor_role: Role;
  aggregate_id: string;
  aggregate_type: string;
  aggregate_version: number;
  command_id: string;
  correlation_id: string;
  event_type: string;
  id: string;
  occurred_at: Date | string;
  payload: Record<string, unknown>;
};

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function nullableIso(value: Date | string | null): string | null {
  return value === null ? null : iso(value);
}

function decimal(value: string): string {
  return value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
}

function fingerprint(value: unknown): string {
  const canonicalize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(canonicalize);
    if (typeof input !== 'object' || input === null) return input;
    return Object.fromEntries(
      Object.entries(input)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  };
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Сохранённый command receipt имеет некорректный response body.');
  }
  return value as Record<string, unknown>;
}

function commandIdReused(): DomainError {
  return new DomainError({
    code: 'COMMAND_ID_REUSED',
    detail: 'Этот идентификатор уже использован для другой команды.',
    status: 409,
    title: 'Идентификатор команды уже использован',
  });
}

function auditRow(row: AuditRow): AuditEvent {
  return {
    id: row.id,
    eventType: row.event_type,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    aggregateVersion: row.aggregate_version,
    occurredAt: iso(row.occurred_at),
    actorId: row.actor_id,
    actorRole: row.actor_role,
    commandId: row.command_id,
    correlationId: row.correlation_id,
    data: row.payload,
  };
}

function availableCardActions(row: CardRow, actor: ActorContext): CommandName[] {
  const actions: CommandName[] = [];
  if (actor.role === 'MASTER' && row.status === 'ASSIGNED') {
    const gateAllowsStart =
      (row.purpose === 'FIRST_ARTICLE' &&
        row.gate_status === 'FIRST_ARTICLE_PENDING' &&
        row.first_article_work_card_id === row.id) ||
      (row.purpose === 'SERIAL' && row.gate_status === 'SERIAL_ALLOWED');
    if (gateAllowsStart) actions.push('StartWorkCard');
  }
  if (actor.role === 'MASTER' && row.status === 'IN_PROGRESS') {
    actions.push('CompleteWorkCard');
  }
  if (
    actor.role === 'QUALITY_CONTROLLER' &&
    row.status === 'COMPLETED' &&
    row.purpose === 'FIRST_ARTICLE' &&
    row.gate_status === 'FIRST_ARTICLE_PENDING' &&
    row.first_article_work_card_id === row.id
  ) {
    actions.push('AcceptFirstArticle');
  }
  if (
    actor.role === 'QUALITY_CONTROLLER' &&
    row.status === 'COMPLETED' &&
    row.purpose === 'SERIAL' &&
    row.gate_status === 'SERIAL_ALLOWED'
  ) {
    actions.push('ConfirmWorkCardQuality');
  }
  if (actor.role === 'ADMIN_AUDITOR' && row.status === 'CLOSED') {
    actions.push('ExportWorkCardToPayroll');
  }
  return actions;
}

function toWorkCard(row: CardRow, actor: ActorContext): WorkCard {
  return {
    id: row.id,
    workCardSetId: row.work_card_set_id,
    batchId: row.batch_id,
    batchQuantitySnapshot: row.batch_quantity_snapshot,
    operation: {
      scopeCode: row.scope_code_snapshot,
      scopeName: row.scope_name_snapshot,
      normHours: row.norm_hours_snapshot,
    },
    purpose: row.purpose,
    status: row.status,
    closureType: row.closure_type,
    assignee:
      row.assignee_id && row.assignee_display_name
        ? { id: row.assignee_id, displayName: row.assignee_display_name }
        : null,
    version: row.version,
    timestamps: {
      releasedAt: iso(row.released_at),
      assignedAt: nullableIso(row.assigned_at),
      startedAt: nullableIso(row.started_at),
      completedAt: nullableIso(row.completed_at),
      closedAt: nullableIso(row.closed_at),
    },
    availableActions: availableCardActions(row, actor),
  };
}

function toPayrollRecord(row: PayrollRow): PayrollRecord {
  return {
    id: row.id,
    workCardId: row.work_card_id,
    beneficiary: { id: row.beneficiary_id, displayName: row.beneficiary_display_name },
    normHoursSnapshot: row.norm_hours_snapshot,
    exportedBy: { id: row.exported_by, displayName: row.exporter_display_name },
    exportedAt: iso(row.exported_at),
    commandId: row.command_id,
  };
}

async function insertAuditEvents(
  client: PoolClient,
  actor: ActorContext,
  commandId: string,
  correlationId: string,
  occurredAt: string,
  events: AuditInsert[],
): Promise<void> {
  if (events.length === 0) return;
  const values: unknown[] = [];
  const tuples = events.map((event, index) => {
    const offset = index * 11;
    values.push(
      randomUUID(),
      event.eventType,
      event.aggregateType,
      event.aggregateId,
      event.aggregateVersion,
      occurredAt,
      actor.id,
      actor.role,
      commandId,
      correlationId,
      JSON.stringify(event.data),
    );
    const placeholders = Array.from({ length: 11 }, (_, item) => `$${offset + item + 1}`);
    return `(${placeholders.join(', ')})`;
  });
  await client.query(
    `INSERT INTO audit_events(
       id, event_type, aggregate_type, aggregate_id, aggregate_version, occurred_at,
       actor_id, actor_role, command_id, correlation_id, payload
     ) VALUES ${tuples.join(', ')}`,
    values,
  );
}

async function loadCard(queryable: Queryable, workCardId: string): Promise<CardRow | null> {
  const result = await queryable.query<CardRow>(
    `SELECT card.id, card.work_card_set_id, card.batch_id, card.batch_quantity_snapshot,
            card.scope_code_snapshot, card.scope_name_snapshot,
            card.norm_hours_snapshot::text, card.purpose, card.status, card.closure_type,
            card.assignee_id, assignee.display_name AS assignee_display_name, card.version,
            card.released_at, card.assigned_at, card.started_at, card.completed_at,
            card.closed_at, card_set.gate_status, card_set.first_article_work_card_id
     FROM work_cards AS card
     JOIN work_card_sets AS card_set ON card_set.id = card.work_card_set_id
     LEFT JOIN demo_users AS assignee ON assignee.id = card.assignee_id
     WHERE card.id = $1`,
    [workCardId],
  );
  return result.rows[0] ?? null;
}

async function loadPayrollRecord(
  queryable: Queryable,
  workCardId: string,
): Promise<PayrollRow | null> {
  const result = await queryable.query<PayrollRow>(
    `SELECT record.id, record.work_card_id, record.beneficiary_id,
            beneficiary.display_name AS beneficiary_display_name,
            record.norm_hours_snapshot::text, record.exported_by,
            exporter.display_name AS exporter_display_name,
            record.exported_at, record.command_id
     FROM payroll_records AS record
     JOIN demo_users AS beneficiary ON beneficiary.id = record.beneficiary_id
     JOIN demo_users AS exporter ON exporter.id = record.exported_by
     WHERE record.work_card_id = $1`,
    [workCardId],
  );
  return result.rows[0] ?? null;
}

async function executeCommand<T>(
  pool: Pool,
  options: {
    actor: ActorContext;
    commandId: string;
    commandType: CommandName;
    request: unknown;
  },
  perform: (
    client: PoolClient,
    context: { correlationId: string; occurredAt: string },
  ) => Promise<CommandOutcome<T>>,
): Promise<CommandExecution<T>> {
  const client = await pool.connect();
  const requestFingerprint = fingerprint(options.request);
  const correlationId = randomUUID();
  const occurredAt = new Date().toISOString();
  try {
    await client.query('BEGIN');
    const inserted = await client.query(
      `INSERT INTO command_receipts(
         command_id, command_type, actor_id, actor_role, request_fingerprint,
         correlation_id, state, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, 'IN_PROGRESS', $7)
       ON CONFLICT (command_id) DO NOTHING`,
      [
        options.commandId,
        options.commandType,
        options.actor.id,
        options.actor.role,
        requestFingerprint,
        correlationId,
        occurredAt,
      ],
    );

    if (inserted.rowCount === 0) {
      const existingResult = await client.query<CommandReceiptRow>(
        `SELECT command_type, actor_id, actor_role, request_fingerprint, state,
                http_status, response_body
         FROM command_receipts
         WHERE command_id = $1`,
        [options.commandId],
      );
      const existing = existingResult.rows[0];
      if (
        !existing ||
        existing.command_type !== options.commandType ||
        existing.actor_id !== options.actor.id ||
        existing.actor_role !== options.actor.role ||
        existing.request_fingerprint !== requestFingerprint ||
        existing.state !== 'SUCCEEDED' ||
        existing.http_status === null
      ) {
        throw commandIdReused();
      }
      const body = asRecord(existing.response_body) as T;
      await client.query('ROLLBACK');
      return { body, replay: true, status: 200 };
    }

    const outcome = await perform(client, { correlationId, occurredAt });
    await client.query(
      `UPDATE command_receipts
       SET state = 'SUCCEEDED', http_status = $2, result_type = $3, result_id = $4,
           response_body = $5::jsonb, event_count = $6, completed_at = $7
       WHERE command_id = $1`,
      [
        options.commandId,
        outcome.status,
        outcome.resultType,
        outcome.resultId ?? null,
        JSON.stringify(outcome.body),
        outcome.eventCount,
        occurredAt,
      ],
    );
    await client.query('COMMIT');
    return { body: outcome.body, replay: false, status: outcome.status };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // The original error remains authoritative.
    }
    throw error;
  } finally {
    client.release();
  }
}

export function createWorkflowService(pool: Pool) {
  return {
    async listPassports(): Promise<ProductionPassportSummary[]> {
      const result = await pool.query<{
        code: string;
        id: string;
        operation_count: number;
        planned_card_count: number;
        product_name: string;
        revision: string;
      }>(
        `SELECT passport.id, passport.product_code AS code, passport.revision,
                passport.product_name,
                COUNT(plan.id)::integer AS operation_count,
                COALESCE(SUM(plan.planned_card_count), 0)::integer AS planned_card_count
         FROM production_passports AS passport
         JOIN operation_plans AS plan ON plan.passport_id = passport.id
         GROUP BY passport.id
         ORDER BY passport.product_code, passport.revision, passport.id`,
      );
      return result.rows.map((row) => ({
        id: row.id,
        code: row.code,
        revision: row.revision,
        productName: row.product_name,
        operationCount: row.operation_count,
        plannedCardCount: row.planned_card_count,
      }));
    },

    async getPassport(passportId: string): Promise<ProductionPassportDetail> {
      const passportResult = await pool.query<{
        code: string;
        id: string;
        product_name: string;
        revision: string;
      }>(
        `SELECT id, product_code AS code, revision, product_name
         FROM production_passports WHERE id = $1`,
        [passportId],
      );
      const passport = passportResult.rows[0];
      if (!passport) throw resourceNotFound();
      const operationsResult = await pool.query<{
        id: string;
        norm_hours: string;
        operation_name: string;
        operation_number: number;
        planned_card_count: number;
        scope_code: string;
      }>(
        `SELECT id, operation_number, scope_code, operation_name,
                norm_hours::text, planned_card_count
         FROM operation_plans
         WHERE passport_id = $1
         ORDER BY operation_number, id`,
        [passportId],
      );
      const operations: OperationPlan[] = operationsResult.rows.map((row) => ({
        id: row.id,
        position: row.operation_number,
        scopeCode: row.scope_code,
        scopeName: row.operation_name,
        normHours: decimal(row.norm_hours),
        plannedCardCount: row.planned_card_count,
      }));
      if (operations.length === 0) throw resourceNotFound();
      return {
        id: passport.id,
        code: passport.code,
        revision: passport.revision,
        productName: passport.product_name,
        operationCount: operations.length,
        plannedCardCount: operations.reduce(
          (sum, operation) => sum + operation.plannedCardCount,
          0,
        ),
        operations,
      };
    },

    async createBatch(
      actor: ActorContext,
      body: CreateProductionBatchBody,
    ): Promise<CommandExecution<CreateBatchResponse>> {
      return executeCommand(
        pool,
        {
          actor,
          commandId: body.commandId,
          commandType: 'CreateProductionBatch',
          request: body,
        },
        async (client, context) => {
          const passportResult = await client.query<{
            id: string;
            product_code: string;
            product_name: string;
            revision: string;
          }>(
            `SELECT id, product_code, revision, product_name
             FROM production_passports WHERE id = $1`,
            [body.productionPassportId],
          );
          const passport = passportResult.rows[0];
          if (!passport) throw resourceNotFound();
          const plansResult = await client.query<{
            id: string;
            norm_hours: string;
            operation_name: string;
            operation_number: number;
            planned_card_count: number;
            scope_code: string;
          }>(
            `SELECT id, operation_number, scope_code, operation_name,
                    norm_hours::text, planned_card_count
             FROM operation_plans
             WHERE passport_id = $1
             ORDER BY operation_number, id`,
            [passport.id],
          );
          if (plansResult.rows.length === 0) {
            throw invalidBusinessInput(
              'INVALID_PRODUCTION_PASSPORT',
              'Подготовленный паспорт не содержит плана операций.',
            );
          }
          const batchId = randomUUID();
          await client.query(
            `INSERT INTO production_batches(
               id, quantity, source_passport_id, passport_code_snapshot,
               passport_revision_snapshot, product_name_snapshot, lifecycle_status,
               version, created_at, created_by
             ) VALUES ($1, $2, $3, $4, $5, $6, 'CREATED', 1, $7, $8)`,
            [
              batchId,
              body.quantity,
              passport.id,
              passport.product_code,
              passport.revision,
              passport.product_name,
              context.occurredAt,
              actor.id,
            ],
          );
          for (const plan of plansResult.rows) {
            await client.query(
              `INSERT INTO batch_operation_plan_snapshots(
                 id, batch_id, source_operation_plan_id, position, scope_code, scope_name,
                 norm_hours, planned_card_count
               ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
              [
                randomUUID(),
                batchId,
                plan.id,
                plan.operation_number,
                plan.scope_code,
                plan.operation_name,
                plan.norm_hours,
                plan.planned_card_count,
              ],
            );
          }
          const batch: ProductionBatchSummary = {
            id: batchId,
            quantity: body.quantity,
            lifecycleStatus: 'CREATED',
            version: 1,
            passportSnapshot: {
              code: passport.product_code,
              revision: passport.revision,
              productName: passport.product_name,
            },
            counts: {
              setCount: 0,
              plannedCardCount: plansResult.rows.reduce(
                (sum, plan) => sum + plan.planned_card_count,
                0,
              ),
              actualCardCount: 0,
              closedCardCount: 0,
            },
            createdAt: context.occurredAt,
          };
          const response: CreateBatchResponse = { batch, correlationId: context.correlationId };
          const events: AuditInsert[] = [
            {
              eventType: 'ProductionBatchCreated',
              aggregateType: 'ProductionBatch',
              aggregateId: batchId,
              aggregateVersion: 1,
              data: {
                batchId,
                quantity: body.quantity,
                passportSnapshot: batch.passportSnapshot,
              },
            },
          ];
          await insertAuditEvents(
            client,
            actor,
            body.commandId,
            context.correlationId,
            context.occurredAt,
            events,
          );
          return {
            body: response,
            eventCount: events.length,
            resultId: batchId,
            resultType: 'ProductionBatch',
            status: 201,
          };
        },
      );
    },

    async releaseWorkCards(
      actor: ActorContext,
      batchId: string,
      body: ReleaseWorkCardsBody,
    ): Promise<CommandExecution<ReleaseWorkCardsResponse>> {
      return executeCommand(
        pool,
        {
          actor,
          commandId: body.commandId,
          commandType: 'ReleaseWorkCards',
          request: { batchId, ...body },
        },
        async (client, context) => {
          const batchResult = await client.query<BatchRow>(
            `SELECT id, quantity, passport_code_snapshot, passport_revision_snapshot,
                    product_name_snapshot, lifecycle_status, final_acceptance_id, version,
                    created_at, released_at, final_accepted_at
             FROM production_batches WHERE id = $1 FOR UPDATE`,
            [batchId],
          );
          const batch = batchResult.rows[0];
          if (!batch) throw resourceNotFound();
          if (batch.version !== body.expectedBatchVersion) {
            throw versionConflict(
              'productionBatch',
              batchId,
              body.expectedBatchVersion,
              batch.version,
            );
          }
          if (batch.lifecycle_status !== 'CREATED') {
            throw stateConflict('Партия уже выпущена или завершена.');
          }
          const snapshotsResult = await client.query<{
            id: string;
            norm_hours: string;
            planned_card_count: number;
            scope_code: string;
            scope_name: string;
          }>(
            `SELECT id, scope_code, scope_name, norm_hours::text, planned_card_count
             FROM batch_operation_plan_snapshots
             WHERE batch_id = $1
             ORDER BY position, id`,
            [batchId],
          );
          if (snapshotsResult.rows.length === 0) {
            throw stateConflict('Снимок плана операций партии пуст.');
          }

          const events: AuditInsert[] = [];
          let cardCount = 0;
          for (const snapshot of snapshotsResult.rows) {
            const setId = randomUUID();
            await client.query(
              `INSERT INTO work_card_sets(
                 id, batch_id, plan_snapshot_id, scope_code_snapshot, scope_name_snapshot,
                 norm_hours_snapshot, planned_card_count, gate_status, version, released_at
               ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'FIRST_ARTICLE_PENDING', 1, $8)`,
              [
                setId,
                batchId,
                snapshot.id,
                snapshot.scope_code,
                snapshot.scope_name,
                snapshot.norm_hours,
                snapshot.planned_card_count,
                context.occurredAt,
              ],
            );
            events.push({
              eventType: 'WorkCardSetCreated',
              aggregateType: 'WorkCardSet',
              aggregateId: setId,
              aggregateVersion: 1,
              data: {
                setId,
                batchId,
                operationScope: {
                  code: snapshot.scope_code,
                  name: snapshot.scope_name,
                },
                normHours: snapshot.norm_hours,
                plannedCardCount: snapshot.planned_card_count,
                gateStatus: 'FIRST_ARTICLE_PENDING',
              },
            });
            const cardValues: unknown[] = [];
            const cardTuples: string[] = [];
            for (let index = 0; index < snapshot.planned_card_count; index += 1) {
              const workCardId = randomUUID();
              const offset = cardValues.length;
              cardValues.push(
                workCardId,
                setId,
                batchId,
                batch.quantity,
                snapshot.scope_code,
                snapshot.scope_name,
                snapshot.norm_hours,
                context.occurredAt,
                actor.id,
              );
              cardTuples.push(
                `(${Array.from({ length: 9 }, (_, item) => `$${offset + item + 1}`).join(', ')}, 'RELEASED', 1)`,
              );
              events.push({
                eventType: 'WorkCardReleased',
                aggregateType: 'WorkCard',
                aggregateId: workCardId,
                aggregateVersion: 1,
                data: {
                  workCardId,
                  setId,
                  batchId,
                  batchQuantitySnapshot: batch.quantity,
                  operationScope: {
                    code: snapshot.scope_code,
                    name: snapshot.scope_name,
                  },
                  normHours: snapshot.norm_hours,
                  status: 'RELEASED',
                },
              });
              cardCount += 1;
            }
            await client.query(
              `INSERT INTO work_cards(
                 id, work_card_set_id, batch_id, batch_quantity_snapshot,
                 scope_code_snapshot, scope_name_snapshot, norm_hours_snapshot,
                 released_at, released_by, status, version
               ) VALUES ${cardTuples.join(', ')}`,
              cardValues,
            );
          }
          const updatedBatch = await client.query<{ version: number }>(
            `UPDATE production_batches
             SET lifecycle_status = 'RELEASED', released_at = $2, released_by = $3,
                 version = version + 1
             WHERE id = $1 AND version = $4
             RETURNING version`,
            [batchId, context.occurredAt, actor.id, body.expectedBatchVersion],
          );
          const resultingVersion = updatedBatch.rows[0]?.version;
          if (!resultingVersion) {
            throw versionConflict(
              'productionBatch',
              batchId,
              body.expectedBatchVersion,
              batch.version,
            );
          }
          events.unshift({
            eventType: 'ProductionBatchReleased',
            aggregateType: 'ProductionBatch',
            aggregateId: batchId,
            aggregateVersion: resultingVersion,
            data: {
              batchId,
              setCount: snapshotsResult.rows.length,
              cardCountTotal: cardCount,
            },
          });
          await insertAuditEvents(
            client,
            actor,
            body.commandId,
            context.correlationId,
            context.occurredAt,
            events,
          );
          const response: ReleaseWorkCardsResponse = {
            batchId,
            lifecycleStatus: 'RELEASED',
            setCount: snapshotsResult.rows.length,
            plannedCardCount: snapshotsResult.rows.reduce(
              (sum, snapshot) => sum + snapshot.planned_card_count,
              0,
            ),
            actualCardCount: cardCount,
            batchVersion: resultingVersion,
            correlationId: context.correlationId,
          };
          return {
            body: response,
            eventCount: events.length,
            resultId: batchId,
            resultType: 'ProductionBatch',
            status: 200,
          };
        },
      );
    },

    async assignWorkCards(
      actor: ActorContext,
      setId: string,
      body: AssignWorkCardsBody,
    ): Promise<CommandExecution<AssignmentResponse>> {
      return executeCommand(
        pool,
        {
          actor,
          commandId: body.commandId,
          commandType: 'AssignWorkCards',
          request: { setId, ...body },
        },
        async (client, context) => {
          const requestedIds = body.cards.map((card) => card.workCardId);
          const sortedIds = [...new Set(requestedIds)].sort();
          if (sortedIds.length !== requestedIds.length) {
            throw invalidBusinessInput(
              'DUPLICATE_WORK_CARD',
              'Список назначения содержит повторяющуюся карточку.',
            );
          }
          const setResult = await client.query<SetRow>(
            `SELECT id, batch_id, scope_code_snapshot, scope_name_snapshot,
                    norm_hours_snapshot::text, planned_card_count, gate_status,
                    first_article_work_card_id, version
             FROM work_card_sets WHERE id = $1 FOR UPDATE`,
            [setId],
          );
          const cardSet = setResult.rows[0];
          if (!cardSet) throw resourceNotFound();
          if (cardSet.version !== body.expectedSetVersion) {
            throw versionConflict('workCardSet', setId, body.expectedSetVersion, cardSet.version);
          }
          const cardsResult = await client.query<LockedCardRow>(
            `SELECT id, work_card_set_id, batch_id, batch_quantity_snapshot,
                    scope_code_snapshot, scope_name_snapshot, norm_hours_snapshot::text,
                    purpose, status, closure_type, assignee_id, version, released_at,
                    assigned_at, started_at, completed_at, closed_at
             FROM work_cards
             WHERE id = ANY($1::uuid[])
             ORDER BY id
             FOR UPDATE`,
            [sortedIds],
          );
          if (cardsResult.rows.length !== sortedIds.length) throw resourceNotFound();
          if (cardsResult.rows.some((card) => card.work_card_set_id !== setId)) {
            throw invalidBusinessInput(
              'MIXED_WORK_CARD_SET',
              'Все карточки назначения должны принадлежать одному комплекту.',
            );
          }
          const expectedById = new Map(
            body.cards.map((card) => [card.workCardId, card.expectedVersion]),
          );
          const conflicts = cardsResult.rows
            .filter((card) => expectedById.get(card.id) !== card.version)
            .map((card) => ({
              resourceType: 'workCard',
              resourceId: card.id,
              expectedVersion: expectedById.get(card.id) ?? 0,
              actualVersion: card.version,
            }));
          if (conflicts.length > 0) {
            throw new DomainError({
              code: 'VERSION_CONFLICT',
              conflicts,
              detail: 'Обновите данные и повторите решение.',
              status: 409,
              title: 'Данные были изменены',
            });
          }
          if (cardsResult.rows.some((card) => card.status !== 'RELEASED')) {
            throw stateConflict('Назначать можно только ещё не назначенные карточки.');
          }
          const assigneeResult = await client.query<{ display_name: string; id: string }>(
            `SELECT id, display_name
             FROM demo_users
             WHERE id = $1 AND enabled AND role_code = 'WORKER'`,
            [body.assigneeId],
          );
          const assignee = assigneeResult.rows[0];
          if (!assignee) {
            throw invalidBusinessInput(
              'INVALID_ASSIGNEE',
              'Для назначения выберите активного исполнителя.',
            );
          }

          let resultingSetVersion = cardSet.version;
          const events: AuditInsert[] = [];
          if (body.purpose === 'FIRST_ARTICLE') {
            if (sortedIds.length !== 1) {
              throw invalidBusinessInput(
                'INVALID_FIRST_ARTICLE_SELECTION',
                'Для первой детали нужно выбрать ровно одну карточку.',
              );
            }
            if (
              cardSet.gate_status !== 'FIRST_ARTICLE_PENDING' ||
              cardSet.first_article_work_card_id !== null
            ) {
              throw stateConflict('Карточка первой детали уже выбрана или этап завершён.');
            }
            const updatedSet = await client.query<{ version: number }>(
              `UPDATE work_card_sets
               SET first_article_work_card_id = $2, version = version + 1
               WHERE id = $1 AND version = $3
               RETURNING version`,
              [setId, sortedIds[0], body.expectedSetVersion],
            );
            resultingSetVersion = updatedSet.rows[0]?.version ?? cardSet.version;
            events.push({
              eventType: 'FirstArticleWorkCardSelected',
              aggregateType: 'WorkCardSet',
              aggregateId: setId,
              aggregateVersion: resultingSetVersion,
              data: { setId, workCardId: sortedIds[0], gateStatus: cardSet.gate_status },
            });
          } else if (cardSet.gate_status !== 'SERIAL_ALLOWED') {
            throw gateClosed();
          }

          const updatedCards = await client.query<{ id: string; version: number }>(
            `UPDATE work_cards
             SET purpose = $2, assignee_id = $3, assigned_at = $4, assigned_by = $5,
                 status = 'ASSIGNED', version = version + 1
             WHERE id = ANY($1::uuid[]) AND status = 'RELEASED'
             RETURNING id, version`,
            [sortedIds, body.purpose, assignee.id, context.occurredAt, actor.id],
          );
          if (updatedCards.rows.length !== sortedIds.length) {
            throw stateConflict('Не удалось атомарно назначить весь выбранный набор.');
          }
          for (const card of updatedCards.rows) {
            events.push({
              eventType: 'WorkCardAssigned',
              aggregateType: 'WorkCard',
              aggregateId: card.id,
              aggregateVersion: card.version,
              data: {
                workCardId: card.id,
                assigneeId: assignee.id,
                purpose: body.purpose,
                status: 'ASSIGNED',
              },
            });
          }
          await insertAuditEvents(
            client,
            actor,
            body.commandId,
            context.correlationId,
            context.occurredAt,
            events,
          );
          const response: AssignmentResponse = {
            workCardSetId: setId,
            purpose: body.purpose,
            assignee: { id: assignee.id, displayName: assignee.display_name },
            assignedCount: updatedCards.rows.length,
            setVersion: resultingSetVersion,
            cards: updatedCards.rows
              .map((card) => ({ workCardId: card.id, version: card.version }))
              .sort((left, right) => left.workCardId.localeCompare(right.workCardId)),
            correlationId: context.correlationId,
          };
          return {
            body: response,
            eventCount: events.length,
            resultId: setId,
            resultType: 'Assignment',
            status: 200,
          };
        },
      );
    },

    async startWorkCard(
      actor: ActorContext,
      workCardId: string,
      body: CardVersionCommandBody,
    ): Promise<CommandExecution<WorkCardCommandResponse>> {
      return executeCommand(
        pool,
        {
          actor,
          commandId: body.commandId,
          commandType: 'StartWorkCard',
          request: { workCardId, ...body },
        },
        async (client, context) => {
          const locator = await client.query<{ work_card_set_id: string }>(
            'SELECT work_card_set_id FROM work_cards WHERE id = $1',
            [workCardId],
          );
          const setId = locator.rows[0]?.work_card_set_id;
          if (!setId) throw resourceNotFound();
          const setResult = await client.query<
            Pick<SetRow, 'first_article_work_card_id' | 'gate_status'>
          >(
            `SELECT gate_status, first_article_work_card_id
             FROM work_card_sets WHERE id = $1 FOR UPDATE`,
            [setId],
          );
          const cardSet = setResult.rows[0];
          const cardResult = await client.query<LockedCardRow>(
            `SELECT id, work_card_set_id, batch_id, batch_quantity_snapshot,
                    scope_code_snapshot, scope_name_snapshot, norm_hours_snapshot::text,
                    purpose, status, closure_type, assignee_id, version, released_at,
                    assigned_at, started_at, completed_at, closed_at
             FROM work_cards WHERE id = $1 FOR UPDATE`,
            [workCardId],
          );
          const card = cardResult.rows[0];
          if (!card || !cardSet) throw resourceNotFound();
          if (card.version !== body.expectedCardVersion) {
            throw versionConflict('workCard', workCardId, body.expectedCardVersion, card.version);
          }
          if (card.status !== 'ASSIGNED') {
            throw stateConflict('Начать можно только назначенную карточку.');
          }
          const firstArticleAllowed =
            card.purpose === 'FIRST_ARTICLE' &&
            cardSet.gate_status === 'FIRST_ARTICLE_PENDING' &&
            cardSet.first_article_work_card_id === card.id;
          const serialAllowed =
            card.purpose === 'SERIAL' && cardSet.gate_status === 'SERIAL_ALLOWED';
          if (!firstArticleAllowed && !serialAllowed) throw gateClosed();
          const updated = await client.query<{ version: number }>(
            `UPDATE work_cards
             SET status = 'IN_PROGRESS', started_at = $2, started_by = $3,
                 version = version + 1
             WHERE id = $1 AND version = $4
             RETURNING version`,
            [workCardId, context.occurredAt, actor.id, body.expectedCardVersion],
          );
          const resultingVersion = updated.rows[0]?.version;
          if (!resultingVersion) {
            throw versionConflict('workCard', workCardId, body.expectedCardVersion, card.version);
          }
          const events: AuditInsert[] = [
            {
              eventType: 'WorkCardStarted',
              aggregateType: 'WorkCard',
              aggregateId: workCardId,
              aggregateVersion: resultingVersion,
              data: {
                workCardId,
                assigneeId: card.assignee_id,
                recordedByMasterId: actor.id,
                status: 'IN_PROGRESS',
              },
            },
          ];
          await insertAuditEvents(
            client,
            actor,
            body.commandId,
            context.correlationId,
            context.occurredAt,
            events,
          );
          const projection = await loadCard(client, workCardId);
          if (!projection) throw resourceNotFound();
          return {
            body: { workCard: toWorkCard(projection, actor), correlationId: context.correlationId },
            eventCount: events.length,
            resultId: workCardId,
            resultType: 'WorkCard',
            status: 200,
          };
        },
      );
    },

    async completeWorkCard(
      actor: ActorContext,
      workCardId: string,
      body: CardVersionCommandBody,
    ): Promise<CommandExecution<WorkCardCommandResponse>> {
      return executeCommand(
        pool,
        {
          actor,
          commandId: body.commandId,
          commandType: 'CompleteWorkCard',
          request: { workCardId, ...body },
        },
        async (client, context) => {
          const cardResult = await client.query<LockedCardRow>(
            `SELECT id, work_card_set_id, batch_id, batch_quantity_snapshot,
                    scope_code_snapshot, scope_name_snapshot, norm_hours_snapshot::text,
                    purpose, status, closure_type, assignee_id, version, released_at,
                    assigned_at, started_at, completed_at, closed_at
             FROM work_cards WHERE id = $1 FOR UPDATE`,
            [workCardId],
          );
          const card = cardResult.rows[0];
          if (!card) throw resourceNotFound();
          if (card.version !== body.expectedCardVersion) {
            throw versionConflict('workCard', workCardId, body.expectedCardVersion, card.version);
          }
          if (card.status !== 'IN_PROGRESS') {
            throw stateConflict('Завершить можно только начатую карточку.');
          }
          const updated = await client.query<{ version: number }>(
            `UPDATE work_cards
             SET status = 'COMPLETED', completed_at = $2, completed_by = $3,
                 version = version + 1
             WHERE id = $1 AND version = $4
             RETURNING version`,
            [workCardId, context.occurredAt, actor.id, body.expectedCardVersion],
          );
          const resultingVersion = updated.rows[0]?.version;
          if (!resultingVersion) {
            throw versionConflict('workCard', workCardId, body.expectedCardVersion, card.version);
          }
          const events: AuditInsert[] = [
            {
              eventType: 'WorkCardCompleted',
              aggregateType: 'WorkCard',
              aggregateId: workCardId,
              aggregateVersion: resultingVersion,
              data: {
                workCardId,
                assigneeId: card.assignee_id,
                recordedByMasterId: actor.id,
                status: 'COMPLETED',
              },
            },
          ];
          await insertAuditEvents(
            client,
            actor,
            body.commandId,
            context.correlationId,
            context.occurredAt,
            events,
          );
          const projection = await loadCard(client, workCardId);
          if (!projection) throw resourceNotFound();
          return {
            body: { workCard: toWorkCard(projection, actor), correlationId: context.correlationId },
            eventCount: events.length,
            resultId: workCardId,
            resultType: 'WorkCard',
            status: 200,
          };
        },
      );
    },

    async acceptFirstArticle(
      actor: ActorContext,
      setId: string,
      body: AcceptFirstArticleBody,
    ): Promise<CommandExecution<FirstArticleAcceptanceResponse>> {
      return executeCommand(
        pool,
        {
          actor,
          commandId: body.commandId,
          commandType: 'AcceptFirstArticle',
          request: { setId, ...body },
        },
        async (client, context) => {
          const setResult = await client.query<SetRow>(
            `SELECT id, batch_id, scope_code_snapshot, scope_name_snapshot,
                    norm_hours_snapshot::text, planned_card_count, gate_status,
                    first_article_work_card_id, version
             FROM work_card_sets WHERE id = $1 FOR UPDATE`,
            [setId],
          );
          const cardSet = setResult.rows[0];
          if (!cardSet) throw resourceNotFound();
          if (cardSet.version !== body.expectedSetVersion) {
            throw versionConflict('workCardSet', setId, body.expectedSetVersion, cardSet.version);
          }
          if (
            cardSet.gate_status !== 'FIRST_ARTICLE_PENDING' ||
            !cardSet.first_article_work_card_id
          ) {
            throw stateConflict('Первая деталь не выбрана или уже принята.');
          }
          const workCardId = cardSet.first_article_work_card_id;
          const cardResult = await client.query<LockedCardRow>(
            `SELECT id, work_card_set_id, batch_id, batch_quantity_snapshot,
                    scope_code_snapshot, scope_name_snapshot, norm_hours_snapshot::text,
                    purpose, status, closure_type, assignee_id, version, released_at,
                    assigned_at, started_at, completed_at, closed_at
             FROM work_cards WHERE id = $1 FOR UPDATE`,
            [workCardId],
          );
          const card = cardResult.rows[0];
          if (!card || card.work_card_set_id !== setId) throw resourceNotFound();
          if (card.version !== body.expectedCardVersion) {
            throw versionConflict('workCard', workCardId, body.expectedCardVersion, card.version);
          }
          if (card.status !== 'COMPLETED' || card.purpose !== 'FIRST_ARTICLE') {
            throw stateConflict('Положительно принять можно только завершённую первую деталь.');
          }
          const cardUpdate = await client.query<{ version: number }>(
            `UPDATE work_cards
             SET status = 'CLOSED', closure_type = 'FIRST_ARTICLE_ACCEPTANCE',
                 closed_at = $2, closed_by = $3, version = version + 1
             WHERE id = $1 AND version = $4
             RETURNING version`,
            [workCardId, context.occurredAt, actor.id, body.expectedCardVersion],
          );
          const setUpdate = await client.query<{ version: number }>(
            `UPDATE work_card_sets
             SET gate_status = 'SERIAL_ALLOWED', first_article_controller_id = $2,
                 first_article_accepted_at = $3, version = version + 1
             WHERE id = $1 AND version = $4
             RETURNING version`,
            [setId, actor.id, context.occurredAt, body.expectedSetVersion],
          );
          const cardVersion = cardUpdate.rows[0]?.version;
          const setVersion = setUpdate.rows[0]?.version;
          if (!cardVersion || !setVersion) {
            throw stateConflict('Не удалось атомарно принять первую деталь.');
          }
          const events: AuditInsert[] = [
            {
              eventType: 'WorkCardQualityConfirmed',
              aggregateType: 'WorkCard',
              aggregateId: workCardId,
              aggregateVersion: cardVersion,
              data: {
                workCardId,
                controllerId: actor.id,
                confirmationScope: 'WORK_CARD',
                acceptanceType: 'FIRST_ARTICLE',
                resultingStatus: 'CLOSED',
              },
            },
            {
              eventType: 'FirstArticleAccepted',
              aggregateType: 'WorkCardSet',
              aggregateId: setId,
              aggregateVersion: setVersion,
              data: {
                setId,
                workCardId,
                resultingGateStatus: 'SERIAL_ALLOWED',
              },
            },
          ];
          await insertAuditEvents(
            client,
            actor,
            body.commandId,
            context.correlationId,
            context.occurredAt,
            events,
          );
          const projection = await loadCard(client, workCardId);
          if (!projection) throw resourceNotFound();
          return {
            body: {
              workCardSetId: setId,
              gateStatus: 'SERIAL_ALLOWED',
              setVersion,
              workCard: toWorkCard(projection, actor),
              correlationId: context.correlationId,
            },
            eventCount: events.length,
            resultId: setId,
            resultType: 'FirstArticleAcceptance',
            status: 200,
          };
        },
      );
    },

    async confirmWorkCardQuality(
      actor: ActorContext,
      workCardId: string,
      body: CardVersionCommandBody,
    ): Promise<CommandExecution<WorkCardCommandResponse>> {
      return executeCommand(
        pool,
        {
          actor,
          commandId: body.commandId,
          commandType: 'ConfirmWorkCardQuality',
          request: { workCardId, ...body },
        },
        async (client, context) => {
          const locator = await client.query<{ work_card_set_id: string }>(
            'SELECT work_card_set_id FROM work_cards WHERE id = $1',
            [workCardId],
          );
          const setId = locator.rows[0]?.work_card_set_id;
          if (!setId) throw resourceNotFound();
          const setResult = await client.query<{ gate_status: GateStatus }>(
            'SELECT gate_status FROM work_card_sets WHERE id = $1 FOR UPDATE',
            [setId],
          );
          const cardResult = await client.query<LockedCardRow>(
            `SELECT id, work_card_set_id, batch_id, batch_quantity_snapshot,
                    scope_code_snapshot, scope_name_snapshot, norm_hours_snapshot::text,
                    purpose, status, closure_type, assignee_id, version, released_at,
                    assigned_at, started_at, completed_at, closed_at
             FROM work_cards WHERE id = $1 FOR UPDATE`,
            [workCardId],
          );
          const card = cardResult.rows[0];
          if (!card || !setResult.rows[0]) throw resourceNotFound();
          if (card.version !== body.expectedCardVersion) {
            throw versionConflict('workCard', workCardId, body.expectedCardVersion, card.version);
          }
          if (setResult.rows[0].gate_status !== 'SERIAL_ALLOWED') throw gateClosed();
          if (card.status !== 'COMPLETED' || card.purpose !== 'SERIAL') {
            throw stateConflict(
              'Подтвердить качество можно только у завершённой серийной карточки.',
            );
          }
          const updated = await client.query<{ version: number }>(
            `UPDATE work_cards
             SET status = 'CLOSED', closure_type = 'SERIAL_QUALITY_CONFIRMATION',
                 closed_at = $2, closed_by = $3, version = version + 1
             WHERE id = $1 AND version = $4
             RETURNING version`,
            [workCardId, context.occurredAt, actor.id, body.expectedCardVersion],
          );
          const resultingVersion = updated.rows[0]?.version;
          if (!resultingVersion) {
            throw versionConflict('workCard', workCardId, body.expectedCardVersion, card.version);
          }
          const events: AuditInsert[] = [
            {
              eventType: 'WorkCardQualityConfirmed',
              aggregateType: 'WorkCard',
              aggregateId: workCardId,
              aggregateVersion: resultingVersion,
              data: {
                workCardId,
                controllerId: actor.id,
                confirmationScope: 'WORK_CARD',
                acceptanceType: 'SERIAL',
                resultingStatus: 'CLOSED',
              },
            },
          ];
          await insertAuditEvents(
            client,
            actor,
            body.commandId,
            context.correlationId,
            context.occurredAt,
            events,
          );
          const projection = await loadCard(client, workCardId);
          if (!projection) throw resourceNotFound();
          return {
            body: { workCard: toWorkCard(projection, actor), correlationId: context.correlationId },
            eventCount: events.length,
            resultId: workCardId,
            resultType: 'WorkCard',
            status: 200,
          };
        },
      );
    },

    async recordFinalBatchAcceptance(
      actor: ActorContext,
      batchId: string,
      body: ReleaseWorkCardsBody,
    ): Promise<CommandExecution<FinalBatchAcceptanceResponse>> {
      return executeCommand(
        pool,
        {
          actor,
          commandId: body.commandId,
          commandType: 'RecordFinalBatchAcceptance',
          request: { batchId, ...body },
        },
        async (client, context) => {
          const batchResult = await client.query<BatchRow>(
            `SELECT id, quantity, passport_code_snapshot, passport_revision_snapshot,
                    product_name_snapshot, lifecycle_status, final_acceptance_id, version,
                    created_at, released_at, final_accepted_at
             FROM production_batches WHERE id = $1 FOR UPDATE`,
            [batchId],
          );
          const batch = batchResult.rows[0];
          if (!batch) throw resourceNotFound();
          if (batch.version !== body.expectedBatchVersion) {
            throw versionConflict(
              'productionBatch',
              batchId,
              body.expectedBatchVersion,
              batch.version,
            );
          }
          if (batch.lifecycle_status !== 'RELEASED' || batch.final_acceptance_id !== null) {
            throw stateConflict('Партия уже принята либо ещё не выпущена.');
          }
          const setsResult = await client.query<SetRow>(
            `SELECT id, batch_id, scope_code_snapshot, scope_name_snapshot,
                    norm_hours_snapshot::text, planned_card_count, gate_status,
                    first_article_work_card_id, version
             FROM work_card_sets WHERE batch_id = $1 ORDER BY id FOR UPDATE`,
            [batchId],
          );
          const snapshotCount = await client.query<{ count: number }>(
            `SELECT COUNT(*)::integer AS count
             FROM batch_operation_plan_snapshots WHERE batch_id = $1`,
            [batchId],
          );
          if (
            setsResult.rows.length === 0 ||
            setsResult.rows.length !== snapshotCount.rows[0]?.count ||
            setsResult.rows.some((cardSet) => cardSet.gate_status !== 'SERIAL_ALLOWED')
          ) {
            throw stateConflict('Не во всех комплектах завершена приёмка первой детали.');
          }
          const cardsResult = await client.query<{
            status: WorkCardStatus;
            work_card_set_id: string;
          }>(
            `SELECT work_card_set_id, status
             FROM work_cards WHERE batch_id = $1 ORDER BY id FOR UPDATE`,
            [batchId],
          );
          const actualBySet = new Map<string, number>();
          for (const card of cardsResult.rows) {
            actualBySet.set(
              card.work_card_set_id,
              (actualBySet.get(card.work_card_set_id) ?? 0) + 1,
            );
          }
          if (
            setsResult.rows.some(
              (cardSet) => (actualBySet.get(cardSet.id) ?? 0) !== cardSet.planned_card_count,
            ) ||
            cardsResult.rows.some((card) => card.status !== 'CLOSED')
          ) {
            throw stateConflict('Финальная приёмка доступна только после закрытия всех карточек.');
          }
          const acceptanceId = randomUUID();
          const resultingBatchVersion = batch.version + 1;
          await client.query(
            `INSERT INTO final_batch_acceptances(
               id, batch_id, controller_id, accepted_at, command_id, resulting_batch_version
             ) VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              acceptanceId,
              batchId,
              actor.id,
              context.occurredAt,
              body.commandId,
              resultingBatchVersion,
            ],
          );
          const updated = await client.query<{ version: number }>(
            `UPDATE production_batches
             SET lifecycle_status = 'FINAL_ACCEPTED', final_acceptance_id = $2,
                 final_accepted_at = $3, version = version + 1
             WHERE id = $1 AND version = $4
             RETURNING version`,
            [batchId, acceptanceId, context.occurredAt, body.expectedBatchVersion],
          );
          if (updated.rows[0]?.version !== resultingBatchVersion) {
            throw versionConflict(
              'productionBatch',
              batchId,
              body.expectedBatchVersion,
              batch.version,
            );
          }
          const acceptance: FinalBatchAcceptance = {
            id: acceptanceId,
            batchId,
            controller: { id: actor.id, displayName: actor.displayName },
            acceptedAt: context.occurredAt,
            commandId: body.commandId,
            resultingBatchVersion,
          };
          const events: AuditInsert[] = [
            {
              eventType: 'FinalBatchAccepted',
              aggregateType: 'ProductionBatch',
              aggregateId: batchId,
              aggregateVersion: resultingBatchVersion,
              data: {
                acceptanceId,
                batchId,
                controllerId: actor.id,
                acceptedAt: context.occurredAt,
                resultingBatchStatus: 'FINAL_ACCEPTED',
                resultingBatchVersion,
              },
            },
          ];
          await insertAuditEvents(
            client,
            actor,
            body.commandId,
            context.correlationId,
            context.occurredAt,
            events,
          );
          return {
            body: {
              acceptance,
              batchLifecycleStatus: 'FINAL_ACCEPTED',
              correlationId: context.correlationId,
            },
            eventCount: events.length,
            resultId: acceptanceId,
            resultType: 'FinalBatchAcceptance',
            status: 201,
          };
        },
      );
    },

    async exportWorkCardToPayroll(
      actor: ActorContext,
      workCardId: string,
      body: CardVersionCommandBody,
    ): Promise<CommandExecution<PayrollExportResponse>> {
      return executeCommand(
        pool,
        {
          actor,
          commandId: body.commandId,
          commandType: 'ExportWorkCardToPayroll',
          request: { workCardId, ...body },
        },
        async (client, context) => {
          const cardResult = await client.query<LockedCardRow>(
            `SELECT id, work_card_set_id, batch_id, batch_quantity_snapshot,
                    scope_code_snapshot, scope_name_snapshot, norm_hours_snapshot::text,
                    purpose, status, closure_type, assignee_id, version, released_at,
                    assigned_at, started_at, completed_at, closed_at
             FROM work_cards WHERE id = $1 FOR UPDATE`,
            [workCardId],
          );
          const card = cardResult.rows[0];
          if (!card) throw resourceNotFound();
          if (card.version !== body.expectedCardVersion) {
            throw versionConflict('workCard', workCardId, body.expectedCardVersion, card.version);
          }
          if (card.status !== 'CLOSED' || !card.assignee_id) {
            throw stateConflict('Выгрузить можно только закрытую назначенную карточку.');
          }
          const existing = await loadPayrollRecord(client, workCardId);
          if (existing) {
            return {
              body: {
                payrollRecord: toPayrollRecord(existing),
                correlationId: context.correlationId,
              },
              eventCount: 0,
              resultId: existing.id,
              resultType: 'PayrollRecord',
              status: 200,
            };
          }
          const payrollRecordId = randomUUID();
          await client.query(
            `INSERT INTO payroll_records(
               id, work_card_id, beneficiary_id, norm_hours_snapshot,
               exported_by, exported_at, command_id
             ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              payrollRecordId,
              workCardId,
              card.assignee_id,
              card.norm_hours_snapshot,
              actor.id,
              context.occurredAt,
              body.commandId,
            ],
          );
          const events: AuditInsert[] = [
            {
              eventType: 'WorkCardExportedToPayroll',
              aggregateType: 'PayrollRecord',
              aggregateId: payrollRecordId,
              aggregateVersion: 1,
              data: {
                payrollRecordId,
                workCardId,
                beneficiaryId: card.assignee_id,
                normHours: card.norm_hours_snapshot,
              },
            },
          ];
          await insertAuditEvents(
            client,
            actor,
            body.commandId,
            context.correlationId,
            context.occurredAt,
            events,
          );
          const stored = await loadPayrollRecord(client, workCardId);
          if (!stored) throw new Error('Созданная payroll record не найдена.');
          return {
            body: {
              payrollRecord: toPayrollRecord(stored),
              correlationId: context.correlationId,
            },
            eventCount: events.length,
            resultId: payrollRecordId,
            resultType: 'PayrollRecord',
            status: 201,
          };
        },
      );
    },

    async listBatches(input: PageInput): Promise<{
      items: ProductionBatchSummary[];
      nextCursor: string | null;
    }> {
      const limit = pageLimit(input);
      const cursor = decodeCursor(input.cursor);
      const values: unknown[] = [];
      let cursorSql = '';
      if (cursor) {
        if (Number.isNaN(Date.parse(cursor.sortKey))) {
          throw new DomainError({
            code: 'INVALID_REQUEST',
            detail: 'Курсор страницы недействителен.',
            status: 400,
            title: 'Некорректный запрос',
          });
        }
        values.push(cursor.sortKey, cursor.id);
        cursorSql = 'WHERE (batch.created_at, batch.id) < ($1::timestamptz, $2::uuid)';
      }
      values.push(limit + 1);
      const limitParameter = `$${values.length}`;
      const result = await pool.query<
        BatchRow & {
          actual_card_count: number;
          closed_card_count: number;
          planned_card_count: number;
          set_count: number;
        }
      >(
        `SELECT batch.id, batch.quantity, batch.passport_code_snapshot,
                batch.passport_revision_snapshot, batch.product_name_snapshot,
                batch.lifecycle_status, batch.final_acceptance_id, batch.version,
                batch.created_at, batch.released_at, batch.final_accepted_at,
                COALESCE(counts.set_count, 0)::integer AS set_count,
                COALESCE(counts.planned_card_count, 0)::integer AS planned_card_count,
                COALESCE(counts.actual_card_count, 0)::integer AS actual_card_count,
                COALESCE(counts.closed_card_count, 0)::integer AS closed_card_count
         FROM production_batches AS batch
         LEFT JOIN LATERAL (
           SELECT
             (SELECT COUNT(*)::integer
              FROM work_card_sets AS card_set
              WHERE card_set.batch_id = batch.id) AS set_count,
             (SELECT COALESCE(SUM(snapshot.planned_card_count), 0)::integer
              FROM batch_operation_plan_snapshots AS snapshot
              WHERE snapshot.batch_id = batch.id) AS planned_card_count,
             (SELECT COUNT(*)::integer
              FROM work_cards AS card
              WHERE card.batch_id = batch.id) AS actual_card_count,
             (SELECT COUNT(*)::integer
              FROM work_cards AS card
              WHERE card.batch_id = batch.id AND card.status = 'CLOSED') AS closed_card_count
         ) AS counts ON true
         ${cursorSql}
         ORDER BY batch.created_at DESC, batch.id DESC
         LIMIT ${limitParameter}`,
        values,
      );
      const page = result.rows.slice(0, limit);
      const items = page.map((row) => ({
        id: row.id,
        quantity: row.quantity,
        lifecycleStatus: row.lifecycle_status,
        version: row.version,
        passportSnapshot: {
          code: row.passport_code_snapshot,
          revision: row.passport_revision_snapshot,
          productName: row.product_name_snapshot,
        },
        counts: {
          setCount: row.set_count,
          plannedCardCount: row.planned_card_count,
          actualCardCount: row.actual_card_count,
          closedCardCount: row.closed_card_count,
        },
        createdAt: iso(row.created_at),
      }));
      const last = page.at(-1);
      return {
        items,
        nextCursor:
          result.rows.length > limit && last ? encodeCursor(iso(last.created_at), last.id) : null,
      };
    },

    async getBatch(actor: ActorContext, batchId: string): Promise<ProductionBatchDetail> {
      const batchResult = await pool.query<
        BatchRow & {
          actual_card_count: number;
          closed_card_count: number;
          planned_card_count: number;
          set_count: number;
        }
      >(
        `SELECT batch.id, batch.quantity, batch.passport_code_snapshot,
                batch.passport_revision_snapshot, batch.product_name_snapshot,
                batch.lifecycle_status, batch.final_acceptance_id, batch.version,
                batch.created_at, batch.released_at, batch.final_accepted_at,
                COALESCE(counts.set_count, 0)::integer AS set_count,
                COALESCE(counts.planned_card_count, 0)::integer AS planned_card_count,
                COALESCE(counts.actual_card_count, 0)::integer AS actual_card_count,
                COALESCE(counts.closed_card_count, 0)::integer AS closed_card_count
         FROM production_batches AS batch
         LEFT JOIN LATERAL (
           SELECT
             (SELECT COUNT(*)::integer
              FROM work_card_sets AS card_set
              WHERE card_set.batch_id = batch.id) AS set_count,
             (SELECT COALESCE(SUM(snapshot.planned_card_count), 0)::integer
              FROM batch_operation_plan_snapshots AS snapshot
              WHERE snapshot.batch_id = batch.id) AS planned_card_count,
             (SELECT COUNT(*)::integer
              FROM work_cards AS card
              WHERE card.batch_id = batch.id) AS actual_card_count,
             (SELECT COUNT(*)::integer
              FROM work_cards AS card
              WHERE card.batch_id = batch.id AND card.status = 'CLOSED') AS closed_card_count
         ) AS counts ON true
         WHERE batch.id = $1`,
        [batchId],
      );
      const batch = batchResult.rows[0];
      if (!batch) throw resourceNotFound();
      const setsResult = await pool.query<
        SetRow & { actual_card_count: number; closed_card_count: number }
      >(
        `SELECT card_set.id, card_set.batch_id, card_set.scope_code_snapshot,
                card_set.scope_name_snapshot, card_set.norm_hours_snapshot::text,
                card_set.planned_card_count, card_set.gate_status,
                card_set.first_article_work_card_id, card_set.version,
                COUNT(card.id)::integer AS actual_card_count,
                COUNT(card.id) FILTER (WHERE card.status = 'CLOSED')::integer AS closed_card_count
         FROM work_card_sets AS card_set
         LEFT JOIN work_cards AS card ON card.work_card_set_id = card_set.id
         WHERE card_set.batch_id = $1
         GROUP BY card_set.id
         ORDER BY card_set.scope_code_snapshot, card_set.id`,
        [batchId],
      );
      const sets: WorkCardSetSummary[] = setsResult.rows.map((row) => ({
        id: row.id,
        scopeCode: row.scope_code_snapshot,
        scopeName: row.scope_name_snapshot,
        normHours: row.norm_hours_snapshot,
        plannedCardCount: row.planned_card_count,
        actualCardCount: row.actual_card_count,
        closedCardCount: row.closed_card_count,
        gateStatus: row.gate_status,
        version: row.version,
      }));
      let finalAcceptance: FinalBatchAcceptance | null = null;
      if (batch.final_acceptance_id) {
        const acceptanceResult = await pool.query<{
          accepted_at: Date | string;
          batch_id: string;
          command_id: string;
          controller_display_name: string;
          controller_id: string;
          id: string;
          resulting_batch_version: number;
        }>(
          `SELECT acceptance.id, acceptance.batch_id, acceptance.controller_id,
                  controller.display_name AS controller_display_name,
                  acceptance.accepted_at, acceptance.command_id,
                  acceptance.resulting_batch_version
           FROM final_batch_acceptances AS acceptance
           JOIN demo_users AS controller ON controller.id = acceptance.controller_id
           WHERE acceptance.id = $1`,
          [batch.final_acceptance_id],
        );
        const acceptance = acceptanceResult.rows[0];
        if (!acceptance) throw new Error('Связанная final acceptance не найдена.');
        finalAcceptance = {
          id: acceptance.id,
          batchId: acceptance.batch_id,
          controller: {
            id: acceptance.controller_id,
            displayName: acceptance.controller_display_name,
          },
          acceptedAt: iso(acceptance.accepted_at),
          commandId: acceptance.command_id,
          resultingBatchVersion: acceptance.resulting_batch_version,
        };
      }
      const availableActions: CommandName[] = [];
      if (actor.role === 'PLANNER' && batch.lifecycle_status === 'CREATED') {
        availableActions.push('ReleaseWorkCards');
      }
      const finalReady =
        batch.lifecycle_status === 'RELEASED' &&
        sets.length > 0 &&
        sets.every(
          (cardSet) =>
            cardSet.gateStatus === 'SERIAL_ALLOWED' &&
            cardSet.actualCardCount === cardSet.plannedCardCount &&
            cardSet.closedCardCount === cardSet.actualCardCount,
        );
      if (actor.role === 'QUALITY_CONTROLLER' && finalReady) {
        availableActions.push('RecordFinalBatchAcceptance');
      }
      return {
        id: batch.id,
        quantity: batch.quantity,
        lifecycleStatus: batch.lifecycle_status,
        version: batch.version,
        passportSnapshot: {
          code: batch.passport_code_snapshot,
          revision: batch.passport_revision_snapshot,
          productName: batch.product_name_snapshot,
        },
        counts: {
          setCount: batch.set_count,
          plannedCardCount: batch.planned_card_count,
          actualCardCount: batch.actual_card_count,
          closedCardCount: batch.closed_card_count,
        },
        sets,
        finalAcceptance,
        availableActions,
        createdAt: iso(batch.created_at),
        releasedAt: nullableIso(batch.released_at),
        finalAcceptedAt: nullableIso(batch.final_accepted_at),
      };
    },

    async getWorkCardSet(actor: ActorContext, setId: string): Promise<WorkCardSetDetail> {
      const setResult = await pool.query<SetRow & { actual_card_count: number }>(
        `SELECT card_set.id, card_set.batch_id, card_set.scope_code_snapshot,
                card_set.scope_name_snapshot, card_set.norm_hours_snapshot::text,
                card_set.planned_card_count, card_set.gate_status,
                card_set.first_article_work_card_id, card_set.version,
                COUNT(card.id)::integer AS actual_card_count
         FROM work_card_sets AS card_set
         LEFT JOIN work_cards AS card ON card.work_card_set_id = card_set.id
         WHERE card_set.id = $1
         GROUP BY card_set.id`,
        [setId],
      );
      const cardSet = setResult.rows[0];
      if (!cardSet) throw resourceNotFound();
      const statusResult = await pool.query<{ count: number; status: WorkCardStatus }>(
        `SELECT status, COUNT(*)::integer AS count
         FROM work_cards WHERE work_card_set_id = $1 GROUP BY status`,
        [setId],
      );
      const statusCounts: Record<WorkCardStatus, number> = {
        RELEASED: 0,
        ASSIGNED: 0,
        IN_PROGRESS: 0,
        COMPLETED: 0,
        CLOSED: 0,
      };
      for (const row of statusResult.rows) statusCounts[row.status] = row.count;
      const assignmentValues: unknown[] = [setId];
      let assignmentVisibility = '';
      if (actor.role === 'WORKER') {
        assignmentValues.push(actor.id);
        assignmentVisibility = 'AND card.assignee_id = $2';
      }
      const assignmentResult = await pool.query<{
        assignee_id: string;
        count: number;
        display_name: string;
        purpose: WorkCardPurpose;
      }>(
        `SELECT card.assignee_id, assignee.display_name, card.purpose,
                COUNT(*)::integer AS count
         FROM work_cards AS card
         JOIN demo_users AS assignee ON assignee.id = card.assignee_id
         WHERE card.work_card_set_id = $1 ${assignmentVisibility}
         GROUP BY card.assignee_id, assignee.display_name, card.purpose
         ORDER BY assignee.display_name, card.purpose`,
        assignmentValues,
      );
      const availableActions: CommandName[] = [];
      if (actor.role === 'MASTER' && statusCounts.RELEASED > 0) {
        if (
          (cardSet.gate_status === 'FIRST_ARTICLE_PENDING' &&
            cardSet.first_article_work_card_id === null) ||
          cardSet.gate_status === 'SERIAL_ALLOWED'
        ) {
          availableActions.push('AssignWorkCards');
        }
      }
      return {
        id: cardSet.id,
        batchId: cardSet.batch_id,
        scopeCode: cardSet.scope_code_snapshot,
        scopeName: cardSet.scope_name_snapshot,
        normHours: cardSet.norm_hours_snapshot,
        plannedCardCount: cardSet.planned_card_count,
        actualCardCount: cardSet.actual_card_count,
        gateStatus: cardSet.gate_status,
        firstArticleWorkCardId: cardSet.first_article_work_card_id,
        version: cardSet.version,
        statusCounts,
        assignmentCounts: assignmentResult.rows.map((row) => ({
          assignee: { id: row.assignee_id, displayName: row.display_name },
          purpose: row.purpose,
          count: row.count,
        })),
        availableActions,
      };
    },

    async listWorkCards(
      actor: ActorContext,
      setId: string,
      input: PageInput & { assigneeId?: string; status?: WorkCardStatus },
    ): Promise<{ items: WorkCard[]; nextCursor: string | null }> {
      const setExists = await pool.query('SELECT 1 FROM work_card_sets WHERE id = $1', [setId]);
      if (setExists.rowCount === 0) throw resourceNotFound();
      if (actor.role === 'WORKER' && input.assigneeId && input.assigneeId !== actor.id) {
        throw resourceNotFound();
      }
      const limit = pageLimit(input);
      const cursor = decodeCursor(input.cursor);
      const values: unknown[] = [setId];
      const clauses = ['card.work_card_set_id = $1'];
      if (cursor) {
        values.push(cursor.id);
        clauses.push(`card.id > $${values.length}::uuid`);
      }
      if (input.status) {
        values.push(input.status);
        clauses.push(`card.status = $${values.length}`);
      }
      const assigneeId = actor.role === 'WORKER' ? actor.id : input.assigneeId;
      if (assigneeId) {
        values.push(assigneeId);
        clauses.push(`card.assignee_id = $${values.length}::uuid`);
      }
      values.push(limit + 1);
      const result = await pool.query<CardRow>(
        `SELECT card.id, card.work_card_set_id, card.batch_id,
                card.batch_quantity_snapshot, card.scope_code_snapshot,
                card.scope_name_snapshot, card.norm_hours_snapshot::text,
                card.purpose, card.status, card.closure_type, card.assignee_id,
                assignee.display_name AS assignee_display_name, card.version,
                card.released_at, card.assigned_at, card.started_at, card.completed_at,
                card.closed_at, card_set.gate_status, card_set.first_article_work_card_id
         FROM work_cards AS card
         JOIN work_card_sets AS card_set ON card_set.id = card.work_card_set_id
         LEFT JOIN demo_users AS assignee ON assignee.id = card.assignee_id
         WHERE ${clauses.join(' AND ')}
         ORDER BY card.id
         LIMIT $${values.length}`,
        values,
      );
      const page = result.rows.slice(0, limit);
      const last = page.at(-1);
      return {
        items: page.map((row) => toWorkCard(row, actor)),
        nextCursor: result.rows.length > limit && last ? encodeCursor(last.id, last.id) : null,
      };
    },

    async getWorkCard(actor: ActorContext, workCardId: string): Promise<WorkCard> {
      const card = await loadCard(pool, workCardId);
      if (!card || (actor.role === 'WORKER' && card.assignee_id !== actor.id)) {
        throw resourceNotFound();
      }
      return toWorkCard(card, actor);
    },

    async getWorkCardHistory(
      workCardId: string,
      input: PageInput,
    ): Promise<{
      events: AuditEvent[];
      nextCursor: string | null;
    }> {
      const exists = await pool.query('SELECT 1 FROM work_cards WHERE id = $1', [workCardId]);
      if (exists.rowCount === 0) throw resourceNotFound();
      const limit = pageLimit(input);
      const cursor = decodeCursor(input.cursor);
      const values: unknown[] = [workCardId];
      let cursorSql = '';
      if (cursor) {
        const aggregateVersion = Number(cursor.sortKey);
        if (!Number.isInteger(aggregateVersion) || aggregateVersion < 1) {
          throw new DomainError({
            code: 'INVALID_REQUEST',
            detail: 'Курсор страницы недействителен.',
            status: 400,
            title: 'Некорректный запрос',
          });
        }
        values.push(aggregateVersion, cursor.id);
        cursorSql = `AND (aggregate_version, id) > ($2::integer, $3::uuid)`;
      }
      values.push(limit + 1);
      const result = await pool.query<AuditRow>(
        `SELECT id, event_type, aggregate_type, aggregate_id, aggregate_version,
                occurred_at, actor_id, actor_role, command_id, correlation_id, payload
         FROM audit_events
         WHERE aggregate_type = 'WorkCard' AND aggregate_id = $1 ${cursorSql}
         ORDER BY aggregate_version, id
         LIMIT $${values.length}`,
        values,
      );
      const page = result.rows.slice(0, limit);
      const last = page.at(-1);
      return {
        events: page.map(auditRow),
        nextCursor:
          result.rows.length > limit && last
            ? encodeCursor(String(last.aggregate_version), last.id)
            : null,
      };
    },

    async getAuditCorrelation(
      correlationId: string,
      input: PageInput,
    ): Promise<{
      commandId: string;
      commandType: CommandName;
      correlationId: string;
      events: AuditEvent[];
      expectedEventCount: number;
      nextCursor: string | null;
      totalEventCount: number;
    }> {
      const receiptResult = await pool.query<{
        command_id: string;
        command_type: CommandName;
        event_count: number;
      }>(
        `SELECT command_id, command_type, event_count
         FROM command_receipts
         WHERE correlation_id = $1 AND state = 'SUCCEEDED'`,
        [correlationId],
      );
      const receipt = receiptResult.rows[0];
      if (!receipt) throw resourceNotFound();
      const totalResult = await pool.query<{ count: number }>(
        'SELECT COUNT(*)::integer AS count FROM audit_events WHERE correlation_id = $1',
        [correlationId],
      );
      const totalEventCount = totalResult.rows[0]?.count ?? 0;
      if (totalEventCount !== receipt.event_count) {
        throw new DomainError({
          code: 'AUDIT_INTEGRITY_ERROR',
          detail: 'Полный набор событий команды не прошёл проверку целостности.',
          status: 500,
          title: 'Нарушена целостность аудита',
        });
      }
      const limit = pageLimit(input);
      const cursor = decodeCursor(input.cursor);
      const values: unknown[] = [correlationId];
      let cursorSql = '';
      if (cursor) {
        if (Number.isNaN(Date.parse(cursor.sortKey))) {
          throw new DomainError({
            code: 'INVALID_REQUEST',
            detail: 'Курсор страницы недействителен.',
            status: 400,
            title: 'Некорректный запрос',
          });
        }
        values.push(cursor.sortKey, cursor.id);
        cursorSql = `AND (occurred_at, id) > ($2::timestamptz, $3::uuid)`;
      }
      values.push(limit + 1);
      const eventsResult = await pool.query<AuditRow>(
        `SELECT id, event_type, aggregate_type, aggregate_id, aggregate_version,
                occurred_at, actor_id, actor_role, command_id, correlation_id, payload
         FROM audit_events
         WHERE correlation_id = $1 ${cursorSql}
         ORDER BY occurred_at, id
         LIMIT $${values.length}`,
        values,
      );
      const page = eventsResult.rows.slice(0, limit);
      const last = page.at(-1);
      return {
        correlationId,
        commandId: receipt.command_id,
        commandType: receipt.command_type,
        expectedEventCount: receipt.event_count,
        totalEventCount,
        events: page.map(auditRow),
        nextCursor:
          eventsResult.rows.length > limit && last
            ? encodeCursor(iso(last.occurred_at), last.id)
            : null,
      };
    },

    async getPayrollRecord(workCardId: string): Promise<PayrollRecord> {
      const record = await loadPayrollRecord(pool, workCardId);
      if (!record) throw resourceNotFound();
      return toPayrollRecord(record);
    },
  };
}

export type WorkflowService = ReturnType<typeof createWorkflowService>;

export type CommandResult<T> = CommandExecution<T>;
