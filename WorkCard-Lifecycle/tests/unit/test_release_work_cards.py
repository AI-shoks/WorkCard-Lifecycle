from __future__ import annotations

import copy
import json
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import replace
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any, cast
from uuid import UUID, uuid4

import pytest
from psycopg.errors import DeadlockDetected, UniqueViolation
from psycopg.types.json import Jsonb

from workcard_api.models import Role
from workcard_api.postgres_release_work_cards import (
    COMMAND_RECEIPTS_PRIMARY_KEY,
    PostgresReleaseWorkCardsGateway,
    is_command_receipt_race,
)
from workcard_api.production_batches import TrustedActor
from workcard_api.release_work_cards import (
    BatchAlreadyReleased,
    CommandAlreadyProcessed,
    CommandIdReused,
    ConcurrentCommandConflict,
    PermissionDenied,
    ProductionBatchInvalid,
    ProductionBatchNotFound,
    ReleaseWorkCardsCommand,
    ReleaseWorkCardSetResult,
    ReleaseWorkCardsGateway,
    ReleaseWorkCardsHandler,
    ReleaseWorkCardsResult,
    UnexpectedPersistenceFailure,
    VersionConflict,
    build_release_plan,
    parse_release_operation_plans,
    release_work_cards_fingerprint,
    release_work_cards_request_hash,
    release_work_cards_target_path,
)

PLANNER_ID = UUID("10000000-0000-4000-8000-000000000001")
BATCH_ID = UUID("00000000-0000-0000-0000-000000000000")
PASSPORT_ID = UUID("20000000-0000-4000-8000-000000000001")
FIRST_PLAN_ID = UUID("21000000-0000-4000-8000-000000000001")
SECOND_PLAN_ID = UUID("21000000-0000-4000-8000-000000000002")


class FakeReleaseWorkCardsGateway:
    def __init__(self) -> None:
        self.calls: list[tuple[TrustedActor, ReleaseWorkCardsCommand, str]] = []
        self.failure: Exception | None = None

    def release_work_cards(
        self,
        actor: TrustedActor,
        command: ReleaseWorkCardsCommand,
        request_hash: str,
    ) -> ReleaseWorkCardsResult:
        self.calls.append((actor, command, request_hash))
        if self.failure is not None:
            raise self.failure
        return ReleaseWorkCardsResult(
            batch_id=command.batch_id,
            lifecycle_status="RELEASED",
            version=2,
            set_count=1,
            card_count_total=2,
            work_card_sets=(
                ReleaseWorkCardSetResult(
                    set_id=uuid4(),
                    operation_plan_id=FIRST_PLAN_ID,
                    position=1,
                    operation_scope={
                        "code": "OP-10",
                        "displayName": "Операция А",  # noqa: RUF001
                    },
                    norm_hours="1.25",
                    planned_card_count=2,
                    gate_status="FIRST_ARTICLE_PENDING",
                    version=1,
                ),
            ),
            command_id=command.command_id,
            correlation_id=uuid4(),
        )


class FakeUniqueViolation:
    class Diag:
        def __init__(self, constraint_name: str | None) -> None:
            self.constraint_name = constraint_name

    def __init__(self, constraint_name: str | None) -> None:
        self.diag = self.Diag(constraint_name)


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


class ScriptedCursor:
    def __init__(self, connection: ScriptedConnection) -> None:
        self._connection = connection

    def __enter__(self) -> ScriptedCursor:
        return self

    def __exit__(self, *args: object) -> None:
        del args

    def executemany(self, query: str, params: object) -> None:
        assert isinstance(params, list)
        self._connection.bulk_calls.append((" ".join(query.split()), params))


