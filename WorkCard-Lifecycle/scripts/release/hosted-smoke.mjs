import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { clearInterval, setInterval } from 'node:timers';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import { validateReleaseManifest } from './validate-release-manifest.mjs';

const forbiddenCredentialNames = [
  'APP_DATABASE_PASSWORD',
  'APP_DATABASE_USER',
  'CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE',
  'DATABASE_URL',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_GHA_CREDS_PATH',
  'GCP_RELEASE_DEPLOYER_SERVICE_ACCOUNT',
  'HOSTED_SMOKE_ID_TOKEN',
  'INTEGRATION_DATABASE_URL',
  'INTEGRATION_MIGRATION_DATABASE_URL',
  'MIGRATION_DATABASE_URL',
  'PGDATABASE',
  'PGHOST',
  'PGPASSWORD',
  'PGPORT',
  'PGUSER',
  'QUALITY_OWNER_URL',
  'QUALITY_READ_URL',
];
const imagePattern =
  /^europe-west1-docker\.pkg\.dev\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/work-card\/work-card@sha256:[0-9a-f]{64}$/;
const revisionPattern = /^[a-z][a-z0-9-]{0,62}$/;
const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const jwtPattern = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const reportSchemaReference = '../../scripts/release/hosted-smoke-report.schema.json';
const reportSchemaPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'hosted-smoke-report.schema.json',
);
let reportValidatorPromise;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseOptions(arguments_) {
  const allowed = new Set([
    '--manifest',
    '--origin',
    '--output',
    '--revision',
    '--revision-metadata',
    '--service-account',
    '--workload-identity-provider',
  ]);
  const options = new Map();
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (!allowed.has(name) || value === undefined || value.startsWith('--') || options.has(name)) {
      throw new Error(`Некорректный аргумент hosted smoke: ${name ?? '<missing>'}`);
    }
    options.set(name, value);
  }
  for (const required of allowed) {
    if (!options.has(required)) throw new Error(`Обязательный аргумент ${required} отсутствует.`);
  }
  return options;
}

export function assertCredentialBoundary(environment = process.env) {
  const present = forbiddenCredentialNames.filter((name) => Boolean(environment[name]?.trim()));
  if (present.length > 0) {
    throw new Error(
      `Hosted smoke запрещает injected DB/owner/cloud credentials: ${present.join(', ')}.`,
    );
  }
}

function parseJsonWebToken(token) {
  if (!jwtPattern.test(token)) throw new Error('Smoke identity token не является JWT.');
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    if (!isRecord(payload)) throw new Error('JWT payload is not an object.');
    return payload;
  } catch {
    throw new Error('Smoke identity token содержит некорректный JWT payload.');
  }
}

export function validateSmokeIdentityToken(
  token,
  { audience, now = Date.now(), serviceAccount },
) {
  const payload = parseJsonWebToken(token);
  const nowSeconds = Math.floor(now / 1000);
  if (payload.iss !== 'https://accounts.google.com') {
    throw new Error('Smoke identity token имеет неожиданного issuer.');
  }
  if (payload.aud !== audience) {
    throw new Error('Smoke identity token не привязан к exact staging origin.');
  }
  if (payload.email !== serviceAccount || payload.email_verified !== true) {
    throw new Error('Smoke identity token не привязан к smoke-only service account.');
  }
  if (
    !Number.isInteger(payload.iat) ||
    !Number.isInteger(payload.exp) ||
    payload.iat > nowSeconds + 60 ||
    payload.exp <= nowSeconds + 60 ||
    payload.exp <= payload.iat ||
    payload.exp - payload.iat > 65 * 60
  ) {
    throw new Error('Smoke identity token имеет небезопасный или истёкший lifetime.');
  }
  return { expiresAt: payload.exp * 1000 };
}

async function jsonResult(response, operation) {
  if (!response.ok) throw new Error(`${operation} вернул HTTP ${response.status}.`);
  try {
    const result = await response.json();
    if (!isRecord(result)) throw new Error('JSON response is not an object.');
    return result;
  } catch {
    throw new Error(`${operation} вернул некорректный JSON.`);
  }
}

