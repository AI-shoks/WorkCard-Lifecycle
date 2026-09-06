import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { validateHostedSmokeReport } from './hosted-smoke.mjs';

const allowedSeverities = new Set([
  'ALERT',
  'CRITICAL',
  'DEBUG',
  'DEFAULT',
  'EMERGENCY',
  'ERROR',
  'INFO',
  'NOTICE',
  'WARNING',
]);
const traceIdPattern = /^[0-9a-f]{32}$/;

function parseOptions(arguments_) {
  const allowed = new Set(['--container-logs', '--output', '--request-logs', '--smoke-report']);
  const options = new Map();
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (!allowed.has(name) || value === undefined || value.startsWith('--') || options.has(name)) {
      throw new Error(`Некорректный аргумент hosted observations: ${name ?? '<missing>'}`);
    }
    options.set(name, value);
  }
  for (const required of allowed) {
    if (!options.has(required)) throw new Error(`Обязательный аргумент ${required} отсутствует.`);
  }
  return options;
}

async function readJson(path, label) {
  const value = JSON.parse(await readFile(resolve(path), 'utf8'));
  if (value === null || typeof value !== 'object') throw new Error(`${label} должен быть JSON.`);
  return value;
}

function traceIdFromRequestLog(entry) {
  const trace = entry?.trace;
  if (typeof trace !== 'string') return null;
  const traceId = trace.split('/').at(-1);
  return traceIdPattern.test(traceId ?? '') ? traceId : null;
}

function normalizedIp(value) {
  if (typeof value !== 'string') return null;
  if (/^\[[0-9a-f:]+\]:[0-9]+$/i.test(value)) return value.slice(1, value.lastIndexOf(']'));
  if (/^\d{1,3}(?:\.\d{1,3}){3}:[0-9]+$/.test(value)) return value.slice(0, value.lastIndexOf(':'));
  return value;
}

export async function validateHostedObservations(smokeReport, containerLogs, requestLogs) {
  await validateHostedSmokeReport(smokeReport);
  if (smokeReport.status !== 'passed') throw new Error('Нельзя принять logs для failed smoke.');
  assert(Array.isArray(containerLogs), 'Cloud Run container logs должны быть массивом.');
  assert(Array.isArray(requestLogs), 'Cloud Run request logs должны быть массивом.');

  const serializedContainerLogs = JSON.stringify(containerLogs);
  const forbiddenMarkers = [
    smokeReport.redactionMarkers.body,
    smokeReport.redactionMarkers.header,
    smokeReport.redactionMarkers.query,
    'postgresql://',
    'MIGRATION_DATABASE_URL',
    'DATABASE_URL',
  ];
  for (const marker of forbiddenMarkers) {
    if (serializedContainerLogs.includes(marker)) {
      throw new Error(`Container logs содержат запрещённый redaction marker: ${marker}.`);
    }
  }

  const completionsByRequestId = new Map();
  for (const entry of containerLogs) {
    const payload = entry?.jsonPayload;
    if (payload?.message !== 'request completed' || typeof payload.requestId !== 'string') continue;
    if (completionsByRequestId.has(payload.requestId)) {
      throw new Error(`Cloud Logging содержит повторный completion для ${payload.requestId}.`);
    }
    completionsByRequestId.set(payload.requestId, { entry, payload });
  }

  const observedSeverities = new Set();
  let correlatedRequests = 0;
  for (const requestId of smokeReport.requestIds) {
    const completion = completionsByRequestId.get(requestId);
    assert(completion, `Cloud Logging не содержит completion для request ${requestId}.`);
    const { entry, payload } = completion;
    const severity = entry.severity ?? payload.severity;
    assert(allowedSeverities.has(severity), `Некорректный severity для ${requestId}.`);
    assert.equal(payload.appVersion, smokeReport.sourceSha);
    assert.equal(payload.revision, smokeReport.revision);
    assert.equal(payload.service, 'work-card-app');
    assert.equal(typeof payload.remoteIp, 'string');
    assert(traceIdPattern.test(payload.traceId ?? ''), `Нет trusted traceId для ${requestId}.`);
    observedSeverities.add(severity);

    const matchingRequestLogs = requestLogs.filter(
      (entry) => traceIdFromRequestLog(entry) === payload.traceId,
    );
    assert.equal(matchingRequestLogs.length, 1, `Trace ${payload.traceId} не уникален в request logs.`);
    const platformRequest = matchingRequestLogs[0].httpRequest;
    assert(platformRequest, `Trace ${payload.traceId} не содержит httpRequest.`);
    assert.equal(Number(platformRequest.status), Number(payload.status));
    assert.equal(normalizedIp(platformRequest.remoteIp), normalizedIp(payload.remoteIp));
    assert(
      !smokeReport.redactionMarkers.spoofedIps.includes(normalizedIp(payload.remoteIp)),
      'Application remoteIp доверился spoofed X-Forwarded-For.',
    );
    correlatedRequests += 1;
  }

  assert(observedSeverities.has('INFO'), 'Hosted logs не содержат INFO для успешных probes.');
  assert(observedSeverities.has('WARNING'), 'Hosted logs не содержат WARNING для negative probes.');

  return {
    schemaVersion: 1,
    sourceSha: smokeReport.sourceSha,
    immutableImage: smokeReport.immutableImage,
    revision: smokeReport.revision,
    status: 'passed',
    checks: [
      'cloud-logging-severity',
      'container-log-redaction',
      'cloud-run-proxy-trace-correlation',
    ],
    correlatedRequests,
    observedSeverities: [...observedSeverities].sort(),
  };
}

async function runCli() {
  const options = parseOptions(process.argv.slice(2));
  const smokeReport = await readJson(options.get('--smoke-report'), 'Hosted smoke report');
  const containerLogs = await readJson(options.get('--container-logs'), 'Container logs');
  const requestLogs = await readJson(options.get('--request-logs'), 'Request logs');
  const summary = await validateHostedObservations(smokeReport, containerLogs, requestLogs);
  const output = resolve(options.get('--output'));
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(summary, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  process.stdout.write(`${output}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runCli();
}
