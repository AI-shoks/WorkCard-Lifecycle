import {
  DemoUsersResponseSchema,
  ProductionBatchDetailSchema,
  ReleaseWorkCardsResponseSchema,
  type DemoSessionResponse,
  type DemoUser,
  type ProblemDetails,
  type ReleaseWorkCardsBody,
} from '@work-card/contracts';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import { ApiClientError, contractResponse, createApiClient, emptyResponse } from './api-client.js';

const planner: DemoUser = {
  displayName: 'Специалист ПДБ',
  id: '10000000-0000-4000-8000-000000000001',
  role: 'PLANNER',
  roleLabel: 'Специалист ПДБ',
};

const session: DemoSessionResponse = {
  actor: planner,
  csrfToken: 'csrf-token-kept-only-in-application-memory-1234',
  permissions: ['CreateProductionBatch', 'ReleaseWorkCards'],
};

const releaseBody: ReleaseWorkCardsBody = {
  commandId: '20000000-0000-4000-8000-000000000001',
  expectedBatchVersion: 1,
};

const releaseResponse = {
  actualCardCount: 2,
  batchId: '30000000-0000-4000-8000-000000000001',
  batchVersion: 2,
  correlationId: '40000000-0000-4000-8000-000000000001',
  lifecycleStatus: 'RELEASED',
  plannedCardCount: 2,
  setCount: 1,
} as const;

const releasedBatch = {
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
  id: releaseResponse.batchId,
  lifecycleStatus: 'RELEASED',
  passportSnapshot: {
    code: 'WC-DEMO-001',
    productName: 'Демонстрационное изделие',
    revision: 'A',
  },
  quantity: 2,
  releasedAt: '2026-09-02T05:01:00.000Z',
  sets: [],
  version: 2,
} as const;

function jsonResponse(payload: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json', ...headers },
    status,
  });
}

function problemResponse(problem: ProblemDetails, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(problem), {
    headers: { 'Content-Type': 'application/problem+json; charset=utf-8', ...headers },
    status: problem.status,
  });
}

function mutationRequest(
  readBack = vi.fn(() => ({
    path: `/api/v1/production-batches/${releaseResponse.batchId}` as const,
    response: contractResponse(ProductionBatchDetailSchema),
  })),
) {
  return {
    body: releaseBody,
    path: `/api/v1/production-batches/${releaseResponse.batchId}/release` as const,
    readBack,
    response: contractResponse(ReleaseWorkCardsResponseSchema),
  };
}

async function caughtApiError(action: Promise<unknown>): Promise<ApiClientError> {
  try {
    await action;
  } catch (error) {
    expect(error).toBeInstanceOf(ApiClientError);
    if (error instanceof ApiClientError) return error;
    throw error;
  }

  throw new Error('Ожидалась ошибка API client.');
}

