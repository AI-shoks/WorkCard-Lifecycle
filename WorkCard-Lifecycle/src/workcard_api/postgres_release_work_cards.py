from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Final, Literal, NoReturn, cast
from uuid import UUID, uuid4

from psycopg import Connection
from psycopg.errors import DeadlockDetected, SerializationFailure, UniqueViolation
from psycopg.types.json import Jsonb

from workcard_api.database import PostgresDatabase
from workcard_api.production_batches import TrustedActor
from workcard_api.release_work_cards import (
    RELEASE_WORK_CARDS_COMMAND_TYPE,
    BatchAlreadyReleased,
    CommandAlreadyProcessed,
    CommandIdReused,
    ConcurrentCommandConflict,
    ProductionBatchInvalid,
    ProductionBatchNotFound,
    ReleaseWorkCardsCommand,
    ReleaseWorkCardSetResult,
    ReleaseWorkCardsFailure,
    ReleaseWorkCardsResult,
    UnexpectedPersistenceFailure,
    VersionConflict,
    WorkCardSetReleasePlan,
    build_release_plan,
    parse_release_operation_plans,
)

COMMAND_RECEIPTS_PRIMARY_KEY: Final = "command_receipts_pkey"
WriteGroup = Literal["sets", "cards", "batch", "receipt", "events"]


@dataclass(frozen=True, slots=True)
class _CommandReceipt:
    command_type: str
    request_hash: str


@dataclass(frozen=True, slots=True)
class _ProductionBatchRow:
    passport_id: UUID
    passport_snapshot: object
    batch_quantity: int
    lifecycle_status: str
    version: int
    released_at: datetime | None


@dataclass(frozen=True, slots=True)
class _PendingEvent:
    event_id: UUID
    aggregate_type: str
    aggregate_id: UUID
    aggregate_version: int
    event_type: str
    data: Mapping[str, object]


