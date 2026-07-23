from __future__ import annotations

import os
from pathlib import Path
from uuid import uuid4

import psycopg
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from psycopg.errors import InsufficientPrivilege
from scripts.bootstrap_test_database import credential_from_dsn

from workcard_api.app import create_app
from workcard_api.auth import COOKIE_NAME
from workcard_api.config import Settings
from workcard_api.database import PostgresDatabase
from workcard_api.migrations import MIGRATION_LOCK_ID, apply_migrations

ADMIN_DSN = os.getenv("WORKCARD_TEST_DATABASE_URL")
MIGRATION_DSN = os.getenv("WORKCARD_MIGRATION_DATABASE_URL")
RUNTIME_DSN = os.getenv("WORKCARD_DATABASE_URL")
ORIGIN_HEADERS = {"Origin": "http://testserver", "Sec-Fetch-Site": "same-origin"}
pytestmark = [
    pytest.mark.integration,
    pytest.mark.usefixtures("prepared_least_privilege_database"),
]


def runtime_settings() -> Settings:
    assert MIGRATION_DSN is not None
    assert RUNTIME_DSN is not None
    return Settings(
        environment="test",
        database_url=RUNTIME_DSN,
        migration_database_url=MIGRATION_DSN,
        session_signing_secret="integration-signing-secret-at-least-32-characters",
        allowed_origins=["http://testserver"],
    )


def runtime_application() -> FastAPI:
    assert RUNTIME_DSN is not None
    database = PostgresDatabase(RUNTIME_DSN, min_size=1, max_size=2, timeout=2)
    return create_app(runtime_settings(), database)


def test_runtime_role_attributes_ownership_and_ddl_are_restricted() -> None:
    assert ADMIN_DSN is not None
    assert RUNTIME_DSN is not None
    runtime_user = credential_from_dsn(RUNTIME_DSN).username
    with psycopg.connect(ADMIN_DSN) as connection:
        attributes = connection.execute(
            """
            SELECT rolsuper, rolcreatedb, rolcreaterole
            FROM pg_roles
            WHERE rolname = %s
            """,
            (runtime_user,),
        ).fetchone()
        database_owner = connection.execute(
            """
            SELECT pg_get_userbyid(datdba)
            FROM pg_database
            WHERE datname = current_database()
            """
        ).fetchone()
        schema_owner = connection.execute(
            """
            SELECT pg_get_userbyid(nspowner)
            FROM pg_namespace
            WHERE nspname = 'public'
            """
        ).fetchone()
        table_owners = connection.execute(
            """
            SELECT DISTINCT tableowner
            FROM pg_tables
            WHERE schemaname = 'public'
            """
        ).fetchall()

    assert attributes == (False, False, False)
    assert database_owner is not None and database_owner[0] != runtime_user
    assert schema_owner is not None and schema_owner[0] != runtime_user
    assert table_owners and all(row[0] != runtime_user for row in table_owners)

    with (
        psycopg.connect(RUNTIME_DSN) as connection,
        pytest.raises(InsufficientPrivilege),
    ):
        connection.execute("CREATE TABLE runtime_role_must_not_create (id integer)")


