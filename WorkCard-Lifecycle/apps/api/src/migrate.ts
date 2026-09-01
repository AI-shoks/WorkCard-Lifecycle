import 'dotenv/config';

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';

import { loadMigrationConfig } from './config.js';

const migrationLockKey = '7342910001';
const migrationsDirectory = fileURLToPath(new URL('../migrations/', import.meta.url));
const migrationNamePattern = /^(\d{4})_[a-z0-9-]+\.sql$/;

type Migration = {
  checksum: string;
  name: string;
  sql: string;
  version: number;
};

async function readMigrations(): Promise<Migration[]> {
  const names = (await readdir(migrationsDirectory))
    .filter((name) => migrationNamePattern.test(name))
    .sort((left, right) => left.localeCompare(right));

  if (names.length === 0) {
    throw new Error('Не найдено ни одной SQL-миграции.');
  }

  return Promise.all(
    names.map(async (name) => {
      const versionText = migrationNamePattern.exec(name)?.[1];
      if (!versionText) throw new Error(`Некорректное имя миграции: ${name}`);

      const sql = await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
      return {
        checksum: createHash('sha256').update(sql).digest('hex'),
        name,
        sql,
        version: Number(versionText),
      };
    }),
  );
}

async function formatRoleStatement(
  client: Client,
  operation: 'create' | 'alter',
  username: string,
  password: string,
): Promise<string> {
  const template =
    operation === 'create'
      ? 'CREATE ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT PASSWORD %L'
      : 'ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT PASSWORD %L';
  const result = await client.query<{ statement: string }>(
    'SELECT format($1::text, $2::text, $3::text) AS statement',
    [template, username, password],
  );
  const statement = result.rows[0]?.statement;

  if (!statement) throw new Error('PostgreSQL не сформировал команду управления ролью.');
  return statement;
}

async function ensureRuntimeRole(
  client: Client,
  username: string,
  password: string,
): Promise<string> {
  const roleResult = await client.query<{ exists: boolean }>(
    'SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS exists',
    [username],
  );
  const operation = roleResult.rows[0]?.exists ? 'alter' : 'create';
  const statement = await formatRoleStatement(client, operation, username, password);
  await client.query(statement);

  const identifierResult = await client.query<{ identifier: string }>(
    "SELECT format('%I', $1::text) AS identifier",
    [username],
  );
  const identifier = identifierResult.rows[0]?.identifier;
  if (!identifier) throw new Error('PostgreSQL не экранировал имя runtime-роли.');
  return identifier;
}

async function applyRuntimeGrants(client: Client, roleIdentifier: string): Promise<void> {
  await client.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
  await client.query(`GRANT USAGE ON SCHEMA public TO ${roleIdentifier}`);
  await client.query(
    `REVOKE ALL ON schema_migrations, demo_users, production_passports, operation_plans FROM ${roleIdentifier}`,
  );
  await client.query(
    `GRANT SELECT ON schema_migrations, demo_users, production_passports, operation_plans TO ${roleIdentifier}`,
  );
}

async function main(): Promise<void> {
  const config = loadMigrationConfig();
  const migrations = await readMigrations();
  const client = new Client({ connectionString: config.migrationDatabaseUrl });
  let locked = false;

  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1::bigint)', [migrationLockKey]);
    locked = true;
    const roleIdentifier = await ensureRuntimeRole(
      client,
      config.appDatabaseUser,
      config.appDatabasePassword,
    );

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version integer PRIMARY KEY,
        name text NOT NULL UNIQUE,
        checksum char(64) NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
      )
    `);

    for (const migration of migrations) {
      const applied = await client.query<{ checksum: string; name: string }>(
        'SELECT name, checksum FROM schema_migrations WHERE version = $1',
        [migration.version],
      );
      const existing = applied.rows[0];

      if (existing) {
        if (existing.name !== migration.name || existing.checksum !== migration.checksum) {
          throw new Error(`Уже применённая миграция ${migration.version} была изменена.`);
        }
        console.info(`Миграция ${migration.name} уже применена.`);
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO schema_migrations(version, name, checksum) VALUES ($1, $2, $3)',
          [migration.version, migration.name, migration.checksum],
        );
        await client.query('COMMIT');
        console.info(`Применена миграция ${migration.name}.`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    await applyRuntimeGrants(client, roleIdentifier);
  } finally {
    if (locked) await client.query('SELECT pg_advisory_unlock($1::bigint)', [migrationLockKey]);
    await client.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Неизвестная ошибка миграции.';
  console.error(message);
  process.exitCode = 1;
});
