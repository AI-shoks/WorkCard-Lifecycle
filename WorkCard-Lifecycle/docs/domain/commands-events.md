---
artifact_id: domain.commands-events
status: accepted
version: 3
owner: domain
updated: 2026-07-17
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

Команд отклонения, возврата, отдельного закрытия и повторной приёмки нет.

### Граница `FinalBatchAcceptance`

Подтверждённая AS-IS финальная приёмка выполняется БТК после завершения всей партии и сопровождается подписями на физических карточках. В MVP нет `AcceptFinalBatch`, агрегата/состояния `FinalBatchAcceptance` или события цифровой подписи. `ConfirmWorkCardQuality` — выбранное `TO_BE_DECISION` уровня одной WorkCard; оно не записывает и не доказывает финальную приёмку партии.

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
| `GetWorkCardHistory` | `ADMIN_AUDITOR` | Нет |
| `GetPayrollRecord` | `ADMIN_AUDITOR` | Нет |

## Каталог событий

| Событие | Агрегат | Минимальные предметные данные |
|---|---|---|
| `ProductionBatchCreated` | `ProductionBatch` | `batchId`, `quantity`, `passportSnapshot` |
| `ProductionBatchReleased` | `ProductionBatch` | `batchId`, `workCardSetIds`, `setCount`, `cardCountTotal` |
| `WorkCardSetCreated` | `WorkCardSet` | `setId`, `batchId`, `operationScope`, `normHours`, `plannedCardCount`, `gateStatus` |
| `WorkCardReleased` | `WorkCard` | `workCardId`, `setId`, `batchId`, `batchQuantitySnapshot`, `operationScope`, `normHours`, `status` |
| `FirstArticleWorkCardSelected` | `WorkCardSet` | `setId`, `workCardId`, `gateStatus` |
| `WorkCardAssigned` | `WorkCard` | `workCardId`, `assigneeId`, `purpose`, `status` |
| `WorkCardStarted` | `WorkCard` | `workCardId`, `assigneeId`, `recordedByMasterId`, `status` |
| `WorkCardCompleted` | `WorkCard` | `workCardId`, `assigneeId`, `recordedByMasterId`, `status` |
| `WorkCardQualityConfirmed` | `WorkCard` | `workCardId`, `controllerId`, `confirmationScope: WORK_CARD`, `acceptanceType`, `resultingStatus: CLOSED` |
| `FirstArticleAccepted` | `WorkCardSet` | `setId`, `workCardId`, `resultingGateStatus: SERIAL_ALLOWED` |
| `WorkCardExportedToPayroll` | `PayrollRecord` | `payrollRecordId`, `workCardId`, `beneficiaryId`, `normHours` |

`sequenceNumber`, номер детали и один норматив партии отсутствуют в событиях.

## Оболочка события

Каждое событие содержит `eventId`, `eventType`, `occurredAt` UTC, `aggregateType`, `aggregateId`, `aggregateVersion`, `actorId`, `actorRole`, `commandId`, `correlationId` и типизированные `data`. Межагрегатные команды используют общий `correlationId`; способ полного server query остаётся решением [[api-contracts]].

События неизменяемы, не означают event sourcing и подчиняются `BR-050`–`BR-053`.
