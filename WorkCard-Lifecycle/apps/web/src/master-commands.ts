import {
  AssignmentResponseSchema,
  WorkCardCommandResponseSchema,
  WorkCardSchema,
  WorkCardsResponseSchema,
  WorkCardSetDetailSchema,
  type AssignWorkCardsBody,
  type AssignmentResponse,
  type CardVersionCommandBody,
  type WorkCard,
  type WorkCardPurpose,
  type WorkCardSetDetail,
  type WorkCardStatus,
} from '@work-card/contracts';

import {
  contractResponse,
  type ApiClient,
  type ApiRequestContext,
  type ApiV1Path,
} from './api-client.js';
import { CommandIntegrityError } from './command-recovery.js';

export type AssignCardsInput = Readonly<{
  assigneeId: string;
  cards: readonly WorkCard[];
  purpose: WorkCardPurpose;
  set: WorkCardSetDetail;
  signal?: AbortSignal;
}>;

export type WorkCardLifecycleInput = Readonly<{
  card: WorkCard;
  signal?: AbortSignal;
}>;

export type ConfirmedAssignmentCommand = Readonly<{
  assignment: AssignmentResponse;
  cards: readonly WorkCard[];
  commandContext: ApiRequestContext;
  correlationId: string;
  readBackContexts: readonly ApiRequestContext[];
  set: WorkCardSetDetail;
}>;

export type ConfirmedWorkCardCommand = Readonly<{
  card: WorkCard;
  commandContext: ApiRequestContext;
  correlationId: string;
  readBackContext: ApiRequestContext;
}>;

export type MasterCommandClient = Readonly<{
  assignWorkCards: (input: AssignCardsInput) => Promise<ConfirmedAssignmentCommand>;
  completeWorkCard: (input: WorkCardLifecycleInput) => Promise<ConfirmedWorkCardCommand>;
  startWorkCard: (input: WorkCardLifecycleInput) => Promise<ConfirmedWorkCardCommand>;
}>;

export class MasterCommandIntegrityError extends CommandIntegrityError {
  readonly commandContext: ApiRequestContext;
  readonly correlationId: string;
  readonly readBackContexts: readonly ApiRequestContext[];

  constructor(
    message: string,
    context: {
      commandContext: ApiRequestContext;
      correlationId: string;
      readBackContexts: readonly ApiRequestContext[];
    },
  ) {
    super(message);
    this.name = 'MasterCommandIntegrityError';
    this.commandContext = context.commandContext;
    this.correlationId = context.correlationId;
    this.readBackContexts = context.readBackContexts;
  }
}

function setPath(setId: string): ApiV1Path {
  return `/api/v1/work-card-sets/${encodeURIComponent(setId)}`;
}

function cardPath(workCardId: string): ApiV1Path {
  return `/api/v1/work-cards/${encodeURIComponent(workCardId)}`;
}

function assignedCardsPath(setId: string, assigneeId: string, cursor?: string): ApiV1Path {
  const search = new URLSearchParams({ assigneeId, limit: '100' });
  if (cursor) search.set('cursor', cursor);
  return `${setPath(setId)}/work-cards?${search.toString()}` as ApiV1Path;
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
    immutableCardContextMatches(readBackCard, commandCard) &&
    readBackCard.purpose === commandCard.purpose &&
    readBackCard.status === commandCard.status &&
    readBackCard.closureType === commandCard.closureType &&
    sameAssignee(readBackCard.assignee, commandCard.assignee) &&
    readBackCard.version === commandCard.version &&
    readBackCard.timestamps.releasedAt === commandCard.timestamps.releasedAt &&
    readBackCard.timestamps.assignedAt === commandCard.timestamps.assignedAt &&
    readBackCard.timestamps.startedAt === commandCard.timestamps.startedAt &&
    readBackCard.timestamps.completedAt === commandCard.timestamps.completedAt &&
    readBackCard.timestamps.closedAt === commandCard.timestamps.closedAt
  );
}

function assignmentCount(
  cardSet: WorkCardSetDetail,
  assigneeId: string,
  purpose: WorkCardPurpose,
): number {
  return (
    cardSet.assignmentCounts.find(
      (entry) => entry.assignee.id === assigneeId && entry.purpose === purpose,
    )?.count ?? 0
  );
}

