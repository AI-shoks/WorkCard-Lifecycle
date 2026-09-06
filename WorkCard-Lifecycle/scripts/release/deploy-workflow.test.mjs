import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const workflowPath = resolve(projectRoot, '..', '.github', 'workflows', 'deploy.yml');
const workflow = await readFile(workflowPath, 'utf8');
const browserLifecycle = await readFile(
  resolve(projectRoot, 'quality', 'browser', 'lifecycle.spec.ts'),
  'utf8',
);
const hostedSmokeRunner = await readFile(
  resolve(projectRoot, 'scripts', 'release', 'hosted-smoke.mjs'),
  'utf8',
);

function section(start, end) {
  const startIndex = workflow.indexOf(start);
  const endIndex = workflow.indexOf(end, startIndex + start.length);
  assert(startIndex >= 0, `Workflow section is missing: ${start}`);
  assert(endIndex > startIndex, `Workflow section end is missing: ${end}`);
  return workflow.slice(startIndex, endIndex);
}

test('deploy workflow is an explicit main-only staging operation', () => {
  const trigger = section('on:\n', '\npermissions:');
  assert.match(trigger, /^on:\n {2}workflow_dispatch:/);
  assert.doesNotMatch(trigger, /\b(?:push|pull_request|schedule|workflow_run):/);
  assert.match(workflow, /CONFIRMATION.*inputs\.confirmation/);
  assert.match(workflow, /DEPLOY EXACT DIGEST TO STAGING/);
  assert.match(workflow, /GITHUB_REF.*refs\/heads\/main/);
  assert.match(workflow, /^ {4}environment: staging$/m);
  assert.doesNotMatch(workflow, /terraform\s+(?:-chdir=\S+\s+)?apply\b/i);
});

test('deploy workflow accepts only the successful release artifact for the same SHA', () => {
  const preflight = section('  preflight:\n', '\n  deploy:\n');
  assert.match(preflight, /actions\/workflows\/release\.yml\/runs/);
  assert.match(preflight, /\.head_sha == \$sha/);
  assert.match(preflight, /\.conclusion == "success"/);
  assert.match(preflight, /run-id: \$\{\{ steps\.release\.outputs\.release-run-id \}\}/);
  assert.match(preflight, /validate-release-manifest\.mjs/);
  assert.match(preflight, /\.run_attempt/);
  assert.match(preflight, /attempts\/\$\{release_run_attempt\}/);
  assert.match(preflight, /\.sourceSha == \$sha.*\.ociRevisionLabel == \$sha/s);
  assert.match(preflight, /\.buildScanRunUrl == \$release_run_url/);
});

