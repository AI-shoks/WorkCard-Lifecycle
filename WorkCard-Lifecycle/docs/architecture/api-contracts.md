---
artifact_id: architecture.api-contracts
status: accepted
version: 7
owner: architecture
updated: 2026-07-27
---

# API Contracts

HTTP-контракт MVP v1 для команд и запросов из [[commands-events]]. Каноническая machine-readable версия генерируется FastAPI как OpenAPI `3.1` из Pydantic models и route metadata. Committed snapshot Gate 1 содержит только реализованные health/session endpoints; описанные ниже business endpoints остаются контрактом следующих vertical slices, а не скрытой реализацией Gate 2.

## Общие правила

- base path: `/api/v1`;
- формат: JSON UTF-8; errors — `application/problem+json`;
- browser session — signed `HttpOnly` cookie с `jti`; active state, expiry, revocation и prepared identity/role binding хранятся в PostgreSQL;
- все business-command mutations требуют `X-CSRF-Token` и `X-Command-Id: <uuid>`; bootstrap GET выдаёт token, а session switch/logout требуют CSRF, но не являются business commands и не получают `commandId`/event;
- backend создаёт один `correlationId` на каждую новую successful command transaction, включая допустимый no-op повторного payroll export, и использует его во всех событиях этой транзакции, если события есть;
- client передаёт ожидаемые версии в command body; resource response содержит `version` и `ETag: "v{version}"`;
- UUID — технические идентификаторы. API не возвращает `sequenceNumber`, part number или позицию `n из N`;
- успешный read не создаёт receipt/event и не меняет version;
- даты — ISO 8601 UTC, количества — integer, `normHours` — decimal string с ровно двумя знаками после десятичной точки, например `"1.25"`.

## Trusted demo session

| Метод и path | Доступ | Результат |
|---|---|---|
| `GET /demo-identities` | public demo shell | активные подготовленные identities: opaque ID, русское имя и display role |
| `GET /session/bootstrap` | public | выдаёт short-lived signed anonymous bootstrap cookie и связанный CSRF token; domain state отсутствует |
| `PUT /session/demo` | bootstrap или authenticated session + CSRF + trusted Origin | body `{ "demoIdentityId": uuid }`; backend сверяет allowlist, rotates bootstrap/current cookie и выдаёт authenticated signed session + новый CSRF token |
| `GET /session` | authenticated | trusted actor, role, permissions и новый CSRF token; без предметного изменения |
| `DELETE /session` | authenticated + CSRF | отзывает текущий server-side `jti` и удаляет session cookie |

Bootstrap cookie содержит только подписанный случайный `jti`, но не actor/role. Registry хранит issued/expiry timestamps и optional identity/role binding. `SameSite=Strict`, проверка `Origin`/`Sec-Fetch-Site` и совпадение CSRF binding применяются уже к первому `PUT`. Role switch атомарно отзывает старый `jti` и создаёт новый; logout отзывает текущий. Старые cookie/token недействительны server-side между процессами и после рестарта.

`expiresInSeconds` во всех session responses означает фактический оставшийся TTL до registry `expires_at`. Значение не увеличивается, около expiry приближается к нулю, а после expiry `GET /session` возвращает `401`.

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

### Canonical command identity и request hash

Для `CreateProductionBatch` fingerprint строится только из следующего логического объекта:

```json
{
  "body": {
    "productionPassportId": "canonical-lowercase-uuid",
    "quantity": 112
  },
  "commandType": "CreateProductionBatch",
  "targetPath": "/api/v1/production-batches"
}
```

Canonical serialization выполняется так:

- JSON keys рекурсивно сортируются в лексикографическом порядке;
- separators — `,` и `:` без пробелов;
- результат кодируется UTF-8 без BOM;
- UUID приводится к lowercase canonical hyphenated representation;
- `quantity` остаётся JSON integer и не преобразуется в string;
- insignificant whitespace и завершающий перевод строки отсутствуют;
- request headers, session identity, `Origin` и CSRF в fingerprint не входят;
- `request_hash` — SHA-256 canonical UTF-8 bytes, сохранённый как 64-character lowercase hexadecimal digest.

Точный canonical JSON для passport UUID `00000000-0000-0000-0000-000000000000` и quantity `112`:

```json
{"body":{"productionPassportId":"00000000-0000-0000-0000-000000000000","quantity":112},"commandType":"CreateProductionBatch","targetPath":"/api/v1/production-batches"}
```

