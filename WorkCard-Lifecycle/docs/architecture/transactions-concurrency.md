---
artifact_id: architecture.transactions-concurrency
status: accepted
version: 4
owner: architecture
updated: 2026-07-27
---

# Transactions and Concurrency

Транзакционные границы, lock order и optimistic concurrency MVP v1. Решение реализует `BR-002`, `BR-051`, `BR-060`–`BR-062` и принято в [[0003-concurrency-and-transactions]].

## Базовая модель

- PostgreSQL — единственный transaction coordinator;
- application service открывает transaction на одну business command;
- current-state rows, immutable result, command receipt и все success events commit/rollback совместно;
- successful no-op может зафиксировать receipt без current-state changes и без events только там, где контракт явно разрешает такой результат;
- существующие изменяемые агрегаты проверяются по client `expectedVersion`;
- каждая фактически изменённая aggregate row получает `version = version + 1` ровно один раз;
- read-only context row может иметь expected version как gate precondition, но не увеличивается;
- database/driver retry serialization или deadlock failure не превращается в автоматический business-command replay: API возвращает `409`, пользователь перечитывает state.

## Условное обновление

Одиночный aggregate изменяется эквивалентом:

```sql
UPDATE work_cards
SET status = $new_status,
    version = version + 1
WHERE id = $id
  AND version = $expected_version
  AND status = $expected_status
RETURNING *;
```

Ноль строк означает not-found, state/gate conflict или version conflict; service различает безопасную категорию только после permission check. Предыдущая row не перезаписывается.

## Канонический порядок locks

Чтобы уменьшить deadlocks, изменяющие services блокируют существующие rows в порядке:

1. `production_batches`;
2. `work_card_sets` по UUID;
3. `work_cards` по UUID;
4. `final_batch_acceptances` / `payroll_records` business-key check;
5. `command_receipts` и вставляемые `audit_events`.

Если верхний объект операции не меняется, порядок начинается с ближайшего затронутого уровня. Набор UUID сортирует backend, порядок из request не влияет на locks.

## Матрица операций

| Команда | Isolation и locks | Проверяемые versions | Изменяемые versions |
|---|---|---|---|
| `CreateProductionBatch` | `READ COMMITTED`; passport/plans consistent read; insert batch | нет существующего агрегата | batch создаётся version `1` |
| `ReleaseWorkCards` | `READ COMMITTED`; `FOR UPDATE` batch | batch | batch `+1`; sets/cards создаются version `1` |
| first-article `AssignWorkCards` | `READ COMMITTED`; lock set, затем card | set + card | set `+1`, card `+1` |
| serial mass `AssignWorkCards` | `READ COMMITTED`; lock set, затем все cards | set gate version + все cards | только cards `+1` |
| `StartWorkCard` / `CompleteWorkCard` | conditional card update | card | card `+1` |
| `AcceptFirstArticle` | lock set, затем card | set + card | оба `+1` |
| `ConfirmWorkCardQuality` | lock/read set, conditional card update | set gate version + card | только card `+1` |
| `RecordFinalBatchAcceptance` | `SERIALIZABLE`; lock batch, consistent aggregate completion query | batch | batch `+1`; acceptance version не изменяется |
| `ExportWorkCardToPayroll` | `READ COMMITTED`; lock/read card; `INSERT ... ON CONFLICT DO NOTHING` | WorkCard read version | первый export создаёт immutable PayrollRecord; при существующей row state/version не меняются |

## Создание партии

`CreateProductionBatch` выполняется одной `READ COMMITTED` transaction:

1. после session/CSRF, permission и schema checks backend canonicalizes request и проверяет committed receipt;
2. passport и его непустые operation plans читаются согласованно, plans сортируются по `position ASC`, затем server строит полный allowlisted immutable snapshot по [[commands-events]];
3. application генерирует `batchId`, один `correlationId` и event timestamp UTC внутри transaction;
4. вставляются `production_batches` версии `1`, `command_receipts` и ровно один `ProductionBatchCreated` с `aggregateVersion = 1`;
5. transaction commits до формирования `201` response.

Любая validation, serialization, receipt, batch, event или database failure откатывает все три записи. Частичный commit запрещён.

