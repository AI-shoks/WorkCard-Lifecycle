---
artifact_id: architecture.audit-log
status: accepted
version: 5
owner: architecture
updated: 2026-09-27
---

# Audit Log Design

Audit log — append-only доказательство успешных изменяющих команд. Он не является event-sourced источником текущего состояния и не заменяет отдельные `FinalBatchAcceptance`/`PayrollRecord`.

## Event envelope

| Поле | Тип | Смысл |
|---|---|---|
| `id` | UUID | уникальный event ID |
| `eventType` | string | канонический тип из [[commands-events]] |
| `aggregateType` | string | `ProductionBatch`, `WorkCardSet`, `WorkCard`, `PayrollRecord` |
| `aggregateId` | UUID | внутренний technical ID |
| `aggregateVersion` | positive integer | resulting version изменённого root |
| `occurredAt` | RFC 3339 UTC | время API-процесса, общее для одной команды |
| `actorId`, `actorRole` | trusted context | не принимаются из command body |
| `commandId` | UUID | idempotency ID исходной команды |
| `correlationId` | UUID | общий ID всех событий транзакции |
| `data` | JSON object | минимальный immutable факт/снимок изменения; SQL-колонка называется `payload` |

Пример события карточки:

```json
{
  "id": "uuid",
  "eventType": "WorkCardAssigned",
  "aggregateType": "WorkCard",
  "aggregateId": "uuid",
  "aggregateVersion": 2,
  "occurredAt": "2026-09-01T12:00:00Z",
  "actorId": "uuid",
  "actorRole": "MASTER",
  "commandId": "uuid",
  "correlationId": "uuid",
  "data": {
    "workCardId": "uuid",
    "assigneeId": "uuid",
    "purpose": "SERIAL",
    "status": "ASSIGNED"
  }
}
```

`data` не дублирует весь aggregate. Service формирует поля для объяснения факта и проверки traceability, без cookie, CSRF, request headers, stack traces, secrets или копии произвольного request body. Публичная response-схема `AuditEventSchema` сохраняет общий envelope и `data: Record<string, unknown>`. Перед записью внутренний [AuditInsert/validator](../../apps/api/src/audit-event.ts) связывает 12 event types с aggregate type и точной формой payload: обязательные UUID, enum, положительные counts/norms, вложенные snapshots и UTC timestamp. Identity в payload должна совпадать с aggregate ID; дублированная final batch version — с envelope version. `ProductionBatchReleased` теперь сохраняет предусмотренные [[commands-events]] `workCardSetIds`; список уникален, непуст и соответствует `setCount`. Ранее сохранённые события не переписываются.

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

- event нарушает unique `(aggregateType, aggregateId, aggregateVersion)`;
- receipt не перешёл в `SUCCEEDED`;
- предметный update затронул не ожидаемое число rows;
- payload не прошёл event-specific validator или resulting version не равна предыдущей `+1`;
- версия события не совпала с сохранённым агрегатом либо агрегат отсутствует;
- PostgreSQL вернул меньше вставленных audit rows, чем содержит event set.

`insertAuditEvents` проверяет payload, затем одним SQL query сравнивает версии событий с текущими rows всех затронутых агрегатов внутри той же транзакции. Существующие roots уже заблокированы командой; новые rows принадлежат ей. Для immutable `PayrollRecord` проверяются существование и v1. Затем весь event set вставляется одним statement; его фактический `rowCount` обязан равняться длине массива, которую receipt сохраняет как `event_count`. Дополнительный `COUNT(*)` перед commit не нужен для этих путей: одна проверенная вставка, SQL unique constraints и общий rollback уже обеспечивают число записей. `getAuditCorrelation` сохраняет независимую проверку totals при чтении. Это application guard, а не новый DB constraint для произвольного owner SQL; миграции не изменены.

Для массового выпуска fixture ожидается `1 + 3 + 250 = 254` events. Это намеренно больше одной summary-записи: `BR-050` требует событие каждого изменённого aggregate.

## Неизменяемость

Defense in depth:

1. В application service отсутствуют методы update/delete audit.
2. Runtime DB role имеет только `SELECT, INSERT` на `audit_events`.
3. `BEFORE UPDATE OR DELETE` trigger всегда raises exception.
4. API не публикует mutation endpoint для истории.
5. Migration/owner role отделена от runtime role и используется контролируемыми owner-операциями migrations/bootstrap/reset/verify/recovery.

