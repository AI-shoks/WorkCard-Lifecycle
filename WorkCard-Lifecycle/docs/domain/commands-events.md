---
artifact_id: domain.commands-events
status: accepted
version: 6
owner: domain
updated: 2026-07-27
---

# Commands and Domain Events

Каталог изменяющих бизнес-команд и событий MVP v1. Каждая успешная изменяющая команда покрывается `BR-050`, включая создание партии.

## Общий контракт команды

Команда содержит `commandId`, доверенно установленного `actorId`/роль, предметные поля и `expectedVersion` каждого существующего изменяемого агрегата. Backend проверяет роль, входные данные, существование, состояние, gate и версии до изменения. Межагрегатная команда сохраняет все изменения и события одной транзакцией.

## Партия и выпуск

### `CreateProductionBatch`

| Поле | Спецификация |
|---|---|
| Инициатор | `PLANNER` как представитель ПДБ |
| Вход | `quantity`, `productionPassportId` |
| Предусловия | Подготовленный паспорт существует; `BR-001`, `BR-010`, `BR-011` |
| Результат | Невыпущенная `ProductionBatch` версии `1` со снимком паспорта; норматив партии отсутствует |
| Событие | `ProductionBatchCreated` |

Маршрут, состав operations и нормы не вводятся этой командой: их источники — подготовленные данные технолога/БТБ.

#### Канонический `ProductionPassportSnapshot`

При создании партии backend один раз строит полный immutable JSON object и без сокращённой event projection использует одну и ту же логическую структуру в `production_batches.passport_snapshot`, `ProductionBatchCreated.data.passportSnapshot` и успешном `data.passportSnapshot`:

```json
{
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
```

- `productionPassportId` и `operationPlanId` сериализуются как lowercase canonical hyphenated UUID strings;
- `code`, `revision`, `productName`, `operationScope.code` и `operationScope.displayName` — непустые strings;
- `operationPlans` — непустой массив, строго отсортированный по `position ASC`;
- `position` и `plannedCardCount` — положительные JSON integers;
- `normHours` — JSON string с ровно двумя знаками после десятичной точки, соответствующая PostgreSQL `numeric(8,2)`;
- `operationScope` — server-copied allowlisted object только с ключами `code` и `displayName`; optional group members и любые другие ключи исходного JSONB в snapshot не переносятся;
- `active`, единый batch-level `normHours`, `sequenceNumber`, physical serial/part number и агрегированный `plannedCardCount` в snapshot отсутствуют;
- последующие изменения паспорта или operation plans не изменяют сохранённый snapshot.

#### `ProductionBatchCreated`

Envelope сохраняет `eventId`, `eventType = ProductionBatchCreated`, `occurredAt`, `aggregateType = ProductionBatch`, `aggregateId`, `aggregateVersion = 1`, `actorId`, `actorRole = PLANNER`, `commandId`, `correlationId` и `data`. Точная `data`:

```json
{
  "batchId": "uuid",
  "quantity": 112,
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
}
```

`batchId` равен `aggregateId` и ID созданной строки `production_batches`; `quantity` равен `production_batches.batch_quantity`; `passportSnapshot` логически равен `production_batches.passport_snapshot` и подчиняется точной схеме выше. Отдельная сокращённая event projection запрещена. `status` и `version` в `data` не дублируются: resulting version находится в envelope, а состояние подтверждается созданным aggregate. `occurredAt` генерируется сервером в UTC внутри command transaction. Для успешной новой команды событие создаётся ровно один раз.

### `ReleaseWorkCards`

| Поле | Спецификация |
|---|---|
| Инициатор | `PLANNER` |
| Вход | `batchId`, `expectedVersion` партии |
| Предусловия | Партия не выпускалась; снимок паспорта содержит валидный набор operation plans |
| Результат | Партия помечена выпущенной; для каждого operation plan создан `WorkCardSet`, затем `plannedCardCount` карточек `RELEASED` |
| События | `ProductionBatchReleased`, по одному `WorkCardSetCreated` и по одному `WorkCardReleased` на карточку |
| Атомарность | `BR-012`–`BR-016`, `BR-050`–`BR-062` |

