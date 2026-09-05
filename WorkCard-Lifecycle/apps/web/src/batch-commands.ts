import {
  CreateBatchResponseSchema,
  ProductionBatchDetailSchema,
  ReleaseWorkCardsResponseSchema,
  type CreateProductionBatchBody,
  type PassportSnapshot,
  type ProductionBatchDetail,
  type ReleaseWorkCardsBody,
  type ReleaseWorkCardsResponse,
} from '@work-card/contracts';

import {
  contractResponse,
  type ApiClient,
  type ApiRequestContext,
  type ApiV1Path,
} from './api-client.js';
import { CommandIntegrityError } from './command-recovery.js';

export type CreateBatchInput = Readonly<{
  productionPassportId: string;
  quantity: number;
  signal?: AbortSignal;
}>;

export type ReleaseBatchInput = Readonly<{
  batchId: string;
  expectedBatchVersion: number;
  signal?: AbortSignal;
}>;

export type ConfirmedBatchCommand = Readonly<{
  batch: ProductionBatchDetail;
  commandContext: ApiRequestContext;
  correlationId: string;
  readBackContext: ApiRequestContext;
}>;

export type BatchCommandClient = Readonly<{
  createBatch: (input: CreateBatchInput) => Promise<ConfirmedBatchCommand>;
  releaseBatch: (input: ReleaseBatchInput) => Promise<ConfirmedBatchCommand>;
}>;

export class BatchCommandIntegrityError extends CommandIntegrityError {
  readonly commandContext: ApiRequestContext;
  readonly correlationId: string;
  readonly readBackContext: ApiRequestContext;

  constructor(
    message: string,
    context: {
      commandContext: ApiRequestContext;
      correlationId: string;
      readBackContext: ApiRequestContext;
    },
  ) {
    super(message);
    this.name = 'BatchCommandIntegrityError';
    this.commandContext = context.commandContext;
    this.correlationId = context.correlationId;
    this.readBackContext = context.readBackContext;
  }
}

function batchPath(batchId: string): ApiV1Path {
  return `/api/v1/production-batches/${encodeURIComponent(batchId)}`;
}

