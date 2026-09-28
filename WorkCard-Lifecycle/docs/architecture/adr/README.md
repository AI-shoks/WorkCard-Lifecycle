---
artifact_id: architecture.adr-index
status: active
version: 6
owner: architecture
updated: 2026-09-27
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
| [[0001-typescript-modular-monolith-stack|ADR-0001]] | superseded by ADR-0010 | Первоначальный TypeScript modular monolith stack с Drizzle |
| [[0002-relational-state-and-aggregate-boundaries|ADR-0002]] | accepted | Relational current state и принятые aggregate boundaries |
| [[0003-postgresql-locking-and-transactional-audit|ADR-0003]] | accepted | PostgreSQL locks, optimistic versions и transactional audit |
| [[0004-command-receipts-and-correlation-query|ADR-0004]] | accepted | Command receipts и полный audit query по correlation |
| [[0005-demo-session-security-boundary|ADR-0005]] | accepted | Server-backed demo session и backend authorization |
| [[0006-idempotent-local-payroll-adapter|ADR-0006]] | superseded by ADR-0010 | Первоначальный payroll port/adapter |

## Решения этапа 10

| ADR | Статус | Решение |
|---|---|---|
| [[0007-cloud-run-and-cloud-sql-release|ADR-0007]] | superseded by ADR-0009 | Cloud Run service/jobs, Artifact Registry и отдельные Cloud SQL staging/production |
| [[0008-bounded-public-demo-operations|ADR-0008]] | superseded by ADR-0009 | Ограниченный общий public demo, daily reset, узкий IAM operator и конечный lifetime |

| [[0009-render-free-neon-free-release|ADR-0009]] | accepted | Render Free + Neon Free, public GHCR, persistent maintenance и clean synthetic recovery |

## Уточнение реализации на этапе 12

| ADR | Статус | Решение |
|---|---|---|
| [[0010-pg-sql-and-local-payroll-service|ADR-0010]] | accepted | pg/SQL и payroll-команда общего application service; история ADR-0001/0006 сохранена |

State machine и предметные границы уже приняты в [[work-card-state-machine]], [[domain-model]] и решениях `D-014`–`D-021`; ADR-0002 фиксирует их физическое отображение, не создавая конкурирующую предметную модель.
