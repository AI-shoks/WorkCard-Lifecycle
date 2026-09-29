---
artifact_id: architecture.adr.0010
status: accepted
version: 1
owner: architecture
updated: 2026-09-27
supersedes:
  - "[[0001-typescript-modular-monolith-stack]]"
  - "[[0006-idempotent-local-payroll-adapter]]"
---

# ADR-0010. pg/SQL и локальная payroll-команда в общем application service

## Контекст

Финальная статическая сверка этапа 12 обнаружила расхождение архитектурного выбора с реализацией: ADR-0001 предполагал Drizzle вместе с `node-postgres`, а ADR-0006 — `PayrollExportService`, `PayrollPort` и отдельный adapter. В текущем коде установлен `pg`, запросы написаны явно в SQL, а `createWorkflowService` содержит `exportWorkCardToPayroll` и общий `executeCommand`. Указанных ORM и payroll-абстракций нет.

Документация должна описывать реализованный MVP, сохраняя историю первоначальных решений. В рамках этого аудита приложение и инфраструктура не меняются; новый ADR фиксирует текущую границу, а не заявляет, что первоначально выбранные абстракции были реализованы.

## Варианты

1. Добавить Drizzle и отдельные payroll port/adapter без нового функционального требования.
2. Принять явный `pg`/SQL и локальную payroll-команду общего application service как текущую архитектуру MVP.
3. Сохранить расхождение между действующими ADR и кодом как неопределённую будущую работу.

## Решение

Выбран вариант 2. Сохраняется TypeScript monorepo на Node 24: React 19/Vite 8 SPA, Fastify 5 API, PostgreSQL 18, TypeBox/OpenAPI и Vitest/Playwright. Production API раздаёт SPA под одним origin. Точные версии задают manifests, lockfile и image references; текущий hosted shape определяет [[0009-render-free-neon-free-release|ADR-0009]].

Доступ к данным выполняется через `pg` и параметризованные `Pool`/`PoolClient.query`. SQL migrations хранятся в Git; migration runner проверяет историю и checksums, применяет каждую новую migration в транзакции и отдельно выдаёт runtime grants. Drizzle и ORM runtime-sync не входят в реализацию.

`api-routes.ts` отвечает за session, permission, Origin/CSRF, схемы и HTTP result; `workflow-service.ts` объединяет предметные команды, SQL и query projections. Предметные области являются логическими границами общего service, а не отдельными repository/port/adapter модулями.

`exportWorkCardToPayroll` под `FOR UPDATE` карточки проверяет version, `CLOSED` и assignee, читает существующую запись либо вставляет immutable `payroll_records`. Общий `executeCommand` коммитит result, success receipt и audit event одной PostgreSQL-транзакцией. Unique `work_card_id` остаётся дополнительной защитой business idempotency. Конкурирующие exports сериализуются lock карточки; новый command для существующей записи получает отдельный receipt с нулём events. Same-command replay возвращает сохранённый body без нового receipt.

## Причины

- Явный SQL непосредственно выражает locks, version predicates и общую транзакцию, от которых зависит MVP.
- Локальный immutable payroll result демонстрирует передачу operation-scoped нормы и защиту от двойной записи без внешнего side effect.
- Добавление неиспользуемого ORM/port ради соответствия первоначальному плану не требуется для этих свойств.
- Ограничение структуры service признаётся явно: границу будущего provider ещё предстоит выделить.

## Последствия и границы

- ADR-0001 и ADR-0006 заменены целиком; их первоначальные body сохранены. Их неизменённые инварианты — один процесс, общая PostgreSQL-транзакция, mock без денег и внешней сети — подтверждены здесь.
- ADR-0002–0005 продолжают определять предметные и транзакционные инварианты; слово repository в первоначальном дизайне не является свидетельством существования отдельного слоя в текущем коде.
- Нет `PayrollPort`, `PayrollExportService` или `PostgresMockPayrollAdapter`; реальная интеграция потребует нового ADR, выделения границы provider, outbox, delivery/reconciliation, credentials и privacy agreement. Прямой внешний HTTP внутри текущей DB-транзакции не допускается.
- Карточка не меняет status/version от export; в payroll record нет денег, налогов, выплат или фактического времени.
- Этот ADR не отменяет acceptance criteria и не подтверждает выполнение тестов, deployment или rollback drill. Обнаруженные различия между ожидаемыми guarantees и кодом должны оставаться явными замечаниями финального аудита.

## Статические основания

- [API manifest](../../../apps/api/package.json): зависимость `pg`, Drizzle отсутствует.
- [Workflow service](../../../apps/api/src/workflow-service.ts): `executeCommand`, `exportWorkCardToPayroll`, `loadPayrollRecord`, `insertAuditEvents`.
- [API routes](../../../apps/api/src/api-routes.ts): authorization и `Idempotent-Replay` для same-command/business replay.
- [SQL migration](../../../apps/api/migrations/0002_backend-vertical-slice.sql): unique payroll key, immutable triggers, receipts и audit.
- [Migration runner](../../../apps/api/src/migration-runner.ts): SQL history/checksums и runtime grants.

Пути выше устанавливают соответствие документации коду рабочего дерева; наличие тестов отделено от evidence их выполнения в [[quality-gates]] и [[requirements-traceability]].
