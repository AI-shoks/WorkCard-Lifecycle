import {
  FinalBatchAcceptanceResponseSchema,
  FirstArticleAcceptanceResponseSchema,
  ProductionBatchDetailSchema,
  WorkCardCommandResponseSchema,
  WorkCardSchema,
  WorkCardSetDetailSchema,
  type AcceptFirstArticleBody,
  type CardVersionCommandBody,
  type FinalBatchAcceptance,
  type FinalBatchAcceptanceResponse,
  type FirstArticleAcceptanceResponse,
  type ProductionBatchDetail,
  type ReleaseWorkCardsBody,
  type WorkCard,
  type WorkCardSetDetail,
} from '@work-card/contracts';

import {
  contractResponse,
  type ApiClient,
  type ApiRequestContext,
  type ApiV1Path,
} from './api-client.js';
import { CommandIntegrityError } from './command-recovery.js';

export type QualityCardInput = Readonly<{
  card: WorkCard;
  signal?: AbortSignal;
}>;

export type FinalBatchAcceptanceInput = Readonly<{
  batch: ProductionBatchDetail;
  signal?: AbortSignal;
}>;

export type ConfirmedFirstArticleAcceptance = Readonly<{
  card: WorkCard;
  commandContext: ApiRequestContext;
  correlationId: string;
  readBackContexts: readonly ApiRequestContext[];
  set: WorkCardSetDetail;
}>;

export type ConfirmedQualityCard = Readonly<{
  card: WorkCard;
  commandContext: ApiRequestContext;
  correlationId: string;
  readBackContext: ApiRequestContext;
}>;

export type ConfirmedFinalBatchAcceptance = Readonly<{
  acceptance: FinalBatchAcceptance;
  batch: ProductionBatchDetail;
  commandContext: ApiRequestContext;
  correlationId: string;
  readBackContext: ApiRequestContext;
}>;

export type QualityCommandClient = Readonly<{
  acceptFirstArticle: (input: QualityCardInput) => Promise<ConfirmedFirstArticleAcceptance>;
  confirmWorkCardQuality: (input: QualityCardInput) => Promise<ConfirmedQualityCard>;
  recordFinalBatchAcceptance: (
    input: FinalBatchAcceptanceInput,
  ) => Promise<ConfirmedFinalBatchAcceptance>;
}>;

export class QualityCommandIntegrityError extends CommandIntegrityError {
  readonly commandContext: ApiRequestContext | null;
  readonly correlationId: string | null;
  readonly readBackContexts: readonly ApiRequestContext[];

  constructor(
    message: string,
    context: {
      commandContext?: ApiRequestContext;
      correlationId?: string;
      readBackContexts?: readonly ApiRequestContext[];
    } = {},
  ) {
    super(message);
    this.name = 'QualityCommandIntegrityError';
    this.commandContext = context.commandContext ?? null;
    this.correlationId = context.correlationId ?? null;
    this.readBackContexts = context.readBackContexts ?? [];
  }
}

function setPath(setId: string): ApiV1Path {
  return `/api/v1/work-card-sets/${encodeURIComponent(setId)}`;
}

function cardPath(workCardId: string): ApiV1Path {
  return `/api/v1/work-cards/${encodeURIComponent(workCardId)}`;
}

function batchPath(batchId: string): ApiV1Path {
  return `/api/v1/production-batches/${encodeURIComponent(batchId)}`;
}

function sameAssignee(left: WorkCard['assignee'], right: WorkCard['assignee']): boolean {
  return left?.id === right?.id && left?.displayName === right?.displayName;
}

function immutableCardContextMatches(left: WorkCard, right: WorkCard): boolean {
  return (
    left.id === right.id &&
    left.workCardSetId === right.workCardSetId &&
    left.batchId === right.batchId &&
    left.batchQuantitySnapshot === right.batchQuantitySnapshot &&
    left.operation.scopeCode === right.operation.scopeCode &&
    left.operation.scopeName === right.operation.scopeName &&
    left.operation.normHours === right.operation.normHours &&
    left.timestamps.releasedAt === right.timestamps.releasedAt
  );
}

