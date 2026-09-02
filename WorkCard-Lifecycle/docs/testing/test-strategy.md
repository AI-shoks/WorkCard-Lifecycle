---
artifact_id: testing.strategy
status: active
version: 2
owner: quality
updated: 2026-09-02
---

# Test Strategy

Артефакт этапа 9: уровни тестов, критические инварианты, permissions, state machine, миграции, безопасность и производительность.

## Покрытие backend vertical slice

До полного этапа 9 backend integration suite уже автоматизирует критический vertical slice отдельной финальной приёмки партии:

| Test ID | Уровень | Цель |
|---|---|---|
| `T-DOM-FINAL-BATCH-001` | domain | Completion predicate и единственность неизменяемой записи. |
| `T-API-FINAL-BATCH-PREMATURE-001` | integration | Pending gate, неполный комплект или незакрытая WorkCard запрещают команду. |
| `T-API-FINAL-BATCH-IDEMPOTENCY-001` | integration | Replay того же command ID возвращает прежний результат; новый command не создаёт дубль. |
| `T-API-FINAL-BATCH-CONFLICT-001` | integration | Устаревший `expectedVersion` не меняет партию. |
| `T-API-FINAL-BATCH-TXN-001` | integration | Acceptance, партия и audit event фиксируются атомарно. |
| `T-API-FINAL-BATCH-PERMISSION-001` | integration | Команда разрешена только `QUALITY_CONTROLLER`. |
| `T-API-FINAL-BATCH-READ-001` | integration | Read-back неизменяем и не имеет побочного эффекта. |
| `T-API-SECURITY-ORDER` | integration | Session, role и Origin/CSRF выполняются до schema validation; rejected commands не оставляют state/event/receipt. |
| `T-API-E2E-SMALL` | integration | Компактная fixture проходит создание, выпуск, first article, serial lifecycle/quality, final acceptance, payroll и audit/read-back только HTTP-командами. |
| `T-E2E-FINAL-BATCH-001` | browser | Happy path показывает отдельное действие и actor/time/ID после all-closed state. |

Текущий `workflow.integration.test.ts` содержит 5 тестов. Масштабный сценарий проверяет `3 sets / 250 cards / 254 release events`, `60 + 52`, concurrent assignment, replay и полноту audit; перед финальной приёмкой оставшееся массовое CLOSED-состояние в нём готовится owner-SQL и поэтому не объявляется API-only доказательством всех 250 lifecycle-переходов. Отдельный компактный сценарий из двух карточек выполняет каждый заявленный переход через HTTP API, включая final acceptance, payroll и read-back. Остальные проверки покрывают permission/order, CSRF/Origin без side effect, competing final commands, concurrent payroll export и runtime immutable grants.

Этап 9 расширит это покрытие отдельными fault-injection migration/rollback tests, включая доказательство отката при принудительной ошибке audit insert, а также security/performance checks и browser E2E. Наличие backend suite не считается завершением общего quality-этапа.
