---
title: Production Work Card Workflow
artifact_id: navigation.home
tags:
  - portfolio
  - case-study
  - workcard
status: active
version: 9
owner: navigation
updated: 2026-09-02
---

# Production Work Card Workflow

> Паспорт → партия → несколько комплектов → первая деталь → серия → per-card БТК → финальная приёмка партии → mock payroll.

## Сейчас

**Этапы 1–6 выполнены; backend vertical slice этапа 7 реализован локально и находится на проверке.** API и PostgreSQL проводят полный компактный сценарий независимо от UI, а отдельный масштабный тест подтверждает выпуск `3 / 250 / 254`. Следующая контрольная точка — удалённые CI jobs для будущего commit SHA; frontend-этап ещё не начат.

**Последняя локальная проверка:** format, lint, typecheck, 11 обычных тестов, 5 DB integration tests, production build, clean-container текущего checkout и migration/seed/verify — PASS. Удалённый зелёный run относится к `d0ecc812`; текущий незакоммиченный diff в CI ещё не запускался.

## Репозиторий

- [Repository](https://github.com/AI-shoks/WorkCard-Lifecycle)
- [Наглядная карта проекта](docs/project-dashboard.html)
- [README](README.md)
- [[project-plan|Канонический roadmap]]
- [[backlog|Backlog]]
- [[decision-log|Журнал решений]]

## Управление проектом

- [[project-plan|Полный план и отметки выполнения]]
- [[documentation-index|Карта артефактов]]
- [[document-governance|Правила версий и актуальности]]
- [[backlog|Backlog]]
- [[definition-of-done|Definition of Done]]
- [[decision-log|Журнал решений]]
- [[risk-register|Реестр рисков]]
- [[case-study-positioning|Позиционирование case study]]
- [[decision-provenance|Происхождение AS-IS, TO-BE решений и допущений]]

## Основные артефакты

### Product

- [[product-brief]]
- [[mvp-scope]]
- [[success-criteria]]

### Domain

- [[glossary]]
- [[as-is-to-be]]
- [[domain-model]]
- [[business-rules]]
- [[commands-events]]
- [[work-card-state-machine]]
- [[roles-permissions]]

### Architecture

- [[system-context]]
- [[er-model]]
- [[api-contracts]]
- [[adr-index|ADR]]

### Delivery

- [[use-cases]]
- [[user-stories]]
- [[negative-scenarios]]
- [[acceptance-criteria]]
- [[screen-map]]
- [[user-flows]]
- [[test-strategy]]
- [[demo-script]]
