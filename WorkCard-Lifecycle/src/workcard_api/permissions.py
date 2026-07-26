from __future__ import annotations

from typing import Final

from workcard_api.models import Role

ROLE_PERMISSIONS: Final[dict[Role, tuple[str, ...]]] = {
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


def has_permission(role: Role, permission: str) -> bool:
    return permission in ROLE_PERMISSIONS[role]
