---
artifact_id: architecture.technology-stack
status: accepted
version: 5
owner: architecture
updated: 2026-09-27
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
| Репозиторий | `pnpm` workspace, TypeScript monorepo | `apps/api`, `apps/web`, `packages/contracts`; общие настройки находятся в корне workspace |
| Runtime | Node.js `24` Active LTS | только чётная LTS-линия; версия фиксируется в `.node-version`, `package.json#engines` и образах |
| Язык | TypeScript `5.9`, strict ESM | TypeScript 6.0 не принимается в день релиза; обновление — отдельная квалификация зависимостей |
| Backend | Fastify `5`, TypeBox JSON Schema, `@fastify/swagger` | модульный монолит; маршруты не содержат доменные правила |
| Frontend | React `19.2`, Vite `8`, собственный типизированный router поверх History API и явные resource/command states | SPA с русским производственным UI; server state перечитывается после command response, до сообщения об успехе |
| БД | PostgreSQL `18` | текущая модель состояния + append-only audit; event sourcing не используется |
| Доступ к данным | `pg` (`node-postgres`) и параметризованный SQL по [[0010-pg-sql-and-local-payroll-service|ADR-0010]] | SQL migrations в Git; Drizzle и ORM-слой отсутствуют |
| Контракты | TypeBox-схемы в `packages/contracts`, OpenAPI 3.1 | runtime validation и TS-типы строятся из одного определения |
| Unit/API tests | Vitest, Fastify `inject` | быстрые domain/unit и HTTP contract tests |
| DB integration | Vitest + PostgreSQL container | реальные constraints, транзакции, конкурентность и миграции; SQLite не подменяет PostgreSQL |
| Browser E2E | Playwright | core demo sequence, permissions, conflict recovery, desktop/mobile |
| Наблюдаемость | Pino JSON logs, request/correlation IDs, health endpoints | без внешнего APM в MVP |
| Доставка | один nonroot multi-stage OCI image в Render Free, отдельные Neon Free PostgreSQL 18 projects; Docker Compose локально | frontend собирается отдельно и раздаётся API под тем же origin; public GHCR build once и immutable digest по [ADR-0009](adr/0009-render-free-neon-free-release.md) |

Точные patch-версии принадлежат lockfile и digest/tag контейнеров. Архитектурные документы фиксируют поддерживаемые линии, чтобы обновление patch не требовало нового ADR.

Hosted PostgreSQL patch управляется Neon; фактическая версия, TLS, proxy chain Render и resolved image требуют разрешённой проверки по [[deployment]]. Отдельный staging API существует только локально или временно на Actions runner, обычные CI-тесты используют disposable локальную PostgreSQL. Подготовленный GCP Terraform сохраняется неактивным историческим вариантом.

### Уточнение frontend-реализации этапа 8

Первоначально в перечне frontend-библиотек были указаны React Router и TanStack Query. Текущий vertical slice использует семь фиксированных маршрутов в `app-routing.ts`, History API через `useBrowserNavigation` в `App.tsx` и явные состояния загрузки/команд в React. Эти библиотеки не установлены и не объявляются частью реализованного runtime. Малый набор маршрутов не требует вложенных маршрутизаторов, а безопасное восстановление команды управляет перечитыванием всех её целей явно. Это уточняет вспомогательные библиотеки внутри принятого React/Vite SPA и сохраняет границы ADR-0001.

Типизированный API client валидирует runtime-контракты, сохраняет request/correlation context и завершает mutation только после обязательного read-back. Смена серверной identity размонтирует предметный экран, отменяет незавершённые чтения и очищает command/permission-sensitive state. Offline queue, автоматический повтор mutations и optimistic domain state отсутствуют.

## Почему модульный монолит

- Все изменяющие сценарии требуют общей транзакции PostgreSQL между предметным состоянием и audit events.
- Масштаб MVP не оправдывает сеть между сервисами, broker, saga или distributed tracing.
- Session/security выделены в отдельные модули; предметные команды `passports`, `batches`, `work-cards`, `audit` и `payroll` сосредоточены в `workflow-service.ts`. Это логические области одного application service, без отдельных repository/port/adapter слоёв.
- Отделение frontend от API сохраняется на уровне workspace и контрактов, но production runtime остаётся одним origin.

## Почему PostgreSQL и явный SQL

PostgreSQL даёт транзакции, row-level locks, `jsonb` и частичные/уникальные индексы. Параметризованный SQL напрямую выражает [[transactions-concurrency|стратегию конкурентности]]. Схема и миграции остаются проверяемыми SQL-файлами; runtime-sync схемы отсутствует.

Реализация backend vertical slice использует пакет `pg` из `apps/api/package.json` и параметризованные `Pool`/`PoolClient.query` в `apps/api/src/workflow-service.ts`, включая явные транзакции, locks и version predicates. [[0010-pg-sql-and-local-payroll-service|ADR-0010]] принимает эту реализацию и заменяет первоначальный выбор Drizzle в ADR-0001 и payroll port/adapter в ADR-0006; body исторических решений сохранены. Доказательства успешного выполнения проверок принадлежат [[quality-gates]], а не выводятся из наличия кода.

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

## Критерий принятия

Первоначальное решение принято после согласования [[system-context]], [[er-model]], [[api-contracts]], [[transactions-concurrency]], [[audit-log-design]], [[mock-integrations]], [[security-baseline]] и ADR `0001`–`0006`; текущие SQL/payroll границы уточнены ADR-0010. Наличие Docker или package manifest само по себе не доказывает готовность стека.
