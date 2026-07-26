from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from decimal import Decimal
from typing import Final, NoReturn, cast
from uuid import UUID, uuid4

from psycopg import Connection
from psycopg.errors import DeadlockDetected, SerializationFailure, UniqueViolation
from psycopg.types.json import Jsonb

from workcard_api.database import PostgresDatabase
from workcard_api.production_batches import (
    CREATE_PRODUCTION_BATCH_COMMAND_TYPE,
    CommandAlreadyProcessed,
    CommandIdReused,
    ConcurrentCommandConflict,
    CreateProductionBatchCommand,
    CreateProductionBatchFailure,
    CreateProductionBatchResult,
    OperationPlanRecord,
    ProductionPassportNotFound,
    ProductionPassportRecord,
    TrustedActor,
    UnexpectedPersistenceFailure,
    build_production_passport_snapshot,
)

COMMAND_RECEIPTS_PRIMARY_KEY: Final = "command_receipts_pkey"


@dataclass(frozen=True, slots=True)
class _CommandReceipt:
    command_type: str
    request_hash: str


class PostgresCreateProductionBatchGateway:
    def __init__(
        self,
        database: PostgresDatabase,
        *,
        id_factory: Callable[[], UUID] = uuid4,
    ) -> None:
        self._database = database
        self._id_factory = id_factory

    def create_production_batch(
        self,
        actor: TrustedActor,
        command: CreateProductionBatchCommand,
        request_hash: str,
    ) -> CreateProductionBatchResult:
        try:
            with self._database.connection() as connection:
                return self._execute_transaction(connection, actor, command, request_hash)
        except UniqueViolation as error:
            if is_command_receipt_race(error):
                self._resolve_receipt_race(command.command_id, request_hash)
            raise UnexpectedPersistenceFailure from error
        except (DeadlockDetected, SerializationFailure) as error:
            raise ConcurrentCommandConflict from error
        except CreateProductionBatchFailure:
            raise
        except Exception as error:
            raise UnexpectedPersistenceFailure from error

    def _execute_transaction(
        self,
        connection: Connection[tuple[object, ...]],
        actor: TrustedActor,
        command: CreateProductionBatchCommand,
        request_hash: str,
    ) -> CreateProductionBatchResult:
        result: CreateProductionBatchResult
        with connection.transaction():
            receipt = self._read_receipt(connection, command.command_id)
            if receipt is not None:
                _raise_for_receipt(receipt, request_hash)

            passport, plans = self._read_passport_and_operation_plans(
                connection, command.production_passport_id
            )
            if passport is None:
                raise ProductionPassportNotFound
            snapshot = build_production_passport_snapshot(passport, plans)
            snapshot_json = snapshot.to_json()

            batch_id = self._id_factory()
            correlation_id = self._id_factory()
            event_id = self._id_factory()
            connection.execute(
                """
                INSERT INTO production_batches (
                    id,
                    passport_id,
                    passport_snapshot,
                    batch_quantity,
                    lifecycle_status,
                    version,
                    released_at
                ) VALUES (%s, %s, %s, %s, 'CREATED', 1, NULL)
                """,
                (
                    batch_id,
                    command.production_passport_id,
                    Jsonb(snapshot_json),
                    command.quantity,
                ),
            )

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
                    CREATE_PRODUCTION_BATCH_COMMAND_TYPE,
                    request_hash,
                    correlation_id,
                    batch_id,
                    Jsonb(
                        {
                            "batchId": str(batch_id),
                            "lifecycleStatus": "CREATED",
                            "version": 1,
                        }
                    ),
                ),
            )
            connection.execute(
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
                    %s,
                    'ProductionBatch',
                    %s,
                    1,
                    'ProductionBatchCreated',
                    %s,
                    %s,
                    %s,
                    %s,
                    clock_timestamp(),
                    %s
                )
                """,
                (
                    event_id,
                    batch_id,
                    actor.actor_id,
                    actor.role,
                    command.command_id,
                    correlation_id,
                    Jsonb(
                        {
                            "batchId": str(batch_id),
                            "quantity": command.quantity,
                            "passportSnapshot": snapshot_json,
                        }
                    ),
                ),
            )
            result = CreateProductionBatchResult(
                batch_id=batch_id,
                production_passport_id=command.production_passport_id,
                quantity=command.quantity,
                lifecycle_status="CREATED",
                version=1,
                passport_snapshot=snapshot,
                command_id=command.command_id,
                correlation_id=correlation_id,
            )
        return result

    def _before_receipt_insert(self) -> None:
        """Concurrency-test seam immediately before the real receipt INSERT."""

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
    def _read_passport_and_operation_plans(
        connection: Connection[tuple[object, ...]],
        passport_id: UUID,
    ) -> tuple[ProductionPassportRecord | None, list[OperationPlanRecord]]:
        rows = connection.execute(
            """
            SELECT
                passport.id,
                passport.code,
                passport.revision,
                passport.product_name,
                passport.active,
                plan.id,
                plan.position,
                plan.operation_scope,
                plan.norm_hours,
                plan.planned_card_count
            FROM production_passports AS passport
            LEFT JOIN operation_plans AS plan ON plan.passport_id = passport.id
            WHERE passport.id = %s
            ORDER BY plan.position ASC NULLS LAST
            """,
            (passport_id,),
        ).fetchall()
        if not rows:
            return None, []
        passport = ProductionPassportRecord(
            production_passport_id=cast(UUID, rows[0][0]),
            code=cast(str, rows[0][1]),
            revision=cast(str, rows[0][2]),
            product_name=cast(str, rows[0][3]),
            active=cast(bool, rows[0][4]),
        )
        plans = [
            OperationPlanRecord(
                operation_plan_id=cast(UUID, row[5]),
                position=cast(int, row[6]),
                operation_scope=cast(Mapping[str, object], row[7]),
                norm_hours=cast(Decimal, row[8]),
                planned_card_count=cast(int, row[9]),
            )
            for row in rows
            if row[5] is not None
        ]
        return passport, plans


def is_command_receipt_race(error: UniqueViolation) -> bool:
    return error.diag.constraint_name == COMMAND_RECEIPTS_PRIMARY_KEY


def _raise_for_receipt(receipt: _CommandReceipt, request_hash: str) -> NoReturn:
    if (
        receipt.command_type == CREATE_PRODUCTION_BATCH_COMMAND_TYPE
        and receipt.request_hash == request_hash
    ):
        raise CommandAlreadyProcessed
    raise CommandIdReused
