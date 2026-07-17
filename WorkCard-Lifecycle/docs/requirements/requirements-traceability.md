---
artifact_id: requirements.traceability
status: accepted
version: 2
owner: requirements
updated: 2026-07-17
---

# Requirements Traceability

Сквозная матрица MVP v1: продуктовая граница → бизнес-правило → use case → user story → acceptance criterion → будущая автоматическая проверка. Тестовые ID в этом документе являются **целями покрытия**, а не утверждением, что тесты уже реализованы или проходят; фактический статус появится на этапе 9 в [[test-strategy]].

## Обозначения будущих тестов

| Префикс | Уровень проверки |
|---|---|
| `T-DOM-*` | модульная проверка доменного правила или state machine |
| `T-API-*` | интеграционная проверка backend, permissions, транзакции или БД |
| `T-E2E-*` | браузерный сквозной сценарий |

## Матрица функций MVP

| Scope / функция | Правила | Use case | Story | Acceptance criteria | Будущие тесты |
|---|---|---|---|---|---|
| Создание синтетической партии | `BR-001`, `BR-003`, `BR-004`, `BR-010`, `BR-011` | `UC-001` | `US-001` | `AC-BAT-001`, `AC-AUT-001`, `AC-AUD-001` | `T-DOM-BATCH-001`, `T-API-BATCH-001`, `T-E2E-LIFECYCLE-001` |
| Единственный выпуск комплекта | `BR-002`, `BR-012`, `BR-016`, `BR-060` | `UC-002` | `US-002`, `US-012` | `AC-BAT-002`, `AC-BAT-003`, `AC-CON-001` | `T-DOM-RELEASE-001`, `T-API-RELEASE-001`, `T-API-CONCURRENCY-001` |
| Ровно `N` уникальных карточек и снимки | `BR-013`–`BR-015` | `UC-002` | `US-002` | `AC-BAT-002`, `AC-TXN-001` | `T-API-RELEASE-002`, `T-API-RELEASE-003`, `T-E2E-LIFECYCLE-001` |
| Атомарное массовое назначение | `BR-020`–`BR-023`, `BR-062` | `UC-003` | `US-003`, `US-012` | `AC-ASG-001`, `AC-ASG-002`, `AC-TXN-001` | `T-DOM-ASSIGN-001`, `T-API-ASSIGN-001`, `T-API-ASSIGN-002` |
| Запрет переназначения | `BR-024` | `UC-003` | `US-003` | `AC-ASG-003` | `T-DOM-ASSIGN-002`, `T-API-ASSIGN-003` |
| Начало назначенной карточки | `BR-001`, `BR-002`, `BR-030` | `UC-004` | `US-004`, `US-012` | `AC-LIF-001`, `AC-AUT-002`, `AC-CON-001` | `T-DOM-STATE-001`, `T-API-WORKER-001`, `T-API-PERMISSION-001` |
| Завершение начатой карточки | `BR-001`, `BR-002`, `BR-031` | `UC-004` | `US-005`, `US-012` | `AC-LIF-002`, `AC-AUT-002`, `AC-CON-001` | `T-DOM-STATE-002`, `T-API-WORKER-002`, `T-API-PERMISSION-002` |
| Подтверждение мастером | `BR-001`, `BR-002`, `BR-032` | `UC-005` | `US-006`, `US-012` | `AC-LIF-003`, `AC-AUT-001`, `AC-CON-001` | `T-DOM-STATE-003`, `T-API-MASTER-001`, `T-API-PERMISSION-003` |
| Подтверждение БТК и закрытие | `BR-001`, `BR-002`, `BR-033`–`BR-035` | `UC-006` | `US-007`, `US-012` | `AC-LIF-004`, `AC-LIF-005`, `AC-AUT-001` | `T-DOM-STATE-004`, `T-DOM-STATE-005`, `T-API-QUALITY-001` |
| Просмотр партий и карточек | матрица чтения | `UC-007` | `US-008` | `AC-READ-001` | `T-API-READ-001`, `T-E2E-LIFECYCLE-001` |
| Audit log значимых действий | `BR-050`–`BR-053` | `UC-008` | `US-009`, `US-012` | `AC-AUD-001`, `AC-AUD-002`, `AC-AUT-003`, `AC-TXN-001` | `T-API-AUDIT-001`, `T-API-AUDIT-002`, `T-E2E-AUDIT-001` |
| Первый mock payroll export | `BR-040`, `BR-042`, `BR-044` | `UC-009` | `US-010` | `AC-PAY-001`, `AC-PAY-003`, `AC-PAY-005`, `AC-AUT-001` | `T-DOM-PAYROLL-001`, `T-API-PAYROLL-001`, `T-E2E-PAYROLL-001` |
| Защита от повторного и конкурентного export | `BR-041`, `BR-043` | `UC-009` | `US-011` | `AC-PAY-002`, `AC-PAY-004` | `T-DOM-PAYROLL-002`, `T-API-PAYROLL-002`, `T-API-PAYROLL-003`, `T-E2E-PAYROLL-002` |
| Optimistic concurrency | `BR-002`, `BR-060`, `BR-061`, `BR-062` | `UC-002`–`UC-006`, `UC-009` | `US-012` | `AC-CON-001`, `AC-TXN-001` | `T-API-CONCURRENCY-001`, `T-API-CONCURRENCY-002` |
| Backend permissions и доверенная роль | `BR-001` | `UC-001`–`UC-006`, `UC-008`, `UC-009` | `US-001`–`US-012` | `AC-AUT-001`–`AC-AUT-003` | `T-API-PERMISSION-001`–`T-API-PERMISSION-005` |
| Переключение доверенного demo-контекста | модель идентичности и ролей | `UC-010` | `US-014` | `AC-DEM-001`, `AC-AUT-001` | `T-API-DEMO-IDENTITY-001`, `T-E2E-ROLE-SWITCH-001` |
| Проверка полноты и происхождения выпуска | `BR-012`–`BR-015` | `UC-011` | `US-013`, `US-018` | `AC-BAT-002`, `AC-READ-002` | `T-API-READ-002`, `T-E2E-RELEASE-VERIFY-001` |
| Восстановление после конфликта | `BR-002`, `BR-060`, `BR-061` | `UC-012` | `US-015`, `US-019` | `AC-CON-001`, `AC-CON-002` | `T-API-CONCURRENCY-003`, `T-E2E-CONFLICT-RECOVERY-001` |
| Чтение существующей payroll-записи | `BR-041`–`BR-044` | `UC-013` | `US-016` | `AC-READ-003`, `AC-PAY-005`, `AC-AUT-003` | `T-API-PAYROLL-READ-001`, `T-E2E-PAYROLL-READ-001` |
| Корреляция событий массовой операции | `BR-050`–`BR-053` | `UC-014` | `US-017`, `US-020` | `AC-AUD-003`, `AC-AUD-004`, `AC-TXN-001` | `T-API-AUDIT-003`, `T-API-AUDIT-004` |

