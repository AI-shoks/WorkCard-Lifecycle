---
artifact_id: architecture.adr-index
status: active
version: 2
owner: architecture
updated: 2026-09-01
aliases:
  - adr-index
---

# ADR Index

Архитектурные решения создаются отдельными файлами `NNNN-short-title.md`.

## Формат

- статус;
- контекст;
- варианты;
- решение;
- последствия.

## Решения этапа 5

| ADR | Статус | Решение |
|---|---|---|
| [[0001-typescript-modular-monolith-stack|ADR-0001]] | accepted | TypeScript modular monolith stack |
| [[0002-relational-state-and-aggregate-boundaries|ADR-0002]] | accepted | Relational current state и принятые aggregate boundaries |
| [[0003-postgresql-locking-and-transactional-audit|ADR-0003]] | accepted | PostgreSQL locks, optimistic versions и transactional audit |
| [[0004-command-receipts-and-correlation-query|ADR-0004]] | accepted | Command receipts и полный audit query по correlation |
| [[0005-demo-session-security-boundary|ADR-0005]] | accepted | Server-backed demo session и backend authorization |
| [[0006-idempotent-local-payroll-adapter|ADR-0006]] | accepted | Идемпотентный локальный payroll adapter |

State machine и предметные границы уже приняты в [[work-card-state-machine]], [[domain-model]] и решениях `D-014`–`D-021`; ADR-0002 фиксирует их физическое отображение, не создавая конкурирующую предметную модель.
