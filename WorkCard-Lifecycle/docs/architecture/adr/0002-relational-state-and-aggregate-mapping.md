---
artifact_id: architecture.adr.0002
status: accepted
version: 1
owner: architecture
updated: 2026-07-18
---

# ADR-0002: Relational current state and aggregate mapping

## Статус

Принято 2026-07-18.

## Контекст

[[domain-model]] определяет несколько агрегатов, immutable snapshots и отдельный audit. Current state нужен для browser/API reads; audit не должен становиться event sourcing. Критические связи и уникальность должны быть видимы до реализации.

## Варианты

1. PostgreSQL current-state tables + append-only audit table.
2. Event-sourced aggregates с projections.
3. Document database с вложенной партией/комплектами/карточками.
4. ORM-generated schema как единственный источник физической модели.

## Решение

Принять вариант 1 и explicit SQL migrations по [[er-model]]. `ProductionBatch`, `WorkCardSet` и `WorkCard` хранятся отдельными current-state rows; `FinalBatchAcceptance` и `PayrollRecord` — отдельные immutable rows. FK/check/unique/partial indexes дополняют domain services.

`ProductionBatch 1 → many WorkCardSet`, operation-scoped norms, UUID без sequence и отдельная final acceptance сохраняются буквально. Aggregate relationships читаются по FK; массивы дочерних ID не дублируются в mutable JSON. Audit хранит факты, но state читается из business tables.

## Последствия

- joins и completion queries естественны для PostgreSQL;
- схема явно защищает one acceptance per batch и one payroll row per card;
- snapshots требуют schema validation, потому что часть данных хранится JSONB;
- переходы/permissions нельзя доказать одними constraints: domain/application tests остаются обязательными;
- ORM можно добавить только как query convenience, не как скрытый владелец migrations/locks.

## Проверка

- schema не содержит `sequenceNumber`, physical part или batch norm;
- fixture `112 → 112 + 112 + 26 = 250` проходит DB integration test;
- `250 CLOSED` без acceptance row не меняет batch на `FINAL_ACCEPTED`.
