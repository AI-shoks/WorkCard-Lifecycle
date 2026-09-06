import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

import {
  assertCredentialBoundary,
  createSmokeTokenProvider,
  probeHostedSurface,
  validateHostedSmokeReport,
  validateRevisionBinding,
  validateSmokeIdentityToken,
} from './hosted-smoke.mjs';

const sourceSha = 'a'.repeat(40);
const immutableImage = `europe-west1-docker.pkg.dev/work-card-release/work-card/work-card@sha256:${'b'.repeat(64)}`;
const revision = 'work-card-app-smoke-123';
const origin = 'https://work-card-app-example.europe-west1.run.app';
const project = 'work-card-staging';
const manifest = { immutableImage, sourceSha };

function revisionMetadata(overrides = {}) {
  return {
    metadata: {
      labels: { 'source-sha': sourceSha },
      name: revision,
    },
    spec: {
      containers: [
        {
          args: ['dist/server.js'],
          command: ['node'],
          env: [
            { name: 'APP_ENV', value: 'staging' },
            { name: 'APP_ORIGIN', value: origin },
            { name: 'APP_VERSION', value: sourceSha },
            {
              name: 'DATABASE_URL',
              valueFrom: {
                secretKeyRef: { key: '2', name: 'work-card-database-url' },
              },
            },
            { name: 'DEMO_MAX_BATCHES', value: '20' },
            { name: 'DEMO_MAX_SESSIONS', value: '500' },
            { name: 'HOST', value: '0.0.0.0' },
            { name: 'LOG_LEVEL', value: 'info' },
            { name: 'PROXY_TRUST_MODE', value: 'cloud-run' },
            {
              name: 'SESSION_SIGNING_SECRET',
              valueFrom: {
                secretKeyRef: { key: '5', name: 'work-card-session-signing-secret' },
              },
            },
            { name: 'WEB_DIST_PATH', value: '/opt/work-card/public' },
          ],
          image: immutableImage,
          name: 'app',
          volumeMounts: [{ mountPath: '/cloudsql', name: 'cloudsql' }],
        },
      ],
      serviceAccountName: `work-card-app@${project}.iam.gserviceaccount.com`,
      volumes: [
        { cloudSqlInstance: { instances: [`${project}:europe-west1:work-card-staging`] } },
      ],
    },
    status: { conditions: [{ status: 'True', type: 'Ready' }] },
    ...overrides,
  };
}

function jsonResponse(value, status = 200, extraHeaders = {}) {
  return new globalThis.Response(JSON.stringify(value), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'x-request-id': randomUUID(),
      ...extraHeaders,
    },
    status,
  });
}

function unsignedToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.signature`;
}

function hostedFetch() {
  let rateAttempts = 0;
  let sessionNumber = 0;
  return async (input, init = {}) => {
    const url = new globalThis.URL(String(input));
    const headers = new globalThis.Headers(init.headers);
    const authenticated = headers.has('x-serverless-authorization');
    const method = init.method ?? 'GET';
    if (!authenticated) return new globalThis.Response('Forbidden', { status: 403 });

    if (url.pathname === '/health/live' || url.pathname === '/health/ready') {
      return jsonResponse({ status: 'ok' });
    }
    if (url.pathname === '/') {
      return new globalThis.Response(
        '<!doctype html><link rel="stylesheet" href="/assets/app.css"><script src="/assets/app.js"></script>',
        {
          headers: {
            'content-security-policy': "default-src 'self'; frame-ancestors 'none'",
            'content-type': 'text/html; charset=utf-8',
            'permissions-policy': 'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
            'referrer-policy': 'no-referrer',
            'strict-transport-security': 'max-age=31536000; includeSubDomains',
            'x-content-type-options': 'nosniff',
            'x-request-id': randomUUID(),
          },
        },
      );
    }
    if (url.pathname === '/assets/app.js') {
      return new globalThis.Response('export {};', {
        headers: { 'content-type': 'text/javascript', 'x-request-id': randomUUID() },
      });
    }
    if (url.pathname === '/assets/app.css') {
      return new globalThis.Response('body {}', {
        headers: { 'content-type': 'text/css', 'x-request-id': randomUUID() },
      });
    }
    if (url.pathname === '/api/v1/demo-users') {
      return jsonResponse({
        items: [
          { id: randomUUID(), role: 'PLANNER' },
          { id: randomUUID(), role: 'WORKER' },
        ],
      });
    }
    if (url.pathname === '/api/v1/production-passports' && !headers.has('cookie')) {
      return jsonResponse(
        { code: 'AUTHENTICATION_REQUIRED', status: 401 },
        401,
      );
    }
    if (url.pathname === '/api/v1/production-passports') {
      return jsonResponse({ items: [{ id: randomUUID() }] });
    }
    if (url.pathname === '/api/v1/production-batches' && method === 'GET') {
      return jsonResponse({ items: [], nextCursor: null });
    }
    if (url.pathname === '/api/v1/production-batches') {
      return jsonResponse({ code: 'ACTION_FORBIDDEN', status: 403 }, 403);
    }
    if (url.pathname === '/api/v1/demo-session' && method === 'DELETE') {
      return new globalThis.Response(null, {
        headers: { 'x-request-id': randomUUID() },
        status: 204,
      });
    }
    if (url.pathname === '/api/v1/demo-session' && method === 'POST') {
      const isRateProbe = headers.has('x-forwarded-for') && Number(headers.get('x-forwarded-for')?.split('.').at(-1)) >= 100;
      if (isRateProbe) {
        rateAttempts += 1;
        if (rateAttempts === 3) {
          return jsonResponse({ code: 'TOO_MANY_REQUESTS', status: 429 }, 429);
        }
      }
      sessionNumber += 1;
      return jsonResponse(
        { csrfToken: `csrf-token-${sessionNumber}-${'x'.repeat(32)}` },
        201,
        { 'set-cookie': `work_card_demo=session-${sessionNumber}; Path=/; HttpOnly` },
      );
    }
    throw new Error(`Unexpected hosted request: ${method} ${url.pathname}`);
  };
}

test('enforces a smoke process with no database or owner credential', () => {
  assert.doesNotThrow(() => assertCredentialBoundary({}));
  assert.throws(
    () => assertCredentialBoundary({ DATABASE_URL: 'postgresql://runtime' }),
    /DB\/owner\/cloud credentials: DATABASE_URL/,
  );
  assert.throws(
    () => assertCredentialBoundary({ QUALITY_OWNER_URL: 'postgresql://owner' }),
    /QUALITY_OWNER_URL/,
  );
  assert.throws(
    () => assertCredentialBoundary({ HOSTED_SMOKE_ID_TOKEN: 'injected-token' }),
    /HOSTED_SMOKE_ID_TOKEN/,
  );
});

test('refreshes an exact-audience smoke identity token through GitHub WIF', async () => {
  let currentTime = Date.parse('2026-09-06T10:00:00Z');
  let githubExchanges = 0;
  const serviceAccount = 'work-card-smoke@work-card-release.iam.gserviceaccount.com';
  const workloadIdentityProvider =
    'projects/123456789/locations/global/workloadIdentityPools/github-deployment/providers/work-card-deploy';
  const fetchImplementation = async (input, init = {}) => {
    const url = new globalThis.URL(String(input));
    if (url.hostname.endsWith('.actions.githubusercontent.com')) {
      githubExchanges += 1;
      assert.equal(
        url.searchParams.get('audience'),
        `https://iam.googleapis.com/${workloadIdentityProvider}`,
      );
      assert.equal(init.headers.Authorization, 'Bearer github-request-token');
      return jsonResponse({ value: 'github.payload.signature' });
    }
    if (url.href === 'https://sts.googleapis.com/v1/token') {
      const parameters = new globalThis.URLSearchParams(init.body);
      assert.equal(parameters.get('audience'), `//iam.googleapis.com/${workloadIdentityProvider}`);
      assert.equal(parameters.get('subject_token'), 'github.payload.signature');
      return jsonResponse({ access_token: `federated-${githubExchanges}` });
    }
    if (url.hostname === 'iamcredentials.googleapis.com') {
      assert.equal(init.headers.Authorization, `Bearer federated-${githubExchanges}`);
      assert.deepEqual(JSON.parse(init.body), { audience: origin, includeEmail: true });
      const issuedAt = Math.floor(currentTime / 1000);
      return jsonResponse({
        token: unsignedToken({
          aud: origin,
          email: serviceAccount,
          email_verified: true,
          exp: issuedAt + 10 * 60,
          iat: issuedAt,
          iss: 'https://accounts.google.com',
        }),
      });
    }
    throw new Error(`Unexpected token endpoint: ${url.href}`);
  };
  const provider = createSmokeTokenProvider({
    audience: origin,
    environment: {
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'github-request-token',
      ACTIONS_ID_TOKEN_REQUEST_URL: 'https://runner.actions.githubusercontent.com/id-token',
    },
    fetchImplementation,
    now: () => currentTime,
    serviceAccount,
    workloadIdentityProvider,
  });

  const first = await provider.getToken();
  assert.equal(await provider.getToken(), first);
  assert.equal(githubExchanges, 1);
  currentTime += 9 * 60_000;
  const refreshed = await provider.getToken();
  assert.notEqual(refreshed, first);
  assert.equal(githubExchanges, 2);
  assert.throws(
    () =>
      validateSmokeIdentityToken(refreshed, {
        audience: 'https://other.example.run.app',
        now: currentTime,
        serviceAccount,
      }),
    /exact staging origin/,
  );
});