function cardReadBackMatches(commandCard: WorkCard, readBackCard: WorkCard): boolean {
  return (
    immutableCardContextMatches(commandCard, readBackCard) &&
    commandCard.purpose === readBackCard.purpose &&
    commandCard.status === readBackCard.status &&
    commandCard.closureType === readBackCard.closureType &&
    sameAssignee(commandCard.assignee, readBackCard.assignee) &&
    commandCard.version === readBackCard.version &&
    commandCard.timestamps.assignedAt === readBackCard.timestamps.assignedAt &&
    commandCard.timestamps.startedAt === readBackCard.timestamps.startedAt &&
    commandCard.timestamps.completedAt === readBackCard.timestamps.completedAt &&
    commandCard.timestamps.closedAt === readBackCard.timestamps.closedAt
  );
}

function closedCardIntegrityIssue(
  previousCard: WorkCard,
  commandCard: WorkCard,
  readBackCard: WorkCard,
  expectedPurpose: 'FIRST_ARTICLE' | 'SERIAL',
  expectedClosureType: 'FIRST_ARTICLE_ACCEPTANCE' | 'SERIAL_QUALITY_CONFIRMATION',
): string | null {
  if (
    previousCard.status !== 'COMPLETED' ||
    previousCard.purpose !== expectedPurpose ||
    !immutableCardContextMatches(previousCard, commandCard) ||
    !sameAssignee(previousCard.assignee, commandCard.assignee) ||
    commandCard.purpose !== expectedPurpose ||
    commandCard.status !== 'CLOSED' ||
    commandCard.closureType !== expectedClosureType ||
    commandCard.version !== previousCard.version + 1 ||
    !commandCard.timestamps.closedAt ||
    commandCard.timestamps.assignedAt !== previousCard.timestamps.assignedAt ||
    commandCard.timestamps.startedAt !== previousCard.timestamps.startedAt ||
    commandCard.timestamps.completedAt !== previousCard.timestamps.completedAt
  ) {
    return 'Ответ команды не подтверждает положительное закрытие выбранной карточки.';
  }
  if (!cardReadBackMatches(commandCard, readBackCard)) {
    return 'Контрольное чтение карточки не совпадает с ответом команды.';
  }
  return null;
}

function statusTotal(cardSet: WorkCardSetDetail): number {
  return Object.values(cardSet.statusCounts).reduce((total, count) => total + count, 0);
}

function firstArticleIntegrityIssue(
  previousCard: WorkCard,
  previousSet: WorkCardSetDetail,
  command: FirstArticleAcceptanceResponse,
  currentCard: WorkCard,
  currentSet: WorkCardSetDetail,
): string | null {
  const cardIssue = closedCardIntegrityIssue(
    previousCard,
    command.workCard,
    currentCard,
    'FIRST_ARTICLE',
    'FIRST_ARTICLE_ACCEPTANCE',
  );
  if (cardIssue) return cardIssue;
  if (
    previousSet.id !== previousCard.workCardSetId ||
    previousSet.firstArticleWorkCardId !== previousCard.id ||
    previousSet.gateStatus !== 'FIRST_ARTICLE_PENDING'
  ) {
    return 'Исходные данные не подтверждают зарегистрированную первую деталь.';
  }
  if (
    command.workCardSetId !== previousSet.id ||
    command.gateStatus !== 'SERIAL_ALLOWED' ||
    command.setVersion !== previousSet.version + 1
  ) {
    return 'Ответ команды не подтверждает открытие обработки партии.';
  }
  if (
    currentSet.id !== previousSet.id ||
    currentSet.batchId !== previousSet.batchId ||
    currentSet.scopeCode !== previousSet.scopeCode ||
    currentSet.scopeName !== previousSet.scopeName ||
    currentSet.normHours !== previousSet.normHours ||
    currentSet.plannedCardCount !== previousSet.plannedCardCount ||
    currentSet.actualCardCount !== previousSet.actualCardCount ||
    currentSet.firstArticleWorkCardId !== previousCard.id ||
    currentSet.gateStatus !== 'SERIAL_ALLOWED' ||
    currentSet.version < command.setVersion ||
    currentSet.statusCounts.CLOSED !== previousSet.statusCounts.CLOSED + 1 ||
    currentSet.statusCounts.COMPLETED !== previousSet.statusCounts.COMPLETED - 1 ||
    statusTotal(currentSet) !== currentSet.actualCardCount
  ) {
    return 'Контрольное чтение комплекта не подтверждает атомарную приёмку первой детали.';
  }
  return null;
}

