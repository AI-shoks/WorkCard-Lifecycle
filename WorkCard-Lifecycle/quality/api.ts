import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { buildApp } from '../apps/api/src/app.js';
import { demoUsers } from '../apps/api/src/demo-fixtures.js';
import type { TestDatabase } from './database.js';

export const origin = 'http://quality.test';
export async function testApi(db: TestDatabase) {
  const app = await buildApp({
    appVersion: 'quality',
    pool: db.runtime,
    readiness: { check: async () => ({ database: 'up', migrationVersion: 3 }) },
    security: { allowedOrigin: origin, cookieSecure: false, signingSecret: randomUUID() },
  });
  const sessions = new Map<string, { cookie: string; csrfToken: string }>();
  for (const user of demoUsers) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/demo-session',
      headers: { origin },
      payload: { demoUserId: user.id },
    });
    assert.equal(response.statusCode, 201);
    sessions.set(user.roleCode, {
      cookie: String(response.headers['set-cookie']).split(';')[0]!,
      csrfToken: response.json().csrfToken,
    });
  }
  const headers = (role: string) => {
    const session = sessions.get(role);
    assert(session);
    return { origin, cookie: session.cookie, 'x-csrf-token': session.csrfToken };
  };
  const post = (role: string, url: string, payload: object) =>
    app.inject({ method: 'POST', url: `/api/v1${url}`, headers: headers(role), payload });
  const get = (role: string, url: string) =>
    app.inject({ method: 'GET', url: `/api/v1${url}`, headers: headers(role) });
  return { app, sessions, headers, post, get };
}
