import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const read = async (path) =>
  (await readFile(new globalThis.URL(path, import.meta.url), 'utf8')).replaceAll('\r\n', '\n');
const workflow = await read('../../../.github/workflows/deploy.yml');
const release = await read('../../../.github/workflows/release.yml');
const reset = await read('../../../.github/workflows/reset.yml');
const rollback = await read('../../../.github/workflows/rollback.yml');
const resume = await read('./resume-publication.mjs');
const ci = await read('../../../.github/workflows/ci.yml');
const fetchRelease = await read('./fetch-release.mjs');
const browser = await read('../../quality/browser/lifecycle.spec.ts');
const browserTransport = await read('../../quality/browser/hosted-route.ts');
const browserTransportTests = await read('../../quality/hosted-route.test.ts');
const proxyProbe = await read('./proxy-probe.mjs');
const publicSmoke = await read('./public-smoke.mjs');
function section(text, start, end) {
  const first = text.indexOf(start);
  const last = end ? text.indexOf(end, first + start.length) : text.length;
  assert(first >= 0 && last > first, `Missing section ${start}`);
  return text.slice(first, last);
}

test('release and promotion are explicit main-only operations and owner workflows share one concurrency group', () => {
  for (const text of [release, workflow, rollback]) {
    assert.match(text, /workflow_dispatch:/);
    assert.match(text, /GITHUB_REF.*refs\/heads\/main/);
    assert.doesNotMatch(
      section(text, 'on:\n', '\npermissions:'),
      /^ {2}(?:push|pull_request|schedule|workflow_run):/m,
    );
  }
  assert.match(workflow, /PROMOTE EXACT DIGEST/);
  for (const text of [workflow, reset, rollback]) {
    assert.match(text, /group: work-card-owner-and-release/);
    assert.match(text, /cancel-in-progress: false/);
  }
});

test('resume uses a single-file original publication artifact and never rebuilds that digest', () => {
  assert.match(
    release,
    /name: published-identity-\$\{\{ needs\.preflight\.outputs\.source-sha \}\}-\$\{\{ github\.run_attempt \}\}/,
  );
  assert.match(resume, /`published-identity-\$\{sourceSha\}-\$\{run\.run_attempt\}`/);
  assert.match(resume, /resolve\(directory, 'published-identity\.json'\)/);
  assert.doesNotMatch(
    resume,
    /docker build|\.quality-results\/release\/published-identity\.json'\), 'utf8'/,
  );
  assert(
    release.indexOf('Retain original publication identity') <
      release.indexOf('Prove anonymous public pull'),
  );
  assert.match(resume, /Original build and publication must both be proven successful/);
});

test('rollback preserves durable intent and uses a separate secret-free smoke boundary', () => {
  assert.match(rollback, /ROLLBACK PREVIOUS COMPATIBLE DIGEST/);
  assert.match(rollback, /fetch-release\.mjs "\$CURRENT_SHA"/);
  assert.match(rollback, /fetch-release\.mjs "\$TARGET_SHA"/);
  assert.match(rollback, /rollback-render\.mjs/);
  assert.doesNotMatch(
    rollback,
    /MIGRATION_DATABASE_URL|APP_DATABASE_PASSWORD|SESSION_SIGNING_SECRET|docker build/,
  );
  const smoke = section(rollback, '  smoke:\n', '\n  evidence:\n');
  assert.doesNotMatch(smoke, /secrets\.|DATABASE_URL|RENDER_API_KEY/);
  assert.match(smoke, /RENDER_ORIGIN: \$\{\{ needs\.rollback\.outputs\.origin \}\}/);
  assert.match(rollback, /origin: \$\{\{ steps\.deployment\.outputs\.origin \}\}/);
  assert.match(rollback, /retain-evidence\.mjs "\$TARGET_SHA" "\$CURRENT_SHA"/);
});

