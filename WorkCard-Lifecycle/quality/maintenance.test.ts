import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

import { Client } from 'pg';
import { afterEach, expect, it } from 'vitest';

import {
  acquireRuntimeAdmission,
  createRuntimeReader,
  runtimeBarrierKey,
  withRuntimeTransaction,
} from '../apps/api/src/database-gate.js';
import { verifyDatabase } from '../apps/api/src/database-verification.js';
import { demoPassport, demoUsers } from '../apps/api/src/demo-fixtures.js';
import { runMigrations } from '../apps/api/src/migration-runner.js';
import { closeMaintenanceGate, runOwnerOperation } from '../apps/api/src/owner-operations.js';
import { createDatabaseReadiness } from '../apps/api/src/readiness.js';
import { createSessionManager } from '../apps/api/src/session-manager.js';
import { createWorkflowService } from '../apps/api/src/workflow-service.js';
import { isolatedDatabase, type TestDatabase } from './database.js';

const databases: TestDatabase[] = [];
const clients: Client[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.end()));
  for (const db of databases.splice(0)) await db.dispose();
});

async function fixture(bootstrap = true) {
  const db = await isolatedDatabase('maintenance', false, true);
  databases.push(db);
  const client = new Client({ connectionString: db.config.migrationDatabaseUrl });
  clients.push(client);
  await client.connect();
  if (bootstrap)
    await runOwnerOperation(client, 'bootstrap', {
      migrate: () => runMigrations(db.config, undefined, undefined, client),
    });
  return { db, client };
}

function latch() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function waitForAdvisoryWait(db: TestDatabase, pid: number) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await db.owner.query(
      "SELECT 1 FROM pg_locks WHERE pid = $1 AND locktype = 'advisory' AND NOT granted",
      [pid],
    );
    if (result.rowCount === 1) return;
    await delay(10);
  }
  throw new Error('Expected advisory wait did not occur.');
}

it('non-superuser owner bootstraps repeatedly; runtime has no owner privileges and cannot change persistent state', async () => {
  const { db, client } = await fixture();
  expect(
    (
      await client.query(
        'SELECT rolsuper, rolcreaterole FROM pg_roles WHERE rolname = current_user',
      )
    ).rows[0],
  ).toEqual({ rolsuper: false, rolcreaterole: true });
  const initial = (await client.query('SELECT * FROM demo_maintenance_state')).rows[0];
  expect(initial.maintenance).toBe(false);
  expect(initial.last_reset_verified_at).toBeInstanceOf(Date);
  await runOwnerOperation(client, 'bootstrap', {
    migrate: () => runMigrations(db.config, undefined, undefined, client),
  });
  expect(
    (await client.query('SELECT last_reset_verified_at FROM demo_maintenance_state')).rows[0]
      .last_reset_verified_at,
  ).toEqual(initial.last_reset_verified_at);
  await verifyDatabase(client);
  for (const sql of [
    'UPDATE demo_maintenance_state SET maintenance = false',
    'TRUNCATE demo_maintenance_state',
    'DELETE FROM demo_maintenance_state',
    'CREATE TABLE denied_owner_table(id integer)',
    'UPDATE production_passports SET product_name = product_name',
    'TRUNCATE demo_sessions',
  ])
    await expect(db.runtime.query(sql)).rejects.toMatchObject({ code: '42501' });
  expect((await db.runtime.query('SELECT maintenance FROM demo_maintenance_state')).rows).toEqual([
    { maintenance: false },
  ]);
});

