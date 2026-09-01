---
artifact_id: architecture.system-context
status: accepted
version: 1
owner: architecture
updated: 2026-09-01
---

# System Context

Production Work Card Workflow — независимое demo-приложение. Оно хранит только синтетические производственные данные и не подключается к реальным MES, ERP, кадровым или расчётным системам.

## Контекст

```mermaid
C4Context
    title Production Work Card Workflow — system context
    Person(planner, "ПДБ", "Создаёт партию и выпускает комплекты")
    Person(master, "Мастер", "Назначает и фиксирует выполнение")
    Person(worker, "Исполнитель", "Читает назначенную работу")
    Person(qc, "Контролёр БТК", "Принимает первую деталь, карточку и завершённую партию")
    Person(admin, "Администратор / аудитор", "Читает аудит и запускает mock export")
    System(system, "Production Work Card Workflow", "Браузерный MVP жизненного цикла рабочей карточки")
    System_Ext(payroll, "Payroll", "Внешняя система отсутствует; используется внутренний mock adapter")

    Rel(planner, system, "HTTPS, русский UI")
    Rel(master, system, "HTTPS, русский UI")
    Rel(worker, system, "HTTPS, read-only UI")
    Rel(qc, system, "HTTPS, русский UI")
    Rel(admin, system, "HTTPS, audit/payroll UI")
    Rel(system, payroll, "Не вызывает в MVP", "явная mock-граница")
```

Mock payroll показан как внешняя граница смысла, но не как реальная сеть: реализация MVP записывает единственную `PayrollRecord` в собственную БД через порт [[mock-integrations]].

## Контейнеры

```mermaid
C4Container
    title Production Work Card Workflow — containers
    Person(user, "Demo-пользователь", "Переключает подготовленные роли")
    Container(web, "Web SPA", "React, TypeScript", "Русский permission-aware UI")
    Container(api, "API", "Fastify, TypeScript", "Доверенная сессия, команды, queries, OpenAPI")
    ContainerDb(db, "PostgreSQL", "PostgreSQL 18", "Текущее состояние, snapshots, receipts, append-only audit")

    Rel(user, web, "Работает в браузере", "HTTPS")
    Rel(web, api, "JSON API под тем же origin", "HTTPS /api/v1")
    Rel(api, db, "Параметризованный SQL", "TLS в hosted environment")
```

В production API раздаёт статическую сборку SPA и JSON API под одним origin. В development Vite работает отдельным процессом, но проксирует `/api` в API, поэтому browser security model остаётся same-origin.

## Границы доверия

1. **Браузер недоверенный.** `role`, `actorId`, `assigneeId`, versions и hidden controls из клиента не дают полномочий.
2. **API — граница авторизации.** Он восстанавливает actor/role из подписанной demo-session, валидирует схему, permission, state, gate и версии.
3. **PostgreSQL — граница атомарности.** Предметные изменения, command receipt и audit events коммитятся одной транзакцией.
4. **Reference data синтетические и read-only.** UI не редактирует паспорта, operation plans или нормы.
5. **Mock payroll не является реальной интеграцией.** Нет исходящего HTTP, денег, персональных начислений или фоновой доставки.

## Backend-модули

| Модуль | Ответственность | Не владеет |
|---|---|---|
| `demo-auth` | подготовленные demo-users, серверная session, role switch, CSRF | production IAM, пароли, RBAC editor |
| `passports` | read-only паспорта и operation plans | интерактивное редактирование технологии/норм |
| `batches` | создание партии, snapshot, выпуск, финальная приёмка | состояние отдельной карточки |
| `work-card-sets` | operation scope, first-article gate, массовое назначение | финальная приёмка партии |
| `work-cards` | assignment, lifecycle, per-card quality confirmation | идентичность физической детали |
| `audit` | append-only события и полный query по `correlationId` | восстановление текущего состояния через replay |
| `payroll` | порт и идемпотентный mock adapter | денежный расчёт или внешняя доставка |

Модули вызываются через application services; route handlers только аутентифицируют запрос, валидируют contract и преобразуют результат/ошибку в HTTP.

## Основной поток данных

```mermaid
sequenceDiagram
    actor User as Demo-пользователь
    participant Web as React SPA
    participant API as Fastify API
    participant DB as PostgreSQL

    User->>Web: Подтверждает действие
    Web->>API: POST commandId + expectedVersion(s)
    API->>API: session, CSRF, permission, schema
    API->>DB: BEGIN; receipt; deterministic locks
    API->>DB: validate state/gate/version
    API->>DB: state changes + audit events + receipt
    API->>DB: COMMIT
    API-->>Web: resource + versions + correlationId
    Web->>API: GET актуальной projection
    API-->>Web: server state
```

Клиент не показывает optimistic success до ответа API и не ставит mutations в offline/background queue.

## Runtime и deployment shapes

| Среда | Процессы | Данные |
|---|---|---|
| Local | `web`, `api`, `postgres` через Compose; migration/seed как one-shot profiles | именованный Docker volume; допустим явный reset только командой разработчика |
| CI | build/test jobs + чистая PostgreSQL service/container | ephemeral database на job |
| Hosted demo | один OCI application container + managed PostgreSQL | migrations перед rollout, backup/restore определяются этапом 10 |

## Нефункциональные границы MVP

- один регион и один экземпляр API достаточны; correctness не зависит от in-memory locks;
- API stateless кроме подписанной/DB-backed demo-session;
- нет broker, cache, WebSocket, offline mode или cron jobs;
- список карточек использует cursor pagination, а не выдачу всех `250` rows по умолчанию;
- health endpoints разделяют liveness и readiness;
- системные UTC timestamps отображаются пользователю в локальной зоне браузера;
- технические UUID и enum доступны API/закрытому developer context, но не называются номерами деталей в производственном UI.

## Граница готовности

Этот документ определяет целевую архитектуру. Реализация контейнеров, health checks и local runtime относится к этапу 6; наличие схемы на диаграмме не является заявлением о работающем backend/frontend.