### Точный command receipt

| Поле | Значение |
|---|---|
| `command_id` | UUID из `X-Command-Id` |
| `command_type` | `CreateProductionBatch` |
| `request_hash` | SHA-256 digest canonical request по точному алгоритму [[api-contracts]] |
| `correlation_id` | тот же server-generated UUID, что в event и success `meta.correlationId` |
| `result_type` | `ProductionBatch` |
| `result_id` | `batchId` созданной строки, event aggregate ID и success `data.batchId` |
| `result_summary` | точный JSON object ниже |

```json
{
  "batchId": "uuid",
  "lifecycleStatus": "CREATED",
  "version": 1
}
```

Receipt, batch и event вставляются и фиксируются только вместе. `result_summary` не является create replay response: для этого non-replayable command сохранённый resource не возвращается.

## Атомарный выпуск

`ReleaseWorkCards` выполняется одной `READ COMMITTED` transaction:

1. после session/CSRF, permission и schema checks canonicalize фактический path/body/type и проверить committed receipt;
2. lock доступную `production_batches` row `FOR UPDATE`; если initial receipt lookup мог не увидеть concurrent uncommitted winner, после ожидания lock повторно прочитать receipt до state/version classification;
3. проверить отсутствие созданных sets и точное состояние `CREATED`; новый `commandId` для уже выпущенной batch получает `BATCH_ALREADY_RELEASED`;
4. прочитать и валидировать только immutable `passport_snapshot`: непустые unique `operationPlanId`/`position`, `position ASC`, allowlisted scope, положительные norm/count;
5. проверить `expectedVersion`; mismatch доступной `CREATED` batch даёт `VERSION_CONFLICT` без раскрытия current version;
6. сгенерировать set/card UUID и полный plan в памяти; `operation_plan_key` равен lowercase canonical `operationPlanId`, sets/response IDs упорядочены по `position ASC`, card UUID не имеют предметного порядка;
7. вставить все sets версии `1`/`FIRST_ARTICLE_PENDING` и ровно `plannedCardCount` cards версии `1`/`RELEASED` bulk statements;
8. проверить inserted counts по каждому plan и total; canonical fixture обязан дать `112 + 112 + 26 = 250`;
9. условно обновить batch `CREATED → RELEASED`, `version = version + 1`, заполнить `released_at` и потребовать ровно одну returned row;
10. вставить receipt, один `ProductionBatchReleased`, по одному `WorkCardSetCreated` на set и по одному `WorkCardReleased` на card с одной парой `commandId`/`correlationId`;
11. проверить `changedAggregates == pendingEvents`: для fixture `1 batch + 3 sets + 250 cards = 254`;
12. commit до формирования `200` response и `ETag`.

Любая duplicate UUID, invalid snapshot, constraint, count, conditional update, receipt или event failure откатывает batch, все sets/cards, receipt и полный event set. Chunking может использовать несколько SQL statements внутри той же transaction, но не несколько commits.

### Точный release receipt

| Поле | Значение |
|---|---|
| `command_id` | UUID из `X-Command-Id` |
| `command_type` | `ReleaseWorkCards` |
| `request_hash` | SHA-256 exact canonical request с фактическим batch path по [[api-contracts]] |
| `correlation_id` | тот же server-generated UUID, что у всех release events и success `meta.correlationId` |
| `result_type` | `ProductionBatch` |
| `result_id` | path `batchId`, изменённая `production_batches.id`, batch event aggregate ID и success `data.batchId` |
| `result_summary` | точный JSON object ниже |

```json
{
  "batchId": "00000000-0000-0000-0000-000000000000",
  "lifecycleStatus": "RELEASED",
  "version": 2,
  "setCount": 3,
  "cardCountTotal": 250,
  "workCardSetIds": [
    "22000000-0000-4000-8000-000000000001",
    "22000000-0000-4000-8000-000000000002",
    "22000000-0000-4000-8000-000000000003"
  ]
}
```

Receipt не является replay response: release non-replayable, поэтому matching повтор получает `COMMAND_ALREADY_PROCESSED`. `result_summary.workCardSetIds` логически равен `ProductionBatchReleased.data.workCardSetIds`, а counts равны committed state/events.