it('rejects a previously elevated runtime role before ALTER and leaves its attributes untouched', async () => {
  const { db, client } = await fixture();
  await client.query(`ALTER ROLE "${db.config.appDatabaseUser}" CREATEROLE`);
  await expect(runMigrations(db.config)).rejects.toThrow('недопустимые атрибуты');
  expect(
    (
      await client.query('SELECT rolcreaterole FROM pg_roles WHERE rolname = $1', [
        db.config.appDatabaseUser,
      ])
    ).rows[0],
  ).toEqual({ rolcreaterole: true });
  await client.query(`ALTER ROLE "${db.config.appDatabaseUser}" NOCREATEROLE`);
  await client.query(`GRANT CREATE ON SCHEMA public TO "${db.config.appDatabaseUser}"`);
  await db.runtime.query('CREATE TABLE ownership_probe(id integer)');
  await client.query(`REVOKE CREATE ON SCHEMA public FROM "${db.config.appDatabaseUser}"`);
  await expect(runMigrations(db.config)).rejects.toThrow('ownership');
  await db.runtime.query('DROP TABLE ownership_probe');
  const group = `${db.config.appDatabaseUser}_group`;
  await client.query(`CREATE ROLE "${group}" NOLOGIN`);
  try {
    await client.query(`GRANT "${group}" TO "${db.config.appDatabaseUser}"`);
    await expect(runMigrations(db.config)).rejects.toThrow('memberships');
    await client.query(`REVOKE "${group}" FROM "${db.config.appDatabaseUser}"`);
  } finally {
    await client.query(`DROP ROLE "${group}"`);
  }
});

it('refuses forbidden direct grants and grant options without silently repairing them', async () => {
  const { db, client } = await fixture();
  for (const [privileges, table] of [
    ['UPDATE', 'demo_maintenance_state'],
    ['INSERT', 'demo_users'],
    ['UPDATE', 'audit_events'],
    ['SELECT WITH GRANT OPTION', 'production_passports'],
  ] as const) {
    const grant = privileges.replace(' WITH GRANT OPTION', '');
    const grantOption = privileges.includes(' WITH GRANT OPTION') ? ' WITH GRANT OPTION' : '';
    await client.query(
      `GRANT ${grant} ON ${table} TO "${db.config.appDatabaseUser}"${grantOption}`,
    );
    await expect(runMigrations(db.config)).rejects.toThrow('недопустимые grants');
    expect(
      (
        await client.query('SELECT has_table_privilege($1, $2, $3) AS retained', [
          db.config.appDatabaseUser,
          table,
          privileges,
        ])
      ).rows[0].retained,
    ).toBe(true);
    if (grantOption)
      await client.query(
        `REVOKE GRANT OPTION FOR ${grant} ON ${table} FROM "${db.config.appDatabaseUser}"`,
      );
    else await client.query(`REVOKE ${grant} ON ${table} FROM "${db.config.appDatabaseUser}"`);
  }
  await client.query(`GRANT CREATE ON SCHEMA public TO "${db.config.appDatabaseUser}"`);
  await expect(runMigrations(db.config)).rejects.toThrow('недопустимые атрибуты');
  await client.query(`REVOKE CREATE ON SCHEMA public FROM "${db.config.appDatabaseUser}"`);
  await client.query(`GRANT CREATE ON DATABASE "${db.name}" TO "${db.config.appDatabaseUser}"`);
  await expect(runMigrations(db.config)).rejects.toThrow('недопустимые атрибуты');
  await client.query(`REVOKE CREATE ON DATABASE "${db.name}" FROM "${db.config.appDatabaseUser}"`);
  await runMigrations(db.config);
});

it('rejects forbidden column grants and PUBLIC column grants without silently changing them', async () => {
  const { db, client } = await fixture();
  for (const [table, column, privilege, toPublic, grantOption] of [
    ['demo_maintenance_state', 'maintenance', 'UPDATE', false, false],
    ['demo_maintenance_state', 'last_reset_verified_at', 'UPDATE', true, false],
    ['audit_events', 'payload', 'UPDATE', false, false],
    ['production_passports', 'product_name', 'SELECT', false, true],
  ] as const) {
    const grantee = toPublic ? 'PUBLIC' : `"${db.config.appDatabaseUser}"`;
    await client.query(
      `GRANT ${privilege} (${column}) ON ${table} TO ${grantee}${grantOption ? ' WITH GRANT OPTION' : ''}`,
    );
    try {
      await expect(runMigrations(db.config)).rejects.toThrow('недопустимые grants');
      await expect(verifyDatabase(client)).rejects.toThrow('недопустимые grants');
      expect(
        (
          await client.query('SELECT has_column_privilege($1, $2, $3, $4) AS retained', [
            db.config.appDatabaseUser,
            table,
            column,
            `${privilege}${grantOption ? ' WITH GRANT OPTION' : ''}`,
          ])
        ).rows[0].retained,
      ).toBe(true);
    } finally {
      await client.query(`REVOKE ${privilege} (${column}) ON ${table} FROM ${grantee}`);
    }
  }
  await runMigrations(db.config);
  await verifyDatabase(client);
});