export function createSmokeTokenProvider({
  audience,
  environment = process.env,
  fetchImplementation = globalThis.fetch,
  now = Date.now,
  serviceAccount,
  workloadIdentityProvider,
}) {
  if (!/^https:\/\/[a-z0-9.-]+\.run\.app$/.test(audience)) {
    throw new Error('Smoke token audience должен быть canonical staging origin.');
  }
  if (!/^work-card-smoke@[a-z][a-z0-9-]{4,28}[a-z0-9]\.iam\.gserviceaccount\.com$/.test(serviceAccount)) {
    throw new Error('Smoke token target не является ожидаемой smoke-only service account.');
  }
  if (
    !/^projects\/[1-9][0-9]*\/locations\/global\/workloadIdentityPools\/github-deployment\/providers\/work-card-deploy$/.test(
      workloadIdentityProvider,
    )
  ) {
    throw new Error('Smoke token provider не совпадает с deployment WIF boundary.');
  }

  const requestToken = environment['ACTIONS_ID_TOKEN_REQUEST_TOKEN'];
  const requestUrlValue = environment['ACTIONS_ID_TOKEN_REQUEST_URL'];
  if (!requestToken || /\s/.test(requestToken) || !requestUrlValue) {
    throw new Error('GitHub OIDC token source недоступен для hosted smoke.');
  }
  const requestUrl = new globalThis.URL(requestUrlValue);
  if (
    requestUrl.protocol !== 'https:' ||
    (requestUrl.hostname !== 'actions.githubusercontent.com' &&
      !requestUrl.hostname.endsWith('.actions.githubusercontent.com'))
  ) {
    throw new Error('GitHub OIDC token source имеет неожиданный origin.');
  }
  requestUrl.searchParams.set(
    'audience',
    `https://iam.googleapis.com/${workloadIdentityProvider}`,
  );

  let cached;
  let refreshPromise;
  async function mintToken() {
    const githubOidc = await jsonResult(
      await fetchWithTimeout(fetchImplementation, requestUrl, {
        headers: { Authorization: `Bearer ${requestToken}` },
      }),
      'GitHub OIDC exchange',
    );
    if (typeof githubOidc.value !== 'string' || !jwtPattern.test(githubOidc.value)) {
      throw new Error('GitHub OIDC exchange не вернул JWT.');
    }

    const parameters = new globalThis.URLSearchParams({
      audience: `//iam.googleapis.com/${workloadIdentityProvider}`,
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      subject_token: githubOidc.value,
      subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
    });
    const federated = await jsonResult(
      await fetchWithTimeout(fetchImplementation, 'https://sts.googleapis.com/v1/token', {
        body: parameters.toString(),
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        method: 'POST',
      }),
      'Google STS exchange',
    );
    if (
      typeof federated.access_token !== 'string' ||
      !federated.access_token ||
      /\s/.test(federated.access_token)
    ) {
      throw new Error('Google STS exchange не вернул access token.');
    }

    const generated = await jsonResult(
      await fetchWithTimeout(
        fetchImplementation,
        `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${serviceAccount}:generateIdToken`,
        {
          body: JSON.stringify({ audience, includeEmail: true }),
          headers: {
            Authorization: `Bearer ${federated.access_token}`,
            'Content-Type': 'application/json',
          },
          method: 'POST',
        },
      ),
      'Google IAM ID token exchange',
    );
    if (typeof generated.token !== 'string') {
      throw new Error('Google IAM ID token exchange не вернул token.');
    }
    const { expiresAt } = validateSmokeIdentityToken(generated.token, {
      audience,
      now: now(),
      serviceAccount,
    });
    return { expiresAt, token: generated.token };
  }

  return {
    async getToken() {
      if (cached && cached.expiresAt > now() + 2 * 60_000) return cached.token;
      if (!refreshPromise) {
        refreshPromise = mintToken()
          .then((result) => {
            cached = result;
            return result.token;
          })
          .finally(() => {
            refreshPromise = undefined;
          });
      }
      return refreshPromise;
    },
  };
}

export async function validateHostedSmokeReport(report) {
  if (!reportValidatorPromise) {
    reportValidatorPromise = (async () => {
      const ajv = new Ajv2020({ allErrors: true, strict: true });
      addFormats(ajv);
      return ajv.compile(JSON.parse(await readFile(reportSchemaPath, 'utf8')));
    })();
  }
  const validator = await reportValidatorPromise;
  if (!validator(report)) {
    const details = (validator.errors ?? [])
      .map((error) => `${error.instancePath || '/'} ${error.message}`)
      .join('; ');
    throw new Error(`Hosted smoke report не соответствует JSON Schema: ${details}.`);
  }
  return report;
}

function resourceName(value) {
  if (typeof value !== 'string') return null;
  return value.split('/').filter(Boolean).at(-1) ?? null;
}