Его SHA-256 digest: `7fc64c99fe76535b4990792ca88efb1379bc16ca9317243062618f8c9f4a3057`.

Тот же `commandId` и тот же digest для `CreateProductionBatch` дают `409 COMMAND_ALREADY_PROCESSED`; тот же `commandId` и другой command type, target path или digest дают `409 COMMAND_ID_REUSED`. Create command не возвращает сохранённый resource при replay. SHA-256 collision не вводится как отдельный штатный outcome.

Для `ReleaseWorkCards` fingerprint строится из фактического versioned path с canonical `batchId`, а не из route template:

```json
{
  "body": {
    "expectedVersion": 1
  },
  "commandType": "ReleaseWorkCards",
  "targetPath": "/api/v1/production-batches/00000000-0000-0000-0000-000000000000/actions/release-work-cards"
}
```

Применяется та же recursive key sorting, compact separators, UTF-8/SHA-256 и UUID normalization. `expectedVersion` остаётся JSON integer. `batchId` входит только в фактический `targetPath`; path template, query string, headers, actor/session и повторное поле `batchId` в body отсутствуют. Точный canonical JSON для показанного batch UUID и `expectedVersion = 1`:

```json
{"body":{"expectedVersion":1},"commandType":"ReleaseWorkCards","targetPath":"/api/v1/production-batches/00000000-0000-0000-0000-000000000000/actions/release-work-cards"}
```

Его SHA-256 digest: `2d6b9a0cf41ec0b4573fd229b9e3adb5e23366d83b443a7893997903269dc3bc`.

`ReleaseWorkCards` — non-replayable command: тот же `commandId` и тот же digest дают `409 COMMAND_ALREADY_PROCESSED` без возврата сохранённого resource; отличие command type, фактического target path либо digest даёт `409 COMMAND_ID_REUSED`.

## Commands партии

### `CreateProductionBatch`

`POST /api/v1/production-batches`

```json
{
  "productionPassportId": "00000000-0000-0000-0000-000000000000",
  "quantity": 112
}
```

- роль: `PLANNER`;
- `quantity` — JSON integer в диапазоне `1..2147483647` включительно; верхняя
  граница соответствует PostgreSQL `integer` в `production_batches.batch_quantity`;
- route не принимает operation plans или norm;
- server строит полный snapshot по точной схеме [[commands-events]] и сохраняет одну и ту же логическую JSON-структуру в batch, event и response;
- успех после commit — `201` со следующим точным body:

```json
{
  "data": {
    "batchId": "uuid",
    "productionPassportId": "uuid",
    "quantity": 112,
    "lifecycleStatus": "CREATED",
    "version": 1,
    "passportSnapshot": {
      "productionPassportId": "uuid",
      "code": "nonblank string",
      "revision": "nonblank string",
      "productName": "nonblank string",
      "operationPlans": [
        {
          "operationPlanId": "uuid",
          "position": 1,
          "operationScope": {
            "code": "string",
            "displayName": "string"
          },
          "normHours": "1.50",
          "plannedCardCount": 112
        }
      ]
    }
  },
  "meta": {
    "commandId": "uuid из X-Command-Id",
    "correlationId": "server-generated uuid",
    "replayed": false
  }
}
```

`data.batchId` равен event `aggregateId`, `ProductionBatchCreated.data.batchId` и receipt `result_id`; `data.productionPassportId` равен выбранному passport ID и `data.passportSnapshot.productionPassportId`. UUID в response используют lowercase canonical hyphenated representation. `createdAt`, `releasedAt`, sets и cards в create response отсутствуют.

### `ReleaseWorkCards`

`POST /api/v1/production-batches/{batchId}/actions/release-work-cards`

```json
{ "expectedVersion": 1 }
```

- роль: `PLANNER`;
- `batchId` — lowercase canonical UUID path parameter; `expectedVersion` — JSON integer `1..2147483647`;
- request не принимает operation plans, counts, UUID создаваемых sets/cards или snapshots;
- server использует только сохранённый batch passport snapshot и отображение из [[commands-events]];
- успех после commit — `200`, `Content-Type: application/json` и `ETag: "v2"` со следующим точным body:

