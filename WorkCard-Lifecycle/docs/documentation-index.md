---
artifact_id: project.documentation-index
status: active
version: 16
owner: project
updated: 2026-08-09
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

## Активное операционное состояние

- [[project-state]] — единственный compact router принятого прогресса, gaps и следующего шага;
- [[stage-6-ci-documentation-audit-remediation]] — закрытая `TASK-003 rev 1 / LIN-004`: repository-owned canonical CI documentation-audit remediation и `BLOCK-S6-003` — `CLOSED / ACCEPTED`, lifecycle `SYNCED`;
- [[gate-2-1c-remediation]] — `TASK-002 rev 1` закрыта как `CLOSED / ACCEPTED`, lifecycle `SYNCED`; `LIN-003` синхронизирован; `BLOCK-G21C-001` и Gate 2.1C remediation — `CLOSED / ACCEPTED`;
- [[gate-2-2c-remediation]] — закрытая историческая task-card `TASK-001 rev 2 / LIN-002`, состояние `SYNCED`; Gate 2.2C остаётся `CLOSED / ACCEPTED`;
- [[project-plan]], [[backlog]] и [[decision-log]] остаются living trackers и не заменяют task Contract или Evidence.

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

Stage 6 остаётся в работе. `TASK-003 rev 1 / LIN-004` и `BLOCK-S6-003` закрыты как `CLOSED / ACCEPTED`: exact hosted workflow `quality`, run `31303490227`, успешно выполнил repository-owned strict audit на SHA `2439f9aaecd912258206258bb73b71a54c855ab3`, после чего independent R1 review не нашёл findings. Этот review также подтвердил PostgreSQL 18.1, migrations, full pytest, Docker build и readiness в том же run, но не выполнял отдельное acceptance-решение по `BLOCK-S6-001`/Gate 1. Gate 2.1C remediation и Gate 2.2C остаются `CLOSED / ACCEPTED`; `BLOCK-S6-001` и `BLOCK-S6-002`, Gate 2 и Stage 6 остаются `OPEN`. Stage 7 не начат.
