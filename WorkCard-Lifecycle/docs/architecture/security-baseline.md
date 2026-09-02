---
artifact_id: architecture.security-baseline
status: accepted
version: 2
owner: architecture
updated: 2026-09-02
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

1. `GET /api/v1/demo-users` возвращает только подготовленные display names/roles.
2. `POST /api/v1/demo-session` принимает `demoUserId`; API загружает active user и роль server-side.
3. Session ID — случайный opaque UUID в cookie `HttpOnly; Secure` (кроме HTTP localhost); `SameSite=Lax`; узкий `Path=/`.
4. Cookie подписана/проверяется server secret, а session row имеет абсолютный срок не более 8 часов и обновляемый idle срок 30 минут.
5. Role switch заменяет server session и CSRF token; очистка permission-sensitive client cache является обязательным требованием frontend-этапа 8.
6. Logout инвалидирует server row и очищает cookie.

Это сознательный demo role switch без паролей. Public deployment не должен содержать реальные accounts или заявлять MFA/SSO. Переход к production authentication требует внешнего IdP и отдельного threat model.

## CSRF и browser boundary

- Same-origin deployment; development использует Vite proxy.
- Mutation требует session cookie, `X-CSRF-Token`, совпадающий с hash текущей session, и допустимый `Origin`.
- CORS middleware не подключён: поддерживаются same-origin deployment и development через Vite proxy. Separate-origin deployment требует отдельной явной политики на этапе 10.
- GET/HEAD не меняют состояние.
- Текущая frontend-оболочка ещё не реализует demo-session flow; требование этапа 8 — не хранить session/CSRF в `localStorage`, держать token в memory и перечитывать его через session endpoint после reload.

## Authorization

Каждый command и sensitive query имеет explicit permission mapping из [[roles-permissions]]. Проверки выполняются в порядке:

1. authentication/session active;
2. route-level role permission;
3. mutation `Origin` и CSRF;
4. schema и не зависящие от состояния проверки command input;
5. authorized resource visibility, resource-dependent business rules, state/purpose/gate/version;
6. атомарный transaction commit состояния, receipt и audit events.

Fastify выполняет первые три шага в `preValidation`, поэтому schema-invalid запрос без session получает `401`, запрещённая роль — `403`, а закрытые params/resources не проверяются до authorization. Транзакция открывается до блокировки строк, но ни receipt, ни state, ни audit event не фиксируются при ошибке.

JSON parsing и body-size rejection технически предшествуют `preValidation`: синтаксически сломанный JSON или payload больше `1 MiB` может получить transport-level `400/413` до session check. Регрессионный security test использует синтаксически корректный, но schema-invalid JSON.

`assigneeId` допускается предметным input только для `AssignWorkCards`, но backend проверяет существующего active `WORKER`. `actorId` и `role` ни в одну command schema не входят. `availableActions` из read response не является authorization token.

## Input и output safety

- TypeBox schema для params/query/body/response, `additionalProperties: false`;
- JSON body limit `1 MiB`, assignment list максимум `250`, pagination максимум `100`;
- только параметризованный SQL через `pg`; динамические column/order identifiers не строятся из request input;
- HTML не принимается как rich text; React escaping остаётся включённым; текущий frontend не использует `dangerouslySetInnerHTML`, а автоматический запрет относится к quality-этапу 9;
- errors сериализуются allowlisted problem details без SQL, path, stack, cookie или закрытых resource facts;
- response schema не допускает случайной выдачи internal session/secret columns.

## HTTP hardening

- HTTPS/HSTS являются обязательным hosted control этапа 10 и не доказываются локальным Compose;
- сейчас отправляются `Content-Security-Policy` с `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` и `Permissions-Policy`, запрещающий camera/geolocation/microphone/payment/USB;
- SPA assets хэшированы; inline script запрещён CSP;
- rate limits для session switch, mutations и health запланированы на этап 9;
- body limit `1 MiB` и graceful shutdown реализованы; явные handler/DB time budgets и проверка keep-alive/request timeout запланированы на этап 9;
- API/DB timestamps server-side; `trustProxy` сейчас выключен, а его включение допускается только с явной reverse-proxy конфигурацией этапа 10.

## Secrets и конфигурация

- `.env` игнорируется Git; репозиторий содержит только `.env.example` с безопасными placeholder/local values;
- production secrets должны приходить из hosting secret store на этапе 10, а не из Docker image, Compose file, frontend variables или logs;
- отдельные `DATABASE_URL` для migration owner и runtime app role;
- runtime DB role не владеет schema и не может update/delete audit/final/payroll rows;
- session signing secret валидируется как строка минимум из 32 символов; production generation/rotation policy относится к этапу 10 и должна инвалидировать demo sessions;
- startup валидирует config и прекращает запуск при default/пустом secret вне `development/test`.

## Logging и audit privacy

Production logger настроен на redaction `authorization`, `cookie` и `x-csrf-token`, если эти headers попадают в log object. Fastify по умолчанию не пишет request body, а application errors сериализуются allowlisted problem details. Автоматическое доказательство redaction для headers/DB URL и запрет случайного body logging запланированы на этап 9; до него нельзя заявлять полный log-privacy gate. Audit payload формируется отдельно и не копирует HTTP body целиком.

Синтетические display names можно показывать в demo; email, телефон и реальные табельные номера не моделируются.

## Supply chain и container

- lockfile + `pnpm install --frozen-lockfile`;
- локальный review запускает `pnpm audit --prod --audit-level=high`; dependency audit, secret scan и image scan ещё не включены в CI и запланированы на этап 9;
- production image строится multi-stage, запускается non-root, имеет read-only filesystem где возможно и не содержит dev dependencies/source maps с secrets;
- base image и PostgreSQL pin до поддерживаемого patch/digest;
- локальные `/health/live` и `/health/ready` намеренно показывают app/migration versions для воспроизводимой проверки; перед hosted deployment на этапе 10 endpoints нужно ограничить или разделить на public и operator view.

## Database protection

- constraints дублируют критическую положительность/уникальность;
- транзакции и row locks описаны в [[transactions-concurrency]];
- audit/acceptance/payroll append-only защищены grants + trigger;
- hosted connection потребует TLS и ограниченного network access на этапе 10;
- backup/restore, retention и deployment credentials закрываются на этапе 10; до этого нельзя заявлять production readiness.

## Проверки baseline

| Проверка | Gate |
|---|---|
| body подменяет `role`/`actorId` | schema rejection, полномочия не меняются |
| другая роль вызывает command | `403`, нет state/event/receipt |
| missing/invalid CSRF или Origin | `403`, нет side effect |
| stale version | `409`, manual refresh path |
| SQL/XSS payload | validation/escaping, нет исполнения |
| oversize body/list | body `413`, schema-invalid list `400` до domain transaction; отдельный regression test — этап 9 |
| logs | header redaction настроен; automated assertion для cookie/token/DB URL — этап 9 |
| runtime DB role | update/delete immutable tables запрещены |
| image | non-root/read-only Compose проверены локально; vulnerability/secret scan — этап 9 |

## Явные ограничения

MVP baseline не включает production IAM, password reset, MFA, tenant isolation, реальных персональных данных, formal penetration test, SIEM или compliance certification. Rate limiting, explicit time budgets, automated log-redaction proof и CI dependency/secret/image scanning относятся к этапу 9; hosted TLS, secret rotation, network policy и public health sanitization — к этапу 10. Эти ограничения видимы в portfolio packaging и не маскируются словом «безопасно».