function batchCompletionIssues(batch: ProductionBatchDetail): string[] {
  const issues: string[] = [];
  const requiredSetCount = batch.operationPlan.length;
  const allowedGates = batch.sets.filter(
    (cardSet) => cardSet.gateStatus === 'SERIAL_ALLOWED',
  ).length;
  const plannedBySets = batch.sets.reduce((total, cardSet) => total + cardSet.plannedCardCount, 0);
  const plannedByPlan = batch.operationPlan.reduce(
    (total, operation) => total + operation.plannedCardCount,
    0,
  );
  const actualBySets = batch.sets.reduce((total, cardSet) => total + cardSet.actualCardCount, 0);
  const closedBySets = batch.sets.reduce((total, cardSet) => total + cardSet.closedCardCount, 0);
  const scopesMatch =
    new Set(batch.operationPlan.map((operation) => operation.scopeCode)).size ===
      requiredSetCount &&
    new Set(batch.sets.map((cardSet) => cardSet.id)).size === requiredSetCount &&
    new Set(batch.sets.map((cardSet) => cardSet.scopeCode)).size === requiredSetCount &&
    batch.operationPlan.every((operation) => {
      const cardSet = batch.sets.find((candidate) => candidate.scopeCode === operation.scopeCode);
      return (
        cardSet?.scopeName === operation.scopeName &&
        cardSet.normHours === operation.normHours &&
        cardSet.plannedCardCount === operation.plannedCardCount
      );
    });

  if (
    requiredSetCount === 0 ||
    batch.sets.length !== requiredSetCount ||
    batch.counts.setCount !== requiredSetCount ||
    allowedGates !== requiredSetCount
  ) {
    issues.push(
      `Требуется ${requiredSetCount} из ${requiredSetCount} принятых первых деталей; подтверждено ${allowedGates} из ${requiredSetCount}.`,
    );
  }
  if (!scopesMatch) {
    issues.push('Состав комплектов, группы операций и нормы должны совпадать с планом партии.');
  }
  if (
    plannedByPlan <= 0 ||
    batch.counts.plannedCardCount !== plannedByPlan ||
    batch.counts.actualCardCount !== plannedByPlan ||
    batch.counts.closedCardCount !== plannedByPlan ||
    plannedBySets !== plannedByPlan ||
    actualBySets !== plannedByPlan ||
    closedBySets !== plannedByPlan ||
    batch.sets.some(
      (cardSet) =>
        cardSet.actualCardCount !== cardSet.plannedCardCount ||
        cardSet.closedCardCount !== cardSet.actualCardCount,
    )
  ) {
    issues.push(
      `Требуется ${plannedByPlan} из ${plannedByPlan} закрытых карточек полного выпуска; подтверждено ${batch.counts.closedCardCount} из ${plannedByPlan}.`,
    );
  }
  return issues;
}

export function finalAcceptanceReadinessIssues(batch: ProductionBatchDetail): string[] {
  const issues = batchCompletionIssues(batch);
  if (batch.lifecycleStatus !== 'RELEASED') {
    issues.push(
      batch.lifecycleStatus === 'FINAL_ACCEPTED'
        ? 'Финальная приёмка уже записана.'
        : 'Сначала требуется атомарно выпустить все комплекты.',
    );
  }
  if (batch.finalAcceptance) issues.push('У партии уже есть запись финальной приёмки.');
  return issues;
}

function acceptanceMatches(left: FinalBatchAcceptance, right: FinalBatchAcceptance): boolean {
  return (
    left.id === right.id &&
    left.batchId === right.batchId &&
    left.controller.id === right.controller.id &&
    left.controller.displayName === right.controller.displayName &&
    left.acceptedAt === right.acceptedAt &&
    left.commandId === right.commandId &&
    left.resultingBatchVersion === right.resultingBatchVersion
  );
}

