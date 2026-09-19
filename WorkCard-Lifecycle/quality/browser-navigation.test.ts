import type { Page, Response } from '@playwright/test';
import { afterEach, expect, it, vi } from 'vitest';

// Import the actual observer without registering/running its browser scenario.
vi.mock('@playwright/test', async () => {
  const { expect, vi } = await import('vitest');
  return { expect, test: Object.assign(vi.fn(), { beforeEach: vi.fn() }) };
});

import { assertHostedBootstrapNavigation, navigateHostedPage } from './browser/lifecycle.spec.js';
import { hostedRequestTimeoutMs } from './browser/hosted-route.js';

const origin = 'http://127.0.0.1:3000';
const bootstrapPaths = ['/api/v1/demo-users', '/api/v1/demo-session', '/health/ready'];
const cardPath = '/work-cards/abcdef01-1234-4abc-8def-1234567890ab';

afterEach(() => vi.unstubAllGlobals());

function fixture() {
  const listeners: {
    matches: (response: Response) => boolean;
    resolve: (response: Response) => void;
  }[] = [];
  const sensitiveRead = vi.fn(() => {
    throw new Error('Token-bearing data must not be read.');
  });
  const waitForResponse = vi.fn<
    (matches: (response: Response) => boolean, options: { timeout: number }) => Promise<Response>
  >((matches) => new Promise<Response>((resolve) => listeners.push({ matches, resolve })));
  const page = { waitForResponse } as unknown as Page;
  const emit = (path: string, status: number, method = 'GET', responseOrigin = origin) => {
    const response = {
      url: () => `${responseOrigin}${path}`,
      request: () => ({ method: () => method }),
      status: () => status,
      body: sensitiveRead,
      text: sensitiveRead,
      json: sensitiveRead,
      headers: sensitiveRead,
      allHeaders: sensitiveRead,
    } as unknown as Response;
    for (const listener of listeners) if (listener.matches(response)) listener.resolve(response);
  };
  return { page, emit, waitForResponse, sensitiveRead };
}

it.each([200, 401])(
  'observes existing bootstrap GETs before navigation; session HTTP %i is valid',
  async (sessionStatus) => {
    const current = fixture();
    const navigate = vi.fn(async () => {
      expect(current.waitForResponse).toHaveBeenCalledTimes(3);
      current.emit('/api/v1/demo-users', 200);
      current.emit('/api/v1/demo-session', sessionStatus);
      current.emit('/health/ready', 200);
    });
    await assertHostedBootstrapNavigation(current.page, origin, navigate);
    expect(navigate).toHaveBeenCalledOnce();
    for (const call of current.waitForResponse.mock.calls)
      expect(call[1]).toEqual({ timeout: hostedRequestTimeoutMs });
    expect(current.sensitiveRead).not.toHaveBeenCalled();
  },
);

