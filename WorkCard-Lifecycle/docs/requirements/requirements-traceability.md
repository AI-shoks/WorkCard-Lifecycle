---
artifact_id: requirements.traceability
status: accepted
version: 6
owner: requirements
updated: 2026-09-05
---

# Requirements Traceability

Сквозная матрица: Evidence → Decision → BR → UC → US → AC → Future Test. Test IDs — объявленные цели покрытия, а не утверждение о реализации. `N/A` используется только с явным объяснением неприменимости звена.

## Обозначения

| Префикс | Уровень |
|---|---|
| `T-DOM-*` | domain/state/gate unit test |
| `T-API-*` | backend/DB/permission/transaction integration test |
| `T-E2E-*` | browser scenario |

## Матрица функций MVP

| Функция | Evidence | Decision | BR | UC | US | AC | Future Test |
|---|---|---|---|---|---|---|---|
| ПДБ выбирает подготовленный паспорт | `ASIS-006` | `D-016` | `BR-001`, `BR-010`, `BR-011` | `UC-001` | `US-001` | `AC-BAT-001`, `AC-AUT-001` | `T-DOM-BATCH-001`, `T-API-BATCH-001`, `T-E2E-LIFECYCLE-001` |
| Партия имеет много комплектов | `ASIS-003` | `D-014` | `BR-012`–`BR-016` | `UC-002` | `US-002`, `US-013` | `AC-BAT-002`, `AC-BAT-003`, `AC-TXN-001` | `T-DOM-RELEASE-001`, `T-API-RELEASE-001`, `T-API-FIXTURE-112-001` |
| UUID без номера детали | `ASIS-001`, `ASIS-002` | `D-014` | `BR-004`, `BR-014`, `BR-015` | `UC-002`, `UC-011` | `US-013`, `US-018` | `AC-BAT-002`, `AC-READ-002` | `T-DOM-CARD-ID-001`, `T-API-READ-002`, `T-E2E-NO-SEQUENCE-001` |
| Норма operation scope | `ASIS-004` | `D-014`, `D-016` | `BR-011`, `BR-013`, `BR-015` | `UC-002`, `UC-007`, `UC-011` | `US-002`, `US-018` | `AC-BAT-002`, `AC-READ-002`, `AC-PAY-005` | `T-DOM-NORM-001`, `T-API-SNAPSHOT-001` |
| First-article/serial assignment | `ASIS-007`, `ASIS-008` | `D-015`, `D-017`, `D-018` | `BR-020`–`BR-025`, `BR-062` | `UC-003` | `US-003`, `US-012` | `AC-ASG-001`–`AC-ASG-003`, `AC-TXN-001` | `T-DOM-ASSIGN-001`, `T-API-ASSIGN-001`, `T-API-DISTRIBUTION-112-001` |
| Мастер фиксирует start | `ASIS-007` | `D-017` | `BR-030` | `UC-004` | `US-004` | `AC-LIF-001`, `AC-AUT-002` | `T-DOM-STATE-001`, `T-API-MASTER-001`, `T-API-WORKER-DENY-001` |
| Мастер фиксирует complete/закрытие нормированных часов | `ASIS-007` | `D-017` | `BR-031` | `UC-004` | `US-005` | `AC-LIF-002`, `AC-AUT-002` | `T-DOM-STATE-002`, `T-API-MASTER-002`, `T-API-WORKER-DENY-002` |
| Первая приёмка до серии | `ASIS-005` | `D-015` | `BR-021`, `BR-030`, `BR-032`, `BR-036` | `UC-005` | `US-006` | `AC-LIF-003`, `AC-LIF-005` | `T-DOM-GATE-001`, `T-API-FIRST-ARTICLE-001`, `T-E2E-FIRST-ARTICLE-001` |
| Самоконтроль исполнителя в серии | `ASIS-009` | `D-017`, `D-020` | `BR-036` | `UC-007` — проверка provenance, отдельная команда неприменима | `US-018` | `AC-READ-002` | `T-E2E-PROVENANCE-001` |
| Отдельная цифровая финальная приёмка всей партии | `ASIS-010`, `ASIS-011` | `D-021` | `BR-036`–`BR-039` | `UC-015` | `US-021` | `AC-FBA-001`–`AC-FBA-007` | `T-DOM-FINAL-BATCH-001`, `T-API-FINAL-BATCH-PREMATURE-001`, `T-API-FINAL-BATCH-IDEMPOTENCY-001`, `T-API-FINAL-BATCH-CONFLICT-001`, `T-API-FINAL-BATCH-TXN-001`, `T-API-FINAL-BATCH-PERMISSION-001`, `T-API-FINAL-BATCH-READ-001`, `T-E2E-FINAL-BATCH-001` |
| Синтетическое per-card закрытие | `ASIS-010`, `ASIS-011` — связанный контрольный контекст, не прямая копия | `D-009`, `D-020` | `BR-033`–`BR-036` | `UC-006` | `US-007` | `AC-LIF-004`, `AC-LIF-005`, `AC-READ-002` | `T-DOM-STATE-003`, `T-API-QUALITY-001`, `T-E2E-PROVENANCE-001` |
| Read-only structure/provenance | `ASIS-001`–`ASIS-011` | `D-013`, `D-020` | `BR-004`, `BR-011`–`BR-016`, `BR-036` | `UC-007`, `UC-011` | `US-008`, `US-013`, `US-018` | `AC-READ-001`, `AC-READ-002` | `T-API-READ-001`, `T-E2E-STRUCTURE-112-001`, `T-E2E-PROVENANCE-001` |
| Audit каждой успешной команды | `N/A` — техническое свойство TO-BE | `D-011`, `D-021` | `BR-050`–`BR-053` | `UC-008`, `UC-014`, `UC-015` | `US-009`, `US-017`, `US-020`, `US-021` | `AC-AUD-001`–`AC-AUD-004`, `AC-FBA-005` | `T-API-AUDIT-001`–`004`, `T-API-FINAL-BATCH-TXN-001`, `T-E2E-AUDIT-001` |
| Первый mock payroll export | `ASIS-004`, `ASIS-007` | `D-009` | `BR-040`, `BR-042`, `BR-044` | `UC-009` | `US-010` | `AC-PAY-001`, `AC-PAY-003`, `AC-PAY-005` | `T-DOM-PAYROLL-001`, `T-API-PAYROLL-001`, `T-E2E-PAYROLL-001` |
| Идемпотентный/конкурентный export | `N/A` — техническое свойство mock-интеграции | `N/A` — задано непосредственно `BR-041`, `BR-043` | `BR-041`, `BR-043` | `UC-009` | `US-011` | `AC-PAY-002`, `AC-PAY-004` | `T-DOM-PAYROLL-002`, `T-API-PAYROLL-002`, `T-API-PAYROLL-003` |
| Optimistic concurrency | `N/A` — техническое свойство TO-BE | `D-011`, `D-021` | `BR-002`, `BR-060`–`BR-062` | `UC-002`–`UC-006`, `UC-009`, `UC-012`, `UC-015` | `US-012`, `US-015`, `US-019`, `US-021` | `AC-CON-001`, `AC-CON-002`, `AC-TXN-001`, `AC-FBA-004` | `T-API-CONCURRENCY-001`–`003`, `T-API-FINAL-BATCH-CONFLICT-001`, `T-E2E-CONFLICT-001` |
| Trusted permissions | `ASIS-006`, `ASIS-007`, `ASIS-010` | `D-012`, `D-016`, `D-017`, `D-021` | `BR-001`, `BR-037` | `UC-001`–`UC-006`, `UC-008`, `UC-009`, `UC-015` | `US-001`–`US-012`, `US-021` | `AC-AUT-001`–`AC-AUT-003`, `AC-FBA-006` | `T-API-PERMISSION-001`–`006`, `T-API-FINAL-BATCH-PERMISSION-001` |
| Demo role switch | `N/A` — демонстрационная механика | `D-012` | `N/A` — identity model, не бизнес-инвариант | `UC-010` | `US-014` | `AC-DEM-001` | `T-API-DEMO-001`, `T-E2E-ROLE-SWITCH-001` |
| Payroll read | `ASIS-004`, `ASIS-007` | `D-009` | `BR-041`–`BR-044` | `UC-013` | `US-016` | `AC-READ-003`, `AC-PAY-005` | `T-API-PAYROLL-READ-001` |

