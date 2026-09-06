import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';

import {
  createStagingDeploymentCandidate,
  createStagingSmokeCandidate,
} from './create-staging-evidence.mjs';

const sourceSha = 'a'.repeat(40);
const immutableImage = `europe-west1-docker.pkg.dev/work-card-release/work-card/work-card@sha256:${'b'.repeat(64)}`;
const revision = 'work-card-app-smoke-123';
const runUrl = 'https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/3/attempts/1';
const migrationPath = 'apps/api/migrations/0001_foundation.sql';
const migrationSha = 'c'.repeat(64);
const manifest = {
  $schema: '../release-manifest.schema.json',
  schemaVersion: 1,
  generatedAt: '2026-09-06T10:00:00Z',
  sourceSha,
  sourceCiRunUrl: 'https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/1',
  imageTag: `europe-west1-docker.pkg.dev/work-card-release/work-card/work-card:${sourceSha}`,
  imageDigest: `sha256:${'b'.repeat(64)}`,
  immutableImage,
  imageConfigDigest: `sha256:${'d'.repeat(64)}`,
  ociRevisionLabel: sourceSha,
  platform: 'linux/amd64',
  buildScanRunUrl: 'https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/2',
  scan: {
    status: 'passed',
    image: immutableImage,
    imageConfigDigest: `sha256:${'d'.repeat(64)}`,
    scannerImage: `aquasec/trivy:0.74.0@sha256:${'e'.repeat(64)}`,
    reportPath: '.quality-results/release/image-vulnerabilities.json',
    reportSha256: `sha256:${'f'.repeat(64)}`,
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
    digest: `sha256:${createHash('sha256').update(`${migrationSha}  ${migrationPath}\n`).digest('hex')}`,
    files: [{ path: migrationPath, sha256: migrationSha }],
  },
  lifecycleEvidence: {
    mode: 'append-only-files',
    directory: `docs/release/evidence/${sourceSha}`,
    recordSchema: 'docs/release/release-evidence.schema.json',
  },
};
const metadata = {
  metadata: { labels: { 'source-sha': sourceSha }, name: revision },
  spec: {
    containers: [
      {
        args: ['dist/server.js'],
        command: ['node'],
        env: [
          { name: 'APP_ENV', value: 'staging' },
          { name: 'APP_ORIGIN', value: 'https://work-card-app-example.europe-west1.run.app' },
          { name: 'APP_VERSION', value: sourceSha },
          {
            name: 'DATABASE_URL',
            valueSource: {
              secretKeyRef: { secret: 'work-card-database-url', version: '2' },
            },
          },
          { name: 'DEMO_MAX_BATCHES', value: '20' },
          { name: 'DEMO_MAX_SESSIONS', value: '500' },
          { name: 'HOST', value: '0.0.0.0' },
          { name: 'LOG_LEVEL', value: 'info' },
          { name: 'PROXY_TRUST_MODE', value: 'cloud-run' },
          {
            name: 'SESSION_SIGNING_SECRET',
            valueSource: {
              secretKeyRef: { secret: 'work-card-session-signing-secret', version: '5' },
            },
          },
          { name: 'WEB_DIST_PATH', value: '/opt/work-card/public' },
        ],
        image: immutableImage,
        name: 'app',
        volumeMounts: [{ mountPath: '/cloudsql', name: 'cloudsql' }],
      },
    ],
  },
  status: { conditions: [{ status: 'True', type: 'Ready' }] },
};
const secretVersions = {
  ownerDatabasePassword: 1,
  databaseUrl: 2,
  migrationDatabaseUrl: 3,
  appDatabasePassword: 4,
  sessionSigningSecret: 5,
};
const executions = {
  migrate: ['work-card-migrate-00001', 'work-card-migrate-00002'],
  seed: ['work-card-seed-00001', 'work-card-seed-00002'],
  verify: ['work-card-verify-00001', 'work-card-verify-00002'],
};
const report = {
  $schema: '../../scripts/release/hosted-smoke-report.schema.json',
  schemaVersion: 1,
  startedAt: '2026-09-06T10:10:00Z',
  completedAt: '2026-09-06T10:20:00Z',
  sourceSha,
  immutableImage,
  revision,
  origin: 'https://work-card-app-example.europe-west1.run.app',
  status: 'passed',
  checks: ['resolved-image', 'sanitized-health'],
  requestIds: [randomUUID()],
  assets: ['/assets/app.css', '/assets/app.js'],
  sessionRateLimit: { limitedStatus: 429, successfulSessionAttempts: 2 },
  redactionMarkers: {
    body: `SMOKE_BODY_${randomUUID()}`,
    header: `SMOKE_HEADER_${randomUUID()}`,
    query: `SMOKE_QUERY_${randomUUID()}`,
    spoofedIps: ['192.0.2.1', '192.0.2.2', '192.0.2.3'],
  },
};
const observations = {
  schemaVersion: 1,
  sourceSha,
  immutableImage,
  revision,
  status: 'passed',
  checks: ['cloud-logging-severity'],
  correlatedRequests: 1,
  observedSeverities: ['INFO', 'WARNING'],
};

test('creates schema-valid staging deployment evidence bound to jobs and revision', async () => {
  const candidate = await createStagingDeploymentCandidate({
    executions,
    manifest,
    metadata,
    previousRevision: 'work-card-app-previous',
    recordedAt: '2026-09-06T10:09:00Z',
    revision,
    runUrl,
    secretVersions,
  });
  assert.equal(candidate.kind, 'staging-deployment');
  assert.deepEqual(candidate.evidence.jobExecutions, executions);
  assert.equal(candidate.evidence.resolvedImage, immutableImage);
});

test('creates passed smoke evidence only after report and log observations agree', async () => {
  const reportBytes = Buffer.from(`${JSON.stringify(report)}\n`);
  const observationsBytes = Buffer.from(`${JSON.stringify(observations)}\n`);
  const candidate = await createStagingSmokeCandidate({
    manifest,
    observations,
    observationsBytes,
    recordedAt: '2026-09-06T10:21:00Z',
    report,
    reportBytes,
    runUrl,
  });
  assert.equal(candidate.kind, 'staging-smoke');
  assert.equal(candidate.evidence.status, 'passed');
  assert(candidate.evidence.checks.includes('cloud-logging-severity'));
  assert.equal(
    candidate.evidence.smokeReportSha256,
    `sha256:${createHash('sha256').update(reportBytes).digest('hex')}`,
  );
});

test('rejects incomplete execution proof and mismatched observation revision', async () => {
  await assert.rejects(
    createStagingDeploymentCandidate({
      executions: { ...executions, migrate: executions.migrate.slice(0, 1) },
      manifest,
      metadata,
      recordedAt: '2026-09-06T10:09:00Z',
      revision,
      runUrl,
      secretVersions,
    }),
    /два execution ID/,
  );
  await assert.rejects(
    createStagingSmokeCandidate({
      manifest,
      observations: { ...observations, revision: 'work-card-app-other' },
      observationsBytes: Buffer.from(JSON.stringify(observations)),
      recordedAt: '2026-09-06T10:21:00Z',
      report,
      reportBytes: Buffer.from(JSON.stringify(report)),
      runUrl,
    }),
    /strictEqual|Expected values to be strictly equal/,
  );
});