test('build once and preserve all gates before public digest promotion', () => {
  assert.equal([...release.matchAll(/docker build --platform linux\/amd64/g)].length, 1);
  assert.match(release, /docker manifest inspect/);
  assert.match(release, /packages: write/);
  assert.match(release, /public-docker.*pull --platform linux\/amd64 "\$IMMUTABLE_IMAGE"/);
  assert.match(release, /--severity HIGH,CRITICAL --exit-code 1/);
  assert.match(release, /validate-release-manifest\.mjs/);
  assert.match(release, /gh release create/);
  assert.equal([...release.matchAll(/verify-image-config\.mjs/g)].length, 2);
  assert.match(release, /--image-config-digest "\$LOCAL_IMAGE_CONFIG_DIGEST"/);
  assert.doesNotMatch(release, /LOCAL_IMAGE_ID|--arg id/);
  for (const name of [
    'Code and database quality',
    'Clean container startup',
    'Dependency and secret security',
    'Browser (compact)',
    'Browser (canonical)',
    'Representative performance profile',
    'Release and IaC contract',
  ])
    assert(release.includes(name));
  assert.doesNotMatch(workflow, /docker build|gcloud|google-github-actions|terraform/);
  assert.match(workflow, /verify-image-migrations\.mjs/);
});

test('durable release fetch verifies successful exact-SHA CI, release run, scan and checksums', () => {
  assert.match(fetchRelease, /run\.head_sha, sourceSha/);
  assert.match(fetchRelease, /run\.head_branch, 'main'/);
  assert.match(fetchRelease, /run\.conclusion, 'success'/);
  assert.match(fetchRelease, /ci\.yml/);
  assert.match(fetchRelease, /release\.yml/);
  assert.match(fetchRelease, /validateTrivyScanReport/);
  assert.match(fetchRelease, /Release archive contains unexpected paths/);
});