function revisionContainers(metadata) {
  const candidates = [
    metadata.containers,
    metadata.spec?.containers,
    metadata.template?.containers,
    metadata.spec?.template?.spec?.containers,
  ];
  return candidates.find(Array.isArray) ?? [];
}

function envValue(container, name) {
  const entry = Array.isArray(container?.env)
    ? container.env.find((candidate) => candidate?.name === name)
    : undefined;
  return typeof entry?.value === 'string' ? entry.value : null;
}

function secretReference(entry) {
  const reference = entry?.valueSource?.secretKeyRef ?? entry?.valueFrom?.secretKeyRef;
  if (!reference) return null;
  return {
    secret: resourceName(reference.secret ?? reference.name),
    version: String(reference.version ?? reference.key ?? ''),
  };
}

function revisionVolumes(metadata) {
  const candidates = [
    metadata.volumes,
    metadata.spec?.volumes,
    metadata.template?.volumes,
    metadata.spec?.template?.spec?.volumes,
  ];
  return candidates.find(Array.isArray) ?? [];
}

function cloudSqlInstances(metadata) {
  const volumes = revisionVolumes(metadata).flatMap(
    (volume) => volume?.cloudSqlInstance?.instances ?? [],
  );
  if (volumes.length > 0) return volumes;
  const annotations = metadata.annotations ?? metadata.metadata?.annotations;
  const annotation = annotations?.['run.googleapis.com/cloudsql-instances'];
  return typeof annotation === 'string'
    ? annotation
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
    : [];
}

function readyCondition(metadata) {
  const conditions = metadata.conditions ?? metadata.status?.conditions ?? [];
  if (!Array.isArray(conditions)) return null;
  return conditions.find((condition) => condition?.type === 'Ready') ?? null;
}

