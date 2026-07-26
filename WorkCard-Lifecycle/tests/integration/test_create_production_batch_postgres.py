from __future__ import annotations

import os
from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from decimal import Decimal
from threading import Barrier
from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
from psycopg.errors import UniqueViolation
from psycopg.types.json import Jsonb

from workcard_api.database import PostgresDatabase
from workcard_api.postgres_production_batches import (
    COMMAND_RECEIPTS_PRIMARY_KEY,
    PostgresCreateProductionBatchGateway,
)
from workcard_api.production_batches import (
    CREATE_PRODUCTION_BATCH_COMMAND_TYPE,
    CommandAlreadyProcessed,
    CommandIdReused,
    CreateProductionBatchCommand,
    CreateProductionBatchHandler,
    CreateProductionBatchResult,
    ProductionBatchInvalid,
    ProductionPassportNotFound,
    TrustedActor,
    UnexpectedPersistenceFailure,
    canonical_json_sha256,
    create_production_batch_request_hash,
)

MIGRATION_DSN = os.getenv("WORKCARD_MIGRATION_DATABASE_URL")
RUNTIME_DSN = os.getenv("WORKCARD_DATABASE_URL")
PLANNER = TrustedActor(
    UUID("10000000-0000-4000-8000-000000000001"),
    "PLANNER",
)
CANONICAL_PASSPORT_ID = UUID("20000000-0000-4000-8000-000000000001")
pytestmark = [
    pytest.mark.integration,
    pytest.mark.usefixtures("prepared_least_privilege_database"),
]


class BarrierCreateProductionBatchGateway(PostgresCreateProductionBatchGateway):
    def __init__(self, database: PostgresDatabase, barrier: Barrier) -> None:
        super().__init__(database)
        self._barrier = barrier

    def _before_receipt_insert(self) -> None:
        self._barrier.wait(timeout=10)


@pytest.fixture(autouse=True)
def isolated_batch_state() -> Iterator[None]:
    if MIGRATION_DSN is None or RUNTIME_DSN is None:
        pytest.skip("separate migration and runtime PostgreSQL DSNs are required")
    _reset_batch_test_state()
    try:
        yield
    finally:
        _reset_batch_test_state()


def _reset_batch_test_state() -> None:
    assert MIGRATION_DSN is not None
    with psycopg.connect(MIGRATION_DSN, autocommit=True) as connection:
        connection.execute("TRUNCATE audit_events, command_receipts, production_batches CASCADE")
        connection.execute(
            "DELETE FROM operation_plans WHERE passport_id <> %s",
            (CANONICAL_PASSPORT_ID,),
        )
        connection.execute(
            "DELETE FROM production_passports WHERE id <> %s",
            (CANONICAL_PASSPORT_ID,),
        )
        connection.execute(
            """
            UPDATE production_passports
            SET code = 'SYNTH-PWC-112',
                revision = '1',
                product_name = 'Синтетическое изделие для демонстрации',
                active = true
            WHERE id = %s
            """,
            (CANONICAL_PASSPORT_ID,),
        )


@contextmanager
def handler_context(
    *,
    id_factory: Callable[[], UUID] | None = None,
    barrier: Barrier | None = None,
) -> Iterator[CreateProductionBatchHandler]:
    assert RUNTIME_DSN is not None
    database = PostgresDatabase(RUNTIME_DSN, min_size=1, max_size=4, timeout=5)
    database.open()
    try:
        if barrier is not None:
            gateway = BarrierCreateProductionBatchGateway(database, barrier)
        elif id_factory is not None:
            gateway = PostgresCreateProductionBatchGateway(database, id_factory=id_factory)
        else:
            gateway = PostgresCreateProductionBatchGateway(database)
        yield CreateProductionBatchHandler(gateway)
    finally:
        database.close()


def command(
    *,
    command_id: UUID | None = None,
    passport_id: UUID = CANONICAL_PASSPORT_ID,
    quantity: int = 112,
) -> CreateProductionBatchCommand:
    return CreateProductionBatchCommand(
        command_id=command_id or uuid4(),
        production_passport_id=passport_id,
        quantity=quantity,
    )


