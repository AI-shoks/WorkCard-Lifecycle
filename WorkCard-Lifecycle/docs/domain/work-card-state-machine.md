---
artifact_id: domain.work-card-state-machine
status: accepted
version: 3
owner: domain
updated: 2026-07-17
---

# WorkCard State Machine

Канонический автомат `WorkCard` и связанный first-article gate `WorkCardSet`. Мастер фиксирует выполнение; назначенный исполнитель не отправляет lifecycle-команды. `WorkCardId` не является номером детали, а `CLOSED` не является финальной приёмкой всей партии.

## Диаграмма карточки

```mermaid
stateDiagram-v2
    [*] --> RELEASED: ReleaseWorkCards
    RELEASED --> ASSIGNED: AssignWorkCards
    ASSIGNED --> IN_PROGRESS: StartWorkCard / MASTER
    IN_PROGRESS --> COMPLETED: CompleteWorkCard / MASTER
    COMPLETED --> CLOSED: AcceptFirstArticle / QUALITY_CONTROLLER
    COMPLETED --> CLOSED: ConfirmWorkCardQuality / QUALITY_CONTROLLER
    CLOSED --> [*]

    note right of COMPLETED
      First-article card uses AcceptFirstArticle.
      Serial card uses synthetic per-card
      ConfirmWorkCardQuality.
      Neither transition records FinalBatchAcceptance.
    end note
```

## Gate комплекта

```mermaid
stateDiagram-v2
    [*] --> FIRST_ARTICLE_PENDING: ReleaseWorkCards
    FIRST_ARTICLE_PENDING --> SERIAL_ALLOWED: AcceptFirstArticle
    SERIAL_ALLOWED --> [*]
```

При `FIRST_ARTICLE_PENDING` комплект может зарегистрировать и провести только одну first-article карточку. Остальные serial-карточки не назначаются и не запускаются до `SERIAL_ALLOWED`.

## Состояния карточки

| Состояние | Значение | Обязательные данные |
|---|---|---|
| `RELEASED` | Внутренняя карточка выпущена в operation-scoped комплекте, но не назначена. | UUID, set/batch, `batchQuantitySnapshot`, operation/norm snapshots |
| `ASSIGNED` | Мастер назначил карточку исполнителю и зафиксировал purpose. | `assigneeId`, `FIRST_ARTICLE | SERIAL` |
| `IN_PROGRESS` | Мастер зафиксировал начало назначенной работы. | assignee, субъект/время старта |
| `COMPLETED` | Мастер зафиксировал завершение; требуется положительное действие БТК. | assignee, субъект/время завершения |
| `CLOSED` | First-article gate пройден либо отдельная serial WorkCard цифрово закрыта синтетическим per-card подтверждением. | тип цифрового действия, субъект/время закрытия; финальная приёмка партии не выводится |

Состояния `MASTER_CONFIRMED` нет: отдельное подтверждение мастера дублировало бы факт, который уже фиксирует мастер командой `CompleteWorkCard`.

## Переходы

| Из | Команда | Роль и ограничение | В | События | Правила |
|---|---|---|---|---|---|
| создание | `ReleaseWorkCards` | `PLANNER`, атомарный выпуск всех комплектов | `RELEASED` | `WorkCardReleased` | `BR-012`–`BR-016` |
| `RELEASED` | `AssignWorkCards` | `MASTER`; first article или открытый serial gate | `ASSIGNED` | `WorkCardAssigned` | `BR-020`–`BR-024` |
| `ASSIGNED` | `StartWorkCard` | `MASTER`; gate соответствует purpose | `IN_PROGRESS` | `WorkCardStarted` | `BR-030` |
| `IN_PROGRESS` | `CompleteWorkCard` | `MASTER` | `COMPLETED` | `WorkCardCompleted` | `BR-031` |
| `COMPLETED` | `AcceptFirstArticle` | БТК; зарегистрированная first-article карточка и pending gate | `CLOSED` | `WorkCardQualityConfirmed`, `FirstArticleAccepted` | `BR-032` |
| `COMPLETED` | `ConfirmWorkCardQuality` | БТК; serial-карточка и `SERIAL_ALLOWED`; per-card `TO_BE_DECISION` | `CLOSED` | `WorkCardQualityConfirmed` | `BR-033`–`BR-036` |

## Граница финальной приёмки

`FinalBatchAcceptance` — отдельный подтверждённый AS-IS-факт после завершения всей партии, сопровождаемый подписями БТК на физических карточках. Он не является состоянием этой state machine. Закрытие одной или всех WorkCard не создаёт финальную приёмку неявно.

## Универсальные проверки

1. backend устанавливает доверенную роль;
2. загружает карточку и, когда требуется, комплект;
3. проверяет точные роли, purpose, gate и исходное состояние;
4. сверяет версии всех изменяемых агрегатов;
5. применяет изменение, увеличивает версии и сохраняет полный набор audit events одной транзакцией.

Отказ не создаёт состояние или событие успеха по `BR-001`–`BR-003`, `BR-050`–`BR-062`.

## Запрещённые переходы MVP

- lifecycle-команда от `WORKER`, `PLANNER` или `ADMIN_AUDITOR`;
- serial assignment/start до first-article acceptance;
- более одной first-article карточки комплекта;
- завершение без начала;
- положительное действие БТК до `COMPLETED` или не для соответствующего purpose/gate;
- любое изменение после `CLOSED`;
- возврат, отклонение, `REWORK_REQUIRED`, переназначение и повторный выпуск.

## Mock payroll

`ExportWorkCardToPayroll` разрешён только для `CLOSED`, но не является переходом. Факт первого export хранится в `PayrollRecord`; повтор идемпотентен.