export function validateRevisionBinding(metadata, manifest, expectedRevision, expectations = {}) {
  if (!isRecord(metadata)) throw new Error('Cloud Run revision metadata должен быть JSON object.');
  if (!revisionPattern.test(expectedRevision)) throw new Error('Некорректное имя staging revision.');
  if (!imagePattern.test(manifest.immutableImage)) throw new Error('Manifest image не является exact digest.');

  const actualName = resourceName(metadata.metadata?.name ?? metadata.name);
  if (actualName !== expectedRevision) {
    throw new Error(`Cloud Run metadata относится не к revision ${expectedRevision}.`);
  }

  const containers = revisionContainers(metadata);
  if (containers.length !== 1 || containers[0]?.name !== 'app') {
    throw new Error('Staging revision должна содержать ровно один container app.');
  }
  if (containers[0].image !== manifest.immutableImage) {
    throw new Error('Resolved staging revision image не совпадает с release manifest digest.');
  }
  const container = containers[0];
  assert.deepEqual(container.command, ['node'], 'Staging revision command должен быть node.');
  assert.deepEqual(container.args, ['dist/server.js'], 'Staging revision args изменились.');

  const environment = Array.isArray(container.env) ? container.env : [];
  const environmentNames = environment.map((entry) => entry?.name);
  const expectedEnvironmentNames = [
    'APP_ENV',
    'APP_ORIGIN',
    'APP_VERSION',
    'DATABASE_URL',
    'DEMO_MAX_BATCHES',
    'DEMO_MAX_SESSIONS',
    'HOST',
    'LOG_LEVEL',
    'PROXY_TRUST_MODE',
    'SESSION_SIGNING_SECRET',
    'WEB_DIST_PATH',
  ];
  assert.deepEqual(
    [...environmentNames].sort(),
    expectedEnvironmentNames,
    'Staging revision env boundary изменилась или содержит owner credential.',
  );
  if (new Set(environmentNames).size !== environmentNames.length) {
    throw new Error('Staging revision содержит повторяющийся env name.');
  }

  const plainEnvironment = {
    APP_ENV: 'staging',
    APP_ORIGIN: expectations.origin,
    APP_VERSION: manifest.sourceSha,
    DEMO_MAX_BATCHES: '20',
    DEMO_MAX_SESSIONS: '500',
    HOST: '0.0.0.0',
    LOG_LEVEL: 'info',
    PROXY_TRUST_MODE: 'cloud-run',
    WEB_DIST_PATH: '/opt/work-card/public',
  };
  for (const [name, expected] of Object.entries(plainEnvironment)) {
    const actual = envValue(container, name);
    if (name === 'APP_ORIGIN' && expected === undefined) {
      if (!/^https:\/\/[a-z0-9.-]+\.run\.app$/.test(actual ?? '')) {
        throw new Error('Staging revision APP_ORIGIN не является canonical run.app origin.');
      }
    } else if (actual !== expected) {
      throw new Error(`Staging revision ${name} имеет неожиданное значение.`);
    }
  }
  if (envValue(container, 'APP_VERSION') !== manifest.sourceSha) {
    throw new Error('Staging revision APP_VERSION не совпадает с source SHA.');
  }

  const runtimeSecrets = {
    DATABASE_URL: ['work-card-database-url', expectations.secretVersions?.databaseUrl],
    SESSION_SIGNING_SECRET: [
      'work-card-session-signing-secret',
      expectations.secretVersions?.sessionSigningSecret,
    ],
  };
  for (const [name, [expectedSecret, expectedVersion]] of Object.entries(runtimeSecrets)) {
    const entry = environment.find((candidate) => candidate?.name === name);
    const reference = secretReference(entry);
    if (!reference || reference.secret !== expectedSecret || !/^[1-9][0-9]*$/.test(reference.version)) {
      throw new Error(`Staging revision ${name} не закреплён на ожидаемый numeric secret ref.`);
    }
    if (expectedVersion !== undefined && reference.version !== String(expectedVersion)) {
      throw new Error(`Staging revision ${name} использует неожиданную secret version.`);
    }
  }

  if (expectations.project) {
    const serviceAccount =
      metadata.serviceAccount ??
      metadata.serviceAccountName ??
      metadata.spec?.serviceAccount ??
      metadata.spec?.serviceAccountName;
    if (serviceAccount !== `work-card-app@${expectations.project}.iam.gserviceaccount.com`) {
      throw new Error('Staging revision использует неожиданную runtime service account.');
    }
    assert.deepEqual(cloudSqlInstances(metadata), [
      `${expectations.project}:europe-west1:work-card-staging`,
    ]);
    const volumeMounts = container.volumeMounts ?? [];
    if (revisionVolumes(metadata).length > 0) {
      assert.deepEqual(volumeMounts, [{ mountPath: '/cloudsql', name: 'cloudsql' }]);
    } else if (volumeMounts.length > 0) {
      assert.deepEqual(volumeMounts, [{ mountPath: '/cloudsql', name: 'cloudsql' }]);
    }
  }

  const sourceLabel = metadata.labels?.['source-sha'] ?? metadata.metadata?.labels?.['source-sha'];
  if (sourceLabel !== manifest.sourceSha) {
    throw new Error('Staging revision source-sha label не совпадает с release manifest.');
  }

  const condition = readyCondition(metadata);
  const ready = condition?.status === 'True' || condition?.state === 'CONDITION_SUCCEEDED';
  if (!ready || metadata.reconciling === true || metadata.status?.observedGeneration === '0') {
    throw new Error('Staging revision не подтверждена Cloud Run как Ready.');
  }

  return {
    immutableImage: manifest.immutableImage,
    revision: expectedRevision,
    sourceSha: manifest.sourceSha,
  };
}

function authenticatedHeaders(idToken, additions = {}) {
  return {
    'X-Serverless-Authorization': `Bearer ${idToken}`,
    ...additions,
  };
}

async function readResponse(response) {
  const body = await response.text();
  let json = null;
  if (body) {
    try {
      json = JSON.parse(body);
    } catch {
      // Some successful surface responses are HTML, CSS or JavaScript.
    }
  }
  return { body, json, response };
}

function requestIdFrom(response, requestIds) {
  const requestId = response.headers.get('x-request-id');
  if (!requestIdPattern.test(requestId ?? '')) {
    throw new Error('Hosted response не содержит серверный UUID X-Request-Id.');
  }
  if (requestIds.has(requestId)) {
    throw new Error(`Hosted response повторил X-Request-Id ${requestId}.`);
  }
  requestIds.add(requestId);
  return requestId;
}

async function fetchWithTimeout(fetchImplementation, url, init = {}) {
  return fetchImplementation(url, {
    ...init,
    redirect: init.redirect ?? 'error',
    signal: globalThis.AbortSignal.timeout(20_000),
  });
}

function assertProblem(result, expectedStatus, expectedCode) {
  assert.equal(result.response.status, expectedStatus, result.body);
  assert.equal(result.json?.status, expectedStatus);
  assert.equal(result.json?.code, expectedCode);
}