def insert_passport(
    *,
    passport_id: UUID | None = None,
    active: bool = True,
    plans: list[dict[str, Any]] | None = None,
) -> UUID:
    assert MIGRATION_DSN is not None
    selected_id = passport_id or uuid4()
    with psycopg.connect(MIGRATION_DSN) as connection:
        connection.execute(
            """
            INSERT INTO production_passports (id, code, revision, product_name, active)
            VALUES (%s, 'TEST-PASSPORT', '7', 'Тестовое изделие', %s)
            """,
            (selected_id, active),
        )
        for plan in plans or []:
            connection.execute(
                """
                INSERT INTO operation_plans (
                    id,
                    passport_id,
                    position,
                    operation_scope,
                    norm_hours,
                    planned_card_count
                ) VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (
                    plan.get("id", uuid4()),
                    selected_id,
                    plan["position"],
                    Jsonb(plan["operation_scope"]),
                    plan["norm_hours"],
                    plan["planned_card_count"],
                ),
            )
    return selected_id


def table_counts() -> tuple[int, int, int, int, int]:
    assert RUNTIME_DSN is not None
    with psycopg.connect(RUNTIME_DSN) as connection:
        row = connection.execute(
            """
            SELECT
                (SELECT count(*) FROM production_batches),
                (SELECT count(*) FROM command_receipts),
                (SELECT count(*) FROM audit_events),
                (SELECT count(*) FROM work_card_sets),
                (SELECT count(*) FROM work_cards)
            """
        ).fetchone()
    assert row is not None
    return row


def test_success_persists_one_batch_receipt_and_exact_event_atomically() -> None:
    selected_command = command()
    with handler_context() as handler:
        result = handler.handle(PLANNER, selected_command)

    assert RUNTIME_DSN is not None
    with psycopg.connect(RUNTIME_DSN) as connection:
        batch = connection.execute(
            """
            SELECT passport_id, passport_snapshot, batch_quantity, lifecycle_status,
                   version, released_at
            FROM production_batches
            WHERE id = %s
            """,
            (result.batch_id,),
        ).fetchone()
        receipt = connection.execute(
            """
            SELECT command_type, request_hash, correlation_id, result_type, result_id,
                   result_summary
            FROM command_receipts
            WHERE command_id = %s
            """,
            (selected_command.command_id,),
        ).fetchone()
        event = connection.execute(
            """
            SELECT event_type, aggregate_type, aggregate_id, aggregate_version,
                   actor_id, actor_role, command_id, correlation_id, occurred_at, data
            FROM audit_events
            WHERE command_id = %s
            """,
            (selected_command.command_id,),
        ).fetchone()

    expected_snapshot = result.passport_snapshot.to_json()
    assert batch == (
        CANONICAL_PASSPORT_ID,
        expected_snapshot,
        112,
        "CREATED",
        1,
        None,
    )
    assert receipt == (
        CREATE_PRODUCTION_BATCH_COMMAND_TYPE,
        create_production_batch_request_hash(CANONICAL_PASSPORT_ID, 112),
        result.correlation_id,
        "ProductionBatch",
        result.batch_id,
        {"batchId": str(result.batch_id), "lifecycleStatus": "CREATED", "version": 1},
    )
    assert event is not None
    assert event[:8] == (
        "ProductionBatchCreated",
        "ProductionBatch",
        result.batch_id,
        1,
        PLANNER.actor_id,
        "PLANNER",
        selected_command.command_id,
        result.correlation_id,
    )
    assert event[8].utcoffset() is not None
    assert event[8].utcoffset().total_seconds() == 0
    assert event[9] == {
        "batchId": str(result.batch_id),
        "quantity": 112,
        "passportSnapshot": expected_snapshot,
    }
    assert result.production_passport_id == CANONICAL_PASSPORT_ID
    assert result.lifecycle_status == "CREATED"
    assert result.version == 1
    assert result.command_id == selected_command.command_id
    assert result.replayed is False
    assert table_counts() == (1, 1, 1, 0, 0)


def test_quantity_respects_postgresql_integer_boundaries() -> None:
    selected_command = command(quantity=2_147_483_647)
    with handler_context() as handler:
        result = handler.handle(PLANNER, selected_command)
        with pytest.raises(ProductionBatchInvalid):
            handler.handle(PLANNER, command(quantity=2_147_483_648))

    assert RUNTIME_DSN is not None
    with psycopg.connect(RUNTIME_DSN) as connection:
        saved_quantity = connection.execute(
            "SELECT batch_quantity FROM production_batches WHERE id = %s",
            (result.batch_id,),
        ).fetchone()

    assert result.quantity == 2_147_483_647
    assert saved_quantity == (2_147_483_647,)
    assert table_counts() == (1, 1, 1, 0, 0)


def test_snapshot_orders_plans_allowlists_scope_and_preserves_two_decimal_norm() -> None:
    first_plan_id = uuid4()
    second_plan_id = uuid4()
    passport_id = insert_passport(
        plans=[
            {
                "id": second_plan_id,
                "position": 2,
                "operation_scope": {"displayName": "Вторая", "code": "OP-20"},
                "norm_hours": Decimal("2"),
                "planned_card_count": 26,
            },
            {
                "id": first_plan_id,
                "position": 1,
                "operation_scope": {
                    "members": ["discarded"],
                    "displayName": "Первая",
                    "code": "OP-10",
                    "unknown": {"discarded": True},
                },
                "norm_hours": Decimal("1.50"),
                "planned_card_count": 112,
            },
        ]
    )

    with handler_context() as handler:
        result = handler.handle(PLANNER, command(passport_id=passport_id))

    plans = result.passport_snapshot.to_json()["operationPlans"]
    assert plans == [
        {
            "operationPlanId": str(first_plan_id),
            "position": 1,
            "operationScope": {"code": "OP-10", "displayName": "Первая"},
            "normHours": "1.50",
            "plannedCardCount": 112,
        },
        {
            "operationPlanId": str(second_plan_id),
            "position": 2,
            "operationScope": {"code": "OP-20", "displayName": "Вторая"},
            "normHours": "2.00",
            "plannedCardCount": 26,
        },
    ]


def test_missing_and_inactive_passports_have_distinct_typed_failures() -> None:
    inactive_id = insert_passport(active=False)
    with handler_context() as handler:
        with pytest.raises(ProductionPassportNotFound):
            handler.handle(PLANNER, command(passport_id=uuid4()))
        with pytest.raises(ProductionBatchInvalid):
            handler.handle(PLANNER, command(passport_id=inactive_id))

    assert table_counts() == (0, 0, 0, 0, 0)


@pytest.mark.parametrize("invalid_kind", ["empty", "invalid_scope"])
def test_empty_or_invalid_operation_plans_roll_back_without_receipt(invalid_kind: str) -> None:
    plans = (
        []
        if invalid_kind == "empty"
        else [
            {
                "position": 1,
                "operation_scope": {},
                "norm_hours": Decimal("1.00"),
                "planned_card_count": 1,
            }
        ]
    )
    passport_id = insert_passport(plans=plans)

    with handler_context() as handler, pytest.raises(ProductionBatchInvalid):
        handler.handle(PLANNER, command(passport_id=passport_id))

    assert table_counts() == (0, 0, 0, 0, 0)


def test_exact_replay_is_command_already_processed_without_resource_replay() -> None:
    selected_command = command()
    with handler_context() as handler:
        first = handler.handle(PLANNER, selected_command)
        with pytest.raises(CommandAlreadyProcessed):
            handler.handle(PLANNER, selected_command)

    assert first.replayed is False
    assert table_counts() == (1, 1, 1, 0, 0)


def test_same_command_id_with_different_body_is_reused() -> None:
    command_id = uuid4()
    with handler_context() as handler:
        handler.handle(PLANNER, command(command_id=command_id, quantity=112))
        with pytest.raises(CommandIdReused):
            handler.handle(PLANNER, command(command_id=command_id, quantity=113))

    assert table_counts() == (1, 1, 1, 0, 0)


@pytest.mark.parametrize("difference", ["type", "path"])
def test_same_command_id_with_different_type_or_path_is_reused(difference: str) -> None:
    assert RUNTIME_DSN is not None
    command_id = uuid4()
    request_hash = create_production_batch_request_hash(CANONICAL_PASSPORT_ID, 112)
    command_type = CREATE_PRODUCTION_BATCH_COMMAND_TYPE
    if difference == "type":
        command_type = "ReleaseWorkCards"
    else:
        request_hash = canonical_json_sha256(
            {
                "body": {
                    "productionPassportId": str(CANONICAL_PASSPORT_ID),
                    "quantity": 112,
                },
                "commandType": CREATE_PRODUCTION_BATCH_COMMAND_TYPE,
                "targetPath": "/api/v1/other-path",
            }
        )
    with psycopg.connect(RUNTIME_DSN) as connection:
        connection.execute(
            """
            INSERT INTO command_receipts (
                command_id, command_type, request_hash, correlation_id,
                result_type, result_id, result_summary
            ) VALUES (%s, %s, %s, %s, 'ProductionBatch', %s, '{}'::jsonb)
            """,
            (command_id, command_type, request_hash, uuid4(), uuid4()),
        )

    with handler_context() as handler, pytest.raises(CommandIdReused):
        handler.handle(PLANNER, command(command_id=command_id))

    assert table_counts() == (0, 1, 0, 0, 0)


@pytest.mark.parametrize("failure_stage", ["batch", "receipt", "event"])
def test_unrelated_write_constraint_failure_rolls_back_the_whole_transaction(
    failure_stage: str,
) -> None:
    anchor_command = command()
    with handler_context() as handler:
        anchor_result = handler.handle(PLANNER, anchor_command)
    assert RUNTIME_DSN is not None
    with psycopg.connect(RUNTIME_DSN) as connection:
        anchor_event_id = connection.execute(
            "SELECT id FROM audit_events WHERE command_id = %s",
            (anchor_command.command_id,),
        ).fetchone()[0]

    new_batch_id = uuid4()
    new_correlation_id = uuid4()
    new_event_id = uuid4()
    if failure_stage == "batch":
        new_batch_id = anchor_result.batch_id
    elif failure_stage == "receipt":
        new_correlation_id = anchor_result.correlation_id
    else:
        new_event_id = anchor_event_id
    generated_ids = iter([new_batch_id, new_correlation_id, new_event_id])
    failing_command = command()

    with (
        handler_context(id_factory=lambda: next(generated_ids)) as handler,
        pytest.raises(UnexpectedPersistenceFailure) as captured,
    ):
        handler.handle(PLANNER, failing_command)

    assert isinstance(captured.value.__cause__, UniqueViolation)
    assert captured.value.__cause__.diag.constraint_name != COMMAND_RECEIPTS_PRIMARY_KEY
    assert table_counts() == (1, 1, 1, 0, 0)
    with psycopg.connect(RUNTIME_DSN) as connection:
        assert (
            connection.execute(
                "SELECT 1 FROM command_receipts WHERE command_id = %s",
                (failing_command.command_id,),
            ).fetchone()
            is None
        )


def test_concurrent_identical_requests_commit_once_and_classify_loser_as_replay() -> None:
    selected_command = command()
    with handler_context(barrier=Barrier(2)) as handler:
        outcomes = _run_concurrently(handler, selected_command, selected_command)

    assert sorted(type(item).__name__ for item in outcomes) == [
        "CommandAlreadyProcessed",
        "CreateProductionBatchResult",
    ]
    assert table_counts() == (1, 1, 1, 0, 0)


def test_concurrent_different_requests_commit_once_and_classify_loser_as_reuse() -> None:
    command_id = uuid4()
    first = command(command_id=command_id, quantity=112)
    second = command(command_id=command_id, quantity=113)
    with handler_context(barrier=Barrier(2)) as handler:
        outcomes = _run_concurrently(handler, first, second)

    assert sorted(type(item).__name__ for item in outcomes) == [
        "CommandIdReused",
        "CreateProductionBatchResult",
    ]
    assert table_counts() == (1, 1, 1, 0, 0)


def _run_concurrently(
    handler: CreateProductionBatchHandler,
    first: CreateProductionBatchCommand,
    second: CreateProductionBatchCommand,
) -> list[CreateProductionBatchResult | Exception]:
    def invoke(
        selected_command: CreateProductionBatchCommand,
    ) -> CreateProductionBatchResult | Exception:
        try:
            return handler.handle(PLANNER, selected_command)
        except Exception as error:
            return error

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(invoke, item) for item in (first, second)]
        return [future.result(timeout=20) for future in futures]


def test_saved_snapshot_is_unchanged_after_source_passport_and_plan_updates() -> None:
    plan_id = uuid4()
    passport_id = insert_passport(
        plans=[
            {
                "id": plan_id,
                "position": 1,
                "operation_scope": {
                    "code": "ORIGINAL",
                    "displayName": "Исходная операция",
                },
                "norm_hours": Decimal("1.25"),
                "planned_card_count": 5,
            }
        ]
    )
    with handler_context() as handler:
        result = handler.handle(PLANNER, command(passport_id=passport_id, quantity=5))
    original_snapshot = result.passport_snapshot.to_json()

    assert MIGRATION_DSN is not None
    with psycopg.connect(MIGRATION_DSN) as connection:
        connection.execute(
            "UPDATE production_passports SET product_name = 'Изменённое изделие' WHERE id = %s",
            (passport_id,),
        )
        connection.execute(
            """
            UPDATE operation_plans
            SET operation_scope = '{"code":"CHANGED","displayName":"Изменённая"}'::jsonb,
                norm_hours = 9.99,
                planned_card_count = 9
            WHERE id = %s
            """,
            (plan_id,),
        )

    assert RUNTIME_DSN is not None
    with psycopg.connect(RUNTIME_DSN) as connection:
        saved_batch_snapshot = connection.execute(
            "SELECT passport_snapshot FROM production_batches WHERE id = %s",
            (result.batch_id,),
        ).fetchone()[0]
        saved_event_snapshot = connection.execute(
            "SELECT data->'passportSnapshot' FROM audit_events WHERE aggregate_id = %s",
            (result.batch_id,),
        ).fetchone()[0]

    assert saved_batch_snapshot == original_snapshot
    assert saved_event_snapshot == original_snapshot