Для канонического fixture результат — три комплекта `112`, `112`, `26`, всего `250`; все карточки имеют `batchQuantitySnapshot = 112` и не имеют sequence.

#### Каноническое отображение operation plans

Release читает только сохранённый `ProductionBatch.passportSnapshot`; текущие reference rows паспорта и operation plans повторно не читаются. `operationPlans` обрабатываются в сохранённом порядке `position ASC`. Для каждого plan:

- `operationPlanId` приводится к lowercase canonical hyphenated UUID string и без префикса либо иной производной сохраняется как `work_card_sets.operation_plan_key`;
- создаётся ровно один `WorkCardSet` версии `1` с `gateStatus = FIRST_ARTICLE_PENDING`;
- `operationScope`, `normHours` и `plannedCardCount` копируются без расширения из allowlisted snapshot;
- создаётся ровно `plannedCardCount` карточек версии `1` со статусом `RELEASED`, null `purpose`/`assigneeId` и snapshot партии/комплекта;
- UUID sets/cards генерируются приложением и не являются sequence, позицией или номером детали.

`workCardSetIds` в `ProductionBatchReleased.data` и set summaries успешного ответа используют один порядок: `position ASC`. Карточки не возвращаются release-response массивом и не получают предметного порядка; server-side audit query сохраняет свой канонический порядок `occurredAt`, затем `eventId`.

#### Exact события `ReleaseWorkCards`

Успешная команда использует один `commandId`, один server-generated `correlationId` и trusted `actorRole = PLANNER` во всём event set.

`ProductionBatchReleased` имеет `aggregateType = ProductionBatch`, `aggregateId = batchId`, `aggregateVersion = expectedVersion + 1` и точную `data`:

```json
{
  "batchId": "00000000-0000-0000-0000-000000000000",
  "workCardSetIds": [
    "22000000-0000-4000-8000-000000000001",
    "22000000-0000-4000-8000-000000000002",
    "22000000-0000-4000-8000-000000000003"
  ],
  "setCount": 3,
  "cardCountTotal": 250
}
```

Каждый `WorkCardSetCreated` имеет `aggregateType = WorkCardSet`, `aggregateId = setId`, `aggregateVersion = 1` и точную `data`:

```json
{
  "setId": "uuid",
  "batchId": "uuid",
  "operationPlanId": "uuid",
  "position": 1,
  "operationScope": {
    "code": "string",
    "displayName": "string"
  },
  "normHours": "1.25",
  "plannedCardCount": 112,
  "gateStatus": "FIRST_ARTICLE_PENDING"
}
```

Каждый `WorkCardReleased` имеет `aggregateType = WorkCard`, `aggregateId = workCardId`, `aggregateVersion = 1` и точную `data`:

```json
{
  "workCardId": "uuid",
  "setId": "uuid",
  "batchId": "uuid",
  "batchQuantitySnapshot": 112,
  "operationScope": {
    "code": "string",
    "displayName": "string"
  },
  "normHours": "1.25",
  "status": "RELEASED"
}
```

Во всех трёх payload schemas UUID используют lowercase canonical representation, `operationScope` содержит ровно `code`/`displayName`, а `normHours` — строку с двумя decimal places. Дополнительные keys, `sequenceNumber`, part/serial number, `purpose`, `assigneeId`, batch-level norm и дублирование envelope version в `data` запрещены. Канонический fixture создаёт ровно `1 + 3 + 250 = 254` таких событий; неполный или избыточный набор откатывает всю команду.

## Назначение и выполнение

### `AssignWorkCards`