function localAssets(html, origin) {
  const matches = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map((match) => match[1]);
  const assets = new Set();
  for (const value of matches) {
    const url = new globalThis.URL(value, origin);
    if (url.origin === origin && /\.(?:css|js)$/.test(url.pathname)) assets.add(url.pathname);
  }
  return [...assets].sort((left, right) => left.localeCompare(right, 'en'));
}

async function createSession(fetchImplementation, origin, tokenProvider, demoUserId, requestIds) {
  const result = await readResponse(
    await fetchWithTimeout(fetchImplementation, `${origin}/api/v1/demo-session`, {
      body: JSON.stringify({ demoUserId }),
      headers: authenticatedHeaders(await tokenProvider.getToken(), {
        'Content-Type': 'application/json',
        Origin: origin,
      }),
      method: 'POST',
    }),
  );
  assert.equal(result.response.status, 201, result.body);
  requestIdFrom(result.response, requestIds);
  const cookie = result.response.headers.get('set-cookie')?.split(';')[0];
  assert(cookie, 'Hosted demo session не вернула cookie.');
  assert.equal(typeof result.json?.csrfToken, 'string');
  return { cookie, csrfToken: result.json.csrfToken };
}

async function listBatchIds(fetchImplementation, origin, tokenProvider, cookie, requestIds) {
  const result = await readResponse(
    await fetchWithTimeout(fetchImplementation, `${origin}/api/v1/production-batches?limit=100`, {
      headers: authenticatedHeaders(await tokenProvider.getToken(), { Cookie: cookie }),
    }),
  );
  assert.equal(result.response.status, 200, result.body);
  requestIdFrom(result.response, requestIds);
  assert(Array.isArray(result.json?.items), 'Hosted batch list не содержит items.');
  return result.json.items.map((item) => item.id).sort();
}

async function deleteSession(fetchImplementation, origin, tokenProvider, session, requestIds) {
  const response = await fetchWithTimeout(fetchImplementation, `${origin}/api/v1/demo-session`, {
    headers: authenticatedHeaders(await tokenProvider.getToken(), {
      Cookie: session.cookie,
      Origin: origin,
      'X-CSRF-Token': session.csrfToken,
    }),
    method: 'DELETE',
  });
  assert.equal(response.status, 204, await response.text());
  requestIdFrom(response, requestIds);
}