it('an owner waits for admitted work; blocked reader sees the closed state in a new statement snapshot', async () => {
  const { db, client } = await fixture();
  const admitted = latch();
  const finish = latch();
  const work = withRuntimeTransaction(db.runtime, async (runtime) => {
    admitted.resolve();
    await finish.promise;
    await runtime.query('SELECT 1 FROM demo_users');
  });
  await admitted.promise;
  const pid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as number;
  const closing = closeMaintenanceGate(client);
  await waitForAdvisoryWait(db, pid);
  expect(
    (await db.owner.query('SELECT maintenance FROM demo_maintenance_state')).rows[0].maintenance,
  ).toBe(false);
  const rejectedRead = expect(
    createRuntimeReader(db.runtime).query('SELECT 1 FROM demo_users'),
  ).rejects.toMatchObject({ code: 'DEMO_MAINTENANCE', status: 503 });
  finish.resolve();
  await Promise.all([work, closing, rejectedRead]);
  await runOwnerOperation(client, 'verify');
  expect(
    (await client.query('SELECT maintenance FROM demo_maintenance_state')).rows[0].maintenance,
  ).toBe(true);
});

it('a lock wait cannot reuse the snapshot before owner gate closure', async () => {
  const { db, client } = await fixture();
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [runtimeBarrierKey]);
  const runtime = await db.runtime.connect();
  try {
    const pid = (await runtime.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as number;
    await runtime.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    const rejected = expect(acquireRuntimeAdmission(runtime)).rejects.toMatchObject({
      code: 'DEMO_MAINTENANCE',
    });
    await waitForAdvisoryWait(db, pid);
    await client.query(
      'UPDATE demo_maintenance_state SET maintenance = true, generation = generation + 1',
    );
    await client.query('COMMIT');
    await rejected;
    await runtime.query('ROLLBACK');
  } finally {
    runtime.release();
  }
});

it('authentication before reset cannot create or replay a command receipt after reset', async () => {
  const { db, client } = await fixture();
  const sessions = createSessionManager(
    db.runtime,
    {
      allowedOrigin: 'http://quality.test',
      cookieSecure: false,
      signingSecret: randomUUID(),
    },
    500,
  );
  const session = await sessions.createSession(demoUsers[0].id, undefined);
  const authenticated = await sessions.authenticate(session.cookie);
  await runOwnerOperation(client, 'reset');
  await expect(
    createWorkflowService(db.runtime).createBatch(authenticated.actor, {
      commandId: randomUUID(),
      productionPassportId: demoPassport.id,
      quantity: 112,
    }),
  ).rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED' });
  expect(
    (await db.owner.query('SELECT COUNT(*)::integer AS count FROM command_receipts')).rows[0].count,
  ).toBe(0);
  await expect(sessions.authenticate(session.cookie)).rejects.toMatchObject({
    code: 'AUTHENTICATION_REQUIRED',
  });
});

it('verification errors and cancellation leave the persistent gate closed and preserve the timestamp', async () => {
  const { db, client } = await fixture();
  const previous = (await client.query('SELECT last_reset_verified_at FROM demo_maintenance_state'))
    .rows[0].last_reset_verified_at;
  await expect(
    runOwnerOperation(client, 'reset', {
      verify: async () => {
        throw new Error('injected failure');
      },
    }),
  ).rejects.toThrow('injected failure');
  expect(
    (await client.query('SELECT maintenance, last_reset_verified_at FROM demo_maintenance_state'))
      .rows[0],
  ).toEqual({ maintenance: true, last_reset_verified_at: previous });
  const cancellation = new AbortController();
  await expect(
    runOwnerOperation(client, 'reset', {
      signal: cancellation.signal,
      verify: async () => {
        await verifyDatabase(client);
        cancellation.abort(new Error('cancelled'));
      },
    }),
  ).rejects.toThrow('cancelled');
  expect(
    (await client.query('SELECT maintenance, last_reset_verified_at FROM demo_maintenance_state'))
      .rows[0],
  ).toEqual({ maintenance: true, last_reset_verified_at: previous });
  await expect(createRuntimeReader(db.runtime).query('SELECT 1')).rejects.toMatchObject({
    code: 'DEMO_MAINTENANCE',
  });
  await runOwnerOperation(client, 'verify');
  await runOwnerOperation(client, 'reset');
  expect(
    (
      await client.query(
        'SELECT maintenance, last_reset_verified_at > $1 AS renewed FROM demo_maintenance_state',
        [previous],
      )
    ).rows[0],
  ).toEqual({ maintenance: false, renewed: true });
});

