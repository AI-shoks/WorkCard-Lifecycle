---
artifact_id: project.documentation-index
status: active
version: 17
owner: project
updated: 2026-09-06
---

# Documentation Index

Документация организована по принципу **«один артефакт — один файл»**. У каждого артефакта есть собственная цель, стабильный `artifact_id`, статус и критерий готовности. Полные правила находятся в [[document-governance]].

## Статусы артефактов

| Статус | Значение |
|---|---|
| `planned` | Артефакт запланирован, работа не начата |
| `draft` | Содержание формируется |
| `in-review` | Готово к проверке и согласованию |
| `accepted` | Принято как действующая версия |
| `superseded` | Заменено более новым артефактом или решением |
| `rejected` | Рассмотрено, но не принято |
| `archived` | Выведено из активного проекта |
| `active` | Постоянно обновляемый план, журнал или реестр |

## Структура

```text
docs/
├── project/       управление, план, DoD, решения и риски
├── product/       brief, MVP scope и критерии успеха
├── domain/        предметная область и бизнес-правила
├── requirements/  use cases, stories и acceptance criteria
├── ux/            экраны, потоки и состояния интерфейса
├── architecture/  системная архитектура, данные, API и ADR
├── engineering/   репозиторий, окружения и инженерные правила
├── testing/       стратегия и матрица автоматических проверок
├── release/       deployment, эксплуатационные проверки
└── portfolio/     demo script и упаковка case study
```

## Правило готовности

Файл считается принятой точкой опоры только со статусом `accepted`. Изменение принятого артефакта должно увеличивать версию и обновлять связанные решения, требования и тесты. Операционные документы используют статус `active`.

## Текущая контрольная точка

**Этапы 1–9 закрыты; этап 10 «Релиз» остаётся в работе на 4/7.** Локальный hardening сохраняет общий public interactive demo и добавляет лимиты 20 партий/500 sessions, expired cleanup, owner-only reset, узкий production IAM operator, отдельный future deployer WIF и 7/30-дневный lifetime с двухфазным teardown. Решение — [[0008-bounded-public-demo-operations|ADR-0008]], runbook — [[deployment]]. Это code/config/plan qualification: `apply` и workflows не запускались, поэтому cloud resources, release image/SHA/digest manifest, фактические IAM/reset/Cloud Logging/proxy/Cloud SQL observations и hosted evidence отсутствуют. Stage progress не повышен без hosted evidence; результаты проверок — в [[quality-gates]].

Этап 9 зафиксирован implementation SHA [`3ee65709966f5775928de87783fd2946d085e2bc`](https://github.com/AI-shoks/WorkCard-Lifecycle/commit/3ee65709966f5775928de87783fd2946d085e2bc). На 2026-09-05 через GitHub API подтверждены [push CI](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33970654850) и [PR CI](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33970656850): все 6 обязательных jobs успешны в каждом запуске для этого SHA. Автоматизация качества описана в [[test-strategy]], локальные результаты и полная матрица CI — в [[quality-gates]].

Историческое закрытие этапа 8: frontend vertical slice зафиксирован implementation SHA `b00ff294a7b7ce1e09379c088969d9a02bd033bf`; полный процесс 250 карточек, отдельная финальная приёмка, audit/payroll и clean-container проверены локально, [push CI](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33963228130) и [PR CI](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33963230414) зелёные. Наглядный, неканонический обзор доступен в [project-dashboard.html](project-dashboard.html); он не заменяет актуальные канонические статусы плана/backlog.

## Происхождение и семантическая проверка

- [[decision-provenance]] отделяет `CONFIRMED_AS_IS`, `TO_BE_DECISION`, `ASSUMPTION` и `OUT_OF_SCOPE`;
- структурный audit проверяет metadata и ссылки, но не доказывает соответствие предметной области;
- перед закрытием этапа обязательны structural audit и отдельный semantic pass по scope, кардинальностям, ролям, состояниям и UX;
- интерактивный прототип является отдельным deliverable и не подменяется текстовыми wireframes.
- [[ux-copy-guidelines|Правила UX-текста]] задают русский производственный язык интерфейса, словарь отображения, границу технических сведений и read-only UX-copy audit.
- текущее aggregate-level решение прослеживается как `ASIS-010 + ASIS-011 → D-021 → BR-036–BR-039 → UC-015 → US-021 → AC-FBA-* → Future Tests`; физические подписи остаются отдельным AS-IS-свидетельством.
