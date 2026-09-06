import { describe, expect, it, vi } from 'vitest';

import { createApiClient } from './api-client.js';
import { createReadModelClient } from './read-model.js';

const passportId = '20000000-0000-4000-8000-000000000001';
const operationId = '30000000-0000-4000-8000-000000000001';
const batchId = '40000000-0000-4000-8000-000000000001';
const setId = '50000000-0000-4000-8000-000000000001';
const workCardId = '60000000-0000-4000-8000-000000000001';
const assigneeId = '10000000-0000-4000-8000-000000000003';

const passportSummary = {
  code: 'DEMO-250',
  id: passportId,
  operationCount: 1,
  plannedCardCount: 2,
  productName: 'Учебное изделие',
  revision: 'A',
} as const;

const passportDetail = {
  ...passportSummary,
  operations: [
    {
      id: operationId,
      normHours: '0.25',
      plannedCardCount: 2,
      position: 1,
      scopeCode: 'OP-010',
      scopeName: 'Подготовительная операция',
    },
  ],
} as const;

const setSummary = {
  actualCardCount: 2,
  closedCardCount: 0,
  gateStatus: 'FIRST_ARTICLE_PENDING',
  id: setId,
  normHours: '0.25',
  plannedCardCount: 2,
  scopeCode: 'OP-010',
  scopeName: 'Подготовительная операция',
  version: 1,
} as const;

const workCard = {
  assignee: { displayName: 'Исполнитель Иванов', id: assigneeId },
  availableActions: [],
  batchId,
  batchQuantitySnapshot: 2,
  closureType: null,
  id: workCardId,
  operation: {
    normHours: '0.25',
    scopeCode: 'OP-010',
    scopeName: 'Подготовительная операция',
  },
  purpose: 'FIRST_ARTICLE',
  status: 'ASSIGNED',
  timestamps: {
    assignedAt: '2026-09-02T05:01:00.000Z',
    closedAt: null,
    completedAt: null,
    releasedAt: '2026-09-02T05:00:00.000Z',
    startedAt: null,
  },
  version: 2,
  workCardSetId: setId,
} as const;

const batchDetail = {
  availableActions: [],
  counts: {
    actualCardCount: 2,
    closedCardCount: 0,
    plannedCardCount: 2,
    setCount: 1,
  },
  createdAt: '2026-09-02T05:00:00.000Z',
  finalAcceptance: null,
  finalAcceptedAt: null,
  id: batchId,
  lifecycleStatus: 'RELEASED',
  operationPlan: [
    {
      id: operationId,
      normHours: '0.25',
      plannedCardCount: 2,
      position: 1,
      scopeCode: 'OP-010',
      scopeName: 'Подготовительная операция',
    },
  ],
  passportSnapshot: {
    code: passportSummary.code,
    productName: passportSummary.productName,
    revision: passportSummary.revision,
  },
  quantity: 2,
  releasedAt: '2026-09-02T05:00:30.000Z',
  sets: [setSummary],
  version: 2,
} as const;

const setDetail = {
  actualCardCount: 2,
  assignmentCounts: [
    {
      assignee: { displayName: 'Исполнитель Иванов', id: assigneeId },
      count: 1,
      purpose: 'FIRST_ARTICLE',
    },
  ],
  availableActions: [],
  batchId,
  firstArticleWorkCardId: workCardId,
  gateStatus: 'FIRST_ARTICLE_PENDING',
  id: setId,
  normHours: '0.25',
  plannedCardCount: 2,
  scopeCode: 'OP-010',
  scopeName: 'Подготовительная операция',
  statusCounts: {
    ASSIGNED: 1,
    CLOSED: 0,
    COMPLETED: 0,
    IN_PROGRESS: 0,
    RELEASED: 1,
  },
  version: 2,
} as const;

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  });
}

describe('клиент read-only проекций', () => {
  it('читает каталог паспортов и выбранный паспорт через реальные контрактные пути', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ items: [passportSummary] }))
      .mockResolvedValueOnce(jsonResponse(passportDetail));
    const client = createReadModelClient(createApiClient({ fetchImplementation: fetchMock }));

    await expect(client.listPassports()).resolves.toEqual({ items: [passportSummary] });
    await expect(client.getPassport(passportId)).resolves.toEqual(passportDetail);

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      '/api/v1/production-passports',
      `/api/v1/production-passports/${passportId}`,
    ]);
  });

  it('передаёт непрозрачный cursor и limit при чтении партий', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        items: [
          {
            counts: batchDetail.counts,
            createdAt: batchDetail.createdAt,
            id: batchId,
            lifecycleStatus: batchDetail.lifecycleStatus,
            passportSnapshot: batchDetail.passportSnapshot,
            quantity: batchDetail.quantity,
            version: batchDetail.version,
          },
        ],
        nextCursor: 'next-page',
      }),
    );
    const client = createReadModelClient(createApiClient({ fetchImplementation: fetchMock }));

    const page = await client.listBatches({ cursor: 'page/+=', limit: 20 });

    expect(page.nextCursor).toBe('next-page');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/production-batches?cursor=page%2F%2B%3D&limit=20',
      expect.objectContaining({ credentials: 'same-origin', method: 'GET' }),
    );
  });

  it('читает партию, комплект и карточку отдельными read-back запросами', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(batchDetail))
      .mockResolvedValueOnce(jsonResponse(setDetail))
      .mockResolvedValueOnce(jsonResponse(workCard));
    const client = createReadModelClient(createApiClient({ fetchImplementation: fetchMock }));

    await expect(client.getBatch(batchId)).resolves.toEqual(batchDetail);
    await expect(client.getWorkCardSet(setId)).resolves.toEqual(setDetail);
    await expect(client.getWorkCard(workCardId)).resolves.toEqual(workCard);

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      `/api/v1/production-batches/${batchId}`,
      `/api/v1/work-card-sets/${setId}`,
      `/api/v1/work-cards/${workCardId}`,
    ]);
  });

  it('отправляет cursor, состояние и исполнителя как серверные фильтры карточек', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ items: [workCard], nextCursor: null }),
    );
    const client = createReadModelClient(createApiClient({ fetchImplementation: fetchMock }));

    await expect(
      client.listWorkCards({
        assigneeId,
        cursor: 'next/card',
        limit: 25,
        setId,
        status: 'ASSIGNED',
      }),
    ).resolves.toEqual({ items: [workCard], nextCursor: null });

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/work-card-sets/${setId}/work-cards?cursor=next%2Fcard&limit=25&status=ASSIGNED&assigneeId=${assigneeId}`,
      expect.objectContaining({ credentials: 'same-origin', method: 'GET' }),
    );
  });

  it('не принимает доменные данные, не прошедшие runtime-схему', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ ...workCard, batchQuantitySnapshot: 'две' }),
    );
    const client = createReadModelClient(createApiClient({ fetchImplementation: fetchMock }));

    await expect(client.getWorkCard(workCardId)).rejects.toMatchObject({
      kind: 'invalid-response',
    });
  });
});
