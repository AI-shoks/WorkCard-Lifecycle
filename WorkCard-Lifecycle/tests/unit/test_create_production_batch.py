from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import replace
from decimal import Decimal
from typing import Any, cast
from uuid import UUID, uuid4

import pytest
from psycopg.errors import DeadlockDetected, UniqueViolation

from workcard_api.models import Role
from workcard_api.postgres_production_batches import (
    COMMAND_RECEIPTS_PRIMARY_KEY,
    PostgresCreateProductionBatchGateway,
    is_command_receipt_race,
)
from workcard_api.production_batches import (
    CREATE_PRODUCTION_BATCH_COMMAND_TYPE,
    CommandAlreadyProcessed,
    CommandIdReused,
    ConcurrentCommandConflict,
    CreateProductionBatchCommand,
    CreateProductionBatchHandler,
    CreateProductionBatchResult,
    OperationPlanRecord,
    PermissionDenied,
    ProductionBatchInvalid,
    ProductionPassportNotFound,
    ProductionPassportRecord,
    ProductionPassportSnapshot,
    TrustedActor,
    UnexpectedPersistenceFailure,
    build_production_passport_snapshot,
    canonical_json_sha256,
    create_production_batch_request_hash,
)

PLANNER_ID = UUID("10000000-0000-4000-8000-000000000001")
PASSPORT_ID = UUID("20000000-0000-4000-8000-000000000001")
PLAN_ID = UUID("21000000-0000-4000-8000-000000000001")
OPERATION_A_NAME = "Операция А"  # noqa: RUF001 - intentional Russian test data


class FakeCreateProductionBatchGateway:
    def __init__(self) -> None:
        self.calls: list[tuple[TrustedActor, CreateProductionBatchCommand, str]] = []
        self.failure: Exception | None = None

    def create_production_batch(
        self,
        actor: TrustedActor,
        command: CreateProductionBatchCommand,
        request_hash: str,
    ) -> CreateProductionBatchResult:
        self.calls.append((actor, command, request_hash))
        if self.failure is not None:
            raise self.failure
        snapshot = valid_snapshot()
        return CreateProductionBatchResult(
            batch_id=uuid4(),
            production_passport_id=command.production_passport_id,
            quantity=command.quantity,
            lifecycle_status="CREATED",
            version=1,
            passport_snapshot=snapshot,
            command_id=command.command_id,
            correlation_id=uuid4(),
        )


class FakeQueryResult:
    def __init__(
        self,
        *,
        row: tuple[object, ...] | None = None,
        rows: list[tuple[object, ...]] | None = None,
    ) -> None:
        self._row = row
        self._rows = rows or []

    def fetchone(self) -> tuple[object, ...] | None:
        return self._row

    def fetchall(self) -> list[tuple[object, ...]]:
        return self._rows


class FakeConnection:
    def __init__(
        self,
        *,
        receipt: tuple[object, ...] | None = None,
        passport_rows: list[tuple[object, ...]] | None = None,
    ) -> None:
        self.receipt = receipt
        self.passport_rows = passport_rows or []
        self.statements: list[str] = []
        self.transaction_exited = False

    @contextmanager
    def transaction(self) -> Iterator[None]:
        try:
            yield
        finally:
            self.transaction_exited = True

    def execute(
        self,
        query: str,
        params: object = None,
    ) -> FakeQueryResult:
        del params
        normalized = " ".join(query.split())
        self.statements.append(normalized)
        if "SELECT command_type, request_hash" in normalized:
            return FakeQueryResult(row=self.receipt)
        if "FROM production_passports AS passport" in normalized:
            return FakeQueryResult(rows=self.passport_rows)
        return FakeQueryResult()


class FakePostgresDatabase:
    def __init__(self, connections: list[FakeConnection | Exception]) -> None:
        self.connections = connections

    @contextmanager
    def connection(self) -> Iterator[FakeConnection]:
        selected = self.connections.pop(0)
        if isinstance(selected, Exception):
            raise selected
        yield selected


class FakeUniqueViolation:
    class Diag:
        def __init__(self, constraint_name: str | None) -> None:
            self.constraint_name = constraint_name

    def __init__(self, constraint_name: str | None) -> None:
        self.diag = self.Diag(constraint_name)


def valid_passport() -> ProductionPassportRecord:
    return ProductionPassportRecord(
        production_passport_id=PASSPORT_ID,
        code="SYNTH-PWC-112",
        revision="1",
        product_name="Синтетическое изделие",
        active=True,
    )