| Поле | Спецификация |
|---|---|
| Инициатор | `MASTER` |
| Вход | `workCardSetId`, `expectedSetVersion`, `workCards[{workCardId, expectedVersion}]`, `assigneeId`, `purpose` |
| Предусловия | `BR-020`–`BR-024`; для `FIRST_ARTICLE` ровно одна карточка и pending gate, для `SERIAL` gate открыт |
| Результат | Все выбранные карточки назначены одному `WORKER`, получают purpose и `ASSIGNED`; first-article карточка регистрируется в комплекте |
| События | `WorkCardAssigned` для каждой карточки; `FirstArticleWorkCardSelected` для комплекта при purpose `FIRST_ARTICLE` |
| Атомарность | Комплект, все карточки и события — одна транзакция |

Последовательные команды могут сформировать распределение `60 + 52 = 112`; это распределение количества, не диапазонов номеров деталей.

### `StartWorkCard`

| Поле | Спецификация |
|---|---|
| Инициатор | `MASTER` |
| Вход | `workCardId`, `expectedVersion`; read-only set context для проверки gate |
| Предусловия | `BR-001`, `BR-002`, `BR-030` |
| Результат | `ASSIGNED → IN_PROGRESS` |
| Событие | `WorkCardStarted` с `assigneeId` и `recordedByMasterId` |

### `CompleteWorkCard`

| Поле | Спецификация |
|---|---|
| Инициатор | `MASTER` |
| Вход | `workCardId`, `expectedVersion` |
| Предусловия | `BR-001`, `BR-002`, `BR-031` |
| Результат | `IN_PROGRESS → COMPLETED` |
| Событие | `WorkCardCompleted` с `assigneeId` и `recordedByMasterId` |

## Контроль БТК

### `AcceptFirstArticle`

| Поле | Спецификация |
|---|---|
| Инициатор | `QUALITY_CONTROLLER` |
| Вход | `workCardId`, `expectedCardVersion`, `workCardSetId`, `expectedSetVersion` |
| Предусловия | Зарегистрированная first-article карточка `COMPLETED`, комплект `FIRST_ARTICLE_PENDING`; `BR-032`, `BR-034`, `BR-035` |
| Результат | Карточка `CLOSED`, комплект `SERIAL_ALLOWED` |
| События | `WorkCardQualityConfirmed` с `acceptanceType: FIRST_ARTICLE`, `FirstArticleAccepted` |
| Атомарность | Карточка, комплект и оба события — одна транзакция |

### `ConfirmWorkCardQuality`

| Поле | Спецификация |
|---|---|
| Инициатор | `QUALITY_CONTROLLER` |
| Вход | `workCardId`, `expectedVersion` |
| Предусловия | Serial-карточка `COMPLETED`, комплект `SERIAL_ALLOWED`; `BR-033`–`BR-035` |
| Результат | Синтетическое per-card подтверждение и `COMPLETED → CLOSED` только выбранной WorkCard |
| Событие | `WorkCardQualityConfirmed` с `confirmationScope: WORK_CARD`, `acceptanceType: SERIAL`, `resultingStatus: CLOSED` |

Команд отклонения, возврата, отдельного закрытия и повторного per-card подтверждения нет.

### `RecordFinalBatchAcceptance`

| Поле | Спецификация |
|---|---|
| Инициатор | `QUALITY_CONTROLLER` |
| Вход | `batchId`, `expectedVersion`; `commandId` из общей оболочки |
| Предусловия | Партия `RELEASED`; все обязательные комплекты имеют `SERIAL_ALLOWED`, полный `plannedCardCount` и только `CLOSED` WorkCard; `FinalBatchAcceptance` отсутствует; `BR-036`–`BR-039` |
| Результат | Создана одна неизменяемая `FinalBatchAcceptance`, связанная с партией; партия становится `FINAL_ACCEPTED`, её версия увеличивается на один |
| Событие | `FinalBatchAccepted` с `acceptanceId`, `batchId`, `controllerId`, `acceptedAt`, `resultingBatchVersion` |
| Атомарность | Партия, запись и audit event сохраняются одной транзакцией; ошибка любого сохранения откатывает всё |
| Повтор | Тот же `commandId` возвращает существующую запись без новой версии/события; новый command для принятой партии отклоняется |

