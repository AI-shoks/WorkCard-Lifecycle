---
artifact_id: architecture.security-baseline
status: accepted
version: 4
owner: architecture
updated: 2026-09-05
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
- Frontend при bootstrap перечитывает actor, permissions и новый CSRF token через session endpoint, хранит token только в памяти и не использует `localStorage`/`sessionStorage` для session state. До подтверждения server session защищённый экран не монтируется; смена пользователя очищает command state и permission-sensitive cache.

## Authorization

Каждый command и sensitive query имеет explicit permission mapping из [[roles-permissions]]. Проверки выполняются в порядке:

1. authentication/session active;
2. route-level role permission;
3. mutation `Origin` и CSRF;
4. schema и не зависящие от состояния проверки command input;
5. authorized resource visibility, resource-dependent business rules, state/purpose/gate/version;
6. атомарный transaction commit состояния, receipt и audit events.

Fastify выполняет первые три шага в `preValidation`, поэтому schema-invalid запрос без session получает `401`, запрещённая роль — `403`, а закрытые params/resources не проверяются до authorization. Транзакция открывается до блокировки строк, но ни receipt, ни state, ни audit event не фиксируются при ошибке.

Rate limiting, JSON parsing и body-size rejection технически предшествуют `preValidation`: превышение лимита, сломанный JSON или payload больше `1 MiB` могут получить transport-level `429/400/413` до session check. Регрессионный security test проверяет порядок authorization на корректном JSON с запрещёнными schema полями и отдельно проверяет transport limits.

`assigneeId` допускается предметным input только для `AssignWorkCards`, но backend проверяет существующего active `WORKER`. `actorId` и `role` ни в одну command schema не входят. `availableActions` из read response не является authorization token.

## Input и output safety

- TypeBox schema для params/query/body/response, `additionalProperties: false`;
- JSON body limit `1 MiB`, assignment list максимум `250`, pagination максимум `100`;
- только параметризованный SQL через `pg`; динамические column/order identifiers не строятся из request input;
- HTML не принимается как rich text; React escaping остаётся включённым; ESLint запрещает JSX `dangerouslySetInnerHTML`;
- errors сериализуются allowlisted problem details без SQL, path, stack, cookie или закрытых resource facts;
- response schema не допускает случайной выдачи internal session/secret columns.

## HTTP hardening

- HTTPS/HSTS являются обязательным hosted control этапа 10 и не доказываются локальным Compose;
- сейчас отправляются `Content-Security-Policy` с `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` и `Permissions-Policy`, запрещающий camera/geolocation/microphone/payment/USB;
- SPA assets хэшированы; inline script запрещён CSP;
- лимиты на IP и категорию за 60 секунд: session switch `30`, mutations `600`, чтение `3000`, health `600`; превышение возвращает `429` и `Retry-After`. Cache ограничен 10 000 ключами; это защита одного процесса demo, не distributed anti-abuse service;
- body limit `1 MiB`, graceful shutdown, connection timeout `10 s`, request timeout `15 s`, handler timeout `20 s`, keep-alive `5 s`;
- runtime PostgreSQL pool: максимум 10 соединений, connection timeout `3 s`, idle pool timeout `10 s`, statement timeout `10 s`, lock timeout `3 s`, idle-in-transaction и transaction timeout `15 s`. Это ресурсные ограничения, не бизнес-SLA; DB timeout даёт безопасный `503`, UI использует существующее контрольное чтение;
- API/DB timestamps server-side; `trustProxy` сейчас выключен, а его включение допускается только с явной reverse-proxy конфигурацией этапа 10.

## Secrets и конфигурация

- `.env` игнорируется Git; репозиторий содержит только `.env.example` с безопасными placeholder/local values;
- production secrets должны приходить из hosting secret store на этапе 10, а не из Docker image, Compose file, frontend variables или logs;
- отдельные `DATABASE_URL` для migration owner и runtime app role;
- runtime DB role не владеет schema и не может update/delete audit/final/payroll rows;
- session signing secret валидируется как строка минимум из 32 символов; production generation/rotation policy относится к этапу 10 и должна инвалидировать demo sessions;
- startup требует явно переданный secret вне `development/test` и минимум 32 символа; он не определяет криптографическую стойкость произвольного значения. Локальные Compose placeholders не предназначены для hosted окружения.

