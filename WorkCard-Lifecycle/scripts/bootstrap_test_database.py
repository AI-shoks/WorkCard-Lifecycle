from __future__ import annotations

import os
from dataclasses import dataclass

import psycopg
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict


@dataclass(frozen=True, slots=True)
class DatabaseCredential:
    username: str
    password: str
    database: str


def credential_from_dsn(dsn: str) -> DatabaseCredential:
    values = conninfo_to_dict(dsn)
    username = values.get("user")
    password = values.get("password")
    database = values.get("dbname")
    if not username or not password or not database:
        raise ValueError("test DSNs must include user, password, and database")
    return DatabaseCredential(username, password, database)


def ensure_login_role(
    connection: psycopg.Connection[tuple[object, ...]],
    credential: DatabaseCredential,
) -> None:
    exists = connection.execute(
        "SELECT 1 FROM pg_roles WHERE rolname = %s",
        (credential.username,),
    ).fetchone()
    role = sql.Identifier(credential.username)
    password = sql.Literal(credential.password)
    if exists is None:
        connection.execute(
            sql.SQL(
                "CREATE ROLE {} LOGIN PASSWORD {} "
                "NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS"
            ).format(role, password)
        )
    else:
        connection.execute(
            sql.SQL(
                "ALTER ROLE {} WITH LOGIN PASSWORD {} "
                "NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS"
            ).format(role, password)
        )


def prepare_test_database(admin_dsn: str, migration_dsn: str, runtime_dsn: str) -> None:
    admin = credential_from_dsn(admin_dsn)
    migrator = credential_from_dsn(migration_dsn)
    runtime = credential_from_dsn(runtime_dsn)
    if len({admin.username, migrator.username, runtime.username}) != 3:
        raise ValueError("admin, migration, and runtime DSNs must use separate roles")
    if {admin.database, migrator.database, runtime.database} != {admin.database}:
        raise ValueError("test DSNs must target the same isolated database")

    with psycopg.connect(admin_dsn, autocommit=True) as connection:
        ensure_login_role(connection, migrator)
        ensure_login_role(connection, runtime)
        database = sql.Identifier(admin.database)
        migration_role = sql.Identifier(migrator.username)
        runtime_role = sql.Identifier(runtime.username)
        connection.execute("REVOKE CREATE ON SCHEMA public FROM PUBLIC")
        connection.execute(
            sql.SQL("GRANT CONNECT ON DATABASE {} TO {}, {}").format(
                database,
                migration_role,
                runtime_role,
            )
        )
        connection.execute(
            sql.SQL("GRANT USAGE, CREATE ON SCHEMA public TO {}").format(migration_role)
        )
        connection.execute(sql.SQL("REVOKE CREATE ON SCHEMA public FROM {}").format(runtime_role))
        connection.execute(sql.SQL("GRANT USAGE ON SCHEMA public TO {}").format(runtime_role))


def required_environment(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise SystemExit(f"{name} is required")
    return value


def main() -> None:
    prepare_test_database(
        required_environment("WORKCARD_TEST_DATABASE_URL"),
        required_environment("WORKCARD_MIGRATION_DATABASE_URL"),
        required_environment("WORKCARD_DATABASE_URL"),
    )


if __name__ == "__main__":
    main()