```json
{
  "data": {
    "batchId": "00000000-0000-0000-0000-000000000000",
    "lifecycleStatus": "RELEASED",
    "version": 2,
    "setCount": 3,
    "cardCountTotal": 250,
    "workCardSets": [
      {
        "setId": "22000000-0000-4000-8000-000000000001",
        "operationPlanId": "21000000-0000-4000-8000-000000000001",
        "position": 1,
        "operationScope": {
          "code": "SYN-OP-10",
          "displayName": "Синтетическая операция А"
        },
        "normHours": "1.25",
        "plannedCardCount": 112,
        "gateStatus": "FIRST_ARTICLE_PENDING",
        "version": 1
      },
      {
        "setId": "22000000-0000-4000-8000-000000000002",
        "operationPlanId": "21000000-0000-4000-8000-000000000002",
        "position": 2,
        "operationScope": {
          "code": "SYN-OP-20",
          "displayName": "Синтетическая операция Б"
        },
        "normHours": "0.75",
        "plannedCardCount": 112,
        "gateStatus": "FIRST_ARTICLE_PENDING",
        "version": 1
      },
      {
        "setId": "22000000-0000-4000-8000-000000000003",
        "operationPlanId": "21000000-0000-4000-8000-000000000003",
        "position": 3,
        "operationScope": {
          "code": "SYN-GRP-30",
          "displayName": "Синтетическая группа операций В"
        },
        "normHours": "2.00",
        "plannedCardCount": 26,
        "gateStatus": "FIRST_ARTICLE_PENDING",
        "version": 1
      }
    ]
  },
  "meta": {
    "commandId": "uuid из X-Command-Id",
    "correlationId": "server-generated uuid",
    "replayed": false
  }
}
```

`data.batchId` равен path ID, receipt `result_id` и aggregate ID `ProductionBatchReleased`. `workCardSets` содержит ровно один summary на operation plan в `position ASC`; `setId` соответствует `WorkCardSetCreated.aggregateId`, а `operationPlanId` — canonical source ID и сохранённому `operation_plan_key`. `version = 2` и ETag относятся к batch; каждый новый set имеет version `1`. Response не содержит массив `WorkCard`, card IDs, `releasedAt`, sequence или part/serial numbers.

Для fixture set counts равны `112`, `112`, `26`, `setCount = 3`, `cardCountTotal = 250`; весь выпуск, receipt и `254` audit events фиксируются атомарно.

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
| `405` | route существует, но метод не поддерживается | единый `METHOD_NOT_ALLOWED` Problem Details |
| `409` | version, state, gate, terminal, idempotency или uniqueness conflict | `VERSION_CONFLICT`, `SERIAL_GATE_CLOSED`, `BATCH_ALREADY_RELEASED`, `BATCH_FINAL_ACCEPTED`, `COMMAND_ID_REUSED` |
| `422` | семантически неверные данные | quantity вне `1..2147483647`, неактивный паспорт, assignee не `WORKER` |
| `500` | unexpected failure | transaction rolled back; безопасное общее сообщение |
| `503` | readiness dependency недоступна | `READINESS_UNAVAILABLE` для `/health/ready` |

### Problem Details для `POST /api/v1/production-batches`

Для create contract используются ровно следующие identifiers; дополнительные alias для этих outcomes запрещены:

| Outcome | HTTP status | Machine code | Полный `type` URI |
|---|---:|---|---|
| malformed JSON или invalid request schema | `400` | `REQUEST_VALIDATION_FAILED` | `https://workcard.example/problems/request-validation-failed` |
| authentication failure: session отсутствует или недействительна | `401` | `AUTHENTICATION_REQUIRED` | `https://workcard.example/problems/authentication-required` |
| trusted role не имеет permission `CreateProductionBatch` | `403` | `PERMISSION_DENIED` | `https://workcard.example/problems/permission-denied` |
| выбранный passport не найден | `404` | `RESOURCE_NOT_FOUND` | `https://workcard.example/problems/resource-not-found` |
| тот же command ID и тот же canonical request digest | `409` | `COMMAND_ALREADY_PROCESSED` | `https://workcard.example/problems/command-already-processed` |
| тот же command ID и другой command type, target path или digest | `409` | `COMMAND_ID_REUSED` | `https://workcard.example/problems/command-id-reused` |
| concurrent/database command conflict | `409` | `CONCURRENT_MODIFICATION` | `https://workcard.example/problems/concurrent-modification` |
| semantic invalid batch, passport или operation plans | `422` | `PRODUCTION_BATCH_INVALID` | `https://workcard.example/problems/production-batch-invalid` |
| unexpected internal failure | `500` | `INTERNAL_ERROR` | `https://workcard.example/problems/internal-error` |