it('initial verify failure cannot create a reset timestamp; expired reset age rejects reads and cannot be renewed by release or repeat bootstrap', async () => {
  const { db, client } = await fixture(false);
  await expect(
    runOwnerOperation(client, 'bootstrap', {
      migrate: () => runMigrations(db.config, undefined, undefined, client),
      verify: async () => {
        throw new Error('initial verify failure');
      },
    }),
  ).rejects.toThrow('initial verify failure');
  expect(
    (await client.query('SELECT maintenance, last_reset_verified_at FROM demo_maintenance_state'))
      .rows[0],
  ).toEqual({ maintenance: true, last_reset_verified_at: null });
  await runOwnerOperation(client, 'seed');
  await client.query(
    "UPDATE demo_maintenance_state SET last_reset_verified_at = clock_timestamp() - interval '26 hours'",
  );
  await expect(createRuntimeReader(db.runtime).query('SELECT 1')).rejects.toMatchObject({
    code: 'DEMO_MAINTENANCE',
  });
  for (const operation of ['release', 'bootstrap'] as const) {
    await expect(
      runOwnerOperation(client, operation, {
        migrate: () => runMigrations(db.config, undefined, undefined, client),
      }),
    ).rejects.toThrow('reset просрочен');
  }
  await runOwnerOperation(client, 'reset');
  await expect(createRuntimeReader(db.runtime).query('SELECT 1')).resolves.toMatchObject({
    rowCount: 1,
  });
});

