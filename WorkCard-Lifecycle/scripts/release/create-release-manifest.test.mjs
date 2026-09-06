import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateReleaseManifest, validateTrivyScanReport } from './validate-release-manifest.mjs';

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const scriptPath = resolve(scriptsDirectory, 'create-release-manifest.mjs');
const validatorPath = resolve(scriptsDirectory, 'validate-release-manifest.mjs');
const sourceSha = 'a'.repeat(40);
const otherSha = 'd'.repeat(40);
const imageDigest = `sha256:${'b'.repeat(64)}`;
const otherImageDigest = `sha256:${'f'.repeat(64)}`;
const imageConfigDigest = `sha256:${'e'.repeat(64)}`;
const scannerImage = `aquasec/trivy:0.74.0@sha256:${'c'.repeat(64)}`;
const imageRepository = 'europe-west1-docker.pkg.dev/work-card-release/work-card/work-card';
const immutableImage = `${imageRepository}@${imageDigest}`;
const temporaryRoots = new Set();
let validRoot;
let validManifest;

function validTrivyReport() {
  return {
    SchemaVersion: 2,
    CreatedAt: '2026-09-05T12:35:01.123456789Z',
    ArtifactName: '/scan/published-image.tar',
    ArtifactType: 'container_image',
    Metadata: {
      ImageID: imageConfigDigest,
      RepoDigests: [immutableImage],
      ImageConfig: {
        architecture: 'amd64',
        os: 'linux',
        config: {
          Labels: {
            'org.opencontainers.image.revision': sourceSha,
          },
        },
      },
    },
    Results: [
      {
        Target: 'work-card (debian 13)',
        Class: 'os-pkgs',
        Type: 'debian',
      },
      {
        Target: 'app/node_modules',
        Class: 'lang-pkgs',
        Type: 'node-pkg',
        Vulnerabilities: [],
      },
    ],
  };
}

async function makeFixtureRoot(scanReport = validTrivyReport()) {
  const root = await mkdtemp(join(tmpdir(), 'work-card-release-manifest-'));
  temporaryRoots.add(root);
  await mkdir(join(root, 'apps', 'api', 'migrations'), { recursive: true });
  await mkdir(join(root, '.quality-results', 'release'), { recursive: true });
  await writeFile(join(root, 'apps', 'api', 'migrations', '0001_foundation.sql'), 'select 1;\n');
  await writeFile(join(root, 'apps', 'api', 'migrations', '0002_workflow.sql'), 'select 2;\n');
  await writeFile(
    join(root, '.quality-results', 'release', 'image-vulnerabilities.json'),
    `${JSON.stringify(scanReport, null, 2)}\n`,
  );
  return root;
}

function argumentsFor(root, overrides = {}) {
  const values = {
    '--root': root,
    '--source-sha': sourceSha,
    '--image-tag': `${imageRepository}:${sourceSha}`,
    '--image-digest': imageDigest,
    '--image-config-digest': imageConfigDigest,
    '--oci-revision-label': sourceSha,
    '--source-ci-run-url': 'https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/123',
    '--build-scan-run-url':
      'https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/456/attempts/1',
    '--scanner-image': scannerImage,
    '--generated-at': '2026-09-05T12:34:56.000Z',
    ...overrides,
  };
  return Object.entries(values).flat();
}

