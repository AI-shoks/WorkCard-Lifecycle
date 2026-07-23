---
artifact_id: architecture.adr-index
status: active
version: 4
owner: architecture
updated: 2026-07-18
aliases:
  - adr-index
---

# ADR Index

До merge review-ветки в каноническую ветку accepted ADR может быть скорректирован по результатам review с повышением версии и отдельным correction commit. Причина фиксируется в [[decision-log]] или review.

После merge в каноническую ветку изменение принятого архитектурного решения выполняется только новым ADR по [[document-governance]]: старый ADR получает `superseded_by`, новый — `supersedes`, ссылки взаимны.

## Действующие и исторические ADR

| ADR | Решение | Связанные артефакты |
|---|---|---|
| [[0001-modular-monolith-and-stack|ADR-0001]] | Историческое решение: TypeScript/Fastify stack; заменено ADR-0007 | [[0007-python-fastapi-backend-stack|ADR-0007]] |
| [[0002-relational-state-and-aggregate-mapping|ADR-0002]] | реляционное current state, explicit SQL и audit без event sourcing | [[er-model]], [[domain-model]] |
| [[0003-concurrency-and-transactions|ADR-0003]] | optimistic versions, ordered locks и согласованная final acceptance | [[transactions-concurrency]] |
| [[0004-transactional-audit-and-correlation-query|ADR-0004]] | transactional append-only audit и server query по `correlationId` | [[audit-log-design]], [[api-contracts]] |
| [[0005-command-replay-and-mock-payroll|ADR-0005]] | receipts, idempotency и local mock payroll adapter | [[mock-integrations]], [[api-contracts]] |
| [[0006-demo-session-and-authorization|ADR-0006]] | prepared identities, signed session и backend authorization | [[security-baseline]], [[roles-permissions]] |
| [[0007-python-fastapi-backend-stack|ADR-0007]] | Python/FastAPI backend при сохранении modular monolith, React SPA и PostgreSQL | [[technology-stack]], [[system-context]] |

## Как добавить или заменить решение

1. Создать `NNNN-short-title.md` с новым unique `artifact_id`.
2. Зафиксировать status, context, alternatives, decision, consequences и verification.
3. Добавить запись в этот индекс и связанные living documents.
4. При замещении сохранить старый ADR со статусом `superseded` и взаимными metadata links.
5. Запустить strict structural audit и semantic pass.

## Не требует отдельного ADR

Каноническая доменная логика `FinalBatchAcceptance`, роли, state machine и 14-шаговый UX-сценарий уже приняты в этапах 1–4. Архитектура реализует их и не переопределяет.
