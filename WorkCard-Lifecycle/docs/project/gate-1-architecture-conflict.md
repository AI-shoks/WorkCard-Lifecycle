---
artifact_id: project.gate-1-architecture-conflict
status: archived
version: 2
owner: project
updated: 2026-07-18
resolution: resolved
resolved_by: "[[0007-python-fastapi-backend-stack]]"
---

# Gate 1 Architecture Conflict: resolved by ADR-0007

Эта историческая review-запись фиксирует закрытие конфликта между исходным TypeScript/Fastify решением и реализацией Foundation Gate на Python/FastAPI.

## Исходный конфликт

ADR-0001 принимал Node.js/TypeScript/Fastify, а Gate 1 был реализован на Python/FastAPI. Временное branch-local исключение не позволяло честно принять foundation и блокировало начало Gate 2.

## Разрешение

Выбран ранее описанный вариант B: новый [[0007-python-fastapi-backend-stack|ADR-0007]] формально принимает Python/FastAPI backend и взаимно заменяет [[0001-modular-monolith-and-stack|ADR-0001]]. ADR-0001 остаётся в репозитории со статусом `superseded`; living architecture documents синхронизированы с новым stack.

Review-артефакт получает governance-совместимый статус `archived`, потому что `resolved` не входит в допустимый набор статусов. Поле `resolution: resolved` сохраняет явный результат без создания второго активного источника архитектурного решения.

## Итог для границы Gate 1

- `0001_initial_schema.sql` остаётся Foundation Gate: он переносит принятую ER-модель и не выполняет business commands.
- `0002_seed_synthetic_reference_data.sql` создаёт prepared identities и synthetic reference rows `112 + 112 + 26 = 250`, но не создаёт `ProductionBatch`, `WorkCardSet` или `WorkCard`.
- demo-session, CSRF/origin, health, Prometheus, Docker/Compose, CI и OpenAPI относятся к foundation.
- import, release/generation, assignment, lifecycle, БТК acceptance, payroll export и background jobs не реализованы; Gate 2 не начат.
