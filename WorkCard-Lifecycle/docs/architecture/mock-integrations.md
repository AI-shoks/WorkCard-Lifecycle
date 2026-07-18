---
artifact_id: architecture.mock-integrations
status: accepted
version: 2
owner: architecture
updated: 2026-07-18
---

# Mock Integrations

Архитектура синтетических external boundaries MVP v1. Единственное изменяющее mock-направление — payroll export; подготовленные паспорта, norms и demo identities являются read-only seed data.

## Принцип

MVP не имитирует надёжность сетевой интеграции декоративным HTTP-сервисом. `PayrollExportPort` имеет локальный PostgreSQL adapter, участвующий в той же transaction, что и command receipt/audit. Это даёт доказуемую атомарность и идемпотентность в границах заявленного mock.

Решение принято в [[0005-command-replay-and-mock-payroll]]. Реальная payroll/ERP не вызывается, hostname/credentials/queue отсутствуют.

## Payroll port

Conceptual application interface:

```text
exportClosedWorkCard(
  workCardId,
  expectedWorkCardVersion,
  trustedActor,
  commandContext,
  transaction
) -> { payrollRecord, created }
```

Input request не содержит beneficiary или norm. Adapter читает их из server-side closed WorkCard snapshot.

## Preconditions

- trusted role — `ADMIN_AUDITOR`;
- WorkCard существует, `status = CLOSED`, assignee задан;
- `expectedWorkCardVersion` актуальна;
- assignee ссылается на подготовленного `WORKER`;
- `normHoursSnapshot > 0`;
- mutation/delete WorkCard не выполняются.

## Результат

`PayrollRecord` содержит:

- opaque `payrollRecordId`;
- unique `workCardId`;
- `beneficiaryId = WorkCard.assigneeId`;
- `normHoursSnapshot = WorkCard.normHoursSnapshot`;
- `exportedAt` server UTC.

Money, currency, tax, coefficient, actual time, payment status и external employee identifier отсутствуют.

## Первый export

1. API проверяет session/permission/schema.
2. Transaction читает/блокирует WorkCard и проверяет version/state.
3. `INSERT ... ON CONFLICT (work_card_id) DO NOTHING RETURNING` пытается создать record.
4. При успехе transaction добавляет command receipt и `WorkCardExportedToPayroll` aggregate `PayrollRecord`, version `1`.
5. Commit возвращает `201`, `created: true`.

## Replay и конкурентность

| Сценарий | Результат |
|---|---|
| тот же `commandId`, тот же canonical request | существующий record и исходные receipt/`correlationId`, `replayed: true`, без нового event |
| новый разрешённый `commandId`, тот же `workCardId` | существующий record; новый receipt и новый server-generated `correlationId`, `replayed: false`, без event |
| два concurrent first exports | unique key создаёт одну row/одно event; второй читает winner и при отдельном `commandId` сохраняет собственный receipt/correlation с пустым event set |
| тот же `commandId`, другой canonical path/body/type | `409 COMMAND_ID_REUSED` |
| stale WorkCard version до первого export | `409 VERSION_CONFLICT`, row/event отсутствуют |
| WorkCard не `CLOSED`/без assignee | `409`/`422`, row/event отсутствуют |
| failure записи event/receipt при первом export | payroll insert откатывается |
| failure записи receipt для no-op | новый command result не фиксируется; существующая `PayrollRecord` не меняется |

Для successful no-op с новым `commandId` transaction сохраняет только receipt, ссылающийся на существующую `PayrollRecord`; `changedAggregates = pendingEvents = ∅`. Correlation query для нового `correlationId` законно возвращает `totalCount: 0`, `complete: true`. Повторный результат не означает новое начисление и не создаёт техническую «попытку успеха» в audit.

## Failure model

Локальный adapter может завершиться только validation/domain/database outcome. Network timeout, external partial acceptance, callback и reconciliation job отсутствуют, потому что внешнего соединения нет.

Integration tests должны иметь failure injection до insert, между record и event, и перед commit. Во всех случаях observability показывает либо полный first success, либо отсутствие результата.

## Read-only seed boundaries

### Production passports and operation plans

- загружаются versioned seed migration;
- `PLANNER` выбирает active passport, но не меняет его состав;
- при создании batch сохраняется immutable snapshot;
- изменение seed для будущих batches не изменяет уже созданные snapshots;
- источник честно обозначается как synthetic, а не factory integration.

### Demo identities

- allowlisted identities/roles загружаются seed;
- role switch выбирает только active identity;
- identity не является HR/account integration;
- session change не создаёт business event и не меняет domain state.

## Замена реальной интеграцией

Реальный adapter потребует изменения [[mvp-scope]] и нового ADR. Нельзя просто заменить локальный insert сетевым вызовом внутри DB transaction: потребуется outbox/delivery state, authentication, retry/reconciliation, privacy и новая semantics «один business result». До такого решения интерфейс остаётся local mock.

## Проверки

- canonical closed WorkCard создаёт одну record с точными assignee/norm snapshots;
- повтор и concurrent first export дают ту же row и одно event; каждый новый successful `commandId` получает receipt/correlation, а no-op correlation имеет ноль events;
- reuse no-op `commandId` с другим path/body даёт `409 COMMAND_ID_REUSED`;
- non-closed/missing assignee/wrong role/stale version не дают side effects;
- real network access отсутствует;
- seed passport snapshot не меняется после создания batch;
- UI и API не называют result зарплатой, выплатой или реальной интеграцией.
