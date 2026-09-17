import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFile, copyFile, mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { immutableImagePattern } from './render-adapter.mjs';

const runId = process.env.RESUME_RUN_ID;
const sourceSha = process.env.SOURCE_SHA;
const repository = process.env.GITHUB_REPOSITORY;
assert(/^[1-9][0-9]*$/.test(runId ?? '') && runId !== process.env.GITHUB_RUN_ID);
assert(/^[0-9a-f]{40}$/.test(sourceSha ?? ''));
const gh = (...args) =>
  execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const run = JSON.parse(gh('api', `repos/${repository}/actions/runs/${runId}`));
assert.equal(run.head_sha, sourceSha);
assert.equal(run.head_branch, 'main');
assert.equal(run.event, 'workflow_dispatch');
assert.equal(run.path, '.github/workflows/release.yml');
assert.equal(run.status, 'completed');
const jobs = JSON.parse(
  gh(
    'api',
    `repos/${repository}/actions/runs/${runId}/attempts/${run.run_attempt}/jobs?per_page=100`,
  ),
);
const job = jobs.jobs.find(
  (value) => value.name === 'Build once, publish public GHCR digest, scan and retain',
);
for (const step of ['Build the release image exactly once', 'Push source tag and resolve digest']) {
  assert.equal(
    job?.steps.find((value) => value.name === step)?.conclusion,
    'success',
    'Original build and publication must both be proven successful.',
  );
}
const directory = resolve('.quality-results', 'original-publication');
await mkdir(directory, { recursive: true });
gh(
  'run',
  'download',
  runId,
  '--repo',
  repository,
  '--name',
  `published-identity-${sourceSha}-${run.run_attempt}`,
  '--dir',
  directory,
);
const identity = JSON.parse(await readFile(resolve(directory, 'published-identity.json'), 'utf8'));
assert.equal(identity.sourceSha, sourceSha);
assert(immutableImagePattern.test(identity.immutableImage));
assert.equal(
  identity.immutableImage.split('@')[0],
  `ghcr.io/${repository.toLowerCase()}/work-card`,
);
assert(/^sha256:[0-9a-f]{64}$/.test(identity.imageConfigDigest));
assert.equal(
  identity.sourceBuildRunUrl,
  `https://github.com/${repository}/actions/runs/${runId}/attempts/${run.run_attempt}`,
);
await mkdir(resolve('.quality-results/release'), { recursive: true });
await copyFile(
  resolve(directory, 'published-identity.json'),
  '.quality-results/release/published-identity.json',
);
const values = {
  IMAGE_REPOSITORY: identity.immutableImage.split('@')[0],
  IMAGE_TAG: `${identity.immutableImage.split('@')[0]}:${sourceSha}`,
  IMMUTABLE_IMAGE: identity.immutableImage,
  IMAGE_DIGEST: identity.immutableImage.split('@')[1],
  LOCAL_IMAGE_CONFIG_DIGEST: identity.imageConfigDigest,
  SOURCE_BUILD_RUN_URL: identity.sourceBuildRunUrl,
  BUILD_SCAN_RUN_URL: `https://github.com/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}/attempts/${process.env.GITHUB_RUN_ATTEMPT}`,
};
await appendFile(
  process.env.GITHUB_ENV,
  `${Object.entries(values)
    .map(([name, value]) => `${name}=${value}`)
    .join('\n')}\n`,
);