def valid_plan(
    *,
    operation_scope: dict[str, object] | None = None,
) -> OperationPlanRecord:
    return OperationPlanRecord(
        operation_plan_id=PLAN_ID,
        position=1,
        operation_scope=operation_scope or {"code": "SYN-OP-10", "displayName": OPERATION_A_NAME},
        norm_hours=Decimal("1.50"),
        planned_card_count=112,
    )


def valid_snapshot() -> ProductionPassportSnapshot:
    return build_production_passport_snapshot(valid_passport(), [valid_plan()])


def valid_command(*, quantity: int = 112) -> CreateProductionBatchCommand:
    return CreateProductionBatchCommand(
        command_id=uuid4(),
        production_passport_id=PASSPORT_ID,
        quantity=quantity,
    )


def valid_passport_rows() -> list[tuple[object, ...]]:
    return [
        (
            PASSPORT_ID,
            "SYNTH-PWC-112",
            "1",
            "Синтетическое изделие",
            True,
            PLAN_ID,
            1,
            {"code": "SYN-OP-10", "displayName": OPERATION_A_NAME},
            Decimal("1.50"),
            112,
        )
    ]


def test_canonical_request_hash_matches_control_value() -> None:
    assert (
        create_production_batch_request_hash(UUID("00000000-0000-0000-0000-000000000000"), 112)
        == "7fc64c99fe76535b4990792ca88efb1379bc16ca9317243062618f8c9f4a3057"
    )


def test_canonical_json_recursively_sorts_keys_without_whitespace() -> None:
    left = {"z": 1, "a": {"y": 2, "b": 3}}
    right = {"a": {"b": 3, "y": 2}, "z": 1}
    assert canonical_json_sha256(left) == canonical_json_sha256(right)


def test_handler_uses_permission_then_passes_canonical_hash_to_gateway() -> None:
    gateway = FakeCreateProductionBatchGateway()
    handler = CreateProductionBatchHandler(gateway)
    actor = TrustedActor(PLANNER_ID, "PLANNER")
    command = valid_command()

    result = handler.handle(actor, command)

    assert gateway.calls == [
        (
            actor,
            command,
            create_production_batch_request_hash(PASSPORT_ID, 112),
        )
    ]
    assert result.command_id == command.command_id
    assert result.production_passport_id == PASSPORT_ID
    assert result.quantity == 112
    assert result.lifecycle_status == "CREATED"
    assert result.version == 1
    assert result.replayed is False


@pytest.mark.parametrize(
    "role",
    ["MASTER", "WORKER", "QUALITY_CONTROLLER", "ADMIN_AUDITOR"],
)
def test_permission_is_checked_before_gateway(role: Role) -> None:
    gateway = FakeCreateProductionBatchGateway()
    handler = CreateProductionBatchHandler(gateway)

    with pytest.raises(PermissionDenied):
        handler.handle(TrustedActor(uuid4(), role), valid_command())

    assert gateway.calls == []


@pytest.mark.parametrize("quantity", [0, -1, True, False])
def test_non_positive_and_boolean_quantity_are_rejected_before_gateway(quantity: object) -> None:
    gateway = FakeCreateProductionBatchGateway()
    handler = CreateProductionBatchHandler(gateway)
    command = replace(valid_command(), quantity=cast(int, quantity))

    with pytest.raises(ProductionBatchInvalid):
        handler.handle(TrustedActor(PLANNER_ID, "PLANNER"), command)

    assert gateway.calls == []


def test_postgresql_integer_max_quantity_is_passed_to_gateway() -> None:
    gateway = FakeCreateProductionBatchGateway()
    handler = CreateProductionBatchHandler(gateway)
    command = valid_command(quantity=2_147_483_647)

    result = handler.handle(TrustedActor(PLANNER_ID, "PLANNER"), command)

    assert gateway.calls == [
        (
            TrustedActor(PLANNER_ID, "PLANNER"),
            command,
            create_production_batch_request_hash(PASSPORT_ID, 2_147_483_647),
        )
    ]
    assert result.quantity == 2_147_483_647


def test_quantity_above_postgresql_integer_max_is_rejected_before_gateway() -> None:
    gateway = FakeCreateProductionBatchGateway()
    handler = CreateProductionBatchHandler(gateway)

    with pytest.raises(ProductionBatchInvalid):
        handler.handle(
            TrustedActor(PLANNER_ID, "PLANNER"),
            valid_command(quantity=2_147_483_648),
        )

    assert gateway.calls == []


