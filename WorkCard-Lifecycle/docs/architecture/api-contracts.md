---
artifact_id: architecture.api-contracts
status: accepted
version: 2
owner: architecture
updated: 2026-07-18
---

# API Contracts

HTTP-контракт MVP v1 для команд и запросов из [[commands-events]]. Каноническая machine-readable версия будет сгенерирована как OpenAPI `3.1` из route schemas на этапе реализации; этот документ фиксирует ресурсы, семантику и обязательные поля до кода.

## Общие правила

- base path: `/api/v1`;
- формат: JSON UTF-8; errors — `application/problem+json`;
- browser session — signed `HttpOnly` cookie, выданная backend по подготовленной demo identity;
- все business-command mutations требуют `X-CSRF-Token` и `X-Command-Id: <uuid>`; bootstrap GET выдаёт token, а session switch/logout требуют CSRF, но не являются business commands и не получают `commandId`/event;
- backend создаёт один `correlationId` на каждую новую successful command transaction, включая допустимый no-op повторного payroll export, и использует его во всех событиях этой транзакции, если события есть;
- client передаёт ожидаемые версии в command body; resource response содержит `version` и `ETag: "v{version}"`;
- UUID — технические идентификаторы. API не возвращает `sequenceNumber`, part number или позицию `n из N`;
- успешный read не создаёт receipt/event и не меняет version;
- даты — ISO 8601 UTC, количества — integer, `normHours` — decimal string, например `"1.25"`.

## Trusted demo session

| Метод и path | Доступ | Результат |
|---|---|---|
| `GET /demo-identities` | public demo shell | активные подготовленные identities: opaque ID, русское имя и display role |
| `GET /session/bootstrap` | public | выдаёт short-lived signed anonymous bootstrap cookie и связанный CSRF token; domain state отсутствует |
| `PUT /session/demo` | bootstrap или authenticated session + CSRF + trusted Origin | body `{ "demoIdentityId": uuid }`; backend сверяет allowlist, rotates bootstrap/current cookie и выдаёт authenticated signed session + новый CSRF token |
| `GET /session` | authenticated | trusted actor, role, permissions и новый CSRF token; без предметного изменения |
| `DELETE /session` | authenticated + CSRF | удаляет только session cookie |

Bootstrap cookie содержит случайный session nonce, expiry и CSRF binding, но не actor/role. `SameSite=Strict`, проверка `Origin`/`Sec-Fetch-Site` и совпадение token binding применяются уже к первому `PUT`. После выбора identity старые bootstrap/session token и cookie недействительны на клиенте.

Client не может передать произвольные `actorId` или role. Role switch — новый выбор prepared identity, а не business command; `commandId`, domain event и version для него отсутствуют.

## Read endpoints

| Метод и path | Роль | Основной ответ |
|---|---|---|
| `GET /production-passports` | demo-роли | active seed passports с operation-plan preview |
| `GET /production-passports/{passportId}` | demo-роли | паспорт и read-only operation plans |
| `GET /production-batches` | demo-роли | page партий с quantity, lifecycle, sets/card summary и final-acceptance flag |
| `GET /production-batches/{batchId}` | demo-роли | snapshot, sets, completion summary, version, optional acceptance read-back |
| `GET /production-batches/{batchId}/final-acceptance` | demo-роли, видящие партию | `200` immutable record или `404`, если отдельная запись ещё не создана |
| `GET /work-card-sets/{setId}` | demo-роли по read matrix | scope/norm snapshots, gate, counts, assignment summary и version |
| `GET /work-card-sets/{setId}/work-cards` | demo-роли по read matrix | filtered page карточек без sequence labels |
| `GET /work-cards/{workCardId}` | demo-роли по read matrix | state, purpose, assignee, snapshots, version и allowed-actions projection |
| `GET /work-cards/{workCardId}/payroll-record` | `ADMIN_AUDITOR` | immutable mock record или `404` |
| `GET /audit/work-cards/{workCardId}/context` | `ADMIN_AUDITOR` | card history и контекст связанных set/batch, раздельно упорядоченные по version/time |
| `GET /audit/operations/{correlationId}/events` | `ADMIN_AUDITOR` | server-side выборка полного набора событий одной команды |