test('binds Ready Cloud Run revision metadata to the manifest exact digest and source SHA', () => {
  assert.deepEqual(
    validateRevisionBinding(revisionMetadata(), manifest, revision, {
      origin,
      project,
      secretVersions: { databaseUrl: 2, sessionSigningSecret: 5 },
    }),
    {
      immutableImage,
      revision,
      sourceSha,
    },
  );

  const v1Metadata = revisionMetadata();
  delete v1Metadata.spec.volumes;
  delete v1Metadata.spec.containers[0].volumeMounts;
  v1Metadata.metadata.annotations = {
    'run.googleapis.com/cloudsql-instances': `${project}:europe-west1:work-card-staging`,
  };
  assert.doesNotThrow(() =>
    validateRevisionBinding(v1Metadata, manifest, revision, {
      origin,
      project,
      secretVersions: { databaseUrl: 2, sessionSigningSecret: 5 },
    }),
  );

  const wrongDigest = revisionMetadata();
  wrongDigest.spec.containers[0].image = `${immutableImage.slice(0, -64)}${'c'.repeat(64)}`;
  assert.throws(
    () => validateRevisionBinding(wrongDigest, manifest, revision),
    /Resolved staging revision image/,
  );

  assert.throws(
    () =>
      validateRevisionBinding(
        revisionMetadata({ status: { conditions: [{ status: 'False', type: 'Ready' }] } }),
        manifest,
        revision,
      ),
    /не подтверждена.*Ready/,
  );

  const ownerCredential = revisionMetadata();
  ownerCredential.spec.containers[0].env.push({
    name: 'MIGRATION_DATABASE_URL',
    value: 'postgresql://owner',
  });
  assert.throws(
    () => validateRevisionBinding(ownerCredential, manifest, revision),
    /env boundary.*owner credential/,
  );

  const plainDatabaseUrl = revisionMetadata();
  plainDatabaseUrl.spec.containers[0].env.find((entry) => entry.name === 'DATABASE_URL').valueFrom =
    undefined;
  plainDatabaseUrl.spec.containers[0].env.find((entry) => entry.name === 'DATABASE_URL').value =
    'postgresql://runtime';
  assert.throws(
    () => validateRevisionBinding(plainDatabaseUrl, manifest, revision),
    /DATABASE_URL.*numeric secret ref/,
  );
});

test('probes private IAM, sanitized HTTPS surface and negative controls without DB access', async () => {
  const result = await probeHostedSurface({
    fetchImplementation: hostedFetch(),
    idToken: 'header.payload.signature',
    origin,
    runBrowser: false,
  });

  assert.deepEqual(result.assets, ['/assets/app.css', '/assets/app.js']);
  assert(result.checks.includes('private-iam-denial'));
  assert(result.checks.includes('origin-csrf-permission-no-side-effect'));
  assert(result.checks.includes('cloud-run-proxy-rate-limit-key'));
  assert(!result.checks.includes('canonical-browser-112-3-250'));
  assert.equal(result.sessionRateLimit.limitedStatus, 429);
  assert.equal(result.sessionRateLimit.successfulSessionAttempts, 2);
  assert(result.requestIds.length >= 15);
});

test('accepts only schema-complete passed hosted reports', async () => {
  const report = {
    $schema: '../../scripts/release/hosted-smoke-report.schema.json',
    schemaVersion: 1,
    startedAt: '2026-09-06T10:00:00Z',
    completedAt: '2026-09-06T10:05:00Z',
    sourceSha,
    immutableImage,
    revision,
    origin,
    status: 'passed',
    checks: ['resolved-image'],
    requestIds: [randomUUID()],
    assets: ['/assets/app.css', '/assets/app.js'],
    sessionRateLimit: { limitedStatus: 429, successfulSessionAttempts: 2 },
    redactionMarkers: {
      body: `SMOKE_BODY_${randomUUID()}`,
      header: `SMOKE_HEADER_${randomUUID()}`,
      query: `SMOKE_QUERY_${randomUUID()}`,
      spoofedIps: ['192.0.2.1', '192.0.2.2', '192.0.2.3'],
    },
  };
  await assert.doesNotReject(validateHostedSmokeReport(report));
  await assert.rejects(validateHostedSmokeReport({ ...report, checks: [] }), /JSON Schema/);
});
