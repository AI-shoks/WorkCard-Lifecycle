---
artifact_id: engineering.database-bootstrap
status: accepted
version: 4
owner: engineering
updated: 2026-09-17
---

# Database Bootstrap

Bootstrap отделяет полномочия изменения схемы от runtime-доступа приложения и делает миграции и demo-данные проверяемыми и повторяемыми.

## Последовательность

```text
PostgreSQL healthy
  → migrate: advisory lock → history preflight → runtime role → SQL migrations → atomic grants
  → seed: owner-only transaction → insert-if-absent → exact fixture comparison
  → owner verify: schema + roles + fixtures → initial verified timestamp → open gate
  → app: shared barrier → maintenance/freshness check → runtime role → readiness
```

Мигратор:

1. подключается через `MIGRATION_DATABASE_URL`;
2. захватывает session advisory lock, исключая параллельное применение;
3. создаёт `schema_migrations` при отсутствии;
4. сверяет всю применённую history с именами и SHA-256 файлов; отсутствующая/изменённая применённая версия, дубликаты и вставка версии перед применённой запрещены до нового SQL и изменения runtime-роли;
5. создаёт SQL login-роль приложения или проверяет существующую до допустимого password update; privileged flags, memberships, ownership или повышенные ACL вызывают отказ, а не молчаливое исправление;
6. применяет каждый новый SQL-файл в отдельной транзакции;
7. в отдельной атомарной транзакции задаёт runtime-роли минимальные table-specific `SELECT`/`INSERT`/`UPDATE`/session `DELETE`; immutable/reference tables остаются без mutation-прав. Предварительный отказ для повышенных ACL не подменяется их автоматическим исправлением.

Изменение имени или содержимого применённой миграции приводит к ошибке. Следующее изменение схемы создаётся новым файлом.

CLI использует тот же `runMigrations` из `migration-runner.ts`; тесты передают ему временный каталог SQL, без нового runner или production test hooks. Ошибка нового файла откатывает его DDL, данные и запись версии, сохраняя ранее применённые версии. Весь набор файлов не является одной транзакцией; создание/обновление login-роли также не откатывается с отдельным SQL-файлом.

`quality/migrations.test.ts` воспроизводит сбой после DDL/INSERT и отказ записи history, исправление неприменённого файла и два одновременных повторных запуска, checksum/missing/duplicate history, а также реальный отказ `0003` от потери точности. В последнем случае прежние данные и version 2 сохраняются; только явное исправление тестовой fixture позволяет применить `0003` и повторить migrate. Проверка сбоя grants подтверждает сохранение прежних прав после промежуточного REVOKE и успешный повтор после исправления fixture; ранее закоммиченный SQL/history при этом сохраняется.

## Первая миграция

`0001_foundation.sql` создаёт только подготовительные read-only данные:

- `demo_users` с пятью разрешёнными кодами ролей;
- `production_passports` с обязательной меткой `SYNTHETIC_DEMO`;
- `operation_plans` с положительными количествами и нормами;
- FK, unique и check constraints на уровне PostgreSQL.

## Вторая миграция

`0002_backend-vertical-slice.sql` совместимо расширяет foundation:

- добавляет revision/scope к read-only reference data;
- создаёт server-backed demo sessions;
- создаёт партии, immutable plan snapshots, комплекты и UUID-карточки без sequence/part identity;
- создаёт immutable `FinalBatchAcceptance` и `PayrollRecord`;
- создаёт command receipts, correlation IDs и append-only audit events;
- закрепляет lifecycle, cross-row links, uniqueness и immutable rows PostgreSQL constraints/triggers.

Применённый `0001` не редактировался; существующая БД получает изменения только через последовательную `0002`.

## Третья миграция

`0003_align-operation-plan-norm-precision.sql` приводит foundation-колонку `operation_plans.norm_hours` к принятому `numeric(8,2)`. Перед `ALTER TYPE` она явно отказывается продолжать, если существующее значение потребовало бы округления или не помещается в целевой диапазон. Уже применённые `0001` и `0002` не переписываются.

## Seed

Детерминированный fixture содержит шесть demo users, один синтетический производственный паспорт и три плана операций: `112 + 112 + 26 = 250` карточек. UUID фиксированы только внутри seed и не показываются производственным пользователям.

Seed требует только `MIGRATION_DATABASE_URL` (в hosted также обязательна несекретная проверка expected target), не требует runtime URL, имени или пароля runtime-роли. Он использует owner-подключение, `SERIALIZABLE` transaction и `ON CONFLICT DO NOTHING`, после чего сравнивает каждое сохранённое поле с каноническим fixture. Поэтому повторный запуск безопасен, а существующие отличающиеся данные не перезаписываются молча.

## Hosted owner orchestration

Текущий путь запускает `node dist/owner-maintenance.js <command>` внутри того же проверенного image; на host после build путь — `apps/api/dist/owner-maintenance.js`. Допустимы только четыре фиксированные команды:

| Команда | Действие | Secret boundary |
|---|---|---|
| `bootstrap` | initial migrations + seed + verify, открыть впервые подготовленный gate | owner URL и runtime role name/password |
| `reset` | закрыть gate, удалить mutable demo/sessions, verify, обновить reset timestamp, открыть | только owner URL |
| `verify` | проверить schema/history/roles/fixtures в том числе при закрытом gate; не открыть и не освежить timestamp | только owner URL |
| `release` | закрыть gate, применить forward migrations и grants, verify; сохранить возраст reset | owner URL и runtime role name/password |

