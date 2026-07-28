from __future__ import annotations

import os
from collections import Counter
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import UTC, datetime
from decimal import Decimal
from threading import Barrier
from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
from psycopg import Connection
from psycopg.conninfo import make_conninfo
from psycopg.errors import CheckViolation, UniqueViolation
from psycopg.types.json import Jsonb

from workcard_api.database import PostgresDatabase
from workcard_api.postgres_release_work_cards import (
    PostgresReleaseWorkCardsGateway,
    WriteGroup,
)
from workcard_api.production_batches import TrustedActor
from workcard_api.release_work_cards import (
    RELEASE_WORK_CARDS_COMMAND_TYPE,
    BatchAlreadyReleased,
    CommandAlreadyProcessed,
    CommandIdReused,
    ConcurrentCommandConflict,
    PermissionDenied,
    ProductionBatchInvalid,
    ProductionBatchNotFound,
    ReleaseWorkCardsCommand,
    ReleaseWorkCardsHandler,
    ReleaseWorkCardsResult,
    UnexpectedPersistenceFailure,
    VersionConflict,
    release_work_cards_request_hash,
)

MIGRATION_DSN = os.getenv("WORKCARD_MIGRATION_DATABASE_URL")
RUNTIME_DSN = os.getenv("WORKCARD_DATABASE_URL")
PLANNER = TrustedActor(
    UUID("10000000-0000-4000-8000-000000000001"),
    "PLANNER",
)
MASTER = TrustedActor(
    UUID("10000000-0000-4000-8000-000000000002"),
    "MASTER",
)
PASSPORT_ID = UUID("20000000-0000-4000-8000-000000000001")
PLAN_IDS = (
    UUID("21000000-0000-4000-8000-000000000001"),
    UUID("21000000-0000-4000-8000-000000000002"),
    UUID("21000000-0000-4000-8000-000000000003"),
)
FAILURE_RECEIPT_ID = UUID("ff000000-0000-4000-8000-000000000001")
pytestmark = [
    pytest.mark.integration,
    pytest.mark.usefixtures("prepared_least_privilege_database"),
]


class BatchLockBarrierGateway(PostgresReleaseWorkCardsGateway):
    def __init__(self, database: PostgresDatabase, barrier: Barrier) -> None:
        super().__init__(database)
        self._barrier = barrier

    def _after_initial_receipt_lookup(self) -> None:
        self._barrier.wait(timeout=10)


class ReceiptBarrierGateway(PostgresReleaseWorkCardsGateway):
    def __init__(self, database: PostgresDatabase, barrier: Barrier) -> None:
        super().__init__(database)
        self._barrier = barrier

    def _before_receipt_insert(self) -> None:
        self._barrier.wait(timeout=10)


