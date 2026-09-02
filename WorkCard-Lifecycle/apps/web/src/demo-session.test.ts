import type { DemoSessionResponse, DemoUser } from '@work-card/contracts';
import { describe, expect, it, vi } from 'vitest';

import { bootstrapDemoSession, createDemoSessionClient } from './demo-session.js';
import { resetSessionScope, SessionScope } from './session-scope.js';

const planner: DemoUser = {
  displayName: 'Специалист ПДБ',
  id: '10000000-0000-4000-8000-000000000001',
  role: 'PLANNER',
  roleLabel: 'Специалист ПДБ',
};

const master: DemoUser = {
  displayName: 'Мастер участка',
  id: '10000000-0000-4000-8000-000000000002',
  role: 'MASTER',
  roleLabel: 'Мастер участка',
};

const masterSession: DemoSessionResponse = {
  actor: master,
  csrfToken: 'csrf-token-kept-only-in-application-memory-1234',
  permissions: ['AssignWorkCards', 'StartWorkCard', 'CompleteWorkCard'],
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });
}

describe('bootstrap демонстрационной сессии', () => {
  it('параллельно получает подготовленных пользователей и восстанавливает текущую сессию', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      if (input === '/api/v1/demo-users') return jsonResponse({ items: [planner, master] });
      if (input === '/api/v1/demo-session') return jsonResponse(masterSession);
      throw new Error(`Неожиданный запрос: ${String(input)}`);
    });

    const bootstrap = await bootstrapDemoSession(createDemoSessionClient(fetchMock));

    expect(bootstrap).toEqual({ session: masterSession, users: [planner, master] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init).toMatchObject({ cache: 'no-store', credentials: 'same-origin', method: 'GET' });
    }
  });

  it('оставляет выбор роли открытым, когда HttpOnly cookie не содержит активной сессии', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      if (input === '/api/v1/demo-users') return jsonResponse({ items: [planner, master] });
      return jsonResponse({ title: 'Требуется вход' }, 401);
    });

    await expect(bootstrapDemoSession(createDemoSessionClient(fetchMock))).resolves.toEqual({
      session: null,
      users: [planner, master],
    });
  });
});

describe('смена роли и завершение сессии', () => {
  it('создаёт новую серверную сессию только по ID выбранного подготовленного пользователя', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(masterSession, 201));
    const client = createDemoSessionClient(fetchMock);

    await expect(client.createSession(master.id)).resolves.toEqual(masterSession);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [path, init] = fetchMock.mock.calls[0] ?? [];
    expect(path).toBe('/api/v1/demo-session');
    expect(init).toMatchObject({ credentials: 'same-origin', method: 'POST' });
    expect(JSON.parse(String(init?.body))).toEqual({ demoUserId: master.id });
    expect(new Headers(init?.headers).get('X-CSRF-Token')).toBeNull();
  });

  it('очищает состояние команд и защищённый кэш на границе смены пользователя', () => {
    const scope = new SessionScope();
    scope.setCommandState('assign-work-cards', { selected: ['card-1'] });
    scope.setCached('protected:/api/v1/work-cards/card-1', { assignee: 'previous-user' });

    expect(resetSessionScope(scope)).toBe(1);
    expect(scope.getCommandState('assign-work-cards')).toBeUndefined();
    expect(scope.getCached('protected:/api/v1/work-cards/card-1')).toBeUndefined();
  });

  it('передаёт CSRF-токен из памяти при выходе и не отправляет его в теле', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    const client = createDemoSessionClient(fetchMock);

    await client.deleteSession(masterSession.csrfToken);

    const [path, init] = fetchMock.mock.calls[0] ?? [];
    expect(path).toBe('/api/v1/demo-session');
    expect(init).toMatchObject({ credentials: 'same-origin', method: 'DELETE' });
    expect(init?.body).toBeUndefined();
    expect(new Headers(init?.headers).get('X-CSRF-Token')).toBe(masterSession.csrfToken);
  });
});