В local/test audit живёт вместе с disposable DB. В public demo audit является synthetic visitor data и удаляется owner reset вместе с aggregate/receipt/result rows. Обычно reset выполняется ежедневно; через 26 часов API закрывается, но это не обещание удаления rows в точно заданный момент. Reset идёт под DB exclusive barrier после закрытия persistent gate и завершения допущенных runtime operations, проверяет пустые mutable tables и сохраняет reference fixtures. Recovery допускает потерю всей истории посетителей; достаточно migrations + initial seed + verify. Короткое Neon restore window не является архивом audit. Release manifests/scan/deployment evidence хранятся отдельно на весь lifecycle/rollback и reset их не затрагивает. Текущий контракт — [[0009-render-free-neon-free-release|ADR-0009]].

## История aggregate

`GET /work-cards/{id}/history` фильтрует по `(aggregate_type = 'WorkCard', aggregate_id)` и сортирует по `(aggregate_version, id)`. Related set/batch events не маскируются под card history. Unique SQL constraint запрещает duplicate aggregate version; API не проверяет непрерывность всех версий истории. Frontend `admin-audit.ts` проверяет принадлежность карточке, порядок, повтор cursor/event ID, но также не доказывает отсутствие gaps. Непрерывность истории остаётся неподтверждённой дополнительной гарантией первоначального дизайна; требование аудита успешных изменений не отменяется.

UI может показать связанный context отдельными ссылками по correlation. Технические event type/UUID находятся в закрытом developer block; верхний уровень использует русский предметный текст.

## Полный query по correlation

Канонический endpoint — `GET /api/v1/audit-correlations/{correlationId}`. Он:

1. загружает `command_receipt` по correlation;
2. считает все events server-side;
3. возвращает `expectedEventCount`, `totalEventCount` и cursor page;
4. сортирует `(occurred_at, id)`;
5. отдаёт `500 AUDIT_INTEGRITY_ERROR`, если totals расходятся; отдельный внешний alerting service в MVP не реализован.

Такой query покрывает `UC-014` для событий разных агрегатов. Объединение отдельных card histories клиентом не считается доказательством полноты.

## Доступ

- `ADMIN_AUDITOR` читает aggregate/correlation history и technical details.
- Другие роли получают разрешённые предметные projections и timestamps; оба raw history/correlation endpoints требуют `ADMIN_AUDITOR`. Отдельная business timeline API для остальных ролей не реализована.
- Наличие UUID не даёт права чтения.
- Unauthorized/forbidden response не раскрывает существование закрытого aggregate или actor data.

## Время и порядок

Все events одной команды получают единый `occurredAt`, сформированный `new Date().toISOString()` в `executeCommand` перед `BEGIN`, и один correlation. Это server time API, а не DB `transaction_timestamp()` и не время commit. Между разными транзакциями wall-clock не является строгим global sequence, поэтому deterministic order завершает UUID. История aggregate прежде всего сортируется по version.

Глобальный монотонный event sequence не нужен MVP. Если появится внешний consumer/outbox, это будет отдельным ADR и не изменит задним числом смысл существующих events.

## Наблюдаемость и audit — разные данные

Operational logs содержат `requestId`, `commandId`/`correlationId` при наличии, route, latency, status и безопасный error code. Они могут ротироваться и не доказывают предметный факт. Audit events содержат бизнес-факт и неизменяемы, но не хранят технические stack traces или performance details.

## Проверки

Перечень ниже задаёт ожидаемые свойства; подтверждение выполнения для конкретного SHA/окружения находится в [[quality-gates]] и [[requirements-traceability]]. Статическая сверка и техническое исправление FA-01/02 2026-09-27 разделены в [[final-audit]]; результаты локальных прогонов относятся только к изменённому checkout.

- success state без events и events без state невозможны под injected failure;
- replay не увеличивает event count;
- correlation выпуска возвращает ровно `254` уникальных events;
- per-card confirmation не создаёт `FinalBatchAccepted`;
- final acceptance создаёт ровно один batch-level event и одну immutable acceptance row;
- runtime role получает отказ на update/delete;
- [unit validator](../../apps/api/src/audit-event.test.ts) проверяет формы всех event types; [PostgreSQL fault tests](../../quality/audit-invariants.test.ts) проверяют rollback при плохом payload, неверной/отсутствующей aggregate version, неправильном increment и подавленной вставке события;
- audit API не доступен роли без права и не раскрывает actor/session secrets.
