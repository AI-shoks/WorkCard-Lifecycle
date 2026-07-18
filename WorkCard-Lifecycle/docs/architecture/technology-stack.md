---
artifact_id: architecture.technology-stack
status: accepted
version: 1
owner: architecture
updated: 2026-07-18
---

# Technology Stack

Принятый стек MVP v1. Он оптимизирован для небольшого проверяемого vertical slice, явных транзакций PostgreSQL и одного языка между браузером и backend. Решение подробно обосновано в [[0001-modular-monolith-and-stack]].

## Критерии выбора

- один репозиторий и короткий цикл разработки для portfolio case study;
- строгая типизация команд, ответов и событий;
- поддержка атомарных межагрегатных операций и явных ограничений БД;
- генерация проверяемого OpenAPI-контракта;
- реалистичные integration tests на PostgreSQL, а не только in-memory substitutes;
- воспроизводимый локальный запуск и простой будущий deployment;
- отсутствие инфраструктуры, не нужной для [[mvp-scope]].

## Принятое решение

| Слой | Выбор | Назначение |
|---|---|---|
| Runtime | Node.js `24.x` LTS | единый поддерживаемый runtime для frontend tooling и API |
| Язык | TypeScript со строгими проверками | frontend, backend, тесты и сгенерированный API client |
| Workspace | `pnpm` workspaces | один lockfile, разделение приложений и пакетов без преждевременного микросервисного дробления |
| Frontend | React `19.x`, Vite, React Router, TanStack Query | клиентская SPA, маршруты `S-01`–`S-07`, server-state и явное восстановление после conflict |
| Backend | Fastify `5.x` | модульный HTTP API, JSON Schema validation, security plugins и тестирование через `inject()` |
| Контракт | JSON Schema на маршрутах + OpenAPI `3.1` | единственный HTTP-контракт и генерация типизированного frontend client |
| Доступ к данным | `pg`, parameterized SQL и версионируемые SQL migrations | видимые транзакции, locks, constraints и отсутствие скрытой ORM-семантики |
| База данных | PostgreSQL `18.x`, актуальный minor | текущее состояние, snapshots, optimistic versions, append-only audit и mock payroll |
| Unit/component tests | Vitest, React Testing Library | доменные правила и UI-состояния |
| API/DB integration | Fastify `inject()`, PostgreSQL container | permissions, constraints, транзакции, конкурентность и audit |
| Browser E2E | Playwright | сквозной сценарий, role switch и conflict recovery |
| Static quality | TypeScript, ESLint, Prettier | typecheck, lint и format gates этапа 6 |
| Packaging | multi-stage Docker image + PostgreSQL service | одинаковые артефакты для локального запуска и будущего deployment |

Точные minor/patch версии и image digests фиксируются lockfile и container manifests на этапе 6. Major-линии не обновляются автоматически: изменение major требует проверки совместимости и новой версии этого документа.

## Форма приложения

- React собирается как SPA; server-side rendering и React Server Components не нужны для demo-системы с защищёнными данными.
- Fastify реализуется как модульный монолит с модулями identity, reference data, batch/release, work-card lifecycle, audit и mock payroll.
- В production-образе один application container отдаёт статические SPA-файлы и `/api/v1`; PostgreSQL остаётся отдельным service.
- Доменные функции не импортируют Fastify, SQL или React. Прикладные сервисы координируют агрегаты и транзакции через порты репозиториев.
- Схемы OpenAPI описывают wire format. Доменные типы не становятся публичным контрактом автоматически.

## Политика БД

- SQL migrations являются каноническим описанием physical schema;
- migration не генерируется молча из runtime-моделей;
- repository queries используют параметры, а не конкатенацию SQL;
- сложные проверки completion predicate, locks и `correlationId` query остаются явными SQL-операциями;
- integration tests запускаются на той же major-линии PostgreSQL, что и приложение.

## Осознанно не выбрано

| Вариант | Причина |
|---|---|
| микросервисы и message broker | нет независимых deployment/scaling boundaries; межсервисные транзакции ухудшили бы доказуемую атомарность MVP |
| serverless functions | усложняют локальную воспроизводимость, session/cookie boundary и многооперационные транзакции |
| event sourcing | [[domain-model]] требует audit фактов, но текущее состояние не должно восстанавливаться из событий |
| in-memory/SQLite как рабочая БД | не доказывают выбранные PostgreSQL locks, isolation и constraints |
| тяжёлый full-stack framework | SSR и server actions не являются требованием; явная граница SPA/API лучше показывает контракт |
| ORM как источник схемы | критические locks, partial indexes и append-only guards должны быть видны в SQL |

## Граница этапов

Этап 5 принимает компоненты и контракты. Структура каталогов, lockfile, контейнеры, миграции, CI и исполняемый код относятся к этапу 6 и последующим vertical slices.

## Проверка решения

- [[system-context]] размещает выбранные компоненты внутри одной system boundary;
- [[er-model]] выражает все сущности и ограничения MVP в PostgreSQL;
- [[api-contracts]] покрывает каждый query/command из [[commands-events]];
- [[transactions-concurrency]] задаёт isolation, locks и версии;
- [[audit-log-design]], [[mock-integrations]] и [[security-baseline]] не требуют дополнительных runtime-компонентов.

## Официальные ориентиры

- [Node.js release policy](https://nodejs.org/en/about/previous-releases)
- [React 19](https://react.dev/blog/2024/12/05/react-19)
- [Fastify LTS policy](https://fastify.dev/docs/latest/Reference/LTS/)
- [PostgreSQL versioning policy](https://www.postgresql.org/support/versioning/)
