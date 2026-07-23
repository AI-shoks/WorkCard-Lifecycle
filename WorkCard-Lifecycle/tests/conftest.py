from __future__ import annotations

import os
from collections.abc import Iterator
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

os.environ.setdefault("WORKCARD_ENVIRONMENT", "test")
os.environ.setdefault("WORKCARD_DATABASE_URL", "postgresql://unused:unused@localhost/unused")
os.environ.setdefault(
    "WORKCARD_SESSION_SIGNING_SECRET", "test-only-signing-secret-at-least-32-characters"
)
os.environ.setdefault("WORKCARD_ALLOWED_ORIGINS", '["http://testserver"]')

from scripts.bootstrap_test_database import prepare_test_database

from workcard_api.app import create_app
from workcard_api.config import Settings
from workcard_api.migrations import apply_migrations
from workcard_api.models import DemoIdentity, Role, SessionRecord

PLANNER_ID = UUID("10000000-0000-4000-8000-000000000001")
MASTER_ID = UUID("10000000-0000-4000-8000-000000000002")


class FakeDatabase:
    def __init__(self) -> None:
        self.opened = False
        self.readiness_result = (True, "ready")
        self.raise_on_identity_list = False
        self.identities = [
            DemoIdentity(PLANNER_ID, "Планировщик ПДБ", "PLANNER"),
            DemoIdentity(MASTER_ID, "Мастер участка", "MASTER"),
        ]
        self.sessions: dict[UUID, SessionRecord] = {}

    def open(self) -> None:
        self.opened = True

    def close(self) -> None:
        self.opened = False

    def readiness(self, expected_migration: str) -> tuple[bool, str]:
        assert expected_migration == "0003"
        return self.readiness_result

    def list_demo_identities(self) -> list[DemoIdentity]:
        if self.raise_on_identity_list:
            raise RuntimeError("synthetic database failure")
        return self.identities.copy()

    def get_demo_identity(self, identity_id: UUID) -> DemoIdentity | None:
        return next((item for item in self.identities if item.id == identity_id), None)

    def create_session(
        self,
        jti: UUID,
        identity_id: UUID | None,
        role: Role | None,
        ttl_seconds: int,
    ) -> SessionRecord:
        issued_at = datetime.now(UTC)
        record = SessionRecord(
            jti=jti,
            identity_id=identity_id,
            role=role,
            issued_at=issued_at,
            expires_at=issued_at + timedelta(seconds=ttl_seconds),
        )
        self.sessions[jti] = record
        return record

    def get_active_session(self, jti: UUID) -> SessionRecord | None:
        record = self.sessions.get(jti)
        if (
            record is None
            or record.revoked_at is not None
            or record.expires_at <= datetime.now(UTC)
        ):
            return None
        return record

    def rotate_session(
        self,
        current_jti: UUID,
        new_jti: UUID,
        identity_id: UUID,
        role: Role,
        ttl_seconds: int,
    ) -> SessionRecord | None:
        current = self.get_active_session(current_jti)
        if current is None:
            return None
        self.sessions[current_jti] = replace(current, revoked_at=datetime.now(UTC))
        return self.create_session(new_jti, identity_id, role, ttl_seconds)

    def revoke_session(self, jti: UUID) -> bool:
        current = self.get_active_session(jti)
        if current is None:
            return False
        self.sessions[jti] = replace(current, revoked_at=datetime.now(UTC))
        return True

    def expire_all_sessions(self) -> None:
        expired_at = datetime.now(UTC) - timedelta(seconds=1)
        for jti, record in self.sessions.items():
            self.sessions[jti] = replace(record, expires_at=expired_at)

    def set_active_sessions_near_expiry(self) -> None:
        expires_at = datetime.now(UTC) + timedelta(milliseconds=200)
        for jti, record in self.sessions.items():
            if record.revoked_at is None:
                self.sessions[jti] = replace(record, expires_at=expires_at)


@pytest.fixture
def settings() -> Settings:
    return Settings(
        environment="test",
        database_url="postgresql://unused:unused@localhost/unused",
        session_signing_secret="test-only-signing-secret-at-least-32-characters",
        allowed_origins=["http://testserver"],
        cookie_secure=False,
    )


@pytest.fixture
def fake_database() -> FakeDatabase:
    return FakeDatabase()


@pytest.fixture
def application(settings: Settings, fake_database: FakeDatabase) -> FastAPI:
    return create_app(settings, fake_database)


@pytest.fixture
def client(application: FastAPI) -> Iterator[TestClient]:
    with TestClient(application) as test_client:
        yield test_client


@pytest.fixture(scope="session")
def prepared_least_privilege_database() -> None:
    admin_dsn = os.getenv("WORKCARD_TEST_DATABASE_URL")
    migration_dsn = os.getenv("WORKCARD_MIGRATION_DATABASE_URL")
    runtime_dsn = os.getenv("WORKCARD_DATABASE_URL")
    if not admin_dsn or not migration_dsn or not runtime_dsn:
        pytest.skip("separate admin, migration, and runtime PostgreSQL DSNs are required")
    prepare_test_database(admin_dsn, migration_dsn, runtime_dsn)
    apply_migrations(migration_dsn)
