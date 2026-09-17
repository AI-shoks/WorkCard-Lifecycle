import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { checkContract, validateBlueprint } from './check-contract.mjs';

test('offline contract permits one Free image service with isolated Neon projects', async () => {
  await checkContract();
});
test('rejects paid resources, owner secrets, previews and database health pings', async () => {
  const base = JSON.parse(
    await readFile(new globalThis.URL('../../render.yaml', import.meta.url), 'utf8'),
  );
  for (const mutate of [
    (b) => b.services.push(b.services[0]),
    (b) => {
      b.services[0].plan = 'starter';
    },
    (b) => {
      b.services[0].healthCheckPath = '/health/ready';
    },
    (b) => {
      b.services[0].disk = {};
    },
    (b) => {
      b.previews.generation = 'automatic';
    },
    (b) => b.services[0].envVars.push({ key: 'MIGRATION_DATABASE_URL', sync: false }),
    (b) => {
      b.services[0].envVars.find((e) => e.key === 'DEMO_MAX_BATCHES').value = '21';
    },
    (b) => {
      b.services[0].envVars.find((e) => e.key === 'DEMO_MAX_SESSIONS').value = '501';
    },
  ]) {
    const candidate = globalThis.structuredClone(base);
    mutate(candidate);
    assert.throws(() => validateBlueprint(candidate));
  }
});
