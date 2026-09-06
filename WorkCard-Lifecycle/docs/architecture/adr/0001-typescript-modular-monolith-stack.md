---
artifact_id: architecture.adr.0001
status: accepted
version: 1
owner: architecture
updated: 2026-09-01
---

# ADR-0001. TypeScript modular monolith stack

## Контекст

MVP требует browser UI, backend permissions, OpenAPI, PostgreSQL transactions и автоматические тесты. Команда/portfolio-проект не получает ценности от нескольких runtime-языков или распределённых сервисов.

## Варианты

1. TypeScript end-to-end: React/Vite + Fastify + PostgreSQL.
2. React + ASP.NET Core + PostgreSQL.
3. Next.js full-stack + PostgreSQL.
4. Несколько microservices и message broker.

## Решение

Использовать TypeScript monorepo на Node 24 LTS: React 19/Vite 8 frontend, Fastify 5 modular-monolith API, PostgreSQL 18, Drizzle/`node-postgres`, TypeBox/OpenAPI, Vitest/Playwright. Production API раздаёт SPA под одним origin.

## Причины

- один язык и общие runtime-схемы сокращают contract drift;
- Fastify даёт явный lifecycle, validation/serialization и встроенный Pino;
- PostgreSQL является единственной transactional boundary;
- modular monolith сохраняет предметные модули без сетевой/операционной сложности;
- Vite SPA соответствует закрытому demo workflow, которому не нужны SSR/SEO.

## Последствия

- один deployable application container и одна БД;
- raw SQL разрешён и обязателен для locks/version predicates, ORM не определяет доменную модель;
- frontend success следует только за backend commit;
- major-линии фиксированы в [[technology-stack]], patch-версии — lockfile/image digest;
- разделение на сервисы возможно только новым ADR после появления измеримой причины.

## Статус

Решение принимается для MVP v1; оно не утверждает, что engineering foundation уже реализован.
