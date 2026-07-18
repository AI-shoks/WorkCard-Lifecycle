---
artifact_id: architecture.adr.0005
status: accepted
version: 1
owner: architecture
updated: 2026-07-18
---

# ADR-0005: Command replay and local mock payroll

## Статус

Принято 2026-07-18.

## Контекст

Network timeout может скрыть успешный commit; final acceptance требует replay того же `commandId`, а payroll — одну запись даже при новом/concurrent request. Реального payroll endpoint нет, и сетевой mock разрушил бы заявленную атомарность без продуктовой ценности.

## Варианты

1. Transactional command receipts + unique business keys + local PostgreSQL payroll adapter.
2. Полагаться только на UI disable.
3. Отдельный HTTP mock payroll service.
4. Общая автоматическая retry policy для всех conflicts.

## Решение

Принять вариант 1. Каждая successful command сохраняет receipt с unique `commandId`, canonical request hash, correlation и result reference. Final-acceptance replay того же ID/body возвращает исходный result. Payroll дополнительно имеет unique `workCardId`; local adapter сохраняет immutable `PayrollRecord` и event в одной transaction.

Обычные state conflicts не ретраятся автоматически. Новый command после terminal final acceptance отклоняется. Реальная network integration отсутствует.

## Последствия

- ambiguous network result безопасно проверяется повтором того же ID;
- receipts требуют canonical hashing/versioned representation;
- payroll concurrency сходится к одной row/одному event;
- local mock честно не демонстрирует external delivery/reconciliation;
- реальный adapter потребует outbox, delivery state, secrets и нового ADR/scope.

## Проверка

- same ID/different body conflict;
- final replay не меняет batch version/event count;
- concurrent payroll creates exactly one record/event;
- adapter не выполняет network I/O и не рассчитывает деньги.
