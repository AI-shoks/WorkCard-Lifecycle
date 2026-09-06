import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const manifestScript = resolve(scriptsDirectory, 'create-release-manifest.mjs');
const appendScript = resolve(scriptsDirectory, 'append-release-evidence.mjs');
const sourceSha = 'a'.repeat(40);
const imageDigest = `sha256:${'b'.repeat(64)}`;
const imageConfigDigest = `sha256:${'e'.repeat(64)}`;
const immutableImage = `europe-west1-docker.pkg.dev/work-card-release/work-card/work-card@${imageDigest}`;
const temporaryRoots = new Set();
let candidateCounter = 0;

function scanReport() {
  return {
    SchemaVersion: 2,
    CreatedAt: '2026-09-05T12:35:01Z',
    ArtifactName: '/scan/published-image.tar',
    ArtifactType: 'container_image',
    Metadata: {
      ImageID: imageConfigDigest,
      RepoDigests: [immutableImage],
      ImageConfig: {
        architecture: 'amd64',
        os: 'linux',
        config: { Labels: { 'org.opencontainers.image.revision': sourceSha } },
      },
    },
    Results: [{ Target: 'work-card (debian 13)', Class: 'os-pkgs', Type: 'debian' }],
  };
}

async function makeReleaseRoot() {
  const root = await mkdtemp(join(tmpdir(), 'work-card-release-evidence-'));
  temporaryRoots.add(root);
  await mkdir(join(root, 'apps', 'api', 'migrations'), { recursive: true });
  await mkdir(join(root, '.quality-results', 'release'), { recursive: true });
  await writeFile(join(root, 'apps', 'api', 'migrations', '0001_foundation.sql'), 'select 1;\n');
  await writeFile(
    join(root, '.quality-results', 'release', 'image-vulnerabilities.json'),
    `${JSON.stringify(scanReport(), null, 2)}\n`,
  );
  execFileSync(
    process.execPath,
    [
      manifestScript,
      '--root',
      root,
      '--source-sha',
      sourceSha,
      '--image-tag',
      `europe-west1-docker.pkg.dev/work-card-release/work-card/work-card:${sourceSha}`,
      '--image-digest',
      imageDigest,
      '--image-config-digest',
      imageConfigDigest,
      '--oci-revision-label',
      sourceSha,
      '--source-ci-run-url',
      'https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/123',
      '--build-scan-run-url',
      'https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/456/attempts/1',
      '--scanner-image',
      `aquasec/trivy:0.74.0@sha256:${'c'.repeat(64)}`,
      '--generated-at',
      '2026-09-05T12:34:56Z',
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return root;
}

async function appendCandidate(root, candidate) {
  candidateCounter += 1;
  const path = join(root, `candidate-${candidateCounter}.json`);
  await writeFile(path, `${JSON.stringify(candidate, null, 2)}\n`);
  try {
    return execFileSync(process.execPath, [appendScript, '--root', root, '--record', path], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    error.message = `${error.message}\n${error.stderr ?? ''}`;
    throw error;
  }
}

function stagingDeployment(recordedAt = '2026-09-05T13:00:00Z') {
  return {
    recordedAt,
    sourceSha,
    immutableImage,
    kind: 'staging-deployment',
    evidence: {
      revision: 'work-card-staging-00001',
      resolvedImage: immutableImage,
      runUrl: 'https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/500/attempts/1',
      secretVersions: {
        ownerDatabasePassword: 1,
        databaseUrl: 2,
        migrationDatabaseUrl: 3,
        appDatabasePassword: 4,
        sessionSigningSecret: 5,
      },
    },
  };
}

function stagingSmoke(recordedAt = '2026-09-05T13:10:00Z') {
  return {
    recordedAt,
    sourceSha,
    immutableImage,
    kind: 'staging-smoke',
    evidence: {
      revision: 'work-card-staging-00001',
      status: 'passed',
      runUrl: 'https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/501/attempts/1',
      checks: ['resolved-image', 'health', 'canonical-lifecycle'],
    },
  };
}

after(async () => {
  await Promise.all(
    [...temporaryRoots].map(async (root) => {
      if (root.startsWith(tmpdir())) await rm(root, { recursive: true, force: true });
    }),
  );
});

test('appends lifecycle evidence as exclusive, hash-chained files', async () => {
  const root = await makeReleaseRoot();
  assert.equal(
    (await appendCandidate(root, stagingDeployment())).trim().endsWith('/0001.json'),
    true,
  );

  const firstPath = join(root, 'docs', 'release', 'evidence', sourceSha, '0001.json');
  const firstBytes = await readFile(firstPath);
  const first = JSON.parse(firstBytes.toString('utf8'));
  assert.equal(first.sequence, 1);
  assert.equal(first.previousRecordSha256, null);
  assert.equal(first.kind, 'staging-deployment');

  assert.equal((await appendCandidate(root, stagingSmoke())).trim().endsWith('/0002.json'), true);
  const second = JSON.parse(
    await readFile(join(root, 'docs', 'release', 'evidence', sourceSha, '0002.json'), 'utf8'),
  );
  assert.equal(second.sequence, 2);
  assert.equal(
    second.previousRecordSha256,
    `sha256:${createHash('sha256').update(firstBytes).digest('hex')}`,
  );

  await assert.rejects(
    access(join(root, 'docs', 'release', 'evidence', sourceSha, '0003.json')),
    /ENOENT/,
  );
});

test('rejects evidence that is not bound to the immutable manifest', async () => {
  const root = await makeReleaseRoot();
  const candidate = stagingDeployment();
  candidate.immutableImage = `europe-west1-docker.pkg.dev/work-card-release/work-card/work-card@sha256:${'f'.repeat(64)}`;
  await assert.rejects(appendCandidate(root, candidate), /immutable image/);
  await assert.rejects(
    access(join(root, 'docs', 'release', 'evidence', sourceSha, '0001.json')),
    /ENOENT/,
  );
});

test('rejects schema-invalid and non-monotonic lifecycle records', async () => {
  const root = await makeReleaseRoot();
  await appendCandidate(root, stagingDeployment());

  const invalidSmoke = stagingSmoke();
  invalidSmoke.evidence.checks = [];
  await assert.rejects(appendCandidate(root, invalidSmoke), /JSON Schema/);
  await assert.rejects(appendCandidate(root, stagingSmoke('2026-09-05T13:00:00Z')), /timestamp/);
  await assert.rejects(
    access(join(root, 'docs', 'release', 'evidence', sourceSha, '0002.json')),
    /ENOENT/,
  );
});

test('detects a modified predecessor before appending another record', async () => {
  const root = await makeReleaseRoot();
  await appendCandidate(root, stagingDeployment());
  await appendCandidate(root, stagingSmoke());

  const firstPath = join(root, 'docs', 'release', 'evidence', sourceSha, '0001.json');
  const first = JSON.parse(await readFile(firstPath, 'utf8'));
  first.evidence.revision = 'work-card-staging-tampered';
  await writeFile(firstPath, `${JSON.stringify(first, null, 2)}\n`);

  await assert.rejects(
    appendCandidate(root, {
      ...stagingSmoke('2026-09-05T13:20:00Z'),
      evidence: {
        ...stagingSmoke().evidence,
        status: 'failed',
      },
    }),
    /hash chain/,
  );
});