describe('typed API client', () => {
  it('возвращает типизированный JSON только после проверки общей contract-схемой', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ items: [planner] }));
    const client = createApiClient({ fetchImplementation: fetchMock });

    const result = await client.read({
      path: '/api/v1/demo-users',
      response: contractResponse(DemoUsersResponseSchema),
    });

    expect(result.data).toEqual({ items: [planner] });
    expectTypeOf(result.data.items).toEqualTypeOf<DemoUser[]>();
  });

  it('принимает успешный ответ без тела, включая 204', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    const client = createApiClient({ fetchImplementation: fetchMock });

    await expect(
      client.read({
        path: '/api/v1/empty',
        response: emptyResponse,
      }),
    ).resolves.toEqual({ context: {}, data: undefined, status: 204 });
  });

  it('нормализует настоящий application/problem+json и сохраняет request context', async () => {
    const problem: ProblemDetails = {
      code: 'VERSION_CONFLICT',
      conflicts: [
        {
          actualVersion: 3,
          expectedVersion: 2,
          resourceId: releaseResponse.batchId,
          resourceType: 'ProductionBatch',
        },
      ],
      detail: 'Обновите данные и повторите решение.',
      instance: `/api/v1/production-batches/${releaseResponse.batchId}/release`,
      requestId: 'request-from-problem',
      status: 409,
      title: 'Данные были изменены',
      type: 'https://work-card.example/problems/version-conflict',
    };
    const fetchMock = vi.fn<typeof fetch>(async () =>
      problemResponse(problem, { 'X-Request-Id': 'request-from-header' }),
    );
    const client = createApiClient({ fetchImplementation: fetchMock });

    const error = await caughtApiError(
      client.read({
        path: '/api/v1/production-batches',
        response: contractResponse(DemoUsersResponseSchema),
      }),
    );

    expect(error).toMatchObject({
      context: { requestId: 'request-from-header' },
      kind: 'http-problem',
      message: problem.detail,
      problem,
      status: 409,
    });
  });

  it('безопасно обрабатывает non-JSON error response без раскрытия его тела', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response('database-password-and-stack-trace', {
          headers: { 'Content-Type': 'text/plain', 'X-Request-Id': 'request-500' },
          status: 500,
        }),
    );
    const client = createApiClient({ fetchImplementation: fetchMock });

    const error = await caughtApiError(
      client.read({
        path: '/api/v1/production-batches',
        response: contractResponse(DemoUsersResponseSchema),
      }),
    );

    expect(error).toMatchObject({
      context: { requestId: 'request-500' },
      kind: 'http-error',
      problem: null,
      status: 500,
    });
    expect(error.message).not.toContain('database-password');
  });

  it('отклоняет некорректный success payload как invalid-response', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ items: [{ ...planner, role: 'UNTRUSTED_ROLE' }] }, 200, {
        'X-Request-Id': 'request-invalid-success',
      }),
    );
    const client = createApiClient({ fetchImplementation: fetchMock });

    const error = await caughtApiError(
      client.read({
        path: '/api/v1/demo-users',
        response: contractResponse(DemoUsersResponseSchema),
      }),
    );

    expect(error).toMatchObject({
      context: { requestId: 'request-invalid-success' },
      kind: 'invalid-response',
      status: 200,
    });
  });

  it('сохраняет request и correlation context из фактического success response', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse(releaseResponse, 200, { 'X-Request-Id': 'request-release' }),
    );
    const client = createApiClient({ fetchImplementation: fetchMock });

    const result = await client.read({
      path: `/api/v1/production-batches/${releaseResponse.batchId}`,
      response: contractResponse(ReleaseWorkCardsResponseSchema),
    });

    expect(result.context).toEqual({
      correlationId: releaseResponse.correlationId,
      requestId: 'request-release',
    });
  });

  it('всегда использует credentials same-origin и передаёт AbortSignal', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ items: [planner] }));
    const client = createApiClient({ fetchImplementation: fetchMock });

    await client.read({
      path: '/api/v1/demo-users',
      response: contractResponse(DemoUsersResponseSchema),
      signal: controller.signal,
    });

    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(init).toMatchObject({
      credentials: 'same-origin',
      method: 'GET',
      signal: controller.signal,
    });
  });

  it('отклоняет адрес, который после нормализации выходит за /api/v1', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const client = createApiClient({ fetchImplementation: fetchMock });

    const error = await caughtApiError(
      client.read({
        path: '/api/v1/../outside',
        response: contractResponse(DemoUsersResponseSchema),
      }),
    );

    expect(error.kind).toBe('invalid-request');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('не читает сессию и не добавляет CSRF к read-only запросу', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ items: [planner] }));
    const getConfirmedDemoSession = vi.fn(() => session);
    const client = createApiClient({ fetchImplementation: fetchMock, getConfirmedDemoSession });

    await client.read({
      path: '/api/v1/demo-users',
      response: contractResponse(DemoUsersResponseSchema),
    });

    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(getConfirmedDemoSession).not.toHaveBeenCalled();
    expect(new Headers(init?.headers).get('X-CSRF-Token')).toBeNull();
  });

  it('берёт CSRF для mutation из текущей подтверждённой сессии только в момент запроса', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(releaseResponse))
      .mockResolvedValueOnce(jsonResponse(releasedBatch));
    const getConfirmedDemoSession = vi.fn(() => session);
    const client = createApiClient({ fetchImplementation: fetchMock, getConfirmedDemoSession });

    await client.mutate(mutationRequest());

    const [, commandInit] = fetchMock.mock.calls[0] ?? [];
    const [, readBackInit] = fetchMock.mock.calls[1] ?? [];
    expect(getConfirmedDemoSession).toHaveBeenCalledOnce();
    expect(new Headers(commandInit?.headers).get('X-CSRF-Token')).toBe(session.csrfToken);
    expect(JSON.parse(String(commandInit?.body))).toEqual(releaseBody);
    expect(new Headers(readBackInit?.headers).get('X-CSRF-Token')).toBeNull();
  });

  it('отказывает mutation до fetch и read-back при отсутствии CSRF', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const readBack = vi.fn(() => ({
      path: `/api/v1/production-batches/${releaseResponse.batchId}` as const,
      response: contractResponse(ProductionBatchDetailSchema),
    }));
    const client = createApiClient({ fetchImplementation: fetchMock });

    const error = await caughtApiError(client.mutate(mutationRequest(readBack)));

    expect(error.kind).toBe('missing-csrf');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(readBack).not.toHaveBeenCalled();
  });

  it('не повторяет mutation автоматически после transport failure', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw new TypeError('network failed');
    });
    const readBack = vi.fn(() => ({
      path: `/api/v1/production-batches/${releaseResponse.batchId}` as const,
      response: contractResponse(ProductionBatchDetailSchema),
    }));
    const client = createApiClient({
      fetchImplementation: fetchMock,
      getConfirmedDemoSession: () => session,
    });

    const error = await caughtApiError(client.mutate(mutationRequest(readBack)));

    expect(error.kind).toBe('transport');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(readBack).not.toHaveBeenCalled();
  });

  it('завершает mutation только после обязательного успешного read-back', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(releaseResponse))
      .mockResolvedValueOnce(jsonResponse(releasedBatch));
    const client = createApiClient({
      fetchImplementation: fetchMock,
      getConfirmedDemoSession: () => session,
    });

    const completion = await client.mutate(mutationRequest());

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      `/api/v1/production-batches/${releaseResponse.batchId}/release`,
      `/api/v1/production-batches/${releaseResponse.batchId}`,
    ]);
    expect(completion.command.data).toEqual(releaseResponse);
    expect(completion.readBack.data).toEqual(releasedBatch);
  });

  it('не выполняет read-back после отклонённой mutation', async () => {
    const problem: ProblemDetails = {
      code: 'STATE_CONFLICT',
      detail: 'Действие не соответствует текущему состоянию.',
      instance: `/api/v1/production-batches/${releaseResponse.batchId}/release`,
      requestId: 'request-rejected-command',
      status: 409,
      title: 'Действие не соответствует текущему состоянию',
      type: 'https://work-card.example/problems/state-conflict',
    };
    const fetchMock = vi.fn<typeof fetch>(async () => problemResponse(problem));
    const readBack = vi.fn(() => ({
      path: `/api/v1/production-batches/${releaseResponse.batchId}` as const,
      response: contractResponse(ProductionBatchDetailSchema),
    }));
    const client = createApiClient({
      fetchImplementation: fetchMock,
      getConfirmedDemoSession: () => session,
    });

    const error = await caughtApiError(client.mutate(mutationRequest(readBack)));

    expect(error.kind).toBe('http-problem');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(readBack).not.toHaveBeenCalled();
  });

  it('не считает mutation успешной, если обязательный read-back завершился ошибкой', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(releaseResponse))
      .mockResolvedValueOnce(new Response('unavailable', { status: 503 }));
    const client = createApiClient({
      fetchImplementation: fetchMock,
      getConfirmedDemoSession: () => session,
    });

    const error = await caughtApiError(client.mutate(mutationRequest()));

    expect(error).toMatchObject({ kind: 'http-error', status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('сохраняет abort отличимым от HTTP и transport errors', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn<typeof fetch>(async () => {
      controller.abort();
      throw new DOMException('aborted', 'AbortError');
    });
    const client = createApiClient({ fetchImplementation: fetchMock });

    const error = await caughtApiError(
      client.read({
        path: '/api/v1/demo-users',
        response: contractResponse(DemoUsersResponseSchema),
        signal: controller.signal,
      }),
    );

    expect(error).toMatchObject({ kind: 'abort', problem: null, status: null });
  });
});
