import type { Page, Response } from '@playwright/test';
import { expect, it, vi } from 'vitest';

// Import the actual observer without registering/running its browser scenario.
vi.mock('@playwright/test', async () => {
  const { expect, vi } = await import('vitest');
  return { expect, test: Object.assign(vi.fn(), { beforeEach: vi.fn() }) };
});

import { assertHostedBootstrapNavigation } from './browser/lifecycle.spec.js';
import { hostedRequestTimeoutMs } from './browser/hosted-route.js';

const origin = 'http://127.0.0.1:3000';
const bootstrapPaths = ['/api/v1/demo-users', '/api/v1/demo-session', '/health/ready'];

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
