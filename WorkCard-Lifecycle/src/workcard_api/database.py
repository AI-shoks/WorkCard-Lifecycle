from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime
from typing import Protocol, cast
from uuid import UUID

from psycopg import Connection, rows
from psycopg_pool import ConnectionPool

from workcard_api.models import DemoIdentity, Role, SessionRecord


class DatabaseGateway(Protocol):
    def open(self) -> None: ...

    def close(self) -> None: ...

    def readiness(self, expected_migration: str) -> tuple[bool, str]: ...

    def list_demo_identities(self) -> list[DemoIdentity]: ...

    def get_demo_identity(self, identity_id: UUID) -> DemoIdentity | None: ...

    def create_session(
        self,
        jti: UUID,
        identity_id: UUID | None,
        role: Role | None,
        ttl_seconds: int,
    ) -> SessionRecord: ...

    def get_active_session(self, jti: UUID) -> SessionRecord | None: ...

    def rotate_session(
        self,
        current_jti: UUID,
        new_jti: UUID,
        identity_id: UUID,
        role: Role,
        ttl_seconds: int,
    ) -> SessionRecord | None: ...

    def revoke_session(self, jti: UUID) -> bool: ...


class PostgresDatabase:
    """PostgreSQL access needed by the foundation slice only."""

    def __init__(
        self,
        dsn: str,
        *,
        min_size: int,
        max_size: int,
        timeout: float,
    ) -> None:
        self._pool = ConnectionPool(
            conninfo=dsn,
            min_size=min_size,
            max_size=max_size,
            timeout=timeout,
            open=False,
            kwargs={"autocommit": True},
        )

    def open(self) -> None:
        self._pool.open(wait=False)

    def close(self) -> None:
        self._pool.close()

    @contextmanager
    def connection(self) -> Iterator[Connection[tuple[object, ...]]]:
        with self._pool.connection() as connection:
            yield connection

    def readiness(self, expected_migration: str) -> tuple[bool, str]:
        try:
            with self._pool.connection() as connection, connection.cursor() as cursor:
                cursor.execute("SELECT to_regclass('public.schema_migrations')")
                relation = cursor.fetchone()
                if relation is None or relation[0] is None:
                    return False, "migrations_missing"
                cursor.execute(
                    "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1"
                )
                row = cursor.fetchone()
                if row is None or row[0] != expected_migration:
                    return False, "migrations_pending"
                cursor.execute("SELECT 1")
                ping = cursor.fetchone()
                if ping is None or ping[0] != 1:
                    return False, "database_unavailable"
        except Exception:  # database driver boundary; details must not leak through health
            return False, "database_unavailable"
        return True, "ready"

    def list_demo_identities(self) -> list[DemoIdentity]:
        query = """
            SELECT id, display_name, role
            FROM demo_users
            WHERE active = true
            ORDER BY display_name, id
        """
        with (
            self._pool.connection() as connection,
            connection.cursor(row_factory=rows.class_row(DemoIdentity)) as cursor,
        ):
            cursor.execute(query)
            return list(cursor.fetchall())

    def get_demo_identity(self, identity_id: UUID) -> DemoIdentity | None:
        query = """
            SELECT id, display_name, role
            FROM demo_users
            WHERE id = %s AND active = true
        """
        with self._pool.connection() as connection, connection.cursor() as cursor:
            cursor.execute(query, (identity_id,))
            row = cursor.fetchone()
        if row is None:
            return None
        return DemoIdentity(id=row[0], display_name=row[1], role=cast(Role, row[2]))

    @staticmethod
    def _session_record(row: tuple[object, ...]) -> SessionRecord:
        return SessionRecord(
            jti=cast(UUID, row[0]),
            identity_id=cast(UUID | None, row[1]),
            role=cast(Role | None, row[2]),
            issued_at=cast(datetime, row[3]),
            expires_at=cast(datetime, row[4]),
            revoked_at=cast(datetime | None, row[5]),
        )

    @staticmethod
    def _insert_session(
        connection: Connection[tuple[object, ...]],
        jti: UUID,
        identity_id: UUID | None,
        role: Role | None,
        ttl_seconds: int,
    ) -> SessionRecord:
        row = connection.execute(
            """
            INSERT INTO demo_sessions (jti, identity_id, identity_role, issued_at, expires_at)
            VALUES (
                %s,
                %s,
                %s,
                clock_timestamp(),
                clock_timestamp() + make_interval(secs => %s)
            )
            RETURNING jti, identity_id, identity_role, issued_at, expires_at, revoked_at
            """,
            (jti, identity_id, role, ttl_seconds),
        ).fetchone()
        if row is None:  # pragma: no cover - INSERT RETURNING always returns one row
            raise RuntimeError("session insert returned no row")
        return PostgresDatabase._session_record(row)

    def create_session(
        self,
        jti: UUID,
        identity_id: UUID | None,
        role: Role | None,
        ttl_seconds: int,
    ) -> SessionRecord:
        with self._pool.connection() as connection:
            connection.execute(
                """
                DELETE FROM demo_sessions
                WHERE expires_at <= clock_timestamp() - interval '1 day'
                """
            )
            return self._insert_session(connection, jti, identity_id, role, ttl_seconds)

    def get_active_session(self, jti: UUID) -> SessionRecord | None:
        with self._pool.connection() as connection:
            row = connection.execute(
                """
                SELECT jti, identity_id, identity_role, issued_at, expires_at, revoked_at
                FROM demo_sessions
                WHERE jti = %s
                  AND revoked_at IS NULL
                  AND expires_at > clock_timestamp()
                """,
                (jti,),
            ).fetchone()
        return self._session_record(row) if row is not None else None

    def rotate_session(
        self,
        current_jti: UUID,
        new_jti: UUID,
        identity_id: UUID,
        role: Role,
        ttl_seconds: int,
    ) -> SessionRecord | None:
        with self._pool.connection() as connection, connection.transaction():
            revoked = connection.execute(
                """
                UPDATE demo_sessions
                SET revoked_at = clock_timestamp()
                WHERE jti = %s
                  AND revoked_at IS NULL
                  AND expires_at > clock_timestamp()
                RETURNING jti
                """,
                (current_jti,),
            ).fetchone()
            if revoked is None:
                return None
            return self._insert_session(
                connection,
                new_jti,
                identity_id,
                role,
                ttl_seconds,
            )

    def revoke_session(self, jti: UUID) -> bool:
        with self._pool.connection() as connection:
            row = connection.execute(
                """
                UPDATE demo_sessions
                SET revoked_at = clock_timestamp()
                WHERE jti = %s
                  AND revoked_at IS NULL
                  AND expires_at > clock_timestamp()
                RETURNING jti
                """,
                (jti,),
            ).fetchone()
        return row is not None