def test_typed_gateway_failure_is_preserved() -> None:
    gateway = FakeCreateProductionBatchGateway()
    gateway.failure = CommandAlreadyProcessed()

    with pytest.raises(CommandAlreadyProcessed):
        CreateProductionBatchHandler(gateway).handle(
            TrustedActor(PLANNER_ID, "PLANNER"), valid_command()
        )


def test_postgres_gateway_commits_result_after_batch_receipt_and_event_writes() -> None:
    connection = FakeConnection(passport_rows=valid_passport_rows())
    database = FakePostgresDatabase([connection])
    generated = iter(
        [
            UUID("30000000-0000-4000-8000-000000000001"),
            UUID("30000000-0000-4000-8000-000000000002"),
            UUID("30000000-0000-4000-8000-000000000003"),
        ]
    )
    gateway = PostgresCreateProductionBatchGateway(
        cast(Any, database),
        id_factory=lambda: next(generated),
    )

    result = CreateProductionBatchHandler(gateway).handle(
        TrustedActor(PLANNER_ID, "PLANNER"), valid_command()
    )

    assert connection.transaction_exited is True
    assert result.batch_id == UUID("30000000-0000-4000-8000-000000000001")
    assert result.correlation_id == UUID("30000000-0000-4000-8000-000000000002")
    assert [statement.split(" ", maxsplit=2)[:2] for statement in connection.statements] == [
        ["SELECT", "command_type,"],
        ["SELECT", "passport.id,"],
        ["INSERT", "INTO"],
        ["INSERT", "INTO"],
        ["INSERT", "INTO"],
    ]
    assert "ORDER BY plan.position ASC NULLS LAST" in connection.statements[1]


@pytest.mark.parametrize(
    ("receipt", "failure"),
    [
        (
            (
                "CreateProductionBatch",
                create_production_batch_request_hash(PASSPORT_ID, 112),
            ),
            CommandAlreadyProcessed,
        ),
        (("ReleaseWorkCards", "0" * 64), CommandIdReused),
    ],
)
def test_postgres_gateway_checks_receipt_before_passport_lookup(
    receipt: tuple[object, ...],
    failure: type[Exception],
) -> None:
    connection = FakeConnection(receipt=receipt, passport_rows=valid_passport_rows())
    gateway = PostgresCreateProductionBatchGateway(cast(Any, FakePostgresDatabase([connection])))

    with pytest.raises(failure):
        CreateProductionBatchHandler(gateway).handle(
            TrustedActor(PLANNER_ID, "PLANNER"), valid_command()
        )

    assert len(connection.statements) == 1
    assert connection.transaction_exited is True


def test_postgres_gateway_returns_typed_missing_passport() -> None:
    gateway = PostgresCreateProductionBatchGateway(
        cast(Any, FakePostgresDatabase([FakeConnection()]))
    )

    with pytest.raises(ProductionPassportNotFound):
        CreateProductionBatchHandler(gateway).handle(
            TrustedActor(PLANNER_ID, "PLANNER"), valid_command()
        )


@pytest.mark.parametrize(
    ("database_error", "failure"),
    [
        (DeadlockDetected(), ConcurrentCommandConflict),
        (RuntimeError("synthetic persistence failure"), UnexpectedPersistenceFailure),
        (UniqueViolation(), UnexpectedPersistenceFailure),
    ],
)
def test_postgres_gateway_maps_database_boundary_failures(
    database_error: Exception,
    failure: type[Exception],
) -> None:
    gateway = PostgresCreateProductionBatchGateway(
        cast(Any, FakePostgresDatabase([database_error]))
    )

    with pytest.raises(failure):
        CreateProductionBatchHandler(gateway).handle(
            TrustedActor(PLANNER_ID, "PLANNER"), valid_command()
        )


def test_receipt_race_classifier_requires_exact_constraint_name() -> None:
    assert is_command_receipt_race(
        cast(UniqueViolation, FakeUniqueViolation(COMMAND_RECEIPTS_PRIMARY_KEY))
    )
    assert not is_command_receipt_race(
        cast(UniqueViolation, FakeUniqueViolation("audit_events_pkey"))
    )


