---
title: Production Work Card Workflow
artifact_id: navigation.home
tags:
  - portfolio
  - case-study
  - workcard
status: active
version: 10
owner: navigation
updated: 2026-07-19
---

# Production Work Card Workflow

> Паспорт → партия → несколько комплектов → первая деталь → серия → per-card БТК → финальная приёмка партии → mock payroll.

## Сейчас

**Этапы 1–3 семантически скорректированы:** модель соответствует подтверждённому AS-IS и явным TO-BE решениям.

**Этап 4 скорректирован:** UX-документы, [[ux-copy-guidelines|канонические правила UX-текста]] и отдельный [14-шаговый кликабельный прототип](docs/ux/prototype.html) включают цифровую финальную приёмку партии. Технические сведения отделены от производственного интерфейса.

**Этап 5 выполнен:** приняты [[technology-stack|стек]], [[system-context|системная граница]], [[er-model|physical data model]], [[api-contracts|API]], [[transactions-concurrency|транзакции]], [[audit-log-design|audit]], [[mock-integrations|mock boundaries]], [[security-baseline|security baseline]] и семь [[adr-index|ADR]]. ADR-0007 заменил backend stack ADR-0001 на Python/FastAPI.

**Этап 6 в работе:** Gate 1 Foundation прошёл local remediation на Python 3.12/PostgreSQL 15.10; статус — `Gate 1 remediation validated; publication CI pending`. PostgreSQL 18.1, Docker runtime и GitHub Actions требуют post-push verification. Gate 2 и frontend не начаты.

**Последняя проверка:** 57 документов, 0 errors, 0 warnings; semantic stack/scope review выполняется отдельно. Принятый 14-шаговый прототип не изменён.

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

- [[technology-stack]]
- [[system-context]]
- [[er-model]]
- [[api-contracts]]
- [[transactions-concurrency]]
- [[audit-log-design]]
- [[mock-integrations]]
- [[security-baseline]]
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
