---
artifact_id: architecture.api-contracts
status: accepted
version: 5
owner: architecture
updated: 2026-09-06
---

# API Contracts

HTTP/JSON контракт MVP v1. Каноническая machine-readable версия генерируется из TypeBox-схем как OpenAPI 3.1 и проверяется contract tests; этот документ фиксирует семантику, которую генератор не выражает полностью.

## Общие соглашения

- Base path: `/api/v1`; health endpoints живут вне versioned API.
- JSON — UTF-8, поля API и enum остаются техническими; производственный UI отображает принятые русские эквиваленты из [[glossary]] и [[ux-copy-guidelines]].
- ID — UUID strings. `workCardId` нигде не называется номером детали.
- Время — RFC 3339 UTC (`2026-09-01T12:00:00Z`).
- Decimal `normHours` передаётся строкой (`"1.25"`), чтобы не терять точность.
- Неизвестные поля command body отклоняются (`additionalProperties: false`).
- Mutations принимают `Content-Type: application/json`, trusted session cookie и `X-CSRF-Token`.
- Все responses содержат `X-Request-Id`; command success дополнительно содержит `correlationId` в body.

## Доверенная demo-session

| Method и path | Назначение | Доступ |
|---|---|---|
| `GET /demo-users` | подготовленные синтетические пользователи и русские названия ролей | public demo shell |
| `POST /demo-session` | выбрать `demoUserId`, создать/заменить HttpOnly session | public + Origin check |
| `GET /demo-session` | текущий actor/role, CSRF token и permissions projection | authenticated |
| `DELETE /demo-session` | завершить session | authenticated + CSRF |

`POST /demo-session` принимает только `demoUserId`. Клиентские `actorId` и `role` игнорировать запрещено — такие поля не входят в schema. API загружает роль из `demo_users` и подписывает opaque session cookie. Перед вставкой он удаляет истёкшие/idle sessions и применяет hosted limit `500`; при capacity возвращает `409 DEMO_CAPACITY_REACHED`. Общий public demo не гарантирует сохранность session или state: owner-only daily reset инвалидирует все sessions.

## Read endpoints

| Method и path | Projection | Основные роли |
|---|---|---|
| `GET /production-passports` | read-only список паспортов с operation plan summary | все authenticated demo-роли |
| `GET /production-passports/{passportId}` | паспорт и operation plans | все authenticated demo-роли |
| `GET /production-batches?cursor&limit` | партии и status/count summary | все authenticated по [[roles-permissions]] |
| `GET /production-batches/{batchId}` | batch и operation-plan snapshots, sets summary, final acceptance read-back | разрешённые demo-роли |
| `GET /work-card-sets/{setId}` | operation scope, norm, gate, assignment/status counts | разрешённые demo-роли |
| `GET /work-card-sets/{setId}/work-cards?cursor&limit&status&assigneeId` | cursor page карточек | разрешённые demo-роли; worker ограничен собой |
| `GET /work-cards/{workCardId}` | одна карточка, timestamps, permissions projection | разрешённые demo-роли |
| `GET /work-cards/{workCardId}/history?cursor&limit` | события одного aggregate | `ADMIN_AUDITOR` |
| `GET /audit-correlations/{correlationId}?cursor&limit` | полный server-side набор событий команды | `ADMIN_AUDITOR` |
| `GET /work-cards/{workCardId}/payroll-record` | существующая mock record или `404` | `ADMIN_AUDITOR` |

Default `limit = 50`, maximum `100`. Cursor — непрозрачная base64url-строка с последним `(sortKey,id)` и версией формата; offset pagination не используется. Stable order задаётся сервером.

### Batch projection

`GET /production-batches/{batchId}` возвращает:

```json
{
  "id": "uuid",
  "quantity": 112,
  "lifecycleStatus": "CREATED",
  "version": 1,
  "passportSnapshot": {
    "code": "SYN-PASS-001",
    "revision": "A",
    "productName": "Синтетическое изделие"
  },
  "counts": { "setCount": 0, "plannedCardCount": 250, "actualCardCount": 0, "closedCardCount": 0 },
  "operationPlan": [
    {
      "id": "uuid",
      "position": 1,
      "scopeCode": "OP-010-030",
      "scopeName": "Операции 010–030",
      "normHours": "0.80",
      "plannedCardCount": 112
    },
    {
      "id": "uuid",
      "position": 2,
      "scopeCode": "OP-040-060",
      "scopeName": "Операции 040–060",
      "normHours": "1.25",
      "plannedCardCount": 112
    },
    {
      "id": "uuid",
      "position": 3,
      "scopeCode": "OP-070",
      "scopeName": "Операция 070",
      "normHours": "0.55",
      "plannedCardCount": 26
    }
  ],
  "sets": [],
  "finalAcceptance": null,
  "availableActions": []
}
```