def test_receipt_race_is_reread_after_rollback_and_compared_normally(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request_hash = create_production_batch_request_hash(PASSPORT_ID, 112)
    database = FakePostgresDatabase(
        [
            UniqueViolation(),
            FakeConnection(receipt=(CREATE_PRODUCTION_BATCH_COMMAND_TYPE, request_hash)),
        ]
    )
    monkeypatch.setattr(
        "workcard_api.postgres_production_batches.is_command_receipt_race",
        lambda error: True,
    )
    gateway = PostgresCreateProductionBatchGateway(cast(Any, database))

    with pytest.raises(CommandAlreadyProcessed):
        CreateProductionBatchHandler(gateway).handle(
            TrustedActor(PLANNER_ID, "PLANNER"), valid_command()
        )


def test_receipt_race_without_committed_winner_is_concurrent_conflict(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database = FakePostgresDatabase([UniqueViolation(), FakeConnection()])
    monkeypatch.setattr(
        "workcard_api.postgres_production_batches.is_command_receipt_race",
        lambda error: True,
    )
    gateway = PostgresCreateProductionBatchGateway(cast(Any, database))

    with pytest.raises(ConcurrentCommandConflict):
        CreateProductionBatchHandler(gateway).handle(
            TrustedActor(PLANNER_ID, "PLANNER"), valid_command()
        )


def test_receipt_race_reread_failure_is_unexpected_persistence_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database = FakePostgresDatabase(
        [UniqueViolation(), RuntimeError("synthetic receipt reread failure")]
    )
    monkeypatch.setattr(
        "workcard_api.postgres_production_batches.is_command_receipt_race",
        lambda error: True,
    )
    gateway = PostgresCreateProductionBatchGateway(cast(Any, database))

    with pytest.raises(UnexpectedPersistenceFailure):
        CreateProductionBatchHandler(gateway).handle(
            TrustedActor(PLANNER_ID, "PLANNER"), valid_command()
        )


def test_snapshot_sorts_plans_allowlists_scope_and_formats_norm_hours() -> None:
    first_scope: dict[str, object] = {
        "displayName": OPERATION_A_NAME,
        "members": ["discarded"],
        "code": "SYN-OP-10",
        "unknown": True,
    }
    second = replace(
        valid_plan(),
        operation_plan_id=UUID("21000000-0000-4000-8000-000000000002"),
        position=2,
        norm_hours=Decimal("2"),
        planned_card_count=26,
        operation_scope={"code": "SYN-OP-20", "displayName": "Операция Б"},
    )

    snapshot = build_production_passport_snapshot(
        valid_passport(),
        [second, valid_plan(operation_scope=first_scope)],
    )
    first_scope["code"] = "CHANGED"

    assert snapshot.to_json() == {
        "productionPassportId": str(PASSPORT_ID),
        "code": "SYNTH-PWC-112",
        "revision": "1",
        "productName": "Синтетическое изделие",
        "operationPlans": [
            {
                "operationPlanId": str(PLAN_ID),
                "position": 1,
                "operationScope": {
                    "code": "SYN-OP-10",
                    "displayName": OPERATION_A_NAME,
                },
                "normHours": "1.50",
                "plannedCardCount": 112,
            },
            {
                "operationPlanId": "21000000-0000-4000-8000-000000000002",
                "position": 2,
                "operationScope": {
                    "code": "SYN-OP-20",
                    "displayName": "Операция Б",
                },
                "normHours": "2.00",
                "plannedCardCount": 26,
            },
        ],
    }


@pytest.mark.parametrize(
    ("passport", "plans"),
    [
        (replace(valid_passport(), active=False), [valid_plan()]),
        (replace(valid_passport(), code=" "), [valid_plan()]),
        (valid_passport(), []),
        (valid_passport(), [replace(valid_plan(), position=0)]),
        (valid_passport(), [replace(valid_plan(), planned_card_count=0)]),
        (valid_passport(), [replace(valid_plan(), norm_hours=Decimal("0"))]),
        (valid_passport(), [replace(valid_plan(), norm_hours=Decimal("1.234"))]),
        (valid_passport(), [replace(valid_plan(), norm_hours=Decimal("1000000.00"))]),
        (valid_passport(), [valid_plan(operation_scope={"code": "", "displayName": "X"})]),
        (valid_passport(), [valid_plan(operation_scope={"code": "X"})]),
    ],
)
def test_invalid_persisted_passport_or_plans_are_not_repaired(
    passport: ProductionPassportRecord,
    plans: list[OperationPlanRecord],
) -> None:
    with pytest.raises(ProductionBatchInvalid):
        build_production_passport_snapshot(passport, plans)
