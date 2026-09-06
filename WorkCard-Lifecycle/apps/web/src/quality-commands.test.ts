import type {
  DemoSessionResponse,
  FinalBatchAcceptance,
  FinalBatchAcceptanceResponse,
  FirstArticleAcceptanceResponse,
  ProductionBatchDetail,
  WorkCard,
  WorkCardSetDetail,
} from '@work-card/contracts';
import { describe, expect, it, vi } from 'vitest';

import { createApiClient } from './api-client.js';
import {
  QualityCommandIntegrityError,
  createQualityCommandClient,
  finalAcceptanceReadinessIssues,
} from './quality-commands.js';

const batchId = '10000000-0000-4000-8000-000000000001';
const setId = '20000000-0000-4000-8000-000000000001';
const cardId = '30000000-0000-4000-8000-000000000001';
const commandId = '40000000-0000-4000-8000-000000000001';
const correlationId = '50000000-0000-4000-8000-000000000001';
const controllerId = '60000000-0000-4000-8000-000000000001';
const workerId = '70000000-0000-4000-8000-000000000001';
const acceptanceId = '80000000-0000-4000-8000-000000000001';

const session: DemoSessionResponse = {
  actor: {
    displayName: 'Контролёр БТК',
    id: controllerId,
    role: 'QUALITY_CONTROLLER',
    roleLabel: 'Контролёр БТК',
  },
  csrfToken: 'csrf-token-kept-only-in-application-memory-1234',
  permissions: ['AcceptFirstArticle', 'ConfirmWorkCardQuality', 'RecordFinalBatchAcceptance'],
};

function completedCard(purpose: 'FIRST_ARTICLE' | 'SERIAL'): WorkCard {
  return {
    assignee: { displayName: 'Исполнитель Иванов', id: workerId },
    availableActions: [
      purpose === 'FIRST_ARTICLE' ? 'AcceptFirstArticle' : 'ConfirmWorkCardQuality',
    ],
    batchId,
    batchQuantitySnapshot: 112,
    closureType: null,
    id: cardId,
    operation: {
      normHours: '0.80',
      scopeCode: 'OP-010-030',
      scopeName: 'Операции 010–030',
    },
    purpose,
    status: 'COMPLETED',
    timestamps: {
      assignedAt: '2026-09-02T05:01:00.000Z',
      closedAt: null,
      completedAt: '2026-09-02T05:03:00.000Z',
      releasedAt: '2026-09-02T05:00:00.000Z',
      startedAt: '2026-09-02T05:02:00.000Z',
    },
    version: 4,
    workCardSetId: setId,
  };
}

function closedCard(purpose: 'FIRST_ARTICLE' | 'SERIAL'): WorkCard {
  return {
    ...completedCard(purpose),
    availableActions: [],
    closureType:
      purpose === 'FIRST_ARTICLE' ? 'FIRST_ARTICLE_ACCEPTANCE' : 'SERIAL_QUALITY_CONFIRMATION',
    status: 'CLOSED',
    timestamps: {
      ...completedCard(purpose).timestamps,
      closedAt: '2026-09-02T05:04:00.000Z',
    },
    version: 5,
  };
}

function firstArticleSet(overrides: Partial<WorkCardSetDetail> = {}): WorkCardSetDetail {
  return {
    actualCardCount: 112,
    assignmentCounts: [
      {
        assignee: { displayName: 'Исполнитель Иванов', id: workerId },
        count: 1,
        purpose: 'FIRST_ARTICLE',
      },
    ],
    availableActions: [],
    batchId,
    firstArticleWorkCardId: cardId,
    gateStatus: 'FIRST_ARTICLE_PENDING',
    id: setId,
    normHours: '0.80',
    plannedCardCount: 112,
    scopeCode: 'OP-010-030',
    scopeName: 'Операции 010–030',
    statusCounts: { ASSIGNED: 0, CLOSED: 0, COMPLETED: 1, IN_PROGRESS: 0, RELEASED: 111 },
    version: 2,
    ...overrides,
  };
}

const operationPlan = [112, 112, 26].map((plannedCardCount, index) => ({
  id: `90000000-0000-4000-8000-00000000000${index + 1}`,
  normHours: index === 0 ? '0.80' : index === 1 ? '1.25' : '0.55',
  plannedCardCount,
  position: index + 1,
  scopeCode: `OP-${index + 1}`,
  scopeName: `Группа операций ${index + 1}`,
}));