Allowed-actions projection — подсказка UI, а не grant: backend заново проверяет permission/state/gate/version при команде.

### Списки и pagination

- `cursor` — opaque keyset cursor; `limit` default `50`, maximum `200` для обычных списков;
- batch filters: lifecycle status, passport, created range;
- card filters: status, purpose, assignee, operation scope;
- responses: `{ items, nextCursor, totalCount? }`; `totalCount` включается там, где требуется UX summary;
- sort имеет стабильный tie-breaker по UUID, но UI не представляет его как порядок деталей.

### Полный correlation query

`GET /audit/operations/{correlationId}/events?cursor=&limit=` выполняет фильтрацию **на сервере** по indexed `audit_events.correlation_id`. Ответ:

```json
{
  "correlationId": "00000000-0000-0000-0000-000000000000",
  "commandId": "00000000-0000-0000-0000-000000000000",
  "items": [],
  "returnedCount": 0,
  "totalCount": 0,
  "complete": true,
  "nextCursor": null
}
```

Order — `occurredAt`, затем `eventId`. Один committed `correlationId` больше не пополняется, поэтому keyset pages образуют стабильный полный набор. `complete = true` означает, что `returnedCount` текущего накопленного обхода достиг `totalCount`; canonical release (`1 batch + 3 sets + 250 cards`) должен читаться одним ответом при audit limit `500`. Это принятое решение для `UC-014`/`AC-AUD-003`; клиентское сопоставление отдельных историй не считается источником полноты.

Backend сначала проверяет роль `ADMIN_AUDITOR`, затем находит command receipt по `correlationId` и выбирает связанные events. Поэтому successful no-op повторного payroll export с новым `commandId` законно возвращает сохранённый в receipt `commandId`, `items: []`, `returnedCount: 0`, `totalCount: 0`, `complete: true` и `nextCursor: null`. Для роли без права audit одинаковый безопасный `403` формируется до поиска receipt/events, поэтому запрос не позволяет определить существование переданного `correlationId`.

## Command envelope

Каждый endpoint ниже получает trusted actor из session и `commandId` из `X-Command-Id`. Успешный ответ содержит:

```json
{
  "data": {},
  "meta": {
    "commandId": "00000000-0000-0000-0000-000000000000",
    "correlationId": "00000000-0000-0000-0000-000000000000",
    "replayed": false
  }
}
```

Новые ресурсы возвращают `201`; изменённые или уже существующие идемпотентные ресурсы — `200`; body отсутствует только там, где read-back не нужен. Commit должен завершиться до ответа. `correlationId` возвращается инициатору как opaque metadata успешной команды и сам по себе не даёт права на audit query.

## Commands партии

### `CreateProductionBatch`

`POST /production-batches`

```json
{
  "productionPassportId": "00000000-0000-0000-0000-000000000000",
  "quantity": 112
}
```

- роль: `PLANNER`;
- успех `201`: batch `CREATED`, version `1`, immutable passport snapshot;
- route не принимает operation plans или norm.

### `ReleaseWorkCards`

`POST /production-batches/{batchId}/actions/release-work-cards`

```json
{ "expectedVersion": 1 }
```

- роль: `PLANNER`;
- успех `200`: batch `RELEASED`, version `2`, set/card totals и ссылки на sets;
- для fixture: sets `112`, `112`, `26`, total `250`;
- весь выпуск, receipt и `254` audit events фиксируются атомарно.

### `RecordFinalBatchAcceptance`

`POST /production-batches/{batchId}/actions/record-final-acceptance`

```json
{ "expectedVersion": 2 }
```