`REQUEST_VALIDATION_FAILED`, `RESOURCE_NOT_FOUND` и `INTERNAL_ERROR` сохраняют shared runtime naming. `CONCURRENT_MODIFICATION`, `COMMAND_ALREADY_PROCESSED` и `COMMAND_ID_REUSED` сохраняют уже принятые architecture codes. Codes `AUTHENTICATION_REQUIRED`, `PERMISSION_DENIED` и `PRODUCTION_BATCH_INVALID` становятся каноническими identifiers для ранее неидентифицированных create outcomes.

### Problem Details для `ReleaseWorkCards`

Для `POST /api/v1/production-batches/{batchId}/actions/release-work-cards` используются ровно следующие identifiers; дополнительные alias для этих outcomes запрещены:

| Outcome | HTTP status | Machine code | Полный `type` URI |
|---|---:|---|---|
| malformed JSON, invalid UUID/path либо invalid request schema | `400` | `REQUEST_VALIDATION_FAILED` | `https://workcard.example/problems/request-validation-failed` |
| authentication failure: session отсутствует или недействительна | `401` | `AUTHENTICATION_REQUIRED` | `https://workcard.example/problems/authentication-required` |
| trusted role не имеет permission `ReleaseWorkCards` | `403` | `PERMISSION_DENIED` | `https://workcard.example/problems/permission-denied` |
| доступная роли production batch не найдена | `404` | `RESOURCE_NOT_FOUND` | `https://workcard.example/problems/resource-not-found` |
| тот же command ID и тот же canonical request digest | `409` | `COMMAND_ALREADY_PROCESSED` | `https://workcard.example/problems/command-already-processed` |
| тот же command ID и другой command type, фактический target path или digest | `409` | `COMMAND_ID_REUSED` | `https://workcard.example/problems/command-id-reused` |
| batch уже `RELEASED`/`FINAL_ACCEPTED` либо уже имеет выпущенные sets | `409` | `BATCH_ALREADY_RELEASED` | `https://workcard.example/problems/batch-already-released` |
| `expectedVersion` не равна текущей version доступной `CREATED` batch | `409` | `VERSION_CONFLICT` | `https://workcard.example/problems/version-conflict` |
| deadlock, serialization либо concurrent database conflict | `409` | `CONCURRENT_MODIFICATION` | `https://workcard.example/problems/concurrent-modification` |
| immutable passport snapshot невалиден либо рассчитанные counts нарушают release invariants | `422` | `PRODUCTION_BATCH_INVALID` | `https://workcard.example/problems/production-batch-invalid` |
| unexpected internal failure | `500` | `INTERNAL_ERROR` | `https://workcard.example/problems/internal-error` |

Session, CSRF и trusted-origin failures используют существующие shared security Problem Details без release-specific aliases. Для `VERSION_CONFLICT` response не раскрывает текущую version; клиент перечитывает batch и создаёт новый command с новым `commandId`. Для `BATCH_ALREADY_RELEASED` новые sets/cards, receipt и events отсутствуют.

`errors` содержит field paths только для безопасной input validation. Protected existence, SQL details, stack traces, cookie/CSRF values и event data не раскрываются.

Runtime handlers для request validation, application errors, `401`, `403`, `404`, `405`, `500` и readiness `503` возвращают одну Pydantic-модель `ProblemDetails` с media type `application/problem+json`. Malformed body/shape возвращает `400`; семантический `422 DEMO_IDENTITY_INVALID` остаётся отдельным фактическим контрактом. Generated OpenAPI не публикует автоматический `HTTPValidationError`, когда runtime его не возвращает.

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

Для release initial receipt lookup выполняется до batch lookup. Если lookup не увидел concurrent uncommitted winner и ожидание batch lock завершилось после чужого commit, backend повторно читает receipt до классификации state/version: matching release receipt даёт `COMMAND_ALREADY_PROCESSED`, mismatch — `COMMAND_ID_REUSED`. При другом `commandId` уже выпущенная batch даёт `BATCH_ALREADY_RELEASED`. Для доступной `CREATED` batch state/invariants проверяются до `expectedVersion`, поэтому только она может вернуть `VERSION_CONFLICT`.

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

- Pydantic request/response schema и FastAPI metadata присутствуют у каждого endpoint;
- generated OpenAPI не содержит undocumented command;
- frontend client генерируется из committed OpenAPI без diff;
- каждый command имеет positive, permission, validation/state и version-contract tests по [[requirements-traceability]];
- endpoints отрицательной приёмки, rework, reassignment, repeat release и real payroll отсутствуют.
