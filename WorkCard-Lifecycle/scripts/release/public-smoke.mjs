import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { isIP } from 'node:net';
import { fileURLToPath } from 'node:url';
import { probeHostedSurface } from './hosted-smoke.mjs';
import { validateReleaseManifest } from './validate-release-manifest.mjs';

export function browserEnvironment(environment, origin) {
  // Allowlist rather than trying to enumerate every possible owner/provider secret.
  const result = {};
  for (const name of [
    'PATH',
    'HOME',
    'TMPDIR',
    'TEMP',
    'TMP',
    'SYSTEMROOT',
    'CI',
    'PLAYWRIGHT_BROWSERS_PATH',
  ]) {
    if (environment[name]) result[name] = environment[name];
  }
  return {
    ...result,
    QUALITY_BASE_URL: origin,
    QUALITY_HOSTED: '1',
    QUALITY_PUBLIC_HOSTED: '1',
    QUALITY_CANONICAL: '1',
  };
}

async function browserRunner(origin) {
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(
        new globalThis.URL('../../node_modules/@playwright/test/cli.js', import.meta.url),
      ),
      'test',
      'quality/browser/lifecycle.spec.ts',
      '--project=desktop',
    ],
    { stdio: 'inherit', env: browserEnvironment(process.env, origin) },
  );
  const code = await new Promise((done, fail) => {
    child.once('error', fail);
    child.once('exit', done);
  });
  assert.equal(code, 0, 'Canonical browser lifecycle failed.');
}

async function main() {
  const [manifestPath, origin, platform, output] = process.argv.slice(2);
  assert.equal(
    process.argv.length,
    6,
    'Usage: public-smoke.mjs MANIFEST ORIGIN local|render OUTPUT',
  );
  assert(['local', 'render'].includes(platform));
  for (const name of Object.keys(process.env)) {
    if (
      /^(?:MIGRATION_DATABASE_URL|DATABASE_URL|QUALITY_OWNER_URL|QUALITY_READ_URL|APP_DATABASE_PASSWORD|SESSION_SIGNING_SECRET|RENDER_API_KEY)$/.test(
        name,
      )
    )
      assert(!process.env[name], `Smoke process must not receive ${name}.`);
  }
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  await validateReleaseManifest(manifest);
  assert.equal(manifest.schemaVersion, 2);
  const startedAt = new Date().toISOString();
  // Free workspaces do not expose platform HTTP request logs. Independently
  // establish the runner's egress address; never infer a real client from XFF.
  let expectedClientIp;
  if (platform === 'render') {
    const response = await globalThis.fetch('https://1.1.1.1/cdn-cgi/trace', {
      redirect: 'error',
      signal: globalThis.AbortSignal.timeout(20_000),
    });
    assert.equal(response.status, 200, 'Cannot independently determine smoke runner egress.');
    expectedClientIp = (await response.text())
      .split('\n')
      .find((line) => line.startsWith('ip='))
      ?.slice(3);
    assert(isIP(expectedClientIp ?? ''), 'Egress trace did not return an IP address.');
  }
  const result = await probeHostedSurface({ origin, platform, browserRunner });
  const report = {
    schemaVersion: 2,
    sourceSha: manifest.sourceSha,
    immutableImage: manifest.immutableImage,
    platform,
    origin,
    startedAt,
    completedAt: new Date().toISOString(),
    status: 'passed',
    ...(expectedClientIp ? { expectedClientIp } : {}),
    ...result,
  };
  await mkdir(dirname(resolve(output)), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