test('database preparation and rollout are bound to the exact digest', () => {
  const deploy = section('  deploy:\n', '\n  smoke:\n');
  const executionStep = section(
    '      - name: Verify exact job boundaries and execute twice\n',
    '      - name: Create and verify a no-traffic revision\n',
  );
  const noTrafficStep = section(
    '      - name: Create and verify a no-traffic revision\n',
    '      - name: Switch staging traffic and append deployment evidence\n',
  );
  const trafficStep = section(
    '      - name: Switch staging traffic and append deployment evidence\n',
    '      - name: Upload non-secret deployment evidence\n',
  );
  assert.match(deploy, /immutable_image=.*\.immutableImage/);
  assert.match(deploy, /gcloud artifacts docker images describe "\$IMMUTABLE_IMAGE"/);
  const verifyIndex = executionStep.indexOf('verify_job "$job" "$ordinal" >/dev/null');
  const executeIndex = executionStep.indexOf('gcloud run jobs execute');
  assert(verifyIndex >= 0 && verifyIndex < executeIndex);
  for (const pair of [
    ['migrate_one', 'migrate 1'],
    ['seed_one', 'seed 1'],
    ['verify_one', 'verify 1'],
    ['migrate_two', 'migrate 2'],
    ['seed_two', 'seed 2'],
    ['verify_two', 'verify 2'],
  ]) {
    assert.match(executionStep, new RegExp(`${pair[0]}=.*execute_job ${pair[1]}`));
  }
  assert.doesNotMatch(executionStep, /--(?:args|command|set-env-vars|update-env-vars|set-secrets)\b/);
  assert.match(deploy, /--image "\$IMMUTABLE_IMAGE"/);
  assert.match(noTrafficStep, /--no-traffic/);
  assert.doesNotMatch(noTrafficStep, /gcloud run services update-traffic/);
  assert.match(noTrafficStep, /gcloud run revisions describe "\$previous_revision"/);
  assert.match(noTrafficStep, /any\(\.type == "Ready"/);
  const revisionCheck = noTrafficStep.indexOf('verify-staging-revision.mjs');
  const trafficSwitch = trafficStep.indexOf('gcloud run services update-traffic');
  assert(revisionCheck >= 0 && trafficSwitch >= 0);
  assert.match(deploy, /echo "rollback-required=true".*gcloud run services update-traffic/s);
});

test('hosted smoke impersonates only the invoker identity and receives no DB credential', () => {
  const smoke = section('  smoke:\n', '\n  observe:\n');
  assert.match(smoke, /GCP_STAGING_SMOKE_SERVICE_ACCOUNT/);
  assert.match(smoke, /hosted-smoke\.mjs/);
  assert.match(smoke, /--service-account "\$GCP_STAGING_SMOKE_SERVICE_ACCOUNT"/);
  assert.match(smoke, /--workload-identity-provider "\$GCP_DEPLOYMENT_WORKLOAD_IDENTITY_PROVIDER"/);
  assert.doesNotMatch(smoke, /google-github-actions\/auth/);
  assert.doesNotMatch(
    smoke,
    /(?:DATABASE_URL|MIGRATION_DATABASE_URL|APP_DATABASE_PASSWORD|QUALITY_OWNER_URL|QUALITY_READ_URL|GCP_RELEASE_DEPLOYER_SERVICE_ACCOUNT)/,
  );
  assert.doesNotMatch(smoke, /setup-gcloud|gcloud\s/);
  assert.match(browserLifecycle, /context\.route\('\*\*\/\*'/);
  assert.match(browserLifecycle, /new URL\(request\.url\(\)\)\.origin !== hostedOrigin/);
  assert.match(browserLifecycle, /route\.abort\('blockedbyclient'\)/);
  assert.match(browserLifecycle, /route\.fetch\(\{[\s\S]*maxRedirects: 0/);
  assert.match(browserLifecycle, /HOSTED_SMOKE_ID_TOKEN_FILE/);
  assert.match(browserLifecycle, /page\.evaluate\(async \(url\)/);
  assert.doesNotMatch(browserLifecycle, /context\.setExtraHTTPHeaders/);
  assert.match(hostedSmokeRunner, /'GCP_RELEASE_DEPLOYER_SERVICE_ACCOUNT'/);
  assert.match(hostedSmokeRunner, /delete childEnvironment\[name\]/);
  assert.match(hostedSmokeRunner, /'ACTIONS_ID_TOKEN_REQUEST_TOKEN'/);
});

test('failure after a rollout attempt restores the recorded prior revision', () => {
  const rollback = workflow.slice(workflow.indexOf('  rollback_failed_staging:\n'));
  assert.match(rollback, /always\(\).*rollback-required == 'true'/s);
  assert.match(rollback, /PREVIOUS_REVISION: \$\{\{ needs\.deploy\.outputs\.previous-revision \}\}/);
  const readyCheck = rollback.indexOf('gcloud run revisions describe "$PREVIOUS_REVISION"');
  const trafficSwitch = rollback.indexOf('--to-revisions "${PREVIOUS_REVISION}=100"');
  assert(readyCheck >= 0 && readyCheck < trafficSwitch);
  assert.match(rollback, /any\(\.type == "Ready"/);
  assert.match(rollback, /--to-revisions "\$\{PREVIOUS_REVISION\}=100"/);
});

test('all third-party actions are pinned to immutable commit SHAs', () => {
  const uses = [...workflow.matchAll(/^\s*uses:\s*(\S+)/gm)].map((match) => match[1]);
  assert(uses.length > 0);
  for (const action of uses) {
    if (action.startsWith('./')) continue;
    assert.match(action, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[0-9a-f]{40}$/);
  }
});
