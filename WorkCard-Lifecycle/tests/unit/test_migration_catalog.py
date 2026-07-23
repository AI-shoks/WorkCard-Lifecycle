from __future__ import annotations

from pathlib import Path

import pytest

from workcard_api.migrations import discover_migrations, latest_migration_version


def test_migration_catalog_is_ordered_and_checksummed() -> None:
    migrations = discover_migrations()

    assert [migration.version for migration in migrations] == ["0001", "0002", "0003"]
    assert all(len(migration.checksum) == 64 for migration in migrations)
    assert latest_migration_version() == "0003"


def test_session_registry_has_revocation_and_identity_binding_guards() -> None:
    session_migration = discover_migrations()[2].sql.lower()

    for fragment in (
        "create table demo_sessions",
        "jti uuid primary key",
        "identity_id",
        "identity_role",
        "issued_at",
        "expires_at",
        "revoked_at",
        "demo_users(id, role)",
        "demo_sessions_expiry_idx",
        "grant update (revoked_at)",
    ):
        assert fragment in session_migration


def test_initial_schema_contains_required_physical_guards() -> None:
    initial = discover_migrations()[0].sql.lower()

    for fragment in (
        "primary key",
        "on delete restrict",
        "work_cards_one_first_article_per_set_idx",
        "deferrable initially deferred",
        "audit_events_immutable",
        "unique (aggregate_type, aggregate_id, aggregate_version)",
        "unique (command_id, correlation_id)",
    ):
        assert fragment in initial
    assert "sequence_number" not in initial
    assert "serial_number" not in initial


def test_duplicate_migration_versions_are_rejected(tmp_path: Path) -> None:
    (tmp_path / "0001_a.sql").write_text("SELECT 1;", encoding="utf-8")
    (tmp_path / "0001_b.sql").write_text("SELECT 2;", encoding="utf-8")

    with pytest.raises(RuntimeError, match="duplicate"):
        discover_migrations(tmp_path)
