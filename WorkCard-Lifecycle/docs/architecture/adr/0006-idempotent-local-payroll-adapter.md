---
artifact_id: architecture.adr.0006
status: superseded
version: 2
owner: architecture
updated: 2026-09-27
superseded_by: "[[0010-pg-sql-and-local-payroll-service]]"
---

# ADR-0006. Idempotent local payroll adapter

## Контекст

MVP должен показать передачу operation-scoped нормы и защиту от двойного export, но не подключается к расчётной системе и не рассчитывает деньги.

## Варианты

1. Application port + локальный PostgreSQL mock adapter.
2. Fake внешний HTTP endpoint.
3. Запись JSON-файла.
4. Реальная payroll integration.

## Решение

`PayrollExportService` вызывает `PayrollPort`; MVP adapter вставляет immutable `payroll_records` в той же transaction, что receipt и audit event. `work_card_id` — unique business idempotency key.

## Причины

- атомарность проверяется без ложного сетевого side effect;
- уникальный constraint доказывает защиту от double export;
- interface сохраняет архитектурную границу будущего provider;
- file/HTTP fake слабее воспроизводит concurrency и transaction failure.

## Последствия

- UI всегда маркирует record как демонстрационную;
- повтор возвращает существующую запись без event/version;
- в schema нет денег/налогов/выплат;
- реальная интеграция потребует outbox, delivery/reconciliation, secrets и нового ADR;
- прямой внешний HTTP внутри текущей DB transaction запрещён.