### Release races

- два concurrent requests с одним `commandId` и одинаковым canonical request дают один commit; loser после lock/race reread получает `COMMAND_ALREADY_PROCESSED`;
- один `commandId` с отличающимся batch path/body/type даёт один commit и `COMMAND_ID_REUSED` у loser;
- разные `commandId` для одной `CREATED` batch дают один release; loser после batch lock получает `BATCH_ALREADY_RELEASED` и не сохраняет receipt;
- unique receipt race на разных targets полностью откатывает локальные state/events, затем committed winner классифицируется по type/path/digest;
- deadlock/serialization failure даёт `CONCURRENT_MODIFICATION`; скрытого database или business retry нет.

Существующая schema уже содержит lifecycle/version/released timestamp batch, set/card snapshots и guards, receipts, audit FK/indexes и необходимые runtime grants. `operation_plan_key text` хранит canonical UUID string без изменения persisted shape; Gate 2.2 не создаёт migration.

## Атомарное массовое назначение

- request должен содержать `1..500` distinct WorkCard одного set;
- set блокируется первым и сверяется по `expectedSetVersion`;
- cards загружаются `FOR UPDATE` в отсортированном порядке;
- число загруженных rows обязано совпасть с request;
- все card versions/states и assignee role валидируются до первого update;
- updates и одно событие на каждую изменённую card записываются в той же transaction;
- first-article assignment дополнительно меняет set и пишет `FirstArticleWorkCardSelected`;
- частичное назначение невозможно.

## First-article acceptance

Set и зарегистрированная WorkCard блокируются в canonical order. Service проверяет оба expected versions, принадлежность card к set, purpose/state и pending gate. Card `COMPLETED → CLOSED`, set `FIRST_ARTICLE_PENDING → SERIAL_ALLOWED`, обе versions и два events commit вместе.

## Final batch acceptance

Это единственная команда, которой нужен consistent completion predicate по большому набору неизменяемых после завершения данных.

1. открыть `SERIALIZABLE` transaction;
2. lock batch `FOR UPDATE`, проверить trusted role, `RELEASED`, expected version и отсутствие acceptance;
3. одним aggregate query получить для каждого обязательного set: gate, `planned_card_count`, actual count и closed count;
4. отклонить, если set отсутствует, gate pending, counts расходятся или `closed_count != planned_card_count`;
5. вставить `final_batch_acceptances` с unique `batch_id`/`command_id`;
6. условно обновить batch `RELEASED → FINAL_ACCEPTED`, version `+1`;
7. вставить receipt и `FinalBatchAccepted` с результирующей version;
8. commit.

Reverse transitions, добавление карточек после release и изменение plan отсутствуют, но `SERIALIZABLE` фиксирует доказуемо согласованный snapshot и защищает будущую реализацию от accidental write path. Serialization failure/deadlock map to `409 CONCURRENT_MODIFICATION`; command не повторяется скрытно.

Unique `final_batch_acceptances(batch_id)` остаётся последней защитой от concurrent double acceptance. Replay того же `commandId` сначала сверяет committed receipt и возвращает исходный result; новый command видит terminal state/unique record и отклоняется.

## Concurrent payroll export

Первый export выполняет:

```sql
INSERT INTO payroll_records (...)
SELECT ... FROM work_cards
WHERE id = $work_card_id
  AND version = $expected_version
  AND status = 'CLOSED'
ON CONFLICT (work_card_id) DO NOTHING
RETURNING *;
```

- если row создана, та же transaction создаёт receipt и `WorkCardExportedToPayroll`;
- если unique conflict вернул ноль rows, service читает committed existing record; для нового разрешённого `commandId` transaction сохраняет новый receipt с новым server-generated `correlationId` и возвращает record без event;
- в no-op transaction допустимо и обязательно `changedAggregates = pendingEvents = ∅`; correlation query по новому receipt возвращает `totalCount: 0`, `complete: true`;
- точный replay того же `commandId` возвращает исходный receipt/correlation, а reuse этого ID с другим canonical path/body/type даёт `409 COMMAND_ID_REUSED`;
- beneficiary/norm берутся сервером из WorkCard, не из request;
- WorkCard version не увеличивается, потому что lifecycle state не меняется;
- два concurrent first exports дают одну payroll row и одно событие; обе successful команды с разными `commandId` имеют receipts, а проигравшая insert-race — пустой event set.