class FailingWriteGroupGateway(PostgresReleaseWorkCardsGateway):
    def __init__(self, database: PostgresDatabase, failure_group: WriteGroup) -> None:
        super().__init__(database)
        self._failure_group = failure_group

    def _after_write_group(
        self,
        connection: Connection[tuple[object, ...]],
        group: WriteGroup,
        command: ReleaseWorkCardsCommand,
        correlation_id: UUID,
    ) -> None:
        if group != self._failure_group:
            return
        if group == "sets":
            connection.execute(
                """
                INSERT INTO work_card_sets (
                    id, batch_id, operation_plan_key, operation_scope_snapshot,
                    norm_hours_snapshot, planned_card_count, gate_status,
                    first_article_work_card_id, version
                )
                SELECT
                    id, batch_id, operation_plan_key, operation_scope_snapshot,
                    norm_hours_snapshot, planned_card_count, gate_status,
                    first_article_work_card_id, version
                FROM work_card_sets
                WHERE batch_id = %s
                LIMIT 1
                """,
                (command.batch_id,),
            )
        elif group == "cards":
            connection.execute(
                """
                INSERT INTO work_cards (
                    id, set_id, batch_id, batch_quantity_snapshot,
                    operation_scope_snapshot, norm_hours_snapshot, purpose,
                    status, assignee_id, version
                )
                SELECT
                    id, set_id, batch_id, batch_quantity_snapshot,
                    operation_scope_snapshot, norm_hours_snapshot, purpose,
                    status, assignee_id, version
                FROM work_cards
                WHERE batch_id = %s
                LIMIT 1
                """,
                (command.batch_id,),
            )
        elif group == "batch":
            connection.execute(
                "UPDATE production_batches SET version = 0 WHERE id = %s",
                (command.batch_id,),
            )
        elif group == "receipt":
            connection.execute(
                """
                INSERT INTO command_receipts (
                    command_id, command_type, request_hash, correlation_id,
                    result_type, result_id, result_summary
                ) VALUES (
                    %s, 'InjectedFailure', %s, %s,
                    'ProductionBatch', %s, '{}'::jsonb
                )
                """,
                (
                    FAILURE_RECEIPT_ID,
                    "0" * 64,
                    correlation_id,
                    command.batch_id,
                ),
            )
        else:
            connection.execute(
                """
                INSERT INTO audit_events (
                    id, aggregate_type, aggregate_id, aggregate_version,
                    event_type, actor_id, actor_role, command_id,
                    correlation_id, occurred_at, data
                )
                SELECT
                    id, aggregate_type, aggregate_id, aggregate_version,
                    event_type, actor_id, actor_role, command_id,
                    correlation_id, occurred_at, data
                FROM audit_events
                WHERE command_id = %s
                LIMIT 1
                """,
                (command.command_id,),
            )


@pytest.fixture(autouse=True)
def isolated_release_state() -> Iterator[None]:
    if MIGRATION_DSN is None or RUNTIME_DSN is None:
        pytest.skip("separate migration and runtime PostgreSQL DSNs are required")
    _reset_release_test_state()
    try:
        yield
    finally:
        _reset_release_test_state()


def _reset_release_test_state() -> None:
    assert MIGRATION_DSN is not None
    with psycopg.connect(MIGRATION_DSN, autocommit=True) as connection:
        connection.execute("TRUNCATE audit_events, command_receipts, production_batches CASCADE")


def canonical_snapshot() -> dict[str, Any]:
    return {
        "productionPassportId": str(PASSPORT_ID),
        "code": "SYNTH-PWC-112",
        "revision": "1",
        "productName": "Синтетическое изделие для демонстрации",
        "operationPlans": [
            {
                "operationPlanId": str(PLAN_IDS[0]),
                "position": 1,
                "operationScope": {
                    "code": "SYN-OP-10",
                    "displayName": "Синтетическая операция А",  # noqa: RUF001
                },
                "normHours": "1.25",
                "plannedCardCount": 112,
            },
            {
                "operationPlanId": str(PLAN_IDS[1]),
                "position": 2,
                "operationScope": {
                    "code": "SYN-OP-20",
                    "displayName": "Синтетическая операция Б",
                },
                "normHours": "0.75",
                "plannedCardCount": 112,
            },
            {
                "operationPlanId": str(PLAN_IDS[2]),
                "position": 3,
                "operationScope": {
                    "code": "SYN-GRP-30",
                    "displayName": "Синтетическая группа операций В",  # noqa: RUF001
                },
                "normHours": "2.00",
                "plannedCardCount": 26,
            },
        ],
    }


def small_snapshot(
    *,
    operation_plan_id: UUID | None = None,
    position: int = 1,
    planned_card_count: int = 2,
) -> dict[str, Any]:
    return {
        "productionPassportId": str(PASSPORT_ID),
        "code": "SNAPSHOT-ONLY",
        "revision": "7",
        "productName": "Снимок для выпуска",
        "operationPlans": [
            {
                "operationPlanId": str(operation_plan_id or uuid4()),
                "position": position,
                "operationScope": {
                    "code": "SNAP-OP",
                    "displayName": "Операция из снимка",
                },
                "normHours": "1.50",
                "plannedCardCount": planned_card_count,
            }
        ],
    }


