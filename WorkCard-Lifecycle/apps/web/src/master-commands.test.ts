import type {
  AssignmentResponse,
  DemoSessionResponse,
  WorkCard,
  WorkCardSetDetail,
} from '@work-card/contracts';
import { describe, expect, it, vi } from 'vitest';

import { createApiClient } from './api-client.js';
import { createMasterCommandClient, MasterCommandIntegrityError } from './master-commands.js';

const setId = '20000000-0000-4000-8000-000000000001';
const batchId = '30000000-0000-4000-8000-000000000001';
const workerOneId = '10000000-0000-4000-8000-000000000003';
const workerTwoId = '10000000-0000-4000-8000-000000000004';
const commandId = '40000000-0000-4000-8000-000000000001';
const secondCommandId = '40000000-0000-4000-8000-000000000002';
const correlationId = '50000000-0000-4000-8000-000000000001';

const session: DemoSessionResponse = {
  actor: {
    displayName: 'Мастер Сидоров',
    id: '10000000-0000-4000-8000-000000000002',
    role: 'MASTER',
    roleLabel: 'Мастер',
  },
  csrfToken: 'csrf-token-kept-only-in-application-memory-1234',
  permissions: ['AssignWorkCards', 'StartWorkCard', 'CompleteWorkCard'],
};