`operationPlan` — неизменяемый снимок, созданный вместе с партией; preview выпуска не перечитывает актуальный reference-паспорт. `availableActions` — подсказка интерфейсу, но не разрешение: mutation повторно проходит backend authorization и invariant checks.

## Command endpoints

| Команда | Method и path | Body versions | Success |
|---|---|---|---|
| `CreateProductionBatch` | `POST /production-batches` | новый aggregate; version отсутствует | `201` batch v1 |
| `ReleaseWorkCards` | `POST /production-batches/{batchId}/release` | `expectedBatchVersion` | `200` batch + counts |
| `AssignWorkCards` | `POST /work-card-sets/{setId}/assignments` | set + каждая card | `200` assignment summary |
| `StartWorkCard` | `POST /work-cards/{workCardId}/start` | card | `200` card |
| `CompleteWorkCard` | `POST /work-cards/{workCardId}/complete` | card | `200` card |
| `AcceptFirstArticle` | `POST /work-card-sets/{setId}/first-article-acceptance` | set + card | `200` set + card |
| `ConfirmWorkCardQuality` | `POST /work-cards/{workCardId}/quality-confirmation` | card | `200` card |
| `RecordFinalBatchAcceptance` | `POST /production-batches/{batchId}/final-acceptance` | batch | `201` acceptance + batch |
| `ExportWorkCardToPayroll` | `POST /work-cards/{workCardId}/payroll-export` | card read version | `201` first record, `200` existing record |

Любой command body содержит `commandId`. ID в path не дублируется в body.

### Создание и выпуск

```json
{
  "commandId": "uuid",
  "productionPassportId": "uuid",
  "quantity": 112
}
```

```json
{
  "commandId": "uuid",
  "expectedBatchVersion": 1
}
```

Успех выпуска возвращает `setCount`, `plannedCardCount`, `actualCardCount` и `batchVersion`; массив из `250` карточек в command response не передаётся.

### Массовое назначение

```json
{
  "commandId": "uuid",
  "purpose": "SERIAL",
  "assigneeId": "uuid",
  "expectedSetVersion": 2,
  "cards": [
    { "workCardId": "uuid", "expectedVersion": 1 }
  ]
}
```

`cards` — непустой массив уникальных ID одного комплекта, максимум `250`. Порядок клиента не влияет на lock order. First-article request содержит ровно одну карточку. Success возвращает изменённые versions и новый assignment summary; отказ не возвращает частичный success.

### Lifecycle и контроль

`StartWorkCard`, `CompleteWorkCard` и `ConfirmWorkCardQuality` меняют только card и содержат `expectedCardVersion`. Для start/quality backend блокирует и читает set context, но не требует client-version неизменяемого этой командой set.

```json
{
  "commandId": "uuid",
  "expectedCardVersion": 3
}
```

First-article acceptance расширяет body полем `expectedSetVersion`, потому что изменяет set и card; success возвращает обе resulting versions. Per-card quality success никогда не содержит и не создаёт `finalAcceptance`.

### Финальная приёмка

```json
{
  "commandId": "uuid",
  "expectedBatchVersion": 2
}
```

Success `201`:

```json
{
  "acceptance": {
    "id": "uuid",
    "batchId": "uuid",
    "controller": { "id": "uuid", "displayName": "Контролёр БТК" },
    "acceptedAt": "2026-09-01T12:00:00Z",
    "resultingBatchVersion": 3
  },
  "batchLifecycleStatus": "FINAL_ACCEPTED",
  "correlationId": "uuid"
}
```

Replay того же `commandId` и того же trusted actor возвращает тот же body с `200`, заголовком `Idempotent-Replay: true`, без новой версии/события. Новый command для уже принятой партии получает `409`.

### Mock payroll

Body содержит `commandId` и `expectedCardVersion`. Первый export — `201`; повтор для того же `workCardId`, даже с новым commandId, — `200` существующей записи с `Idempotent-Replay: true`. Новое событие при повторе не создаётся.

## Idempotency contract

