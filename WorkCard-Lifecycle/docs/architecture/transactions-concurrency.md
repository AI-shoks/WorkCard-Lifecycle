---
artifact_id: architecture.transactions-concurrency
status: accepted
version: 2
owner: architecture
updated: 2026-09-02
---

# Transactions and Concurrency

Стратегия обеспечивает `BR-002`, `BR-003`, `BR-050`–`BR-062`: stale writes не перезаписываются, массовые команды не оставляют частичный результат, а audit согласован с предметным состоянием.

## Базовое решение

- PostgreSQL isolation level по умолчанию — `READ COMMITTED`.
- Конкурентно значимые rows блокируются `SELECT ... FOR UPDATE` в детерминированном порядке.
- Клиент передаёт `expectedVersion` каждого существующего изменяемого aggregate root.
- После lock API сравнивает actual/expected versions; любое несовпадение отклоняет всю команду.
- Update использует дополнительный predicate `WHERE id = $id AND version = $expected`, устанавливает `version = version + 1` и обязан вернуть ровно одну row.
- Предметные изменения, immutable result, command receipt и все audit events выполняются одной DB transaction.

`READ COMMITTED` выбран вместо глобального `SERIALIZABLE`: membership после выпуска неизменяем, а явные row locks дают понятную область конкуренции и диагностируемые conflicts без лишних serialization failures.

## Единый command executor

Порядок каждой mutation:

1. Проверить trusted session, route permission, mutation Origin/CSRF и затем JSON schema вне транзакции.
2. Начать transaction и вставить `command_receipt(state = IN_PROGRESS)` с уникальным `commandId`.
3. Если insert проиграл unique race, дождаться winner transaction и прочитать receipt:
   - тот же type/actor и `SUCCEEDED` → вернуть сохранённый result как replay;
   - другой type/actor → `COMMAND_ID_REUSED`;
   - отсутствие row после rollback winner → повторить insert один раз в той же новой transaction.
4. Заблокировать aggregate rows в каноническом порядке.
5. Проверить существование разрешённых caller ресурсов, state, purpose, gate, resource-dependent business input и все versions.
6. Применить changes; каждый изменённый root увеличивает version ровно на один.
7. Вставить по одному audit event на resulting aggregate version.
8. Завершить receipt: result, HTTP status, `event_count`, `correlation_id`, `SUCCEEDED`.
9. Commit; только после commit вернуть success.

Любое исключение до commit вызывает rollback, поэтому failed command не оставляет receipt `IN_PROGRESS`, предметные rows или success events.

## Глобальный lock order

Чтобы не создавать циклы ожидания:

1. `production_batches` по UUID;
2. `work_card_sets` по UUID ascending;
3. `work_cards` по UUID ascending;
4. immutable result/business-key row (`final_batch_acceptances`, `payroll_records`);
5. события и receipt update.

Команда, которой не нужен верхний уровень, начинает с первого нужного уровня, но никогда не берёт более высокий уровень после нижнего. Card lifecycle, которому нужен gate, блокирует set до card. Порядок ID из request всегда сортируется сервером.

## Транзакционные сценарии

### `CreateProductionBatch`

- reference passport/operation plans читаются согласованно в transaction;
- создаются batch v1 и полный набор operation-plan snapshots;
- создаются receipt и `ProductionBatchCreated` v1;
- reference rows не блокируются от административной seed migration; deployment migration не выполняется параллельно runtime traffic.

### `ReleaseWorkCards`

1. Lock batch, проверить `CREATED` и expected version.
2. Прочитать immutable snapshot plans, проверить непустоту/положительные значения.
3. Создать все sets v1 и все cards v1.
4. Update batch `CREATED → RELEASED`, version `+1`.
5. Вставить batch event, события sets и cards с общим correlation.

Fixture обязан дать `3` sets, `250` cards и `254` events. Любая ошибка UUID/constraint/event insert откатывает всё.

### `AssignWorkCards`

1. Lock set.
2. Нормализовать и отсортировать distinct card IDs; lock все rows одним query.
3. Убедиться, что число найденных rows равно числу requested, все относятся к set и versions совпадают.
4. Проверить active assignee с trusted role `WORKER`, gate, purpose и состояние всех cards.
5. Для `FIRST_ARTICLE` update set (`firstArticleWorkCardId`, version +1) и одну card; для `SERIAL` set только проверяется и не меняет version.
6. Обновить все cards; количество updated rows обязано совпасть с request.
7. Записать события изменённых roots.

