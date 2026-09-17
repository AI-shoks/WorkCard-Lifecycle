import type { SqlClient } from './database-gate.js';

const runtimePrivileges: Record<string, readonly string[]> = {
  schema_migrations: ['SELECT'],
  demo_maintenance_state: ['SELECT'],
  demo_users: ['SELECT'],
  production_passports: ['SELECT'],
  operation_plans: ['SELECT'],
  demo_sessions: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  production_batches: ['SELECT', 'INSERT', 'UPDATE'],
  work_card_sets: ['SELECT', 'INSERT', 'UPDATE'],
  work_cards: ['SELECT', 'INSERT', 'UPDATE'],
  command_receipts: ['SELECT', 'INSERT', 'UPDATE'],
  batch_operation_plan_snapshots: ['SELECT', 'INSERT'],
  final_batch_acceptances: ['SELECT', 'INSERT'],
  payroll_records: ['SELECT', 'INSERT'],
  audit_events: ['SELECT', 'INSERT'],
};

export async function assertRuntimeRoleBoundary(
  client: SqlClient,
  username: string,
): Promise<void> {
  const result = await client.query<{
    unsafe: boolean;
  }>(
    `SELECT rol.rolsuper OR rol.rolcreatedb OR rol.rolcreaterole OR rol.rolreplication
              OR rol.rolbypassrls OR rol.rolinherit OR NOT rol.rolcanlogin
              OR has_database_privilege(rol.oid, current_database(), 'CREATE')
              OR has_schema_privilege(rol.oid, 'public', 'CREATE')
              OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member = rol.oid)
              OR EXISTS (SELECT 1 FROM pg_shdepend
                         WHERE refclassid = 'pg_authid'::regclass
                           AND refobjid = rol.oid AND deptype = 'o') AS unsafe
     FROM pg_roles AS rol WHERE rol.rolname = $1`,
    [username],
  );
  if (!result.rows[0] || result.rows[0].unsafe) {
    throw new Error(
      'Runtime-роль имеет недопустимые атрибуты, memberships или ownership; требуется явное исправление владельцем.',
    );
  }
  const grants = await client.query<{
    table_name: string;
    privilege_type: string;
    is_grantable: boolean;
  }>(
    `SELECT relation.relname AS table_name, privilege.privilege_type, privilege.is_grantable
     FROM pg_class AS relation
     JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
     CROSS JOIN LATERAL aclexplode(relation.relacl) AS privilege
     WHERE namespace.nspname = 'public'
       AND relation.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
       AND privilege.grantee IN (0, (SELECT oid FROM pg_roles WHERE rolname = $1))
     UNION ALL
     SELECT relation.relname AS table_name, privilege.privilege_type, privilege.is_grantable
     FROM pg_class AS relation
     JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
     JOIN pg_attribute AS attribute ON attribute.attrelid = relation.oid
     CROSS JOIN LATERAL aclexplode(attribute.attacl) AS privilege
     WHERE namespace.nspname = 'public'
       AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND attribute.attnum > 0 AND NOT attribute.attisdropped
       AND privilege.grantee IN (0, (SELECT oid FROM pg_roles WHERE rolname = $1))`,
    [username],
  );
  if (
    grants.rows.some(
      (grant) =>
        grant.is_grantable || !runtimePrivileges[grant.table_name]?.includes(grant.privilege_type),
    )
  ) {
    throw new Error(
      'Runtime-роль имеет недопустимые grants; требуется явное исправление владельцем.',
    );
  }
}