function runGenerator(root, overrides = {}) {
  try {
    return execFileSync(process.execPath, [scriptPath, ...argumentsFor(root, overrides)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    error.message = `${error.message}\n${error.stderr ?? ''}`;
    throw error;
  }
}

function manifestPath(root) {
  return join(root, 'docs', 'release', 'manifests', `${sourceSha}.json`);
}

before(async () => {
  validRoot = await makeFixtureRoot();
  runGenerator(validRoot);
  validManifest = JSON.parse(await readFile(manifestPath(validRoot), 'utf8'));
});

after(async () => {
  await Promise.all(
    [...temporaryRoots].map(async (root) => {
      if (root.startsWith(tmpdir())) await rm(root, { recursive: true, force: true });
    }),
  );
});

test('creates and independently validates an immutable release image manifest', async () => {
  await validateReleaseManifest(validManifest);
  execFileSync(
    process.execPath,
    [
      validatorPath,
      '--manifest',
      manifestPath(validRoot),
      '--scan-report',
      join(validRoot, '.quality-results', 'release', 'image-vulnerabilities.json'),
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );

  assert.equal(validManifest.sourceSha, sourceSha);
  assert.equal(validManifest.imageDigest, imageDigest);
  assert.equal(validManifest.immutableImage, immutableImage);
  assert.equal(validManifest.imageConfigDigest, imageConfigDigest);
  assert.equal(validManifest.scan.image, validManifest.immutableImage);
  assert.equal(validManifest.scan.imageConfigDigest, validManifest.imageConfigDigest);
  assert.equal(validManifest.scan.status, 'passed');
  assert.deepEqual(validManifest.scan.reportSummary, {
    schemaVersion: 2,
    artifactType: 'container_image',
    targetCount: 2,
    vulnerabilityCount: 0,
    severityThreshold: ['HIGH', 'CRITICAL'],
  });
  assert.deepEqual(validManifest.lifecycleEvidence, {
    mode: 'append-only-files',
    directory: `docs/release/evidence/${sourceSha}`,
    recordSchema: 'docs/release/release-evidence.schema.json',
  });
  for (const obsoleteField of [
    'secretVersions',
    'stagingRevision',
    'stagingSmokeEvidence',
    'productionRevision',
    'previousProductionRevision',
    'promotionDecision',
    'rollbackDecision',
  ]) {
    assert.equal(obsoleteField in validManifest, false);
  }
  await assert.rejects(access(join(validRoot, 'docs', 'release', 'evidence', sourceSha)), /ENOENT/);

  const checksumInput = validManifest.migrationsChecksumSummary.files
    .map((entry) => `${entry.sha256}  ${entry.path}\n`)
    .join('');
  assert.equal(
    validManifest.migrationsChecksumSummary.digest,
    `sha256:${createHash('sha256').update(checksumInput).digest('hex')}`,
  );
});

test('refuses to overwrite build evidence for the same source SHA', () => {
  assert.throws(
    () => runGenerator(validRoot),
    (error) => error.code === 'EEXIST' || /EEXIST/.test(`${error.stderr ?? error.message}`),
  );
});

test('rejects manifest JSON Schema and cross-field violations', async (context) => {
  const cases = [
    {
      name: 'missing schema-required scan summary',
      mutate: (manifest) => delete manifest.scan.reportSummary,
      pattern: /JSON Schema/,
    },
    {
      name: 'additional property',
      mutate: (manifest) => (manifest.untrustedSuccess = true),
      pattern: /JSON Schema/,
    },
    {
      name: 'non-passed schema status',
      mutate: (manifest) => (manifest.scan.status = 'failed'),
      pattern: /JSON Schema/,
    },
    {
      name: 'tag source SHA mismatch',
      mutate: (manifest) => (manifest.imageTag = `${imageRepository}:${otherSha}`),
      pattern: /Image tag/,
    },
    {
      name: 'OCI revision mismatch',
      mutate: (manifest) => (manifest.ociRevisionLabel = otherSha),
      pattern: /OCI revision/,
    },
    {
      name: 'immutable image digest mismatch',
      mutate: (manifest) => (manifest.immutableImage = `${imageRepository}@${otherImageDigest}`),
      pattern: /Immutable image/,
    },
    {
      name: 'scan image mismatch',
      mutate: (manifest) => (manifest.scan.image = `${imageRepository}@${otherImageDigest}`),
      pattern: /scan\.image/,
    },
    {
      name: 'scan config digest mismatch',
      mutate: (manifest) => (manifest.scan.imageConfigDigest = otherImageDigest),
      pattern: /config digest/,
    },
    {
      name: 'evidence directory source mismatch',
      mutate: (manifest) =>
        (manifest.lifecycleEvidence.directory = `docs/release/evidence/${otherSha}`),
      pattern: /evidence directory/,
    },
    {
      name: 'migration checksum mismatch',
      mutate: (manifest) =>
        (manifest.migrationsChecksumSummary.digest = `sha256:${'0'.repeat(64)}`),
      pattern: /Migration checksum/,
    },
    {
      name: 'unrelated build run repository',
      mutate: (manifest) =>
        (manifest.buildScanRunUrl = 'https://github.com/other/repository/actions/runs/456'),
      pattern: /same repository|одному repository/,
    },
  ];

  for (const entry of cases) {
    await context.test(entry.name, async () => {
      const manifest = JSON.parse(JSON.stringify(validManifest));
      entry.mutate(manifest);
      await assert.rejects(validateReleaseManifest(manifest), entry.pattern);
    });
  }
});

test('accepts only a bound, successful Trivy image vulnerability report', async (context) => {
  const expected = { imageConfigDigest, immutableImage, sourceSha };
  const summary = validateTrivyScanReport(
    Buffer.from(JSON.stringify(validTrivyReport())),
    expected,
  );
  assert.equal(summary.targetCount, 2);
  assert.equal(summary.vulnerabilityCount, 0);

  const cases = [
    {
      name: 'arbitrary parseable object',
      report: {},
      pattern: /SchemaVersion 2/,
    },
    {
      name: 'parseable array',
      report: [],
      pattern: /JSON object/,
    },
    {
      name: 'wrong schema version',
      mutate: (report) => (report.SchemaVersion = 1),
      pattern: /SchemaVersion 2/,
    },
    {
      name: 'wrong artifact type',
      mutate: (report) => (report.ArtifactType = 'filesystem'),
      pattern: /container_image/,
    },
    {
      name: 'wrong scanned artifact',
      mutate: (report) => (report.ArtifactName = '/scan/other.tar'),
      pattern: /published-image\.tar/,
    },
    {
      name: 'wrong image config digest',
      mutate: (report) => (report.Metadata.ImageID = otherImageDigest),
      pattern: /ImageID/,
    },
    {
      name: 'wrong registry digest binding',
      mutate: (report) =>
        (report.Metadata.RepoDigests = [`${imageRepository}@${otherImageDigest}`]),
      pattern: /RepoDigests/,
    },
    {
      name: 'wrong platform',
      mutate: (report) => (report.Metadata.ImageConfig.architecture = 'arm64'),
      pattern: /linux\/amd64/,
    },
    {
      name: 'wrong OCI revision',
      mutate: (report) =>
        (report.Metadata.ImageConfig.config.Labels['org.opencontainers.image.revision'] = otherSha),
      pattern: /OCI revision/,
    },
    {
      name: 'no vulnerability targets',
      mutate: (report) => (report.Results = []),
      pattern: /at least one|хотя бы один/,
    },
    {
      name: 'malformed target',
      mutate: (report) => delete report.Results[0].Class,
      pattern: /Results\[0\]/,
    },
    {
      name: 'non-vulnerability target class',
      mutate: (report) => (report.Results[0].Class = 'config'),
      pattern: /vulnerability package scan/,
    },
    {
      name: 'reported vulnerability',
      mutate: (report) =>
        (report.Results[0].Vulnerabilities = [{ VulnerabilityID: 'CVE-TEST', Severity: 'HIGH' }]),
      pattern: /vulnerability findings/,
    },
  ];

  for (const entry of cases) {
    await context.test(entry.name, () => {
      const report = entry.report ?? validTrivyReport();
      entry.mutate?.(report);
      assert.throws(
        () => validateTrivyScanReport(Buffer.from(JSON.stringify(report)), expected),
        entry.pattern,
      );
    });
  }
});

test('generator rejects arbitrary parseable JSON instead of creating passed evidence', async () => {
  const root = await makeFixtureRoot({});
  assert.throws(() => runGenerator(root), /SchemaVersion 2/);
  await assert.rejects(access(manifestPath(root)), /ENOENT/);
});

test('generator rejects a tag that does not end in the source SHA', async () => {
  const root = await makeFixtureRoot();
  assert.throws(
    () => runGenerator(root, { '--image-tag': `${imageRepository}:latest` }),
    /full source SHA|полным source SHA/,
  );
});