## Покрытие команд и событий

| Команда | Успешные события | Позитивный criterion | Обязательные отказы |
|---|---|---|---|
| `CreateProductionBatch` | `ProductionBatchCreated` | `AC-BAT-001` | `NS-001`, `NS-002`, `NS-023`–`NS-025`, `NS-030`, `NS-033`, `NS-034` |
| `ReleaseWorkCards` | `ProductionBatchReleased`, `WorkCardSetCreated`, `WorkCardReleased` | `AC-BAT-002` | `NS-002`–`NS-005`, `NS-023`–`NS-028`, `NS-030`, `NS-033`–`NS-035` |
| `AssignWorkCards` | `WorkCardAssigned`, optional `FirstArticleWorkCardSelected` | `AC-ASG-001` | `NS-002`, `NS-004`, `NS-006`–`NS-009`, `NS-023`–`NS-025`, `NS-029`, `NS-030`, `NS-033`–`NS-035` |
| `StartWorkCard` | `WorkCardStarted` | `AC-LIF-001` | `NS-002`, `NS-004`, `NS-010`, `NS-011`, `NS-013`, `NS-024` |
| `CompleteWorkCard` | `WorkCardCompleted` | `AC-LIF-002` | `NS-002`, `NS-004`, `NS-010`, `NS-012`, `NS-013`, `NS-024` |
| `AcceptFirstArticle` | `WorkCardQualityConfirmed`, `FirstArticleAccepted` | `AC-LIF-003` | `NS-002`, `NS-004`, `NS-014`, `NS-015`, `NS-018`, `NS-023`, `NS-035` |
| `ConfirmWorkCardQuality` | `WorkCardQualityConfirmed` | `AC-LIF-004` | `NS-002`, `NS-004`, `NS-016`–`NS-018`, `NS-024` |
| `RecordFinalBatchAcceptance` | `FinalBatchAccepted` | `AC-FBA-001`, `AC-FBA-003` | `NS-002`, `NS-004`, `NS-023`, `NS-041`–`NS-045` |
| `ExportWorkCardToPayroll` | `WorkCardExportedToPayroll` при первом успехе | `AC-PAY-001`, `AC-PAY-002`, `AC-PAY-004` | `NS-002`, `NS-004`, `NS-020`, `NS-021`, `NS-023`–`NS-025`, `NS-037`–`NS-040` |