## Покрытие команд и событий

| Команда | Успешное событие | Позитивный критерий | Обязательные отказы |
|---|---|---|---|
| `CreateProductionBatch` | `ProductionBatchCreated` | `AC-BAT-001` | `NS-001`, `NS-002`, `NS-023`–`NS-025`, `NS-030`, `NS-033`, `NS-034` |
| `ReleaseWorkCards` | `ProductionBatchReleased`, `WorkCardSetCreated`, `WorkCardReleased` | `AC-BAT-002` | `NS-002`–`NS-005`, `NS-023`–`NS-028`, `NS-030`, `NS-033`–`NS-035` |
| `AssignWorkCards` | `WorkCardAssigned` | `AC-ASG-001` | `NS-002`, `NS-004`, `NS-006`–`NS-009`, `NS-023`–`NS-025`, `NS-029`, `NS-030`, `NS-033`–`NS-035` |
| `StartWorkCard` | `WorkCardStarted` | `AC-LIF-001` | `NS-002`, `NS-004`, `NS-010`, `NS-011`, `NS-013`, `NS-024` |
| `CompleteWorkCard` | `WorkCardCompleted` | `AC-LIF-002` | `NS-002`, `NS-004`, `NS-010`, `NS-012`, `NS-013`, `NS-024` |
| `ConfirmWorkCardByMaster` | `WorkCardMasterConfirmed` | `AC-LIF-003` | `NS-002`, `NS-004`, `NS-014`, `NS-015`, `NS-024` |
| `ConfirmWorkCardQuality` | `WorkCardQualityConfirmed` | `AC-LIF-004` | `NS-002`, `NS-004`, `NS-016`–`NS-018`, `NS-024` |
| `ExportWorkCardToPayroll` | `WorkCardExportedToPayroll` только при первом успехе | `AC-PAY-001`, `AC-PAY-002`, `AC-PAY-004`, `AC-PAY-005` | `NS-002`, `NS-004`, `NS-020`, `NS-021`, `NS-023`–`NS-025`, `NS-030`, `NS-033`–`NS-035`, `NS-037`–`NS-040` |

