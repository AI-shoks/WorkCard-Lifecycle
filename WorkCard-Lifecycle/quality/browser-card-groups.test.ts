import type { Page } from '@playwright/test';
import { expect, it, vi } from 'vitest';

// Exercise the real scheduler without registering its browser scenario.
vi.mock('@playwright/test', async () => {
  const { expect, vi } = await import('vitest');
  return { expect, test: Object.assign(vi.fn(), { beforeEach: vi.fn() }) };
});

import { runCardGroups } from './browser/lifecycle.spec.js';

const groups = [
  ['set-a-1', 'set-a-2'],
  ['set-b-1', 'set-b-2'],
  ['set-c-1', 'set-c-2'],
] as const;

function fixture() {
  const workers = Array.from({ length: 3 }, () => {
    const close = vi.fn<() => Promise<void>>(async () => undefined);
    return { page: { close } as unknown as Page, close };
  });
  let nextPage = 0;
  const newPage = vi.fn(async () => workers[nextPage++]!.page);
  const context = { newPage };
  const parentClose = vi.fn(async () => undefined);
  const page = { context: () => context, close: parentClose } as unknown as Page;
  return { page, workers, newPage, parentClose };
}

function capture(promise: Promise<void>) {
  let settled = false;
  const result = promise.then(
    () => {
      settled = true;
      return undefined;
    },
    (error: unknown) => {
      settled = true;
      return error;
    },
  );
  return { result, settled: () => settled };
}

it('observes every page before processing all cards once, sequentially within three parallel sets', async () => {
  const current = fixture();
  const observed = new Set<Page>();
  const observe = vi.fn((worker: Page) => {
    observed.add(worker);
  });
  const gates = groups.map(() => Promise.withResolvers<void>());
  const pathsByPage = new Map<Page, string[]>();
  const active = new Set<Page>();
  let maximumActive = 0;
  const operation = vi.fn(async (worker: Page, path: string) => {
    expect(observed.has(worker)).toBe(true);
    expect(active.has(worker)).toBe(false);
    active.add(worker);
    maximumActive = Math.max(maximumActive, active.size);
    const paths = pathsByPage.get(worker) ?? [];
    paths.push(path);
    pathsByPage.set(worker, paths);
    if (paths.length === 1) {
      const index = current.workers.findIndex((candidate) => candidate.page === worker);
      await gates[index]!.promise;
    }
    active.delete(worker);
  });
  const running = runCardGroups(current.page, groups, operation, observe);
  await vi.waitFor(() => expect(operation).toHaveBeenCalledTimes(3));
  expect(active.size).toBe(3);
  for (const worker of current.workers) expect(worker.close).not.toHaveBeenCalled();
  gates[0]!.resolve();
  await vi.waitFor(() => expect(pathsByPage.get(current.workers[0]!.page)).toEqual(groups[0]));
  expect(pathsByPage.get(current.workers[1]!.page)).toEqual([groups[1][0]]);
  expect(pathsByPage.get(current.workers[2]!.page)).toEqual([groups[2][0]]);
  gates[1]!.resolve();
  gates[2]!.resolve();
  await running;
  expect(maximumActive).toBe(3);
  expect(current.newPage).toHaveBeenCalledTimes(3);
  expect(observe).toHaveBeenCalledTimes(3);
  expect(operation).toHaveBeenCalledTimes(groups.flat().length);
  for (const [index, worker] of current.workers.entries()) {
    expect(pathsByPage.get(worker.page)).toEqual(groups[index]);
    expect(worker.close).toHaveBeenCalledOnce();
  }
  expect(current.parentClose).not.toHaveBeenCalled();
});