class ScriptedConnection:
    def __init__(
        self,
        *,
        receipt: tuple[object, ...] | None = None,
        batch_row: tuple[object, ...] | None = None,
        has_sets: bool = False,
        set_rows: list[tuple[object, ...]] | None = None,
        card_rows: list[tuple[object, ...]] | None = None,
        update_row: tuple[object, ...] | None = None,
        event_count: int = 4,
    ) -> None:
        self.receipt = receipt
        self.batch_row = batch_row
        self.has_sets = has_sets
        self.set_rows = set_rows or []
        self.card_rows = card_rows or []
        self.update_row = update_row
        self.event_count = event_count
        self.statements: list[str] = []
        self.execute_calls: list[tuple[str, object]] = []
        self.bulk_calls: list[tuple[str, list[object]]] = []
        self.transaction_exited = False

    @contextmanager
    def transaction(self) -> Iterator[None]:
        try:
            yield
        finally:
            self.transaction_exited = True

    def cursor(self) -> ScriptedCursor:
        return ScriptedCursor(self)

    def execute(self, query: str, params: object = None) -> FakeQueryResult:
        normalized = " ".join(query.split())
        self.statements.append(normalized)
        self.execute_calls.append((normalized, params))
        if "SELECT command_type, request_hash" in normalized:
            return FakeQueryResult(row=self.receipt)
        if "FROM production_batches" in normalized and "FOR UPDATE" in normalized:
            return FakeQueryResult(row=self.batch_row)
        if normalized.startswith("SELECT EXISTS"):
            return FakeQueryResult(row=(self.has_sets,))
        if "FROM work_card_sets WHERE batch_id" in normalized:
            return FakeQueryResult(rows=self.set_rows)
        if "FROM work_cards WHERE batch_id" in normalized and "GROUP BY set_id" in normalized:
            return FakeQueryResult(rows=self.card_rows)
        if normalized.startswith("UPDATE production_batches"):
            return FakeQueryResult(row=self.update_row)
        if normalized.startswith("SELECT count(*) FROM audit_events"):
            return FakeQueryResult(row=(self.event_count,))
        return FakeQueryResult()


class FakePostgresDatabase:
    def __init__(self, connections: list[ScriptedConnection | Exception]) -> None:
        self.connections = connections

    @contextmanager
    def connection(self) -> Iterator[ScriptedConnection]:
        selected = self.connections.pop(0)
        if isinstance(selected, Exception):
            raise selected
        yield selected


def valid_command(
    *,
    command_id: UUID | None = None,
    batch_id: UUID = BATCH_ID,
    expected_version: int = 1,
) -> ReleaseWorkCardsCommand:
    return ReleaseWorkCardsCommand(
        command_id=command_id or uuid4(),
        batch_id=batch_id,
        expected_version=expected_version,
    )


def valid_snapshot() -> dict[str, Any]:
    return {
        "productionPassportId": str(PASSPORT_ID),
        "code": "SYNTH-PWC-112",
        "revision": "1",
        "productName": "Синтетическое изделие",
        "operationPlans": [
            {
                "operationPlanId": str(FIRST_PLAN_ID),
                "position": 1,
                "operationScope": {
                    "code": "OP-10",
                    "displayName": "Операция А",  # noqa: RUF001
                },
                "normHours": "1.25",
                "plannedCardCount": 2,
            },
            {
                "operationPlanId": str(SECOND_PLAN_ID),
                "position": 3,
                "operationScope": {
                    "code": "OP-30",
                    "displayName": "Операция Б",
                },
                "normHours": "2.00",
                "plannedCardCount": 1,
            },
        ],
    }


def test_release_fingerprint_and_control_sha256_are_exact() -> None:
    fingerprint = release_work_cards_fingerprint(BATCH_ID, 1)
    canonical_json = json.dumps(
        fingerprint,
        ensure_ascii=False,
        allow_nan=False,
        sort_keys=True,
        separators=(",", ":"),
    )

    assert fingerprint == {
        "body": {"expectedVersion": 1},
        "commandType": "ReleaseWorkCards",
        "targetPath": (
            "/api/v1/production-batches/00000000-0000-0000-0000-000000000000"
            "/actions/release-work-cards"
        ),
    }
    assert canonical_json == (
        '{"body":{"expectedVersion":1},"commandType":"ReleaseWorkCards",'
        '"targetPath":"/api/v1/production-batches/'
        '00000000-0000-0000-0000-000000000000/actions/release-work-cards"}'
    )
    assert (
        release_work_cards_request_hash(BATCH_ID, 1)
        == "2d6b9a0cf41ec0b4573fd229b9e3adb5e23366d83b443a7893997903269dc3bc"
    )
    assert release_work_cards_target_path(BATCH_ID) == fingerprint["targetPath"]