function cardId(index: number): string {
  return `60000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

function releasedCard(index: number): WorkCard {
  return {
    assignee: null,
    availableActions: [],
    batchId,
    batchQuantitySnapshot: 112,
    closureType: null,
    id: cardId(index),
    operation: {
      normHours: '0.80',
      scopeCode: 'OP-010-030',
      scopeName: 'Операции 010–030',
    },
    purpose: null,
    status: 'RELEASED',
    timestamps: {
      assignedAt: null,
      closedAt: null,
      completedAt: null,
      releasedAt: '2026-09-02T05:00:00.000Z',
      startedAt: null,
    },
    version: 1,
    workCardSetId: setId,
  };
}

function assignedCard(
  card: WorkCard,
  assigneeId: string,
  purpose: 'FIRST_ARTICLE' | 'SERIAL',
): WorkCard {
  return {
    ...card,
    assignee: {
      displayName: assigneeId === workerOneId ? 'Исполнитель Иванов' : 'Исполнитель Петров',
      id: assigneeId,
    },
    availableActions: ['StartWorkCard'],
    purpose,
    status: 'ASSIGNED',
    timestamps: { ...card.timestamps, assignedAt: '2026-09-02T05:02:00.000Z' },
    version: 2,
  };
}

function cardSet(overrides: Partial<WorkCardSetDetail> = {}): WorkCardSetDetail {
  return {
    actualCardCount: 112,
    assignmentCounts: [],
    availableActions: ['AssignWorkCards'],
    batchId,
    firstArticleWorkCardId: null,
    gateStatus: 'FIRST_ARTICLE_PENDING',
    id: setId,
    normHours: '0.80',
    plannedCardCount: 112,
    scopeCode: 'OP-010-030',
    scopeName: 'Операции 010–030',
    statusCounts: {
      ASSIGNED: 0,
      CLOSED: 0,
      COMPLETED: 0,
      IN_PROGRESS: 0,
      RELEASED: 112,
    },
    version: 1,
    ...overrides,
  };
}

function jsonResponse(payload: unknown, requestId?: string): Response {
  return new Response(JSON.stringify(payload), {
    headers: {
      'Content-Type': 'application/json',
      ...(requestId ? { 'X-Request-Id': requestId } : {}),
    },
    status: 200,
  });
}

function commandClient(
  fetchImplementation: typeof fetch,
  createCommandId: () => string = () => commandId,
) {
  return createMasterCommandClient(
    createApiClient({
      fetchImplementation,
      getConfirmedDemoSession: () => session,
    }),
    createCommandId,
  );
}

function serialAssignmentFixture() {
  const cards = [releasedCard(2), releasedCard(3)];
  const currentCards = cards.map((card) => assignedCard(card, workerOneId, 'SERIAL'));
  const firstArticleAssignment = {
    assignee: currentCards[0]!.assignee!,
    count: 1,
    purpose: 'FIRST_ARTICLE' as const,
  };
  const initialSet = cardSet({
    assignmentCounts: [firstArticleAssignment],
    firstArticleWorkCardId: cardId(1),
    gateStatus: 'SERIAL_ALLOWED',
    statusCounts: { ASSIGNED: 0, CLOSED: 1, COMPLETED: 0, IN_PROGRESS: 0, RELEASED: 111 },
    version: 3,
  });
  const currentSet = {
    ...initialSet,
    assignmentCounts: [
      firstArticleAssignment,
      {
        assignee: currentCards[0]!.assignee!,
        count: 2,
        purpose: 'SERIAL' as const,
      },
    ],
    statusCounts: { ASSIGNED: 2, CLOSED: 1, COMPLETED: 0, IN_PROGRESS: 0, RELEASED: 109 },
  };
  const response: AssignmentResponse = {
    assignedCount: 2,
    assignee: currentCards[0]!.assignee!,
    cards: currentCards.map((card) => ({ version: card.version, workCardId: card.id })),
    correlationId,
    purpose: 'SERIAL',
    setVersion: 3,
    workCardSetId: setId,
  };
  return {
    currentCards,
    currentSet,
    initialSet,
    response,
    input: { assigneeId: workerOneId, cards, purpose: 'SERIAL' as const, set: initialSet },
  };
}

describe('команды мастера с обязательным read-back', () => {
  it('назначает ровно одну первую деталь и сверяет комплект и карточку', async () => {
    const initialSet = cardSet();
    const initialCard = releasedCard(1);
    const currentCard = assignedCard(initialCard, workerOneId, 'FIRST_ARTICLE');
    const assignment: AssignmentResponse = {
      assignedCount: 1,
      assignee: currentCard.assignee!,
      cards: [{ version: 2, workCardId: initialCard.id }],
      correlationId,
      purpose: 'FIRST_ARTICLE',
      setVersion: 2,
      workCardSetId: setId,
    };
    const currentSet = cardSet({
      assignmentCounts: [{ assignee: currentCard.assignee!, count: 1, purpose: 'FIRST_ARTICLE' }],
      availableActions: [],
      firstArticleWorkCardId: initialCard.id,
      statusCounts: { ASSIGNED: 1, CLOSED: 0, COMPLETED: 0, IN_PROGRESS: 0, RELEASED: 111 },
      version: 2,
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(assignment, 'request-command'))
      .mockResolvedValueOnce(jsonResponse(currentSet, 'request-set-read-back'))
      .mockResolvedValueOnce(
        jsonResponse({ items: [currentCard], nextCursor: null }, 'request-cards-read-back'),
      );

    const result = await commandClient(fetchMock).assignWorkCards({
      assigneeId: workerOneId,
      cards: [initialCard],
      purpose: 'FIRST_ARTICLE',
      set: initialSet,
    });

    expect(result.set.firstArticleWorkCardId).toBe(initialCard.id);
    expect(result.cards).toEqual([currentCard]);
    expect(result.readBackContexts).toEqual([
      { requestId: 'request-set-read-back' },
      { requestId: 'request-cards-read-back' },
    ]);
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      `/api/v1/work-card-sets/${setId}/assignments`,
      `/api/v1/work-card-sets/${setId}`,
      `/api/v1/work-card-sets/${setId}/work-cards?assigneeId=${workerOneId}&limit=100`,
    ]);
    const [, commandInit] = fetchMock.mock.calls[0] ?? [];
    expect(JSON.parse(String(commandInit?.body))).toEqual({
      assigneeId: workerOneId,
      cards: [{ expectedVersion: 1, workCardId: initialCard.id }],
      commandId,
      expectedSetVersion: 1,
      purpose: 'FIRST_ARTICLE',
    });
  });

  it('подтверждает 1 + 59 + 52 с неизменной версией комплекта после обеих serial-команд', async () => {
    const cards = Array.from({ length: 59 }, (_, index) => releasedCard(index + 2));
    const currentCards = cards.map((card) => assignedCard(card, workerOneId, 'SERIAL'));
    const remainingCards = Array.from({ length: 52 }, (_, index) => releasedCard(index + 61));
    const remainingCurrentCards = remainingCards.map((card) =>
      assignedCard(card, workerTwoId, 'SERIAL'),
    );
    const firstArticleCard = {
      ...assignedCard(releasedCard(1), workerOneId, 'FIRST_ARTICLE'),
      availableActions: [],
      closureType: 'FIRST_ARTICLE_ACCEPTANCE' as const,
      status: 'CLOSED' as const,
      timestamps: {
        ...releasedCard(1).timestamps,
        assignedAt: '2026-09-02T05:01:00.000Z',
        closedAt: '2026-09-02T05:03:00.000Z',
        completedAt: '2026-09-02T05:02:30.000Z',
        startedAt: '2026-09-02T05:02:00.000Z',
      },
      version: 5,
    };
    const initialSet = cardSet({
      assignmentCounts: [
        { assignee: firstArticleCard.assignee!, count: 1, purpose: 'FIRST_ARTICLE' },
      ],
      firstArticleWorkCardId: firstArticleCard.id,
      gateStatus: 'SERIAL_ALLOWED',
      statusCounts: { ASSIGNED: 0, CLOSED: 1, COMPLETED: 0, IN_PROGRESS: 0, RELEASED: 111 },
      version: 3,
    });
    const assignment: AssignmentResponse = {
      assignedCount: 59,
      assignee: currentCards[0]!.assignee!,
      cards: currentCards.map((card) => ({ version: card.version, workCardId: card.id })),
      correlationId,
      purpose: 'SERIAL',
      setVersion: 3,
      workCardSetId: setId,
    };
    const currentSet = cardSet({
      assignmentCounts: [
        { assignee: firstArticleCard.assignee!, count: 1, purpose: 'FIRST_ARTICLE' },
        { assignee: currentCards[0]!.assignee!, count: 59, purpose: 'SERIAL' },
      ],
      firstArticleWorkCardId: firstArticleCard.id,
      gateStatus: 'SERIAL_ALLOWED',
      statusCounts: { ASSIGNED: 59, CLOSED: 1, COMPLETED: 0, IN_PROGRESS: 0, RELEASED: 52 },
      version: 3,
    });
    const secondAssignment: AssignmentResponse = {
      assignedCount: 52,
      assignee: remainingCurrentCards[0]!.assignee!,
      cards: remainingCurrentCards.map((card) => ({
        version: card.version,
        workCardId: card.id,
      })),
      correlationId,
      purpose: 'SERIAL',
      setVersion: 3,
      workCardSetId: setId,
    };
    const finalSet = cardSet({
      assignmentCounts: [
        { assignee: firstArticleCard.assignee!, count: 1, purpose: 'FIRST_ARTICLE' },
        { assignee: currentCards[0]!.assignee!, count: 59, purpose: 'SERIAL' },
        { assignee: remainingCurrentCards[0]!.assignee!, count: 52, purpose: 'SERIAL' },
      ],
      availableActions: [],
      firstArticleWorkCardId: firstArticleCard.id,
      gateStatus: 'SERIAL_ALLOWED',
      statusCounts: {
        ASSIGNED: 111,
        CLOSED: 1,
        COMPLETED: 0,
        IN_PROGRESS: 0,
        RELEASED: 0,
      },
      version: 3,
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(assignment))
      .mockResolvedValueOnce(jsonResponse(currentSet))
      .mockResolvedValueOnce(
        jsonResponse({ items: [firstArticleCard, ...currentCards], nextCursor: null }),
      )
      .mockResolvedValueOnce(jsonResponse(secondAssignment))
      .mockResolvedValueOnce(jsonResponse(finalSet))
      .mockResolvedValueOnce(jsonResponse({ items: remainingCurrentCards, nextCursor: null }));
    const commandIds = [commandId, secondCommandId];
    const client = commandClient(fetchMock, () => commandIds.shift() ?? secondCommandId);

    const firstResult = await client.assignWorkCards({
      assigneeId: workerOneId,
      cards,
      purpose: 'SERIAL',
      set: initialSet,
    });
    const finalResult = await client.assignWorkCards({
      assigneeId: workerTwoId,
      cards: remainingCards,
      purpose: 'SERIAL',
      set: firstResult.set,
    });

    expect(firstResult.assignment.assignedCount).toBe(59);
    expect(finalResult.assignment.assignedCount).toBe(52);
    expect(firstResult.set.version).toBe(initialSet.version);
    expect(finalResult.set.version).toBe(initialSet.version);
    expect(finalResult.set.assignmentCounts.map((entry) => entry.count)).toEqual([1, 59, 52]);
    expect(finalResult.set.statusCounts).toMatchObject({ ASSIGNED: 111, RELEASED: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(6);
    const [, firstCommandInit] = fetchMock.mock.calls[0] ?? [];
    const [, secondCommandInit] = fetchMock.mock.calls[3] ?? [];
    expect(JSON.parse(String(firstCommandInit?.body)).cards).toHaveLength(59);
    expect(JSON.parse(String(secondCommandInit?.body))).toMatchObject({
      cards: expect.any(Array),
      commandId: secondCommandId,
      expectedSetVersion: 3,
    });
    expect(JSON.parse(String(secondCommandInit?.body)).cards).toHaveLength(52);
  });

  it('не сообщает успех, если card read-back не содержит весь набор', async () => {
    const initialSet = cardSet();
    const initialCard = releasedCard(1);
    const currentCard = assignedCard(initialCard, workerOneId, 'FIRST_ARTICLE');
    const assignment: AssignmentResponse = {
      assignedCount: 1,
      assignee: currentCard.assignee!,
      cards: [{ version: 2, workCardId: initialCard.id }],
      correlationId,
      purpose: 'FIRST_ARTICLE',
      setVersion: 2,
      workCardSetId: setId,
    };
    const currentSet = cardSet({
      assignmentCounts: [{ assignee: currentCard.assignee!, count: 1, purpose: 'FIRST_ARTICLE' }],
      availableActions: [],
      firstArticleWorkCardId: initialCard.id,
      statusCounts: { ASSIGNED: 1, CLOSED: 0, COMPLETED: 0, IN_PROGRESS: 0, RELEASED: 111 },
      version: 2,
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(assignment))
      .mockResolvedValueOnce(jsonResponse(currentSet))
      .mockResolvedValueOnce(jsonResponse({ items: [], nextCursor: null }));

    await expect(
      commandClient(fetchMock).assignWorkCards({
        assigneeId: workerOneId,
        cards: [initialCard],
        purpose: 'FIRST_ARTICLE',
        set: initialSet,
      }),
    ).rejects.toBeInstanceOf(MasterCommandIntegrityError);
  });

  it.each([workerOneId, workerTwoId])(
    'принимает точный свой набор после параллельного непересекающегося назначения исполнителю %s',
    async (concurrentAssigneeId) => {
      const fixture = serialAssignmentFixture();
      const concurrentCard = assignedCard(releasedCard(4), concurrentAssigneeId, 'SERIAL');
      const currentSet: WorkCardSetDetail = {
        ...fixture.currentSet,
        assignmentCounts:
          concurrentAssigneeId === workerOneId
            ? [
                fixture.currentSet.assignmentCounts[0]!,
                {
                  ...fixture.currentSet.assignmentCounts[1]!,
                  count: 3,
                },
              ]
            : [
                ...fixture.currentSet.assignmentCounts,
                {
                  assignee: concurrentCard.assignee!,
                  count: 1,
                  purpose: 'SERIAL',
                },
              ],
        statusCounts: { ASSIGNED: 3, CLOSED: 1, COMPLETED: 0, IN_PROGRESS: 0, RELEASED: 108 },
      };
      const pageCards =
        concurrentAssigneeId === workerOneId
          ? [...fixture.currentCards, concurrentCard]
          : fixture.currentCards;
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(jsonResponse(fixture.response))
        .mockResolvedValueOnce(jsonResponse(currentSet))
        .mockResolvedValueOnce(jsonResponse({ items: pageCards, nextCursor: null }));

      const result = await commandClient(fetchMock).assignWorkCards(fixture.input);

      expect(result.set.version).toBe(fixture.initialSet.version);
      expect(result.cards).toEqual(fixture.currentCards);
      expect(result.assignment.assignedCount).toBe(2);
      expect(result.set.statusCounts.ASSIGNED).toBe(3);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    },
  );

  it('не путает продвижение чужой карточки с частичным назначением своего набора', async () => {
    const fixture = serialAssignmentFixture();
    const initialSet: WorkCardSetDetail = {
      ...fixture.initialSet,
      assignmentCounts: [
        fixture.initialSet.assignmentCounts[0]!,
        {
          assignee: fixture.response.assignee,
          count: 1,
          purpose: 'SERIAL',
        },
      ],
      statusCounts: { ASSIGNED: 1, CLOSED: 1, COMPLETED: 0, IN_PROGRESS: 0, RELEASED: 110 },
    };
    const currentSet: WorkCardSetDetail = {
      ...fixture.currentSet,
      assignmentCounts: [
        fixture.currentSet.assignmentCounts[0]!,
        {
          ...fixture.currentSet.assignmentCounts[1]!,
          count: 3,
        },
      ],
      statusCounts: { ASSIGNED: 2, CLOSED: 1, COMPLETED: 0, IN_PROGRESS: 1, RELEASED: 108 },
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(fixture.response))
      .mockResolvedValueOnce(jsonResponse(currentSet))
      .mockResolvedValueOnce(jsonResponse({ items: fixture.currentCards, nextCursor: null }));

    const result = await commandClient(fetchMock).assignWorkCards({
      ...fixture.input,
      set: initialSet,
    });

    expect(result.cards).toEqual(fixture.currentCards);
    expect(result.set.version).toBe(initialSet.version);
    expect(result.set.statusCounts).toMatchObject({ ASSIGNED: 2, IN_PROGRESS: 1 });
  });

  it.each([
    'changed-set-version',
    'duplicate-receipt-card',
    'missing-read-back-card',
    'different-card-version',
    'different-card-purpose',
    'different-card-norm',
    'partial-summary',
  ] as const)(
    'при unchanged serial setVersion не принимает ошибочный результат: %s',
    async (issue) => {
      const fixture = serialAssignmentFixture();
      let readBackCards = [...fixture.currentCards];
      if (issue === 'changed-set-version') fixture.response.setVersion = 4;
      if (issue === 'duplicate-receipt-card')
        fixture.response.cards[1] = fixture.response.cards[0]!;
      if (issue === 'missing-read-back-card') readBackCards = readBackCards.slice(0, 1);
      if (issue === 'different-card-version')
        readBackCards[0] = { ...readBackCards[0]!, version: 3 };
      if (issue === 'different-card-purpose')
        readBackCards[0] = { ...readBackCards[0]!, purpose: 'FIRST_ARTICLE' };
      if (issue === 'different-card-norm')
        readBackCards[0] = {
          ...readBackCards[0]!,
          operation: { ...readBackCards[0]!.operation, normHours: '1.25' },
        };
      if (issue === 'partial-summary') {
        fixture.currentSet.assignmentCounts[1]!.count = 1;
        fixture.currentSet.statusCounts.ASSIGNED = 1;
        fixture.currentSet.statusCounts.RELEASED = 110;
      }
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(jsonResponse(fixture.response))
        .mockResolvedValueOnce(jsonResponse(fixture.currentSet))
        .mockResolvedValueOnce(jsonResponse({ items: readBackCards, nextCursor: null }));

      await expect(commandClient(fetchMock).assignWorkCards(fixture.input)).rejects.toBeInstanceOf(
        MasterCommandIntegrityError,
      );
      expect(fetchMock).toHaveBeenCalledTimes(3);
    },
  );

  it('фиксирует start и complete только после совпадающего read-back карточки', async () => {
    const initialCard = assignedCard(releasedCard(1), workerTwoId, 'SERIAL');
    const startedCard: WorkCard = {
      ...initialCard,
      availableActions: ['CompleteWorkCard'],
      status: 'IN_PROGRESS',
      timestamps: { ...initialCard.timestamps, startedAt: '2026-09-02T05:03:00.000Z' },
      version: 3,
    };
    const completedCard: WorkCard = {
      ...startedCard,
      availableActions: [],
      status: 'COMPLETED',
      timestamps: { ...startedCard.timestamps, completedAt: '2026-09-02T05:04:00.000Z' },
      version: 4,
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ correlationId, workCard: startedCard }))
      .mockResolvedValueOnce(jsonResponse(startedCard))
      .mockResolvedValueOnce(jsonResponse({ correlationId, workCard: completedCard }))
      .mockResolvedValueOnce(jsonResponse(completedCard));
    const client = commandClient(fetchMock);

    const started = await client.startWorkCard({ card: initialCard });
    const completed = await client.completeWorkCard({ card: started.card });

    expect(started.card.status).toBe('IN_PROGRESS');
    expect(completed.card.status).toBe('COMPLETED');
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      `/api/v1/work-cards/${initialCard.id}/start`,
      `/api/v1/work-cards/${initialCard.id}`,
      `/api/v1/work-cards/${initialCard.id}/complete`,
      `/api/v1/work-cards/${initialCard.id}`,
    ]);
    expect(
      JSON.parse(String((fetchMock.mock.calls[2]?.[1] as RequestInit | undefined)?.body)),
    ).toEqual({ commandId, expectedCardVersion: 3 });
  });
});
