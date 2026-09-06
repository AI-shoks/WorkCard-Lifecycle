// @vitest-environment jsdom

import type {
  DemoSessionResponse,
  DemoUser,
  PayrollRecord,
  ProductionBatchDetail,
  ProductionPassportDetail,
  WorkCard,
  WorkCardSetDetail,
} from '@work-card/contracts';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { App as AppComponent } from './App.js';
import { ApiClientError, createApiClient } from './api-client.js';
import { PayrollReadyContent } from './admin-screens.js';
import { matchAppRoute } from './app-routing.js';
import type { BatchCommandClient, ConfirmedBatchCommand } from './batch-commands.js';
import type { ConfirmedAssignmentCommand, MasterCommandClient } from './master-commands.js';
import type { QualityCommandClient } from './quality-commands.js';
import { createPayrollCommandClient } from './payroll-commands.js';
import type { ReadModelClient } from './read-model.js';
import { NewBatchScreen, WorkCardSetScreen } from './read-only-screens.js';
import { TechnicalDetails } from './screen-ui.js';

const batchId = '10000000-0000-4000-8000-000000000001';
const setId = '20000000-0000-4000-8000-000000000001';
const passportId = '30000000-0000-4000-8000-000000000001';
const worker: DemoUser = {
  displayName: 'Исполнитель Иванов',
  id: '40000000-0000-4000-8000-000000000001',
  role: 'WORKER',
  roleLabel: 'Исполнитель',
};
const master: DemoUser = {
  displayName: 'Мастер Сидоров',
  id: '40000000-0000-4000-8000-000000000002',
  role: 'MASTER',
  roleLabel: 'Мастер',
};
const admin: DemoUser = {
  displayName: 'Администратор демонстрации',
  id: '40000000-0000-4000-8000-000000000003',
  role: 'ADMIN_AUDITOR',
  roleLabel: 'Администратор-аудитор',
};
const planner: DemoUser = {
  displayName: 'Специалист ПДБ',
  id: '40000000-0000-4000-8000-000000000004',
  role: 'PLANNER',
  roleLabel: 'Специалист ПДБ',
};
const passport: ProductionPassportDetail = {
  code: 'DEMO-2',
  id: passportId,
  operationCount: 1,
  operations: [
    {
      id: '50000000-0000-4000-8000-000000000001',
      normHours: '0.80',
      plannedCardCount: 2,
      position: 1,
      scopeCode: 'OP-010-030',
      scopeName: 'Операции 010–030',
    },
  ],
  plannedCardCount: 2,
  productName: 'Учебное изделие',
  revision: 'A',
};
const batch: ProductionBatchDetail = {
  availableActions: ['ReleaseWorkCards'],
  counts: { actualCardCount: 0, closedCardCount: 0, plannedCardCount: 2, setCount: 0 },
  createdAt: '2026-09-05T05:00:00.000Z',
  finalAcceptance: null,
  finalAcceptedAt: null,
  id: batchId,
  lifecycleStatus: 'CREATED',
  operationPlan: passport.operations,
  passportSnapshot: { code: passport.code, productName: passport.productName, revision: 'A' },
  quantity: 112,
  releasedAt: null,
  sets: [],
  version: 1,
};
const cardSet: WorkCardSetDetail = {
  actualCardCount: 2,
  assignmentCounts: [],
  availableActions: ['AssignWorkCards'],
  batchId,
  firstArticleWorkCardId: null,
  gateStatus: 'SERIAL_ALLOWED',
  id: setId,
  normHours: '0.80',
  plannedCardCount: 2,
  scopeCode: 'OP-010-030',
  scopeName: 'Операции 010–030',
  statusCounts: { ASSIGNED: 0, CLOSED: 0, COMPLETED: 0, IN_PROGRESS: 0, RELEASED: 2 },
  version: 3,
};
const cards: WorkCard[] = [1, 2].map((index) => ({
  assignee: null,
  availableActions: [],
  batchId,
  batchQuantitySnapshot: 112,
  closureType: null,
  id: `60000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  operation: { normHours: '0.80', scopeCode: 'OP-010-030', scopeName: 'Операции 010–030' },
  purpose: null,
  status: 'RELEASED',
  timestamps: {
    assignedAt: null,
    closedAt: null,
    completedAt: null,
    releasedAt: '2026-09-05T05:01:00.000Z',
    startedAt: null,
  },
  version: 1,
  workCardSetId: setId,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function route(path: string) {
  const result = matchAppRoute(path);
  if (result.kind !== 'screen') throw new Error('Ожидался маршрут экрана.');
  return result;
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });
}

function session(actor: DemoUser): DemoSessionResponse {
  return {
    actor,
    csrfToken: `session-token-kept-in-memory-only-${actor.id}`,
    permissions:
      actor.role === 'MASTER'
        ? ['AssignWorkCards', 'StartWorkCard', 'CompleteWorkCard']
        : actor.role === 'ADMIN_AUDITOR'
          ? ['ExportWorkCardToPayroll']
          : actor.role === 'PLANNER'
            ? ['CreateProductionBatch', 'ReleaseWorkCards']
            : [],
  };
}

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn<typeof fetch>();
let App: typeof AppComponent;

beforeAll(async () => {
  vi.stubGlobal('fetch', fetchMock);
  ({ App } = await import('./App.js'));
});

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
  window.history.replaceState(null, '', '/batches');
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render(content: ReactNode) {
  await act(async () => root.render(content));
}

function element<T extends Element>(selector: string): T {
  const result = container.querySelector<T>(selector);
  if (!result) throw new Error(`Не найден элемент: ${selector}`);
  return result;
}

async function change(selector: string, value: string) {
  const target = element<HTMLInputElement | HTMLSelectElement>(selector);
  await act(async () => {
    const prototype =
      target instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(target, value);
    target.dispatchEvent(
      new Event(target instanceof HTMLSelectElement ? 'change' : 'input', {
        bubbles: true,
      }),
    );
  });
}

async function submit(selector: string) {
  await act(async () => {
    element<HTMLFormElement>(selector).dispatchEvent(
      new Event('submit', {
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

async function click(selector: string) {
  await act(async () => element<HTMLElement>(selector).click());
}

function screenProps() {
  const readModel = {
    getPassport: vi.fn(async () => passport),
    getWorkCard: vi.fn(async (id: string) => cards.find((card) => card.id === id)!),
    getWorkCardSet: vi.fn(async () => cardSet),
    listBatches: vi.fn(async () => ({ items: [], nextCursor: null })),
    listPassports: vi.fn(async () => ({ items: [passport] })),
    listWorkCards: vi.fn(async () => ({ items: cards, nextCursor: null })),
  };
  return {
    batchCommands: { createBatch: vi.fn(), releaseBatch: vi.fn() } as BatchCommandClient,
    masterCommands: {
      assignWorkCards: vi.fn(),
      completeWorkCard: vi.fn(),
      startWorkCard: vi.fn(),
    } as MasterCommandClient,
    navigate: vi.fn(),
    onAnnounce: vi.fn(),
    onRefresh: vi.fn(),
    permissions: ['CreateProductionBatch', 'ReleaseWorkCards'] as const,
    qualityCommands: {} as QualityCommandClient,
    readModel: readModel as unknown as ReadModelClient,
    role: 'PLANNER' as const,
    route: route('/batches/new'),
    workers: [worker],
  };
}

describe('интерактивная форма и состояния команды', () => {
  it('сохраняет некорректный ввод и связывает ошибку количества с полем без команды', async () => {
    const props = screenProps();
    await render(<NewBatchScreen {...props} />);
    await change('#batch-quantity', '1.5');
    await submit('.batch-creation-form');

    const input = element<HTMLInputElement>('#batch-quantity');
    expect(input.value).toBe('1.5');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const error = element('[role="alert"]');
    expect(input.getAttribute('aria-describedby')?.split(' ')).toContain(error.id);
    expect(element<HTMLSelectElement>('.passport-reader select').value).toBe(passportId);
    expect(props.batchCommands.createBatch).not.toHaveBeenCalled();
  });

  it('оставляет создание pending до подтверждения, исключает двойную отправку и затем открывает партию', async () => {
    const props = screenProps();
    const completion = deferred<ConfirmedBatchCommand>();
    vi.mocked(props.batchCommands.createBatch).mockReturnValue(completion.promise);
    await render(<NewBatchScreen {...props} />);
    await submit('.batch-creation-form');
    await submit('.batch-creation-form');

    expect(props.batchCommands.createBatch).toHaveBeenCalledTimes(1);
    expect(element('form').getAttribute('aria-busy')).toBe('true');
    expect(element<HTMLButtonElement>('button[type="submit"]').disabled).toBe(true);
    expect(element<HTMLInputElement>('#batch-quantity').disabled).toBe(true);
    expect(props.navigate).not.toHaveBeenCalled();

    await act(async () =>
      completion.resolve({
        batch,
        commandContext: {},
        correlationId: 'confirmed-command',
        readBackContext: {},
      }),
    );
    expect(props.navigate).toHaveBeenCalledExactlyOnceWith(`/batches/${batchId}`);
    expect(props.onAnnounce).toHaveBeenCalledWith(expect.stringContaining('контрольным чтением'));
  });

  it('сохраняет форму при серверной validation-ошибке и разрешает исправление поля', async () => {
    const props = screenProps();
    vi.mocked(props.batchCommands.createBatch).mockRejectedValue(
      new ApiClientError({
        kind: 'http-problem',
        message: 'Проверьте количество изделий.',
        status: 422,
        problem: {
          code: 'VALIDATION_ERROR',
          detail: 'Проверьте количество изделий.',
          instance: '/api/v1/production-batches',
          requestId: 'validation-request',
          status: 422,
          title: 'Некорректные данные',
          type: 'https://work-card.example/problems/validation-error',
        },
      }),
    );
    await render(<NewBatchScreen {...props} />);
    await change('#batch-quantity', '56');
    await submit('.batch-creation-form');

    const input = element<HTMLInputElement>('#batch-quantity');
    expect(input.value).toBe('56');
    expect(input.disabled).toBe(false);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const descriptionIds = input.getAttribute('aria-describedby')?.split(' ') ?? [];
    expect(
      descriptionIds.some((id) => document.getElementById(id)?.textContent?.includes('Проверьте')),
    ).toBe(true);
    expect(element<HTMLSelectElement>('.passport-reader select').value).toBe(passportId);
    expect(props.readModel.listBatches).not.toHaveBeenCalled();
    await change('#batch-quantity', '57');
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    expect(element<HTMLButtonElement>('button[type="submit"]').disabled).toBe(false);
  });

  it('при сетевой неопределённости очищает форму, перечитывает контекст и ждёт нового решения', async () => {
    const props = screenProps();
    vi.mocked(props.batchCommands.createBatch).mockRejectedValue(
      new ApiClientError({
        kind: 'transport',
        message: 'Нет связи',
      }),
    );
    await render(<NewBatchScreen {...props} />);
    await change('#batch-quantity', '56');
    await submit('.batch-creation-form');

    expect(element<HTMLInputElement>('#batch-quantity').value).toBe('112');
    expect(element<HTMLButtonElement>('button[type="submit"]').disabled).toBe(true);
    expect(props.readModel.listBatches).toHaveBeenCalledTimes(1);
    expect(props.readModel.listPassports).toHaveBeenCalledTimes(2);
    expect(props.navigate).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Результат создания не подтверждён');
    await submit('.batch-creation-form');
    expect(props.batchCommands.createBatch).toHaveBeenCalledTimes(1);
  });
});

describe('массовый выбор и восстановление команды', () => {
  it('перечитывает весь выбор после conflict, очищает исполнителя и требует новый выбор с новой версией', async () => {
    const props = screenProps();
    const completion = deferred<ConfirmedAssignmentCommand>();
    vi.mocked(props.masterCommands.assignWorkCards).mockReturnValue(completion.promise);
    vi.mocked(props.readModel.getWorkCardSet)
      .mockResolvedValueOnce(cardSet)
      .mockResolvedValue({ ...cardSet, version: 4 });
    await render(
      <WorkCardSetScreen
        {...props}
        permissions={['AssignWorkCards']}
        role="MASTER"
        route={route(`/card-sets/${setId}`)}
      />,
    );
    await change('#bulk-card-count', '2');
    await click('.bulk-selection button');
    await change('.assignment-command__footer select', worker.id);
    await submit('.assignment-command');

    expect(props.masterCommands.assignWorkCards).not.toHaveBeenCalled();
    expect(element('dialog').textContent).toContain('Подтвердить назначение карточек');
    await click('dialog button.button--secondary');
    expect(container.querySelector('dialog')).toBeNull();
    expect(props.masterCommands.assignWorkCards).not.toHaveBeenCalled();
    await submit('.assignment-command');
    await act(async () => {
      const confirmation = element<HTMLButtonElement>('dialog button.button--primary');
      confirmation.click();
      confirmation.click();
    });

    expect(props.masterCommands.assignWorkCards).toHaveBeenCalledTimes(1);
    expect(element<HTMLButtonElement>('.assignment-command button[type="submit"]').disabled).toBe(
      true,
    );
    expect(container.querySelector('.notice--success')).toBeNull();
    await act(async () =>
      completion.reject(
        new ApiClientError({
          kind: 'http-problem',
          message: 'Версия изменилась',
          status: 409,
        }),
      ),
    );

    expect(props.readModel.getWorkCardSet).toHaveBeenCalledTimes(2);
    expect(props.readModel.getWorkCard).toHaveBeenCalledTimes(2);
    expect(vi.mocked(props.readModel.getWorkCard).mock.calls.map(([id]) => id)).toEqual(
      cards.map((card) => card.id),
    );
    expect(element<HTMLSelectElement>('.assignment-command__footer select').value).toBe('');
    expect(container.querySelectorAll('input:checked')).toHaveLength(0);
    expect(container.querySelector('.notice--success')).toBeNull();
    await submit('.assignment-command');
    expect(props.masterCommands.assignWorkCards).toHaveBeenCalledTimes(1);

    vi.mocked(props.masterCommands.assignWorkCards).mockReturnValue(new Promise(() => undefined));
    await click('.bulk-selection button');
    await change('.assignment-command__footer select', worker.id);
    await submit('.assignment-command');
    expect(props.masterCommands.assignWorkCards).toHaveBeenCalledTimes(1);
    await click('dialog button.button--primary');
    expect(props.masterCommands.assignWorkCards).toHaveBeenCalledTimes(2);
    expect(vi.mocked(props.masterCommands.assignWorkCards).mock.calls[1]?.[0]).toMatchObject({
      assigneeId: worker.id,
      cards,
      purpose: 'SERIAL',
      set: { id: setId, version: 4 },
    });
  });

  it('при частичном recovery сохраняет блокировку и повторяет только чтения по явному действию', async () => {
    const props = screenProps();
    vi.mocked(props.masterCommands.assignWorkCards).mockRejectedValue(
      new ApiClientError({
        kind: 'transport',
        message: 'Нет связи',
      }),
    );
    vi.mocked(props.readModel.getWorkCard).mockRejectedValueOnce(new Error('read failed'));
    await render(
      <WorkCardSetScreen
        {...props}
        permissions={['AssignWorkCards']}
        role="MASTER"
        route={route(`/card-sets/${setId}`)}
      />,
    );
    await change('#bulk-card-count', '2');
    await click('.bulk-selection button');
    await change('.assignment-command__footer select', worker.id);
    await submit('.assignment-command');
    await click('dialog button.button--primary');

    expect(container.textContent).toContain('Полное перечитывание не завершилось');
    expect(element<HTMLButtonElement>('.bulk-selection button').disabled).toBe(true);
    expect(element<HTMLSelectElement>('.assignment-command__footer select').disabled).toBe(true);
    const retry = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Перечитать комплект и карточки'),
    )!;
    await act(async () => retry.click());
    expect(props.masterCommands.assignWorkCards).toHaveBeenCalledTimes(1);
    expect(props.readModel.getWorkCard).toHaveBeenCalledTimes(4);
    expect(element<HTMLSelectElement>('.assignment-command__footer select').disabled).toBe(false);
    expect(container.querySelectorAll('input:checked')).toHaveLength(0);
  });

  it('в режиме первой детали оставляет ровно одну строку и не показывает массовый выбор серии', async () => {
    const props = screenProps();
    vi.mocked(props.readModel.getWorkCardSet).mockResolvedValue({
      ...cardSet,
      gateStatus: 'FIRST_ARTICLE_PENDING',
    });
    await render(
      <WorkCardSetScreen
        {...props}
        permissions={['AssignWorkCards']}
        role="MASTER"
        route={route(`/card-sets/${setId}`)}
      />,
    );
    const choices = [...container.querySelectorAll<HTMLInputElement>('.card-selection input')];
    expect(choices).toHaveLength(2);
    await act(async () => choices[0]!.click());
    await act(async () => choices[1]!.click());
    expect(choices.map((choice) => choice.checked)).toEqual([false, true]);
    expect(container.querySelector('.bulk-selection')).toBeNull();
    expect(props.masterCommands.assignWorkCards).not.toHaveBeenCalled();
  });
});

describe('смена серверной роли в оболочке', () => {
  const alternatePassport = {
    ...passport,
    code: 'DEMO-OTHER',
    id: '30000000-0000-4000-8000-000000000002',
  };

  function configureApp(actor: DemoUser, switchResponse: Promise<Response>) {
    fetchMock.mockImplementation(async (input, init) => {
      const path = String(input);
      if (path === '/health/ready') return jsonResponse({ status: 'ok' });
      if (path === '/api/v1/demo-users')
        return jsonResponse({ items: [master, worker, admin, planner] });
      if (path === '/api/v1/demo-session') {
        return init?.method === 'POST' ? switchResponse : jsonResponse(session(actor));
      }
      if (path === `/api/v1/work-card-sets/${setId}`) return jsonResponse(cardSet);
      if (path.startsWith(`/api/v1/work-card-sets/${setId}/work-cards?`))
        return jsonResponse({ items: cards, nextCursor: null });
      if (path.startsWith(`/api/v1/work-cards/${cards[0]!.id}/history?`))
        return jsonResponse({ events: [], nextCursor: null });
      if (path === `/api/v1/work-cards/${cards[0]!.id}`) return jsonResponse(cards[0]);
      if (path === '/api/v1/production-passports')
        return jsonResponse({
          items: [passport, alternatePassport].map((item) => ({
            code: item.code,
            id: item.id,
            operationCount: item.operationCount,
            plannedCardCount: item.plannedCardCount,
            productName: item.productName,
            revision: item.revision,
          })),
        });
      if (path === `/api/v1/production-passports/${passport.id}`) return jsonResponse(passport);
      if (path === `/api/v1/production-passports/${alternatePassport.id}`)
        return jsonResponse(alternatePassport);
      if (path.startsWith('/api/v1/production-batches?'))
        return jsonResponse({ items: [], nextCursor: null });
      throw new Error(`Неожиданный запрос: ${path}`);
    });
  }

  it('до выбора роли предупреждает об общем состоянии и ежедневном сбросе', async () => {
    fetchMock.mockImplementation(async (input) => {
      const path = String(input);
      if (path === '/health/ready') return jsonResponse({ status: 'ok' });
      if (path === '/api/v1/demo-users') {
        return jsonResponse({ items: [master, worker, admin, planner] });
      }
      if (path === '/api/v1/demo-session') {
        return jsonResponse({ code: 'AUTHENTICATION_REQUIRED' }, 401);
      }
      throw new Error(`Неожиданный запрос: ${path}`);
    });

    await render(<App />);

    expect(container.textContent).toContain('Это общий контур');
    expect(container.textContent).toContain('изменения видны другим посетителям');
    expect(container.textContent).toContain('ежедневно сбрасываются');
  });

  it('сохраняет выбор при отмене смены роли, а после подтверждения очищает его и применяет новую permission-проекцию', async () => {
    const switchResponse = deferred<Response>();
    configureApp(master, switchResponse.promise);
    window.history.replaceState(null, '', `/card-sets/${setId}`);
    await render(<App />);
    await change('#bulk-card-count', '2');
    await click('.bulk-selection button');
    await change('.assignment-command__footer select', worker.id);
    expect(container.querySelectorAll('input:checked')).toHaveLength(2);
    const previousReads = fetchMock.mock.calls.filter(([path]) =>
      String(path).includes('work-card-sets'),
    );
    await change('#demo-role', worker.id);

    expect(element('dialog').textContent).toContain('Очистить форму и сменить роль');
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    expect(previousReads.every(([, init]) => !init?.signal?.aborted)).toBe(true);
    await click('dialog button.button--secondary');
    expect(element<HTMLSelectElement>('#demo-role').value).toBe(master.id);
    expect(element<HTMLSelectElement>('.assignment-command__footer select').value).toBe(worker.id);
    expect(container.querySelectorAll('input:checked')).toHaveLength(2);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    await change('#demo-role', worker.id);
    await click('dialog button.button--primary');

    expect(container.textContent).toContain('Меняем демонстрационную роль');
    expect(container.querySelectorAll('input:checked')).toHaveLength(0);
    expect(previousReads.every(([, init]) => init?.signal?.aborted)).toBe(true);
    const request = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(request?.[1]?.body))).toEqual({ demoUserId: worker.id });

    await act(async () => switchResponse.resolve(jsonResponse(session(worker), 201)));
    expect(container.querySelector('.assignment-command')).toBeNull();
    expect(container.querySelectorAll('input:checked')).toHaveLength(0);
    expect(container.textContent).toContain('Исполнитель Иванов');

    const next = { ...session(master), permissions: [] };
    fetchMock.mockImplementationOnce(async () => jsonResponse(next, 201));
    await change('#demo-role', master.id);
    expect(container.querySelector('dialog')).toBeNull();
    expect(container.textContent).toContain('Серверная сессия не подтвердила полномочие');
    expect(container.querySelector('.bulk-selection')).toBeNull();
    expect(container.querySelectorAll('input:checked')).toHaveLength(0);
  });

  it.each(['quantity', 'passport'] as const)(
    'требует подтверждение смены роли для изменённого поля партии: %s',
    async (field) => {
      const switchResponse = deferred<Response>();
      configureApp(planner, switchResponse.promise);
      window.history.replaceState(null, '', '/batches/new');
      await render(<App />);
      if (field === 'quantity') await change('#batch-quantity', '56');
      else await change('.passport-reader select', alternatePassport.id);
      const quantityBefore = element<HTMLInputElement>('#batch-quantity').value;
      const passportBefore = element<HTMLSelectElement>('.passport-reader select').value;
      await change('#demo-role', master.id);

      expect(element('dialog').textContent).toContain('незавершённая форма');
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
      await click('dialog button.button--secondary');
      expect(element<HTMLInputElement>('#batch-quantity').value).toBe(quantityBefore);
      expect(element<HTMLSelectElement>('.passport-reader select').value).toBe(passportBefore);
      expect(element<HTMLSelectElement>('#demo-role').value).toBe(planner.id);
      await change('#demo-role', master.id);
      await act(async () => {
        const confirmation = element<HTMLButtonElement>('dialog button.button--primary');
        confirmation.click();
        confirmation.click();
      });
      expect(container.textContent).toContain('Меняем демонстрационную роль');
      expect(container.querySelector('#batch-quantity')).toBeNull();
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
      await act(async () => switchResponse.resolve(jsonResponse(session(master), 201)));
      expect(container.textContent).toContain('Доступ ограничен');
    },
  );

  it.each(['untouched', 'reverted'] as const)(
    'меняет роль без диалога для чистой формы партии: %s',
    async (state) => {
      const switchResponse = deferred<Response>();
      configureApp(planner, switchResponse.promise);
      window.history.replaceState(null, '', '/batches/new');
      await render(<App />);
      if (state === 'reverted') {
        await change('#batch-quantity', '56');
        await change('.passport-reader select', alternatePassport.id);
        await change('#batch-quantity', '112');
        await change('.passport-reader select', passport.id);
      }
      await change('#demo-role', master.id);
      expect(container.querySelector('dialog')).toBeNull();
      expect(container.textContent).toContain('Меняем демонстрационную роль');
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
      await act(async () => switchResponse.resolve(jsonResponse(session(master), 201)));
    },
  );

  it('учитывает одного выбранного исполнителя и снимает признак незавершённой формы после очистки', async () => {
    const switchResponse = deferred<Response>();
    configureApp(master, switchResponse.promise);
    window.history.replaceState(null, '', `/card-sets/${setId}`);
    await render(<App />);
    await change('.assignment-command__footer select', worker.id);
    await change('#demo-role', worker.id);
    expect(element('dialog').textContent).toContain('Очистить форму и сменить роль');
    expect(container.querySelectorAll('input:checked')).toHaveLength(0);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    await click('dialog button.button--secondary');
    await change('.assignment-command__footer select', '');
    await change('#demo-role', worker.id);
    expect(container.querySelector('dialog')).toBeNull();
    expect(container.textContent).toContain('Меняем демонстрационную роль');
    await act(async () => switchResponse.resolve(jsonResponse(session(worker), 201)));
  });

  it('не переносит признак незавершённой формы на другой экран', async () => {
    const switchResponse = deferred<Response>();
    configureApp(planner, switchResponse.promise);
    window.history.replaceState(null, '', '/batches/new');
    await render(<App />);
    await change('#batch-quantity', '56');
    await click('a[href="/batches"]');
    expect(container.querySelector('#batch-quantity')).toBeNull();
    await change('#demo-role', master.id);
    expect(container.querySelector('dialog')).toBeNull();
    expect(container.textContent).toContain('Меняем демонстрационную роль');
    await act(async () => switchResponse.resolve(jsonResponse(session(master), 201)));
  });

  it('убирает прежний audit и не запрашивает защищённые данные после перехода к мастеру', async () => {
    const switchResponse = deferred<Response>();
    configureApp(admin, switchResponse.promise);
    window.history.replaceState(null, '', `/work-cards/${cards[0]!.id}/audit`);
    await render(<App />);
    expect(fetchMock.mock.calls.some(([path]) => String(path).includes('/history?'))).toBe(true);
    const readsBefore = fetchMock.mock.calls.filter(([path]) =>
      String(path).includes('/work-cards/'),
    ).length;
    await change('#demo-role', master.id);
    expect(container.querySelector('dialog')).toBeNull();
    expect(container.querySelector('main')?.textContent).not.toContain('История рабочей карточки');
    await act(async () => switchResponse.resolve(jsonResponse(session(master), 201)));

    expect(container.textContent).toContain('Доступ ограничен');
    expect(container.textContent).toContain('Содержимое защищённого раздела не загружалось');
    expect(
      fetchMock.mock.calls.filter(([path]) => String(path).includes('/work-cards/')),
    ).toHaveLength(readsBefore);
  });
});

describe('подтверждение учебного учёта и технический контекст', () => {
  it('выполняет export только после подтверждения и показывает успех после обязательного read-back', async () => {
    const closedCard: WorkCard = {
      ...cards[0]!,
      assignee: { displayName: worker.displayName, id: worker.id },
      availableActions: ['ExportWorkCardToPayroll'],
      closureType: 'SERIAL_QUALITY_CONFIRMATION',
      purpose: 'SERIAL',
      status: 'CLOSED',
      timestamps: {
        ...cards[0]!.timestamps,
        assignedAt: '2026-09-05T05:02:00.000Z',
        startedAt: '2026-09-05T05:03:00.000Z',
        completedAt: '2026-09-05T05:04:00.000Z',
        closedAt: '2026-09-05T05:05:00.000Z',
      },
      version: 5,
    };
    const record: PayrollRecord = {
      beneficiary: closedCard.assignee!,
      commandId: '70000000-0000-4000-8000-000000000001',
      exportedAt: '2026-09-05T05:06:00.000Z',
      exportedBy: { displayName: admin.displayName, id: admin.id },
      id: '70000000-0000-4000-8000-000000000002',
      normHoursSnapshot: closedCard.operation.normHours,
      workCardId: closedCard.id,
    };
    const readBack = deferred<Response>();
    const api = createApiClient({
      fetchImplementation: fetchMock,
      getConfirmedDemoSession: () => session(admin),
    });
    const payrollClient = createPayrollCommandClient(api, () => record.commandId);
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          {
            correlationId: '70000000-0000-4000-8000-000000000003',
            payrollRecord: record,
          },
          201,
        ),
      )
      .mockReturnValueOnce(readBack.promise);
    await render(
      <PayrollReadyContent
        initialWorkspace={{ card: closedCard, readContexts: [], record: null }}
        onAnnounce={vi.fn()}
        onRefresh={vi.fn()}
        permissions={['ExportWorkCardToPayroll']}
        payrollClient={payrollClient}
        route={route(`/work-cards/${closedCard.id}/payroll`)}
      />,
    );

    await click('.payroll-command > button.button--primary');
    expect(element('dialog').textContent).toContain('Подтвердить создание тестовой записи');
    expect(fetchMock).not.toHaveBeenCalled();
    await click('dialog button.button--secondary');
    expect(container.querySelector('dialog')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    await click('.payroll-command > button.button--primary');
    await click('dialog button.button--primary');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(['POST', 'GET']);
    expect(container.querySelector('.notice--success')).toBeNull();
    expect(element<HTMLButtonElement>('dialog button.button--primary').disabled).toBe(true);
    await click('dialog button.button--primary');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => readBack.resolve(jsonResponse(record)));
    expect(container.querySelector('dialog')).toBeNull();
    expect(container.textContent).toContain('Тестовая запись создана и перечитана');
    expect(container.textContent).toContain(worker.displayName);
  });

  it('сохраняет ID только во вложенном закрытом блоке сведений о прототипе', async () => {
    await render(
      <TechnicalDetails
        entries={[{ label: 'WorkCard ID', value: cards[0]!.id }]}
        route={route(`/work-cards/${cards[0]!.id}`)}
      />,
    );
    const outer = element<HTMLDetailsElement>('details');
    const inner = element<HTMLDetailsElement>(
      'details > details[data-ux-technical-exception="developer-codes"]',
    );
    expect(outer.querySelector(':scope > summary')?.textContent).toBe('Сведения о прототипе');
    expect(inner.querySelector('summary')?.textContent).toBe('Технические коды для разработчика');
    expect(outer.open).toBe(false);
    expect(inner.open).toBe(false);
    expect(inner.textContent).toContain(cards[0]!.id);
    inner.remove();
    expect(outer.textContent).not.toContain(cards[0]!.id);
    expect(outer.querySelector('code')).toBeNull();
  });
});
