---
artifact_id: architecture.transactions-concurrency
status: accepted
version: 1
owner: architecture
updated: 2026-07-18
---

# Transactions and Concurrency

Транзакционные границы, lock order и optimistic concurrency MVP v1. Решение реализует `BR-002`, `BR-051`, `BR-060`–`BR-062` и принято в [[0003-concurrency-and-transactions]].

## Базовая модель

- PostgreSQL — единственный transaction coordinator;
- application service открывает transaction на одну business command;
- current-state rows, immutable result, command receipt и все success events commit/rollback совместно;
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
| first `ExportWorkCardToPayroll` | `READ COMMITTED`; lock/read card; `INSERT ... ON CONFLICT DO NOTHING` | WorkCard read version | WorkCard не меняется; PayrollRecord immutable |

## Атомарный выпуск

1. lock batch и проверить `CREATED`/expected version;
2. прочитать immutable `passport_snapshot`;
3. построить полный deterministic plan sets/cards в памяти с UUID;
4. вставить все sets и cards bulk statements;
5. проверить inserted counts по каждому plan и total; canonical fixture обязан дать `112 + 112 + 26 = 250`;
6. обновить batch `CREATED → RELEASED`, version `+1`;
7. вставить receipt и события batch/set/card с одним `correlationId`;
8. commit.

Любая duplicate UUID, constraint, count или event failure откатывает всё. Chunking может использовать несколько SQL statements внутри той же transaction, но не несколько commits.

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
- если unique conflict вернул ноль rows, service читает committed existing record и возвращает его без event;
- beneficiary/norm берутся сервером из WorkCard, не из request;
- WorkCard version не увеличивается, потому что lifecycle state не меняется;
- два concurrent first exports дают одну payroll row и одно событие.

## Command receipts

Canonical request hash включает command type, path target и нормализованный body, но не session cookie/CSRF. Глобальный unique `command_id` предотвращает повторное выполнение после неопределённого network result.

- receipt вставляется только внутри successful transaction;
- duplicate ID с другим hash/type всегда `409 COMMAND_ID_REUSED`;
- после session/CSRF, текущей permission и schema/hash receipt lookup выполняется до загрузки текущего state/version; иначе replay терминальной final acceptance был бы ошибочно отклонён;
- non-replayable command с тем же receipt не выполняется повторно;
- special replay для final acceptance возвращает сохранённый resource;
- payroll имеет дополнительную business idempotency по `workCardId`.

## Audit/version invariant

Перед commit application формирует один event для каждой изменённой aggregate version. Все pending events обязаны иметь `commandId`/`correlationId` текущего command context. DB unique `(aggregate_type, aggregate_id, aggregate_version)` и composite FK `(command_id, correlation_id)` на receipt отклоняют дублирование и чужую correlation, а integration tests внедряют failure между state/event writes и доказывают rollback.

SQL constraints не могут самостоятельно доказать «каждая changed row имеет event», поэтому обязательны:

- единый transaction API, не выдающий repositories вне command unit of work;
- application assertion `changedAggregates == pendingEvents` и единая пара command/correlation у всего набора;
- integration tests `AC-TXN-001` и `AC-AUD-004` для каждой command family.

## Conflict response

API возвращает `409` с безопасным code и перечнем resource types/IDs, которые клиент уже знает. Current protected values в error не возвращаются. SPA invalidates все затронутые queries, показывает актуальное state и требует нового подтверждения/нового `commandId`.

## Обязательные проверки

- stale version любой цели отклоняет весь command;
- batch/set/card version увеличивается только при фактическом изменении;
- serial assignment не увеличивает set version;
- final acceptance не изменяет WorkCard/WorkCardSet versions;
- payroll export не изменяет WorkCard version;
- deadlock/serialization/constraint failure не оставляет state, receipt или audit subset;
- concurrent final acceptance и payroll export сохраняют ровно один immutable result.
