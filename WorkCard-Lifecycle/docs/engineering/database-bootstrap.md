---
artifact_id: engineering.database-bootstrap
status: accepted
version: 3
owner: engineering
updated: 2026-09-05
---

# Database Bootstrap

Bootstrap отделяет полномочия изменения схемы от runtime-доступа приложения и делает миграции и demo-данные проверяемыми и повторяемыми.

## Последовательность

```text
PostgreSQL healthy
  → migrate: advisory lock → history preflight → runtime role → SQL migrations → atomic grants
  → seed: transaction → insert-if-absent → exact fixture comparison
  → app: runtime role → readiness
```

Мигратор:

1. подключается через `MIGRATION_DATABASE_URL`;
2. захватывает session advisory lock, исключая параллельное применение;
3. создаёт `schema_migrations` при отсутствии;
4. сверяет всю применённую history с именами и SHA-256 файлов; отсутствующая/изменённая применённая версия, дубликаты и вставка версии перед применённой запрещены до нового SQL и изменения runtime-роли;
5. создаёт или безопасно обновляет отдельную login-роль приложения;
6. применяет каждый новый SQL-файл в отдельной транзакции;
7. в отдельной атомарной транзакции отзывает лишние права и выдаёт runtime-роли минимальные table-specific `SELECT`/`INSERT`/`UPDATE`/session `DELETE`; immutable/reference tables остаются без mutation-прав.

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

Seed использует owner-подключение, `SERIALIZABLE` transaction и `ON CONFLICT DO NOTHING`, после чего сравнивает каждое сохранённое поле с каноническим fixture. Поэтому повторный запуск безопасен, а существующие отличающиеся данные не перезаписываются молча.

## Команды и доказательства

```powershell
pnpm db:migrate
pnpm db:seed
pnpm db:verify
```

`db:verify` подключается именно runtime-ролью и доказывает:

- текущую версию схемы;
- наличие шести пользователей и пяти ролей;
- состав трёх операций и сумму `250`;
- успешное чтение;
- отказ PostgreSQL `42501` при попытке `UPDATE` справочника;
- отсутствие batch-level `norm_hours`, `sequence_number` и `part_number`;
- наличие runtime mutation-прав только у изменяемых таблиц и отсутствие `UPDATE/DELETE` у audit/final/payroll.

## Откат

Автоматические destructive down migrations не используются. Для production откат означает возврат совместимой версии приложения; необратимое изменение данных требует отдельного плана backup/restore и ADR. В disposable local/test среде полная переинициализация выполняется удалением только проектного Docker volume.

## Критерий принятия

Миграции `0001`–`0003` применены к чистой PostgreSQL, повторный migrate подтвердил checksum, seed повторяем, runtime verification и DB integration suite прошли. PostgreSQL 18.6 дополнительно проверяется CI service/container job.
