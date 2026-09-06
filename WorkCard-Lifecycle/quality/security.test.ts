import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { demoPassport, demoUsers } from '../apps/api/src/demo-fixtures.js';
import { buildApp } from '../apps/api/src/app.js';
import {
  businessSnapshot,
  isolatedDatabase,
  referenceFixtures,
  type TestDatabase,
} from './database.js';
import { origin, testApi } from './api.js';

let db: TestDatabase;
let api: Awaited<ReturnType<typeof testApi>>;
beforeAll(async () => {
  db = await isolatedDatabase('security');
  await referenceFixtures(db);
  api = await testApi(db);
});
afterAll(async () => {
  await api?.app.close();
  await db?.dispose();
});

it('all command routes enforce trusted role before body/ID validation; audit/payroll reads deny every non-auditor', async () => {
  const routes = [
    ['PLANNER', '/production-batches'],
    ['PLANNER', '/production-batches/not-a-uuid/release'],
    ['MASTER', '/work-card-sets/not-a-uuid/assignments'],
    ['MASTER', '/work-cards/not-a-uuid/start'],
    ['MASTER', '/work-cards/not-a-uuid/complete'],
    ['QUALITY_CONTROLLER', '/work-card-sets/not-a-uuid/first-article-acceptance'],
    ['QUALITY_CONTROLLER', '/work-cards/not-a-uuid/quality-confirmation'],
    ['QUALITY_CONTROLLER', '/production-batches/not-a-uuid/final-acceptance'],
    ['ADMIN_AUDITOR', '/work-cards/not-a-uuid/payroll-export'],
  ] as const;
  const before = await businessSnapshot(db);
  for (const role of api.sessions.keys()) {
    for (const [allowed, path] of routes) {
      if (role === allowed) continue;
      expect(
        (
          await api.post(role, path, {
            commandId: randomUUID(),
            role: allowed,
            actorId: demoUsers[0].id,
          })
        ).statusCode,
      ).toBe(403);
    }
    if (role !== 'ADMIN_AUDITOR')
      for (const path of [
        '/audit-correlations/not-a-uuid',
        '/work-cards/not-a-uuid/history',
        '/work-cards/not-a-uuid/payroll-record',
      ])
        expect((await api.get(role, path)).statusCode).toBe(403);
  }
  expect(await businessSnapshot(db)).toEqual(before);
});

it('session rate limiting returns 429/Retry-After without trusting forwarded IPs or inserting another session', async () => {
  const app = await buildApp({
    appVersion: 'rate-test',
    pool: db.runtime,
    readiness: { check: async () => ({ database: 'up', migrationVersion: 3 }) },
    security: { allowedOrigin: origin, cookieSecure: true, signingSecret: randomUUID() },
  });
  try {
    const before = await businessSnapshot(db);
    const sessionCount = async () =>
      (await db.owner.query('SELECT COUNT(*)::int AS count FROM demo_sessions')).rows[0]
        .count as number;
    const sessionsBefore = await sessionCount();
    for (let index = 0; index < 31; index++) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/demo-session',
        headers: { origin, 'x-forwarded-for': `192.0.2.${index}` },
        payload: { demoUserId: demoUsers[1].id },
      });
      expect(response.statusCode).toBe(index < 30 ? 201 : 429);
      if (index < 30) expect(response.headers['set-cookie']).toContain('; Secure');
      else {
        expect(response.json()).toMatchObject({ code: 'TOO_MANY_REQUESTS' });
        expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
        expect(response.headers['x-request-id']).toBe(response.json().requestId);
        expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
      }
    }
    expect((await app.inject('/health/live')).statusCode).toBe(200);
    expect(await sessionCount()).toBe(sessionsBefore + 30);
    expect(await businessSnapshot(db)).toEqual(before);
  } finally {
    await app.close();
  }
});