def test_handler_requires_planner_permission_and_passes_canonical_hash() -> None:
    gateway = FakeReleaseWorkCardsGateway()
    handler = ReleaseWorkCardsHandler(cast(ReleaseWorkCardsGateway, gateway))
    actor = TrustedActor(PLANNER_ID, "PLANNER")
    command = valid_command()

    result = handler.handle(actor, command)

    assert gateway.calls == [
        (
            actor,
            command,
            release_work_cards_request_hash(command.batch_id, 1),
        )
    ]
    assert result.batch_id == command.batch_id
    assert result.lifecycle_status == "RELEASED"
    assert result.version == 2
    assert result.replayed is False


@pytest.mark.parametrize(
    "role",
    ["MASTER", "WORKER", "QUALITY_CONTROLLER", "ADMIN_AUDITOR"],
)
def test_non_planner_roles_are_rejected_before_gateway(role: Role) -> None:
    gateway = FakeReleaseWorkCardsGateway()

    with pytest.raises(PermissionDenied):
        ReleaseWorkCardsHandler(cast(ReleaseWorkCardsGateway, gateway)).handle(
            TrustedActor(uuid4(), role),
            valid_command(),
        )

    assert gateway.calls == []


def test_invalid_trusted_actor_id_is_rejected_before_gateway() -> None:
    gateway = FakeReleaseWorkCardsGateway()

    with pytest.raises(PermissionDenied):
        ReleaseWorkCardsHandler(cast(ReleaseWorkCardsGateway, gateway)).handle(
            TrustedActor(cast(UUID, "not-trusted"), "PLANNER"),
            valid_command(),
        )

    assert gateway.calls == []


@pytest.mark.parametrize("expected_version", [0, -1, True, 2_147_483_648])
def test_invalid_expected_version_is_rejected_before_gateway(
    expected_version: object,
) -> None:
    gateway = FakeReleaseWorkCardsGateway()

    with pytest.raises(ProductionBatchInvalid):
        ReleaseWorkCardsHandler(cast(ReleaseWorkCardsGateway, gateway)).handle(
            TrustedActor(PLANNER_ID, "PLANNER"),
            valid_command(expected_version=cast(int, expected_version)),
        )

    assert gateway.calls == []


@pytest.mark.parametrize("field", ["command_id", "batch_id"])
def test_invalid_command_uuids_are_rejected_before_gateway(field: str) -> None:
    gateway = FakeReleaseWorkCardsGateway()
    command = replace(valid_command(), **{field: cast(UUID, "invalid")})

    with pytest.raises(ProductionBatchInvalid):
        ReleaseWorkCardsHandler(cast(ReleaseWorkCardsGateway, gateway)).handle(
            TrustedActor(PLANNER_ID, "PLANNER"),
            command,
        )

    assert gateway.calls == []


def test_typed_gateway_failure_is_preserved() -> None:
    gateway = FakeReleaseWorkCardsGateway()
    gateway.failure = UnexpectedPersistenceFailure()

    with pytest.raises(UnexpectedPersistenceFailure):
        ReleaseWorkCardsHandler(cast(ReleaseWorkCardsGateway, gateway)).handle(
            TrustedActor(PLANNER_ID, "PLANNER"),
            valid_command(),
        )


