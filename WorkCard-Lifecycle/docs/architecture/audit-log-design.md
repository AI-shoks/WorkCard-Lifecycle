---
artifact_id: architecture.audit-log
status: accepted
version: 1
owner: architecture
updated: 2026-07-18
---

# Audit Log Design

Append-only журнал успешных business commands MVP v1. Он обеспечивает доказуемую историю и correlation, но не является event sourcing или техническим application log. Решение принято в [[0004-transactional-audit-and-correlation-query]].

## Цели

- один неизменяемый success event для каждой изменённой aggregate version;
- атомарность current state и полного event set;
- история WorkCard и связанных batch/set contexts;
- полный server-side набор массовой операции по `correlationId`;
- actor/role/command/version provenance для `ADMIN_AUDITOR`;
- отсутствие success events у отказов.

## Не входит

- восстановление current state через replay;
- хранение HTTP bodies, cookies, CSRF, secrets или stack traces;
- запись неуспеха как domain success event;
- редактирование/удаление истории через application API;
- внешний SIEM, data warehouse или реальная интеграционная шина.

Технические request/error logs имеют отдельный operational purpose и не доказывают business outcome.

## Event envelope

```json
{
  "eventId": "uuid",
  "eventType": "WorkCardAssigned",
  "occurredAt": "2026-07-18T10:00:00.000Z",
  "aggregateType": "WorkCard",
  "aggregateId": "uuid",
  "aggregateVersion": 2,
  "actorId": "uuid",
  "actorRole": "MASTER",
  "commandId": "uuid",
  "correlationId": "uuid",
  "data": {}
}
```

| Поле | Правило |
|---|---|
| `eventId` | UUID, глобально unique, генерируется приложением |
| `eventType` | allowlist из [[commands-events]] |
| `occurredAt` | server UTC в пределах transaction; не client time |
| `aggregateType` | `ProductionBatch`, `WorkCardSet`, `WorkCard`, `PayrollRecord` |
| `aggregateId` | ID изменённого/созданного aggregate record |
| `aggregateVersion` | version **после** изменения; immutable record создаётся как version `1` |
| `actorId`, `actorRole` | trusted session snapshot на момент команды |
| `commandId` | client-provided UUID, подтверждённый successful receipt |
| `correlationId` | server-generated UUID, общий для всех events одной command transaction |
| `data` | allowlisted typed business facts после изменения |

`FinalBatchAcceptance` не получает отдельное второе событие: изменение aggregate `ProductionBatch` представлено `FinalBatchAccepted`; acceptance ID входит в typed data. Первый payroll export представлен изменением immutable aggregate `PayrollRecord` версии `1`.

## Typed data

Минимальные payloads определены в [[commands-events]]. Дополнительные правила:

- snapshot data хранится только когда нужна независимая audit-интерпретация;
- full passport/card rows не копируются без необходимости;
- display names могут храниться как snapshots, но permission logic не читает их из event;
- `sequenceNumber`, номер детали, physical signature, money и actual time отсутствуют;
- event schema version добавляется внутрь `data` только при несовместимом изменении payload; event type задним числом не переписывается.

## Формирование и commit

1. application service применяет domain command в unit of work;
2. каждый changed aggregate регистрирует pending event с resulting version;
3. transaction assertion сравнивает set changed aggregates и pending events и проверяет одну пару `commandId`/`correlationId` для всего набора;
4. сохраняются current rows, command receipt и `audit_events`;
5. DB uniqueness и composite FK event `(commandId, correlationId)` → receipt проверяются до commit;
6. API отвечает только после commit.

Ошибка на любом шаге откатывает полный набор. Failed validation, permission, state, gate, version, serialization или database command не создаёт success event.

## Неизменяемость

- application DB role имеет `SELECT`, `INSERT`, но не `UPDATE`/`DELETE` на `audit_events`;
- trigger отклоняет update/delete как defense in depth;
- публичных modify endpoints нет;
- migrations выполняются отдельной ролью и не используются runtime;
- retention MVP — срок жизни demo deployment; автоматическая purge/archive не выполняется.

Изменение retention, privacy deletion или внешнее архивирование потребует нового решения, потому что может конфликтовать с append-only guarantee.

## История агрегата

Canonical order: `aggregateVersion ASC`, затем `occurredAt ASC`, `eventId ASC`. Unique `(aggregateType, aggregateId, aggregateVersion)` запрещает две success-семантики одной resulting version для текущего command catalog.

`GET /audit/work-cards/{workCardId}/context` возвращает отдельные streams:

- WorkCard по её aggregate version;
- родительский WorkCardSet по его version;
- ProductionBatch по его version;
- связанные correlations, в которых участвовала WorkCard.

Streams не сливаются в ложную общую version sequence. Role — только `ADMIN_AUDITOR`.

## Correlation массовой операции

Принят отдельный `GET /api/v1/audit/operations/{correlationId}/events`. Backend выполняет прямой indexed query, а не собирает результат из N card histories.

- release: один batch event, по одному событию на каждый из трёх sets и `250` cards — `254` events одного correlation;
- first-article assignment: set selection + card assignment;
- serial assignment: одно card event на каждую выбранную WorkCard;
- first-article acceptance: card quality + set gate events;
- single-aggregate command: correlation всё равно присутствует и содержит один event.

Ответ включает `totalCount`, stable cursor, `nextCursor` и `complete`. Отсутствие части набора не маскируется клиентским merge. После commit в correlation не добавляются события, поэтому pagination стабильна.

## Command и correlation semantics

- `commandId` отвечает «какой request был принят»;
- `correlationId` отвечает «какие aggregate facts составили его atomic result»;
- одна command transaction имеет один correlation;
- разные commands, даже вызванные одной UI-последовательностью, имеют разные correlations;
- replay не создаёт новый correlation/event set;
- causation chain между разными commands не вводится в MVP.

## Защита данных

- audit endpoints закрыты для всех ролей кроме `ADMIN_AUDITOR`;
- authorization выполняется до поиска correlation/aggregate;
- payload schemas используют allowlist, а не serialization целых objects;
- cookies, CSRF, request headers, SQL и exception stack не записываются;
- operational logs используют opaque trace ID и могут ссылаться на command/correlation ID без копии event data.

## Индексы и объём

Обязательные indexes описаны в [[er-model]]. Для canonical fixture объём мал: release создаёт `254` events, остальные commands — один или несколько. Partitioning, cold storage и search engine не нужны до измеренного роста.

## Проверки

- каждая successful command family создаёт ожидаемый event set;
- event resulting version совпадает с current aggregate version;
- failure injection между state/receipt/event writes оставляет ноль изменений;
- duplicate event ID/version откатывает transaction;
- event с `commandId` одного receipt и чужим `correlationId` отклоняется composite FK;
- update/delete runtime role отклоняется;
- correlation query release возвращает ровно `254` events и `complete = true`;
- роли кроме `ADMIN_AUDITOR` получают безопасный `403` без проверки существования ID;
- `ConfirmWorkCardQuality` не создаёт `FinalBatchAccepted`;
- final acceptance replay не создаёт второе событие.
