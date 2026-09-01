---
artifact_id: engineering.database-bootstrap
status: accepted
version: 1
owner: engineering
updated: 2026-09-01
---

# Database Bootstrap

Bootstrap отделяет полномочия изменения схемы от runtime-доступа приложения и делает миграции и demo-данные проверяемыми и повторяемыми.

## Последовательность

```text
PostgreSQL healthy
  → migrate: advisory lock → runtime role → SQL migrations → grants
  → seed: transaction → insert-if-absent → exact fixture comparison
  → app: runtime role → readiness
```

Мигратор:

1. подключается через `MIGRATION_DATABASE_URL`;
2. захватывает session advisory lock, исключая параллельное применение;
3. создаёт или безопасно обновляет отдельную login-роль приложения;
4. создаёт `schema_migrations`;
5. сверяет SHA-256 checksum уже применённых файлов;
6. применяет каждый новый SQL-файл в отдельной транзакции;
7. отзывает лишние права и выдаёт runtime-роли только нужный `SELECT`.

Изменение имени или содержимого применённой миграции приводит к ошибке. Следующее изменение схемы создаётся новым файлом.

## Первая миграция

`0001_foundation.sql` создаёт только подготовительные read-only данные:

- `demo_users` с пятью разрешёнными кодами ролей;
- `production_passports` с обязательной меткой `SYNTHETIC_DEMO`;
- `operation_plans` с положительными количествами и нормами;
- FK, unique и check constraints на уровне PostgreSQL.

Таблицы жизненного цикла карточек принадлежат backend vertical slice этапа 7.

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
- отказ PostgreSQL `42501` при попытке `UPDATE` справочника.

## Откат

Автоматические destructive down migrations не используются. Для production откат означает возврат совместимой версии приложения; необратимое изменение данных требует отдельного плана backup/restore и ADR. В disposable local/test среде полная переинициализация выполняется удалением только проектного Docker volume.

## Критерий принятия

Миграция применена к чистой PostgreSQL 18.6, повторный migrate подтвердил checksum, seed успешно выполнен дважды, runtime verification прошёл.
