---
artifact_id: architecture.technology-stack
status: accepted
version: 2
owner: architecture
updated: 2026-07-18
---

# Technology Stack

Принятый стек MVP v1. Он оптимизирован для небольшого проверяемого vertical slice, явных транзакций PostgreSQL и machine-readable контракта между разными frontend/backend toolchains. Исходное решение сохранено в [[0001-modular-monolith-and-stack]], каноническая замена backend stack обоснована в [[0007-python-fastapi-backend-stack]].

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
| Backend runtime | Python `3.12.x` | API, migrations, scripts и backend tests |
| Backend язык | Python со strict mypy | application/domain code, adapters и tests с явной статической проверкой |
| Backend dependencies | `pyproject.toml`, `requirements.txt`, `requirements-dev.txt` с exact top-level pins/constraints | project metadata, container/runtime install и quality-tool install без заявления отсутствующего lock-файла |
| Frontend | React `19.x`, Vite, React Router, TanStack Query | клиентская SPA, маршруты `S-01`–`S-07`, server-state и явное восстановление после conflict |
| Backend | FastAPI `0.139.x`, Starlette `1.3.x`, Pydantic `2.x` | модульный HTTP API, validation, application factory и TestClient |
| Контракт | Pydantic request/response models + OpenAPI `3.1` | единственный HTTP-контракт и будущая генерация типизированного frontend client |
| Доступ к данным | psycopg `3.x`, connection pool, parameterized SQL и versioned SQL migrations | видимые транзакции, locks, constraints и отсутствие скрытой ORM-семантики |
| База данных | PostgreSQL `18.x`, актуальный minor | текущее состояние, snapshots, optimistic versions, append-only audit и mock payroll |
| Backend unit/API tests | Pytest, FastAPI TestClient | configuration, session/security, health, logging и contract behavior |
| API/DB integration | Pytest, psycopg, отдельная PostgreSQL database | migrations, constraints, readiness и prepared reference data |
| Browser E2E | Playwright | сквозной сценарий, role switch и conflict recovery |
| Backend static/security quality | Ruff, mypy, Bandit, pip-audit | format, lint, type, source-security и production dependency gates |
| Packaging | multi-stage Docker image + PostgreSQL service | одинаковые артефакты для локального запуска и будущего deployment |

Gate 1 фиксирует top-level runtime/development versions и Starlette security constraint в трёх согласованных manifests, Python image `3.12.11` и PostgreSQL image `18.1`. Отдельного Python lock/constraints-файла нет, поэтому документ не заявляет полную фиксацию transitive resolution; минимальное дальнейшее усиление — reviewed constraints-файл без смены package manager. Immutable image digests относятся к release hardening этапа 10. Major-линии не обновляются автоматически: изменение major требует проверки совместимости и новой версии этого документа.

## Форма приложения

- React собирается как SPA; server-side rendering и React Server Components не нужны для demo-системы с защищёнными данными.
- FastAPI реализуется как модульный монолит; Gate 1 содержит только foundation/session, а identity, reference data, batch/release, work-card lifecycle, audit и mock payroll добавляются соответствующими vertical slices.
- В production-образе один application container отдаёт статические SPA-файлы и `/api/v1`; PostgreSQL остаётся отдельным service.
- Доменные функции не импортируют FastAPI, SQL или React. Прикладные сервисы координируют агрегаты и транзакции через порты репозиториев.
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

Этап 5 принимает компоненты и контракты. Структура каталогов, dependency manifests, контейнеры, миграции, CI и foundation-код относятся к этапу 6; business endpoints и UI остаются последующим vertical slices.

## Проверка решения

- [[system-context]] размещает выбранные компоненты внутри одной system boundary;
- [[er-model]] выражает все сущности и ограничения MVP в PostgreSQL;
- [[api-contracts]] покрывает каждый query/command из [[commands-events]];
- [[transactions-concurrency]] задаёт isolation, locks и версии;
- [[audit-log-design]], [[mock-integrations]] и [[security-baseline]] не требуют дополнительных runtime-компонентов.

## Официальные ориентиры

- [Python version status](https://devguide.python.org/versions/)
- [React 19](https://react.dev/blog/2024/12/05/react-19)
- [FastAPI documentation](https://fastapi.tiangolo.com/)
- [PostgreSQL versioning policy](https://www.postgresql.org/support/versioning/)