export function assignmentIntegrityIssue(
  input: AssignCardsInput,
  command: AssignmentResponse,
  currentSet: WorkCardSetDetail,
  assignedCards: readonly WorkCard[],
): string | null {
  const selectedIds = new Set(input.cards.map((card) => card.id));
  const commandCards = new Map(command.cards.map((card) => [card.workCardId, card.version]));
  const currentCards = new Map(assignedCards.map((card) => [card.id, card]));
  const previousAssignmentCount = assignmentCount(input.set, input.assigneeId, input.purpose);
  const currentAssignmentCount = assignmentCount(currentSet, input.assigneeId, input.purpose);
  const currentStatusTotal = Object.values(currentSet.statusCounts).reduce(
    (total, count) => total + count,
    0,
  );
  const currentAssignedTotal = currentSet.assignmentCounts.reduce(
    (total, assignment) => total + assignment.count,
    0,
  );
  const expectedResultingSetVersion =
    input.set.version + (input.purpose === 'FIRST_ARTICLE' ? 1 : 0);

  if (
    input.cards.length === 0 ||
    selectedIds.size !== input.cards.length ||
    input.cards.some((card) => card.workCardSetId !== input.set.id || card.status !== 'RELEASED')
  ) {
    return 'Выбор карточек не соответствует исходному состоянию комплекта.';
  }
  if (
    command.workCardSetId !== input.set.id ||
    command.purpose !== input.purpose ||
    command.assignee.id !== input.assigneeId ||
    command.assignedCount !== input.cards.length ||
    command.cards.length !== input.cards.length ||
    commandCards.size !== input.cards.length
  ) {
    return 'Ответ назначения не совпадает с отправленным набором карточек.';
  }
  if (
    input.cards.some((card) => {
      const nextVersion = commandCards.get(card.id);
      return nextVersion !== card.version + 1;
    })
  ) {
    return 'Ответ назначения не подтвердил новую версию каждой карточки.';
  }
  if (
    currentSet.id !== input.set.id ||
    currentSet.batchId !== input.set.batchId ||
    currentSet.scopeCode !== input.set.scopeCode ||
    currentSet.scopeName !== input.set.scopeName ||
    currentSet.normHours !== input.set.normHours ||
    currentSet.plannedCardCount !== input.set.plannedCardCount ||
    currentSet.actualCardCount !== input.set.actualCardCount ||
    currentSet.gateStatus !== input.set.gateStatus ||
    command.setVersion !== expectedResultingSetVersion ||
    currentSet.version < command.setVersion
  ) {
    return 'Контрольное чтение не подтвердило ожидаемую версию комплекта.';
  }
  if (
    currentStatusTotal !== currentSet.actualCardCount ||
    currentAssignedTotal !== currentSet.actualCardCount - currentSet.statusCounts.RELEASED
  ) {
    return 'Итоги состояний и назначений комплекта не согласованы между собой.';
  }
  if (currentAssignmentCount < previousAssignmentCount + input.cards.length) {
    return 'Сводка назначений не подтверждает весь отправленный набор.';
  }
  if (
    input.purpose === 'FIRST_ARTICLE' &&
    currentSet.version === command.setVersion &&
    (currentAssignmentCount !== previousAssignmentCount + input.cards.length ||
      currentSet.statusCounts.RELEASED !== input.set.statusCounts.RELEASED - input.cards.length ||
      currentSet.statusCounts.ASSIGNED !== input.set.statusCounts.ASSIGNED + input.cards.length)
  ) {
    return 'Контрольная сводка не подтверждает атомарное изменение всего набора.';
  }
  // Serial assignment changes card roots only. Other assignments or lifecycle
  // transitions can change the set summary without changing the set version.
  if (
    input.purpose === 'SERIAL' &&
    (currentSet.statusCounts.RELEASED > input.set.statusCounts.RELEASED - input.cards.length ||
      currentSet.statusCounts.ASSIGNED < input.cards.length ||
      currentSet.firstArticleWorkCardId !== input.set.firstArticleWorkCardId)
  ) {
    return 'Сводка комплекта не подтверждает весь назначенный набор обработки партии.';
  }
  if (
    input.purpose === 'FIRST_ARTICLE' &&
    (input.cards.length !== 1 || currentSet.firstArticleWorkCardId !== input.cards[0]?.id)
  ) {
    return 'Комплект не подтвердил выбранную карточку первой детали.';
  }
  if (assignedCards.length !== input.cards.length || currentCards.size !== input.cards.length) {
    return 'Контрольное чтение не вернуло весь назначенный набор.';
  }
  if (
    input.cards.some((previousCard) => {
      const currentCard = currentCards.get(previousCard.id);
      const commandVersion = commandCards.get(previousCard.id);
      return (
        !currentCard ||
        !immutableCardContextMatches(currentCard, previousCard) ||
        currentCard.workCardSetId !== input.set.id ||
        currentCard.status !== 'ASSIGNED' ||
        currentCard.purpose !== input.purpose ||
        currentCard.assignee?.id !== input.assigneeId ||
        currentCard.version !== commandVersion
      );
    })
  ) {
    return 'Назначенные карточки не совпадают с ответом команды и сводкой комплекта.';
  }

  return null;
}

