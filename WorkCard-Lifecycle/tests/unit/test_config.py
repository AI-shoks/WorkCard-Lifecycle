from __future__ import annotations

import pytest
from pydantic import ValidationError

from workcard_api.config import Settings

BASE = {
    "database_url": "postgresql://test_user:synthetic_test_password@localhost/workcard",
    "session_signing_secret": "a-valid-test-signing-secret-with-32-characters",
}


def test_settings_redact_database_and_signing_secret() -> None:
    settings = Settings(**BASE)

    representation = repr(settings)

    assert "user:secret" not in representation
    assert BASE["session_signing_secret"] not in representation
    assert settings.database_dsn.endswith("/workcard")


@pytest.mark.parametrize(
    ("override", "message"),
    [
        ({"session_signing_secret": "too-short"}, "at least 32"),
        ({"allowed_origins": ["*"]}, "explicit"),
        (
            {"database_pool_min_size": 5, "database_pool_max_size": 2},
            "must be >=",
        ),
    ],
)
def test_settings_reject_unsafe_configuration(override: dict[str, object], message: str) -> None:
    with pytest.raises(ValidationError, match=message):
        Settings(**(BASE | override))


def test_migration_dsn_never_falls_back_to_runtime_dsn() -> None:
    settings = Settings(**BASE, migration_database_url=None)

    with pytest.raises(RuntimeError, match="MIGRATION_DATABASE_URL"):
        _ = settings.migration_database_dsn


def test_migration_dsn_is_explicitly_separate() -> None:
    settings = Settings(
        **BASE,
        migration_database_url="postgresql://migrator:synthetic_migration_password@localhost/workcard",
    )

    assert "migrator" in settings.migration_database_dsn
    assert settings.migration_database_dsn != settings.database_dsn


@pytest.mark.parametrize(
    "override",
    [
        {"environment": "production", "cookie_secure": False},
        {
            "environment": "staging",
            "cookie_secure": True,
            "allowed_origins": ["http://staging.example"],
        },
    ],
)
def test_deployed_environments_require_secure_cookie_and_https_origin(
    override: dict[str, object],
) -> None:
    with pytest.raises(ValidationError):
        Settings(**(BASE | override))
