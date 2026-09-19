---
artifact_id: engineering.database-bootstrap
status: accepted
version: 5
owner: engineering
updated: 2026-09-19
---

# Database Bootstrap

Bootstrap отделяет полномочия изменения схемы от runtime-доступа приложения и делает миграции и demo-данные проверяемыми и повторяемыми.

## Последовательность

```text
PostgreSQL healthy
  → migrate: advisory lock → history preflight → runtime role → SQL migrations → atomic grants
  → Neon prerequisite: separate owner role/database defaults → fresh runtime budget inspection
  → seed: owner-only transaction → insert-if-absent → exact fixture comparison
  → owner verify: schema + roles + fixtures → initial verified timestamp → open gate
  → app: shared barrier → maintenance/freshness check → runtime role → readiness
```

Строка Neon — отдельная подготовка окружения, не новая команда или стадия внутри owner CLI. Перед первым hosted bootstrap `node dist/migrate.js` из выбранного immutable image создаёт schema/runtime role и оставляет gate закрытым. Затем выполняются описанные ниже owner-only настройки и свежее runtime-наблюдение; fixed `bootstrap` безопасно повторяет migrate перед seed + verify.

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

## Neon: настройки timeout для runtime-роли в выбранной БД

Hosted staging-наблюдение 2026-09-19 обнаружило фактические значения transaction/statement/lock/idle `15000/0/0/300000` мс при неизменённых exports image `15000/10000/3000/15000`. Это расхождение эффективных настроек, а не представление секунд вместо миллисекунд. В исследованном [исходнике Neon proxy](https://github.com/neondatabase/neon/blob/fa504217c61bbcaf5c512d75830564541f917f8f/proxy/src/compute/mod.rs#L196-L225) отдельные startup parameters отбрасываются при `arbitrary_params=false`, а `options` передаются отдельно; [TCP path](https://github.com/neondatabase/neon/blob/fa504217c61bbcaf5c512d75830564541f917f8f/proxy/src/proxy/mod.rs#L83-L85) выбирает этот режим без compatibility option. Это объяснение, согласующееся с наблюдением, не утверждение о SHA развёрнутого provider proxy. Значения каждого target проверяются через реальное подключение.

Минимальная настройка сохраняет budgets приложения: только `statement_timeout=10000`, `lock_timeout=3000`, `idle_in_transaction_session_timeout=15000` мс для `workcard_app` **IN DATABASE** точной разрешённой БД. `transaction_timeout=15000` уже передаётся image через `options: '-c transaction_timeout=15000'`; его role default не менять и не сбрасывать. Не менять application, migrations, exported budgets или image. Direct URL по-прежнему содержит единственный query `?sslmode=verify-full`; `PGOPTIONS`, URL `options` и TLS overrides запрещены.

Перед отдельной owner-only операцией обязательны:

1. Live binding разрешённых organization/project и distinct staging/production endpoints; совпадение `APP_ENV`, exact direct host, database, PostgreSQL 18, `current_user=session_user=workcard_owner`. Одно имя `workcard` не определяет target. Произвольные target/role/SQL inputs не допускаются.
2. Завершённые same-image migrations, зарегистрированная `workcard_app` и успешный runtime role boundary check. Owner владеет выбранной БД, имеет `CREATEROLE` и прямой `ADMIN OPTION` на эту обычную роль. При недостаточных полномочиях остановиться; не выдавать privileges/membership автоматически.
3. Deployed owner mutex и отсутствие иных owner operations/connections. До изменения сохранить sanitized intent и исходное состояние: relevant defaults, unrelated settings, role attributes и maintenance state. Более строгий положительный timeout или неизвестное значение требуют разбора; не увеличивать его до указанного budget.

После этих проверок для `workcard` в одном установленном approved project выполнить ровно три изменения в одной транзакции:

```sql
BEGIN;
ALTER ROLE workcard_app IN DATABASE workcard SET statement_timeout TO '10000ms';
ALTER ROLE workcard_app IN DATABASE workcard SET lock_timeout TO '3000ms';
ALTER ROLE workcard_app IN DATABASE workcard SET idle_in_transaction_session_timeout TO '15000ms';
COMMIT;
```

Это отдельный reviewed SQL runbook: fixed `migrate`/`bootstrap`/`reset`/`verify` не выполняют эти три SET. Пароль, privileges/membership, global role defaults, схема, данные, gate/generation и reset timestamp не изменяются. До commit и отдельным read-only readback после него проверить три defaults и сохранность остального, включая существующий transaction default. При timeout/неизвестном исходе сохранить intent и сначала read-only reconciliation; не повторять mutation вслепую.

Затем новый runtime-only процесс того же image с неизменённым `databaseBudgets` открывает новое соединение как `workcard_app`, подтверждает exact host/database, PostgreSQL 18, actual TLS CA/hostname и role boundary. Owner URL и реальный signing secret этому диагностическому процессу не нужны; owner credentials запрещены runtime/browser. В `BEGIN READ ONLY` получить только:

```sql
SELECT name, setting, unit
FROM pg_catalog.pg_settings
WHERE name IN ('transaction_timeout', 'statement_timeout',
               'lock_timeout', 'idle_in_transaction_session_timeout')
ORDER BY name;
```

Завершить `ROLLBACK`. Требуются ровно четыре уникальные строки, `unit=ms` и числовое равенство:

| Setting | Значение, мс |
|---|---:|
| `transaction_timeout` | `15000` |
| `statement_timeout` | `10000` |
| `lock_timeout` | `3000` |
| `idle_in_transaction_session_timeout` | `15000` |

`pg_settings.setting` содержит текст текущего значения, `unit` — его единицу; строки `15s`/`15000` нельзя сравнивать как свидетельство разных budgets без проверки единиц. Role/database defaults применяются при новом login: старый pool, owner session и `SET ROLE` не заменяют fresh runtime proof. См. [pg_settings](https://www.postgresql.org/docs/18/view-pg-settings.html) и [ALTER ROLE](https://www.postgresql.org/docs/18/sql-alterrole.html).

Настройку завершить после создания runtime-роли и до app/cancellation/deployment qualification. Same-image повторный migrate меняет существующей роли только пароль и grants; `reset`/`verify` не сбрасывают эти defaults. После bootstrap/reset + verify подтвердить их сохранность новым runtime-наблюдением. Для новой recovery БД в уже разрешённом staging project повторить exact database configuration после migrations: `IN DATABASE workcard` не распространяется на другое имя. Recovery database identifier фиксируется оператором для конкретного разрешённого drill, не принимается как произвольный SQL input. Пересоздание роли/БД тоже требует повторной настройки и проверки.

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
