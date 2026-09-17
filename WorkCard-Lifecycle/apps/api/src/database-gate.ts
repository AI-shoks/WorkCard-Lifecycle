import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

import { authenticationRequired, DomainError } from './domain-error.js';

// Do not reuse the capacity lock (7342910002): readers and commands must overlap.
export const runtimeBarrierKey = '7342910003';
export const ownerMutexKey = '7342910004';
export const maximumResetAgeHours = 26;
export const currentMigrationVersion = 4;

export type SqlClient = {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
};

export type RuntimeAdmission = { generation: string };

export function maintenanceUnavailable(): DomainError {
  return new DomainError({
    code: 'DEMO_MAINTENANCE',
    detail: 'Демонстрационный контур временно недоступен. Повторите попытку позднее.',
    status: 503,
    title: 'Выполняется обслуживание',
  });
}

/** Call inside an explicit READ COMMITTED transaction, before any application SQL. */
export async function acquireRuntimeAdmission(client: SqlClient): Promise<RuntimeAdmission> {
  await client.query('SELECT pg_advisory_xact_lock_shared($1::bigint)', [runtimeBarrierKey]);
  // A separate statement is essential: a snapshot taken before a waited lock can be stale.
  const result = await client.query<{ generation: string; available: boolean }>(`
    SELECT generation::text,
           NOT maintenance AND NOT maintenance_requested
             AND last_reset_verified_at IS NOT NULL
             AND last_reset_verified_at <= clock_timestamp()
             AND last_reset_verified_at > clock_timestamp() - interval '26 hours' AS available
    FROM demo_maintenance_state WHERE singleton
  `);
  const state = result.rows[0];
  if (!state?.available) throw maintenanceUnavailable();
  return { generation: state.generation };
}

export async function withRuntimeTransaction<T>(
  pool: Pool,
  run: (client: PoolClient, admission: RuntimeAdmission) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let discard = false;
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    const admission = await acquireRuntimeAdmission(client);
    const result = await run(client, admission);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original failure and discard a broken connection below.
      discard = true;
    }
    throw error;
  } finally {
    client.release(discard);
  }
}

export function createRuntimeReader(pool: Pool): SqlClient {
  return {
    query<Row extends QueryResultRow>(text: string, values?: unknown[]) {
      return withRuntimeTransaction(pool, (client) => client.query<Row>(text, values));
    },
  };
}

export async function assertCurrentSession(
  client: SqlClient,
  actor: { id: string; role: string; sessionId: string; generation: string },
  admission: RuntimeAdmission,
): Promise<void> {
  if (actor.generation !== admission.generation) throw authenticationRequired();
  const result = await client.query(
    `SELECT 1 FROM demo_sessions AS session
     JOIN demo_users AS actor ON actor.id = session.demo_user_id
     WHERE session.id = $1 AND session.generation = $2::bigint
       AND actor.id = $3 AND actor.role_code = $4 AND actor.enabled
       AND session.expires_at > clock_timestamp()
       AND session.idle_expires_at > clock_timestamp()`,
    [actor.sessionId, admission.generation, actor.id, actor.role],
  );
  if (result.rowCount !== 1) throw authenticationRequired();
}