export async function probeHostedSurface({
  fetchImplementation = globalThis.fetch,
  idToken,
  origin,
  runBrowser = true,
  tokenProvider,
}) {
  const parsedOrigin = new globalThis.URL(origin);
  if (
    parsedOrigin.protocol !== 'https:' ||
    parsedOrigin.origin !== origin ||
    !/^[a-z0-9.-]+\.run\.app$/.test(parsedOrigin.hostname)
  ) {
    throw new Error('Hosted smoke origin должен быть canonical HTTPS *.run.app без path.');
  }
  if (!tokenProvider) {
    if (!idToken || /\s/.test(idToken)) {
      throw new Error('Hosted smoke ID token отсутствует или повреждён.');
    }
    tokenProvider = { getToken: async () => idToken };
  }
  if (typeof tokenProvider.getToken !== 'function') {
    throw new Error('Hosted smoke token provider некорректен.');
  }

  const checks = new Set();
  const requestIds = new Set();
  const markers = {
    body: `SMOKE_BODY_${randomUUID()}`,
    header: `SMOKE_HEADER_${randomUUID()}`,
    query: `SMOKE_QUERY_${randomUUID()}`,
    spoofedIps: ['192.0.2.11', '192.0.2.12', '192.0.2.13'],
  };

  const anonymous = await fetchWithTimeout(fetchImplementation, `${origin}/health/live`, {
    redirect: 'manual',
  });
  if (![401, 403].includes(anonymous.status)) {
    throw new Error(`Private staging IAM probe получил неожиданный status ${anonymous.status}.`);
  }
  checks.add('private-iam-denial');

  for (const path of ['/health/live', '/health/ready']) {
    const result = await readResponse(
      await fetchWithTimeout(fetchImplementation, `${origin}${path}`, {
        headers: authenticatedHeaders(await tokenProvider.getToken()),
      }),
    );
    assert.equal(result.response.status, 200, result.body);
    assert.deepEqual(result.json, { status: 'ok' });
    assert.match(result.response.headers.get('content-type') ?? '', /^application\/json\b/i);
    requestIdFrom(result.response, requestIds);
  }
  checks.add('sanitized-health');
  checks.add('runtime-database-readiness');

  const root = await readResponse(
    await fetchWithTimeout(fetchImplementation, `${origin}/`, {
      headers: authenticatedHeaders(await tokenProvider.getToken()),
    }),
  );
  assert.equal(root.response.status, 200, root.body);
  assert.match(root.response.headers.get('content-type') ?? '', /^text\/html\b/i);
  assert.match(root.response.headers.get('strict-transport-security') ?? '', /max-age=/i);
  assert.match(root.response.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
  assert.equal(root.response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(root.response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(
    root.response.headers.get('permissions-policy'),
    'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
  );
  requestIdFrom(root.response, requestIds);
  checks.add('tls-and-security-headers');

  const assets = localAssets(root.body, origin);
  assert(assets.some((path) => path.endsWith('.js')), 'SPA root не содержит JavaScript asset.');
  assert(assets.some((path) => path.endsWith('.css')), 'SPA root не содержит CSS asset.');
  for (const path of assets) {
    const response = await fetchWithTimeout(fetchImplementation, `${origin}${path}`, {
      headers: authenticatedHeaders(await tokenProvider.getToken()),
    });
    assert.equal(response.status, 200, `${path}: ${await response.text()}`);
    const contentType = response.headers.get('content-type') ?? '';
    if (path.endsWith('.js')) assert.match(contentType, /^(?:text|application)\/javascript\b/i);
    if (path.endsWith('.css')) assert.match(contentType, /^text\/css\b/i);
    requestIdFrom(response, requestIds);
  }
  checks.add('root-and-static-assets');

  const usersResult = await readResponse(
    await fetchWithTimeout(fetchImplementation, `${origin}/api/v1/demo-users`, {
      headers: authenticatedHeaders(await tokenProvider.getToken()),
    }),
  );
  assert.equal(usersResult.response.status, 200, usersResult.body);
  requestIdFrom(usersResult.response, requestIds);
  const users = usersResult.json?.items;
  assert(Array.isArray(users), 'Hosted demo users не содержат items.');
  const planner = users.find((user) => user.role === 'PLANNER');
  const worker = users.find((user) => user.role === 'WORKER');
  assert(planner?.id && worker?.id, 'Hosted fixtures не содержат planner и worker.');

  const passportsResult = await readResponse(
    await fetchWithTimeout(fetchImplementation, `${origin}/api/v1/production-passports`, {
      headers: authenticatedHeaders(await tokenProvider.getToken()),
    }),
  );
  assertProblem(passportsResult, 401, 'AUTHENTICATION_REQUIRED');
  requestIdFrom(passportsResult.response, requestIds);

  const plannerSession = await createSession(
    fetchImplementation,
    origin,
    tokenProvider,
    planner.id,
    requestIds,
  );
  const workerSession = await createSession(
    fetchImplementation,
    origin,
    tokenProvider,
    worker.id,
    requestIds,
  );
  try {
    const before = await listBatchIds(
      fetchImplementation,
      origin,
      tokenProvider,
      plannerSession.cookie,
      requestIds,
    );
    const passportResult = await readResponse(
      await fetchWithTimeout(fetchImplementation, `${origin}/api/v1/production-passports`, {
        headers: authenticatedHeaders(await tokenProvider.getToken(), {
          Cookie: plannerSession.cookie,
        }),
      }),
    );
    assert.equal(passportResult.response.status, 200, passportResult.body);
    requestIdFrom(passportResult.response, requestIds);
    const passportId = passportResult.json?.items?.[0]?.id;
    assert.equal(typeof passportId, 'string');
    const body = {
      commandId: randomUUID(),
      productionPassportId: passportId,
      quantity: 112,
    };

    const rejectedOrigin = await readResponse(
      await fetchWithTimeout(
        fetchImplementation,
        `${origin}/api/v1/production-batches?smoke=${encodeURIComponent(markers.query)}`,
        {
          body: JSON.stringify(body),
          headers: authenticatedHeaders(await tokenProvider.getToken(), {
            'Content-Type': 'application/json',
            Cookie: plannerSession.cookie,
            Origin: 'https://invalid.example',
            'X-CSRF-Token': plannerSession.csrfToken,
            'X-Forwarded-For': markers.spoofedIps[0],
            'X-Smoke-Marker': markers.header,
          }),
          method: 'POST',
        },
      ),
    );
    assertProblem(rejectedOrigin, 403, 'ACTION_FORBIDDEN');
    requestIdFrom(rejectedOrigin.response, requestIds);

    const rejectedCsrf = await readResponse(
      await fetchWithTimeout(fetchImplementation, `${origin}/api/v1/production-batches`, {
        body: JSON.stringify(body),
        headers: authenticatedHeaders(await tokenProvider.getToken(), {
          'Content-Type': 'application/json',
          Cookie: plannerSession.cookie,
          Origin: origin,
          'X-CSRF-Token': markers.body,
          'X-Forwarded-For': markers.spoofedIps[1],
        }),
        method: 'POST',
      }),
    );
    assertProblem(rejectedCsrf, 403, 'ACTION_FORBIDDEN');
    requestIdFrom(rejectedCsrf.response, requestIds);

    const rejectedRole = await readResponse(
      await fetchWithTimeout(fetchImplementation, `${origin}/api/v1/production-batches`, {
        body: JSON.stringify({ ...body, sql: markers.body }),
        headers: authenticatedHeaders(await tokenProvider.getToken(), {
          'Content-Type': 'application/json',
          Cookie: workerSession.cookie,
          Origin: origin,
          'X-CSRF-Token': workerSession.csrfToken,
          'X-Forwarded-For': markers.spoofedIps[2],
        }),
        method: 'POST',
      }),
    );
    assertProblem(rejectedRole, 403, 'ACTION_FORBIDDEN');
    requestIdFrom(rejectedRole.response, requestIds);

    const after = await listBatchIds(
      fetchImplementation,
      origin,
      tokenProvider,
      plannerSession.cookie,
      requestIds,
    );
    assert.deepEqual(after, before, 'Негативные hosted probes изменили список партий.');
    checks.add('origin-csrf-permission-no-side-effect');
    checks.add('proxy-spoof-markers');
  } finally {
    await Promise.all([
      deleteSession(fetchImplementation, origin, tokenProvider, plannerSession, requestIds),
      deleteSession(fetchImplementation, origin, tokenProvider, workerSession, requestIds),
    ]);
  }

  // Exercise the browser before deliberately exhausting the session rate-limit
  // bucket. The runner and Chromium normally share one egress IP, so reversing
  // this order would make the canonical browser fail at its first role login.
  if (runBrowser) {
    await runCanonicalBrowser(origin, tokenProvider);
    checks.add('canonical-browser-112-3-250');
    checks.add('three-first-article-gates');
    checks.add('250-of-250-closed');
    checks.add('final-acceptance');
    checks.add('audit-254-of-254');
    checks.add('payroll-read-back');
  }

  let currentSession = null;
  let successfulSessionAttempts = 0;
  let limitedStatus = null;
  try {
    for (let index = 0; index < 31; index += 1) {
      const result = await readResponse(
        await fetchWithTimeout(fetchImplementation, `${origin}/api/v1/demo-session`, {
          body: JSON.stringify({ demoUserId: planner.id }),
          headers: authenticatedHeaders(await tokenProvider.getToken(), {
            'Content-Type': 'application/json',
            ...(currentSession ? { Cookie: currentSession.cookie } : {}),
            Origin: origin,
            'X-Forwarded-For': `192.0.2.${100 + index}`,
          }),
          method: 'POST',
        }),
      );
      requestIdFrom(result.response, requestIds);
      if (result.response.status === 429) {
        limitedStatus = 429;
        break;
      }
      assert.equal(result.response.status, 201, result.body);
      successfulSessionAttempts += 1;
      const cookie = result.response.headers.get('set-cookie')?.split(';')[0];
      assert(cookie && typeof result.json?.csrfToken === 'string');
      currentSession = { cookie, csrfToken: result.json.csrfToken };
    }
    assert.equal(limitedStatus, 429, 'Varying spoofed X-Forwarded-For bypassed session rate limit.');
    assert(successfulSessionAttempts > 0, 'Session rate-limit probe не выполнил ни одного запроса.');
    checks.add('cloud-run-proxy-rate-limit-key');
  } finally {
    if (currentSession) {
      await deleteSession(fetchImplementation, origin, tokenProvider, currentSession, requestIds);
    }
  }

  return {
    assets,
    checks: [...checks],
    markers,
    requestIds: [...requestIds],
    sessionRateLimit: { limitedStatus, successfulSessionAttempts },
  };
}

async function writeTokenFile(tokenPath, token) {
  const pendingPath = `${tokenPath}.${randomUUID()}.tmp`;
  await writeFile(pendingPath, `${token}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  await rename(pendingPath, tokenPath);
}

async function runCanonicalBrowser(origin, tokenProvider) {
  const playwrightCli = fileURLToPath(
    new globalThis.URL('../../node_modules/@playwright/test/cli.js', import.meta.url),
  );
  const tokenDirectory = await mkdtemp(resolve(tmpdir(), 'work-card-hosted-smoke-'));
  const tokenPath = resolve(tokenDirectory, 'id-token');
  let refreshFailure;
  let refreshInProgress;
  const refreshTokenFile = async () => {
    if (!refreshInProgress) {
      refreshInProgress = tokenProvider
        .getToken()
        .then((token) => writeTokenFile(tokenPath, token))
        .catch((error) => {
          refreshFailure = error;
        })
        .finally(() => {
          refreshInProgress = undefined;
        });
    }
    await refreshInProgress;
  };

  await refreshTokenFile();
  if (refreshFailure) {
    await rm(tokenDirectory, { force: true, recursive: true });
    throw refreshFailure;
  }
  const refreshTimer = setInterval(refreshTokenFile, 30_000);
  const childEnvironment = { ...process.env };
  for (const name of [
    ...forbiddenCredentialNames,
    'ACTIONS_ID_TOKEN_REQUEST_TOKEN',
    'ACTIONS_ID_TOKEN_REQUEST_URL',
  ]) {
    delete childEnvironment[name];
  }
  Object.assign(childEnvironment, {
    HOSTED_SMOKE_ID_TOKEN_FILE: tokenPath,
    QUALITY_BASE_URL: origin,
    QUALITY_CANONICAL: '1',
    QUALITY_HOSTED: '1',
  });

  try {
    const child = spawn(
      process.execPath,
      [
        playwrightCli,
        'test',
        'quality/browser/lifecycle.spec.ts',
        '--config=playwright.config.ts',
        '--project=desktop',
      ],
      {
        cwd: resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'),
        env: childEnvironment,
        stdio: 'inherit',
      },
    );
    const exitCode = await new Promise((resolveExit, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => resolveExit(code ?? 1));
    });
    await refreshInProgress;
    if (refreshFailure) throw refreshFailure;
    if (exitCode !== 0) {
      throw new Error(`Hosted canonical browser завершился с code ${exitCode}.`);
    }
  } finally {
    clearInterval(refreshTimer);
    await refreshInProgress;
    await rm(tokenDirectory, { force: true, recursive: true });
  }
}

function safeFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replaceAll(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED_TOKEN]')
    .replaceAll(/Bearer\s+\S+/gi, 'Bearer [REDACTED_TOKEN]')
    .replaceAll(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[REDACTED_DATABASE_URL]')
    .slice(0, 1000);
}

async function runCli() {
  const options = parseOptions(process.argv.slice(2));
  assertCredentialBoundary();

  const manifestPath = resolve(options.get('--manifest'));
  const metadataPath = resolve(options.get('--revision-metadata'));
  const outputPath = resolve(options.get('--output'));
  const origin = options.get('--origin');
  const revision = options.get('--revision');
  const tokenProvider = createSmokeTokenProvider({
    audience: origin,
    serviceAccount: options.get('--service-account'),
    workloadIdentityProvider: options.get('--workload-identity-provider'),
  });
  const startedAt = new Date().toISOString();
  let report;

  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    await validateReleaseManifest(manifest);
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
    const binding = validateRevisionBinding(metadata, manifest, revision, { origin });
    const surface = await probeHostedSurface({ origin, tokenProvider });
    report = {
      $schema: reportSchemaReference,
      schemaVersion: 1,
      startedAt,
      completedAt: new Date().toISOString(),
      sourceSha: binding.sourceSha,
      immutableImage: binding.immutableImage,
      revision: binding.revision,
      origin,
      status: 'passed',
      checks: ['resolved-image', ...surface.checks],
      requestIds: surface.requestIds,
      assets: surface.assets,
      sessionRateLimit: surface.sessionRateLimit,
      redactionMarkers: surface.markers,
    };
  } catch (error) {
    report = {
      $schema: reportSchemaReference,
      schemaVersion: 1,
      startedAt,
      completedAt: new Date().toISOString(),
      origin,
      revision,
      status: 'failed',
      failure: safeFailure(error),
    };
  }

  await validateHostedSmokeReport(report);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  if (report.status !== 'passed') throw new Error(report.failure);
  process.stdout.write(`${outputPath}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runCli();
}