function lifecycleIntegrityIssue(
  previousCard: WorkCard,
  commandCard: WorkCard,
  currentCard: WorkCard,
  targetStatus: WorkCardStatus,
): string | null {
  const targetTimestamp =
    targetStatus === 'IN_PROGRESS'
      ? commandCard.timestamps.startedAt
      : commandCard.timestamps.completedAt;

  if (
    !immutableCardContextMatches(commandCard, previousCard) ||
    commandCard.status !== targetStatus ||
    commandCard.version <= previousCard.version ||
    commandCard.workCardSetId !== previousCard.workCardSetId ||
    commandCard.purpose !== previousCard.purpose ||
    !sameAssignee(commandCard.assignee, previousCard.assignee) ||
    !targetTimestamp
  ) {
    return 'Ответ команды не подтверждает ожидаемый переход карточки.';
  }
  if (!cardReadBackMatches(commandCard, currentCard)) {
    return 'Контрольное чтение карточки не совпадает с ответом команды.';
  }

  return null;
}

export function createMasterCommandClient(
  api: ApiClient,
  createCommandId: () => string = () => globalThis.crypto.randomUUID(),
): MasterCommandClient {
  async function readAssignedCards(
    input: AssignCardsInput,
  ): Promise<{ cards: WorkCard[]; contexts: ApiRequestContext[] }> {
    const selectedIds = new Set(input.cards.map((card) => card.id));
    const found = new Map<string, WorkCard>();
    const contexts: ApiRequestContext[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;

    do {
      const page = await api.read({
        path: assignedCardsPath(input.set.id, input.assigneeId, cursor),
        response: contractResponse(WorkCardsResponseSchema),
        ...(input.signal ? { signal: input.signal } : {}),
      });
      contexts.push(page.context);
      for (const card of page.data.items) {
        if (selectedIds.has(card.id)) found.set(card.id, card);
      }
      const nextCursor = page.data.nextCursor ?? undefined;
      cursor = nextCursor && !seenCursors.has(nextCursor) ? nextCursor : undefined;
      if (cursor) seenCursors.add(cursor);
    } while (found.size < selectedIds.size && cursor);

    return {
      cards: input.cards.flatMap((card) => {
        const current = found.get(card.id);
        return current ? [current] : [];
      }),
      contexts,
    };
  }

  async function runLifecycle(
    input: WorkCardLifecycleInput,
    action: 'complete' | 'start',
    targetStatus: 'COMPLETED' | 'IN_PROGRESS',
  ): Promise<ConfirmedWorkCardCommand> {
    const body: CardVersionCommandBody = {
      commandId: createCommandId(),
      expectedCardVersion: input.card.version,
    };
    const completion = await api.mutate({
      body,
      path: `${cardPath(input.card.id)}/${action}`,
      readBack: () => ({
        path: cardPath(input.card.id),
        response: contractResponse(WorkCardSchema),
      }),
      response: contractResponse(WorkCardCommandResponseSchema),
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const command = completion.command.data;
    const currentCard = completion.readBack.data;
    const issue = lifecycleIntegrityIssue(input.card, command.workCard, currentCard, targetStatus);

    if (issue) {
      throw new MasterCommandIntegrityError(issue, {
        commandContext: completion.command.context,
        correlationId: command.correlationId,
        readBackContexts: [completion.readBack.context],
      });
    }

    return {
      card: currentCard,
      commandContext: completion.command.context,
      correlationId: command.correlationId,
      readBackContext: completion.readBack.context,
    };
  }

  return {
    async assignWorkCards(input) {
      const body: AssignWorkCardsBody = {
        assigneeId: input.assigneeId,
        cards: input.cards.map((card) => ({
          expectedVersion: card.version,
          workCardId: card.id,
        })),
        commandId: createCommandId(),
        expectedSetVersion: input.set.version,
        purpose: input.purpose,
      };
      const completion = await api.mutate({
        body,
        path: `${setPath(input.set.id)}/assignments`,
        readBack: () => ({
          path: setPath(input.set.id),
          response: contractResponse(WorkCardSetDetailSchema),
        }),
        response: contractResponse(AssignmentResponseSchema),
        ...(input.signal ? { signal: input.signal } : {}),
      });
      const command = completion.command.data;
      const cardReadBack = await readAssignedCards(input);
      const readBackContexts = [completion.readBack.context, ...cardReadBack.contexts];
      const issue = assignmentIntegrityIssue(
        input,
        command,
        completion.readBack.data,
        cardReadBack.cards,
      );

      if (issue) {
        throw new MasterCommandIntegrityError(issue, {
          commandContext: completion.command.context,
          correlationId: command.correlationId,
          readBackContexts,
        });
      }

      return {
        assignment: command,
        cards: cardReadBack.cards,
        commandContext: completion.command.context,
        correlationId: command.correlationId,
        readBackContexts,
        set: completion.readBack.data,
      };
    },

    completeWorkCard(input) {
      return runLifecycle(input, 'complete', 'COMPLETED');
    },

    startWorkCard(input) {
      return runLifecycle(input, 'start', 'IN_PROGRESS');
    },
  };
}
