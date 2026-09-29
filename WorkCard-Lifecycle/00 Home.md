---
title: Production Work Card Workflow
artifact_id: navigation.home
tags:
  - portfolio
  - case-study
  - workcard
status: active
version: 32
owner: navigation
updated: 2026-09-29
---

# Production Work Card Workflow

**Текущая цель — обновлённое публичное демо и завершённый портфолио-кейс (D-034).** Пользователь 29 сентября заменил прежний отказ от обновления. Проверенный main `bdb2647520639b9ca690dfd6d00402076463a63a` прошёл [CI 7/7](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/36544788733); точный image опубликован и просканирован. Переключение сайта ещё не выполнено: требуется завершить проверку тарифов/квот и штатный staging/deployment. Этап 12 и roadmap остаются открытыми; rollback drill не проверен. Текущие результаты — [[deployment#Обновление демо 2026-09-29]].

> Паспорт → партия → несколько комплектов → первая деталь → серия → per-card БТК → финальная приёмка партии → mock payroll.

## Сейчас

Этапы 1–11 закрыты; этап 12 и roadmap открыты до квалификации нового размещения. Main `bdb2647…` прошёл CI 7/7, его image опубликован со scan HIGH/CRITICAL=0. Публичный сервис пока использует `1195892…`; актуальные тарифы/квоты, staging и deployment остаются незавершёнными. [[deployment#Обновление демо 2026-09-29|Состояние обновления]]. Портфолио: [README](README.md), [[demo-script]], [[screenshots]], [[engineering-retrospective]].

### Подтверждения предыдущих этапов

**Этап 7 закрыт implementation commit [`17d2b04d13b58c7dff677543ed4399751a8593a1`](https://github.com/AI-shoks/WorkCard-Lifecycle/commit/17d2b04d13b58c7dff677543ed4399751a8593a1).** API и PostgreSQL проводят полный компактный сценарий независимо от UI, а отдельный масштабный тест подтверждает выпуск `3 / 250 / 254`.

**Подтверждено 2026-09-02:** format, lint, typecheck, 11 обычных тестов, 5 DB integration tests, production build, clean-container и migration/seed/verify — PASS. Для implementation SHA полностью зелёные [push CI](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33581627867) и [PR CI](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33581630041): в обоих запусках успешны `Code and database quality` и `Clean container startup`.

**Этап 8 закрыт 2026-09-05:** SHA [`b00ff294a7b7ce1e09379c088969d9a02bd033bf`](https://github.com/AI-shoks/WorkCard-Lifecycle/commit/b00ff294a7b7ce1e09379c088969d9a02bd033bf), успешные [push CI](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33963228130) и [PR CI](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33963230414), по 2/2 jobs `quality`/`container`. Исторические локальные результаты: 157 frontend, 9 обычных API и 5 PostgreSQL integration tests, полный браузерный процесс `112 → 3 → 250`, отдельная финальная приёмка, audit `254/254`, единственный payroll, desktop/mobile и clean-container — PASS.

## Репозиторий

- [Repository](https://github.com/AI-shoks/WorkCard-Lifecycle)
- [Наглядная карта проекта](docs/project-dashboard.html)
- [README](README.md)
- [Render configuration](infra/render/README.md) и [исторический Terraform](infra/terraform/README.md)
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
- [[deployment]]
- [[demo-script]]
