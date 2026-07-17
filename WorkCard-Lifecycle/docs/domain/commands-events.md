---
artifact_id: domain.commands-events
status: accepted
version: 1
owner: domain
updated: 2026-07-17
---

# Commands and Domain Events

Каталог изменяющих бизнес-команд и возникающих после их успеха доменных событий MVP v1. Команды названы в повелительном наклонении, события — как уже произошедшие факты.

## Общий контракт команды

Каждая изменяющая команда содержит:

- `commandId` — уникальный идентификатор попытки;
- `actorId` и активную демонстрационную роль;
- идентификатор целевого агрегата или данные для создания;
- `expectedVersion` для существующих изменяемых агрегатов;
- бизнес-поля конкретной команды.

Backend сначала проверяет роль, входные данные, существование объекта, версию и предметные предусловия. Только после всех проверок команда изменяет состояние и создаёт события. Правила ошибок API будут конкретизированы в [[api-contracts]].

## Команды партии и выпуска

### `CreateProductionBatch`

| Поле | Спецификация |
|---|---|
| Инициатор | Планировщик |
| Вход | `quantity`, `routeCode`, `routeName`, `normHours` |
| Предусловия | `BR-001`, `BR-010`, `BR-011` |
| Результат | Создана невыпущенная `ProductionBatch`, версия `1` |
| Событие | `ProductionBatchCreated` |

### `ReleaseWorkCards`

| Поле | Спецификация |
|---|---|
| Инициатор | Планировщик |
| Вход | `batchId`, `expectedVersion` |
| Предусловия | `BR-002`, `BR-012`, `BR-016` |
| Результат | Партия помечена выпущенной; созданы один `WorkCardSet` и ровно `N` карточек `RELEASED` |
| События | `ProductionBatchReleased`, `WorkCardSetCreated` и по одному `WorkCardReleased` для каждой карточки |
| Атомарность | Вся операция соответствует `BR-013`–`BR-015`, `BR-051`, `BR-062` |

## Команды назначения и выполнения

### `AssignWorkCards`

| Поле | Спецификация |
|---|---|
| Инициатор | Мастер |
| Вход | `workCardIds[]`, `assigneeId`, ожидаемая версия каждой карточки |
| Предусловия | `BR-020`–`BR-024` |
| Результат | Все выбранные карточки назначены одному исполнителю и переведены в `ASSIGNED` |
| События | По одному `WorkCardAssigned` для каждой карточки |
| Атомарность | Все карточки и события фиксируются одной транзакцией |

### `StartWorkCard`

| Поле | Спецификация |
|---|---|
| Инициатор | Назначенный исполнитель |
| Вход | `workCardId`, `expectedVersion` |
| Предусловия | `BR-001`, `BR-002`, `BR-030` |
| Результат | `ASSIGNED → IN_PROGRESS` |
| Событие | `WorkCardStarted` |

### `CompleteWorkCard`

| Поле | Спецификация |
|---|---|
| Инициатор | Назначенный исполнитель |
| Вход | `workCardId`, `expectedVersion` |
| Предусловия | `BR-001`, `BR-002`, `BR-031` |
| Результат | `IN_PROGRESS → COMPLETED` |
| Событие | `WorkCardCompleted` |

## Команды контроля

### `ConfirmWorkCardByMaster`

| Поле | Спецификация |
|---|---|
| Инициатор | Мастер |
| Вход | `workCardId`, `expectedVersion` |
| Предусловия | `BR-001`, `BR-002`, `BR-032` |
| Результат | `COMPLETED → MASTER_CONFIRMED` |
| Событие | `WorkCardMasterConfirmed` |

### `ConfirmWorkCardQuality`

| Поле | Спецификация |
|---|---|
| Инициатор | Контролёр БТК |
| Вход | `workCardId`, `expectedVersion` |
| Предусловия | `BR-001`, `BR-002`, `BR-033`–`BR-035` |
| Результат | Положительное подтверждение качества и атомарный переход `MASTER_CONFIRMED → CLOSED` |
| Событие | `WorkCardQualityConfirmed` с `resultingStatus: CLOSED` |

Отдельной команды `RejectWorkCardQuality` или `CloseWorkCard` в MVP v1 нет. Отклонение относится к итерации 2, а закрытие является результатом положительного подтверждения БТК.

## Команда mock payroll

### `ExportWorkCardToPayroll`

| Поле | Спецификация |
|---|---|
| Инициатор | Администратор / аудитор |
| Вход | `workCardId`, `expectedVersion` карточки |
| Предусловия | `BR-001`, `BR-002`, `BR-040`–`BR-044` |
| Первый результат | Создана одна `PayrollRecord` и возвращена вызывающему коду |
| Повторный результат | Возвращена существующая `PayrollRecord`; новое событие не создаётся |
| Событие при первом успехе | `WorkCardExportedToPayroll` |

## Запросы, не являющиеся командами

| Запрос | Кто использует | Побочный эффект |
|---|---|---|
| `GetProductionBatch` / `ListProductionBatches` | Авторизованные demo-роли | Нет |
| `GetWorkCard` / `ListWorkCards` | Авторизованные demo-роли | Нет |
| `GetWorkCardHistory` | Администратор / аудитор | Нет |
| `GetPayrollRecord` | Администратор / аудитор | Нет |

Запросы не изменяют версии агрегатов и не создают доменные события.

## Каталог событий

| Событие | Агрегат | Минимальные предметные данные |
|---|---|---|
| `ProductionBatchCreated` | `ProductionBatch` | `batchId`, `quantity`, `route`, `normHours` |
| `ProductionBatchReleased` | `ProductionBatch` | `batchId`, `workCardSetId`, `cardCount` |
| `WorkCardSetCreated` | `WorkCardSet` | `workCardSetId`, `batchId`, `plannedQuantity` |
| `WorkCardReleased` | `WorkCard` | `workCardId`, `workCardSetId`, `sequenceNumber`, `status` |
| `WorkCardAssigned` | `WorkCard` | `workCardId`, `assigneeId`, `status` |
| `WorkCardStarted` | `WorkCard` | `workCardId`, `assigneeId`, `status` |
| `WorkCardCompleted` | `WorkCard` | `workCardId`, `assigneeId`, `status` |
| `WorkCardMasterConfirmed` | `WorkCard` | `workCardId`, `masterId`, `status` |
| `WorkCardQualityConfirmed` | `WorkCard` | `workCardId`, `controllerId`, `resultingStatus: CLOSED` |
| `WorkCardExportedToPayroll` | `PayrollRecord` | `payrollRecordId`, `workCardId`, `beneficiaryId`, `normHours` |

## Оболочка события

Каждое сохраняемое событие содержит как минимум:

| Поле | Назначение |
|---|---|
| `eventId` | Уникальный ID события |
| `eventType` | Имя из каталога событий |
| `occurredAt` | Серверное время UTC |
| `aggregateType`, `aggregateId` | Источник предметного изменения |
| `aggregateVersion` | Версия после успешного изменения |
| `actorId`, `actorRole` | Субъект команды |
| `commandId` | Связь события с исходной командой |
| `correlationId` | Объединение событий одной массовой или сквозной операции |
| `data` | Типизированные данные конкретного события |

События неизменяемы и сохраняются согласно `BR-050`–`BR-053`. Они описывают факт, но не заменяют текущую модель данных и не означают использование event sourcing.