## Полнота правил

| Диапазон | Criteria и negative scenarios |
|---|---|
| `BR-001`–`BR-004` | `AC-AUT-001`, `AC-AUT-002`, `AC-CON-001`, `AC-TXN-001`; `NS-002`, `NS-004`, `NS-022`–`NS-024` |
| `BR-010`–`BR-016` | `AC-BAT-001`–`003`, `AC-READ-002`; `NS-001`, `NS-003`, `NS-005`, `NS-026`–`NS-028` |
| `BR-020`–`BR-025` | `AC-ASG-001`–`003`; `NS-006`–`NS-009`, `NS-029` |
| `BR-030`–`BR-035` | `AC-LIF-001`–`005`, `AC-AUT-002`; `NS-010`–`NS-018` |
| `BR-036`–`BR-039` | `AC-READ-002`, `AC-FBA-001`–`007`; `NS-041`–`NS-045` |
| `BR-040`–`BR-044` | `AC-PAY-001`–`005`, `AC-READ-003`; `NS-020`, `NS-021`, `NS-037`–`NS-040` |
| `BR-050`–`BR-053` | `AC-AUD-001`–`004`, `AC-TXN-001`; `NS-023`, `NS-030`, `NS-033`–`NS-036` |
| `BR-060`–`BR-062` | `AC-CON-001`, `AC-CON-002`, `AC-TXN-001`; `NS-004`, `NS-008`, `NS-030` |

## Покрытие продуктовых обязательств