Все hosted команды требуют `APP_ENV`, `NEON_DATABASE_HOST`, `NEON_DATABASE_NAME` и direct URL с `sslmode=verify-full`; точные env names — [[environments]]. Runtime/browser owner secrets не получают. Обычный reset не вызывает seed. Bootstrap на уже инициализированной БД не должен обновлять `last_reset_verified_at` и маскировать просроченный reset.

Non-superuser owner получает только необходимые schema/role administration privileges. SQL `CREATE ROLE` использует безопасные defaults; на `ALTER ROLE` не переносятся superuser-only `NOSUPERUSER`/`NOREPLICATION`. До изменения проверяются flags, memberships (включая `neon_superuser`) и ownership любых объектов через `pg_shdepend`, а не только известных application tables. Ограничения non-superuser `ALTER ROLE` — [PostgreSQL 18](https://www.postgresql.org/docs/18/sql-alterrole.html). Найденная повышенная роль требует отдельного решения оператора, запуск прекращается. Hosted qualification отдельно проверяет реальные возможности Neon owner; локальный non-superuser fixture не доказывает provider-specific grants.

## Постоянный maintenance state и барьер

`0004_demo-maintenance-state.sql` создаёт owner-managed singleton `demo_maintenance_state` с `maintenance`, `maintenance_requested`, `generation`, `last_reset_verified_at`, `runtime_role_name`; runtime получает только чтение. Исторические SQL `0001`–`0003` не изменяются. `demo_sessions.generation` привязывает session к поколению demo.

Каждая runtime DB операция, включая reference reads, readiness, session create/touch/delete/cleanup, projection и command, идёт через transaction-level shared advisory lock. **Отдельный SQL statement после lock** в `READ COMMITTED` проверяет gate/generation/freshness: один statement с ожиданием lock мог бы прочитать старый snapshot. Барьер использует ключ, отличный от capacity locks. Owner orchestration сериализуется отдельным session advisory mutex. Перед ожиданием exclusive barrier отдельным commit сохраняется `maintenance_requested=true`: runtime admission уже запрещён. Exclusive barrier дожидается ранее допущенных transactions, после чего owner фиксирует `maintenance=true` и новую generation. Runtime требует оба maintenance flags false; timeout/termination во время drain оставляет requested flag в DB и не допускает новые операции.

Authentication вне command transaction не является достаточной: после shared barrier и до receipt executor повторно сверяет существующую active session и generation. Это исключает `auth → reset → command` как для новой команды, так и для receipt replay.

Requested и затем maintenance close коммитятся до reset/migration. Ошибка/cancellation не делает безусловного reopen; только успешное verified завершение очищает оба флага. Timestamp устанавливается только после успешных initial bootstrap + verify или reset + verify; simple verify и release его не меняют. Через 26 часов API закрывается `503`, `/health/live` остаётся независимым от БД. Suspend/202 Render, sleep или фиксированный drain timeout не используются как DB barrier.

## Локальные команды и доказательства

```powershell
pnpm db:bootstrap
pnpm db:verify
```

Команды выполняются в отдельной owner shell с `.env.owner`, API — в отдельной runtime shell с `.env`. Совместимые низкоуровневые `db:migrate`/`db:seed` сохранены: migrate закрывает gate и оставляет закрытым, seed + verify завершает initial bootstrap; повтор не освежает timestamp. `db:reset-demo` выполняет полный owner reset contract. После 26h repeat bootstrap/release отказываются reopen: нужен reset.

`db:verify` теперь использует только owner URL: проверяет history/checksums, канонические fixtures и runtime privileges через catalogs (`has_table_privilege`), атрибуты, memberships и ownership роли. Он не использует runtime password или `SET ROLE`, не открывает gate и не обновляет timestamp. Проверяются:

- текущую версию схемы;
- наличие шести пользователей и пяти ролей;
- состав трёх операций и сумму `250`;
- успешное чтение;
- отсутствие runtime mutation grant на справочники; реальный PostgreSQL `42501` проверяется отдельно runtime connection в локальных integration/quality tests;
- отсутствие batch-level `norm_hours`, `sequence_number` и `part_number`;
- наличие runtime mutation-прав только у изменяемых таблиц и отсутствие `UPDATE/DELETE` у audit/final/payroll.

## Откат

Автоматические destructive down migrations не используются. Для production откат означает возврат совместимой версии приложения. При несовместимой schema gate остаётся закрытым до forward fix либо отдельно разрешённого чистого восстановления migrations + seed + verify; сохранять историю посетителей не требуется. В disposable local/test среде полная переинициализация удаляет только созданные для проверки cluster/DB/volume.

## Критерий принятия

Исторический baseline этапа 7: миграции `0001`–`0003` применены к чистой PostgreSQL, повторный migrate подтвердил checksum, seed повторяем, runtime verification и DB integration suite прошли. PostgreSQL 18.6 дополнительно проверяется CI service/container job.

Новый gate дополнительно проверяет bootstrap/repeat с non-superuser owner, privilege rejection, runtime read-only maintenance state, migration checksums, read/session/command races, auth-reset race, cancellation и fail-closed age. Результаты текущего прохода перечислены отдельно в [[quality-gates]]; существующая история успешных тестов не объявляется проверкой новых изменений или Neon.