def test_runtime_allowed_session_dml_and_declared_grant_matrix() -> None:
    assert ADMIN_DSN is not None
    assert RUNTIME_DSN is not None
    runtime_user = credential_from_dsn(RUNTIME_DSN).username
    jti = uuid4()
    with psycopg.connect(RUNTIME_DSN, autocommit=True) as connection:
        connection.execute(
            """
            INSERT INTO demo_sessions (jti, issued_at, expires_at)
            VALUES (%s, clock_timestamp(), clock_timestamp() + interval '1 minute')
            """,
            (jti,),
        )
        assert connection.execute(
            "SELECT jti FROM demo_sessions WHERE jti = %s", (jti,)
        ).fetchone() == (jti,)
        connection.execute(
            "UPDATE demo_sessions SET revoked_at = clock_timestamp() WHERE jti = %s",
            (jti,),
        )
        connection.execute("DELETE FROM demo_sessions WHERE jti = %s", (jti,))

    with psycopg.connect(ADMIN_DSN) as connection:
        table_names = {
            row[0]
            for row in connection.execute(
                """
                SELECT tablename FROM pg_tables WHERE schemaname = 'public'
                """
            ).fetchall()
        }
        grants = connection.execute(
            """
            SELECT table_name, privilege_type
            FROM information_schema.role_table_grants
            WHERE grantee = %s AND table_schema = 'public'
            """,
            (runtime_user,),
        ).fetchall()
        session_update_columns = {
            row[0]
            for row in connection.execute(
                """
                SELECT column_name
                FROM information_schema.column_privileges
                WHERE grantee = %s
                  AND table_schema = 'public'
                  AND table_name = 'demo_sessions'
                  AND privilege_type = 'UPDATE'
                """,
                (runtime_user,),
            ).fetchall()
        }

    by_privilege = {
        privilege: {table for table, granted in grants if granted == privilege}
        for privilege in {"SELECT", "INSERT", "UPDATE", "DELETE"}
    }
    assert by_privilege["SELECT"] == table_names
    assert by_privilege["INSERT"] == {
        "production_batches",
        "work_card_sets",
        "work_cards",
        "command_receipts",
        "final_batch_acceptances",
        "payroll_records",
        "audit_events",
        "demo_sessions",
    }
    assert by_privilege["UPDATE"] == {
        "production_batches",
        "work_card_sets",
        "work_cards",
    }
    assert by_privilege["DELETE"] == {"demo_sessions"}
    assert session_update_columns == {"revoked_at"}


@pytest.mark.parametrize(
    "statement",
    [
        "UPDATE audit_events SET occurred_at = occurred_at WHERE false",
        "DELETE FROM audit_events WHERE false",
        "UPDATE final_batch_acceptances SET accepted_at = accepted_at WHERE false",
        "DELETE FROM final_batch_acceptances WHERE false",
        "UPDATE payroll_records SET exported_at = exported_at WHERE false",
        "DELETE FROM payroll_records WHERE false",
    ],
)
def test_runtime_cannot_mutate_immutable_or_audit_tables(statement: str) -> None:
    assert RUNTIME_DSN is not None
    with (
        psycopg.connect(RUNTIME_DSN) as connection,
        pytest.raises(InsufficientPrivilege),
    ):
        connection.execute(statement)


def test_migration_failure_preserves_original_error_and_releases_lock(
    tmp_path: Path,
) -> None:
    assert ADMIN_DSN is not None
    assert RUNTIME_DSN is not None
    (tmp_path / "0004_runtime_ddl_must_fail.sql").write_text(
        "CREATE TABLE runtime_migration_must_not_create (id integer);",
        encoding="utf-8",
    )

    with pytest.raises(InsufficientPrivilege):
        apply_migrations(RUNTIME_DSN, tmp_path)

    with psycopg.connect(ADMIN_DSN, autocommit=True) as connection:
        acquired = connection.execute(
            "SELECT pg_try_advisory_lock(%s)", (MIGRATION_LOCK_ID,)
        ).fetchone()
        assert acquired == (True,)
        assert connection.execute(
            "SELECT pg_advisory_unlock(%s)", (MIGRATION_LOCK_ID,)
        ).fetchone() == (True,)


def test_postgres_session_registry_survives_restart_and_revokes_replay() -> None:
    planner_id = "10000000-0000-4000-8000-000000000001"
    first_app = runtime_application()
    with TestClient(first_app) as first_client:
        bootstrap = first_client.get("/api/v1/session/bootstrap")
        selected = first_client.put(
            "/api/v1/session/demo",
            headers=ORIGIN_HEADERS | {"X-CSRF-Token": bootstrap.json()["csrfToken"]},
            json={"demoIdentityId": planner_id},
        )
        cookie = first_client.cookies.get(COOKIE_NAME)

    assert selected.status_code == 200
    assert cookie is not None

    second_app = runtime_application()
    with TestClient(second_app) as second_client:
        second_client.cookies.set(COOKIE_NAME, str(cookie), path="/api/v1")
        restored = second_client.get("/api/v1/session")
        deleted = second_client.delete(
            "/api/v1/session",
            headers=ORIGIN_HEADERS | {"X-CSRF-Token": restored.json()["csrfToken"]},
        )

    assert restored.status_code == 200
    assert deleted.status_code == 204

    third_app = runtime_application()
    with TestClient(third_app) as replay_client:
        replay_client.cookies.set(COOKIE_NAME, str(cookie), path="/api/v1")
        replay = replay_client.get("/api/v1/session")
    assert replay.status_code == 401