Ни batch, ни незапрошенные cards не блокируются. Частичный assignment невозможен.

### `StartWorkCard`

Lock set, затем card. Gate читается под lock, но client не передаёт set version, поскольку set не является изменяемой целью команды. Card expected version проверяется; `ASSIGNED → IN_PROGRESS`, version `+1`.

### `CompleteWorkCard`

Lock card. Gate уже не меняет допустимость завершения начатой карточки; card `IN_PROGRESS → COMPLETED`, version `+1`.

### `AcceptFirstArticle`

Lock set, затем зарегистрированную card. Проверить обе versions, purpose, identity и state. Одновременно:

- card `COMPLETED → CLOSED`, version `+1`;
- set `FIRST_ARTICLE_PENDING → SERIAL_ALLOWED`, acceptance fields и version `+1`;
- два audit events одного correlation.

### `ConfirmWorkCardQuality`

Lock set, затем serial card. Gate проверяется под lock без client set version; set не меняется. Card expected version проверяется; `COMPLETED → CLOSED`, version `+1`; final batch acceptance не создаётся.

### `RecordFinalBatchAcceptance`

1. Lock batch и проверить `RELEASED`, expected batch version, отсутствие acceptance.
2. Lock все обязательные sets по UUID.
3. Lock все cards партии по UUID.
4. На заблокированном наборе проверить для каждого set:
   - gate `SERIAL_ALLOWED`;
   - actual count равен `planned_card_count`;
   - нет card со status, отличным от `CLOSED`;
   - total counts совпадают с snapshot plan.
5. Вставить уникальную immutable acceptance.
6. Update batch `RELEASED → FINAL_ACCEPTED`, link acceptance, version `+1`.
7. Вставить `FinalBatchAccepted` и завершить receipt.

Card/set versions не передаются этой командой и не изменяются: полнота проверяется server-side под locks. Concurrent card closure либо коммитится до получения её lock и учитывается, либо ждёт завершения final transaction; принять незавершённый набор невозможно.

### `ExportWorkCardToPayroll`

Lock card, проверить expected version, `CLOSED` и assignee. Затем insert `payroll_records` по unique `work_card_id`:

- новая row → record + event + receipt;
- уже существует → вернуть существующую запись без изменения card, новой версии или event;
- concurrent inserts сериализует unique index; loser перечитывает winner row.

## Version semantics

| Aggregate | v1 | Когда увеличивается |
|---|---|---|
| `ProductionBatch` | создание | release, final acceptance |
| `WorkCardSet` | release | first-article registration, first-article acceptance |
| `WorkCard` | release | assignment, start, complete, quality/first-article close |
| `PayrollRecord` | immutable v1 (version в audit envelope) | никогда |

Чтение возвращает numeric `version`. Клиент не вычисляет следующую версию и не считает HTTP timeout доказательством failure/success.

## Conflict response и восстановление

- Version mismatch → `409 VERSION_CONFLICT` с expected/actual только для ресурсов, которые caller вправе видеть.
- Invalid current state/gate → `409 STATE_CONFLICT`/`GATE_CLOSED`.
- Deadlock/serialization/connection failure → rollback и `503`; в MVP сервер не скрывает business conflict автоматическим повтором.
- UI очищает submitting state, выполняет GET актуальной projection и просит пользователя повторно оценить действие.
- Тот же `commandId` используют только для проверки результата неопределённого transport outcome; новое осознанное решение получает новый ID.

## Read consistency

- Обычные GET используют statement-level consistency `READ COMMITTED` и возвращают versions.
- Batch detail counts строятся одним SQL statement/CTE, чтобы части projection относились к одному statement snapshot.
- Audit correlation query сверяет `audit_events` с `command_receipts.event_count`.
- Read-after-write выполняется на primary connection; read replicas не вводятся в MVP.

## Обязательные integration tests

1. Два assignment с одной version: ровно один success, второй conflict, без partial rows.
2. Повтор одинакового `commandId` возвращает один result и один event set.
3. Release failure на середине factory не оставляет batch status/sets/cards/events.
4. First-article acceptance атомарно меняет set и card или не меняет ничего.
5. Concurrent last-card closure и final acceptance никогда не создают premature acceptance.
6. Две final acceptance дают одну immutable row и одну batch version increment.
7. Два payroll export дают одну record и одно success event.
8. Runtime DB role не может update/delete audit/final/payroll rows.
