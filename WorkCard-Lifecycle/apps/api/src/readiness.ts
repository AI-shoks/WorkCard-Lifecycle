import type { Pool } from 'pg';

export type ReadinessSnapshot = {
  database: 'up' | 'down';
  migrationVersion: number | null;
};

export type ReadinessService = {
  check(): Promise<ReadinessSnapshot>;
};

export function createDatabaseReadiness(pool: Pool): ReadinessService {
  return {
    async check() {
      try {
        const result = await pool.query<{ version: number }>(
          'SELECT COALESCE(MAX(version), 0)::integer AS version FROM schema_migrations',
        );

        return {
          database: 'up',
          migrationVersion: result.rows[0]?.version ?? 0,
        };
      } catch {
        return { database: 'down', migrationVersion: null };
      }
    },
  };
}
