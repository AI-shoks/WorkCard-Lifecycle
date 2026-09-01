---
artifact_id: architecture.technology-stack
status: accepted
version: 1
owner: architecture
updated: 2026-09-01
---

# Technology Stack

Технологический стек MVP выбирается для узкого, воспроизводимого vertical slice. Цель — доказать предметные инварианты, транзакции и ролевой сценарий, а не максимизировать число технологий.

## Критерии

1. Один основной язык для браузера, API и общих контрактов.
2. Явный доступ к SQL-транзакциям, блокировкам и version predicates.
3. Воспроизводимый запуск на Windows через Docker Desktop/WSL 2 и в Linux CI.
4. OpenAPI, runtime-валидация и типизация без дублирования схем вручную.
5. Малый операционный контур: один deployable backend, один frontend и одна PostgreSQL.
6. Поддерживаемые стабильные версии и фиксируемый lockfile.

## Решение

| Область | Выбор | Граница решения |
|---|---|---|
| Репозиторий | `pnpm` workspace, TypeScript monorepo | `apps/api`, `apps/web`, `packages/contracts`, `packages/config` |
| Runtime | Node.js `24` Active LTS | только чётная LTS-линия; версия фиксируется в `.node-version`, `package.json#engines` и образах |
| Язык | TypeScript `5.9`, strict ESM | TypeScript 6.0 не принимается в день релиза; обновление — отдельная квалификация зависимостей |
| Backend | Fastify `5`, TypeBox JSON Schema, `@fastify/swagger` | модульный монолит; маршруты не содержат доменные правила |
| Frontend | React `19.2`, Vite `8`, React Router, TanStack Query | SPA с русским производственным UI; server state перечитывается после command success |
| БД | PostgreSQL `18` | текущая модель состояния + append-only audit; event sourcing не используется |
| Доступ к данным | Drizzle ORM + `node-postgres`; SQL migrations в Git | типизированные простые запросы, raw SQL для `FOR UPDATE`, version predicates и сложных агрегатных проверок |
| Контракты | TypeBox-схемы в `packages/contracts`, OpenAPI 3.1 | runtime validation и TS-типы строятся из одного определения |
| Unit/API tests | Vitest, Fastify `inject` | быстрые domain/unit и HTTP contract tests |
| DB integration | Vitest + PostgreSQL container | реальные constraints, транзакции, конкурентность и миграции; SQLite не подменяет PostgreSQL |
| Browser E2E | Playwright | core demo sequence, permissions, conflict recovery, desktop/mobile |
| Наблюдаемость | Pino JSON logs, request/correlation IDs, health endpoints | без внешнего APM в MVP |
| Доставка | multi-stage OCI image + PostgreSQL; Docker Compose локально | frontend собирается отдельно и раздаётся API под тем же origin |

Точные patch-версии принадлежат lockfile и digest/tag контейнеров. Архитектурные документы фиксируют поддерживаемые линии, чтобы обновление patch не требовало нового ADR.

## Почему модульный монолит

- Все изменяющие сценарии требуют общей транзакции PostgreSQL между предметным состоянием и audit events.
- Масштаб MVP не оправдывает сеть между сервисами, broker, saga или distributed tracing.
- Модули `demo-auth`, `passports`, `batches`, `work-cards`, `audit` и `payroll` имеют явные границы и могут тестироваться независимо внутри одного процесса.
- Отделение frontend от API сохраняется на уровне workspace и контрактов, но production runtime остаётся одним origin.

## Почему PostgreSQL и Drizzle

PostgreSQL даёт транзакции, row-level locks, `jsonb`, частичные/уникальные индексы и стабильную пятилетнюю политику поддержки major-линий. Drizzle не скрывает SQL и допускает точечные запросы, необходимые [[transactions-concurrency|стратегии конкурентности]]. Схема и миграции остаются проверяемым SQL, а не неявным runtime-sync.

## Осознанно не выбрано

| Альтернатива | Причина отказа для MVP |
|---|---|
| Microservices, broker, Redis | нет независимой нагрузки или транзакционной границы, оправдывающей распределённость |
| Next.js/SSR | производственный сценарий после входа не требует SEO или server components; same-origin SPA проще проверять |
| SQLite для разработки | не воспроизводит PostgreSQL locks, isolation и constraints |
| Event sourcing | audit нужен как неизменяемое доказательство команд, но текущая модель читается из обычных таблиц |
| Kubernetes | несоразмерен одному приложению и одной БД |
| TypeScript 6.0 немедленно | релиз 2026-08-31 является переходным к нативному компилятору; экосистема сначала проходит отдельную проверку |

## Политика версий

- lockfile обязателен и устанавливается через `pnpm install --frozen-lockfile`;
- Docker base images фиксируются как минимум до patch-тега, в CI/релизе — также по digest;
- Node обновляется внутри Active/Maintenance LTS только после lint, typecheck, tests и clean build;
- major-обновление Fastify, React, Vite, PostgreSQL или смена ORM требует нового ADR;
- dependency audit не исправляет major-версии автоматически.

## Источники на дату решения

- [Node.js Releases](https://nodejs.org/en/about/previous-releases) — production должен использовать Active/Maintenance LTS; Node 24 находится в Active LTS.
- [Fastify LTS](https://fastify.dev/docs/latest/Reference/LTS/) — Fastify 5 поддерживает актуальные Node LTS-линии.
- [React Versions](https://react.dev/versions) — текущая стабильная ветка React 19.2.
- [Vite Releases](https://vite.dev/releases) — поддерживаемая ветка Vite 8 и политика обновлений.
- [PostgreSQL Versioning](https://www.postgresql.org/support/versioning/) — PostgreSQL 18 поддерживается до 2030 года.
- [Drizzle transactions](https://orm.drizzle.team/docs/transactions) — явная transaction API и PostgreSQL isolation options.

## Критерий принятия

Решение принято после согласования [[system-context]], [[er-model]], [[api-contracts]], [[transactions-concurrency]], [[audit-log-design]], [[mock-integrations]], [[security-baseline]] и ADR `0001`–`0006`. Наличие Docker или package manifest само по себе не доказывает готовность стека.
