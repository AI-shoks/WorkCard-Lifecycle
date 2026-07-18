---
artifact_id: architecture.er-model
status: accepted
version: 1
owner: architecture
updated: 2026-07-18
---

# ER Model

Физическая PostgreSQL-модель MVP v1. Она реализует, но не заменяет [[domain-model]]: aggregates и инварианты остаются предметными, а таблицы, keys и indexes — техническими средствами.

## Диаграмма

```mermaid
erDiagram
    PRODUCTION_PASSPORTS ||--|{ OPERATION_PLANS : defines
    PRODUCTION_PASSPORTS ||--o{ PRODUCTION_BATCHES : selected_for
    PRODUCTION_BATCHES ||--o{ WORK_CARD_SETS : releases
    PRODUCTION_BATCHES ||--o| FINAL_BATCH_ACCEPTANCES : has
    WORK_CARD_SETS ||--|{ WORK_CARDS : groups
    DEMO_USERS ||--o{ WORK_CARDS : assigned_to
    DEMO_USERS ||--o{ FINAL_BATCH_ACCEPTANCES : records
    WORK_CARDS ||--o| PAYROLL_RECORDS : exported_as
    DEMO_USERS ||--o{ PAYROLL_RECORDS : benefits
    COMMAND_RECEIPTS ||--o{ AUDIT_EVENTS : correlates

    PRODUCTION_PASSPORTS {
      uuid id PK
      text code
      text revision
      text product_name
      boolean active
    }
    OPERATION_PLANS {
      uuid id PK
      uuid passport_id FK
      integer position
      jsonb operation_scope
      numeric norm_hours
      integer planned_card_count
    }
    PRODUCTION_BATCHES {
      uuid id PK
      uuid passport_id FK
      jsonb passport_snapshot
      integer batch_quantity
      text lifecycle_status
      integer version
      timestamptz created_at
      timestamptz released_at
    }
    WORK_CARD_SETS {
      uuid id PK
      uuid batch_id FK
      text operation_plan_key
      jsonb operation_scope_snapshot
      numeric norm_hours_snapshot
      integer planned_card_count
      text gate_status
      uuid first_article_work_card_id FK
      integer version
    }
    WORK_CARDS {
      uuid id PK
      uuid set_id FK
      uuid batch_id FK
      integer batch_quantity_snapshot
      jsonb operation_scope_snapshot
      numeric norm_hours_snapshot
      text purpose
      text status
      uuid assignee_id FK
      integer version
    }
    FINAL_BATCH_ACCEPTANCES {
      uuid id PK
      uuid batch_id FK_UK
      uuid controller_id FK
      uuid command_id UK
      timestamptz accepted_at
      integer resulting_batch_version
    }
    PAYROLL_RECORDS {
      uuid id PK
      uuid work_card_id FK_UK
      uuid beneficiary_id FK
      numeric norm_hours_snapshot
      timestamptz exported_at
    }
    AUDIT_EVENTS {
      uuid id PK
      text aggregate_type
      uuid aggregate_id
      integer aggregate_version
      text event_type
      uuid actor_id FK
      text actor_role
      uuid command_id
      uuid correlation_id
      timestamptz occurred_at
      jsonb data
    }
    COMMAND_RECEIPTS {
      uuid command_id PK
      text command_type
      text request_hash
      uuid correlation_id UK
      text result_type
      uuid result_id
      jsonb result_summary
      timestamptz completed_at
    }
    DEMO_USERS {
      uuid id PK
      text display_name
      text role
      boolean active
    }
```

## Общие соглашения

- ID — application-generated UUID; ни один `work_cards.id` не является номером детали.
- Время — `timestamptz` в UTC; отображение локали выполняет frontend.
- `version` начинается с `1` и увеличивается ровно на один при изменении агрегата.
- `numeric(8,2)` хранит положительные нормо-часы без floating-point ошибок.
- enum-коды представлены `text` + `CHECK`, чтобы migrations явно управляли допустимыми значениями.
- JSONB используется только для неизменяемых typed snapshots/event data; текущие queryable state и связи остаются колонками.
- Business tables не используют soft delete: delete/update API для immutable и released данных отсутствует.