it('stops new cards after a failure, drains active operations before closing and preserves the original error', async () => {
  const current = fixture();
  const failure = new Error('Synthetic card operation failure.');
  const cleanupFailure = new Error('Synthetic cleanup failure.');
  current.workers[2]!.close.mockRejectedValue(cleanupFailure);
  const gates = groups.map(() => Promise.withResolvers<void>());
  let active = 0;
  const operation = vi.fn(async (worker: Page) => {
    const index = current.workers.findIndex((candidate) => candidate.page === worker);
    active += 1;
    try {
      await gates[index]!.promise;
    } finally {
      active -= 1;
    }
  });
  const running = capture(runCardGroups(current.page, groups, operation, () => undefined));
  await vi.waitFor(() => expect(active).toBe(3));
  gates[0]!.reject(failure);
  await vi.waitFor(() => expect(active).toBe(2));
  gates[1]!.resolve();
  await vi.waitFor(() => expect(active).toBe(1));
  expect(operation).toHaveBeenCalledTimes(3);
  expect(running.settled()).toBe(false);
  for (const worker of current.workers) expect(worker.close).not.toHaveBeenCalled();
  gates[2]!.resolve();
  expect(await running.result).toBe(failure);
  expect(operation).toHaveBeenCalledTimes(3);
  expect(active).toBe(0);
  for (const worker of current.workers) expect(worker.close).toHaveBeenCalledOnce();
  expect(current.parentClose).not.toHaveBeenCalled();
});

it('waits for a late page after another creation fails and closes every page that was actually created', async () => {
  const current = fixture();
  const failure = new Error('Synthetic page creation failure.');
  const latePage = Promise.withResolvers<Page>();
  current.newPage
    .mockResolvedValueOnce(current.workers[0]!.page)
    .mockRejectedValueOnce(failure)
    .mockImplementationOnce(() => latePage.promise);
  const operation = vi.fn<(worker: Page, path: string) => Promise<void>>(async () => undefined);
  const running = capture(runCardGroups(current.page, groups, operation, () => undefined));
  await vi.waitFor(() => expect(current.newPage).toHaveBeenCalledTimes(3));
  expect(running.settled()).toBe(false);
  for (const worker of current.workers) expect(worker.close).not.toHaveBeenCalled();
  latePage.resolve(current.workers[2]!.page);
  expect(await running.result).toBe(failure);
  expect(operation.mock.calls.some(([worker]) => worker === current.workers[2]!.page)).toBe(false);
  expect(current.workers[0]!.close).toHaveBeenCalledOnce();
  expect(current.workers[1]!.close).not.toHaveBeenCalled();
  expect(current.workers[2]!.close).toHaveBeenCalledOnce();
  expect(current.parentClose).not.toHaveBeenCalled();
});

it('closes an already-created page even when installing its observer fails', async () => {
  const current = fixture();
  const failure = new Error('Synthetic observer failure.');
  const operation = vi.fn<(worker: Page, path: string) => Promise<void>>(async () => undefined);
  const observe = vi.fn((worker: Page) => {
    if (worker === current.workers[1]!.page) throw failure;
  });
  await expect(runCardGroups(current.page, groups, operation, observe)).rejects.toBe(failure);
  expect(operation.mock.calls.some(([worker]) => worker === current.workers[1]!.page)).toBe(false);
  for (const worker of current.workers) expect(worker.close).toHaveBeenCalledOnce();
  expect(current.parentClose).not.toHaveBeenCalled();
});

it('propagates a cleanup failure only after every page cleanup has settled', async () => {
  const current = fixture();
  const failure = new Error('Synthetic page cleanup failure.');
  const lastClose = Promise.withResolvers<void>();
  current.workers[0]!.close.mockRejectedValue(failure);
  current.workers[2]!.close.mockImplementation(() => lastClose.promise);
  const running = capture(
    runCardGroups(
      current.page,
      groups,
      async () => undefined,
      () => undefined,
    ),
  );
  await vi.waitFor(() => {
    for (const worker of current.workers) expect(worker.close).toHaveBeenCalledOnce();
  });
  expect(running.settled()).toBe(false);
  lastClose.resolve();
  expect(await running.result).toBe(failure);
  expect(current.parentClose).not.toHaveBeenCalled();
});
