from __future__ import annotations

import argparse
import hashlib
import logging
from dataclasses import dataclass
from pathlib import Path

import psycopg
from psycopg import sql

from workcard_api.config import get_settings

MIGRATIONS_DIR = Path(__file__).resolve().parents[2] / "db" / "migrations"
MIGRATION_LOCK_ID = 7_240_617_006
LOGGER = logging.getLogger("workcard_api.migrations")


@dataclass(frozen=True, slots=True)
class Migration:
    version: str
    path: Path
    checksum: str
    sql: str


def discover_migrations(directory: Path = MIGRATIONS_DIR) -> list[Migration]:
    migrations: list[Migration] = []
    for path in sorted(directory.glob("[0-9][0-9][0-9][0-9]_*.sql")):
        version = path.name.split("_", maxsplit=1)[0]
        migration_sql = path.read_text(encoding="utf-8")
        migrations.append(
            Migration(
                version=version,
                path=path,
                checksum=hashlib.sha256(migration_sql.encode()).hexdigest(),
                sql=migration_sql,
            )
        )
    if not migrations or len({item.version for item in migrations}) != len(migrations):
        raise RuntimeError("migration catalog is empty or contains duplicate versions")
    return migrations


def latest_migration_version(directory: Path = MIGRATIONS_DIR) -> str:
    return discover_migrations(directory)[-1].version


def apply_migrations(dsn: str, directory: Path = MIGRATIONS_DIR) -> list[str]:
    applied_now: list[str] = []
    migrations = discover_migrations(directory)
    with psycopg.connect(dsn, autocommit=True) as connection:
        connection.execute("SELECT pg_advisory_lock(%s)", (MIGRATION_LOCK_ID,))
        migration_error: BaseException | None = None
        try:
            with connection.transaction():
                connection.execute(
                    """
                    CREATE TABLE IF NOT EXISTS schema_migrations (
                        version text PRIMARY KEY,
                        checksum text NOT NULL,
                        applied_at timestamptz NOT NULL DEFAULT now()
                    )
                    """
                )
            for migration in migrations:
                row = connection.execute(
                    "SELECT checksum FROM schema_migrations WHERE version = %s",
                    (migration.version,),
                ).fetchone()
                if row is not None:
                    if row[0] != migration.checksum:
                        raise RuntimeError(
                            f"checksum mismatch for applied migration {migration.version}"
                        )
                    continue
                with connection.transaction():
                    connection.execute(sql.SQL(migration.sql))
                    connection.execute(
                        "INSERT INTO schema_migrations(version, checksum) VALUES (%s, %s)",
                        (migration.version, migration.checksum),
                    )
                applied_now.append(migration.version)
        except BaseException as error:
            migration_error = error
            raise
        finally:
            try:
                connection.execute("SELECT pg_advisory_unlock(%s)", (MIGRATION_LOCK_ID,))
            except Exception as unlock_error:
                if migration_error is None:
                    raise
                LOGGER.warning(
                    "advisory unlock failed after migration failure",
                    exc_info=unlock_error,
                )
    return applied_now


def main() -> None:
    parser = argparse.ArgumentParser(description="Apply explicit SQL migrations")
    parser.add_argument("command", choices=("up",))
    arguments = parser.parse_args()
    if arguments.command == "up":
        settings = get_settings()
        for version in apply_migrations(settings.migration_database_dsn):
            print(f"applied migration {version}")


if __name__ == "__main__":
    main()