it('общий demo-контур отклоняет новую сессию после жёсткого лимита', async () => {
  const sessionsBefore = (
    await db.owner.query('SELECT COUNT(*)::integer AS count FROM demo_sessions')
  ).rows[0].count as number;
  const app = await buildApp({
    appVersion: 'capacity-test',
    demoCapacity: { maximumBatches: 20, maximumSessions: sessionsBefore + 1 },
    pool: db.runtime,
    readiness: { check: async () => ({ database: 'up', migrationVersion: 3 }) },
    security: { allowedOrigin: origin, cookieSecure: true, signingSecret: randomUUID() },
  });
  try {
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/demo-session',
      headers: { origin },
      payload: { demoUserId: demoUsers[0].id },
    });
    expect(first.statusCode).toBe(201);

    const rejected = await app.inject({
      method: 'POST',
      url: '/api/v1/demo-session',
      headers: { origin },
      payload: { demoUserId: demoUsers[1].id },
    });
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json()).toMatchObject({ code: 'DEMO_CAPACITY_REACHED' });
    expect(
      (await db.owner.query('SELECT COUNT(*)::integer AS count FROM demo_sessions')).rows[0].count,
    ).toBe(sessionsBefore + 1);
  } finally {
    await app.close();
  }
});

it('Origin, missing/cross-session CSRF, forged cookie, schema injection and oversized input cannot change business data', async () => {
  const before = await businessSnapshot(db);
  const valid = api.headers('PLANNER');
  const payload = { commandId: randomUUID(), productionPassportId: demoPassport.id, quantity: 112 };
  for (const headers of [
    { cookie: valid.cookie, 'x-csrf-token': valid['x-csrf-token'] },
    { ...valid, origin: 'null' },
    { ...valid, origin: 'http://quality.test.evil.example' },
    { cookie: valid.cookie, origin },
    { ...valid, 'x-csrf-token': api.headers('MASTER')['x-csrf-token'] },
  ])
    expect(
      (
        await api.app.inject({
          method: 'POST',
          url: '/api/v1/production-batches',
          headers,
          payload,
        })
      ).statusCode,
    ).toBe(403);
  expect(
    (
      await api.app.inject({
        method: 'POST',
        url: '/api/v1/production-batches',
        headers: { ...valid, cookie: `${valid.cookie}forged` },
        payload,
      })
    ).statusCode,
  ).toBe(401);
  expect(
    (
      await api.post('PLANNER', '/production-batches', {
        ...payload,
        actorId: demoUsers[1].id,
        role: 'MASTER',
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await api.post('PLANNER', '/production-batches', {
        ...payload,
        quantity: "1'; DROP TABLE work_cards;--",
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (await api.post('PLANNER', '/production-batches', { ...payload, extra: 'x'.repeat(1_048_576) }))
      .statusCode,
  ).toBe(413);
  expect(
    (
      await api.post('MASTER', `/work-card-sets/${randomUUID()}/assignments`, {
        commandId: randomUUID(),
        expectedSetVersion: 1,
        purpose: 'SERIAL',
        assigneeId: demoUsers[2].id,
        cards: Array.from({ length: 251 }, () => ({
          workCardId: randomUUID(),
          expectedVersion: 1,
        })),
      })
    ).statusCode,
  ).toBe(400);
  expect(await businessSnapshot(db)).toEqual(before);
});

it('role rotation invalidates old cookie/token, logout revokes the row, idle/absolute expiry and disabled identity reject access', async () => {
  const before = await businessSnapshot(db);
  async function login(previousCookie?: string) {
    const response = await api.app.inject({
      method: 'POST',
      url: '/api/v1/demo-session',
      headers: { origin, ...(previousCookie ? { cookie: previousCookie } : {}) },
      payload: { demoUserId: demoUsers[0].id },
    });
    expect(response.statusCode).toBe(201);
    const setCookie = String(response.headers['set-cookie']);
    expect(setCookie).toContain('HttpOnly; SameSite=Lax; Max-Age=28800');
    return { cookie: setCookie.split(';')[0]!, token: response.json().csrfToken as string };
  }
  const old = await login();
  const current = await login(old.cookie);
  expect(current.cookie).not.toBe(old.cookie);
  expect(current.token).not.toBe(old.token);
  expect(
    (await api.app.inject({ url: '/api/v1/demo-session', headers: { cookie: old.cookie } }))
      .statusCode,
  ).toBe(401);
  expect(
    (
      await api.app.inject({
        method: 'DELETE',
        url: '/api/v1/demo-session',
        headers: { origin, cookie: current.cookie, 'x-csrf-token': old.token },
      })
    ).statusCode,
  ).toBe(403);
  const logout = await api.app.inject({
    method: 'DELETE',
    url: '/api/v1/demo-session',
    headers: { origin, cookie: current.cookie, 'x-csrf-token': current.token },
  });
  expect(logout.statusCode).toBe(204);
  expect(logout.headers['set-cookie']).toContain('Max-Age=0');
  expect(
    (await api.app.inject({ url: '/api/v1/demo-session', headers: { cookie: current.cookie } }))
      .statusCode,
  ).toBe(401);
  const nearingExpiry = await login();
  const nearingId = nearingExpiry.cookie.split('=')[1]!.split('.')[0]!;
  const absoluteLimit = (
    await db.owner.query(
      `UPDATE demo_sessions SET expires_at=CURRENT_TIMESTAMP+interval '2 minutes',
       idle_expires_at=CURRENT_TIMESTAMP+interval '1 minute' WHERE id=$1 RETURNING expires_at`,
      [nearingId],
    )
  ).rows[0].expires_at;
  expect(
    (
      await api.app.inject({
        url: '/api/v1/demo-session',
        headers: { cookie: nearingExpiry.cookie },
      })
    ).statusCode,
  ).toBe(200);
  const extended = (
    await db.owner.query(
      'SELECT expires_at, idle_expires_at <= expires_at AS bounded FROM demo_sessions WHERE id=$1',
      [nearingId],
    )
  ).rows[0];
  expect(extended.expires_at).toEqual(absoluteLimit);
  expect(extended.bounded).toBe(true);
  for (const column of ['idle_expires_at', 'expires_at']) {
    const session = await login();
    const id = session.cookie.split('=')[1]!.split('.')[0]!;
    await db.owner.query(
      `UPDATE demo_sessions SET created_at=CURRENT_TIMESTAMP-interval '9 hours', last_seen_at=CURRENT_TIMESTAMP-interval '2 minutes', idle_expires_at=CURRENT_TIMESTAMP-interval '1 minute', ${column === 'expires_at' ? "expires_at=CURRENT_TIMESTAMP-interval '1 second'" : "expires_at=CURRENT_TIMESTAMP+interval '1 hour'"} WHERE id=$1`,
      [id],
    );
    expect(
      (await api.app.inject({ url: '/api/v1/demo-session', headers: { cookie: session.cookie } }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await db.owner.query('SELECT COUNT(*)::integer AS count FROM demo_sessions WHERE id=$1', [
          id,
        ])
      ).rows[0].count,
    ).toBe(0);
  }
  const disabled = await login();
  await db.owner.query('UPDATE demo_users SET enabled=false WHERE id=$1', [demoUsers[0].id]);
  expect(
    (await api.app.inject({ url: '/api/v1/demo-session', headers: { cookie: disabled.cookie } }))
      .statusCode,
  ).toBe(401);
  expect(
    (
      await db.owner.query('SELECT COUNT(*)::integer AS count FROM demo_sessions WHERE id=$1', [
        disabled.cookie.split('=')[1]!.split('.')[0]!,
      ])
    ).rows[0].count,
  ).toBe(0);
  expect(await businessSnapshot(db)).toEqual(before);
});
