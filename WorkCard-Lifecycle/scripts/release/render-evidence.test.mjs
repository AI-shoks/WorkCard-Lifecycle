import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  validateReleaseEvidenceRecord,
  validateReleaseManifest,
} from './validate-release-manifest.mjs';
import { rollbackRender, verifyRollback } from './rollback-render.mjs';
import { browserEnvironment } from './public-smoke.mjs';
import { collectLogs, validateRenderObservations } from './render-observations.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const repository = 'ghcr.io/ai-shoks/workcard-lifecycle/work-card';
const runUrl = 'https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/123/attempts/1';
const serviceId = `srv-${'a'.repeat(20)}`;
const ownerId = `tea-${'b'.repeat(20)}`;
function manifest(source = 'a', migration = 'select 1;') {
  const sourceSha = source.repeat(40);
  const imageDigest = `sha256:${source.repeat(64)}`;
  const image = `${repository}@${imageDigest}`;
  const migrationFile = { path: 'apps/api/migrations/0001.sql', sha256: hash(migration) };
  return {
    $schema: '../release-manifest.v2.schema.json',
    schemaVersion: 2,
    generatedAt: '2026-09-17T00:00:00Z',
    sourceSha,
    sourceCiRunUrl: runUrl,
    imageTag: `${repository}:${sourceSha}`,
    imageDigest,
    immutableImage: image,
    imageConfigDigest: imageDigest,
    ociRevisionLabel: sourceSha,
    platform: 'linux/amd64',
    buildScanRunUrl: runUrl,
    sourceBuildRunUrl: runUrl,
    scan: {
      status: 'passed',
      image,
      imageConfigDigest: imageDigest,
      scannerImage: `aquasec/trivy:0.74.0@sha256:${'c'.repeat(64)}`,
      reportPath: '.quality-results/release/image-vulnerabilities.json',
      reportSha256: imageDigest,
      reportSummary: {
        schemaVersion: 2,
        artifactType: 'container_image',
        targetCount: 1,
        vulnerabilityCount: 0,
        severityThreshold: ['HIGH', 'CRITICAL'],
      },
    },
    migrationsChecksumSummary: {
      algorithm: 'sha256',
      digest: `sha256:${hash(`${migrationFile.sha256}  ${migrationFile.path}\n`)}`,
      files: [migrationFile],
    },
    lifecycleEvidence: {
      mode: 'append-only-files',
      directory: `docs/release/evidence/${sourceSha}`,
      recordSchema: 'docs/release/release-evidence.v2.schema.json',
    },
  };
}
function record(current = manifest(), prior = manifest('b')) {
  return {
    $schema: '../../release-evidence.v2.schema.json',
    schemaVersion: 2,
    sequence: 1,
    recordedAt: '2026-09-17T01:00:00Z',
    sourceSha: current.sourceSha,
    immutableImage: current.immutableImage,
    previousRecordSha256: null,
    kind: 'production-deployment',
    evidence: {
      provider: 'render',
      serviceId,
      deployId: `dep-${'c'.repeat(20)}`,
      previousImage: prior.immutableImage,
      resolvedImage: current.immutableImage,
      persistentImage: current.immutableImage,
      resolvedDigest: current.imageDigest,
      status: 'live',
      stagingReportSha256: `sha256:${'d'.repeat(64)}`,
      runUrl,
      configurationRevision: 'initial-rotation-1',
    },
  };
}

test('v2 GHCR evidence binds persistent Render reference, resolved digest, source and configuration label', async () => {
  await validateReleaseManifest(manifest());
  await validateReleaseEvidenceRecord(record(), manifest());
  for (const mutate of [
    (r) => {
      r.evidence.persistentImage = manifest('b').immutableImage;
    },
    (r) => {
      r.evidence.resolvedDigest = manifest('b').imageDigest;
    },
    (r) => {
      r.schemaVersion = 1;
    },
    (r) => {
      r.evidence.configurationRevision = '';
    },
    (r) => {
      r.evidence.secretVersions = { owner: 1 };
    },
  ]) {
    const candidate = record();
    mutate(candidate);
    await assert.rejects(validateReleaseEvidenceRecord(candidate, manifest()));
  }
});

test('rollback accepts only the recorded previous image with identical migration history', async () => {
  const currentManifest = manifest();
  const targetManifest = manifest('b');
  const deploymentRecord = record(currentManifest, targetManifest);
  assert.equal(
    await verifyRollback({ currentManifest, targetManifest, deploymentRecord }),
    targetManifest.immutableImage,
  );
  await assert.rejects(
    verifyRollback({ currentManifest, targetManifest: manifest('c'), deploymentRecord }),
    /recorded immediately previous/,
  );
  await assert.rejects(
    verifyRollback({
      currentManifest,
      targetManifest: manifest('b', 'select 2;'),
      deploymentRecord,
    }),
    /identical migration history/,
  );
});

