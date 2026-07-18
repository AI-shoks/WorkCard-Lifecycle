---
artifact_id: architecture.adr.0003
status: accepted
version: 1
owner: architecture
updated: 2026-07-18
---

# ADR-0003: Optimistic concurrency and transaction boundaries

## Статус

Принято 2026-07-18.

## Контекст

Команды меняют от одного до сотен агрегатов. Нельзя молча перезаписывать stale UI или оставлять частичный assignment/release/audit. Final acceptance должна проверить большой completion predicate в согласованном состоянии.

## Варианты

1. Client `expectedVersion` + conditional updates + ordered row locks; `SERIALIZABLE` для final acceptance.
2. Last-write-wins.
3. Глобальная application mutex.
4. Pessimistic locks на время пользовательского редактирования.

## Решение

Принять вариант 1 по [[transactions-concurrency]]. Каждая changed aggregate version увеличивается ровно на один. Межагрегатные команды блокируют rows в порядке batch → sets → cards; mass operations валидируют весь набор до изменений. Final acceptance использует `SERIALIZABLE` transaction, batch lock, completion aggregate query и unique acceptance key.

DB serialization/deadlock failure возвращается как conflict без скрытого business retry. SPA перечитывает состояние и требует новое осознанное подтверждение.

## Последствия

- stale requests имеют явный `409` и нулевой side effect;
- transaction может содержать `250` inserts/events, что приемлемо для MVP и проверяется тестом;
- lock order и batch limits становятся обязательным code-review gate;
- higher contention требует измерения до изменения isolation/partitioning;
- read-only gate versions могут проверяться без version increment.

## Проверка

- concurrent assignment/final acceptance/payroll tests;
- injected failure между state и audit всегда откатывает transaction;
- final acceptance не меняет set/card versions;
- client не повторяет version-conflicted command автоматически.