- роль: `QUALITY_CONTROLLER`;
- completion predicate: все обязательные sets `SERIAL_ALLOWED`, count каждого равен plan, все необходимые WorkCard `CLOSED`, отдельная acceptance отсутствует;
- успех `201`: immutable acceptance + batch `FINAL_ACCEPTED`, новая version и `FinalBatchAccepted`;
- replay того же `commandId`/того же canonical request: `200`, тот же result, `replayed: true`, без новой version/event;
- новый command после успеха: `409 BATCH_FINAL_ACCEPTED`.

Ни этот request, ни read-back не содержат изображения/сертификата физической подписи.

## Assignment и lifecycle commands

### `AssignWorkCards`

`POST /work-card-sets/{setId}/actions/assign-work-cards`

```json
{
  "expectedSetVersion": 1,
  "assigneeId": "00000000-0000-0000-0000-000000000000",
  "purpose": "SERIAL",
  "cards": [
    {
      "workCardId": "00000000-0000-0000-0000-000000000000",
      "expectedVersion": 1
    }
  ]
}
```

- роль: `MASTER`;
- body содержит `1..500` distinct карточек одного set;
- `FIRST_ARTICLE` требует ровно одну карточку и pending gate; set version увеличивается;
- `SERIAL` требует `SERIAL_ALLOWED`; set version проверяется как gate precondition, но не увеличивается;
- успех `200`: refreshed set summary и representations изменённых cards;
- одна ошибка отклоняет весь набор.

### `StartWorkCard`

`POST /work-cards/{workCardId}/actions/start`

```json
{ "expectedVersion": 2 }
```

Только `MASTER`; успех `ASSIGNED → IN_PROGRESS`, новая version и `WorkCardStarted`.

### `CompleteWorkCard`

`POST /work-cards/{workCardId}/actions/complete`

```json
{ "expectedVersion": 3 }
```

Только `MASTER`; успех `IN_PROGRESS → COMPLETED`, новая version и `WorkCardCompleted`.

### `AcceptFirstArticle`

`POST /work-cards/{workCardId}/actions/accept-first-article`

```json
{
  "expectedWorkCardVersion": 4,
  "expectedSetVersion": 2
}
```

Только `QUALITY_CONTROLLER`; зарегистрированная first-article WorkCard `COMPLETED` + set `FIRST_ARTICLE_PENDING`. Успех атомарно закрывает card, открывает set gate, увеличивает обе versions и создаёт два события.

### `ConfirmWorkCardQuality`

`POST /work-cards/{workCardId}/actions/confirm-quality`

```json
{
  "expectedWorkCardVersion": 4,
  "expectedSetVersion": 3
}
```

Только `QUALITY_CONTROLLER`; serial WorkCard `COMPLETED` + `SERIAL_ALLOWED`. Set version используется как gate precondition и не меняется. Успех закрывает только WorkCard и **не** создаёт `FinalBatchAcceptance`.

## Mock payroll command

### `ExportWorkCardToPayroll`

`POST /work-cards/{workCardId}/actions/export-to-payroll`

```json
{ "expectedWorkCardVersion": 5 }
```

- роль: `ADMIN_AUDITOR`;
- карточка `CLOSED`, assignee существует, version актуальна;
- первый успех `201`: один `PayrollRecord` и `WorkCardExportedToPayroll`; WorkCard state/version не меняются;
- точный повтор того же canonical request с тем же `commandId`: `200`, та же запись и исходные receipt/`correlationId`, `replayed: true`, без нового event;
- если `PayrollRecord` уже существует, новая разрешённая команда с новым `commandId` возвращает `200` и ту же запись, но сохраняет новый command receipt с новым server-generated `correlationId`; `replayed: false`, domain event отсутствует;
- для этого no-op transaction `changedAggregates = pendingEvents = ∅`, а audit query нового `correlationId` возвращает `totalCount: 0`, `complete: true`;
- повторное использование этого нового `commandId` с другим canonical path/body/type возвращает `409 COMMAND_ID_REUSED`;
- concurrent first exports сходятся к одной row/одному event за счёт unique business key; каждая успешно завершившаяся команда с отдельным `commandId` всё равно получает собственный receipt/correlation.