## Reference data

### `production_passports`

| Колонка | Ограничение |
|---|---|
| `id` | PK |
| `code`, `revision` | `NOT NULL`, `UNIQUE (code, revision)`; пользовательский код не является UUID |
| `product_name` | `NOT NULL`, непустое значение |
| `active` | `NOT NULL DEFAULT true`; неактивный паспорт нельзя выбрать для новой партии |

### `operation_plans`

| Колонка | Ограничение |
|---|---|
| `passport_id` | FK `production_passports(id)`, `ON DELETE RESTRICT` |
| `position` | positive; unique `(passport_id, position)` |
| `operation_scope` | валидированный JSON snapshot source: code, русское display name, optional group members |
| `norm_hours` | `> 0` |
| `planned_card_count` | positive integer |

Паспорт и operation plans загружаются seed migration и не редактируются production endpoints.

### `demo_users`

`role` ограничен значениями `PLANNER`, `MASTER`, `WORKER`, `QUALITY_CONTROLLER`, `ADMIN_AUDITOR`. Только `active = true` identity может быть выбрана demo-session. Assignee/beneficiary обязан ссылаться на пользователя с ролью `WORKER`; это межтабличное правило проверяет application service и integration test.

## Производственное состояние

### `production_batches`

- `batch_quantity > 0`;
- `passport_id` — provenance FK; `passport_snapshot` — неизменяемое содержимое паспорта и всех operation plans на момент создания;
- `lifecycle_status IN ('CREATED', 'RELEASED', 'FINAL_ACCEPTED')`;
- `released_at` заполнено только для `RELEASED`/`FINAL_ACCEPTED`;
- один норматив партии и массив карточек отсутствуют;
- созданные sets читаются по FK `work_card_sets.batch_id`, а не хранятся как изменяемый JSON-список.

### `work_card_sets`

- FK `batch_id` с `ON DELETE RESTRICT`;
- `operation_plan_key` — immutable key из passport snapshot; unique `(batch_id, operation_plan_key)`;
- `planned_card_count > 0`, `norm_hours_snapshot > 0`;
- `gate_status IN ('FIRST_ARTICLE_PENDING', 'SERIAL_ALLOWED')`;
- unique `(id, batch_id)` поддерживает composite FK карточки на тот же batch;
- `first_article_work_card_id` nullable/unique; deferrable composite FK `(first_article_work_card_id, id) → work_cards(id, set_id)` гарантирует ту же card set;
- `SERIAL_ALLOWED` требует непустой `first_article_work_card_id`;
- соответствие выбранной карточки тому же set проверяется в транзакции и integration test;
- `version >= 1`.

### `work_cards`

| Инвариант | Physical guard |
|---|---|
| карточка принадлежит set и batch | composite FK `(set_id, batch_id) → work_card_sets(id, batch_id)` |
| UUID без sequence | PK `id`; колонок `sequence_number`, `part_number`, `serial_number` нет |
| immutable snapshots | `batch_quantity_snapshot > 0`, `norm_hours_snapshot > 0`, JSON scope not null; business update не включает эти колонки |
| purpose | nullable только в `RELEASED`; далее `FIRST_ARTICLE | SERIAL` |
| assignee | nullable только в `RELEASED`; далее FK на `demo_users` |
| status | `RELEASED | ASSIGNED | IN_PROGRESS | COMPLETED | CLOSED` |
| terminal close | update repository не имеет перехода из `CLOSED` |
| одна first article на set | unique partial index на `set_id WHERE purpose = 'FIRST_ARTICLE'`; unique `(id, set_id)` поддерживает FK из set |
| optimistic locking | `version >= 1`; updates используют `WHERE id = ? AND version = ?` |

Переходные сведения хранят `started_at/started_by_master_id`, `completed_at/completed_by_master_id`, `closed_at/closed_by_quality_controller_id` и `close_kind = FIRST_ARTICLE_ACCEPTANCE | WORK_CARD_QUALITY`. CHECK constraints требуют согласованные поля для каждого состояния; точные переходы всё равно проверяет [[work-card-state-machine]].

