---
artifact_id: project.documentation-index
status: active
version: 9
owner: project
updated: 2026-07-19
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

## Происхождение и семантическая проверка

- [[decision-provenance]] отделяет `CONFIRMED_AS_IS`, `TO_BE_DECISION`, `ASSUMPTION` и `OUT_OF_SCOPE`;
- структурный audit проверяет metadata и ссылки, но не доказывает соответствие предметной области;
- перед закрытием этапа обязательны structural audit и отдельный semantic pass по scope, кардинальностям, ролям, состояниям и UX;
- интерактивный прототип является отдельным deliverable и не подменяется текстовыми wireframes.
- [[ux-copy-guidelines|Правила UX-текста]] задают русский производственный язык интерфейса, словарь отображения, границу технических сведений и read-only UX-copy audit.
- текущее aggregate-level решение прослеживается как `ASIS-010 + ASIS-011 → D-021 → BR-036–BR-039 → UC-015 → US-021 → AC-FBA-* → Future Tests`; физические подписи остаются отдельным AS-IS-свидетельством.

## Принятая архитектурная основа

- [[technology-stack]] и [[system-context]] фиксируют Python/FastAPI backend модульного монолита, будущую React SPA, browser/API trust boundary и PostgreSQL;
- [[er-model]] хранит current state, snapshots и отдельные immutable результаты без `sequenceNumber` и единой нормы партии;
- [[api-contracts]] покрывает команды/запросы и отдельный server query полного event set по `correlationId`;
- [[transactions-concurrency]] и [[audit-log-design]] фиксируют optimistic versions, atomic state/events и append-only history без event sourcing;
- [[mock-integrations]] и [[security-baseline]] задают честную local mock boundary и demo authorization;
- [[adr-index]] хранит семь ADR: шесть исходных решений этапа 5 и ADR-0007, которое исторически заменяет stack-часть ADR-0001.

Foundation Gate 1 этапа 6 реализован и прошёл local remediation: configuration, FastAPI application factory, PostgreSQL pool/migrations/session registry, health, logging/request ID, Prometheus, session replay/CSRF/origin, Problem Details/OpenAPI, least-privilege test matrix, dependency/secret gates, Docker/Compose и CI configuration. Статус: `Gate 1 remediation validated; publication CI pending`. PostgreSQL 18.1, Docker runtime и GitHub Actions локально не подтверждены; business endpoints Gate 2 и frontend не начаты.
