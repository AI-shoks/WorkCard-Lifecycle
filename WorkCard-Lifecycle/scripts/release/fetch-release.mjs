import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { validateReleaseManifest, validateTrivyScanReport } from './validate-release-manifest.mjs';

const [sourceSha] = process.argv.slice(2);
assert(
  /^[0-9a-f]{40}$/.test(sourceSha ?? '') && process.argv.length === 3,
  'One full release SHA is required.',
);
assert(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(process.env.GITHUB_REPOSITORY ?? ''));
const gh = (...args) =>
  execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const repository = process.env.GITHUB_REPOSITORY;
const download = resolve('.quality-results', `release-${sourceSha}`);
await mkdir(download, { recursive: true });
gh(
  'release',
  'download',
  `work-card-${sourceSha}`,
  '--repo',
  repository,
  '--pattern',
  'release-record.*',
  '--dir',
  download,
);
const archive = await readFile(resolve(download, 'release-record.tar.gz'));
const digest = createHash('sha256').update(archive).digest('hex');
assert.equal(
  (await readFile(resolve(download, 'release-record.sha256'), 'utf8')).trim(),
  `${digest}  release-record.tar.gz`,
);
const entries = execFileSync('tar', ['-tzf', resolve(download, 'release-record.tar.gz')], {
  encoding: 'utf8',
})
  .trim()
  .split(/\r?\n/)
  .sort();
assert.deepEqual(
  entries,
  [
    `.quality-results/release/image-vulnerabilities.json`,
    `docs/release/manifests/${sourceSha}.json`,
    'docs/release/release-evidence.v2.schema.json',
    'docs/release/release-manifest.v2.schema.json',
  ].sort(),
  'Release archive contains unexpected paths.',
);
const descriptions = execFileSync('tar', ['-tvzf', resolve(download, 'release-record.tar.gz')], {
  encoding: 'utf8',
})
  .trim()
  .split(/\r?\n/);
assert(
  descriptions.length === entries.length && descriptions.every((line) => line.startsWith('-')),
  'Release archive entries must all be regular files, never links or special files.',
);
// Schema definitions are checked from the trusted main checkout, never extracted from an archive.
execFileSync('tar', [
  '-xzf',
  resolve(download, 'release-record.tar.gz'),
  `docs/release/manifests/${sourceSha}.json`,
  '.quality-results/release/image-vulnerabilities.json',
]);
const manifest = JSON.parse(await readFile(`docs/release/manifests/${sourceSha}.json`, 'utf8'));
await validateReleaseManifest(manifest);
assert.equal(manifest.schemaVersion, 2);
assert.equal(manifest.sourceSha, sourceSha);
assert.equal(
  manifest.immutableImage.split('@')[0],
  `ghcr.io/${repository.toLowerCase()}/work-card`,
);
const scan = await readFile('.quality-results/release/image-vulnerabilities.json');
assert.equal(
  manifest.scan.reportSha256,
  `sha256:${createHash('sha256').update(scan).digest('hex')}`,
);
assert.deepEqual(validateTrivyScanReport(scan, manifest), manifest.scan.reportSummary);
for (const [url, workflow, event] of [
  [manifest.sourceCiRunUrl, 'ci.yml', 'push'],
  [manifest.buildScanRunUrl, 'release.yml', 'workflow_dispatch'],
]) {
  const parsed = new globalThis.URL(url);
  const match = parsed.pathname.match(
    /^\/([^/]+\/[^/]+)\/actions\/runs\/(\d+)(?:\/attempts\/(\d+))?$/,
  );
  assert.equal(match?.[1], repository);
  const run = JSON.parse(
    gh(
      'api',
      `repos/${repository}/actions/runs/${match[2]}${match[3] ? `/attempts/${match[3]}` : ''}`,
    ),
  );
  assert.equal(run.head_sha, sourceSha);
  assert.equal(run.head_branch, 'main');
  assert.equal(run.event, event);
  assert.equal(run.status, 'completed');
  assert.equal(run.conclusion, 'success');
  assert.equal(run.path, `.github/workflows/${workflow}`);
}
if (manifest.sourceBuildRunUrl !== manifest.buildScanRunUrl) {
  const original = new globalThis.URL(manifest.sourceBuildRunUrl).pathname.match(
    /^\/([^/]+\/[^/]+)\/actions\/runs\/(\d+)\/attempts\/(\d+)$/,
  );
  assert.equal(original?.[1], repository);
  const endpoint = `repos/${repository}/actions/runs/${original[2]}/attempts/${original[3]}`;
  const run = JSON.parse(gh('api', endpoint));
  assert.equal(run.head_sha, sourceSha);
  assert.equal(run.head_branch, 'main');
  assert.equal(run.path, '.github/workflows/release.yml');
  assert.equal(run.event, 'workflow_dispatch');
  assert.equal(run.status, 'completed');
  const jobs = JSON.parse(gh('api', `${endpoint}/jobs?per_page=100`));
  const job = jobs.jobs.find(
    (value) => value.name === 'Build once, publish public GHCR digest, scan and retain',
  );
  for (const name of ['Build the release image exactly once', 'Push source tag and resolve digest'])
    assert.equal(job?.steps.find((step) => step.name === name)?.conclusion, 'success');
}
process.stdout.write(`${manifest.immutableImage}\n`);