test('rollback persists validated intent before PATCH and live evidence before returning for smoke', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'work-card-rollback-test-'));
  try {
    const currentManifest = manifest();
    const targetManifest = manifest('b');
    const events = [];
    const state = {
      id: serviceId,
      ownerId,
      type: 'web_service',
      autoDeploy: 'no',
      imagePath: currentManifest.immutableImage,
      serviceDetails: {
        runtime: 'image',
        plan: 'free',
        numInstances: 1,
        healthCheckPath: '/health/live',
        url: 'https://work-card-demo.onrender.com',
      },
    };
    const deployId = `dep-${'c'.repeat(20)}`;
    const report = await rollbackRender({
      currentManifest,
      targetManifest,
      deploymentRecord: record(currentManifest, targetManifest),
      expected: { serviceId, ownerId, repository, origin: state.serviceDetails.url },
      context: { runUrl, configurationRevision: 'rotation-1' },
      output: join(directory, 'rollback.json'),
      request: async (path, options = {}) => {
        if (options.method === 'PATCH') {
          events.push('PATCH');
          state.imagePath = options.body.image.imagePath;
          return state;
        }
        if (options.method === 'POST') {
          events.push('POST');
          return { id: deployId };
        }
        if (path.endsWith('?limit=20'))
          return [
            {
              deploy: {
                id: deployId,
                status: 'live',
                image: { ref: currentManifest.immutableImage, sha: currentManifest.imageDigest },
              },
            },
          ];
        if (path.endsWith(deployId))
          return {
            id: deployId,
            status: 'live',
            image: { ref: targetManifest.immutableImage, sha: targetManifest.imageDigest },
          };
        return state;
      },
      retain: async (_manifest, path) => {
        events.push(path.endsWith('compatibility.json') ? 'compatibility-report' : 'live-report');
      },
      append: async (release, candidate) => {
        events.push(
          `${candidate.kind}:${candidate.evidence.status ?? candidate.evidence.decision}`,
        );
        await validateReleaseEvidenceRecord({ ...record(release), ...candidate }, release);
      },
    });
    assert.equal(report.resolvedImage, targetManifest.immutableImage);
    assert.deepEqual(events, [
      'compatibility-report',
      'rollback-decision:required',
      'rollback-attempt:prepared',
      'PATCH',
      'POST',
      'rollback-attempt:triggered',
      'rollback-deployment:live',
      'live-report',
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('attempt records require deploy ID only after a verified trigger', async () => {
  for (const kind of ['production-attempt', 'rollback-attempt']) {
    const candidate = {
      ...record(),
      kind,
      evidence: {
        runUrl,
        configurationRevision: 'rotation-1',
        serviceId,
        previousImage: manifest('b').immutableImage,
        requestedImage: manifest().immutableImage,
        status: 'triggered',
        ...(kind === 'rollback-attempt'
          ? { compatibilityEvidenceSha256: `sha256:${'f'.repeat(64)}` }
          : {}),
      },
    };
    await assert.rejects(validateReleaseEvidenceRecord(candidate, manifest()), /JSON Schema/);
    candidate.evidence.deployId = `dep-${'c'.repeat(20)}`;
    await validateReleaseEvidenceRecord(candidate, manifest());
    candidate.evidence.status = 'prepared';
    await assert.rejects(validateReleaseEvidenceRecord(candidate, manifest()), /JSON Schema/);
  }
});

test('rollback rejects an old deployment record even when its image is live again', async () => {
  const currentManifest = manifest();
  const targetManifest = manifest('b');
  const deploymentRecord = record(currentManifest, targetManifest);
  deploymentRecord.evidence.deployId = `dep-${'d'.repeat(20)}`;
  const expected = {
    serviceId,
    ownerId,
    repository,
    origin: 'https://work-card-demo.onrender.com',
  };
  const state = {
    id: serviceId,
    ownerId,
    type: 'web_service',
    autoDeploy: 'no',
    imagePath: currentManifest.immutableImage,
    serviceDetails: {
      runtime: 'image',
      plan: 'free',
      numInstances: 1,
      healthCheckPath: '/health/live',
      url: expected.origin,
    },
  };
  let mutations = 0;
  await assert.rejects(
    rollbackRender({
      currentManifest,
      targetManifest,
      deploymentRecord,
      expected,
      context: { runUrl, configurationRevision: 'rotation-1' },
      output: 'must-not-be-written.json',
      request: async (path, options = {}) => {
        if (options.method) mutations++;
        if (path.endsWith('?limit=20'))
          return [
            {
              deploy: {
                id: `dep-${'c'.repeat(20)}`,
                status: 'live',
                image: { ref: currentManifest.immutableImage, sha: currentManifest.imageDigest },
              },
            },
          ];
        return state;
      },
    }),
    /current live deployment/,
  );
  assert.equal(mutations, 0);
});

test('a prepared intent without a deployment ID requires reconciliation before rollback', async () => {
  const currentManifest = manifest();
  const targetManifest = manifest('b');
  const deploymentRecord = {
    ...record(currentManifest, targetManifest),
    kind: 'production-attempt',
    evidence: {
      runUrl,
      configurationRevision: 'rotation-1',
      serviceId,
      previousImage: targetManifest.immutableImage,
      requestedImage: currentManifest.immutableImage,
      status: 'prepared',
    },
  };
  await assert.rejects(
    verifyRollback({ currentManifest, targetManifest, deploymentRecord }),
    /reconcile prepared intents/,
  );
});

test('browser environment is an allowlist excluding every owner, DB and provider secret', () => {
  const environment = browserEnvironment(
    {
      PATH: 'bin',
      MIGRATION_DATABASE_URL: 'owner',
      DATABASE_URL: 'runtime',
      RENDER_API_KEY: 'provider',
      FUTURE_SECRET: 'secret',
      SESSION_SIGNING_SECRET: 'session',
      APP_DATABASE_PASSWORD: 'role',
    },
    'http://127.0.0.1:3000',
  );
  assert.equal(environment.PATH, 'bin');
  assert.equal(environment.QUALITY_HOSTED, '1');
  assert(
    !Object.values(environment).some((value) =>
      ['owner', 'runtime', 'provider', 'secret', 'session', 'role'].includes(value),
    ),
  );
});

function observationFixture() {
  const report = {
    schemaVersion: 2,
    platform: 'render',
    status: 'passed',
    sourceSha: 'a'.repeat(40),
    immutableImage: manifest().immutableImage,
    expectedClientIp: '203.0.113.55',
    checks: ['spoof-resistant-session-rate-limit'],
    markers: {
      body: 'BODY_MARKER',
      header: 'HEADER_MARKER',
      query: 'QUERY_MARKER',
      spoofedIps: ['192.0.2.11'],
    },
    requestIds: ['first', 'second'],
    startedAt: '2026-09-17T00:00:00Z',
    completedAt: '2026-09-17T01:00:00Z',
  };
  const logs = report.requestIds.map((id, index) => ({
    id,
    labels: [{ name: 'resource', value: serviceId }],
    message: JSON.stringify({
      message: 'request completed',
      requestId: id,
      appVersion: report.sourceSha,
      service: serviceId,
      protocol: 'https',
      remoteIp: report.expectedClientIp,
      remoteAddress: '10.20.30.40',
      revision: `${serviceId}-instance`,
      severity: index ? 'WARNING' : 'INFO',
    }),
  }));
  return { report, logs, settings: { serviceId, trustedCidrs: ['10.20.30.40/32'] } };
}

test('actual application observations qualify reviewed proxy peer and independent client egress', () => {
  const { report, logs, settings } = observationFixture();
  assert.equal(validateRenderObservations(report, logs, settings).correlatedRequests, 2);
  for (const mutation of [
    (entry) => {
      entry.remoteIp = '192.0.2.11';
    },
    (entry) => {
      entry.remoteAddress = '10.20.30.41';
    },
    (entry) => {
      entry.protocol = 'http';
    },
    (entry) => {
      entry.appVersion = 'wrong';
    },
  ]) {
    const copy = globalThis.structuredClone(logs);
    const entry = JSON.parse(copy[0].message);
    mutation(entry);
    copy[0].message = JSON.stringify(entry);
    assert.throws(() => validateRenderObservations(report, copy, settings));
  }
  assert.throws(() => validateRenderObservations(report, logs.slice(1), settings), /Missing/);
  assert.throws(
    () =>
      validateRenderObservations(
        report,
        [...logs, { ...logs[0], message: 'BODY_MARKER' }],
        settings,
      ),
    /forbidden/,
  );
});

test('Render log pagination advances safely and refuses a repeating cursor', async () => {
  const { report, logs } = observationFixture();
  let count = 0;
  const fetchImplementation = async (_url, init) => {
    assert.equal(init.redirect, 'error');
    count++;
    return globalThis.Response.json({
      logs: [logs[count - 1]],
      hasMore: count === 1,
      nextStartTime: '2026-09-17T00:30:00Z',
      nextEndTime: report.completedAt,
    });
  };
  assert.equal(
    (await collectLogs({ report, serviceId, ownerId, token: 'test-token', fetchImplementation }))
      .length,
    2,
  );
  await assert.rejects(
    collectLogs({
      report,
      serviceId,
      ownerId,
      token: 'test-token',
      fetchImplementation: async () =>
        globalThis.Response.json({
          logs: [],
          hasMore: true,
          nextStartTime: report.startedAt,
          nextEndTime: report.completedAt,
        }),
    }),
    /did not advance/,
  );
});