function immutableBatchContextMatches(
  previousBatch: ProductionBatchDetail,
  currentBatch: ProductionBatchDetail,
): boolean {
  return (
    previousBatch.id === currentBatch.id &&
    previousBatch.quantity === currentBatch.quantity &&
    previousBatch.createdAt === currentBatch.createdAt &&
    previousBatch.releasedAt === currentBatch.releasedAt &&
    previousBatch.passportSnapshot.code === currentBatch.passportSnapshot.code &&
    previousBatch.passportSnapshot.revision === currentBatch.passportSnapshot.revision &&
    previousBatch.passportSnapshot.productName === currentBatch.passportSnapshot.productName &&
    previousBatch.operationPlan.length === currentBatch.operationPlan.length &&
    previousBatch.operationPlan.every((operation, index) => {
      const current = currentBatch.operationPlan[index];
      return (
        current?.id === operation.id &&
        current.position === operation.position &&
        current.scopeCode === operation.scopeCode &&
        current.scopeName === operation.scopeName &&
        current.plannedCardCount === operation.plannedCardCount &&
        current.normHours === operation.normHours
      );
    })
  );
}

function finalAcceptanceIntegrityIssue(
  previousBatch: ProductionBatchDetail,
  command: FinalBatchAcceptanceResponse,
  currentBatch: ProductionBatchDetail,
  commandId: string,
): string | null {
  const acceptance = currentBatch.finalAcceptance;
  if (batchCompletionIssues(currentBatch).length > 0) {
    return 'Контрольное чтение не подтверждает приёмку первых деталей и закрытие всех карточек по плану партии.';
  }
  if (
    command.batchLifecycleStatus !== 'FINAL_ACCEPTED' ||
    command.acceptance.batchId !== previousBatch.id ||
    command.acceptance.commandId !== commandId ||
    command.acceptance.resultingBatchVersion !== previousBatch.version + 1 ||
    !command.acceptance.acceptedAt ||
    !command.acceptance.controller.id ||
    !command.acceptance.controller.displayName
  ) {
    return 'Ответ команды не содержит согласованный факт финальной приёмки.';
  }
  if (
    !immutableBatchContextMatches(previousBatch, currentBatch) ||
    currentBatch.lifecycleStatus !== 'FINAL_ACCEPTED' ||
    currentBatch.version !== command.acceptance.resultingBatchVersion ||
    currentBatch.finalAcceptedAt !== command.acceptance.acceptedAt ||
    !acceptance ||
    !acceptanceMatches(command.acceptance, acceptance)
  ) {
    return 'Контрольное чтение не подтвердило ID, контролёра, время и версию финальной приёмки.';
  }
  return null;
}

function integrityContext(
  commandContext: ApiRequestContext,
  correlationId: string,
  readBackContexts: readonly ApiRequestContext[],
) {
  return { commandContext, correlationId, readBackContexts };
}

