import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { expect, it } from 'vitest';

import { buildApp } from '../apps/api/src/app.js';
import { databaseBudgets } from '../apps/api/src/runtime-protection.js';
import { demoPassport, demoUsers } from '../apps/api/src/demo-fixtures.js';
import { businessSnapshot, isolatedDatabase, referenceFixtures } from './database.js';

it('actual DB budgets bound a blocked command and roll back its receipt; subsequent explicit retry succeeds', async () => {
  const db = await isolatedDatabase('budgets');
  const pool = new Pool({ connectionString: db.runtimeUrl, ...databaseBudgets });
  const app = await buildApp({
    appVersion: 'budgets',
    pool,
    readiness: { check: async () => ({ database: 'up', migrationVersion: 3 }) },
    security: {
      allowedOrigin: 'http://budget.test',
      cookieSecure: false,
      signingSecret: randomUUID(),
    },
  });
  try {
    await referenceFixtures(db);
    for (const [setting, value] of Object.entries({
      statement_timeout: '10s',
      lock_timeout: '3s',
      transaction_timeout: '15s',
      idle_in_transaction_session_timeout: '15s',
    })) {
      expect((await pool.query(`SHOW ${setting}`)).rows[0][setting]).toBe(value);
    }
    const session = await app.inject({
      method: 'POST',
      url: '/api/v1/demo-session',
      headers: { origin: 'http://budget.test' },
      payload: { demoUserId: demoUsers[0].id },
    });
    const headers = {
      origin: 'http://budget.test',
      cookie: String(session.headers['set-cookie']).split(';')[0]!,
      'x-csrf-token': session.json().csrfToken as string,
    };
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/production-batches',
      headers,
      payload: { commandId: randomUUID(), productionPassportId: demoPassport.id, quantity: 112 },
    });
    expect(created.statusCode).toBe(201);
    const id: string = created.json().batch.id;
    const request = {
      method: 'POST' as const,
      url: `/api/v1/production-batches/${id}/release`,
      headers,
      payload: { commandId: randomUUID(), expectedBatchVersion: 1 },
    };
    const before = await businessSnapshot(db);
    const blocker = await db.owner.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM production_batches WHERE id=$1 FOR UPDATE', [id]);
      const started = performance.now();
      const response = await app.inject(request);
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
      expect(performance.now() - started).toBeLessThan(10_000);
      expect(await businessSnapshot(db)).toEqual(before);
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
    }
    expect((await app.inject(request)).statusCode).toBe(200);
  } finally {
    await app.close();
    await pool.end();
    await db.dispose();
  }
});
