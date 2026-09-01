---
artifact_id: architecture.security-baseline
status: accepted
version: 1
owner: architecture
updated: 2026-09-01
---

# Security Baseline

Базовая модель защищает публичный portfolio demo от очевидного обхода ролей и повреждения данных, не выдавая demo-auth за production IAM.

## Модель угроз и доверия

Защищаем:

- целостность state machine, first-article gate и final acceptance;
- versions, audit events и immutable results;
- demo-session и синтетические actor records;
- DB credentials и deployment secrets.

Не считаются доверенными: браузер, URL/UUID, hidden/disabled controls, local storage, command body, client timestamps, `role`/`actorId` headers и error text из зависимостей.

Данные fixture синтетические и не являются персональными/производственными секретами, но это не отменяет authorization и secure defaults.

## Demo authentication

1. `GET /demo-users` возвращает только подготовленные display names/roles.
2. `POST /demo-session` принимает `demoUserId`; API загружает active user и роль server-side.
3. Session ID — случайный opaque UUID/256-bit token в cookie `HttpOnly; Secure` (кроме HTTP localhost); `SameSite=Lax`; узкий `Path=/`.
4. Cookie подписана/проверяется server secret, а session row имеет абсолютный срок не более 8 часов и обновляемый idle срок 30 минут.
5. Role switch заменяет session и CSRF token, затем UI очищает permission-sensitive cache.
6. Logout инвалидирует server row и очищает cookie.

Это сознательный demo role switch без паролей. Public deployment не должен содержать реальные accounts или заявлять MFA/SSO. Переход к production authentication требует внешнего IdP и отдельного threat model.

## CSRF и browser boundary

- Same-origin deployment; development использует Vite proxy.
- Mutation требует session cookie, `X-CSRF-Token`, совпадающий с hash текущей session, и допустимый `Origin`.
- CORS выключен по умолчанию; при отдельном origin разрешается только точное configured значение, credentials и нужные methods/headers.
- GET/HEAD не меняют состояние.
- UI не хранит session/CSRF в `localStorage`; CSRF token живёт в memory и перечитывается через session endpoint после reload.

## Authorization

Каждый command и sensitive query имеет explicit permission mapping из [[roles-permissions]]. Проверки выполняются в порядке:

1. authentication/session active;
2. route-level role permission;
3. resource visibility;
4. schema/business inputs;
5. state/purpose/gate/version;
6. transaction commit.

`assigneeId` допускается предметным input только для `AssignWorkCards`, но backend проверяет существующего active `WORKER`. `actorId` и `role` ни в одну command schema не входят. `availableActions` из read response не является authorization token.

## Input и output safety

- TypeBox schema для params/query/body/response, `additionalProperties: false`;
- JSON body limit `1 MiB`, assignment list максимум `250`, pagination максимум `100`;
- только параметризованный SQL/Drizzle expressions; динамические column/order identifiers выбираются из allowlist;
- HTML не принимается как rich text; React escaping остаётся включённым; `dangerouslySetInnerHTML` запрещён lint rule/review;
- errors сериализуются allowlisted problem details без SQL, path, stack, cookie или закрытых resource facts;
- response schema не допускает случайной выдачи internal session/secret columns.

## HTTP hardening

- HTTPS/HSTS в hosted environment;
- security headers: `Content-Security-Policy`, `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, restrictive `Permissions-Policy`;
- SPA assets хэшированы; inline script запрещён CSP;
- rate limits отдельно для session switch и mutations; health endpoint имеет дешёвый limit;
- request timeout, keep-alive/body limits и graceful shutdown;
- API/DB timestamps server-side; proxy headers доверяются только от configured reverse proxy.

## Secrets и конфигурация

- `.env` игнорируется Git; репозиторий содержит только `.env.example` с безопасными placeholder/local values;
- production secrets приходят из hosting secret store, не из Docker image, Compose file, frontend variables или logs;
- отдельные `DATABASE_URL` для migration owner и runtime app role;
- runtime DB role не владеет schema и не может update/delete audit/final/payroll rows;
- session signing secret минимум 32 random bytes; rotation invalidates demo sessions;
- startup валидирует config и прекращает запуск при default/пустом secret вне `development/test`.

## Logging и audit privacy

Pino redacts `cookie`, `authorization`, `x-csrf-token`, DB URL/password и request bodies по умолчанию. Operational log использует request/correlation IDs и безопасный error code. Audit payload allowlisted отдельно и не копирует HTTP body.

Синтетические display names можно показывать в demo; email, телефон и реальные табельные номера не моделируются.

## Supply chain и container

- lockfile + `pnpm install --frozen-lockfile`;
- CI запускает dependency audit и secret scan; найденные проблемы triage, а не blind force-upgrade;
- production image строится multi-stage, запускается non-root, имеет read-only filesystem где возможно и не содержит dev dependencies/source maps с secrets;
- base image и PostgreSQL pin до поддерживаемого patch/digest;
- healthcheck не раскрывает config/version details публично.

## Database protection

- constraints дублируют критическую положительность/уникальность;
- транзакции и row locks описаны в [[transactions-concurrency]];
- audit/acceptance/payroll append-only защищены grants + trigger;
- hosted connection требует TLS и ограниченного network access;
- backup/restore, retention и deployment credentials закрываются на этапе 10; до этого нельзя заявлять production readiness.

## Проверки baseline

| Проверка | Gate |
|---|---|
| body подменяет `role`/`actorId` | schema rejection, полномочия не меняются |
| другая роль вызывает command | `403`, нет state/event/receipt |
| missing/invalid CSRF или Origin | `403`, нет side effect |
| stale version | `409`, manual refresh path |
| SQL/XSS payload | validation/escaping, нет исполнения |
| oversize body/list | `413`/`422` до domain transaction |
| logs | automated assertion redacts cookie/token/DB URL |
| runtime DB role | update/delete immutable tables запрещены |
| image | non-root user, vulnerability/secret scan без unresolved critical finding |

## Явные ограничения

MVP baseline не включает production IAM, password reset, MFA, tenant isolation, реальных персональных данных, formal penetration test, SIEM или compliance certification. Эти ограничения видимы в portfolio packaging и не маскируются словом «безопасно».
