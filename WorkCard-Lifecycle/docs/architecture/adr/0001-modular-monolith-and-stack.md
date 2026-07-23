---
artifact_id: architecture.adr.0001
status: superseded
version: 2
owner: architecture
updated: 2026-07-18
superseded_by: "[[0007-python-fastapi-backend-stack]]"
---

# ADR-0001: Modular monolith and TypeScript stack

## Статус

Принято 2026-07-18. Заменено [[0007-python-fastapi-backend-stack|ADR-0007]] 2026-07-18.

ADR-0001 сохранён как историческая запись исходного решения. ADR-0007 сохраняет модульный монолит, browser/API trust boundary, React SPA и PostgreSQL, но заменяет backend runtime, язык, framework, schema/tooling и способ фиксации зависимостей.

## Контекст

MVP — один узкий vertical slice с browser UI, API, PostgreSQL, транзакционным audit и mock payroll. Команда/репозиторий малы; независимого масштабирования или разных release cadence нет. Важнее воспроизводимость, единый контракт и видимые транзакции.

## Варианты

1. TypeScript modular monolith: React SPA + Fastify API + PostgreSQL.
2. Full-stack SSR framework с server actions.
3. Несколько сервисов и message broker.
4. Serverless functions с managed data services.

## Решение

Принять вариант 1 по [[technology-stack]]. Один deployable application содержит кодовые модули identity, reference data, batch/release, work-card lifecycle, audit и mock payroll. React остаётся недоверенным client, Fastify — единственной command/query boundary, PostgreSQL — единственным transaction coordinator.

Major-линии на этапе 5: Node.js `24.x` LTS, React `19.x`, Fastify `5.x`, PostgreSQL `18.x`. Minor/patch pins фиксируются lockfile/images этапа 6.

## Последствия

- один язык и OpenAPI client уменьшают contract drift;
- межагрегатные операции остаются обычными DB transactions;
- модульные границы можно тестировать без network hops;
- SPA/SSR trade-offs осознанно смещены в пользу простого authenticated demo;
- будущий service extraction потребует измеренной причины и нового ADR;
- реализация обязана не превращать monolith в неструктурированный общий слой.

## Проверка

- [[system-context]] содержит один application boundary;
- [[api-contracts]] не допускает прямого доступа browser к DB/modules;
- этап 6 создаёт workspace/module dependency rules и один reproducible application image.