it.each([
  ['/api/v1/demo-users', 401],
  ['/api/v1/demo-session', 500],
  ['/health/ready', 503],
] as const)(
  'fails immediately on bootstrap %s HTTP %i without waiting for other responses or retrying',
  async (path, status) => {
    const current = fixture();
    const navigate = vi.fn(async () => {
      current.emit(path, status);
    });
    const error = await assertHostedBootstrapNavigation(current.page, origin, navigate).catch(
      (value: unknown) => value,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(`Hosted bootstrap GET ${path} returned HTTP ${status}.`);
    expect((error as Error).cause).toBeUndefined();
    expect(navigate).toHaveBeenCalledOnce();
    expect(current.sensitiveRead).not.toHaveBeenCalled();
  },
);

it('ignores another origin, POSTs and query-bearing URLs while keeping the exact GET checks', async () => {
  const current = fixture();
  await assertHostedBootstrapNavigation(current.page, origin, async () => {
    for (const path of bootstrapPaths) {
      current.emit(path, 500, 'POST');
      current.emit(path, 500, 'GET', 'http://127.0.0.1:3001');
      current.emit(`${path}?unrelated=1`, 500);
      current.emit(path, 200);
    }
  });
  expect(current.sensitiveRead).not.toHaveBeenCalled();
});

it('propagates a failed navigation and never retries it', async () => {
  const current = fixture();
  const navigate = vi.fn(async () => {
    throw new Error('Synthetic navigation failure.');
  });
  await expect(assertHostedBootstrapNavigation(current.page, origin, navigate)).rejects.toThrow(
    'Synthetic navigation failure.',
  );
  expect(navigate).toHaveBeenCalledOnce();
});

function navigationFixture(currentUrl = `${origin}/batches`) {
  const current = fixture();
  const pushState = vi.fn((_data: unknown, _title: string, path: string) => {
    currentUrl = new URL(path, currentUrl).href;
  });
  const dispatchEvent = vi.fn((event: Event) => event.type === 'popstate');
  vi.stubGlobal('window', { history: { pushState }, dispatchEvent });
  vi.stubGlobal('PopStateEvent', class extends Event {});
  const evaluate = vi.fn(async (run: (path: string) => unknown, path: string) => {
    expect(current.waitForResponse).toHaveBeenCalledOnce();
    return run(path);
  });
  const loadDocument = async () => {
    expect(current.waitForResponse).toHaveBeenCalledTimes(3);
    for (const path of bootstrapPaths) current.emit(path, 200);
    return null;
  };
  const goto = vi.fn(loadDocument);
  const reload = vi.fn(loadDocument);
  Object.assign(current.page, { url: () => currentUrl, evaluate, goto, reload });
  return { ...current, evaluate, goto, reload, pushState, dispatchEvent };
}

it('keeps the mounted SPA and waits for its fresh card GET before allowing the next UI action', async () => {
  const current = navigationFixture();
  let completed = false;
  const navigation = navigateHostedPage(current.page, origin, cardPath).then(() => {
    completed = true;
  });
  await vi.waitFor(() => expect(current.dispatchEvent).toHaveBeenCalledOnce());
  expect(current.pushState).toHaveBeenCalledWith(null, '', cardPath);
  expect(current.dispatchEvent.mock.calls[0]?.[0]).toMatchObject({ type: 'popstate' });
  expect(current.page.url()).toBe(`${origin}${cardPath}`);
  expect(completed).toBe(false);
  expect(current.waitForResponse.mock.calls[0]?.[1]).toEqual({ timeout: hostedRequestTimeoutMs });
  current.emit(`/api/v1${cardPath}`, 200);
  await navigation;
  expect(completed).toBe(true);
  expect(current.evaluate).toHaveBeenCalledOnce();
  expect(current.goto).not.toHaveBeenCalled();
  expect(current.reload).not.toHaveBeenCalled();
  expect(current.sensitiveRead).not.toHaveBeenCalled();
});

it.each([401, 503])(
  'fails a card GET HTTP %i without retrying or reading credentials',
  async (status) => {
    const current = navigationFixture();
    const navigation = navigateHostedPage(current.page, origin, cardPath).catch(
      (error: unknown) => error,
    );
    await vi.waitFor(() => expect(current.dispatchEvent).toHaveBeenCalledOnce());
    current.emit(`/api/v1${cardPath}`, status);
    const error = await navigation;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(`Hosted card GET returned HTTP ${status}.`);
    expect((error as Error).cause).toBeUndefined();
    expect(current.waitForResponse).toHaveBeenCalledOnce();
    expect(current.evaluate).toHaveBeenCalledOnce();
    expect(current.goto).not.toHaveBeenCalled();
    expect(current.reload).not.toHaveBeenCalled();
    expect(current.sensitiveRead).not.toHaveBeenCalled();
  },
);

it('ignores unrelated card responses while waiting for the exact same-origin GET', async () => {
  const current = navigationFixture();
  let settled = false;
  const navigation = navigateHostedPage(current.page, origin, cardPath).then(
    () => {
      settled = true;
      return 'passed';
    },
    () => {
      settled = true;
      return 'failed';
    },
  );
  await vi.waitFor(() => expect(current.dispatchEvent).toHaveBeenCalledOnce());
  current.emit(`/api/v1${cardPath}`, 503, 'GET', 'http://127.0.0.1:3001');
  current.emit(`/api/v1${cardPath}`, 503, 'POST');
  current.emit(`/api/v1${cardPath}?unrelated=1`, 503);
  current.emit('/api/v1/work-cards/abcdef01-1234-4abc-8def-1234567890ac', 503);
  await Promise.resolve();
  expect(settled).toBe(false);
  current.emit(`/api/v1${cardPath}`, 200);
  expect(await navigation).toBe('passed');
  expect(current.sensitiveRead).not.toHaveBeenCalled();
});

it.each([
  { reason: 'initial document', currentUrl: 'about:blank', path: cardPath },
  { reason: 'another current origin', currentUrl: 'http://127.0.0.1:3001/batches', path: cardPath },
  { reason: 'same card', currentUrl: `${origin}${cardPath}`, path: cardPath },
  { reason: 'explicit reload', currentUrl: `${origin}${cardPath}`, path: undefined },
  { reason: 'non-card route', currentUrl: `${origin}/batches`, path: '/batches/new' },
  {
    reason: 'malformed card path',
    currentUrl: `${origin}/batches`,
    path: '/work-cards/not-a-uuid',
  },
  {
    reason: 'query-bearing card path',
    currentUrl: `${origin}/batches`,
    path: `${cardPath}?view=1`,
  },
])('keeps all document bootstrap checks for $reason', async ({ currentUrl, path }) => {
  const current = navigationFixture(currentUrl);
  await navigateHostedPage(current.page, origin, path);
  expect(current.waitForResponse).toHaveBeenCalledTimes(3);
  for (const call of current.waitForResponse.mock.calls)
    expect(call[1]).toEqual({ timeout: hostedRequestTimeoutMs });
  expect(current.evaluate).not.toHaveBeenCalled();
  expect(current.pushState).not.toHaveBeenCalled();
  expect(current.dispatchEvent).not.toHaveBeenCalled();
  if (path === undefined) {
    expect(current.reload).toHaveBeenCalledOnce();
    expect(current.goto).not.toHaveBeenCalled();
  } else {
    expect(current.goto).toHaveBeenCalledExactlyOnceWith(path);
    expect(current.reload).not.toHaveBeenCalled();
  }
  expect(current.sensitiveRead).not.toHaveBeenCalled();
});
