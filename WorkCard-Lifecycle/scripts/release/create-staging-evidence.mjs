import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { validateHostedSmokeReport, validateRevisionBinding } from './hosted-smoke.mjs';
import {
  validateReleaseEvidenceRecord,
  validateReleaseManifest,
} from './validate-release-manifest.mjs';

const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const runUrlPattern =
  /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/runs\/[1-9][0-9]*(?:\/attempts\/[1-9][0-9]*)?$/;
const resourceNamePattern = /^[a-z][a-z0-9-]{0,62}$/;
const secretVersionKeys = [
  'appDatabasePassword',
  'databaseUrl',
  'migrationDatabaseUrl',
  'ownerDatabasePassword',
  'sessionSigningSecret',
];

function sha256Digest(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function validateCommon(manifest, recordedAt, runUrl) {
  assert(timestampPattern.test(recordedAt), 'Evidence recordedAt должен быть UTC timestamp.');
  assert(Date.parse(recordedAt) >= Date.parse(manifest.generatedAt));
  assert(runUrlPattern.test(runUrl), 'Evidence run URL имеет некорректный формат.');
}

function validateSecretVersions(secretVersions) {
  assert.deepEqual(Object.keys(secretVersions).sort(), secretVersionKeys);
  for (const value of Object.values(secretVersions)) {
    assert(Number.isSafeInteger(value) && value > 0, 'Secret version должна быть положительным integer.');
  }
}

function validateExecutions(executions) {
  assert.deepEqual(Object.keys(executions).sort(), ['migrate', 'seed', 'verify']);
  for (const name of ['migrate', 'seed', 'verify']) {
    const values = executions[name];
    assert(Array.isArray(values) && values.length === 2, `${name} требует два execution ID.`);
    assert.equal(new Set(values).size, 2, `${name} execution IDs должны быть уникальны.`);
    for (const value of values) {
      assert(
        resourceNamePattern.test(value) && value.startsWith(`work-card-${name}-`),
        `${name} содержит неожиданный execution ID.`,
      );
    }
  }
}

export async function createStagingDeploymentCandidate({
  executions,
  manifest,
  metadata,
  previousRevision,
  recordedAt,
  revision,
  runUrl,
  secretVersions,
}) {
  await validateReleaseManifest(manifest);
  validateCommon(manifest, recordedAt, runUrl);
  validateSecretVersions(secretVersions);
  validateExecutions(executions);
  validateRevisionBinding(metadata, manifest, revision);
  if (previousRevision !== undefined) {
    assert(resourceNamePattern.test(previousRevision), 'Previous revision имеет неверный формат.');
    assert.notEqual(previousRevision, revision, 'Candidate revision совпадает с previous revision.');
  }

  const candidate = {
    recordedAt,
    sourceSha: manifest.sourceSha,
    immutableImage: manifest.immutableImage,
    kind: 'staging-deployment',
    evidence: {
      revision,
      ...(previousRevision ? { previousRevision } : {}),
      resolvedImage: manifest.immutableImage,
      runUrl,
      secretVersions,
      jobExecutions: executions,
    },
  };
  await validateReleaseEvidenceRecord(
    {
      $schema: '../../release-evidence.schema.json',
      schemaVersion: 1,
      sequence: 1,
      previousRecordSha256: null,
      ...candidate,
    },
    manifest,
  );
  return candidate;
}

export async function createStagingSmokeCandidate({
  manifest,
  observations,
  observationsBytes,
  recordedAt,
  report,
  reportBytes,
  runUrl,
}) {
  await validateReleaseManifest(manifest);
  await validateHostedSmokeReport(report);
  validateCommon(manifest, recordedAt, runUrl);
  assert.equal(report.status, 'passed');
  assert.equal(report.sourceSha, manifest.sourceSha);
  assert.equal(report.immutableImage, manifest.immutableImage);
  assert.equal(observations.status, 'passed');
  assert.equal(observations.sourceSha, manifest.sourceSha);
  assert.equal(observations.immutableImage, manifest.immutableImage);
  assert.equal(observations.revision, report.revision);
  assert(Array.isArray(observations.checks) && observations.checks.length > 0);

  const checks = [...new Set([...report.checks, ...observations.checks])];
  const candidate = {
    recordedAt,
    sourceSha: manifest.sourceSha,
    immutableImage: manifest.immutableImage,
    kind: 'staging-smoke',
    evidence: {
      revision: report.revision,
      status: 'passed',
      runUrl,
      origin: report.origin,
      checks,
      smokeReportSha256: sha256Digest(reportBytes),
      observationsSha256: sha256Digest(observationsBytes),
    },
  };
  await validateReleaseEvidenceRecord(
    {
      $schema: '../../release-evidence.schema.json',
      schemaVersion: 1,
      sequence: 2,
      previousRecordSha256: `sha256:${'0'.repeat(64)}`,
      ...candidate,
    },
    manifest,
  );
  return candidate;
}

function parseOptions(arguments_) {
  const allowed = new Set([
    '--executions',
    '--kind',
    '--manifest',
    '--observations',
    '--output',
    '--previous-revision',
    '--recorded-at',
    '--revision',
    '--revision-metadata',
    '--run-url',
    '--secret-versions',
    '--smoke-report',
  ]);
  const options = new Map();
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (!allowed.has(name) || value === undefined || value.startsWith('--') || options.has(name)) {
      throw new Error(`Некорректный аргумент staging evidence: ${name ?? '<missing>'}`);
    }
    options.set(name, value);
  }
  return options;
}

async function bytesAndJson(path) {
  const bytes = await readFile(resolve(path));
  return { bytes, value: JSON.parse(bytes.toString('utf8')) };
}

function requireOptions(options, names) {
  for (const name of names) {
    if (!options.has(name)) throw new Error(`Обязательный аргумент ${name} отсутствует.`);
  }
}

async function runCli() {
  const options = parseOptions(process.argv.slice(2));
  const kind = options.get('--kind');
  requireOptions(options, ['--kind', '--manifest', '--output', '--recorded-at', '--run-url']);
  const manifest = (await bytesAndJson(options.get('--manifest'))).value;
  let candidate;

  if (kind === 'deployment') {
    requireOptions(options, [
      '--executions',
      '--revision',
      '--revision-metadata',
      '--secret-versions',
    ]);
    candidate = await createStagingDeploymentCandidate({
      executions: (await bytesAndJson(options.get('--executions'))).value,
      manifest,
      metadata: (await bytesAndJson(options.get('--revision-metadata'))).value,
      previousRevision: options.get('--previous-revision'),
      recordedAt: options.get('--recorded-at'),
      revision: options.get('--revision'),
      runUrl: options.get('--run-url'),
      secretVersions: (await bytesAndJson(options.get('--secret-versions'))).value,
    });
  } else if (kind === 'smoke') {
    requireOptions(options, ['--observations', '--smoke-report']);
    const report = await bytesAndJson(options.get('--smoke-report'));
    const observations = await bytesAndJson(options.get('--observations'));
    candidate = await createStagingSmokeCandidate({
      manifest,
      observations: observations.value,
      observationsBytes: observations.bytes,
      recordedAt: options.get('--recorded-at'),
      report: report.value,
      reportBytes: report.bytes,
      runUrl: options.get('--run-url'),
    });
  } else {
    throw new Error('--kind должен быть deployment или smoke.');
  }

  const output = resolve(options.get('--output'));
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(candidate, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  process.stdout.write(`${output}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runCli();
}