export function createQualityCommandClient(
  api: ApiClient,
  createCommandId: () => string = () => globalThis.crypto.randomUUID(),
): QualityCommandClient {
  return {
    async acceptFirstArticle(input) {
      const initialSetResponse = await api.read({
        path: setPath(input.card.workCardSetId),
        response: contractResponse(WorkCardSetDetailSchema),
        ...(input.signal ? { signal: input.signal } : {}),
      });
      const initialSet = initialSetResponse.data;
      if (
        input.card.status !== 'COMPLETED' ||
        input.card.purpose !== 'FIRST_ARTICLE' ||
        initialSet.id !== input.card.workCardSetId ||
        initialSet.firstArticleWorkCardId !== input.card.id ||
        initialSet.gateStatus !== 'FIRST_ARTICLE_PENDING'
      ) {
        throw new QualityCommandIntegrityError(
          'Текущие чтения не подтверждают готовую к положительной приёмке первую деталь.',
          { readBackContexts: [initialSetResponse.context] },
        );
      }

      const body: AcceptFirstArticleBody = {
        commandId: createCommandId(),
        expectedCardVersion: input.card.version,
        expectedSetVersion: initialSet.version,
      };
      const completion = await api.mutate({
        body,
        path: `${setPath(initialSet.id)}/first-article-acceptance`,
        readBack: () => ({
          path: cardPath(input.card.id),
          response: contractResponse(WorkCardSchema),
        }),
        response: contractResponse(FirstArticleAcceptanceResponseSchema),
        ...(input.signal ? { signal: input.signal } : {}),
      });
      const setReadBack = await api.read({
        path: setPath(initialSet.id),
        response: contractResponse(WorkCardSetDetailSchema),
        ...(input.signal ? { signal: input.signal } : {}),
      });
      const command = completion.command.data;
      const issue = firstArticleIntegrityIssue(
        input.card,
        initialSet,
        command,
        completion.readBack.data,
        setReadBack.data,
      );
      const contexts = [
        initialSetResponse.context,
        completion.readBack.context,
        setReadBack.context,
      ];
      if (issue) {
        throw new QualityCommandIntegrityError(
          issue,
          integrityContext(completion.command.context, command.correlationId, contexts),
        );
      }

      return {
        card: completion.readBack.data,
        commandContext: completion.command.context,
        correlationId: command.correlationId,
        readBackContexts: contexts,
        set: setReadBack.data,
      };
    },

    async confirmWorkCardQuality(input) {
      if (input.card.status !== 'COMPLETED' || input.card.purpose !== 'SERIAL') {
        throw new QualityCommandIntegrityError(
          'Положительное подтверждение качества доступно только завершённой карточке обработки партии.',
        );
      }
      const body: CardVersionCommandBody = {
        commandId: createCommandId(),
        expectedCardVersion: input.card.version,
      };
      const completion = await api.mutate({
        body,
        path: `${cardPath(input.card.id)}/quality-confirmation`,
        readBack: () => ({
          path: cardPath(input.card.id),
          response: contractResponse(WorkCardSchema),
        }),
        response: contractResponse(WorkCardCommandResponseSchema),
        ...(input.signal ? { signal: input.signal } : {}),
      });
      const command = completion.command.data;
      const issue = closedCardIntegrityIssue(
        input.card,
        command.workCard,
        completion.readBack.data,
        'SERIAL',
        'SERIAL_QUALITY_CONFIRMATION',
      );
      if (issue) {
        throw new QualityCommandIntegrityError(
          issue,
          integrityContext(completion.command.context, command.correlationId, [
            completion.readBack.context,
          ]),
        );
      }

      return {
        card: completion.readBack.data,
        commandContext: completion.command.context,
        correlationId: command.correlationId,
        readBackContext: completion.readBack.context,
      };
    },

    async recordFinalBatchAcceptance(input) {
      const readinessIssues = finalAcceptanceReadinessIssues(input.batch);
      if (readinessIssues.length > 0) {
        throw new QualityCommandIntegrityError(readinessIssues.join(' '));
      }
      const commandId = createCommandId();
      const body: ReleaseWorkCardsBody = {
        commandId,
        expectedBatchVersion: input.batch.version,
      };
      const completion = await api.mutate({
        body,
        path: `${batchPath(input.batch.id)}/final-acceptance`,
        readBack: () => ({
          path: batchPath(input.batch.id),
          response: contractResponse(ProductionBatchDetailSchema),
        }),
        response: contractResponse(FinalBatchAcceptanceResponseSchema),
        ...(input.signal ? { signal: input.signal } : {}),
      });
      const command = completion.command.data;
      const batch = completion.readBack.data;
      const issue = finalAcceptanceIntegrityIssue(input.batch, command, batch, commandId);
      if (issue) {
        throw new QualityCommandIntegrityError(
          issue,
          integrityContext(completion.command.context, command.correlationId, [
            completion.readBack.context,
          ]),
        );
      }

      return {
        acceptance: batch.finalAcceptance!,
        batch,
        commandContext: completion.command.context,
        correlationId: command.correlationId,
        readBackContext: completion.readBack.context,
      };
    },
  };
}
