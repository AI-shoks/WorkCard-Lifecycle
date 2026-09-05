import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';

import { runMigrations } from '../apps/api/src/migration-runner.js';
import { isolatedDatabase, referenceFixtures, type TestDatabase } from './database.js';

const databases: TestDatabase[] = [];
const directories: string[] = [];
async function fixture() {
  const db = await isolatedDatabase('migrations', false);
  databases.push(db);
  const dir = await mkdtemp(join(tmpdir(), 'wcl-q9-migrations-'));
  directories.push(dir);
  await cp(resolve('apps/api/migrations'), dir, { recursive: true });
  return { db, dir };
}
afterEach(async () => {
  for (const db of databases.splice(0)) await db.dispose();
  for (const dir of directories.splice(0)) {
    expect(dir.startsWith(join(tmpdir(), 'wcl-q9-migrations-'))).toBe(true);
    await rm(dir, { recursive: true });
  }
});

it('failed SQL/history and grants roll back their transaction; corrected restart is safe, including concurrent runners', async () => {
  const { db, dir } = await fixture();
  await runMigrations(db.config, dir);
  const migration = join(dir, '0004_fault-probe.sql');
  await writeFile(
    migration,
    'CREATE TABLE q9_probe(id integer PRIMARY KEY); INSERT INTO q9_probe VALUES (1); SELECT 1/0;',
  );
  await expect(runMigrations(db.config, dir)).rejects.toMatchObject({ code: '22012' });
  expect((await db.owner.query("SELECT to_regclass('q9_probe') AS probe")).rows[0]).toEqual({
    probe: null,
  });
  expect(
    (await db.owner.query('SELECT version FROM schema_migrations ORDER BY version')).rows.map(
      (row: { version: number }) => row.version,
    ),
  ).toEqual([1, 2, 3]);
  await writeFile(
    migration,
    'CREATE TABLE q9_probe(id integer PRIMARY KEY); INSERT INTO q9_probe VALUES (1);',
  );
  await db.owner.query(`
    CREATE FUNCTION q9_fail_history() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'injected history write failure'; END $$;
    CREATE TRIGGER q9_fail_history BEFORE INSERT ON schema_migrations
      FOR EACH ROW EXECUTE FUNCTION q9_fail_history();
  `);
  await expect(runMigrations(db.config, dir)).rejects.toMatchObject({ code: 'P0001' });
  expect((await db.owner.query("SELECT to_regclass('q9_probe') AS probe")).rows[0]).toEqual({
    probe: null,
  });
  expect(
    (await db.owner.query('SELECT MAX(version) AS version FROM schema_migrations')).rows[0],
  ).toEqual({ version: 3 });
  await db.owner.query(
    'DROP TRIGGER q9_fail_history ON schema_migrations; DROP FUNCTION q9_fail_history();',
  );
  await Promise.all([runMigrations(db.config, dir), runMigrations(db.config, dir)]);
  expect((await db.owner.query('SELECT * FROM q9_probe')).rows).toEqual([{ id: 1 }]);
  expect(
    (await db.owner.query('SELECT COUNT(*)::int AS count FROM schema_migrations WHERE version=4'))
      .rows[0],
  ).toEqual({ count: 1 });
  expect((await db.runtime.query('SELECT COUNT(*)::int AS count FROM work_cards')).rows[0]).toEqual(
    { count: 0 },
  );

  const grants = async () =>
    (
      await db.owner.query(
        `SELECT table_name, privilege_type FROM information_schema.role_table_grants
       WHERE grantee=$1 AND table_name IN ('work_cards', 'audit_events')
       ORDER BY table_name, privilege_type`,
        [db.config.appDatabaseUser],
      )
    ).rows;
  const beforeGrants = await grants();
  // This valid DDL commits, then the standard grants phase hits its missing table.
  await writeFile(
    join(dir, '0005_grants-probe.sql'),
    'ALTER TABLE demo_sessions RENAME TO q9_sessions_probe;',
  );
  await expect(runMigrations(db.config, dir)).rejects.toMatchObject({ code: '42P01' });
  expect(await grants()).toEqual(beforeGrants);
  expect(
    (await db.owner.query('SELECT MAX(version) AS version FROM schema_migrations')).rows[0],
  ).toEqual({ version: 5 });
  // Explicit fixture repair; already applied SQL must not execute again.
  await db.owner.query('ALTER TABLE q9_sessions_probe RENAME TO demo_sessions');
  await runMigrations(db.config, dir);
  expect(await grants()).toEqual(beforeGrants);
});

it('checksum drift, missing applied file and duplicate versions stop before new DDL or grants', async () => {
  const { db, dir } = await fixture();
  await runMigrations(db.config, dir);
  const file = join(dir, '0003_align-operation-plan-norm-precision.sql');
  const original = await readFile(file, 'utf8');
  await writeFile(join(dir, '0004_new-probe.sql'), 'CREATE TABLE q9_probe(id integer);');
  const history = (await db.owner.query('SELECT * FROM schema_migrations ORDER BY version')).rows;
  await writeFile(file, `${original}\n-- drift`);
  await expect(runMigrations(db.config, dir)).rejects.toThrow('изменена или отсутствует');
  await rm(file);
  await expect(runMigrations(db.config, dir)).rejects.toThrow('изменена или отсутствует');
  await writeFile(file, original);
  await writeFile(join(dir, '0003_duplicate.sql'), 'SELECT 1');
  await expect(runMigrations(db.config, dir)).rejects.toThrow('уникальными');
  expect((await db.owner.query('SELECT * FROM schema_migrations ORDER BY version')).rows).toEqual(
    history,
  );
  expect((await db.owner.query("SELECT to_regclass('q9_probe') AS probe")).rows[0]).toEqual({
    probe: null,
  });
});

it('real 0003 refuses lossy norm conversion without changing data; restart succeeds after explicit correction', async () => {
  const { db, dir } = await fixture();
  const file = join(dir, '0003_align-operation-plan-norm-precision.sql');
  const sql = await readFile(file, 'utf8');
  await rm(file);
  await runMigrations(db.config, dir);
  await referenceFixtures(db);
  await db.owner.query('UPDATE operation_plans SET norm_hours = 0.251 WHERE operation_number=10');
  await writeFile(file, sql);
  await expect(runMigrations(db.config, dir)).rejects.toMatchObject({ code: '22003' });
  expect(
    (
      await db.owner.query(
        'SELECT norm_hours::text AS norm FROM operation_plans WHERE operation_number=10',
      )
    ).rows[0],
  ).toEqual({ norm: '0.2510' });
  expect(
    (await db.owner.query('SELECT MAX(version) AS version FROM schema_migrations')).rows[0],
  ).toEqual({ version: 2 });
  await db.owner.query('UPDATE operation_plans SET norm_hours = 0.250 WHERE operation_number=10');
  await runMigrations(db.config, dir);
  await runMigrations(db.config, dir);
  expect(
    (
      await db.runtime.query(
        'SELECT norm_hours::text AS norm FROM operation_plans WHERE operation_number=10',
      )
    ).rows[0],
  ).toEqual({ norm: '0.25' });
});