function completedBatch(overrides: Partial<ProductionBatchDetail> = {}): ProductionBatchDetail {
  return {
    availableActions: ['RecordFinalBatchAcceptance'],
    counts: { actualCardCount: 250, closedCardCount: 250, plannedCardCount: 250, setCount: 3 },
    createdAt: '2026-09-02T05:00:00.000Z',
    finalAcceptance: null,
    finalAcceptedAt: null,
    id: batchId,
    lifecycleStatus: 'RELEASED',
    operationPlan,
    passportSnapshot: { code: 'DEMO-250', productName: 'Учебное изделие', revision: 'A' },
    quantity: 112,
    releasedAt: '2026-09-02T05:00:30.000Z',
    sets: operationPlan.map((operation, index) => ({
      actualCardCount: operation.plannedCardCount,
      closedCardCount: operation.plannedCardCount,
      gateStatus: 'SERIAL_ALLOWED' as const,
      id: `a0000000-0000-4000-8000-00000000000${index + 1}`,
      normHours: operation.normHours,
      plannedCardCount: operation.plannedCardCount,
      scopeCode: operation.scopeCode,
      scopeName: operation.scopeName,
      version: 3,
    })),
    version: 2,
    ...overrides,
  };
}

const acceptedAt = '2026-09-02T05:05:00.000Z';

const finalResponse: FinalBatchAcceptanceResponse = {
  acceptance: {
    acceptedAt,
    batchId,
    commandId,
    controller: { displayName: 'Контролёр БТК', id: controllerId },
    id: acceptanceId,
    resultingBatchVersion: 3,
  },
  batchLifecycleStatus: 'FINAL_ACCEPTED',
  correlationId,
};

function jsonResponse(payload: unknown, requestId?: string, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    headers: {
      'Content-Type': 'application/json',
      ...(requestId ? { 'X-Request-Id': requestId } : {}),
    },
    status,
  });
}

function commandClient(fetchImplementation: typeof fetch) {
  const api = createApiClient({
    fetchImplementation,
    getConfirmedDemoSession: () => session,
  });
  return createQualityCommandClient(api, () => commandId);
}

