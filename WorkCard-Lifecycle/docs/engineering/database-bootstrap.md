---
artifact_id: engineering.database-bootstrap
status: accepted
version: 1
owner: engineering
updated: 2026-07-19
---

# Database Bootstrap

Schema управляется forward-only SQL migrations и checksum catalog `schema_migrations`.

## Каталог

| Migration | Содержание |
|---|---|
| `0001` | physical MVP schema, constraints, immutable triggers и baseline runtime grants |
| `0002` | шесть prepared demo identities, один паспорт и три operation plans `112 + 112 + 26` |
| `0003` | PostgreSQL `demo_sessions`: уникальный `jti`, identity/role binding, issued/expiry/revoked timestamps, indexes и минимальные runtime grants |

Повторный запуск возвращает пустой applied set; изменение checksum уже применённой migration отклоняется. Runner держит session advisory lock, каждую migration выполняет транзакционно, откатывает failed transaction до unlock и не заменяет исходное исключение ошибкой unlock.

## Роли

- test/admin role создаёт или нормализует отдельные login roles только в изолированном test cluster;
- migrator имеет `USAGE, CREATE` в schema и владеет созданными таблицами;
- runtime имеет `USAGE`, чтение заявленных таблиц и только требуемый DML;
- runtime не применяет migrations и не получает DDL;
- `audit_events`, `final_batch_acceptances` и `payroll_records` не имеют runtime `UPDATE/DELETE`;
- `demo_sessions` разрешает `SELECT/INSERT/DELETE` и column-level `UPDATE(revoked_at)`.

Expired session не считается активной даже при валидной подписи cookie. При создании session runtime удаляет только записи, истёкшие более суток назад; revoked rows до этого остаются доказуемо неактивными. Это bounded cleanup для demo Foundation, а не универсальная IAM retention policy.

Автоматические down-migrations не заявляются. Recovery выполняется восстановлением из test fixture/backup или исправляющей forward migration; destructive rollback production data вне Gate 1.