Закрытые карточки являются предусловием, но не доказательством финальной приёмки. Цифровая запись не хранит и не заменяет подписи БТК на физических карточках.

## Mock payroll

### `ExportWorkCardToPayroll`

| Поле | Спецификация |
|---|---|
| Инициатор | `ADMIN_AUDITOR` |
| Вход | `workCardId`, `expectedVersion` |
| Предусловия | `BR-040`–`BR-044` |
| Первый результат | Одна `PayrollRecord` со снимком operation-scoped нормы |
| Повторный результат | Существующая запись без нового события |
| Событие первого успеха | `WorkCardExportedToPayroll` |

## Запросы

| Запрос | Кто использует | Побочный эффект |
|---|---|---|
| `GetProductionPassport` / `ListProductionPassports` | demo-роли | Нет |
| `GetProductionBatch` / `ListProductionBatches` | demo-роли | Нет |
| `GetWorkCardSet` / `ListWorkCardSets` | demo-роли | Нет |
| `GetWorkCard` / `ListWorkCards` | demo-роли | Нет |
| `GetFinalBatchAcceptance` | demo-роли, видящие партию | Нет |
| `GetWorkCardHistory` | `ADMIN_AUDITOR` | Нет |
| `GetPayrollRecord` | `ADMIN_AUDITOR` | Нет |

## Каталог событий

| Событие | Агрегат | Минимальные предметные данные |
|---|---|---|
| `ProductionBatchCreated` | `ProductionBatch` | `batchId`, `quantity`, `passportSnapshot` |
| `ProductionBatchReleased` | `ProductionBatch` | `batchId`, `workCardSetIds`, `setCount`, `cardCountTotal` |
| `WorkCardSetCreated` | `WorkCardSet` | `setId`, `batchId`, `operationPlanId`, `position`, `operationScope`, `normHours`, `plannedCardCount`, `gateStatus` |
| `WorkCardReleased` | `WorkCard` | `workCardId`, `setId`, `batchId`, `batchQuantitySnapshot`, `operationScope`, `normHours`, `status` |
| `FirstArticleWorkCardSelected` | `WorkCardSet` | `setId`, `workCardId`, `gateStatus` |
| `WorkCardAssigned` | `WorkCard` | `workCardId`, `assigneeId`, `purpose`, `status` |
| `WorkCardStarted` | `WorkCard` | `workCardId`, `assigneeId`, `recordedByMasterId`, `status` |
| `WorkCardCompleted` | `WorkCard` | `workCardId`, `assigneeId`, `recordedByMasterId`, `status` |
| `WorkCardQualityConfirmed` | `WorkCard` | `workCardId`, `controllerId`, `confirmationScope: WORK_CARD`, `acceptanceType`, `resultingStatus: CLOSED` |
| `FirstArticleAccepted` | `WorkCardSet` | `setId`, `workCardId`, `resultingGateStatus: SERIAL_ALLOWED` |
| `FinalBatchAccepted` | `ProductionBatch` | `acceptanceId`, `batchId`, `controllerId`, `acceptedAt`, `resultingBatchStatus: FINAL_ACCEPTED` |
| `WorkCardExportedToPayroll` | `PayrollRecord` | `payrollRecordId`, `workCardId`, `beneficiaryId`, `normHours` |

`sequenceNumber`, номер детали и один норматив партии отсутствуют в событиях.

## Оболочка события

Каждое событие содержит `eventId`, `eventType`, `occurredAt` UTC, `aggregateType`, `aggregateId`, `aggregateVersion`, `actorId`, `actorRole`, `commandId`, `correlationId` и типизированные `data`. Межагрегатные команды используют общий `correlationId`; способ полного server query остаётся решением [[api-contracts]].

События неизменяемы, не означают event sourcing и подчиняются `BR-050`–`BR-053`.