## Полнота бизнес-правил

| Диапазон | Где проверяется |
|---|---|
| `BR-001`–`BR-004` | `AC-AUT-001`, `AC-CON-001`, `AC-TXN-001`, `AC-BAT-001`; `NS-002`, `NS-004`, `NS-022`–`NS-024` |
| `BR-010`–`BR-016` | `AC-BAT-001`–`AC-BAT-003`, `AC-READ-002`, `AC-TXN-001`; `NS-001`, `NS-003`, `NS-005`, `NS-026`–`NS-028` |
| `BR-020`–`BR-024` | `AC-ASG-001`–`AC-ASG-003`, `AC-TXN-001`; `NS-006`–`NS-009`, `NS-029` |
| `BR-030`–`BR-035` | `AC-LIF-001`–`AC-LIF-005`, `AC-AUT-002`; `NS-010`–`NS-018` |
| `BR-040`–`BR-044` | `AC-PAY-001`–`AC-PAY-005`, `AC-READ-003`; `NS-020`, `NS-021`, `NS-037`–`NS-040` |
| `BR-050`–`BR-053` | `AC-AUD-001`–`AC-AUD-004`, `AC-TXN-001`; `NS-023`, `NS-030`, `NS-033`–`NS-036` |
| `BR-060`–`BR-062` | `AC-CON-001`, `AC-CON-002`, `AC-TXN-001`, `AC-BAT-002`, `AC-ASG-001`, `AC-AUD-004`; `NS-004`, `NS-008`, `NS-030` |

## Покрытие продуктовых обязательств

| Обязательство [[mvp-scope]] / [[success-criteria]] | Доказуемая цепочка |
|---|---|
| Полный happy path через браузер | `UC-001`–`UC-014` → `US-001`–`US-020` → позитивные и поддерживающие `AC-*` → `T-E2E-LIFECYCLE-001`, `T-E2E-AUDIT-001`, `T-E2E-PAYROLL-001`, `T-E2E-ROLE-SWITCH-001` |
| Ровно `N` уникальных карточек | `UC-002` → `US-002` → `AC-BAT-002` → `T-API-RELEASE-002` |
| Запрещённые действия скрыты в UI и отклонены API | [[negative-scenarios]] + `AC-AUT-001`–`AC-AUT-003` → `T-API-PERMISSION-*`; UI-проверки будут уточнены в [[permission-ux]] |
| Атомарное массовое назначение | `UC-003` → `US-003` → `AC-ASG-002`, `AC-TXN-001` → `T-API-ASSIGN-002` |
| Полная история действий | `UC-008` → `US-009` → `AC-AUD-001`, `AC-AUD-002` → `T-E2E-AUDIT-001` |
| Единственная запись начисления | `UC-009`, `UC-013` → `US-010`, `US-011`, `US-016` → `AC-PAY-001`–`AC-PAY-005`, `AC-READ-003` → `T-E2E-PAYROLL-001`, `T-E2E-PAYROLL-002` |
| Конфликты не перезаписываются молча | `UC-012` → `US-012`, `US-015`, `US-019` → `AC-CON-001`, `AC-CON-002` → `T-API-CONCURRENCY-001`–`T-API-CONCURRENCY-003` |
| События массовой операции коррелированы | `UC-014` → `US-017`, `US-020` → `AC-AUD-003`, `AC-AUD-004` → `T-API-AUDIT-003`, `T-API-AUDIT-004` |

## Правило сопровождения

При изменении принятого scope или бизнес-правила владелец требований обязан обновить существующие канонические файлы, увеличить их версии и проверить обе стороны цепочки. Реализованный тест считается доказательством только после появления в тестовом коде и отражения фактического статуса в [[test-strategy]]; сама строка этой матрицы доказательством не является.
