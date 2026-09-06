import type { AuditEvent } from '@work-card/contracts';
import { describe, expect, it, vi } from 'vitest';

import { AuditIntegrityError, createAdminAuditClient } from './admin-audit.js';
import { createApiClient } from './api-client.js';

const cardId = '10000000-0000-4000-8000-000000000001';
const commandId = '20000000-0000-4000-8000-000000000001';
const correlationId = '30000000-0000-4000-8000-000000000001';
const actorId = '40000000-0000-4000-8000-000000000001';

function event(index: number, overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    actorId,
    actorRole: 'MASTER',
    aggregateId: cardId,
    aggregateType: 'WorkCard',
    aggregateVersion: index,
    commandId,
    correlationId,
    data: { status: 'ASSIGNED' },
    eventType: 'WorkCardAssigned',
    id: `50000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    occurredAt: `2026-09-03T08:00:0${index}.000Z`,
    ...overrides,
  };
}

function jsonResponse(payload: unknown, requestId?: string): Response {
  return new Response(JSON.stringify(payload), {
    headers: {
      'Content-Type': 'application/json',
      ...(requestId ? { 'X-Request-Id': requestId } : {}),
    },
  });
}

describe('полное чтение аудита администратора', () => {
  it('догружает историю карточки до последней страницы в порядке версий', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ events: [event(1), event(2)], nextCursor: 'next-page' }, 'history-1'),
      )
      .mockResolvedValueOnce(jsonResponse({ events: [event(3)], nextCursor: null }, 'history-2'));
    const client = createAdminAuditClient(createApiClient({ fetchImplementation: fetchMock }), 2);

    const history = await client.getWorkCardHistory(cardId);

    expect(history.events.map((item) => item.aggregateVersion)).toEqual([1, 2, 3]);
    expect(history.readContexts).toEqual([{ requestId: 'history-1' }, { requestId: 'history-2' }]);
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      `/api/v1/work-cards/${cardId}/history?limit=2`,
      `/api/v1/work-cards/${cardId}/history?limit=2&cursor=next-page`,
    ]);
  });

  it('собирает все страницы correlation только при совпавших authoritative totals', async () => {
    const first = event(1, { aggregateId: cardId });
    const second = event(2, {
      aggregateId: '60000000-0000-4000-8000-000000000001',
      aggregateType: 'WorkCardSet',
    });
    const third = event(3, {
      aggregateId: '70000000-0000-4000-8000-000000000001',
      aggregateType: 'ProductionBatch',
    });
    const pageEnvelope = {
      commandId,
      commandType: 'ReleaseWorkCards',
      correlationId,
      expectedEventCount: 3,
      totalEventCount: 3,
    } as const;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ ...pageEnvelope, events: [first, second], nextCursor: 'audit-next' }),
      )
      .mockResolvedValueOnce(jsonResponse({ ...pageEnvelope, events: [third], nextCursor: null }));
    const client = createAdminAuditClient(createApiClient({ fetchImplementation: fetchMock }), 2);

    const context = await client.getCompleteCorrelation(correlationId);

    expect(context).toMatchObject({
      commandId,
      commandType: 'ReleaseWorkCards',
      correlationId,
      expectedEventCount: 3,
      totalEventCount: 3,
    });
    expect(context.events).toEqual([first, second, third]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('не считает неполный набор успешным, даже если сервер завершил pagination', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        commandId,
        commandType: 'AssignWorkCards',
        correlationId,
        events: [event(1)],
        expectedEventCount: 2,
        nextCursor: null,
        totalEventCount: 2,
      }),
    );
    const client = createAdminAuditClient(createApiClient({ fetchImplementation: fetchMock }));

    await expect(client.getCompleteCorrelation(correlationId)).rejects.toThrow(
      'Загружены не все события',
    );
  });

  it('отклоняет несовпадение expected и total до показа событий', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        commandId,
        commandType: 'ReleaseWorkCards',
        correlationId,
        events: [event(1)],
        expectedEventCount: 2,
        nextCursor: null,
        totalEventCount: 1,
      }),
    );
    const client = createAdminAuditClient(createApiClient({ fetchImplementation: fetchMock }));

    await expect(client.getCompleteCorrelation(correlationId)).rejects.toBeInstanceOf(
      AuditIntegrityError,
    );
  });

  it('принимает нулевой набор идемпотентного повтора только при итогах 0 из 0', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        commandId,
        commandType: 'ExportWorkCardToPayroll',
        correlationId,
        events: [],
        expectedEventCount: 0,
        nextCursor: null,
        totalEventCount: 0,
      }),
    );
    const client = createAdminAuditClient(createApiClient({ fetchImplementation: fetchMock }));

    await expect(client.getCompleteCorrelation(correlationId)).resolves.toMatchObject({
      events: [],
      expectedEventCount: 0,
      totalEventCount: 0,
    });
  });
});
