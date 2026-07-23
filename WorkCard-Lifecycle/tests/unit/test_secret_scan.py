from __future__ import annotations

from pathlib import Path

import pytest
from scripts.check_no_secrets import scan


@pytest.mark.parametrize(
    ("label", "sample"),
    [
        ("private key", "-----BEGIN PRIVATE KEY-----"),
        ("GitHub token", "ghp_abcdefghijklmnopqrstuvwxyz0123456789ABCD"),
        ("AWS access key", "AKIAABCDEFGHIJKLMNOP"),
        ("generic password assignment", "password=CorrectHorseBatteryStaple"),
        (
            "database URL credentials",
            "postgresql://service:CorrectHorseBatteryStaple@database.example/workcard",
        ),
        (
            "JWT-like token",
            "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature0123456789",
        ),
        ("Slack token", "".join(("xoxb", "-123456789012-", "abcdefghijklmnopqrstuvwxyz"))),
        ("Stripe secret token", "".join(("sk", "_live_", "abcdefghijklmnopqrstuvwxyz"))),
        (
            "Azure storage key",
            "AccountKey=ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstu1234567890+/=",
        ),
    ],
)
def test_secret_scanner_detects_supported_credential_families(
    tmp_path: Path,
    label: str,
    sample: str,
) -> None:
    (tmp_path / "sample.txt").write_text(sample, encoding="utf-8")

    findings = scan(tmp_path)

    assert any(label in finding for finding in findings)


@pytest.mark.parametrize(
    "filename",
    [".env", ".env.local", "credentials.json", "service-account.json", "id_rsa"],
)
def test_secret_scanner_rejects_credential_files(tmp_path: Path, filename: str) -> None:
    (tmp_path / filename).write_text("placeholder", encoding="utf-8")

    assert any("credential file" in finding for finding in scan(tmp_path))


def test_secret_scanner_allows_documented_nonworking_examples(tmp_path: Path) -> None:
    (tmp_path / ".env.example").write_text(
        "\n".join(
            [
                "WORKCARD_DATABASE_URL=postgresql://workcard_app:REPLACE_WITH_LOCAL_PASSWORD@db/workcard",
                "POSTGRES_PASSWORD=synthetic_test_password",
                "WORKCARD_SESSION_SIGNING_SECRET=test-only-signing-secret-at-least-32-characters",
            ]
        ),
        encoding="utf-8",
    )

    assert scan(tmp_path) == []
