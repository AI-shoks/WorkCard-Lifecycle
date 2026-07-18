---
artifact_id: architecture.adr.0004
status: accepted
version: 2
owner: architecture
updated: 2026-07-18
---

# ADR-0004: Transactional audit and server correlation query

## Статус

Принято 2026-07-18.

## Контекст

`AC-AUD-003` требует доказуемо полный набор событий массовой операции. Отдельные card histories не гарантируют полноту событий batch/set/card, а UX этапа 4 намеренно не предрешал endpoint.

## Варианты

1. Append-only `audit_events` в той же transaction + indexed server query по `correlationId`.
2. Клиент собирает N aggregate histories.
3. Отдельный event broker/store с eventual consistency.
4. Только application logs.

## Решение

Принять вариант 1 по [[audit-log-design]] и [[api-contracts]]. Одна successful command получает server-generated `correlationId`; все events изменённых aggregates записываются с ним атомарно. Инициатор successful command может получить этот `correlationId` как opaque metadata ответа, но это не даёт права читать audit. `GET /api/v1/audit/operations/{correlationId}/events` возвращает stable paginated set с `totalCount`/`complete` только `ADMIN_AUDITOR`.

Audit остаётся business success history, не event sourcing и не operational log. Runtime role не может update/delete rows.

## Последствия

- release fixture даёт проверяемые `254` events одним server-side query;
- event payloads требуют allowlisted schemas и privacy review;
- client merge не считается доказательством completeness;
- при будущем внешнем event delivery потребуется outbox/new ADR, но внутренний audit от него не зависит;
- storage retention пока равен сроку demo deployment, automated purge отсутствует.

## Проверка

- correlation query покрывает каждый event transaction;
- result stable across pagination;
- failure/denial не создаёт success event;
- `correlationId` может возвращаться инициатору successful command как opaque metadata;
- только `ADMIN_AUDITOR` может запросить соответствующий event set;
- authorization выполняется до поиска receipt/events, поэтому неавторизованный запрос не позволяет определить, существует ли указанный `correlationId`.