function snapshotsMatch(left: PassportSnapshot, right: PassportSnapshot): boolean {
  return (
    left.code === right.code &&
    left.revision === right.revision &&
    left.productName === right.productName
  );
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export function releasedBatchIntegrityIssue(
  batch: ProductionBatchDetail,
  command?: ReleaseWorkCardsResponse,
): string | null {
  const plannedByPlan = sum(batch.operationPlan.map((operation) => operation.plannedCardCount));
  const plannedBySets = sum(batch.sets.map((cardSet) => cardSet.plannedCardCount));
  const actualBySets = sum(batch.sets.map((cardSet) => cardSet.actualCardCount));

  if (batch.lifecycleStatus === 'CREATED') return 'Партия осталась в состоянии до выпуска.';
  if (batch.operationPlan.length === 0) return 'Снимок плана партии пуст.';
  if (batch.sets.length !== batch.operationPlan.length) {
    return 'Число комплектов не совпадает со снимком плана партии.';
  }
  if (
    new Set(batch.operationPlan.map((operation) => operation.scopeCode)).size !==
      batch.operationPlan.length ||
    new Set(batch.sets.map((cardSet) => cardSet.scopeCode)).size !== batch.sets.length
  ) {
    return 'Группы операций в плане или комплектах повторяются.';
  }
  if (batch.counts.setCount !== batch.sets.length) {
    return 'Итог комплектов не совпадает с перечитанным составом партии.';
  }
  if (
    plannedByPlan !== batch.counts.plannedCardCount ||
    plannedBySets !== batch.counts.plannedCardCount
  ) {
    return 'Плановое число карточек не совпадает в итогах, плане и комплектах.';
  }
  if (
    actualBySets !== batch.counts.actualCardCount ||
    batch.counts.actualCardCount !== batch.counts.plannedCardCount
  ) {
    return 'Фактическое число карточек не подтверждает полный выпуск.';
  }

  const planByScope = new Map(
    batch.operationPlan.map((operation) => [operation.scopeCode, operation]),
  );
  const setsMatchPlan = batch.sets.every((cardSet) => {
    const operation = planByScope.get(cardSet.scopeCode);
    return Boolean(
      operation &&
      operation.scopeName === cardSet.scopeName &&
      operation.normHours === cardSet.normHours &&
      operation.plannedCardCount === cardSet.plannedCardCount &&
      cardSet.actualCardCount === cardSet.plannedCardCount,
    );
  });
  if (!setsMatchPlan) return 'Хотя бы один комплект не совпадает со снимком плана партии.';

  if (
    command &&
    (command.batchId !== batch.id ||
      command.lifecycleStatus !== 'RELEASED' ||
      command.setCount !== batch.counts.setCount ||
      command.plannedCardCount !== batch.counts.plannedCardCount ||
      command.actualCardCount !== batch.counts.actualCardCount ||
      command.batchVersion > batch.version)
  ) {
    return 'Ответ команды не совпадает с перечитанной партией.';
  }

  return null;
}

function integrityContext(
  commandContext: ApiRequestContext,
  correlationId: string,
  readBackContext: ApiRequestContext,
) {
  return { commandContext, correlationId, readBackContext };
}

export function createBatchCommandClient(
  api: ApiClient,
  createCommandId: () => string = () => globalThis.crypto.randomUUID(),
): BatchCommandClient {
  return {
    async createBatch(input) {
      const body: CreateProductionBatchBody = {
        commandId: createCommandId(),
        productionPassportId: input.productionPassportId,
        quantity: input.quantity,
      };
      const completion = await api.mutate({
        body,
        path: '/api/v1/production-batches',
        readBack: (command) => ({
          path: batchPath(command.data.batch.id),
          response: contractResponse(ProductionBatchDetailSchema),
        }),
        response: contractResponse(CreateBatchResponseSchema),
        ...(input.signal ? { signal: input.signal } : {}),
      });
      const command = completion.command.data;
      const batch = completion.readBack.data;
      const context = integrityContext(
        completion.command.context,
        command.correlationId,
        completion.readBack.context,
      );
      const commandMatchesInput =
        command.batch.quantity === input.quantity &&
        command.batch.lifecycleStatus === 'CREATED' &&
        command.batch.version === 1 &&
        command.batch.counts.setCount === 0 &&
        command.batch.counts.actualCardCount === 0 &&
        command.batch.counts.closedCardCount === 0 &&
        command.batch.counts.plannedCardCount > 0;
      const readBackMatchesCommand =
        batch.id === command.batch.id &&
        batch.quantity === command.batch.quantity &&
        snapshotsMatch(batch.passportSnapshot, command.batch.passportSnapshot) &&
        batch.counts.plannedCardCount === command.batch.counts.plannedCardCount &&
        batch.version >= command.batch.version;
      const planTotal = sum(batch.operationPlan.map((operation) => operation.plannedCardCount));

      if (
        !commandMatchesInput ||
        !readBackMatchesCommand ||
        batch.operationPlan.length === 0 ||
        planTotal !== batch.counts.plannedCardCount
      ) {
        throw new BatchCommandIntegrityError(
          'Ответ создания не совпадает с контрольным чтением партии.',
          context,
        );
      }

      return {
        batch,
        commandContext: completion.command.context,
        correlationId: command.correlationId,
        readBackContext: completion.readBack.context,
      };
    },

    async releaseBatch(input) {
      const body: ReleaseWorkCardsBody = {
        commandId: createCommandId(),
        expectedBatchVersion: input.expectedBatchVersion,
      };
      const completion = await api.mutate({
        body,
        path: `${batchPath(input.batchId)}/release`,
        readBack: () => ({
          path: batchPath(input.batchId),
          response: contractResponse(ProductionBatchDetailSchema),
        }),
        response: contractResponse(ReleaseWorkCardsResponseSchema),
        ...(input.signal ? { signal: input.signal } : {}),
      });
      const command = completion.command.data;
      const batch = completion.readBack.data;
      const context = integrityContext(
        completion.command.context,
        command.correlationId,
        completion.readBack.context,
      );
      const issue = releasedBatchIntegrityIssue(batch, command);

      if (
        command.batchId !== input.batchId ||
        command.batchVersion <= input.expectedBatchVersion ||
        issue
      ) {
        throw new BatchCommandIntegrityError(
          issue ?? 'Версия партии не увеличилась после выпуска.',
          context,
        );
      }

      return {
        batch,
        commandContext: completion.command.context,
        correlationId: command.correlationId,
        readBackContext: completion.readBack.context,
      };
    },
  };
}
