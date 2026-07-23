from __future__ import annotations

import os

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg.errors import CheckViolation

from workcard_api.app import create_app
from workcard_api.config import Settings
from workcard_api.database import PostgresDatabase
from workcard_api.migrations import apply_migrations

ADMIN_DSN = os.getenv("WORKCARD_TEST_DATABASE_URL")
MIGRATION_DSN = os.getenv("WORKCARD_MIGRATION_DATABASE_URL")
RUNTIME_DSN = os.getenv("WORKCARD_DATABASE_URL")
pytestmark = [
    pytest.mark.integration,
    pytest.mark.usefixtures("prepared_least_privilege_database"),
]


def test_migrations_are_idempotent_and_seed_is_canonical() -> None:
    assert MIGRATION_DSN is not None
    assert RUNTIME_DSN is not None
    assert apply_migrations(MIGRATION_DSN) == []

    with psycopg.connect(RUNTIME_DSN) as connection:
        identity_count = connection.execute("SELECT count(*) FROM demo_users").fetchone()[0]
        planned_counts = connection.execute(
            "SELECT planned_card_count FROM operation_plans ORDER BY position"
        ).fetchall()
        business_row_counts = connection.execute(
            """
            SELECT
                (SELECT count(*) FROM production_batches),
                (SELECT count(*) FROM work_card_sets),
                (SELECT count(*) FROM work_cards)
            """
        ).fetchone()

    assert identity_count == 6
    assert [row[0] for row in planned_counts] == [112, 112, 26]
    assert sum(row[0] for row in planned_counts) == 250
    assert business_row_counts == (0, 0, 0)


def test_database_constraints_reject_invalid_operation_plan() -> None:
    assert MIGRATION_DSN is not None
    with (
        psycopg.connect(MIGRATION_DSN) as connection,
        pytest.raises(CheckViolation),
        connection.transaction(),
    ):
        connection.execute(
            """
            INSERT INTO operation_plans (
                id, passport_id, position, operation_scope, norm_hours, planned_card_count
            ) VALUES (
                'ffffffff-ffff-4fff-8fff-ffffffffffff',
                '20000000-0000-4000-8000-000000000001',
                99,
                '{}'::jsonb,
                0,
                0
            )
            """
        )


def test_real_readiness_and_prepared_identity_query() -> None:
    assert MIGRATION_DSN is not None
    assert RUNTIME_DSN is not None
    settings = Settings(
        environment="test",
        database_url=RUNTIME_DSN,
        migration_database_url=MIGRATION_DSN,
        session_signing_secret="integration-signing-secret-at-least-32-characters",
        allowed_origins=["http://testserver"],
    )
    database = PostgresDatabase(RUNTIME_DSN, min_size=1, max_size=2, timeout=2)
    application = create_app(settings, database)

    with TestClient(application) as client:
        readiness = client.get("/health/ready")
        identities = client.get("/api/v1/demo-identities")

    assert readiness.status_code == 200
    assert readiness.json()["status"] == "ready"
    assert identities.status_code == 200
    assert len(identities.json()["items"]) == 6
