import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export function validateBlueprint(blueprint) {
  // JSON is deliberately used as the strict, unambiguous YAML subset.
  assert.deepEqual(Object.keys(blueprint).sort(), ['previews', 'services']);
  assert.deepEqual(blueprint.previews, { generation: 'off' });
  assert.equal(blueprint.services.length, 1);
  const service = blueprint.services[0];
  assert.deepEqual(Object.keys(service).sort(), [
    'autoDeploy',
    'envVars',
    'healthCheckPath',
    'image',
    'name',
    'numInstances',
    'plan',
    'region',
    'runtime',
    'type',
  ]);
  assert.equal(service.type, 'web');
  assert.equal(service.runtime, 'image');
  assert.equal(service.plan, 'free');
  assert.equal(service.numInstances, 1);
  assert.equal(service.autoDeploy, false);
  assert.equal(service.healthCheckPath, '/health/live');
  assert.deepEqual(Object.keys(service.image), ['url']);
  assert.match(service.image.url, /^ghcr\.io\/[a-z0-9_.-]+\/[a-z0-9_./-]+@sha256:[0-9a-f]{64}$/);
  const env = new Map(service.envVars.map((value) => [value.key, value]));
  assert.equal(env.size, service.envVars.length);
  assert.equal(env.get('APP_ENV')?.value, 'production');
  assert.equal(env.get('PROXY_TRUST_MODE')?.value, 'render');
  assert.equal(env.get('HOST')?.value, '0.0.0.0');
  assert.equal(env.get('DEMO_MAX_BATCHES')?.value, '20');
  assert.equal(env.get('DEMO_MAX_SESSIONS')?.value, '500');
  assert(env.get('PORT')?.value && /^\d+$/.test(env.get('PORT').value));
  for (const name of [
    'DATABASE_URL',
    'SESSION_SIGNING_SECRET',
    'NEON_DATABASE_HOST',
    'NEON_DATABASE_NAME',
    'APP_ORIGIN',
    'PROXY_TRUSTED_CIDRS',
  ]) {
    assert.deepEqual(env.get(name), { key: name, sync: false });
  }
  assert(
    ![...env.keys()].some((name) => /MIGRATION|OWNER|APP_DATABASE|^K_|^PG|GCP|GOOGLE/.test(name)),
  );
  return blueprint;
}

export async function checkContract() {
  validateBlueprint(JSON.parse(await readFile(resolve(root, 'render.yaml'), 'utf8')));
  const contract = JSON.parse(
    await readFile(resolve(root, 'infra/render/deployment-contract.json'), 'utf8'),
  );
  assert.equal(contract.schemaVersion, 1);
  assert.equal(contract.runtimeServiceCount, 1);
  assert.equal(contract.platform, 'linux/amd64');
  assert.deepEqual(contract.database, {
    provider: 'neon',
    plan: 'free',
    postgresMajor: 18,
    environments: ['production', 'staging'],
    separateProjects: true,
    endpoint: 'direct',
    sslmode: 'verify-full',
  });
  assert.equal(contract.image.visibility, 'public');
  assert.equal(contract.image.automaticDeletion, false);
  assert.equal(contract.evidence.durableStore, 'github-release-assets');
  assert.equal(contract.owner.workflowConcurrency, 'work-card-owner-and-release');
  return contract;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await checkContract();
  process.stdout.write(
    'Render/Neon deployment contract passed (offline; no hosted qualification claimed).\n',
  );
}