| Обязательство | Evidence | Decision | BR | UC | US | AC | Future Test |
|---|---|---|---|---|---|---|---|
| `112 → 3 комплекта → 250 карточек` | `N/A` — синтетический demo-fixture, не факт AS-IS | `D-014`, `D-018`, `D-024` | `BR-012`–`BR-014` | `UC-002`, `UC-011` | `US-002`, `US-013` | `AC-BAT-002`, `AC-READ-002` | `T-API-FIXTURE-112-001` |
| Нет индивидуальной нумерации деталей | `ASIS-001`, `ASIS-002` | `D-014` | `BR-004`, `BR-014` | `UC-002`, `UC-011` | `US-013` | `AC-BAT-002`, `AC-READ-002` | `T-E2E-NO-SEQUENCE-001` |
| Operation-scoped нормы | `ASIS-004` | `D-014`, `D-016` | `BR-011`, `BR-013`, `BR-015` | `UC-002`, `UC-007`, `UC-011` | `US-002`, `US-018` | `AC-BAT-002`, `AC-READ-002`, `AC-PAY-005` | `T-DOM-NORM-001`, `T-API-SNAPSHOT-001` |
| Мастер ведёт и закрывает нормированные часы | `ASIS-007` | `D-017` | `BR-030`, `BR-031` | `UC-004` | `US-004`, `US-005` | `AC-LIF-001`, `AC-LIF-002`, `AC-AUT-002` | `T-API-MASTER-001`, `T-API-MASTER-002`, `T-API-WORKER-DENY-001`, `T-API-WORKER-DENY-002` |
| Распределение `60 + 52 = 112` | `ASIS-008` | `D-018` | `BR-020`–`BR-025` | `UC-003`, `UC-011` | `US-003`, `US-013` | `AC-ASG-001`, `AC-READ-002` | `T-API-DISTRIBUTION-112-001` |
| Первая приёмка | `ASIS-005` | `D-015` | `BR-021`, `BR-030`, `BR-032`, `BR-036` | `UC-005` | `US-006` | `AC-LIF-003`, `AC-LIF-005` | `T-E2E-FIRST-ARTICLE-001` |
| Отдельная цифровая финальная приёмка всей партии | `ASIS-010`, `ASIS-011` | `D-021` | `BR-036`–`BR-039` | `UC-015` | `US-021` | `AC-FBA-001`–`AC-FBA-007` | `T-DOM-FINAL-BATCH-001`, `T-API-FINAL-BATCH-PREMATURE-001`, `T-API-FINAL-BATCH-IDEMPOTENCY-001`, `T-API-FINAL-BATCH-CONFLICT-001`, `T-API-FINAL-BATCH-TXN-001`, `T-API-FINAL-BATCH-PERMISSION-001`, `T-API-FINAL-BATCH-READ-001`, `T-E2E-FINAL-BATCH-001` |
| Синтетическое per-card quality confirmation | `ASIS-010`, `ASIS-011` — контекст, не прямая копия | `D-009`, `D-020` | `BR-033`–`BR-036` | `UC-006` | `US-007` | `AC-LIF-004`, `AC-LIF-005`, `AC-READ-002` | `T-DOM-STATE-003`, `T-API-QUALITY-001`, `T-E2E-PROVENANCE-001` |

## Каталог future tests для скорректированных обязательств

| Test ID | Будущая проверка |
|---|---|
| `T-E2E-NO-SEQUENCE-001` | UI не показывает карточки как детали `1..N`. |
| `T-DOM-NORM-001` | Норма принадлежит operation scope/комплекту. |
| `T-API-SNAPSHOT-001` | WorkCard получает norm snapshot своего комплекта. |
| `T-API-MASTER-001` | Start фиксирует `MASTER`. |
| `T-API-MASTER-002` | Complete фиксирует `MASTER`. |
| `T-API-WORKER-DENY-001` | `WORKER` не может вызвать start. |
| `T-API-WORKER-DENY-002` | `WORKER` не может вызвать complete. |
| `T-API-DISTRIBUTION-112-001` | Назначения дают `1 + 59 + 52 = 60 + 52 = 112` без ranges. |
| `T-E2E-FIRST-ARTICLE-001` | Первая приёмка открывает serial gate. |
| `T-DOM-STATE-003` | Per-card confirmation закрывает только одну WorkCard. |
| `T-API-QUALITY-001` | API не создаёт `FinalBatchAcceptance` при `ConfirmWorkCardQuality`. |
| `T-E2E-PROVENANCE-001` | UX различает first piece, финальную приёмку всей партии и synthetic per-card close. |
| `T-DOM-FINAL-BATCH-001` | Только завершённая партия создаёт одну неизменяемую `FinalBatchAcceptance`. |
| `T-API-FINAL-BATCH-PREMATURE-001` | Незакрытая обязательная карточка или pending gate запрещают финальную приёмку. |
| `T-API-FINAL-BATCH-IDEMPOTENCY-001` | Replay того же `commandId` не создаёт вторую запись/версию/событие; новый command после успеха отклоняется. |
| `T-API-FINAL-BATCH-CONFLICT-001` | Устаревшая версия партии отклоняет команду без эффекта. |
| `T-API-FINAL-BATCH-TXN-001` | Запись, партия и `FinalBatchAccepted` сохраняются или откатываются вместе. |
| `T-API-FINAL-BATCH-PERMISSION-001` | Только `QUALITY_CONTROLLER` может выполнить команду. |
| `T-API-FINAL-BATCH-READ-001` | Read-back возвращает acceptance ID, актора, время, command ID и результирующую версию без побочного эффекта. |
| `T-E2E-FINAL-BATCH-001` | После all-closed summary БТК отдельно принимает партию, а UI показывает actor/time/ID и не называет запись физической подписью. |

## Правило сопровождения

Изменение AS-IS сначала обновляет [[decision-provenance]] и решения, затем scope, правила, обе стороны этой матрицы, UX и тесты. Строка о будущем тесте не является доказательством его реализации.
