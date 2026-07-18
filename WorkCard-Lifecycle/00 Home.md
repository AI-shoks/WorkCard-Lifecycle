---
title: Production Work Card Workflow
artifact_id: navigation.home
tags:
  - portfolio
  - case-study
  - workcard
status: active
version: 8
owner: navigation
updated: 2026-07-18
---

# Production Work Card Workflow

> Паспорт → партия → несколько комплектов → первая деталь → серия → per-card БТК → финальная приёмка партии → mock payroll.

## Сейчас

**Этапы 1–3 семантически скорректированы:** модель соответствует подтверждённому AS-IS и явным TO-BE решениям.

**Этап 4 скорректирован:** UX-документы, [[ux-copy-guidelines|канонические правила UX-текста]] и отдельный [14-шаговый кликабельный прототип](docs/ux/prototype.html) включают цифровую финальную приёмку партии. Технические сведения отделены от производственного интерфейса.

**Этап 5 выполнен:** приняты [[technology-stack|стек]], [[system-context|системная граница]], [[er-model|physical data model]], [[api-contracts|API]], [[transactions-concurrency|транзакции]], [[audit-log-design|audit]], [[mock-integrations|mock boundaries]], [[security-baseline|security baseline]] и [[adr-index|шесть ADR]]. Этап 6 «Инженерный фундамент» — следующая контрольная точка; работающего backend/frontend checkout пока не заявляет.

**Последняя проверка:** 55 документов, 0 errors, 0 warnings; architecture semantic/ID/metadata gates — PASS. Принятый 14-шаговый прототип не изменён.

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