1. `commandId` — UUID клиента и основной idempotency key; заголовок `Idempotency-Key` не вводится как второй источник истины.
2. Успешная команда сохраняет `command_receipt` в той же транзакции.
3. Replay допустим только для того же command type и actor. Повторное использование ID для другого запроса — `409 COMMAND_ID_REUSED`.
4. Failed validation/authorization/domain command не сохраняет success receipt и может быть исправлен с новым commandId.
5. UI не повторяет mutation автоматически; idempotency защищает явный replay и неопределённость транспортного ответа.

## Полный audit query по correlation

`GET /audit-correlations/{correlationId}` является каноническим решением для `UC-014`. Endpoint читает `command_receipt` и события server-side; он не объединяет истории карточек на клиенте.

```json
{
  "correlationId": "uuid",
  "commandId": "uuid",
  "commandType": "ReleaseWorkCards",
  "expectedEventCount": 254,
  "totalEventCount": 254,
  "events": [],
  "nextCursor": null
}
```

Каждая page повторяет authoritative totals. Клиент считает выборку полной только когда `nextCursor = null` и накопленное число уникальных event ID равно `totalEventCount = expectedEventCount`. Несовпадение — integrity error, а не неполный «успех».

## Ошибки

Errors используют `application/problem+json` (RFC 9457):

```json
{
  "type": "https://work-card.example/problems/version-conflict",
  "title": "Данные были изменены",
  "status": 409,
  "detail": "Обновите данные и повторите решение.",
  "instance": "/api/v1/work-cards/uuid/start",
  "code": "VERSION_CONFLICT",
  "requestId": "uuid",
  "conflicts": [
    { "resourceType": "workCard", "resourceId": "uuid", "expectedVersion": 2, "actualVersion": 3 }
  ]
}
```

| HTTP | Категория | Примеры code |
|---:|---|---|
| `400` | malformed JSON/query | `INVALID_REQUEST` |
| `401` | нет/истекла session | `AUTHENTICATION_REQUIRED` |
| `403` | trusted role не имеет права | `ACTION_FORBIDDEN`, без раскрытия закрытого состояния |
| `404` | разрешённый caller не видит resource | `RESOURCE_NOT_FOUND` |
| `409` | version/state/gate/idempotency conflict либо достигнут лимит общей demo | `VERSION_CONFLICT`, `STATE_CONFLICT`, `GATE_CLOSED`, `COMMAND_ID_REUSED`, `DEMO_CAPACITY_REACHED` |
| `422` | schema валидна, business input недопустим | `INVALID_QUANTITY`, `MIXED_WORK_CARD_SET`, `INVALID_ASSIGNEE` |
| `429` | превышен лимит запросов IP/категории; `Retry-After` задаёт паузу в секундах | `TOO_MANY_REQUESTS` |
| `500` | непредвиденная ошибка | `INTERNAL_ERROR`, без stack/SQL detail |
| `503` | DB/readiness недоступны или исчерпан handler/DB budget | `SERVICE_UNAVAILABLE` |

Технический `code` используется UI для детерминированного русского текста, но не показывается производственной роли на верхнем уровне. На conflict UI перечитывает ресурсы и требует нового осознанного действия.

Лимиты этапа 9 описаны в [[security-baseline]]. `429` отклоняется до business handler и не создаёт receipt/event; автоматический повтор mutation не разрешается. `503`/потеря ответа не доказывают отсутствие commit: клиент сохраняет существующий recovery через безопасные reads и явное новое решение пользователя. Успешные схемы и предметные команды не изменены.

## Health и OpenAPI

- `GET /health/live` — процесс отвечает `200 {"status":"ok"}` без DB dependency.
- `GET /health/ready` — проверяет доступность БД и ожидаемую migration version; отвечает только `200 {"status":"ok"}` либо `503 {"status":"unavailable"}`.
- Public health payload не содержит `APP_VERSION`, service/revision, состояние БД или номера migration. Эти детали доступны только в безопасном operator log и release metadata.
- `GET /api/openapi.json` — contract для разработки; в public demo read-only.
- Swagger UI не подключён; доступен только generated OpenAPI JSON для разработки.

## Contract gates

- TypeBox schema компилируется и генерирует OpenAPI без ошибок;
- response serialization включена для всех маршрутов;
- текущие negative tests покрывают unknown fields, invalid UUID/schema, role tampering и ранний security order; body-limit/decimal/date matrix относится к этапу 9;
- automated OpenAPI snapshot diff относится к этапу 9; до него contract review выполняется по TypeBox schemas и generated document;
- API tests доказывают отсутствие `sequenceNumber`, batch-level `normHours` и неявной final acceptance.
