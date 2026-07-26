from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Final, Literal, Protocol
from uuid import UUID

from workcard_api.models import Role
from workcard_api.permissions import has_permission

CREATE_PRODUCTION_BATCH_COMMAND_TYPE: Final = "CreateProductionBatch"
CREATE_PRODUCTION_BATCH_TARGET_PATH: Final = "/api/v1/production-batches"
BATCH_CREATE_PERMISSION: Final = "batch:create"
MAX_BATCH_QUANTITY: Final = 2_147_483_647
MAX_NORM_HOURS: Final = Decimal("999999.99")
TWO_DECIMAL_PLACES: Final = Decimal("0.01")


class CreateProductionBatchFailure(Exception):
    """Base class for transport-independent create-batch failures."""


class PermissionDenied(CreateProductionBatchFailure):
    pass


class ProductionPassportNotFound(CreateProductionBatchFailure):
    pass


class ProductionBatchInvalid(CreateProductionBatchFailure):
    pass


class CommandAlreadyProcessed(CreateProductionBatchFailure):
    pass


class CommandIdReused(CreateProductionBatchFailure):
    pass


class ConcurrentCommandConflict(CreateProductionBatchFailure):
    pass


class UnexpectedPersistenceFailure(CreateProductionBatchFailure):
    pass


@dataclass(frozen=True, slots=True)
class TrustedActor:
    actor_id: UUID
    role: Role


@dataclass(frozen=True, slots=True)
class CreateProductionBatchCommand:
    command_id: UUID
    production_passport_id: UUID
    quantity: int


@dataclass(frozen=True, slots=True)
class OperationScopeSnapshot:
    code: str
    display_name: str

    def to_json(self) -> dict[str, object]:
        return {"code": self.code, "displayName": self.display_name}


@dataclass(frozen=True, slots=True)
class OperationPlanSnapshot:
    operation_plan_id: UUID
    position: int
    operation_scope: OperationScopeSnapshot
    norm_hours: str
    planned_card_count: int

    def to_json(self) -> dict[str, object]:
        return {
            "operationPlanId": str(self.operation_plan_id),
            "position": self.position,
            "operationScope": self.operation_scope.to_json(),
            "normHours": self.norm_hours,
            "plannedCardCount": self.planned_card_count,
        }


@dataclass(frozen=True, slots=True)
class ProductionPassportSnapshot:
    production_passport_id: UUID
    code: str
    revision: str
    product_name: str
    operation_plans: tuple[OperationPlanSnapshot, ...]

    def to_json(self) -> dict[str, object]:
        return {
            "productionPassportId": str(self.production_passport_id),
            "code": self.code,
            "revision": self.revision,
            "productName": self.product_name,
            "operationPlans": [plan.to_json() for plan in self.operation_plans],
        }


@dataclass(frozen=True, slots=True)
class CreateProductionBatchResult:
    batch_id: UUID
    production_passport_id: UUID
    quantity: int
    lifecycle_status: Literal["CREATED"]
    version: Literal[1]
    passport_snapshot: ProductionPassportSnapshot
    command_id: UUID
    correlation_id: UUID
    replayed: Literal[False] = False


@dataclass(frozen=True, slots=True)
class ProductionPassportRecord:
    production_passport_id: UUID
    code: str
    revision: str
    product_name: str
    active: bool


@dataclass(frozen=True, slots=True)
class OperationPlanRecord:
    operation_plan_id: UUID
    position: int
    operation_scope: Mapping[str, object]
    norm_hours: Decimal
    planned_card_count: int


class CreateProductionBatchGateway(Protocol):
    def create_production_batch(
        self,
        actor: TrustedActor,
        command: CreateProductionBatchCommand,
        request_hash: str,
    ) -> CreateProductionBatchResult: ...