## Command receipts

Canonical request hash включает только `body`, `commandType` и `targetPath` по точной serialization/UTF-8/SHA-256 procedure из [[api-contracts]]; headers, session identity, `Origin` и CSRF исключены. Глобальный unique `command_id` предотвращает повторное выполнение после неопределённого network result.

- receipt вставляется только внутри successful transaction;
- duplicate ID с другим hash/type всегда `409 COMMAND_ID_REUSED`;
- для `CreateProductionBatch` duplicate ID с теми же type/path/digest всегда `409 COMMAND_ALREADY_PROCESSED`; сохранённый resource не возвращается;
- для `ReleaseWorkCards` duplicate ID с теми же type/path/digest также всегда `409 COMMAND_ALREADY_PROCESSED`; release result не replayed;
- после session/CSRF, текущей permission и schema/hash receipt lookup выполняется до загрузки текущего state/version; иначе replay терминальной final acceptance был бы ошибочно отклонён;
- non-replayable command с тем же receipt не выполняется повторно;
- special replay для final acceptance возвращает сохранённый resource;
- payroll имеет дополнительную business idempotency по `workCardId`.
- новый successful payroll no-op не является replay receipt: он сохраняет отдельные `commandId`/`correlationId` и ссылку на существующий result;

Receipt insert race обрабатывается без частичного результата: transaction, проигравшая unique `command_id` race, полностью откатывается вместе со своими state/event inserts; после rollback service повторно читает committed winning receipt и выполняет то же сравнение command type, фактического target path и digest. Совпадение для create/release даёт `COMMAND_ALREADY_PROCESSED`, любое различие — `COMMAND_ID_REUSED`. Release дополнительно перечитывает receipt после ожидания batch lock, чтобы concurrent matching request не был ошибочно классифицирован как новый повторный выпуск. SHA-256 collision не рассматривается как отдельный штатный outcome.

## Audit/version invariant

Перед commit application формирует один event для каждой изменённой aggregate version. Все pending events обязаны иметь `commandId`/`correlationId` текущего command context. DB unique `(aggregate_type, aggregate_id, aggregate_version)` и composite FK `(command_id, correlation_id)` на receipt отклоняют дублирование и чужую correlation, а integration tests внедряют failure между state/event writes и доказывают rollback.

SQL constraints не могут самостоятельно доказать «каждая changed row имеет event», поэтому обязательны:

- единый transaction API, не выдающий repositories вне command unit of work;
- application assertion `changedAggregates == pendingEvents` и единая пара command/correlation у всего набора; для разрешённого payroll no-op обе стороны равны пустому множеству `∅`, а receipt всё равно хранит пару command/correlation;
- integration tests `AC-TXN-001` и `AC-AUD-004` для каждой command family.

## Conflict response

API возвращает `409` с безопасным code и перечнем resource types/IDs, которые клиент уже знает. Current protected values в error не возвращаются. SPA invalidates все затронутые queries, показывает актуальное state и требует нового подтверждения/нового `commandId`.

## Обязательные проверки

- stale version любой цели отклоняет весь command;
- release одной batch создаёт полный set/card result, receipt и ровно один event на каждую из `1 + setCount + cardCountTotal` resulting versions;
- canonical fixture release создаёт `3` sets, `250` cards и `254` events одного correlation;
- batch/set/card version увеличивается только при фактическом изменении;
- serial assignment не увеличивает set version;
- final acceptance не изменяет WorkCard/WorkCardSet versions;
- payroll export не изменяет WorkCard version;
- новый разрешённый payroll `commandId` при существующей row сохраняет receipt/correlation без domain event, а его reuse с другим path/body отклоняется;
- deadlock/serialization/constraint failure не оставляет state, receipt или audit subset;
- concurrent final acceptance и payroll export сохраняют ровно один immutable result.