## Error contract

```json
{
  "type": "https://workcard.example/problems/version-conflict",
  "title": "Данные изменились",
  "status": 409,
  "code": "VERSION_CONFLICT",
  "detail": "Обновите данные и проверьте действие ещё раз.",
  "traceId": "opaque-id",
  "errors": []
}
```

| HTTP | Категория | Примеры |
|---:|---|---|
| `400` | malformed request/schema | неверный JSON, unknown enum, duplicate card ID |
| `401` | session отсутствует/недействительна | без раскрытия ресурса |
| `403` | trusted role не имеет права | проверяется до resource lookup |
| `404` | доступная роли цель отсутствует | passport/batch/set/card/record |
| `409` | version, state, gate, terminal, idempotency или uniqueness conflict | `VERSION_CONFLICT`, `SERIAL_GATE_CLOSED`, `BATCH_FINAL_ACCEPTED`, `COMMAND_ID_REUSED` |
| `422` | семантически неверные данные | неположительное quantity, неактивный паспорт, assignee не `WORKER` |
| `500` | unexpected failure | transaction rolled back; безопасное общее сообщение |

`errors` содержит field paths только для безопасной input validation. Protected existence, SQL details, stack traces, cookie/CSRF values и event data не раскрываются.

## Порядок обработки

1. проверить session и CSRF;
2. проверить role на command/read class;
3. проверить schema;
4. canonicalize type/path/body и найти receipt по `commandId`; другой type/path/hash отклонить, а разрешённый точный replay вернуть **до** текущих target state/version checks;
5. если receipt отсутствует, загрузить доступные targets;
6. проверить semantic input, purpose, state, gate и invariants;
7. проверить expected versions;
8. сохранить state, receipt и audit в одной транзакции;
9. вернуть authoritative read-back.

Receipt lookup не обходит текущую authorization: replay result выдаётся только роли, которая сейчас имеет право на command class. Для `RecordFinalBatchAcceptance` точный replay старого body с прежней `expectedVersion` возвращает исходную acceptance до проверки уже терминального batch; новый `commandId` проходит обычный flow и получает `BATCH_FINAL_ACCEPTED`.

Одинаковый безопасный postcondition действует для `400`–`500`: неуспех не оставляет предметного состояния или success event.

## Replay и retry

| Ситуация | Поведение клиента/API |
|---|---|
| network timeout с неизвестным исходом | клиент может повторить тот же request с тем же `X-Command-Id`; API сверяет receipt |
| тот же ID + другой canonical path/body/type | `409 COMMAND_ID_REUSED` |
| завершённая команда без специальной replay-семантики с тем же ID | не выполняется повторно; возвращается безопасный `409 COMMAND_ALREADY_PROCESSED` |
| final acceptance, тот же ID/body | исходный success result, `replayed: true` |
| payroll, тот же ID/path/body | исходный success result и correlation, `replayed: true`, без нового receipt/event |
| payroll, row уже существует, новый command ID | существующий result; новый receipt и новый correlation, `replayed: false`, без event; correlation query возвращает `totalCount: 0`, `complete: true` |
| version conflict | никакого автоматического replay; refresh и новое осознанное подтверждение с новым command ID |

## OpenAPI gate

На этапе реализации CI должен проверять:

- route schema присутствует у каждого endpoint;
- generated OpenAPI не содержит undocumented command;
- frontend client генерируется из committed OpenAPI без diff;
- каждый command имеет positive, permission, validation/state и version-contract tests по [[requirements-traceability]];
- endpoints отрицательной приёмки, rework, reassignment, repeat release и real payroll отсутствуют.