test('owner, runtime, Render adapter and browser have separate secret boundaries', () => {
  for (const [start, end] of [
    ['  staging_owner:\n', '\n  staging:\n'],
    ['  production_owner:\n', '\n  deploy:\n'],
  ]) {
    const owner = section(workflow, start, end);
    assert.match(owner, /MIGRATION_DATABASE_URL/);
    assert.match(owner, /timeout --signal=TERM --kill-after=30s 600s/);
    assert.match(owner, /owner-maintenance\.js|dist\/migrate\.js/);
    assert.doesNotMatch(owner, /RENDER_API_KEY|SESSION_SIGNING_SECRET|secrets\.DATABASE_URL/);
  }
  const staging = section(workflow, '  staging:\n', '\n  production_owner:\n');
  assert.doesNotMatch(staging, /MIGRATION_DATABASE_URL|APP_DATABASE_PASSWORD|RENDER_API_KEY/);
  assert.match(staging, /127\.0\.0\.1:3000:3000/);
  assert.match(staging, /\/health\/ready/);
  const smoke = section(workflow, '  smoke:\n', '\n  evidence:\n');
  assert.doesNotMatch(smoke, /DATABASE_URL|PASSWORD|SIGNING_SECRET|RENDER_API_KEY|secrets\./);
  assert.match(smoke, /RENDER_ORIGIN: \$\{\{ needs\.deploy\.outputs\.origin \}\}/);
  assert.match(workflow, /origin: \$\{\{ steps\.deployment\.outputs\.origin \}\}/);
  assert.match(smoke, /public-smoke\.mjs/);
  assert.match(browser, /context\.route\('\*\*\/\*'/);
  assert.match(browser, /forwardHostedRoute\(route, hostedOrigin\)/);
  assert.doesNotMatch(browser, /\broute\.fetch\s*\(/);
});

test('hosted browser forwarding enforces origin, redirects, normal TLS and fixed failure errors', () => {
  const boundary = section(
    browserTransport,
    'const target = new URL(request.url());',
    'const headers = await request.allHeaders();',
  );
  assert.match(boundary, /target\.origin !== origin/);
  assert.match(boundary, /!\['http:', 'https:'\]\.includes\(target\.protocol\)/);
  assert.match(boundary, /target\.username \|\|\s*target\.password/);
  assert.match(boundary, /throw new HostedRouteFailure\('origin'\)/);
  assert.match(browserTransport, /headers\['host'\] = target\.host/);

  // Native HTTP(S) never follows redirects. A redirect response must still
  // fail explicitly rather than being fulfilled into a browser navigation.
  assert.match(browserTransport, /import \{ request as requestHttp \} from 'node:http'/);
  assert.match(browserTransport, /import \{ request as requestHttps \} from 'node:https'/);
  assert.match(
    browserTransport,
    /if \(\[301, 302, 303, 307, 308\]\.includes\(status\)\) \{\s*fail\('redirect'\);\s*incoming\.destroy\(\);\s*forwarded\.destroy\(\);\s*return;/,
  );
  assert.doesNotMatch(browserTransport, /\bfetch\s*\(/);
  assert.match(
    browserTransport,
    /transport\(target, \{ method: request\.method\(\), headers \},/,
  );
  assert.doesNotMatch(
    browserTransport,
    /rejectUnauthorized|checkServerIdentity|secureContext|NODE_TLS_REJECT_UNAUTHORIZED|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE|SSL_CERT_DIR|\b(?:ca|cert|key|agent|lookup|servername|secureOptions)\s*:/,
  );

  assert.match(browserTransport, /super\(`Hosted browser request failed \(\$\{kind\}\)\.`\)/);
  const failure = section(browserTransport, '  } catch (error) {');
  assert.match(failure, /error instanceof HostedRouteFailure \? error\.kind : 'transport'/);
  assert.match(failure, /await route\.abort\('failed'\)/);
  assert.match(failure, /throw new HostedRouteFailure\(kind\)/);
  assert.doesNotMatch(failure, /throw error|error\.(?:message|stack|cause)|\bcause\s*:|console\./);

  // These loopback fixtures execute the real helper in the existing quality
  // gate, proving that both redirect classes make exactly one HTTP request.
  assert.match(ci, /run: pnpm test:quality/);
  assert.match(browserTransportTests, /it\.each\(\['\/next', 'http:\/\/127\.0\.0\.1:1\/forbidden'\]\)/);
  assert.match(browserTransportTests, /await expect\(forwardHostedRoute\(fixture\.route, origin\)\)\.rejects/);
  assert.match(browserTransportTests, /expect\(requests\)\.toBe\(1\)/);
  assert.match(browserTransportTests, /expect\(fixture\.fulfill\)\.not\.toHaveBeenCalled\(\)/);
});

test('public egress probes use the DNS hostname with default TLS, no redirects and a finite budget', () => {
  for (const probe of [proxyProbe, publicSmoke]) {
    assert.match(
      probe,
      /globalThis\.fetch\('https:\/\/www\.cloudflare\.com\/cdn-cgi\/trace', \{\s*redirect: 'error',\s*signal: globalThis\.AbortSignal\.timeout\(20_000\),?\s*\}\)/,
    );
    assert.match(probe, /assert\.equal\((?:trace|response)\.status, 200/);
    assert.match(probe, /assert\(isIP\(expectedClientIp \?\? ''\)/);
    assert.doesNotMatch(
      probe,
      /https:\/\/1\.1\.1\.1\/cdn-cgi\/trace|rejectUnauthorized|checkServerIdentity|NODE_TLS_REJECT_UNAUTHORIZED|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE|SSL_CERT_DIR/,
    );
  }
});

test('reset runs a fixed current-image command with only owner URL and expected target', () => {
  assert.match(reset, /cron: ["']17 2 \* \* \*["']/);
  assert.match(reset, /RESET SYNTHETIC PRODUCTION DEMO/);
  assert.match(reset, /current-render-image\.mjs/);
  assert.match(reset, /fetch-release\.mjs/);
  const owner = section(reset, '  reset:\n');
  assert.match(owner, /owner-maintenance\.js reset/);
  assert.match(owner, /STAGING_NEON_HOST/);
  assert.doesNotMatch(
    owner,
    /APP_DATABASE_PASSWORD|SESSION_SIGNING_SECRET|RENDER_API_KEY|db:seed|owner-maintenance\.js seed/,
  );
  assert.doesNotMatch(reset, /trap.*(?:open|reopen)|suspend/);
});

test('GCP IaC activation is replaced while local database, browser, security and performance gates stay', () => {
  assert.match(ci, /infra\/render\/check-contract\.mjs/);
  assert.doesNotMatch(ci, /infra\/terraform\/scripts\/\*\.test\.mjs/);
  assert.doesNotMatch(ci, /terraform -chdir=.*(?:plan|apply|init)/);
  for (const name of [
    'Clean container startup',
    'Dependency and secret security',
    'Representative performance profile',
  ])
    assert(ci.includes(name));
  assert.match(ci, /postgres:18\.6/);
});

test('every external action is pinned and active workflows contain no GCP identity', () => {
  for (const text of [ci, release, workflow, reset, rollback]) {
    const uses = [...text.matchAll(/^\s*(?:- )?uses:\s*(\S+)/gm)].map((match) => match[1]);
    assert(uses.length);
    for (const action of uses)
      if (!action.startsWith('./'))
        assert.match(action, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[0-9a-f]{40}$/);
    assert.doesNotMatch(text, /id-token: write|google-github-actions|GCP_|gcloud/);
  }
});
