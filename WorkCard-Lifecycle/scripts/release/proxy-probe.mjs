import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

const [origin, sourceSha, mode, output] = process.argv.slice(2);
assert(
  process.argv.length === 6 &&
    /^https:\/\/[a-z0-9-]+\.onrender\.com$/.test(origin ?? '') &&
    /^[0-9a-f]{40}$/.test(sourceSha ?? '') &&
    ['observe', 'proxy-only'].includes(mode),
);
for (const name of [
  'DATABASE_URL',
  'MIGRATION_DATABASE_URL',
  'APP_DATABASE_PASSWORD',
  'SESSION_SIGNING_SECRET',
  'RENDER_API_KEY',
])
  assert(!process.env[name], `Proxy probe cannot receive ${name}.`);
const startedAt = new Date().toISOString();
const requestIds = [];
const markers = {
  body: `BODY_${randomUUID()}`,
  header: `HEADER_${randomUUID()}`,
  query: `QUERY_${randomUUID()}`,
  spoofedIps: ['192.0.2.11', '192.0.2.12', '192.0.2.13'],
};
// Use Cloudflare's documented hostname so HTTPS includes its normal TLS SNI.
const trace = await globalThis.fetch('https://www.cloudflare.com/cdn-cgi/trace', {
  redirect: 'error',
  signal: globalThis.AbortSignal.timeout(20_000),
});
assert.equal(trace.status, 200);
const expectedClientIp = (await trace.text())
  .split('\n')
  .find((line) => line.startsWith('ip='))
  ?.slice(3);
assert(isIP(expectedClientIp ?? ''));
for (const ip of markers.spoofedIps) {
  const response = await globalThis.fetch(`${origin}/health/live?probe=${markers.query}`, {
    redirect: 'error',
    signal: globalThis.AbortSignal.timeout(30_000),
    headers: {
      'X-Forwarded-For': ip,
      'X-Forwarded-Proto': 'http',
      'X-Smoke-Marker': markers.header,
    },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
  const id = response.headers.get('x-request-id');
  assert(/^[0-9a-f-]{36}$/.test(id ?? ''));
  assert(!requestIds.includes(id));
  requestIds.push(id);
}
for (const path of ['/health/ready', '/api/v1/demo-users']) {
  const response = await globalThis.fetch(`${origin}${path}`, {
    redirect: 'error',
    signal: globalThis.AbortSignal.timeout(30_000),
  });
  assert.equal(
    response.status,
    503,
    'Initial proxy qualification requires the API gate to remain closed.',
  );
}
await mkdir(dirname(resolve(output)), { recursive: true });
await writeFile(
  output,
  `${JSON.stringify({ schemaVersion: 2, mode, platform: 'render', sourceSha, origin, expectedClientIp, startedAt, completedAt: new Date().toISOString(), status: 'passed', apiGate: 'closed', checks: ['proxy-header-spoof-probes', 'api-and-readiness-closed'], markers, requestIds }, null, 2)}\n`,
  { flag: 'wx' },
);