def insert_batch(
    *,
    batch_id: UUID | None = None,
    snapshot: object | None = None,
    lifecycle_status: str = "CREATED",
    version: int = 1,
    batch_quantity: int = 112,
) -> UUID:
    assert MIGRATION_DSN is not None
    selected_id = batch_id or uuid4()
    released_at = datetime.now(UTC) if lifecycle_status != "CREATED" else None
    with psycopg.connect(MIGRATION_DSN) as connection:
        connection.execute(
            """
            INSERT INTO production_batches (
                id, passport_id, passport_snapshot, batch_quantity,
                lifecycle_status, version, released_at
            ) VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (
                selected_id,
                PASSPORT_ID,
                Jsonb(snapshot if snapshot is not None else canonical_snapshot()),
                batch_quantity,
                lifecycle_status,
                version,
                released_at,
            ),
        )
    return selected_id


def command(
    batch_id: UUID,
    *,
    command_id: UUID | None = None,
    expected_version: int = 1,
) -> ReleaseWorkCardsCommand:
    return ReleaseWorkCardsCommand(
        command_id=command_id or uuid4(),
        batch_id=batch_id,
        expected_version=expected_version,
    )


@contextmanager
def handler_context(
    *,
    batch_lock_barrier: Barrier | None = None,
    receipt_barrier: Barrier | None = None,
    failure_group: WriteGroup | None = None,
    runtime_dsn: str | None = None,
) -> Iterator[ReleaseWorkCardsHandler]:
    assert RUNTIME_DSN is not None
    database = PostgresDatabase(
        runtime_dsn or RUNTIME_DSN,
        min_size=1,
        max_size=4,
        timeout=5,
    )
    database.open()
    try:
        if batch_lock_barrier is not None:
            gateway = BatchLockBarrierGateway(database, batch_lock_barrier)
        elif receipt_barrier is not None:
            gateway = ReceiptBarrierGateway(database, receipt_barrier)
        elif failure_group is not None:
            gateway = FailingWriteGroupGateway(database, failure_group)
        else:
            gateway = PostgresReleaseWorkCardsGateway(database)
        yield ReleaseWorkCardsHandler(gateway)
    finally:
        database.close()


def persisted_counts() -> tuple[int, int, int, int, int]:
    assert RUNTIME_DSN is not None
    with psycopg.connect(RUNTIME_DSN) as connection:
        row = connection.execute(
            """
            SELECT
                (SELECT count(*) FROM production_batches),
                (SELECT count(*) FROM work_card_sets),
                (SELECT count(*) FROM work_cards),
                (SELECT count(*) FROM command_receipts),
                (SELECT count(*) FROM audit_events)
            """
        ).fetchone()
    assert row is not None
    return row


def test_canonical_release_persists_exact_3_250_254_atomic_result() -> None:
    batch_id = insert_batch()
    selected_command = command(batch_id)
    assert RUNTIME_DSN is not None
    moscow_dsn = make_conninfo(RUNTIME_DSN, options="-c TimeZone=Europe/Moscow")

    with handler_context(runtime_dsn=moscow_dsn) as handler:
        result = handler.handle(PLANNER, selected_command)

    with psycopg.connect(moscow_dsn) as connection:
        session_timezone = connection.execute("SHOW TimeZone").fetchone()
        batch = connection.execute(
            """
            SELECT lifecycle_status, version, released_at
            FROM production_batches
            WHERE id = %s
            """,
            (batch_id,),
        ).fetchone()
        sets = connection.execute(
            """
            SELECT
                id, operation_plan_key, operation_scope_snapshot,
                norm_hours_snapshot, planned_card_count, gate_status,
                first_article_work_card_id, version
            FROM work_card_sets
            WHERE batch_id = %s
            """,
            (batch_id,),
        ).fetchall()
        cards = connection.execute(
            """
            SELECT
                id, set_id, batch_quantity_snapshot, operation_scope_snapshot,
                norm_hours_snapshot, purpose, assignee_id, status, version
            FROM work_cards
            WHERE batch_id = %s
            """,
            (batch_id,),
        ).fetchall()
        receipt = connection.execute(
            """
            SELECT command_type, request_hash, correlation_id, result_type,
                   result_id, result_summary
            FROM command_receipts
            WHERE command_id = %s
            """,
            (selected_command.command_id,),
        ).fetchone()
        events = connection.execute(
            """
            SELECT
                event_type, aggregate_type, aggregate_id, aggregate_version,
                actor_id, actor_role, command_id, correlation_id, occurred_at, data
            FROM audit_events
            WHERE command_id = %s
            """,
            (selected_command.command_id,),
        ).fetchall()

    assert session_timezone == ("Europe/Moscow",)
    assert batch is not None
    assert batch[0:2] == ("RELEASED", 2)
    assert isinstance(batch[2], datetime)
    assert batch[2].tzinfo is not None
    assert batch[2].utcoffset() is not None

    assert result.batch_id == batch_id
    assert result.lifecycle_status == "RELEASED"
    assert result.version == 2
    assert result.set_count == 3
    assert result.card_count_total == 250
    assert result.command_id == selected_command.command_id
    assert result.replayed is False
    assert [item.position for item in result.work_card_sets] == [1, 2, 3]
    assert [item.operation_plan_id for item in result.work_card_sets] == list(PLAN_IDS)
    assert [item.planned_card_count for item in result.work_card_sets] == [112, 112, 26]
    assert [item.norm_hours for item in result.work_card_sets] == ["1.25", "0.75", "2.00"]
    assert all(item.gate_status == "FIRST_ARTICLE_PENDING" for item in result.work_card_sets)
    assert all(item.version == 1 for item in result.work_card_sets)

    result_by_set_id = {item.set_id: item for item in result.work_card_sets}
    assert len(sets) == 3
    for saved_set in sets:
        summary = result_by_set_id[saved_set[0]]
        assert saved_set == (
            summary.set_id,
            str(summary.operation_plan_id),
            dict(summary.operation_scope),
            Decimal(summary.norm_hours),
            summary.planned_card_count,
            "FIRST_ARTICLE_PENDING",
            None,
            1,
        )

    assert len(cards) == 250
    card_counts = Counter(card[1] for card in cards)
    assert card_counts == Counter(
        {item.set_id: item.planned_card_count for item in result.work_card_sets}
    )
    cards_by_id = {card[0]: card for card in cards}
    for card in cards:
        set_summary = result_by_set_id[card[1]]
        assert card[2:] == (
            112,
            dict(set_summary.operation_scope),
            Decimal(set_summary.norm_hours),
            None,
            None,
            "RELEASED",
            1,
        )

    expected_set_ids = [str(item.set_id) for item in result.work_card_sets]
    assert receipt == (
        RELEASE_WORK_CARDS_COMMAND_TYPE,
        release_work_cards_request_hash(batch_id, 1),
        result.correlation_id,
        "ProductionBatch",
        batch_id,
        {
            "batchId": str(batch_id),
            "lifecycleStatus": "RELEASED",
            "version": 2,
            "setCount": 3,
            "cardCountTotal": 250,
            "workCardSetIds": expected_set_ids,
        },
    )

    assert len(events) == 254
    assert Counter(event[0] for event in events) == Counter(
        {
            "ProductionBatchReleased": 1,
            "WorkCardSetCreated": 3,
            "WorkCardReleased": 250,
        }
    )
    assert all(event[4] == PLANNER.actor_id for event in events)
    assert all(event[5] == "PLANNER" for event in events)
    assert all(event[6] == selected_command.command_id for event in events)
    assert all(event[7] == result.correlation_id for event in events)
    assert all(
        isinstance(event[8], datetime)
        and event[8].tzinfo is not None
        and event[8].utcoffset() is not None
        for event in events
    )
    assert all(
        isinstance(event[8], datetime) and event[8].astimezone(UTC) == batch[2].astimezone(UTC)
        for event in events
    )

    batch_event = next(event for event in events if event[0] == "ProductionBatchReleased")
    assert batch_event[1:4] == ("ProductionBatch", batch_id, 2)
    assert batch_event[9] == {
        "batchId": str(batch_id),
        "workCardSetIds": expected_set_ids,
        "setCount": 3,
        "cardCountTotal": 250,
    }

    set_events = sorted(
        (event for event in events if event[0] == "WorkCardSetCreated"),
        key=lambda event: event[9]["position"],
    )
    for event, summary in zip(set_events, result.work_card_sets, strict=True):
        assert event[1:4] == ("WorkCardSet", summary.set_id, 1)
        assert event[9] == {
            "setId": str(summary.set_id),
            "batchId": str(batch_id),
            "operationPlanId": str(summary.operation_plan_id),
            "position": summary.position,
            "operationScope": dict(summary.operation_scope),
            "normHours": summary.norm_hours,
            "plannedCardCount": summary.planned_card_count,
            "gateStatus": "FIRST_ARTICLE_PENDING",
        }

    card_events = [event for event in events if event[0] == "WorkCardReleased"]
    assert len(card_events) == len(cards_by_id)
    for event in card_events:
        saved_card = cards_by_id[event[2]]
        summary = result_by_set_id[saved_card[1]]
        assert event[1:4] == ("WorkCard", saved_card[0], 1)
        assert event[9] == {
            "workCardId": str(saved_card[0]),
            "setId": str(saved_card[1]),
            "batchId": str(batch_id),
            "batchQuantitySnapshot": 112,
            "operationScope": dict(summary.operation_scope),
            "normHours": summary.norm_hours,
            "status": "RELEASED",
        }

    assert persisted_counts() == (1, 3, 250, 1, 254)


def test_release_reads_only_immutable_snapshot_and_uses_canonical_operation_plan_key() -> None:
    snapshot_plan_id = UUID("de000000-0000-4000-8000-000000000001")
    batch_id = insert_batch(
        snapshot=small_snapshot(
            operation_plan_id=snapshot_plan_id,
            position=7,
            planned_card_count=2,
        ),
        batch_quantity=9,
    )

    with handler_context() as handler:
        result = handler.handle(PLANNER, command(batch_id))

    assert result.work_card_sets[0].operation_plan_id == snapshot_plan_id
    assert result.work_card_sets[0].position == 7
    assert result.work_card_sets[0].operation_scope == {
        "code": "SNAP-OP",
        "displayName": "Операция из снимка",
    }
    assert RUNTIME_DSN is not None
    with psycopg.connect(RUNTIME_DSN) as connection:
        saved_set = connection.execute(
            """
            SELECT operation_plan_key, planned_card_count
            FROM work_card_sets
            WHERE batch_id = %s
            """,
            (batch_id,),
        ).fetchone()
        cards = connection.execute(
            """
            SELECT count(*), min(batch_quantity_snapshot), max(batch_quantity_snapshot)
            FROM work_cards
            WHERE batch_id = %s
            """,
            (batch_id,),
        ).fetchone()

    assert saved_set == (str(snapshot_plan_id), 2)
    assert cards == (2, 9, 9)


@pytest.mark.parametrize(
    ("snapshot", "version", "expected_failure"),
    [
        ({"productionPassportId": str(PASSPORT_ID)}, 1, ProductionBatchInvalid),
        (
            {
                **small_snapshot(),
                "operationPlans": [
                    {
                        **small_snapshot()["operationPlans"][0],
                        "plannedCardCount": 0,
                    }
                ],
            },
            1,
            ProductionBatchInvalid,
        ),
        (small_snapshot(), 2, ProductionBatchInvalid),
    ],
)
def test_invalid_snapshot_counts_or_created_version_leave_no_release_artifacts(
    snapshot: object,
    version: int,
    expected_failure: type[Exception],
) -> None:
    batch_id = insert_batch(snapshot=snapshot, version=version)

    with handler_context() as handler, pytest.raises(expected_failure):
        handler.handle(PLANNER, command(batch_id, expected_version=version))

    assert persisted_counts() == (1, 0, 0, 0, 0)


def test_expected_version_conflict_on_valid_created_batch_leaves_no_artifacts() -> None:
    batch_id = insert_batch(snapshot=small_snapshot())

    with handler_context() as handler, pytest.raises(VersionConflict):
        handler.handle(PLANNER, command(batch_id, expected_version=2))

    assert persisted_counts() == (1, 0, 0, 0, 0)


@pytest.mark.parametrize("lifecycle_status", ["RELEASED", "FINAL_ACCEPTED"])
def test_terminal_batch_status_is_already_released_without_receipt(
    lifecycle_status: str,
) -> None:
    batch_id = insert_batch(
        snapshot=small_snapshot(),
        lifecycle_status=lifecycle_status,
        version=2,
    )
    selected_command = command(batch_id)

    with handler_context() as handler, pytest.raises(BatchAlreadyReleased):
        handler.handle(PLANNER, selected_command)

    assert persisted_counts() == (1, 0, 0, 0, 0)


def test_created_batch_with_existing_set_is_already_released_without_receipt() -> None:
    batch_id = insert_batch(snapshot=small_snapshot())
    assert MIGRATION_DSN is not None
    with psycopg.connect(MIGRATION_DSN) as connection:
        connection.execute(
            """
            INSERT INTO work_card_sets (
                id, batch_id, operation_plan_key, operation_scope_snapshot,
                norm_hours_snapshot, planned_card_count, gate_status, version
            ) VALUES (
                %s, %s, %s, %s, 1.50, 2, 'FIRST_ARTICLE_PENDING', 1
            )
            """,
            (
                uuid4(),
                batch_id,
                str(uuid4()),
                Jsonb({"code": "EXISTING", "displayName": "Существующий"}),
            ),
        )

    selected_command = command(batch_id)
    with handler_context() as handler, pytest.raises(BatchAlreadyReleased):
        handler.handle(PLANNER, selected_command)

    assert persisted_counts() == (1, 1, 0, 0, 0)


def test_batch_not_found_and_permission_denied_do_not_touch_database() -> None:
    with handler_context() as handler:
        with pytest.raises(ProductionBatchNotFound):
            handler.handle(PLANNER, command(uuid4()))
        with pytest.raises(PermissionDenied):
            handler.handle(MASTER, command(uuid4()))

    assert persisted_counts() == (0, 0, 0, 0, 0)


def test_exact_replay_is_command_already_processed_before_terminal_state_check() -> None:
    batch_id = insert_batch(snapshot=small_snapshot())
    selected_command = command(batch_id)

    with handler_context() as handler:
        result = handler.handle(PLANNER, selected_command)
        with pytest.raises(CommandAlreadyProcessed):
            handler.handle(PLANNER, selected_command)

    assert result.replayed is False
    assert persisted_counts() == (1, 1, 2, 1, 4)


def test_same_command_id_with_different_body_is_reused_before_state_check() -> None:
    batch_id = insert_batch(snapshot=small_snapshot())
    command_id = uuid4()

    with handler_context() as handler:
        handler.handle(PLANNER, command(batch_id, command_id=command_id))
        with pytest.raises(CommandIdReused):
            handler.handle(
                PLANNER,
                command(batch_id, command_id=command_id, expected_version=2),
            )

    assert persisted_counts() == (1, 1, 2, 1, 4)


def test_same_command_id_with_different_batch_path_is_reused() -> None:
    first_batch_id = insert_batch(snapshot=small_snapshot())
    second_batch_id = insert_batch(snapshot=small_snapshot())
    command_id = uuid4()

    with handler_context() as handler:
        handler.handle(PLANNER, command(first_batch_id, command_id=command_id))
        with pytest.raises(CommandIdReused):
            handler.handle(
                PLANNER,
                command(second_batch_id, command_id=command_id),
            )

    assert persisted_counts() == (2, 1, 2, 1, 4)
    assert RUNTIME_DSN is not None
    with psycopg.connect(RUNTIME_DSN) as connection:
        second_status = connection.execute(
            "SELECT lifecycle_status, version FROM production_batches WHERE id = %s",
            (second_batch_id,),
        ).fetchone()
    assert second_status == ("CREATED", 1)


def test_same_command_id_with_different_command_type_is_reused() -> None:
    batch_id = insert_batch(snapshot=small_snapshot())
    selected_command = command(batch_id)
    assert RUNTIME_DSN is not None
    with psycopg.connect(RUNTIME_DSN) as connection:
        connection.execute(
            """
            INSERT INTO command_receipts (
                command_id, command_type, request_hash, correlation_id,
                result_type, result_id, result_summary
            ) VALUES (
                %s, 'CreateProductionBatch', %s, %s,
                'ProductionBatch', %s, '{}'::jsonb
            )
            """,
            (
                selected_command.command_id,
                release_work_cards_request_hash(batch_id, 1),
                uuid4(),
                batch_id,
            ),
        )

    with handler_context() as handler, pytest.raises(CommandIdReused):
        handler.handle(PLANNER, selected_command)

    assert persisted_counts() == (1, 0, 0, 1, 0)


def test_new_command_for_released_batch_has_no_loser_receipt() -> None:
    batch_id = insert_batch(snapshot=small_snapshot())
    first = command(batch_id)
    second = command(batch_id)

    with handler_context() as handler:
        handler.handle(PLANNER, first)
        with pytest.raises(BatchAlreadyReleased):
            handler.handle(PLANNER, second)

    assert persisted_counts() == (1, 1, 2, 1, 4)
    assert RUNTIME_DSN is not None
    with psycopg.connect(RUNTIME_DSN) as connection:
        loser_receipt = connection.execute(
            "SELECT 1 FROM command_receipts WHERE command_id = %s",
            (second.command_id,),
        ).fetchone()
    assert loser_receipt is None


@pytest.mark.parametrize(
    "failure_group",
    ["sets", "cards", "batch", "receipt", "events"],
)
def test_real_database_failure_after_each_write_group_rolls_back_everything(
    failure_group: WriteGroup,
) -> None:
    batch_id = insert_batch(snapshot=small_snapshot())
    selected_command = command(batch_id)

    with (
        handler_context(failure_group=failure_group) as handler,
        pytest.raises(UnexpectedPersistenceFailure) as captured,
    ):
        handler.handle(PLANNER, selected_command)

    assert isinstance(captured.value.__cause__, UniqueViolation | CheckViolation)
    if isinstance(captured.value.__cause__, UniqueViolation):
        assert captured.value.__cause__.diag.constraint_name != "command_receipts_pkey"
    assert persisted_counts() == (1, 0, 0, 0, 0)
    assert RUNTIME_DSN is not None
    with psycopg.connect(RUNTIME_DSN) as connection:
        batch = connection.execute(
            """
            SELECT lifecycle_status, version, released_at
            FROM production_batches
            WHERE id = %s
            """,
            (batch_id,),
        ).fetchone()
    assert batch == ("CREATED", 1, None)


def test_unrelated_receipt_constraint_is_not_misclassified_as_receipt_race() -> None:
    batch_id = insert_batch(snapshot=small_snapshot())

    with (
        handler_context(failure_group="receipt") as handler,
        pytest.raises(UnexpectedPersistenceFailure) as captured,
    ):
        handler.handle(PLANNER, command(batch_id))

    assert isinstance(captured.value.__cause__, UniqueViolation)
    assert captured.value.__cause__.diag.constraint_name == "command_receipts_correlation_id_key"
    assert persisted_counts() == (1, 0, 0, 0, 0)


def test_concurrent_different_commands_release_one_batch_once_without_loser_receipt() -> None:
    batch_id = insert_batch(snapshot=small_snapshot())
    first = command(batch_id)
    second = command(batch_id)

    with handler_context(batch_lock_barrier=Barrier(2)) as handler:
        outcomes = run_concurrently(handler, first, second)

    assert sorted(type(item).__name__ for item in outcomes) == [
        "BatchAlreadyReleased",
        "ReleaseWorkCardsResult",
    ]
    assert persisted_counts() == (1, 1, 2, 1, 4)
    assert RUNTIME_DSN is not None
    with psycopg.connect(RUNTIME_DSN) as connection:
        receipt_ids = {
            row[0] for row in connection.execute("SELECT command_id FROM command_receipts")
        }
    assert len(receipt_ids) == 1
    assert receipt_ids <= {first.command_id, second.command_id}


def test_batch_lock_race_rereads_matching_receipt_and_classifies_exact_replay() -> None:
    batch_id = insert_batch(snapshot=small_snapshot())
    selected_command = command(batch_id)

    with handler_context(batch_lock_barrier=Barrier(2)) as handler:
        outcomes = run_concurrently(handler, selected_command, selected_command)

    assert sorted(type(item).__name__ for item in outcomes) == [
        "CommandAlreadyProcessed",
        "ReleaseWorkCardsResult",
    ]
    assert persisted_counts() == (1, 1, 2, 1, 4)


def test_inherited_repeatable_read_exact_replay_is_classified_after_batch_lock() -> None:
    assert RUNTIME_DSN is not None
    repeatable_read_dsn = make_conninfo(
        RUNTIME_DSN,
        options="-c default_transaction_isolation=repeatable\\ read",
    )
    with psycopg.connect(repeatable_read_dsn) as connection:
        inherited_isolation = connection.execute("SHOW default_transaction_isolation").fetchone()
    assert inherited_isolation == ("repeatable read",)

    batch_id = insert_batch(snapshot=small_snapshot())
    selected_command = command(batch_id)

    with handler_context(
        batch_lock_barrier=Barrier(2),
        runtime_dsn=repeatable_read_dsn,
    ) as handler:
        outcomes = run_concurrently(handler, selected_command, selected_command)

    assert sum(isinstance(item, ReleaseWorkCardsResult) for item in outcomes) == 1
    assert sum(isinstance(item, CommandAlreadyProcessed) for item in outcomes) == 1
    assert not any(isinstance(item, ConcurrentCommandConflict) for item in outcomes)
    assert persisted_counts() == (1, 1, 2, 1, 4)


def test_global_receipt_race_on_different_batch_paths_rolls_back_loser_state() -> None:
    first_batch_id = insert_batch(snapshot=small_snapshot())
    second_batch_id = insert_batch(snapshot=small_snapshot())
    command_id = uuid4()
    first = command(first_batch_id, command_id=command_id)
    second = command(second_batch_id, command_id=command_id)

    with handler_context(receipt_barrier=Barrier(2)) as handler:
        outcomes = run_concurrently(handler, first, second)

    assert sorted(type(item).__name__ for item in outcomes) == [
        "CommandIdReused",
        "ReleaseWorkCardsResult",
    ]
    assert persisted_counts() == (2, 1, 2, 1, 4)
    assert RUNTIME_DSN is not None
    with psycopg.connect(RUNTIME_DSN) as connection:
        statuses = Counter(
            row[0]
            for row in connection.execute(
                """
                SELECT lifecycle_status
                FROM production_batches
                WHERE id IN (%s, %s)
                """,
                (first_batch_id, second_batch_id),
            )
        )
    assert statuses == Counter({"CREATED": 1, "RELEASED": 1})


def run_concurrently(
    handler: ReleaseWorkCardsHandler,
    first: ReleaseWorkCardsCommand,
    second: ReleaseWorkCardsCommand,
) -> list[ReleaseWorkCardsResult | Exception]:
    def invoke(
        selected_command: ReleaseWorkCardsCommand,
    ) -> ReleaseWorkCardsResult | Exception:
        try:
            return handler.handle(PLANNER, selected_command)
        except Exception as error:
            return error

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(invoke, item) for item in (first, second)]
        return [future.result(timeout=30) for future in futures]