describe('команды БТК с обязательными контрольными чтениями', () => {
  it('положительно принимает первую деталь только после сверки карточки и комплекта', async () => {
    const initialCard = completedCard('FIRST_ARTICLE');
    const currentCard = closedCard('FIRST_ARTICLE');
    const initialSet = firstArticleSet();
    const currentSet = firstArticleSet({
      gateStatus: 'SERIAL_ALLOWED',
      statusCounts: { ASSIGNED: 0, CLOSED: 1, COMPLETED: 0, IN_PROGRESS: 0, RELEASED: 111 },
      version: 3,
    });
    const response: FirstArticleAcceptanceResponse = {
      correlationId,
      gateStatus: 'SERIAL_ALLOWED',
      setVersion: 3,
      workCard: currentCard,
      workCardSetId: setId,
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(initialSet, 'request-set-before'))
      .mockResolvedValueOnce(jsonResponse(response, 'request-command'))
      .mockResolvedValueOnce(jsonResponse(currentCard, 'request-card-read-back'))
      .mockResolvedValueOnce(jsonResponse(currentSet, 'request-set-read-back'));

    const result = await commandClient(fetchMock).acceptFirstArticle({ card: initialCard });

    expect(result.card.status).toBe('CLOSED');
    expect(result.set.gateStatus).toBe('SERIAL_ALLOWED');
    expect(result.readBackContexts).toEqual([
      { requestId: 'request-set-before' },
      { requestId: 'request-card-read-back' },
      { requestId: 'request-set-read-back' },
    ]);
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      `/api/v1/work-card-sets/${setId}`,
      `/api/v1/work-card-sets/${setId}/first-article-acceptance`,
      `/api/v1/work-cards/${cardId}`,
      `/api/v1/work-card-sets/${setId}`,
    ]);
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      commandId,
      expectedCardVersion: 4,
      expectedSetVersion: 2,
    });
  });

  it('подтверждает качество ровно одной карточки и не создаёт финальную приёмку', async () => {
    const initialCard = completedCard('SERIAL');
    const currentCard = closedCard('SERIAL');
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ correlationId, workCard: currentCard }))
      .mockResolvedValueOnce(jsonResponse(currentCard));

    const result = await commandClient(fetchMock).confirmWorkCardQuality({ card: initialCard });

    expect(result.card).toEqual(currentCard);
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      `/api/v1/work-cards/${cardId}/quality-confirmation`,
      `/api/v1/work-cards/${cardId}`,
    ]);
    expect(fetchMock.mock.calls.some(([path]) => String(path).includes('final-acceptance'))).toBe(
      false,
    );
  });

  it('не отправляет финальную команду до точных итогов 3/3 и 250/250', async () => {
    const batch = completedBatch({
      counts: { actualCardCount: 250, closedCardCount: 249, plannedCardCount: 250, setCount: 3 },
      sets: completedBatch().sets.map((cardSet, index) =>
        index === 2 ? { ...cardSet, closedCardCount: 25 } : cardSet,
      ),
    });
    const fetchMock = vi.fn<typeof fetch>();

    expect(finalAcceptanceReadinessIssues(batch)).toContain(
      'Требуется 250 из 250 закрытых карточек полного выпуска; подтверждено 249 из 250.',
    );
    await expect(
      commandClient(fetchMock).recordFinalBatchAcceptance({ batch }),
    ).rejects.toBeInstanceOf(QualityCommandIntegrityError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('принимает партию лишь после read-back сверки ID, контролёра и времени', async () => {
    const batch = completedBatch();
    const acceptedBatch = completedBatch({
      availableActions: [],
      finalAcceptance: finalResponse.acceptance,
      finalAcceptedAt: acceptedAt,
      lifecycleStatus: 'FINAL_ACCEPTED',
      version: 3,
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(finalResponse, 'request-command', 201))
      .mockResolvedValueOnce(jsonResponse(acceptedBatch, 'request-read-back'));

    const result = await commandClient(fetchMock).recordFinalBatchAcceptance({ batch });

    expect(result.acceptance).toEqual(finalResponse.acceptance);
    expect(result.batch.lifecycleStatus).toBe('FINAL_ACCEPTED');
    expect(result).toMatchObject({
      commandContext: { requestId: 'request-command' },
      readBackContext: { requestId: 'request-read-back' },
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      commandId,
      expectedBatchVersion: 2,
    });
  });

  it('принимает полный состав другого паспорта: один комплект и две закрытые карточки', async () => {
    const sample = completedBatch();
    const smallBatch = completedBatch({
      counts: { actualCardCount: 2, closedCardCount: 2, plannedCardCount: 2, setCount: 1 },
      operationPlan: [{ ...sample.operationPlan[0]!, plannedCardCount: 2 }],
      quantity: 2,
      sets: [
        {
          ...sample.sets[0]!,
          actualCardCount: 2,
          closedCardCount: 2,
          plannedCardCount: 2,
        },
      ],
    });
    const acceptedBatch = {
      ...smallBatch,
      availableActions: [],
      finalAcceptance: finalResponse.acceptance,
      finalAcceptedAt: acceptedAt,
      lifecycleStatus: 'FINAL_ACCEPTED',
      version: 3,
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(finalResponse, undefined, 201))
      .mockResolvedValueOnce(jsonResponse(acceptedBatch));

    expect(finalAcceptanceReadinessIssues(smallBatch)).toEqual([]);
    const result = await commandClient(fetchMock).recordFinalBatchAcceptance({ batch: smallBatch });
    expect(result.batch.counts).toEqual(smallBatch.counts);
    expect(result.acceptance).toEqual(finalResponse.acceptance);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(['missing-set', 'pending-gate', 'unclosed-card', 'wrong-operation'] as const)(
    'сохраняет проверку всех обязательных условий малого паспорта: %s',
    async (issue) => {
      const sample = completedBatch();
      const smallBatch = completedBatch({
        counts: { actualCardCount: 2, closedCardCount: 2, plannedCardCount: 2, setCount: 1 },
        operationPlan: [{ ...sample.operationPlan[0]!, plannedCardCount: 2 }],
        quantity: 2,
        sets: [
          {
            ...sample.sets[0]!,
            actualCardCount: 2,
            closedCardCount: 2,
            plannedCardCount: 2,
          },
        ],
      });
      if (issue === 'missing-set') smallBatch.sets = [];
      if (issue === 'pending-gate') smallBatch.sets[0]!.gateStatus = 'FIRST_ARTICLE_PENDING';
      if (issue === 'unclosed-card') {
        smallBatch.counts.closedCardCount = 1;
        smallBatch.sets[0]!.closedCardCount = 1;
      }
      if (issue === 'wrong-operation') smallBatch.sets[0]!.scopeCode = 'OP-OTHER';
      const fetchMock = vi.fn<typeof fetch>();

      expect(finalAcceptanceReadinessIssues(smallBatch).length).toBeGreaterThan(0);
      await expect(
        commandClient(fetchMock).recordFinalBatchAcceptance({ batch: smallBatch }),
      ).rejects.toBeInstanceOf(QualityCommandIntegrityError);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  const mismatchedAcceptances: Array<[string, FinalBatchAcceptance]> = [
    [
      'контролёр',
      {
        ...finalResponse.acceptance,
        controller: {
          displayName: 'Другой контролёр',
          id: 'b0000000-0000-4000-8000-000000000001',
        },
      },
    ],
    ['время', { ...finalResponse.acceptance, acceptedAt: '2026-09-02T05:06:00.000Z' }],
    ['ID приёмки', { ...finalResponse.acceptance, id: 'c0000000-0000-4000-8000-000000000001' }],
  ];

  it.each(mismatchedAcceptances)(
    'не сообщает частичный успех, если в read-back не совпадает %s',
    async (_field, readBackAcceptance) => {
      const batch = completedBatch();
      const acceptedBatch = completedBatch({
        availableActions: [],
        finalAcceptance: readBackAcceptance,
        finalAcceptedAt: readBackAcceptance.acceptedAt,
        lifecycleStatus: 'FINAL_ACCEPTED',
        version: 3,
      });
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(jsonResponse(finalResponse, undefined, 201))
        .mockResolvedValueOnce(jsonResponse(acceptedBatch));

      await expect(
        commandClient(fetchMock).recordFinalBatchAcceptance({ batch }),
      ).rejects.toBeInstanceOf(QualityCommandIntegrityError);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );
});