def test_postgres_gateway_executes_exact_atomic_write_groups_for_small_plan() -> None:
    snapshot = valid_snapshot()
    snapshot["operationPlans"] = snapshot["operationPlans"][:1]
    correlation_id = UUID(int=1)
    set_id = UUID(int=2)
    card_ids = (UUID(int=3), UUID(int=4))
    released_at = datetime(2026, 7, 27, 12, 0, tzinfo=UTC)
    connection = ScriptedConnection(
        batch_row=(PASSPORT_ID, snapshot, 112, "CREATED", 1, None),
        set_rows=[
            (
                set_id,
                str(FIRST_PLAN_ID),
                {"code": "OP-10", "displayName": "Операция А"},  # noqa: RUF001
                Decimal("1.25"),
                2,
                "FIRST_ARTICLE_PENDING",
                None,
                1,
            )
        ],
        card_rows=[(set_id, 2, 1, 1, True, 0, 0)],
        update_row=(2, released_at),
        event_count=4,
    )
    generated = iter(UUID(int=value) for value in range(1, 9))
    gateway = PostgresReleaseWorkCardsGateway(
        cast(Any, FakePostgresDatabase([connection])),
        id_factory=lambda: next(generated),
    )
    selected_command = valid_command()

    result = ReleaseWorkCardsHandler(gateway).handle(
        TrustedActor(PLANNER_ID, "PLANNER"),
        selected_command,
    )

    assert connection.transaction_exited is True
    assert result == ReleaseWorkCardsResult(
        batch_id=BATCH_ID,
        lifecycle_status="RELEASED",
        version=2,
        set_count=1,
        card_count_total=2,
        work_card_sets=(
            ReleaseWorkCardSetResult(
                set_id=set_id,
                operation_plan_id=FIRST_PLAN_ID,
                position=1,
                operation_scope={
                    "code": "OP-10",
                    "displayName": "Операция А",  # noqa: RUF001
                },
                norm_hours="1.25",
                planned_card_count=2,
                gate_status="FIRST_ARTICLE_PENDING",
                version=1,
            ),
        ),
        command_id=selected_command.command_id,
        correlation_id=correlation_id,
    )
    assert [len(rows) for _, rows in connection.bulk_calls] == [1, 2, 4]
    set_row = cast(tuple[object, ...], connection.bulk_calls[0][1][0])
    assert set_row[0:3] == (set_id, BATCH_ID, str(FIRST_PLAN_ID))
    assert cast(Jsonb, set_row[3]).obj == {
        "code": "OP-10",
        "displayName": "Операция А",  # noqa: RUF001
    }
    assert set_row[4:] == ("1.25", 2)
    assert [cast(tuple[object, ...], row)[0] for row in connection.bulk_calls[1][1]] == list(
        card_ids
    )
    event_rows = [cast(tuple[object, ...], row) for row in connection.bulk_calls[2][1]]
    assert [row[4] for row in event_rows] == [
        "ProductionBatchReleased",
        "WorkCardSetCreated",
        "WorkCardReleased",
        "WorkCardReleased",
    ]
    assert [row[3] for row in event_rows] == [2, 1, 1, 1]
    assert all(row[7] == selected_command.command_id for row in event_rows)
    assert all(row[8] == correlation_id for row in event_rows)
    assert all(row[9] == released_at for row in event_rows)
    assert any(
        statement.startswith("INSERT INTO command_receipts") for statement in connection.statements
    )
    assert any(
        statement.startswith("UPDATE production_batches") for statement in connection.statements
    )
    receipt_params = next(
        params
        for statement, params in connection.execute_calls
        if statement.startswith("INSERT INTO command_receipts")
    )
    assert isinstance(receipt_params, tuple)
    assert receipt_params[0:5] == (
        selected_command.command_id,
        "ReleaseWorkCards",
        release_work_cards_request_hash(BATCH_ID, 1),
        correlation_id,
        BATCH_ID,
    )
    assert cast(Jsonb, receipt_params[5]).obj == {
        "batchId": str(BATCH_ID),
        "lifecycleStatus": "RELEASED",
        "version": 2,
        "setCount": 1,
        "cardCountTotal": 2,
        "workCardSetIds": [str(set_id)],
    }


