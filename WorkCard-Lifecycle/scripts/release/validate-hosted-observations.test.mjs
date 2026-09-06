import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

import { validateHostedObservations } from './validate-hosted-observations.mjs';

const sourceSha = 'a'.repeat(40);
const immutableImage = `europe-west1-docker.pkg.dev/work-card-release/work-card/work-card@sha256:${'b'.repeat(64)}`;
const revision = 'work-card-app-smoke-123';
const requestIds = [randomUUID(), randomUUID()];
const traces = ['1'.repeat(32), '2'.repeat(32)];
const smokeReport = {
  $schema: '../../scripts/release/hosted-smoke-report.schema.json',
  schemaVersion: 1,
  startedAt: '2026-09-06T10:00:00Z',
  completedAt: '2026-09-06T10:05:00Z',
  sourceSha,
  immutableImage,
  revision,
  origin: 'https://work-card-app-example.europe-west1.run.app',
  status: 'passed',
  checks: ['resolved-image'],
  requestIds,
  assets: ['/assets/app.css', '/assets/app.js'],
  sessionRateLimit: { limitedStatus: 429, successfulSessionAttempts: 2 },
  redactionMarkers: {
    body: `SMOKE_BODY_${randomUUID()}`,
    header: `SMOKE_HEADER_${randomUUID()}`,
    query: `SMOKE_QUERY_${randomUUID()}`,
    spoofedIps: ['192.0.2.1', '192.0.2.2', '192.0.2.3'],
  },
};

function containerLogs() {
  return requestIds.map((requestId, index) => ({
    severity: index === 0 ? 'INFO' : 'WARNING',
    jsonPayload: {
      appVersion: sourceSha,
      message: 'request completed',
      remoteIp: '203.0.113.20',
      requestId,
      revision,
      service: 'work-card-app',
      status: index === 0 ? 200 : 403,
      traceId: traces[index],
    },
  }));
}

function requestLogs() {
  return traces.map((traceId, index) => ({
    httpRequest: { remoteIp: '203.0.113.20', status: index === 0 ? 200 : 403 },
    trace: `projects/work-card-staging/traces/${traceId}`,
  }));
}

test('correlates safe application logs with platform request logs', async () => {
  const result = await validateHostedObservations(smokeReport, containerLogs(), requestLogs());
  assert.equal(result.status, 'passed');
  assert.equal(result.correlatedRequests, 2);
  assert.deepEqual(result.observedSeverities, ['INFO', 'WARNING']);
});

test('rejects leaked markers, spoofed IPs and missing trace correlation', async (context) => {
  await context.test('redaction marker', async () => {
    const logs = containerLogs();
    logs[0].jsonPayload.body = smokeReport.redactionMarkers.body;
    await assert.rejects(
      validateHostedObservations(smokeReport, logs, requestLogs()),
      /redaction marker/,
    );
  });

  await context.test('spoofed forwarded IP', async () => {
    const logs = containerLogs();
    logs[0].jsonPayload.remoteIp = smokeReport.redactionMarkers.spoofedIps[0];
    const requests = requestLogs();
    requests[0].httpRequest.remoteIp = smokeReport.redactionMarkers.spoofedIps[0];
    await assert.rejects(
      validateHostedObservations(smokeReport, logs, requests),
      /spoofed X-Forwarded-For/,
    );
  });

  await context.test('missing platform trace', async () => {
    await assert.rejects(
      validateHostedObservations(smokeReport, containerLogs(), requestLogs().slice(1)),
      /не уникален/,
    );
  });
});
