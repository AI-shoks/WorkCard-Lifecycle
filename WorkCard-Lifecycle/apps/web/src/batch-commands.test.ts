import type {
  DemoSessionResponse,
  ProductionBatchDetail,
  ReleaseWorkCardsResponse,
} from '@work-card/contracts';
import { describe, expect, it, vi } from 'vitest';

import { createApiClient } from './api-client.js';
import { BatchCommandIntegrityError, createBatchCommandClient } from './batch-commands.js';

const passportId = '10000000-0000-4000-8000-000000000001';
const batchId = '20000000-0000-4000-8000-000000000001';
const commandId = '30000000-0000-4000-8000-000000000001';
const correlationId = '40000000-0000-4000-8000-000000000001';

const session: DemoSessionResponse = {
  actor: {
    displayName: 'Специалист ПДБ',
    id: '50000000-0000-4000-8000-000000000001',
    role: 'PLANNER',
    roleLabel: 'Специалист ПДБ',
  },
  csrfToken: 'csrf-token-kept-only-in-application-memory-1234',
  permissions: ['CreateProductionBatch', 'ReleaseWorkCards'],
};

const operationPlan = [
  {
    id: '60000000-0000-4000-8000-000000000001',
    normHours: '0.80',
    plannedCardCount: 112,
    position: 1,
    scopeCode: 'OP-010-030',
    scopeName: 'Операции 010–030',
  },
  {
    id: '60000000-0000-4000-8000-000000000002',
    normHours: '1.25',
    plannedCardCount: 112,
    position: 2,
    scopeCode: 'OP-040-060',
    scopeName: 'Операции 040–060',
  },
  {
    id: '60000000-0000-4000-8000-000000000003',
    normHours: '0.55',
    plannedCardCount: 26,
    position: 3,
    scopeCode: 'OP-070',
    scopeName: 'Операция 070',
  },
] as const;

const passportSnapshot = {
  code: 'DEMO-250',
  productName: 'Учебное изделие',
  revision: 'A',
} as const;

const createdBatch: ProductionBatchDetail = {
  availableActions: ['ReleaseWorkCards'],
  counts: { actualCardCount: 0, closedCardCount: 0, plannedCardCount: 250, setCount: 0 },
  createdAt: '2026-09-02T05:00:00.000Z',
  finalAcceptance: null,
  finalAcceptedAt: null,
  id: batchId,
  lifecycleStatus: 'CREATED',
  operationPlan: [...operationPlan],
  passportSnapshot,
  quantity: 112,
  releasedAt: null,
  sets: [],
  version: 1,
};

const releasedBatch: ProductionBatchDetail = {
  ...createdBatch,
  availableActions: [],
  counts: { actualCardCount: 250, closedCardCount: 0, plannedCardCount: 250, setCount: 3 },
  lifecycleStatus: 'RELEASED',
  releasedAt: '2026-09-02T05:01:00.000Z',
  sets: operationPlan.map((operation, index) => ({
    actualCardCount: operation.plannedCardCount,
    closedCardCount: 0,
    gateStatus: 'FIRST_ARTICLE_PENDING' as const,
    id: `70000000-0000-4000-8000-00000000000${index + 1}`,
    normHours: operation.normHours,
    plannedCardCount: operation.plannedCardCount,
    scopeCode: operation.scopeCode,
    scopeName: operation.scopeName,
    version: 1,
  })),
  version: 2,
};

const createResponse = {
  batch: {
    counts: createdBatch.counts,
    createdAt: createdBatch.createdAt,
    id: batchId,
    lifecycleStatus: 'CREATED',
    passportSnapshot,
    quantity: 112,
    version: 1,
  },
  correlationId,
} as const;

const releaseResponse: ReleaseWorkCardsResponse = {
  actualCardCount: 250,
  batchId,
  batchVersion: 2,
  correlationId,
  lifecycleStatus: 'RELEASED',
  plannedCardCount: 250,
  setCount: 3,
};

function jsonResponse(payload: unknown, status = 200, requestId?: string): Response {
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
  return createBatchCommandClient(api, () => commandId);
}

describe('команды ПДБ с обязательным read-back', () => {
  it('создаёт партию по выбранному паспорту и возвращает только подтверждённое чтение', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(createResponse, 201, 'request-create'))
      .mockResolvedValueOnce(jsonResponse(createdBatch, 200, 'request-read-back'));

    const result = await commandClient(fetchMock).createBatch({
      productionPassportId: passportId,
      quantity: 112,
    });

    expect(result.batch).toEqual(createdBatch);
    expect(result).toMatchObject({
      commandContext: { requestId: 'request-create' },
      correlationId,
      readBackContext: { requestId: 'request-read-back' },
    });
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      '/api/v1/production-batches',
      `/api/v1/production-batches/${batchId}`,
    ]);
    const [, commandInit] = fetchMock.mock.calls[0] ?? [];
    expect(JSON.parse(String(commandInit?.body))).toEqual({
      commandId,
      productionPassportId: passportId,
      quantity: 112,
    });
  });

  it('выпускает все комплекты с актуальной прочитанной версией и сверяет 3 / 250', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(releaseResponse))
      .mockResolvedValueOnce(jsonResponse(releasedBatch));

    const result = await commandClient(fetchMock).releaseBatch({
      batchId,
      expectedBatchVersion: createdBatch.version,
    });

    expect(result.batch.counts).toEqual({
      actualCardCount: 250,
      closedCardCount: 0,
      plannedCardCount: 250,
      setCount: 3,
    });
    expect(result.batch.sets.map((cardSet) => cardSet.actualCardCount)).toEqual([112, 112, 26]);
    const [, commandInit] = fetchMock.mock.calls[0] ?? [];
    expect(JSON.parse(String(commandInit?.body))).toEqual({
      commandId,
      expectedBatchVersion: 1,
    });
  });

  it('не сообщает успех при частичном или несогласованном read-back', async () => {
    const partialBatch: ProductionBatchDetail = {
      ...releasedBatch,
      counts: { ...releasedBatch.counts, actualCardCount: 249 },
      sets: releasedBatch.sets.map((cardSet, index) =>
        index === 2 ? { ...cardSet, actualCardCount: 25 } : cardSet,
      ),
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(releaseResponse))
      .mockResolvedValueOnce(jsonResponse(partialBatch));

    await expect(
      commandClient(fetchMock).releaseBatch({ batchId, expectedBatchVersion: 1 }),
    ).rejects.toBeInstanceOf(BatchCommandIntegrityError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('не принимает командный ответ с версией, которая не новее отправленной', async () => {
    const staleResponse = { ...releaseResponse, batchVersion: 2 };
    const currentBatch = { ...releasedBatch, version: 2 };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(staleResponse))
      .mockResolvedValueOnce(jsonResponse(currentBatch));

    await expect(
      commandClient(fetchMock).releaseBatch({ batchId, expectedBatchVersion: 2 }),
    ).rejects.toBeInstanceOf(BatchCommandIntegrityError);
  });
});