@pytest.mark.parametrize(
    ("connection_changes", "selected_command", "failure"),
    [
        ({"batch_row": None}, valid_command(), ProductionBatchNotFound),
        (
            {
                "batch_row": (
                    PASSPORT_ID,
                    valid_snapshot(),
                    112,
                    "RELEASED",
                    2,
                    datetime(2026, 7, 27, tzinfo=UTC),
                )
            },
            valid_command(),
            BatchAlreadyReleased,
        ),
        (
            {
                "batch_row": (
                    PASSPORT_ID,
                    valid_snapshot(),
                    112,
                    "CREATED",
                    1,
                    None,
                ),
                "has_sets": True,
            },
            valid_command(),
            BatchAlreadyReleased,
        ),
        (
            {
                "batch_row": (
                    PASSPORT_ID,
                    valid_snapshot(),
                    112,
                    "CREATED",
                    1,
                    datetime(2026, 7, 27, tzinfo=UTC),
                )
            },
            valid_command(),
            ProductionBatchInvalid,
        ),
        (
            {
                "batch_row": (
                    PASSPORT_ID,
                    valid_snapshot(),
                    0,
                    "CREATED",
                    1,
                    None,
                )
            },
            valid_command(),
            ProductionBatchInvalid,
        ),
        (
            {
                "batch_row": (
                    PASSPORT_ID,
                    {"productionPassportId": str(PASSPORT_ID)},
                    112,
                    "CREATED",
                    1,
                    None,
                )
            },
            valid_command(),
            ProductionBatchInvalid,
        ),
        (
            {
                "batch_row": (
                    PASSPORT_ID,
                    valid_snapshot(),
                    112,
                    "CREATED",
                    2,
                    None,
                )
            },
            valid_command(expected_version=2),
            ProductionBatchInvalid,
        ),
        (
            {
                "batch_row": (
                    PASSPORT_ID,
                    valid_snapshot(),
                    112,
                    "CREATED",
                    1,
                    None,
                )
            },
            valid_command(expected_version=2),
            VersionConflict,
        ),
    ],
)
def test_postgres_gateway_classifies_prewrite_batch_outcomes(
    connection_changes: dict[str, object],
    selected_command: ReleaseWorkCardsCommand,
    failure: type[Exception],
) -> None:
    connection = ScriptedConnection(**connection_changes)
    gateway = PostgresReleaseWorkCardsGateway(cast(Any, FakePostgresDatabase([connection])))

    with pytest.raises(failure):
        ReleaseWorkCardsHandler(gateway).handle(
            TrustedActor(PLANNER_ID, "PLANNER"),
            selected_command,
        )

    assert connection.transaction_exited is True
    assert connection.bulk_calls == []


@pytest.mark.parametrize(
    ("receipt", "failure"),
    [
        (
            (
                "ReleaseWorkCards",
                release_work_cards_request_hash(BATCH_ID, 1),
            ),
            CommandAlreadyProcessed,
        ),
        (("CreateProductionBatch", "0" * 64), CommandIdReused),
    ],
)
def test_postgres_gateway_checks_receipt_before_batch_lock(
    receipt: tuple[object, ...],
    failure: type[Exception],
) -> None:
    connection = ScriptedConnection(receipt=receipt)
    gateway = PostgresReleaseWorkCardsGateway(cast(Any, FakePostgresDatabase([connection])))

    with pytest.raises(failure):
        ReleaseWorkCardsHandler(gateway).handle(
            TrustedActor(PLANNER_ID, "PLANNER"),
            valid_command(),
        )

    assert connection.statements == [
        "SET TRANSACTION ISOLATION LEVEL READ COMMITTED",
        "SELECT command_type, request_hash FROM command_receipts WHERE command_id = %s",
    ]
    assert "FOR UPDATE" not in connection.statements[1]


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
    gateway = PostgresReleaseWorkCardsGateway(cast(Any, FakePostgresDatabase([database_error])))

    with pytest.raises(failure):
        ReleaseWorkCardsHandler(gateway).handle(
            TrustedActor(PLANNER_ID, "PLANNER"),
            valid_command(),
        )


def test_release_plan_preserves_position_order_and_generates_exact_counts() -> None:
    generated = iter(UUID(int=value) for value in range(1, 6))

    plan = build_release_plan(valid_snapshot(), PASSPORT_ID, lambda: next(generated))

    assert [item.operation_plan.position for item in plan] == [1, 3]
    assert [item.operation_plan.operation_plan_id for item in plan] == [
        FIRST_PLAN_ID,
        SECOND_PLAN_ID,
    ]
    assert [item.set_id for item in plan] == [UUID(int=1), UUID(int=4)]
    assert plan[0].work_card_ids == (UUID(int=2), UUID(int=3))
    assert plan[1].work_card_ids == (UUID(int=5),)
    assert [item.operation_plan.planned_card_count for item in plan] == [2, 1]


def test_duplicate_or_non_uuid_generated_ids_are_internal_failures() -> None:
    repeated = UUID(int=1)
    with pytest.raises(UnexpectedPersistenceFailure):
        build_release_plan(valid_snapshot(), PASSPORT_ID, lambda: repeated)

    with pytest.raises(UnexpectedPersistenceFailure):
        build_release_plan(
            valid_snapshot(),
            PASSPORT_ID,
            cast(Callable[[], UUID], lambda: "not-a-uuid"),
        )