## Logging и audit privacy

Production logger сохраняет метод и шаблон route без query/body/headers. Поля credentials дополнительно redacted; error serializer не пишет driver message/stack, которые могут содержать SQL или DB URL. `runtime-protection.test.ts` подаёт маркеры в cookie, authorization, CSRF, query, body и driver error и проверяет отсутствие их в logs/problem response. Startup errors также не печатают исходное исключение. Цена этой политики — ограниченная диагностика по внутренним сообщениям; request ID остаётся доступным. Audit payload формируется отдельно и не копирует HTTP body целиком.

Синтетические display names можно показывать в demo; email, телефон и реальные табельные номера не моделируются.

## Supply chain и container

- lockfile + `pnpm install --frozen-lockfile`;
- `pnpm security:dependencies` проверяет все dependency scopes, включая test/build tools, с порогом HIGH; release-age `1440` минут применяется строго, без автоматических исключений;
- `pnpm security:secrets` запускает закреплённый Gitleaks для полной Git history и текущих app/workflow файлов, включая незафиксированные. Значения полностью redacted в выводе и JSON;
- CI `container` проверяет именно запущенный runtime image закреплённым Trivy: OS и npm, HIGH/CRITICAL, включая unfixed; `--parallel 1` ограничивает расход памяти, не меняя покрытие или severity;
- production image строится multi-stage, запускается non-root, имеет read-only filesystem где возможно и не содержит dev dependencies/source maps с secrets;
- base image и PostgreSQL pin до поддерживаемого patch/digest;
- runtime использует закреплённый `distroless/nodejs24-debian13:nonroot`: npm, shell и build tools не нужны для исполнения API/SPA и остаются в build stage. Замена вызвана подтверждёнными HIGH/CRITICAL в прежнем Debian 12 runtime и его global npm; dev dependencies в runtime не копируются;
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
| oversize body/list | PostgreSQL security test: body `413`, list из 251 ID `400`, бизнес-состояние неизменно |
| logs | unit test: cookie/token/query/body/driver URL отсутствуют в log и response |
| runtime DB role | update/delete immutable tables запрещены |
| image | отдельный clean-container и Trivy gate; текущие результаты в [[quality-gates]] |

`quality/security.test.ts` дополнительно проверяет запрет всех девяти commands для неподходящих ролей, protected audit/payroll queries, forged actor/role, missing/lookalike/null Origin, чужой/устаревший CSRF, cookie tampering, rotation/logout, idle/absolute expiry, inactive user и session rate limit при поддельном `X-Forwarded-For`. `quality/budgets.test.ts` удерживает реальный row lock и доказывает `503`, полный rollback и успешную явную повторную попытку.

### Узкие исключения secret scan

`.gitleaksignore` содержит шесть точных historical fingerprints (commit + path + rule + line). Четыре — синтетические session-secret literals в удалённых Python integration/config tests; два — намеренные AWS/JWT fixtures теста самого secret scanner. Контекст этих строк проверен: это тестовые маркеры, а не действующие credentials. Исключения относятся только к этим historical находкам; текущие файлы сканируются без ignore file. Нет исключений по каталогу, целому правилу или severity; значения находок не публикуются. Изменение fingerprint требует нового разбора.

## Явные ограничения

MVP baseline не включает production IAM, password reset, MFA, tenant isolation, реальные персональные данные, formal penetration test, SIEM или compliance certification. Локальная проверка не доказывает hosted TLS, secret rotation, network policy или public health sanitization — это обязательства этапа 10. CI gates этапа 9 становятся подтверждёнными только после успешного запуска для нового implementation SHA; текущее состояние отражает [[quality-gates]].
