---
artifact_id: project.documentation-index
status: active
version: 14
owner: project
updated: 2026-08-07
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
- [[stage-6-ci-documentation-audit-remediation]] — активная `TASK-003 rev 1 / LIN-004`: repository-owned canonical CI documentation-audit remediation по `BLOCK-S6-003`;
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

Stage 6 остаётся в работе. Активная `TASK-003 rev 1 / LIN-004` устраняет `BLOCK-S6-003`: canonical strict documentation audit пока зависит от personal external skill и не запускается GitHub CI из clean checkout. Gate 2.1C remediation независимо проверена и принята: `TASK-002 rev 1 / LIN-003` синхронизирован, `BLOCK-G21C-001` закрыт, exact implementation commit — `7acc58c3eaaa84de3a637a94202f5f7e34a04612`. Gate 2.2C остаётся независимо принят и закрыт в `TASK-001 rev 2 / LIN-002` с implementation commit `2ab56fcde3dc5ce88ebae9a9709f55b4ae7b72f0`; эта lineage не переоткрывалась. Gate 2 не закрыт: remediation не заменяет отсутствующую отдельную acceptance-запись Gate 2.1 в целом и acceptance Gate 2.2A/B. Gate 1 сохраняет статус `publication CI pending`; GitHub Actions на PostgreSQL 18.1, Docker image build и container readiness smoke не подтверждены. Поэтому Stage 6 не закрыт, Stage 7 не начат.