def invalid_snapshots() -> list[tuple[str, object]]:
    invalid: list[tuple[str, object]] = [
        ("not-object", []),
        ("empty-object", {}),
    ]

    wrong_passport = valid_snapshot()
    wrong_passport["productionPassportId"] = str(uuid4())
    invalid.append(("wrong-passport", wrong_passport))

    uppercase_passport = valid_snapshot()
    uppercase_passport["productionPassportId"] = f"{{{PASSPORT_ID}}}"
    invalid.append(("noncanonical-passport", uppercase_passport))

    extra_root = valid_snapshot()
    extra_root["active"] = True
    invalid.append(("extra-root-key", extra_root))

    blank_product = valid_snapshot()
    blank_product["productName"] = " "
    invalid.append(("blank-product", blank_product))

    empty_plans = valid_snapshot()
    empty_plans["operationPlans"] = []
    invalid.append(("empty-plans", empty_plans))

    unordered = valid_snapshot()
    unordered["operationPlans"].reverse()
    invalid.append(("unordered-positions", unordered))

    duplicate_position = valid_snapshot()
    duplicate_position["operationPlans"][1]["position"] = 1
    invalid.append(("duplicate-position", duplicate_position))

    duplicate_id = valid_snapshot()
    duplicate_id["operationPlans"][1]["operationPlanId"] = str(FIRST_PLAN_ID)
    invalid.append(("duplicate-operation-plan-id", duplicate_id))

    extra_plan_key = valid_snapshot()
    extra_plan_key["operationPlans"][0]["unknown"] = True
    invalid.append(("extra-plan-key", extra_plan_key))

    noncanonical_plan_id = valid_snapshot()
    noncanonical_plan_id["operationPlans"][0]["operationPlanId"] = f"{{{FIRST_PLAN_ID}}}"
    invalid.append(("noncanonical-operation-plan-id", noncanonical_plan_id))

    extra_scope_key = valid_snapshot()
    extra_scope_key["operationPlans"][0]["operationScope"]["members"] = []
    invalid.append(("extra-scope-key", extra_scope_key))

    missing_scope_name = valid_snapshot()
    del missing_scope_name["operationPlans"][0]["operationScope"]["displayName"]
    invalid.append(("missing-scope-name", missing_scope_name))

    blank_scope_code = valid_snapshot()
    blank_scope_code["operationPlans"][0]["operationScope"]["code"] = ""
    invalid.append(("blank-scope-code", blank_scope_code))

    for label, norm in [
        ("numeric-norm", 1.25),
        ("one-decimal-norm", "1.2"),
        ("zero-norm", "0.00"),
        ("leading-zero-norm", "01.25"),
        ("large-norm", "1000000.00"),
    ]:
        changed = copy.deepcopy(valid_snapshot())
        changed["operationPlans"][0]["normHours"] = norm
        invalid.append((label, changed))

    for label, count in [
        ("zero-count", 0),
        ("boolean-count", True),
        ("large-count", 2_147_483_648),
    ]:
        changed = copy.deepcopy(valid_snapshot())
        changed["operationPlans"][0]["plannedCardCount"] = count
        invalid.append((label, changed))

    boolean_position = valid_snapshot()
    boolean_position["operationPlans"][0]["position"] = True
    invalid.append(("boolean-position", boolean_position))
    return invalid


@pytest.mark.parametrize(
    ("label", "snapshot"),
    invalid_snapshots(),
    ids=lambda value: value if isinstance(value, str) else None,
)
def test_invalid_snapshot_is_rejected_without_repair(label: str, snapshot: object) -> None:
    del label
    with pytest.raises(ProductionBatchInvalid):
        parse_release_operation_plans(snapshot, PASSPORT_ID)


def test_receipt_race_classifier_requires_exact_constraint_name() -> None:
    assert is_command_receipt_race(
        cast(UniqueViolation, FakeUniqueViolation(COMMAND_RECEIPTS_PRIMARY_KEY))
    )
    assert not is_command_receipt_race(
        cast(UniqueViolation, FakeUniqueViolation("command_receipts_correlation_id_key"))
    )
    assert not is_command_receipt_race(
        cast(UniqueViolation, FakeUniqueViolation("audit_events_pkey"))
    )