it('owner orchestration mutex serializes reset and a competing release', async () => {
  const { db, client } = await fixture();
  const other = new Client({ connectionString: db.config.migrationDatabaseUrl });
  clients.push(other);
  await other.connect();
  const verifying = latch();
  const finish = latch();
  const reset = runOwnerOperation(client, 'reset', {
    verify: async () => {
      await verifyDatabase(client);
      verifying.resolve();
      await finish.promise;
    },
  });
  await verifying.promise;
  const pid = (await other.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as number;
  const release = runOwnerOperation(other, 'release', {
    migrate: () => runMigrations(db.config, undefined, undefined, other),
  });
  await waitForAdvisoryWait(db, pid);
  finish.resolve();
  await Promise.all([reset, release]);
  expect(
    (await client.query('SELECT maintenance FROM demo_maintenance_state')).rows[0].maintenance,
  ).toBe(false);
});

it('ordinary reset never repairs missing seed data and leaves a damaged demo closed', async () => {
  const { db, client } = await fixture();
  await client.query('DELETE FROM operation_plans');
  await expect(runOwnerOperation(client, 'reset')).rejects.toThrow();
  expect(
    (await client.query('SELECT COUNT(*)::integer AS count FROM operation_plans')).rows[0].count,
  ).toBe(0);
  expect(
    (await client.query('SELECT maintenance FROM demo_maintenance_state')).rows[0].maintenance,
  ).toBe(true);
  await expect(createRuntimeReader(db.runtime).query('SELECT 1')).rejects.toMatchObject({
    code: 'DEMO_MAINTENANCE',
  });
});

it('exclusive barrier timeout leaves a persistent stop-admissions intent; a retry can finish the drain', async () => {
  const { db, client } = await fixture();
  const runtime = await db.runtime.connect();
  try {
    await runtime.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await acquireRuntimeAdmission(runtime);
    await client.query("SET lock_timeout = '50ms'");
    await expect(runOwnerOperation(client, 'reset')).rejects.toMatchObject({ code: '55P03' });
    expect(
      (
        await db.owner.query(
          'SELECT maintenance, maintenance_requested FROM demo_maintenance_state',
        )
      ).rows[0],
    ).toEqual({ maintenance: false, maintenance_requested: true });
    await runtime.query('COMMIT');
    await expect(createRuntimeReader(db.runtime).query('SELECT 1')).rejects.toMatchObject({
      code: 'DEMO_MAINTENANCE',
    });
    await client.query('RESET lock_timeout');
    await runOwnerOperation(client, 'reset');
    expect(
      (await client.query('SELECT maintenance, maintenance_requested FROM demo_maintenance_state'))
        .rows[0],
    ).toEqual({ maintenance: false, maintenance_requested: false });
  } finally {
    await runtime.query('ROLLBACK');
    runtime.release();
  }
});

it('cancellation during the drain cannot reopen the gate or refresh reset verification', async () => {
  const { db, client } = await fixture();
  const previous = (await client.query('SELECT last_reset_verified_at FROM demo_maintenance_state'))
    .rows[0].last_reset_verified_at;
  const runtime = await db.runtime.connect();
  const cancellation = new AbortController();
  try {
    await runtime.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await acquireRuntimeAdmission(runtime);
    const pid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as number;
    const cancelled = expect(
      runOwnerOperation(client, 'reset', { signal: cancellation.signal }),
    ).rejects.toThrow('cancel during drain');
    await waitForAdvisoryWait(db, pid);
    cancellation.abort(new Error('cancel during drain'));
    await runtime.query('COMMIT');
    await cancelled;
    expect(
      (
        await client.query(
          'SELECT maintenance, maintenance_requested, last_reset_verified_at FROM demo_maintenance_state',
        )
      ).rows[0],
    ).toEqual({ maintenance: true, maintenance_requested: true, last_reset_verified_at: previous });
  } finally {
    await runtime.query('ROLLBACK');
    runtime.release();
  }
});

it('closed gate rejects every session operation before touching stored sessions, and readiness is unavailable', async () => {
  const { db, client } = await fixture();
  const sessions = createSessionManager(
    db.runtime,
    {
      allowedOrigin: 'http://quality.test',
      cookieSecure: false,
      signingSecret: randomUUID(),
    },
    500,
  );
  const created = await sessions.createSession(demoUsers[0].id, undefined);
  const authenticated = await sessions.authenticate(created.cookie);
  const stored = (
    await client.query('SELECT to_jsonb(session) AS row FROM demo_sessions AS session')
  ).rows;
  await closeMaintenanceGate(client);
  for (const operation of [
    () => sessions.listUsers(),
    () => sessions.createSession(demoUsers[0].id, created.cookie),
    () => sessions.authenticate(created.cookie),
    () => sessions.deleteSession(authenticated),
    () => sessions.getSessionResponse(authenticated),
    () => createWorkflowService(db.runtime).listPassports(),
  ])
    await expect(operation()).rejects.toMatchObject({ code: 'DEMO_MAINTENANCE' });
  expect(
    (await client.query('SELECT to_jsonb(session) AS row FROM demo_sessions AS session')).rows,
  ).toEqual(stored);
  expect(await createDatabaseReadiness(db.runtime).check()).toEqual({
    database: 'down',
    migrationVersion: null,
  });
});

it('the compatibility seed CLI bootstraps from only the owner URL without runtime credentials', async () => {
  const { db, client } = await fixture(false);
  await runMigrations(db.config);
  const child = await promisify(execFile)(
    process.execPath,
    ['--import', 'tsx', 'apps/api/src/seed.ts'],
    {
      cwd: process.cwd(),
      timeout: 20_000,
      env: {
        APP_ENV: 'test',
        MIGRATION_DATABASE_URL: db.config.migrationDatabaseUrl,
        DOTENV_CONFIG_PATH: '.quality-results/intentionally-absent-owner-cli.env',
        ...(process.env['SystemRoot'] ? { SystemRoot: process.env['SystemRoot'] } : {}),
      },
    },
  );
  expect(child.stdout).toContain('owner operation succeeded');
  expect(child.stdout + child.stderr).not.toContain(db.config.migrationDatabaseUrl);
  await verifyDatabase(client);
  expect(
    (await client.query('SELECT maintenance, maintenance_requested FROM demo_maintenance_state'))
      .rows[0],
  ).toEqual({ maintenance: false, maintenance_requested: false });
});
