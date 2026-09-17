import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { validateReleaseManifest } from './validate-release-manifest.mjs';
import {
  appendDurableEvidence,
  digestBytes,
  evidenceContext,
  retainReport,
} from './github-evidence.mjs';

export const immutableImagePattern =
  /^ghcr\.io\/[a-z0-9][a-z0-9_.-]*\/[a-z0-9][a-z0-9_./-]*@sha256:[0-9a-f]{64}$/;
const serviceIdPattern = /^srv-[a-z0-9]{20}$/;
const deployIdPattern = /^dep-[a-z0-9]{20}$/;
const failedStatuses = new Set([
  'build_failed',
  'update_failed',
  'canceled',
  'pre_deploy_failed',
  'deactivated',
]);
const pendingStatuses = new Set([
  'created',
  'queued',
  'build_in_progress',
  'update_in_progress',
  'pre_deploy_in_progress',
]);

export function assertRenderService(service, { serviceId, ownerId, origin, repository }) {
  assert(serviceIdPattern.test(serviceId), 'Expected Render service ID is invalid.');
  assert(/^(?:tea|usr)-[a-z0-9]{20}$/.test(ownerId), 'Expected Render workspace ID is invalid.');
  assert.equal(new globalThis.URL(origin).origin, origin);
  assert.equal(new globalThis.URL(origin).protocol, 'https:');
  assert.equal(service.id, serviceId, 'Render service target mismatch.');
  assert.equal(service.ownerId, ownerId, 'Render workspace target mismatch.');
  assert.equal(service.type, 'web_service');
  assert.equal(service.autoDeploy, 'no', 'Automatic deploys must be disabled.');
  const details = service.serviceDetails;
  assert.equal(details?.runtime, 'image', 'Render must pull the previously built image.');
  assert.equal(details.plan, 'free', 'Only Render Free is authorized by this contract.');
  assert.equal(details.numInstances, 1);
  assert.equal(details.healthCheckPath, '/health/live');
  assert.equal(details.url, origin, 'Render service URL mismatch.');
  assert(
    !details.disk && !details.autoscaling && !details.parentServer,
    'Disks, scaling and previews are forbidden.',
  );
  assert(!details.previews?.generation || details.previews.generation === 'off');
  assert([undefined, 'no', false].includes(details.pullRequestPreviewsEnabled));
  assert(
    !details.envSpecificDetails?.preDeployCommand && !details.preDeployCommand,
    'Owner jobs cannot run in Render runtime.',
  );
  assert(
    !service.registryCredential &&
      !service.image?.registryCredentialId &&
      !details.envSpecificDetails?.registryCredential,
    'Public GHCR image must not use a registry credential.',
  );
  assert(
    immutableImagePattern.test(service.imagePath ?? service.image?.imagePath ?? ''),
    'Persistent image reference must be a GHCR digest.',
  );
  const image = service.imagePath ?? service.image.imagePath;
  assert.equal(image.split('@')[0], repository, 'Unexpected image repository.');
  return image;
}

export function assertResolvedDeploy(deploy, image, expectedId) {
  assert(deployIdPattern.test(deploy.id), 'Render did not return a deploy ID.');
  if (expectedId) assert.equal(deploy.id, expectedId, 'Render deploy identity changed.');
  assert.equal(deploy.status, 'live', 'Only a live deployment can be accepted.');
  assert(!deploy.image?.registryCredential, 'Render must pull the image without a credential.');
  assert.equal(deploy.image?.ref, image, 'Render used an unexpected image reference.');
  const expectedDigest = image.split('@')[1];
  // The API calls this field sha; accept its documented digest or bare hex spelling.
  const resolvedDigest = deploy.image?.sha?.startsWith('sha256:')
    ? deploy.image.sha
    : `sha256:${deploy.image?.sha}`;
  assert.equal(resolvedDigest, expectedDigest, 'Render resolved a different image digest.');
  return resolvedDigest;
}

