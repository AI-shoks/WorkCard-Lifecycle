from __future__ import annotations

import hashlib
import hmac
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Final
from uuid import UUID, uuid4

from fastapi import Request
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from workcard_api.config import Settings
from workcard_api.database import DatabaseGateway
from workcard_api.errors import Problem, ProblemError
from workcard_api.models import DemoIdentity, Role, SessionRecord

COOKIE_NAME: Final = "workcard_demo_session"
CSRF_HEADER: Final = "X-CSRF-Token"

ROLE_PERMISSIONS: dict[Role, tuple[str, ...]] = {
    "PLANNER": ("passport:read", "batch:read", "batch:create", "batch:release"),
    "MASTER": ("passport:read", "batch:read", "card:read", "card:assign", "card:record"),
    "WORKER": ("passport:read", "batch:read", "card:read-own"),
    "QUALITY_CONTROLLER": (
        "passport:read",
        "batch:read",
        "card:read",
        "quality:record",
        "batch:final-accept",
    ),
    "ADMIN_AUDITOR": (
        "passport:read",
        "batch:read",
        "card:read",
        "audit:read",
        "payroll:export-mock",
    ),
}


@dataclass(frozen=True, slots=True)
class SessionData:
    jti: UUID
    identity_id: UUID | None
    role: Role | None
    issued_at: datetime
    expires_at: datetime


class SessionManager:
    def __init__(self, settings: Settings, database: DatabaseGateway) -> None:
        self._secret = settings.session_signing_secret.get_secret_value()
        self._ttl = settings.session_ttl_seconds
        self._database = database
        self._serializer = URLSafeTimedSerializer(
            self._secret,
            salt="workcard-demo-session-v1",
            signer_kwargs={"digest_method": hashlib.sha256},
        )

    @staticmethod
    def _data(record: SessionRecord) -> SessionData:
        return SessionData(
            jti=record.jti,
            identity_id=record.identity_id,
            role=record.role,
            issued_at=record.issued_at,
            expires_at=record.expires_at,
        )

    def _cookie(self, jti: UUID) -> str:
        return self._serializer.dumps({"jti": str(jti)})

    def create(
        self,
        identity_id: UUID | None = None,
        role: Role | None = None,
    ) -> tuple[str, str, SessionData]:
        jti = uuid4()
        session = self._data(self._database.create_session(jti, identity_id, role, self._ttl))
        return self._cookie(jti), self.csrf_for(session), session

    def rotate(
        self,
        current: SessionData,
        identity_id: UUID,
        role: Role,
    ) -> tuple[str, str, SessionData]:
        new_jti = uuid4()
        record = self._database.rotate_session(
            current.jti,
            new_jti,
            identity_id,
            role,
            self._ttl,
        )
        if record is None:
            raise unauthorized()
        session = self._data(record)
        return self._cookie(new_jti), self.csrf_for(session), session

    def load(self, cookie: str | None) -> SessionData:
        if not cookie:
            raise unauthorized()
        try:
            payload = self._serializer.loads(cookie, max_age=self._ttl)
            jti = UUID(str(payload["jti"]))
        except (BadSignature, SignatureExpired, KeyError, TypeError, ValueError) as error:
            raise unauthorized() from error
        record = self._database.get_active_session(jti)
        if record is None:
            raise unauthorized()
        return self._data(record)

    def revoke(self, session: SessionData) -> None:
        if not self._database.revoke_session(session.jti):
            raise unauthorized()

    @staticmethod
    def remaining_ttl_seconds(session: SessionData) -> int:
        return max(0, int((session.expires_at - datetime.now(UTC)).total_seconds()))

    def verify_csrf(self, session: SessionData, token: str | None) -> None:
        if not token or not hmac.compare_digest(token, self.csrf_for(session)):
            raise ProblemError(
                Problem(
                    status=403,
                    code="CSRF_VALIDATION_FAILED",
                    title="Запрос отклонён",
                    detail="Обновите страницу и повторите действие.",
                    type_slug="csrf-validation-failed",
                )
            )

    def csrf_for(self, session: SessionData) -> str:
        return hmac.new(
            self._secret.encode(),
            f"csrf:{session.jti}".encode(),
            hashlib.sha256,
        ).hexdigest()


def unauthorized() -> ProblemError:
    return ProblemError(
        Problem(
            status=401,
            code="SESSION_REQUIRED",
            title="Требуется демонстрационная сессия",
            detail="Выберите подготовленную демонстрационную роль.",
            type_slug="session-required",
        )
    )


def validate_origin(request: Request, settings: Settings) -> None:
    origin = request.headers.get("origin")
    fetch_site = request.headers.get("sec-fetch-site")
    if origin not in settings.allowed_origins or fetch_site == "cross-site":
        raise ProblemError(
            Problem(
                status=403,
                code="ORIGIN_NOT_ALLOWED",
                title="Источник запроса не разрешён",
                detail="Выполните действие из локального интерфейса приложения.",
                type_slug="origin-not-allowed",
            )
        )


def authenticated_identity(
    request: Request,
    sessions: SessionManager,
    database: DatabaseGateway,
) -> tuple[SessionData, DemoIdentity]:
    session = sessions.load(request.cookies.get(COOKIE_NAME))
    if session.identity_id is None:
        raise unauthorized()
    identity = database.get_demo_identity(session.identity_id)
    if identity is None or session.role != identity.role:
        raise unauthorized()
    return session, identity
