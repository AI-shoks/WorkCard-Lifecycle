---
artifact_id: architecture.audit-log
status: accepted
version: 2
owner: architecture
updated: 2026-09-06
---

# Audit Log Design

Audit log — append-only доказательство успешных изменяющих команд. Он не является event-sourced источником текущего состояния и не заменяет отдельные `FinalBatchAcceptance`/`PayrollRecord`.

## Event envelope

| Поле | Тип | Смысл |
|---|---|---|
| `id` | UUID | уникальный event ID |
| `eventType` | string | канонический тип из [[commands-events]] |
| `aggregateType` | string | `PRODUCTION_BATCH`, `WORK_CARD_SET`, `WORK_CARD`, `PAYROLL_RECORD` |
| `aggregateId` | UUID | внутренний technical ID |
| `aggregateVersion` | positive integer | resulting version изменённого root |
| `occurredAt` | RFC 3339 UTC | server/database command time |
| `actorId`, `actorRole` | trusted context | не принимаются из command body |
| `commandId` | UUID | idempotency ID исходной команды |
| `correlationId` | UUID | общий ID всех событий транзакции |
| `payload` | JSON object | минимальный immutable факт/снимок изменения |

Пример события карточки:

```json
{
  "id": "uuid",
  "eventType": "WorkCardAssigned",
  "aggregateType": "WORK_CARD",
  "aggregateId": "uuid",
  "aggregateVersion": 2,
  "occurredAt": "2026-09-01T12:00:00Z",
  "actorId": "uuid",
  "actorRole": "MASTER",
  "commandId": "uuid",
  "correlationId": "uuid",
  "payload": {
    "workCardSetId": "uuid",
    "assigneeId": "uuid",
    "purpose": "SERIAL",
    "fromStatus": "RELEASED",
    "toStatus": "ASSIGNED"
  }
}
```

Payload не дублирует весь aggregate. Он содержит поля, нужные для объяснения факта и проверки traceability, но не cookie, CSRF, request headers, stack traces, secrets или произвольный body.

## События по командам

| Команда | Aggregate events |
|---|---|
| `CreateProductionBatch` | `ProductionBatchCreated` |
| `ReleaseWorkCards` | `ProductionBatchReleased`, по одному `WorkCardSetCreated`, по одному `WorkCardReleased` |
| `AssignWorkCards` | по одному `WorkCardAssigned`; для first article также `FirstArticleWorkCardSelected` set event |
| `StartWorkCard` | `WorkCardStarted` |
| `CompleteWorkCard` | `WorkCardCompleted` |
| `AcceptFirstArticle` | `WorkCardQualityConfirmed` (`FIRST_ARTICLE`) + `FirstArticleAccepted` |
| `ConfirmWorkCardQuality` | `WorkCardQualityConfirmed` (`SERIAL`, scope `WORK_CARD`) |
| `RecordFinalBatchAcceptance` | `FinalBatchAccepted` на `ProductionBatch` |
| первый `ExportWorkCardToPayroll` | `WorkCardExportedToPayroll` на immutable `PayrollRecord` v1 |

Replay/idempotent read существующего result не является новым успешным изменением и не создаёт event.

## Атомарность

Event rows вставляются той же PostgreSQL transaction и тем же connection, что state changes и command receipt. Transaction не коммитится, если:

- число созданных events не равно вычисленному `event_count`;
- event нарушает unique `(aggregateType, aggregateId, aggregateVersion)`;
- receipt не перешёл в `SUCCEEDED`;
- предметный update затронул не ожидаемое число rows.

Для массового выпуска fixture ожидается `1 + 3 + 250 = 254` events. Это намеренно больше одной summary-записи: `BR-050` требует событие каждого изменённого aggregate.

## Неизменяемость

Defense in depth:

1. В application repository отсутствуют методы update/delete audit.
2. Runtime DB role имеет только `SELECT, INSERT` на `audit_events`.
3. `BEFORE UPDATE OR DELETE` trigger всегда raises exception.
4. API не публикует mutation endpoint для истории.
5. Migration/owner role отделена от runtime role и используется только в контролируемом migration job.

В local/test audit живёт вместе с соответствующей demo-БД. В общем public production он является изменяемыми synthetic demo-данными и удаляется owner-only reset не реже одного раза в 24 часа вместе с aggregate/receipt/result rows. Reset идёт только после закрытия public access и drain, транзакционно проверяет пустые mutable tables и не удаляет reference fixtures. Backup/PITR может содержать прежнее состояние до 7 дней. Audit не является release evidence: manifests, IAM snapshots и hosted execution records хранятся отдельно и reset их не затрагивает. Tenant/archive/export architecture вне MVP по [[0008-bounded-public-demo-operations|ADR-0008]].

## История aggregate

`GET /work-cards/{id}/history` фильтрует по `(aggregate_type, aggregate_id)` и сортирует по `(aggregate_version, occurred_at, id)`. API проверяет отсутствие пропуска/дубликата версий, но related set/batch events не маскируются под card history.

UI может показать связанный context отдельными ссылками по correlation. Технические event type/UUID находятся в закрытом developer block; верхний уровень использует русский предметный текст.

## Полный query по correlation

Канонический endpoint — `GET /api/v1/audit-correlations/{correlationId}`. Он:

1. загружает `command_receipt` по correlation;
2. считает все events server-side;
3. возвращает `expectedEventCount`, `totalEventCount` и cursor page;
4. сортирует `(occurred_at, aggregate_type, aggregate_id, aggregate_version, id)`;
5. отдаёт integrity error/операционный alert, если totals расходятся.

Такой query покрывает `UC-014` для событий разных агрегатов. Объединение отдельных card histories клиентом не считается доказательством полноты.

## Доступ

- `ADMIN_AUDITOR` читает aggregate/correlation history и technical details.
- Другие роли получают только безопасную business timeline projection тех объектов, которые им разрешены; raw envelope недоступен.
- Наличие UUID не даёт права чтения.
- Unauthorized/forbidden response не раскрывает существование закрытого aggregate или actor data.

## Время и порядок

Все events одной команды получают единый `occurredAt` из DB (`transaction_timestamp()`) и один correlation. Между разными транзакциями wall-clock не является строгим global sequence, поэтому deterministic order завершает UUID. История aggregate прежде всего сортируется по version.

Глобальный монотонный event sequence не нужен MVP. Если появится внешний consumer/outbox, это будет отдельным ADR и не изменит задним числом смысл существующих events.

## Наблюдаемость и audit — разные данные

Operational logs содержат `requestId`, `commandId`/`correlationId` при наличии, route, latency, status и безопасный error code. Они могут ротироваться и не доказывают предметный факт. Audit events содержат бизнес-факт и неизменяемы, но не хранят технические stack traces или performance details.

## Проверки

- success state без events и events без state невозможны под injected failure;
- replay не увеличивает event count;
- correlation выпуска возвращает ровно `254` уникальных events;
- per-card confirmation не создаёт `FinalBatchAccepted`;
- final acceptance создаёт ровно один batch-level event и одну immutable acceptance row;
- runtime role получает отказ на update/delete;
- payload snapshot schema валидируется для каждого event type;
- audit API не доступен роли без права и не раскрывает actor/session secrets.