export function renderClient({ token, fetchImplementation = globalThis.fetch }) {
  assert(token && !/\s/.test(token), 'RENDER_API_KEY is required.');
  return async function request(path, { method = 'GET', body, signal } = {}) {
    assert(
      /^\/services\/srv-[a-z0-9]{20}(?:\/deploys(?:\/dep-[a-z0-9]{20}|\?limit=20)?)?$/.test(path),
      'Unsupported Render operation.',
    );
    const response = await fetchImplementation(`https://api.render.com/v1${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: 'error',
      signal: signal ?? globalThis.AbortSignal.timeout(30_000),
    });
    // Never print provider bodies; they can contain environment values or credentials.
    if (!response.ok) throw new Error(`Render ${method} failed with HTTP ${response.status}.`);
    const text = await response.text();
    if (!text)
      throw new Error(
        'Render accepted/queued a request without a verifiable operation ID; reconcile manually before retrying.',
      );
    try {
      return JSON.parse(text);
    } catch {
      throw new Error('Render returned an invalid JSON response.');
    }
  };
}

export async function resolveCurrentRenderDeployment(request, expected) {
  const path = `/services/${expected.serviceId}`;
  const image = assertRenderService(await request(path), expected);
  const entries = await request(`${path}/deploys?limit=20`);
  assert(Array.isArray(entries), 'Render deploy list is malformed.');
  const live = entries.map((entry) => entry.deploy).filter((deploy) => deploy?.status === 'live');
  assert.equal(live.length, 1, 'One live Render deployment must be identified.');
  assertResolvedDeploy(live[0], image);
  return live[0];
}

export async function resolveCurrentRenderImage(request, expected) {
  return (await resolveCurrentRenderDeployment(request, expected)).image.ref;
}

export async function deployRenderImage({
  image,
  expected,
  request,
  sleep = delay,
  now = Date.now,
  timeoutMs = 900_000,
  expectedPreviousDeployId,
  onBefore,
  onTriggered,
}) {
  assert(immutableImagePattern.test(image), 'An immutable public GHCR image is required.');
  const path = `/services/${expected.serviceId}`;
  const before = await request(path);
  const previousImage = assertRenderService(before, expected);
  const current = await resolveCurrentRenderDeployment(request, expected);
  assert.equal(
    current.image.ref,
    previousImage,
    'Configured/live image drift must be reconciled before promotion.',
  );
  if (expectedPreviousDeployId)
    assert.equal(
      current.id,
      expectedPreviousDeployId,
      'Current live deploy changed before mutation.',
    );
  await onBefore?.({ previousImage, serviceId: expected.serviceId });
  // A one-shot imageUrl override does NOT change the reference used by later deploys.
  await request(path, {
    method: 'PATCH',
    body: { autoDeploy: 'no', image: { ownerId: expected.ownerId, imagePath: image } },
  });
  const persisted = await request(path);
  assert.equal(
    assertRenderService(persisted, expected),
    image,
    'Persistent Render image update was not confirmed.',
  );
  const triggered = await request(`${path}/deploys`, { method: 'POST', body: { imageUrl: image } });
  assert(
    deployIdPattern.test(triggered.id),
    'Queued response is not proof of a deployment. Reconcile manually.',
  );
  await onTriggered?.({ deployId: triggered.id, previousImage, requestedImage: image });
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    const deploy = await request(`${path}/deploys/${triggered.id}`);
    assert.equal(deploy.id, triggered.id);
    if (deploy.status === 'live') {
      const resolvedDigest = assertResolvedDeploy(deploy, image, triggered.id);
      assert.equal(
        assertRenderService(await request(path), expected),
        image,
        'Persistent image changed while deploying.',
      );
      return {
        schemaVersion: 2,
        provider: 'render',
        serviceId: expected.serviceId,
        deployId: deploy.id,
        previousImage,
        persistentImage: image,
        resolvedImage: image,
        resolvedDigest,
        status: 'live',
      };
    }
    if (failedStatuses.has(deploy.status))
      throw new Error(
        `Render deployment ended with ${deploy.status}; gate and rollback require explicit owner recovery.`,
      );
    assert(
      pendingStatuses.has(deploy.status),
      'Unknown Render deployment state; refusing success.',
    );
    await sleep(5_000);
  }
  throw new Error('Render deployment timed out; reconcile the recorded deploy ID before retrying.');
}

async function runCli() {
  const [manifestPath, output] = process.argv.slice(2);
  assert(
    manifestPath && output && process.argv.length === 4,
    'Usage: render-adapter.mjs MANIFEST OUTPUT',
  );
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  await validateReleaseManifest(manifest);
  assert.equal(manifest.schemaVersion, 2);
  for (const name of [
    'DATABASE_URL',
    'MIGRATION_DATABASE_URL',
    'APP_DATABASE_PASSWORD',
    'SESSION_SIGNING_SECRET',
  ]) {
    assert(!process.env[name], `Render adapter must not receive ${name}.`);
  }
  const expected = {
    serviceId: process.env.RENDER_SERVICE_ID,
    ownerId: process.env.RENDER_OWNER_ID,
    origin: process.env.RENDER_ORIGIN,
    repository: manifest.immutableImage.split('@')[0],
  };
  const write = async (suffix, value) => {
    const path = resolve(`${output}${suffix}`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  };
  const durable = process.env.RELEASE_EVIDENCE_DURABLE === '1';
  assert(
    durable,
    'Render promotion requires RELEASE_EVIDENCE_DURABLE=1 and a durable release journal.',
  );
  const context = durable ? evidenceContext() : null;
  const stagingBytes = durable ? await readFile('.quality-results/staging-smoke.json') : null;
  if (durable) {
    const staging = JSON.parse(stagingBytes);
    assert.equal(staging.status, 'passed');
    assert.equal(staging.sourceSha, manifest.sourceSha);
    assert.equal(staging.immutableImage, manifest.immutableImage);
    assert(staging.checks.includes('canonical-browser-112-3-250'));
    await retainReport(manifest, '.quality-results/staging-smoke.json');
  }
  const evidence = await deployRenderImage({
    image: manifest.immutableImage,
    expected,
    request: renderClient({ token: process.env.RENDER_API_KEY }),
    onBefore: async (value) => {
      await write('.before.json', value);
      if (durable)
        await appendDurableEvidence(manifest, {
          kind: 'staging-smoke',
          evidence: {
            ...context,
            provider: 'actions-docker',
            status: 'passed',
            resolvedImage: manifest.immutableImage,
            smokeReportSha256: digestBytes(stagingBytes),
          },
        });
      if (durable)
        await appendDurableEvidence(manifest, {
          kind: 'production-attempt',
          evidence: {
            ...context,
            ...value,
            requestedImage: manifest.immutableImage,
            status: 'prepared',
          },
        });
    },
    onTriggered: async (value) => {
      await write('.pending.json', value);
      if (durable)
        await appendDurableEvidence(manifest, {
          kind: 'production-attempt',
          evidence: { ...context, ...value, serviceId: expected.serviceId, status: 'triggered' },
        });
    },
  });
  await write('', evidence);
  if (durable) {
    await retainReport(manifest, output);
    const { schemaVersion: _schemaVersion, ...deployment } = evidence;
    void _schemaVersion;
    await appendDurableEvidence(manifest, {
      kind: 'production-deployment',
      evidence: { ...context, ...deployment, stagingReportSha256: digestBytes(stagingBytes) },
    });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runCli();
