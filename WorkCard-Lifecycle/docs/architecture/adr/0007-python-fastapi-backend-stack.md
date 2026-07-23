---
artifact_id: architecture.adr.0007
status: accepted
version: 1
owner: architecture
updated: 2026-07-18
supersedes: "[[0001-modular-monolith-and-stack]]"
---

# ADR-0007: Python/FastAPI backend stack

## Статус

Принято 2026-07-18. Заменяет [[0001-modular-monolith-and-stack|ADR-0001]].

## Контекст

ADR-0001 принял TypeScript/Fastify как единый frontend/backend stack. При реализации Foundation Gate был создан Python/FastAPI backend с Pydantic, psycopg, explicit SQL migrations, Pytest, Ruff, mypy и Bandit. Оставить этот код как branch-local исключение означало бы принять Gate 1 в прямом конфликте с канонической архитектурой; переписывание уже проверяемого foundation на Fastify не добавляло бы предметной ценности.

FastAPI также сохраняет важные свойства исходного решения: один HTTP boundary, generated OpenAPI 3.1, строгую input/output validation, явные PostgreSQL-транзакции и тестируемую application factory. Смена backend-языка не требует изменения доменной модели, API-семантики, PostgreSQL-схемы, trust boundary или будущего React UI.

## Варианты

1. Формально принять Python 3.12 и FastAPI как канонический backend stack.
2. Удалить Python foundation и реализовать Gate 1 заново на TypeScript/Fastify.
3. Сохранить FastAPI только как временное исключение до Gate 2.
4. Поддерживать две backend-реализации одного контракта.

## Решение

Принять вариант 1.

- backend runtime — Python `3.12.x`;
- backend framework — FastAPI с Pydantic request/response models и OpenAPI `3.1`;
- доступ к PostgreSQL — psycopg pool, parameterized SQL и explicit versioned migrations;
- backend quality gates — Pytest, Ruff, mypy, Bandit, coverage, secret scan и dependency audit;
- top-level runtime/development dependencies и security constraint для Starlette имеют exact pins в `pyproject.toml`, `requirements.txt` и `requirements-dev.txt`; transitive packages полностью не зафиксированы и отдельный lock-файл не заявляется;
- React/TypeScript остаётся направлением будущей SPA из этапа 8 и получает типизированный client из committed OpenAPI, когда frontend будет начат;
- PostgreSQL `18.x`, один deployable application boundary и modular-monolith rules сохраняются.

## Какие части ADR-0001 заменены

| Часть ADR-0001 | Замена ADR-0007 |
|---|---|
| Node.js как backend runtime | Python `3.12.x` |
| TypeScript как общий backend/frontend язык | Python для backend; TypeScript остаётся для будущего frontend |
| Fastify `5.x` | FastAPI |
| route JSON Schema как источник OpenAPI | Pydantic models и FastAPI route metadata |
| единый `pnpm` workspace/lockfile для backend | Python project metadata и exact-pinned requirements manifests; lock-файл не заявляется |
| Vitest/ESLint/Prettier для backend | Pytest/Ruff/mypy/Bandit для backend |

Не заменены: modular-monolith topology, React SPA direction, недоверенный browser, единственная API command/query boundary, PostgreSQL как transaction coordinator, explicit SQL migrations, append-only audit design, same-origin deployment и отсутствие broker/microservices.

## Последствия

- frontend и backend используют разные языки и toolchains; OpenAPI становится обязательной границей против contract drift;
- Python package resolution проверяется по согласованным manifests, а container tags фиксируют выбранные patch-линии Gate 1; immutable image digests остаются release-задачей;
- FastAPI dependency injection и application factory упрощают isolated API tests без in-memory замены PostgreSQL integration tests;
- Pydantic запрещает лишние поля и формирует machine-readable schema, но предметные permission/state/invariant проверки остаются application/domain responsibility;
- кодовые модули identity, reference data, batch/release, lifecycle, audit и mock payroll добавляются по vertical slices, а не заранее в Gate 1;
- возврат к Fastify или новый backend framework потребует нового ADR.

## Проверка

- [[technology-stack]], [[system-context]], [[api-contracts]] и [[security-baseline]] называют FastAPI каноническим backend;
- committed OpenAPI соответствует application factory и содержит только реализованные Gate 1 endpoints;
- production и development dependency manifests согласованы по top-level dependencies/constraints и exact pins;
- Foundation Gate проходит format, lint, type, security, unit/API, PostgreSQL integration и coverage checks;
- import, release/generation, assignment, lifecycle, БТК, payroll export и background-job endpoints отсутствуют до следующих срезов.
