---
artifact_id: architecture.adr.0002
status: accepted
version: 1
owner: architecture
updated: 2026-09-01
---

# ADR-0002. Relational current state and explicit aggregate boundaries

## Контекст

[[domain-model]] уже принимает `ProductionBatch`, `WorkCardSet` и `WorkCard` как разные изменяемые roots. Некоторые команды координируют несколько roots, а audit нужен для истории, но требования не требуют replay состояния из событий.

## Варианты

1. Relational current-state tables + append-only audit.
2. Event sourcing как единственный источник состояния.
3. Один большой batch aggregate с 250 карточками внутри JSON/document row.
4. Раздельные databases по модулям.

## Решение

Хранить нормализованное текущее состояние в PostgreSQL по [[er-model]], snapshots — отдельными immutable columns/rows, audit — отдельной append-only таблицей. `ProductionBatch`, `WorkCardSet`, `WorkCard` остаются независимыми roots; межагрегатные application services используют одну DB transaction.

## Причины

- lifecycle reads просты и не требуют projection rebuild;
- массовая операция блокирует только затронутые rows;
- relational constraints защищают уникальную final acceptance/payroll record;
- JSON row всей партии создавал бы contention и ложное владение card lifecycle партией;
- event sourcing увеличил бы объём решений без продуктовой ценности MVP.

## Последствия

- audit не используется для восстановления current state;
- aggregate IDs/versions фиксируются в каждой таблице;
- snapshot duplication осознанна и защищает исторический контекст;
- cross-aggregate invariants принадлежат application service + transaction, не одному объекту;
- изменение принятых границ требует нового ADR и сверки с domain decisions `D-014`–`D-021`.
