---
title: Production Work Card Workflow
artifact_id: navigation.home
tags:
  - portfolio
  - case-study
  - workcard
status: active
version: 31
owner: navigation
updated: 2026-09-29
---

# Production Work Card Workflow

**Выбранный финиш — завершённый портфолио-кейс.** По решению пользователя от 29 сентября публичное демо сохраняет прежний релиз `1195892…` с явными ограничениями. Обновление сайта, новый image и rollback drill не входят в оставшуюся работу. Проверенные исходники и исторические hosted результаты описываются раздельно; этап 12 и roadmap пока открыты. Подготовлен согласованный состав с main; его commit/CI ещё впереди. План завершения — [[project-plan]], решение D-033 — [[decision-log]].

> Паспорт → партия → несколько комплектов → первая деталь → серия → per-card БТК → финальная приёмка партии → mock payroll.

## Сейчас

**На 29 сентября 2026 года этапы 1–11 закрыты; этап 12 «Финальный аудит» в работе. CI `36449212344/1` — 7/7 для исходников `2d4609ad…` с FA-01/02. Все 22 DoD сверены; FA-03 закрыт по этим исходникам решением D-032 от 29 сентября; этап 12/roadmap открыты, объединённый с main состав требует собственного CI. Hosted evidence относятся к `1195892…`; новый релиз и доступность сейчас не заявляются. Результаты и D-032 — [[final-audit]].** Портфолио-кейс собран в [README](README.md): [[demo-script|короткий показ]], [[screenshots|реальные экраны]], [[engineering-retrospective|решения и ограничения]]. Этап 10 «Релиз» сохраняет исторический результат 7/7: Render/Neon Free, staging/production и recovery canonical/compact; после 192,58 часа без reset recovery API отказал закрытым gate и восстановился после owner reset. Rollback drill не проверен: предыдущего совместимого образа нет. Подробности — [[deployment]] и [[backlog]].

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
