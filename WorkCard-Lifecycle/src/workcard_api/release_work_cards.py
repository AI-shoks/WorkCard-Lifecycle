from __future__ import annotations

import re
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Final, Literal, Protocol
from uuid import UUID

from workcard_api.permissions import has_permission
from workcard_api.production_batches import TrustedActor, canonical_json_sha256

RELEASE_WORK_CARDS_COMMAND_TYPE: Final = "ReleaseWorkCards"
RELEASE_WORK_CARDS_PERMISSION: Final = "batch:release"
MAX_POSTGRES_INTEGER: Final = 2_147_483_647
MAX_NORM_HOURS: Final = Decimal("999999.99")
TWO_DECIMAL_PLACES: Final = Decimal("0.01")
ROOT_SNAPSHOT_KEYS: Final = frozenset(
    {
        "productionPassportId",
        "code",
        "revision",
        "productName",
        "operationPlans",
    }
)
OPERATION_PLAN_KEYS: Final = frozenset(
    {
        "operationPlanId",
        "position",
        "operationScope",
        "normHours",
        "plannedCardCount",
    }
)
OPERATION_SCOPE_KEYS: Final = frozenset({"code", "displayName"})
NORM_HOURS_PATTERN: Final = re.compile(r"(?:0|[1-9][0-9]*)\.[0-9]{2}")


class ReleaseWorkCardsFailure(Exception):
    """Base class for transport-independent release failures."""


class PermissionDenied(ReleaseWorkCardsFailure):
    pass


class ProductionBatchNotFound(ReleaseWorkCardsFailure):
    pass


class ProductionBatchInvalid(ReleaseWorkCardsFailure):
    pass


class BatchAlreadyReleased(ReleaseWorkCardsFailure):
    pass


class VersionConflict(ReleaseWorkCardsFailure):
    pass


class CommandAlreadyProcessed(ReleaseWorkCardsFailure):
    pass


class CommandIdReused(ReleaseWorkCardsFailure):
    pass


class ConcurrentCommandConflict(ReleaseWorkCardsFailure):
    pass


class UnexpectedPersistenceFailure(ReleaseWorkCardsFailure):
    pass


@dataclass(frozen=True, slots=True)
class ReleaseWorkCardsCommand:
    command_id: UUID
    batch_id: UUID
    expected_version: int


@dataclass(frozen=True, slots=True)
class ReleaseOperationPlan:
    operation_plan_id: UUID
    position: int
    operation_scope: Mapping[str, str]
    norm_hours: str
    planned_card_count: int


@dataclass(frozen=True, slots=True)
class WorkCardSetReleasePlan:
    set_id: UUID
    operation_plan: ReleaseOperationPlan
    work_card_ids: tuple[UUID, ...]


@dataclass(frozen=True, slots=True)
class ReleaseWorkCardSetResult:
    set_id: UUID
    operation_plan_id: UUID
    position: int
    operation_scope: Mapping[str, str]
    norm_hours: str
    planned_card_count: int
    gate_status: Literal["FIRST_ARTICLE_PENDING"]
    version: Literal[1]


@dataclass(frozen=True, slots=True)
class ReleaseWorkCardsResult:
    batch_id: UUID
    lifecycle_status: Literal["RELEASED"]
    version: Literal[2]
    set_count: int
    card_count_total: int
    work_card_sets: tuple[ReleaseWorkCardSetResult, ...]
    command_id: UUID
    correlation_id: UUID
    replayed: Literal[False] = False


class ReleaseWorkCardsGateway(Protocol):
    def release_work_cards(
        self,
        actor: TrustedActor,
        command: ReleaseWorkCardsCommand,
        request_hash: str,
    ) -> ReleaseWorkCardsResult: ...


class ReleaseWorkCardsHandler:
    def __init__(self, gateway: ReleaseWorkCardsGateway) -> None:
        self._gateway = gateway

    def handle(
        self,
        actor: TrustedActor,
        command: ReleaseWorkCardsCommand,
    ) -> ReleaseWorkCardsResult:
        if actor.role != "PLANNER" or not has_permission(actor.role, RELEASE_WORK_CARDS_PERMISSION):
            raise PermissionDenied
        if not isinstance(actor.actor_id, UUID):
            raise PermissionDenied
        if not isinstance(command.command_id, UUID) or not isinstance(command.batch_id, UUID):
            raise ProductionBatchInvalid
        if (
            type(command.expected_version) is not int
            or command.expected_version <= 0
            or command.expected_version > MAX_POSTGRES_INTEGER
        ):
            raise ProductionBatchInvalid
        request_hash = release_work_cards_request_hash(
            command.batch_id,
            command.expected_version,
        )
        return self._gateway.release_work_cards(actor, command, request_hash)


def release_work_cards_target_path(batch_id: UUID) -> str:
    return f"/api/v1/production-batches/{batch_id}/actions/release-work-cards"


def release_work_cards_request_hash(batch_id: UUID, expected_version: int) -> str:
    return canonical_json_sha256(release_work_cards_fingerprint(batch_id, expected_version))


