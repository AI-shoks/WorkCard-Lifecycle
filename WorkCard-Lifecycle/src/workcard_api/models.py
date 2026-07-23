from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal
from uuid import UUID

Role = Literal["PLANNER", "MASTER", "WORKER", "QUALITY_CONTROLLER", "ADMIN_AUDITOR"]


@dataclass(frozen=True, slots=True)
class DemoIdentity:
    id: UUID
    display_name: str
    role: Role


@dataclass(frozen=True, slots=True)
class SessionRecord:
    jti: UUID
    identity_id: UUID | None
    role: Role | None
    issued_at: datetime
    expires_at: datetime
    revoked_at: datetime | None = None
