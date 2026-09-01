---
artifact_id: architecture.adr.0003
status: accepted
version: 1
owner: architecture
updated: 2026-09-01
---

# ADR-0003. PostgreSQL row locks, optimistic versions and transactional audit

## Контекст

Commands должны обнаруживать stale data, массовое назначение/выпуск — быть атомарными, final acceptance — читать завершённость согласованно, а audit — никогда не расходиться с состоянием.

## Варианты

1. `READ COMMITTED` + deterministic `FOR UPDATE` + explicit versions.
2. Только version predicate без locks.
3. Глобальный `SERIALIZABLE` с автоматическими retries.
4. In-memory mutex/API single instance.

## Решение

Использовать `READ COMMITTED`, row-level locks в порядке batch → sets → cards, expected versions и conditional updates. State, immutable result, receipt и events коммитятся одной PostgreSQL transaction. Audit runtime role получает append-only grants и immutability trigger.

## Причины

- locks дают согласованный completion predicate final acceptance;
- versions сохраняют явный пользовательский conflict contract;
- deterministic order снижает deadlock risk;
- correctness не зависит от числа API instances;
- `SERIALIZABLE` для всех запросов добавляет retry semantics без необходимости.

## Последствия

- repositories обязаны экспонировать transaction-scoped operations и raw locking SQL;
- UI делает manual refresh после `409` и не повторяет command автоматически;
- integration tests запускаются на реальной PostgreSQL, не SQLite;
- длинные пользовательские операции никогда не держат transaction: подтверждение происходит до POST, DB transaction короткая;
- детальный алгоритм и lock matrix — [[transactions-concurrency]].