class PostgresReleaseWorkCardsGateway:
    def __init__(
        self,
        database: PostgresDatabase,
        *,
        id_factory: Callable[[], UUID] = uuid4,
    ) -> None:
        self._database = database
        self._id_factory = id_factory

    def release_work_cards(
        self,
        actor: TrustedActor,
        command: ReleaseWorkCardsCommand,
        request_hash: str,
    ) -> ReleaseWorkCardsResult:
        try:
            with self._database.connection() as connection:
                return self._execute_transaction(connection, actor, command, request_hash)
        except UniqueViolation as error:
            if is_command_receipt_race(error):
                self._resolve_receipt_race(command.command_id, request_hash)
            raise UnexpectedPersistenceFailure from error
        except (DeadlockDetected, SerializationFailure) as error:
            raise ConcurrentCommandConflict from error
        except ReleaseWorkCardsFailure:
            raise
        except Exception as error:
            raise UnexpectedPersistenceFailure from error

    def _execute_transaction(
        self,
        connection: Connection[tuple[object, ...]],
        actor: TrustedActor,
        command: ReleaseWorkCardsCommand,
        request_hash: str,
    ) -> ReleaseWorkCardsResult:
        result: ReleaseWorkCardsResult
        with connection.transaction():
            connection.execute("SET TRANSACTION ISOLATION LEVEL READ COMMITTED")
            receipt = self._read_receipt(connection, command.command_id)
            if receipt is not None:
                _raise_for_receipt(receipt, request_hash)
            self._after_initial_receipt_lookup()

            batch = self._lock_batch(connection, command.batch_id)
            if batch is None:
                raise ProductionBatchNotFound

            receipt = self._read_receipt(connection, command.command_id)
            if receipt is not None:
                _raise_for_receipt(receipt, request_hash)

            if batch.lifecycle_status != "CREATED" or self._batch_has_sets(
                connection, command.batch_id
            ):
                raise BatchAlreadyReleased
            if batch.released_at is not None:
                raise ProductionBatchInvalid
            if (
                type(batch.batch_quantity) is not int
                or batch.batch_quantity <= 0
                or batch.batch_quantity > 2_147_483_647
            ):
                raise ProductionBatchInvalid

            parse_release_operation_plans(
                batch.passport_snapshot,
                batch.passport_id,
            )
            if batch.version != 1:
                raise ProductionBatchInvalid
            if command.expected_version != batch.version:
                raise VersionConflict

            correlation_id = self._id_factory()
            release_plan = build_release_plan(
                batch.passport_snapshot,
                batch.passport_id,
                self._id_factory,
            )
            if not isinstance(correlation_id, UUID):
                raise UnexpectedPersistenceFailure

            self._insert_sets(connection, command.batch_id, release_plan)
            self._after_write_group(
                connection,
                "sets",
                command,
                correlation_id,
            )
            self._insert_cards(
                connection,
                command.batch_id,
                batch.batch_quantity,
                release_plan,
            )
            self._after_write_group(
                connection,
                "cards",
                command,
                correlation_id,
            )
            self._assert_persisted_release_state(
                connection,
                command.batch_id,
                release_plan,
            )

            updated = connection.execute(
                """
                UPDATE production_batches
                SET lifecycle_status = 'RELEASED',
                    version = version + 1,
                    released_at = clock_timestamp()
                WHERE id = %s
                  AND lifecycle_status = 'CREATED'
                  AND version = %s
                  AND released_at IS NULL
                RETURNING version, released_at
                """,
                (command.batch_id, command.expected_version),
            ).fetchone()
            if updated is None or updated[0] != 2 or not isinstance(updated[1], datetime):
                raise UnexpectedPersistenceFailure
            released_at = updated[1]
            self._after_write_group(
                connection,
                "batch",
                command,
                correlation_id,
            )

            result = self._build_result(command, correlation_id, release_plan)
            result_summary = {
                "batchId": str(command.batch_id),
                "lifecycleStatus": "RELEASED",
                "version": 2,
                "setCount": result.set_count,
                "cardCountTotal": result.card_count_total,
                "workCardSetIds": [str(item.set_id) for item in release_plan],
            }

            self._before_receipt_insert()
            connection.execute(
                """
                INSERT INTO command_receipts (
                    command_id,
                    command_type,
                    request_hash,
                    correlation_id,
                    result_type,
                    result_id,
                    result_summary
                ) VALUES (%s, %s, %s, %s, 'ProductionBatch', %s, %s)
                """,
                (
                    command.command_id,
                    RELEASE_WORK_CARDS_COMMAND_TYPE,
                    request_hash,
                    correlation_id,
                    command.batch_id,
                    Jsonb(result_summary),
                ),
            )
            self._after_write_group(
                connection,
                "receipt",
                command,
                correlation_id,
            )

            pending_events = self._build_pending_events(
                command.batch_id,
                batch.batch_quantity,
                release_plan,
            )
            self._assert_event_invariant(
                command.batch_id,
                release_plan,
                pending_events,
            )
            self._insert_events(
                connection,
                actor,
                command,
                correlation_id,
                released_at,
                pending_events,
            )
            self._after_write_group(
                connection,
                "events",
                command,
                correlation_id,
            )
            self._assert_persisted_event_count(
                connection,
                command.command_id,
                len(pending_events),
            )
        return result

    def _after_initial_receipt_lookup(self) -> None:
        """Concurrency-test seam after the first committed receipt lookup."""

    def _before_receipt_insert(self) -> None:
        """Concurrency-test seam after local state writes and before receipt insertion."""

    def _after_write_group(
        self,
        connection: Connection[tuple[object, ...]],
        group: WriteGroup,
        command: ReleaseWorkCardsCommand,
        correlation_id: UUID,
    ) -> None:
        """Failure-injection seam used by real PostgreSQL rollback tests."""

    def _resolve_receipt_race(self, command_id: UUID, request_hash: str) -> NoReturn:
        try:
            with self._database.connection() as connection:
                receipt = self._read_receipt(connection, command_id)
        except Exception as error:
            raise UnexpectedPersistenceFailure from error
        if receipt is None:
            raise ConcurrentCommandConflict
        _raise_for_receipt(receipt, request_hash)

    @staticmethod
    def _read_receipt(
        connection: Connection[tuple[object, ...]],
        command_id: UUID,
    ) -> _CommandReceipt | None:
        row = connection.execute(
            """
            SELECT command_type, request_hash
            FROM command_receipts
            WHERE command_id = %s
            """,
            (command_id,),
        ).fetchone()
        if row is None:
            return None
        return _CommandReceipt(command_type=cast(str, row[0]), request_hash=cast(str, row[1]))

    @staticmethod
    def _lock_batch(
        connection: Connection[tuple[object, ...]],
        batch_id: UUID,
    ) -> _ProductionBatchRow | None:
        row = connection.execute(
            """
            SELECT
                passport_id,
                passport_snapshot,
                batch_quantity,
                lifecycle_status,
                version,
                released_at
            FROM production_batches
            WHERE id = %s
            FOR UPDATE
            """,
            (batch_id,),
        ).fetchone()
        if row is None:
            return None
        return _ProductionBatchRow(
            passport_id=cast(UUID, row[0]),
            passport_snapshot=row[1],
            batch_quantity=cast(int, row[2]),
            lifecycle_status=cast(str, row[3]),
            version=cast(int, row[4]),
            released_at=cast(datetime | None, row[5]),
        )

    @staticmethod
    def _batch_has_sets(
        connection: Connection[tuple[object, ...]],
        batch_id: UUID,
    ) -> bool:
        row = connection.execute(
            "SELECT EXISTS (SELECT 1 FROM work_card_sets WHERE batch_id = %s)",
            (batch_id,),
        ).fetchone()
        if row is None:
            raise UnexpectedPersistenceFailure
        return cast(bool, row[0])

    @staticmethod
    def _insert_sets(
        connection: Connection[tuple[object, ...]],
        batch_id: UUID,
        release_plan: Sequence[WorkCardSetReleasePlan],
    ) -> None:
        rows = [
            (
                item.set_id,
                batch_id,
                str(item.operation_plan.operation_plan_id),
                Jsonb(dict(item.operation_plan.operation_scope)),
                item.operation_plan.norm_hours,
                item.operation_plan.planned_card_count,
            )
            for item in release_plan
        ]
        with connection.cursor() as cursor:
            cursor.executemany(
                """
                INSERT INTO work_card_sets (
                    id,
                    batch_id,
                    operation_plan_key,
                    operation_scope_snapshot,
                    norm_hours_snapshot,
                    planned_card_count,
                    gate_status,
                    first_article_work_card_id,
                    version
                ) VALUES (
                    %s, %s, %s, %s, %s, %s,
                    'FIRST_ARTICLE_PENDING', NULL, 1
                )
                """,
                rows,
            )

    @staticmethod
    def _insert_cards(
        connection: Connection[tuple[object, ...]],
        batch_id: UUID,
        batch_quantity: int,
        release_plan: Sequence[WorkCardSetReleasePlan],
    ) -> None:
        rows = [
            (
                work_card_id,
                item.set_id,
                batch_id,
                batch_quantity,
                Jsonb(dict(item.operation_plan.operation_scope)),
                item.operation_plan.norm_hours,
            )
            for item in release_plan
            for work_card_id in item.work_card_ids
        ]
        with connection.cursor() as cursor:
            cursor.executemany(
                """
                INSERT INTO work_cards (
                    id,
                    set_id,
                    batch_id,
                    batch_quantity_snapshot,
                    operation_scope_snapshot,
                    norm_hours_snapshot,
                    purpose,
                    status,
                    assignee_id,
                    version
                ) VALUES (
                    %s, %s, %s, %s, %s, %s,
                    NULL, 'RELEASED', NULL, 1
                )
                """,
                rows,
            )

    @staticmethod
    def _assert_persisted_release_state(
        connection: Connection[tuple[object, ...]],
        batch_id: UUID,
        release_plan: Sequence[WorkCardSetReleasePlan],
    ) -> None:
        set_rows = connection.execute(
            """
            SELECT
                id,
                operation_plan_key,
                operation_scope_snapshot,
                norm_hours_snapshot,
                planned_card_count,
                gate_status,
                first_article_work_card_id,
                version
            FROM work_card_sets
            WHERE batch_id = %s
            """,
            (batch_id,),
        ).fetchall()
        expected_sets = {item.set_id: item for item in release_plan}
        if len(set_rows) != len(expected_sets):
            raise UnexpectedPersistenceFailure
        for row in set_rows:
            set_id = cast(UUID, row[0])
            expected = expected_sets.get(set_id)
            if expected is None:
                raise UnexpectedPersistenceFailure
            operation_plan = expected.operation_plan
            if (
                row[1] != str(operation_plan.operation_plan_id)
                or row[2] != dict(operation_plan.operation_scope)
                or not isinstance(row[3], Decimal)
                or format(row[3], ".2f") != operation_plan.norm_hours
                or row[4] != operation_plan.planned_card_count
                or row[5] != "FIRST_ARTICLE_PENDING"
                or row[6] is not None
                or row[7] != 1
            ):
                raise UnexpectedPersistenceFailure

        card_rows = connection.execute(
            """
            SELECT
                set_id,
                count(*),
                min(version),
                max(version),
                bool_and(status = 'RELEASED'),
                count(purpose),
                count(assignee_id)
            FROM work_cards
            WHERE batch_id = %s
            GROUP BY set_id
            """,
            (batch_id,),
        ).fetchall()
        expected_counts = {
            item.set_id: item.operation_plan.planned_card_count for item in release_plan
        }
        actual_counts: dict[UUID, int] = {}
        for row in card_rows:
            set_id = cast(UUID, row[0])
            if (
                set_id not in expected_counts
                or row[2] != 1
                or row[3] != 1
                or row[4] is not True
                or row[5] != 0
                or row[6] != 0
            ):
                raise UnexpectedPersistenceFailure
            actual_counts[set_id] = cast(int, row[1])
        if actual_counts != expected_counts:
            raise UnexpectedPersistenceFailure

    def _build_pending_events(
        self,
        batch_id: UUID,
        batch_quantity: int,
        release_plan: Sequence[WorkCardSetReleasePlan],
    ) -> tuple[_PendingEvent, ...]:
        set_ids = [str(item.set_id) for item in release_plan]
        card_count_total = sum(len(item.work_card_ids) for item in release_plan)
        events = [
            _PendingEvent(
                event_id=self._id_factory(),
                aggregate_type="ProductionBatch",
                aggregate_id=batch_id,
                aggregate_version=2,
                event_type="ProductionBatchReleased",
                data={
                    "batchId": str(batch_id),
                    "workCardSetIds": set_ids,
                    "setCount": len(release_plan),
                    "cardCountTotal": card_count_total,
                },
            )
        ]
        for item in release_plan:
            operation_plan = item.operation_plan
            events.append(
                _PendingEvent(
                    event_id=self._id_factory(),
                    aggregate_type="WorkCardSet",
                    aggregate_id=item.set_id,
                    aggregate_version=1,
                    event_type="WorkCardSetCreated",
                    data={
                        "setId": str(item.set_id),
                        "batchId": str(batch_id),
                        "operationPlanId": str(operation_plan.operation_plan_id),
                        "position": operation_plan.position,
                        "operationScope": dict(operation_plan.operation_scope),
                        "normHours": operation_plan.norm_hours,
                        "plannedCardCount": operation_plan.planned_card_count,
                        "gateStatus": "FIRST_ARTICLE_PENDING",
                    },
                )
            )
            for work_card_id in item.work_card_ids:
                events.append(
                    _PendingEvent(
                        event_id=self._id_factory(),
                        aggregate_type="WorkCard",
                        aggregate_id=work_card_id,
                        aggregate_version=1,
                        event_type="WorkCardReleased",
                        data={
                            "workCardId": str(work_card_id),
                            "setId": str(item.set_id),
                            "batchId": str(batch_id),
                            "batchQuantitySnapshot": batch_quantity,
                            "operationScope": dict(operation_plan.operation_scope),
                            "normHours": operation_plan.norm_hours,
                            "status": "RELEASED",
                        },
                    )
                )
        if any(not isinstance(item.event_id, UUID) for item in events):
            raise UnexpectedPersistenceFailure
        if len({item.event_id for item in events}) != len(events):
            raise UnexpectedPersistenceFailure
        return tuple(events)

    @staticmethod
    def _assert_event_invariant(
        batch_id: UUID,
        release_plan: Sequence[WorkCardSetReleasePlan],
        pending_events: Sequence[_PendingEvent],
    ) -> None:
        changed_aggregates = {
            ("ProductionBatch", batch_id),
            *(("WorkCardSet", item.set_id) for item in release_plan),
            *(
                ("WorkCard", work_card_id)
                for item in release_plan
                for work_card_id in item.work_card_ids
            ),
        }
        event_aggregates = {(item.aggregate_type, item.aggregate_id) for item in pending_events}
        if len(pending_events) != len(changed_aggregates) or event_aggregates != changed_aggregates:
            raise UnexpectedPersistenceFailure

    @staticmethod
    def _insert_events(
        connection: Connection[tuple[object, ...]],
        actor: TrustedActor,
        command: ReleaseWorkCardsCommand,
        correlation_id: UUID,
        occurred_at: datetime,
        pending_events: Sequence[_PendingEvent],
    ) -> None:
        rows = [
            (
                event.event_id,
                event.aggregate_type,
                event.aggregate_id,
                event.aggregate_version,
                event.event_type,
                actor.actor_id,
                actor.role,
                command.command_id,
                correlation_id,
                occurred_at,
                Jsonb(dict(event.data)),
            )
            for event in pending_events
        ]
        with connection.cursor() as cursor:
            cursor.executemany(
                """
                INSERT INTO audit_events (
                    id,
                    aggregate_type,
                    aggregate_id,
                    aggregate_version,
                    event_type,
                    actor_id,
                    actor_role,
                    command_id,
                    correlation_id,
                    occurred_at,
                    data
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
                )
                """,
                rows,
            )

    @staticmethod
    def _assert_persisted_event_count(
        connection: Connection[tuple[object, ...]],
        command_id: UUID,
        expected_count: int,
    ) -> None:
        row = connection.execute(
            "SELECT count(*) FROM audit_events WHERE command_id = %s",
            (command_id,),
        ).fetchone()
        if row is None or row[0] != expected_count:
            raise UnexpectedPersistenceFailure

    @staticmethod
    def _build_result(
        command: ReleaseWorkCardsCommand,
        correlation_id: UUID,
        release_plan: Sequence[WorkCardSetReleasePlan],
    ) -> ReleaseWorkCardsResult:
        work_card_sets = tuple(
            ReleaseWorkCardSetResult(
                set_id=item.set_id,
                operation_plan_id=item.operation_plan.operation_plan_id,
                position=item.operation_plan.position,
                operation_scope=dict(item.operation_plan.operation_scope),
                norm_hours=item.operation_plan.norm_hours,
                planned_card_count=item.operation_plan.planned_card_count,
                gate_status="FIRST_ARTICLE_PENDING",
                version=1,
            )
            for item in release_plan
        )
        return ReleaseWorkCardsResult(
            batch_id=command.batch_id,
            lifecycle_status="RELEASED",
            version=2,
            set_count=len(work_card_sets),
            card_count_total=sum(item.planned_card_count for item in work_card_sets),
            work_card_sets=work_card_sets,
            command_id=command.command_id,
            correlation_id=correlation_id,
        )


def is_command_receipt_race(error: UniqueViolation) -> bool:
    return error.diag.constraint_name == COMMAND_RECEIPTS_PRIMARY_KEY


def _raise_for_receipt(receipt: _CommandReceipt, request_hash: str) -> NoReturn:
    if (
        receipt.command_type == RELEASE_WORK_CARDS_COMMAND_TYPE
        and receipt.request_hash == request_hash
    ):
        raise CommandAlreadyProcessed
    raise CommandIdReused
