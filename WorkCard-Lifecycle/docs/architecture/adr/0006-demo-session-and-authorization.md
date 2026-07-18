---
artifact_id: architecture.adr.0006
status: accepted
version: 1
owner: architecture
updated: 2026-07-18
---

# ADR-0006: Demo session and backend authorization

## Статус

Принято 2026-07-18.

## Контекст

Prototype переключает пять ролей, но production IAM вне MVP. При этом backend permissions должны быть реальными: client role fields/local storage нельзя считать trusted, а cookie mutations требуют CSRF defense.

## Варианты

1. Prepared demo identities + server-signed HttpOnly session + backend permission map.
2. Role в request header/local storage.
3. Полный OAuth/OIDC provider.
4. Отдельные builds для каждой роли.

## Решение

Принять вариант 1 по [[security-baseline]]. Public bootstrap endpoint сначала выдаёт short-lived signed anonymous cookie и связанный CSRF token без actor/role. Role switch выбирает active seed identity через CSRF/Origin-protected endpoint; backend выдаёт/rotates signed authenticated session. Actor/role берутся только из verified session. Authorization выполняется до target lookup, object/state/gate проверки — после него.

Same-origin deployment, `SameSite=Strict`, synchronizer CSRF token и restrictive CORS/CSP входят в baseline. Demo session не заявляется как production authentication.

## Последствия

- DOM/request tampering не даёт прав;
- все роли доступны для demo без паролей, что является осознанной демонстрационной границей;
- permission-sensitive cache очищается на switch;
- production accounts/MFA/departments потребуют нового identity design;
- replay result всё равно требует текущую разрешённую role.

## Проверка

- role matrix integration tests для каждой command/read class;
- arbitrary actor/role, invalid CSRF и direct protected route отклоняются;
- role switch не меняет domain state/version/audit;
- errors не раскрывают protected resource existence.
