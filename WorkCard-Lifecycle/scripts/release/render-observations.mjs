import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { BlockList, isIP } from 'node:net';
import { resolve } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const normalizedIp = (value) => (value?.startsWith('::ffff:') ? value.slice(7) : value);
export function validateRenderObservations(report, logs, { serviceId, trustedCidrs }) {
  assert.equal(report.schemaVersion, 2);
  assert.equal(report.platform, 'render');
  assert.equal(report.status, 'passed');
  assert(isIP(report.expectedClientIp ?? ''), 'Independent smoke runner egress IP is required.');
  const discovery = report.mode === 'observe';
  const proxyOnly = report.mode === 'proxy-only';
  if (discovery || proxyOnly) {
    assert.equal(report.apiGate, 'closed');
    assert(report.checks.includes('api-and-readiness-closed'));
    assert(report.checks.includes('proxy-header-spoof-probes'));
  } else assert(report.checks.includes('spoof-resistant-session-rate-limit'));
  assert(Array.isArray(logs) && logs.length > 0);
  const peers = new BlockList();
  if (!discovery)
    assert(trustedCidrs?.length && trustedCidrs.length <= 16, 'Observed proxy allowlist required.');
  for (const cidr of trustedCidrs ?? []) {
    const [ip, bits] = cidr.split('/');
    const family = isIP(ip);
    assert(family && !['0.0.0.0', '::'].includes(ip));
    const prefix = bits === undefined ? (family === 4 ? 32 : 128) : Number(bits);
    assert(
      Number.isInteger(prefix) &&
        prefix >= (family === 4 ? 8 : 32) &&
        prefix <= (family === 4 ? 32 : 128),
    );
    peers.addSubnet(ip, prefix, family === 4 ? 'ipv4' : 'ipv6');
  }
  const serialized = JSON.stringify(logs);
  for (const marker of [
    report.markers.body,
    report.markers.header,
    report.markers.query,
    'postgresql://',
    'postgres://',
    'MIGRATION_DATABASE_URL',
    'DATABASE_URL',
  ]) {
    assert(
      !serialized.includes(marker),
      'Application logs contain a forbidden marker or database material.',
    );
  }
  const completions = new Map();
  for (const entry of logs) {
    const labels = Object.fromEntries(
      (entry.labels ?? []).map((label) => [label.name, label.value]),
    );
    assert.equal(labels.resource, serviceId, 'Unexpected Render log resource.');
    let payload;
    try {
      payload = JSON.parse(entry.message);
    } catch {
      continue;
    }
    if (payload.message !== 'request completed') continue;
    assert(!completions.has(payload.requestId), 'Duplicate application request completion.');
    completions.set(payload.requestId, payload);
  }
  const severities = new Set();
  const revisions = new Set();
  const observedPeers = new Set();
  for (const id of report.requestIds) {
    const entry = completions.get(id);
    assert(entry, `Missing application log for smoke request ${id}.`);
    assert.equal(entry.appVersion, report.sourceSha);
    assert.equal(entry.service, serviceId);
    assert.equal(entry.protocol, discovery ? 'http' : 'https');
    const remoteIp = normalizedIp(entry.remoteIp);
    const remoteAddress = normalizedIp(entry.remoteAddress);
    if (!discovery)
      assert.equal(
        remoteIp,
        normalizedIp(report.expectedClientIp),
        'Application client IP does not match independently observed runner egress.',
      );
    else
      assert.equal(remoteIp, remoteAddress, 'Observation mode must not trust forwarded headers.');
    assert(!report.markers.spoofedIps.includes(remoteIp));
    if (!discovery)
      assert(
        peers.check(remoteAddress, isIP(remoteAddress) === 6 ? 'ipv6' : 'ipv4'),
        'Socket peer is outside the reviewed proxy allowlist.',
      );
    if (!discovery)
      assert.notEqual(remoteIp, remoteAddress, 'Proxy hop was mistaken for the client.');
    assert(['INFO', 'WARNING', 'ERROR'].includes(entry.severity));
    assert(typeof entry.revision === 'string' && entry.revision.startsWith(serviceId));
    severities.add(entry.severity);
    revisions.add(entry.revision);
    observedPeers.add(remoteAddress);
  }
  assert(severities.has('INFO') && (discovery || proxyOnly || severities.has('WARNING')));
  if (discovery)
    return {
      schemaVersion: 2,
      mode: 'observe',
      sourceSha: report.sourceSha,
      serviceId,
      status: 'discovery-only',
      apiGate: 'closed',
      observedPeers: [...observedPeers].sort(),
      instruction:
        'Review these actual peers across bounded cold starts and deploys before configuring a restricted proxy allowlist. This is not hosted qualification.',
    };
  return {
    schemaVersion: 2,
    sourceSha: report.sourceSha,
    immutableImage: report.immutableImage,
    status: 'passed',
    mode: proxyOnly ? 'proxy-only' : 'full',
    serviceId,
    checks: [
      'render-application-log-severity',
      'application-log-redaction',
      'observed-peer-allowlist',
      'independent-client-egress-correlation',
    ],
    correlatedRequests: report.requestIds.length,
    observedInstances: [...revisions].sort(),
    trustedCidrsSha256: `sha256:${createHash('sha256').update(trustedCidrs.join(',')).digest('hex')}`,
  };
}

export async function collectLogs({
  report,
  serviceId,
  ownerId,
  token,
  fetchImplementation = globalThis.fetch,
}) {
  assert(/^srv-[a-z0-9]{20}$/.test(serviceId));
  assert(/^(?:tea|usr)-[a-z0-9]{20}$/.test(ownerId));
  assert(token && !/\s/.test(token));
  const parameters = new globalThis.URLSearchParams({
    ownerId,
    resource: serviceId,
    startTime: report.startedAt,
    endTime: report.completedAt,
    direction: 'forward',
    type: 'app',
    limit: '100',
  });
  const entries = new Map();
  for (let page = 0; page < 200; page++) {
    const response = await fetchImplementation(`https://api.render.com/v1/logs?${parameters}`, {
      redirect: 'error',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: globalThis.AbortSignal.timeout(30_000),
    });
    assert.equal(response.status, 200, 'Render application log collection failed.');
    const value = await response.json();
    assert(Array.isArray(value.logs) && typeof value.hasMore === 'boolean');
    for (const entry of value.logs) entries.set(entry.id, entry);
    if (!value.hasMore) return [...entries.values()];
    assert(value.nextStartTime && value.nextEndTime);
    assert(
      parameters.get('startTime') !== value.nextStartTime ||
        parameters.get('endTime') !== value.nextEndTime,
      'Render log cursor did not advance.',
    );
    parameters.set('startTime', value.nextStartTime);
    parameters.set('endTime', value.nextEndTime);
  }
  throw new Error('Render log collection exceeded its bounded page budget.');
}

async function main() {
  const [reportPath, output] = process.argv.slice(2);
  assert(reportPath && output && process.argv.length === 4);
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  const settings = {
    serviceId: process.env.RENDER_SERVICE_ID,
    ownerId: process.env.RENDER_OWNER_ID,
    token: process.env.RENDER_API_KEY,
    trustedCidrs: process.env.PROXY_TRUSTED_CIDRS?.split(',').map((value) => value.trim()),
  };
  // Bounded release qualification retries only; this is not a keepalive task.
  for (let attempt = 0; attempt < 6; attempt++) {
    const logs = await collectLogs({ report, ...settings });
    try {
      const result = validateRenderObservations(report, logs, settings);
      await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
      return;
    } catch (error) {
      if (attempt === 5) throw error;
      await delay(10_000);
    }
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
