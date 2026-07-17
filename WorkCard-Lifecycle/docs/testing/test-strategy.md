---
artifact_id: testing.strategy
status: planned
version: 0
owner: quality
updated: 2026-07-17
---

# Test Strategy

Артефакт этапа 9: уровни тестов, критические инварианты, permissions, state machine, миграции, безопасность и производительность.

## Предварительно зафиксированные future tests

До начала реализации этапа 9 матрица [[requirements-traceability]] уже объявляет обязательное покрытие отдельной финальной приёмки партии:

| Test ID | Уровень | Цель |
|---|---|---|
| `T-DOM-FINAL-BATCH-001` | domain | Completion predicate и единственность неизменяемой записи. |
| `T-API-FINAL-BATCH-PREMATURE-001` | integration | Pending gate, неполный комплект или незакрытая WorkCard запрещают команду. |
| `T-API-FINAL-BATCH-IDEMPOTENCY-001` | integration | Replay того же command ID возвращает прежний результат; новый command не создаёт дубль. |
| `T-API-FINAL-BATCH-CONFLICT-001` | integration | Устаревший `expectedVersion` не меняет партию. |
| `T-API-FINAL-BATCH-TXN-001` | integration | Acceptance, партия и audit event фиксируются атомарно. |
| `T-API-FINAL-BATCH-PERMISSION-001` | integration | Команда разрешена только `QUALITY_CONTROLLER`. |
| `T-API-FINAL-BATCH-READ-001` | integration | Read-back неизменяем и не имеет побочного эффекта. |
| `T-E2E-FINAL-BATCH-001` | browser | Happy path показывает отдельное действие и actor/time/ID после all-closed state. |

Это цели будущей автоматизации, а не утверждение о наличии backend/frontend тестов в текущем checkout.
