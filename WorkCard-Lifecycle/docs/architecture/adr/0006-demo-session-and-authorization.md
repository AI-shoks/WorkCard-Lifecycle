---
artifact_id: architecture.adr.0006
status: accepted
version: 2
owner: architecture
updated: 2026-07-28
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

Для отсутствующей, повреждённой или истёкшей authenticated session protected endpoint возвращает `401` с точным challenge `WWW-Authenticate: WorkcardSession realm="workcard-api"`. `WorkcardSession` — project-defined HTTP authentication scheme: credential передаётся только существующей cookie `workcard_demo_session`, которую client получает через `GET /session/bootstrap`, а затем заменяет на authenticated cookie через `PUT /session/demo`. Заголовки `Authorization: Bearer ...` и `Authorization: WorkcardSession ...` не поддерживаются и не заменяют cookie. OpenAPI продолжает описывать credential как cookie `apiKey`; `WorkcardSession` публикуется только как challenge ответа, а не как Bearer, OpenID или OAuth security scheme. После успешной аутентификации недостаточные права возвращают `403` без `WWW-Authenticate`.

## Последствия

- DOM/request tampering не даёт прав;
- все роли доступны для demo без паролей, что является осознанной демонстрационной границей;
- permission-sensitive cache очищается на switch;
- production accounts/MFA/departments потребуют нового identity design;
- replay result всё равно требует текущую разрешённую role.
- project-defined challenge даёт client однозначный сигнал повторить demo-session flow, не создавая ложный token-based authentication contract.

## Проверка

- role matrix integration tests для каждой command/read class;
- arbitrary actor/role, invalid CSRF и direct protected route отклоняются;
- missing, malformed и expired cookie возвращают точный `WorkcardSession` challenge, а permission denial — `403` без challenge;
- role switch не меняет domain state/version/audit;
- errors не раскрывают protected resource existence.