def release_work_cards_fingerprint(
    batch_id: UUID,
    expected_version: int,
) -> dict[str, object]:
    return {
        "body": {"expectedVersion": expected_version},
        "commandType": RELEASE_WORK_CARDS_COMMAND_TYPE,
        "targetPath": release_work_cards_target_path(batch_id),
    }


def parse_release_operation_plans(
    passport_snapshot: object,
    expected_passport_id: UUID,
) -> tuple[ReleaseOperationPlan, ...]:
    snapshot = _exact_mapping(passport_snapshot, ROOT_SNAPSHOT_KEYS)
    passport_id = _canonical_uuid(snapshot["productionPassportId"])
    if passport_id != expected_passport_id:
        raise ProductionBatchInvalid
    _nonblank(snapshot["code"])
    _nonblank(snapshot["revision"])
    _nonblank(snapshot["productName"])

    raw_plans = snapshot["operationPlans"]
    if not isinstance(raw_plans, list) or not raw_plans:
        raise ProductionBatchInvalid

    plans: list[ReleaseOperationPlan] = []
    operation_plan_ids: set[UUID] = set()
    positions: set[int] = set()
    ordered_positions: list[int] = []
    for raw_plan in raw_plans:
        plan = _exact_mapping(raw_plan, OPERATION_PLAN_KEYS)
        operation_plan_id = _canonical_uuid(plan["operationPlanId"])
        position = _positive_integer(plan["position"])
        if operation_plan_id in operation_plan_ids or position in positions:
            raise ProductionBatchInvalid
        operation_plan_ids.add(operation_plan_id)
        positions.add(position)
        ordered_positions.append(position)

        raw_scope = _exact_mapping(plan["operationScope"], OPERATION_SCOPE_KEYS)
        operation_scope = {
            "code": _nonblank(raw_scope["code"]),
            "displayName": _nonblank(raw_scope["displayName"]),
        }
        plans.append(
            ReleaseOperationPlan(
                operation_plan_id=operation_plan_id,
                position=position,
                operation_scope=operation_scope,
                norm_hours=_norm_hours(plan["normHours"]),
                planned_card_count=_positive_integer(plan["plannedCardCount"]),
            )
        )

    if ordered_positions != sorted(ordered_positions):
        raise ProductionBatchInvalid
    return tuple(plans)


def build_release_plan(
    passport_snapshot: object,
    expected_passport_id: UUID,
    id_factory: Callable[[], UUID],
) -> tuple[WorkCardSetReleasePlan, ...]:
    operation_plans = parse_release_operation_plans(
        passport_snapshot,
        expected_passport_id,
    )
    generated_ids: set[UUID] = set()
    release_plan: list[WorkCardSetReleasePlan] = []
    for operation_plan in operation_plans:
        set_id = _generated_uuid(id_factory())
        if set_id in generated_ids:
            raise UnexpectedPersistenceFailure
        generated_ids.add(set_id)
        work_card_ids: list[UUID] = []
        for _ in range(operation_plan.planned_card_count):
            work_card_id = _generated_uuid(id_factory())
            if work_card_id in generated_ids:
                raise UnexpectedPersistenceFailure
            generated_ids.add(work_card_id)
            work_card_ids.append(work_card_id)
        if len(work_card_ids) != operation_plan.planned_card_count:
            raise UnexpectedPersistenceFailure
        release_plan.append(
            WorkCardSetReleasePlan(
                set_id=set_id,
                operation_plan=operation_plan,
                work_card_ids=tuple(work_card_ids),
            )
        )
    return tuple(release_plan)


def _exact_mapping(value: object, expected_keys: frozenset[str]) -> Mapping[str, object]:
    if not isinstance(value, Mapping) or set(value) != expected_keys:
        raise ProductionBatchInvalid
    return value


def _canonical_uuid(value: object) -> UUID:
    if not isinstance(value, str):
        raise ProductionBatchInvalid
    try:
        parsed = UUID(value)
    except ValueError as error:
        raise ProductionBatchInvalid from error
    if value != str(parsed):
        raise ProductionBatchInvalid
    return parsed


def _generated_uuid(value: object) -> UUID:
    if not isinstance(value, UUID):
        raise UnexpectedPersistenceFailure
    return value


def _nonblank(value: object) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ProductionBatchInvalid
    return value


def _positive_integer(value: object) -> int:
    if type(value) is not int or value <= 0 or value > MAX_POSTGRES_INTEGER:
        raise ProductionBatchInvalid
    return value


def _norm_hours(value: object) -> str:
    if not isinstance(value, str) or NORM_HOURS_PATTERN.fullmatch(value) is None:
        raise ProductionBatchInvalid
    try:
        parsed = Decimal(value)
        normalized = parsed.quantize(TWO_DECIMAL_PLACES)
    except (InvalidOperation, ValueError) as error:
        raise ProductionBatchInvalid from error
    if (
        not parsed.is_finite()
        or parsed <= 0
        or parsed > MAX_NORM_HOURS
        or normalized != parsed
        or value != format(normalized, ".2f")
    ):
        raise ProductionBatchInvalid
    return value