class CreateProductionBatchHandler:
    def __init__(self, gateway: CreateProductionBatchGateway) -> None:
        self._gateway = gateway

    def handle(
        self,
        actor: TrustedActor,
        command: CreateProductionBatchCommand,
    ) -> CreateProductionBatchResult:
        if actor.role != "PLANNER" or not has_permission(actor.role, BATCH_CREATE_PERMISSION):
            raise PermissionDenied
        if not isinstance(actor.actor_id, UUID):
            raise PermissionDenied
        if not isinstance(command.command_id, UUID) or not isinstance(
            command.production_passport_id, UUID
        ):
            raise ProductionBatchInvalid
        if (
            type(command.quantity) is not int
            or command.quantity <= 0
            or command.quantity > MAX_BATCH_QUANTITY
        ):
            raise ProductionBatchInvalid
        request_hash = create_production_batch_request_hash(
            command.production_passport_id,
            command.quantity,
        )
        return self._gateway.create_production_batch(actor, command, request_hash)


def canonical_json_sha256(value: object) -> str:
    canonical_json = json.dumps(
        value,
        ensure_ascii=False,
        allow_nan=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()


def create_production_batch_request_hash(
    production_passport_id: UUID,
    quantity: int,
) -> str:
    return canonical_json_sha256(
        {
            "body": {
                "productionPassportId": str(production_passport_id),
                "quantity": quantity,
            },
            "commandType": CREATE_PRODUCTION_BATCH_COMMAND_TYPE,
            "targetPath": CREATE_PRODUCTION_BATCH_TARGET_PATH,
        }
    )


def build_production_passport_snapshot(
    passport: ProductionPassportRecord,
    plans: Sequence[OperationPlanRecord],
) -> ProductionPassportSnapshot:
    passport_id = _uuid(passport.production_passport_id)
    if passport.active is not True:
        raise ProductionBatchInvalid
    code = _nonblank(passport.code)
    revision = _nonblank(passport.revision)
    product_name = _nonblank(passport.product_name)
    if not plans:
        raise ProductionBatchInvalid

    sorted_plans = sorted(plans, key=lambda plan: plan.position)
    positions: set[int] = set()
    operation_plans: list[OperationPlanSnapshot] = []
    for plan in sorted_plans:
        position = _positive_integer(plan.position)
        if position in positions:
            raise ProductionBatchInvalid
        positions.add(position)
        operation_scope = plan.operation_scope
        if not isinstance(operation_scope, Mapping):
            raise ProductionBatchInvalid
        operation_plans.append(
            OperationPlanSnapshot(
                operation_plan_id=_uuid(plan.operation_plan_id),
                position=position,
                operation_scope=OperationScopeSnapshot(
                    code=_nonblank(operation_scope.get("code")),
                    display_name=_nonblank(operation_scope.get("displayName")),
                ),
                norm_hours=_norm_hours(plan.norm_hours),
                planned_card_count=_positive_integer(plan.planned_card_count),
            )
        )

    return ProductionPassportSnapshot(
        production_passport_id=passport_id,
        code=code,
        revision=revision,
        product_name=product_name,
        operation_plans=tuple(operation_plans),
    )


def _uuid(value: object) -> UUID:
    if not isinstance(value, UUID):
        raise ProductionBatchInvalid
    return value


def _nonblank(value: object) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ProductionBatchInvalid
    return value


def _positive_integer(value: object) -> int:
    if type(value) is not int or value <= 0:
        raise ProductionBatchInvalid
    return value


def _norm_hours(value: object) -> str:
    if not isinstance(value, Decimal) or not value.is_finite():
        raise ProductionBatchInvalid
    if value <= 0 or value > MAX_NORM_HOURS:
        raise ProductionBatchInvalid
    try:
        normalized = value.quantize(TWO_DECIMAL_PLACES)
    except InvalidOperation as error:
        raise ProductionBatchInvalid from error
    if normalized != value:
        raise ProductionBatchInvalid
    return format(normalized, ".2f")