## Неизменяемые результаты

### `final_batch_acceptances`

- `batch_id` — FK + `UNIQUE`, поэтому партия имеет не более одной записи;
- `command_id` — `UNIQUE` и связан с successful receipt;
- `controller_id` ссылается на trusted `QUALITY_CONTROLLER`;
- `resulting_batch_version > 0` и равна версии партии после `FINAL_ACCEPTED`;
- update/delete отсутствуют у application DB role;
- запись, batch status/version, receipt и `FinalBatchAccepted` создаются одной транзакцией.

`production_batches` не дублирует acceptance ID: связь и read-back получаются по unique `final_batch_acceptances.batch_id`. Это физическая нормализация необязательной концептуальной ссылки, а не изменение [[domain-model]].

### `payroll_records`

- `work_card_id` — FK + `UNIQUE`;
- `beneficiary_id` равен текущему immutable assignee закрытой карточки;
- `norm_hours_snapshot > 0` и копируется из WorkCard;
- update/delete отсутствуют;
- money, tax, actual time и external status отсутствуют.

## Commands и audit

### `command_receipts`

Successful command reserve хранит глобально уникальный `command_id`, command type, hash канонического входа, server-generated `correlation_id` и минимальный read-back result. Receipt записывается в транзакции команды. Неуспешная команда receipt не оставляет.

- повтор того же ID с другим type/hash — conflict;
- `RecordFinalBatchAcceptance` replay того же type/hash возвращает исходный result;
- обычная non-replayable команда с уже завершённым ID не выполняется повторно;
- payroll дополнительно идемпотентен по `payroll_records.work_card_id`.

### `audit_events`

Обязательные поля соответствуют [[commands-events]]. Ограничения:

- PK `id`;
- unique `(aggregate_type, aggregate_id, aggregate_version)` — ровно один success fact на изменённый агрегат/версию в текущем каталоге команд;
- `aggregate_version > 0`;
- `command_receipts` имеет unique `(command_id, correlation_id)`; `audit_events` использует deferrable composite FK `(command_id, correlation_id) → command_receipts(command_id, correlation_id)`;
- `data` — JSON object, not null;
- application role имеет только `INSERT` и `SELECT`;
- guard trigger отклоняет `UPDATE`/`DELETE`, включая случай случайно расширенных privileges.

Indexes:

- `(aggregate_type, aggregate_id, aggregate_version, occurred_at, id)` для history;
- `(correlation_id, occurred_at, id)` для полного operation context;
- `(command_id)` для replay/debug linkage;
- `(event_type, occurred_at)` для проверок и диагностики.

## Транзакционные инварианты

| Операция | Таблицы в одной транзакции |
|---|---|
| create batch | `production_batches`, `command_receipts`, `audit_events` |
| release | `production_batches`, `work_card_sets`, `work_cards`, receipt, audit всех изменённых агрегатов |
| assignment | `work_card_sets` при first article, выбранные `work_cards`, receipt, audit |
| start/complete/per-card quality | одна `work_cards`, receipt, audit |
| first-article acceptance | `work_cards`, `work_card_sets`, receipt, два audit events |
| final-batch acceptance | `production_batches`, `final_batch_acceptances`, receipt, audit |
| first payroll export | `payroll_records`, receipt, audit; WorkCard state/version не меняются |

Детали isolation и lock order определены в [[transactions-concurrency]].

## Канонические DB-проверки fixture

- одна batch quantity `112`;
- три sets с `planned_card_count = 112, 112, 26`;
- `COUNT(work_cards) = 250` и count каждого set равен plan;
- каждая WorkCard имеет `batch_quantity_snapshot = 112`;
- в схеме нет sequence/physical-part columns;
- нормы как минимум двух sets могут различаться;
- assignment summary первого set равен `60 + 52 = 112`;
- `CLOSED = 250` без строки `final_batch_acceptances` всё ещё означает «финальная приёмка не записана»;
- после отдельной команды существует ровно одна acceptance row и batch `FINAL_ACCEPTED`.
