---
artifact_id: architecture.security-baseline
status: accepted
version: 10
owner: architecture
updated: 2026-09-17
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
4. Cookie подписана/проверяется server secret, а session row имеет абсолютный срок не более 8 часов и обновляемый idle срок 30 минут. Истёкшая/disabled session удаляется при неуспешной аутентификации, глобальная expired cleanup выполняется при создании session, daily reset удаляет остаток.
5. Role switch заменяет server session и CSRF token; очистка permission-sensitive client cache является обязательным требованием frontend-этапа 8.
6. Logout инвалидирует server row и очищает cookie.

Это сознательный demo role switch без паролей. Production demo использует общую DB без tenant isolation: посетитель предупреждён, что видит и меняет общий synthetic state, а reset удалит его. Public deployment не должен содержать реальные accounts или заявлять MFA/SSO. Переход к production authentication требует внешнего IdP и отдельного threat model.

## CSRF и browser boundary

- Same-origin deployment; development использует Vite proxy.
- Mutation требует session cookie, `X-CSRF-Token`, совпадающий с hash текущей session, и допустимый `Origin`.
- CORS middleware не подключён: поддерживаются same-origin deployment и development через Vite proxy. Separate-origin deployment требует отдельной явной политики на этапе 10.
- GET/HEAD не выполняют предметные mutations; допустимый session touch/expired cleanup также проходит DB maintenance barrier.
- Frontend при bootstrap перечитывает actor, permissions и новый CSRF token через session endpoint, хранит token только в памяти и не использует `localStorage`/`sessionStorage` для session state. До подтверждения server session защищённый экран не монтируется; смена пользователя очищает command state и permission-sensitive cache.

## Authorization

Каждый command и sensitive query имеет explicit permission mapping из [[roles-permissions]]. Проверки выполняются в порядке:

1. authentication/session active;
2. route-level role permission;
3. mutation `Origin` и CSRF;
4. schema и не зависящие от состояния проверки command input;
5. shared maintenance barrier, отдельный SQL state check, повторная session/generation проверка до receipt, затем authorized resource visibility и state/purpose/gate/version;
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
- hosted app ограничивает live state значениями `DEMO_MAX_BATCHES=20` и `DEMO_MAX_SESSIONS=500`; capacity rejection даёт `409` до предметного side effect. Это ограничение накопления общей demo, а не tenant quota;
- body limit `1 MiB`, graceful shutdown, connection timeout `10 s`, request timeout `15 s`, handler timeout `20 s`, keep-alive `5 s`;
- runtime PostgreSQL pool: максимум 10 соединений, connection timeout `3 s`, idle pool timeout `10 s`, statement timeout `10 s`, lock timeout `3 s`, idle-in-transaction и transaction timeout `15 s`. Это ресурсные ограничения, не бизнес-SLA; DB timeout даёт безопасный `503`, UI использует существующее контрольное чтение;
- API/DB timestamps server-side. `PROXY_TRUST_MODE=none` игнорирует forwarded headers локально/на Actions; `render` требует platform metadata и явный `PROXY_TRUSTED_CIDRS` peers. Initial Render `observe` не доверяет forwarded headers, запрещает CIDRs и принудительно закрывает `/api*`/readiness до DB; доступны liveness/SPA и peer logs. Нет безусловного `trustProxy=true`. Проверка CIDR-цепочки и spoof/rate-limit tests не заменяют hosted observation реальной Render chain/client IP; неизвестная цепочка блокирует public qualification.
- Idle pool errors логируются безопасно и не завершают процесс; budgets сохраняются. Пробуждение Neon/Render может не уложиться в budget и дать `503`, это не причина бесконечных retries или keepalive.

Production `APP_ORIGIN` требует HTTPS независимо от Render marker; HTTP в hosted staging допускается только для loopback Docker.

## Secrets и конфигурация

- `.env` игнорируется Git; examples содержат только local/placeholder values.
- Owner `MIGRATION_DATABASE_URL` разрешён только одноразовому owner CLI; runtime получает `DATABASE_URL` SQL-created role и `SESSION_SIGNING_SECRET`, browser — только HTTP.
- Runtime role не имеет elevated flags/memberships (включая `neon_superuser`), ownership или возможности изменить maintenance state; immutable audit/final/payroll mutation запрещена grants/triggers. Privileged existing role вызывает отказ bootstrap, а не молчаливое исправление.
- Hosted `APP_ENV=staging|production` требует direct Neon TCP/TLS `verify-full`, exact ожидаемые host/database и запрещает pooler/downgrade/неоднозначные overrides независимо от наличия Cloud Run `K_*`.
- Session secret требует минимум 32 CSPRNG bytes, отдельные значения контуров и явную rotation, которая инвалидирует sessions. Startup проверяет длину, а не доказывает случайность.
- GitHub/Render secrets изменяемые; несекретный rotation identifier в evidence не выдаётся за enforced secret version. App rollback не восстанавливает прежний payload автоматически.
- Publisher, Render adapter, owner и runtime jobs разделены; browser не наследует DB/owner/PG/cloud variables. GitHub workflow с owner environment остаётся привилегированной границей, даже при step-scoped secrets.

Точные имена и bindings — [[environments]]. Public GHCR image не содержит credentials и не требует registry secret в Render.

## Logging и audit privacy

Production Pino logger пишет однострочный JSON с ISO `time`, безопасными полями уровня, platform service, `appVersion`. Завершение запроса содержит сгенерированный server-side request ID, method, шаблон route, status и duration, а также `remoteAddress`, `remoteIp` и `protocol` для proxy qualification; фактический URL/query, body и headers исключены. Эти сетевые адреса являются техническими metadata запросов, не полями synthetic production data. Raw visitor logs не публикуются как release evidence; qualified observation summary описывает только запросы runner. Поля credentials удаляются redaction; error serializer не пишет driver message/stack, которые могут содержать SQL или DB URL. Owner CLI тем же logger фиксирует command, phase/outcome и migration filename/version без SQL. `runtime-protection.test.ts` подаёт маркеры в cookie, authorization, CSRF, query, body, DB URL, SQL и driver error и проверяет отсутствие их в logs; startup errors также не печатают исходное исключение. Цена этой политики — ограниченная диагностика по внутренним сообщениям; request ID и безопасная readiness-диагностика остаются доступны. Audit payload формируется отдельно и не копирует HTTP body целиком.

Синтетические display names можно показывать в demo; email, телефон и реальные табельные номера не моделируются.

## Supply chain и container

- lockfile + `pnpm install --frozen-lockfile`;
- `pnpm security:dependencies` проверяет все dependency scopes, включая test/build tools, с порогом HIGH; release-age `1440` минут применяется строго, без автоматических исключений;
- `pnpm security:secrets` запускает закреплённый Gitleaks для полной Git history и текущих app/workflow файлов, включая незафиксированные. Значения полностью redacted в выводе и JSON;
- CI `container` проверяет именно запущенный runtime image закреплённым Trivy: OS и npm, HIGH/CRITICAL, включая unfixed; `--parallel 1` ограничивает расход памяти, не меняя покрытие или severity;
- production image строится multi-stage, запускается non-root, имеет read-only filesystem где возможно и не содержит dev dependencies/source maps с secrets;
- base image и PostgreSQL pin до поддерживаемого patch/digest;
- runtime использует закреплённый `distroless/nodejs24-debian13:nonroot`: npm, shell и build tools не нужны для исполнения API/SPA и остаются в build stage. Замена вызвана подтверждёнными HIGH/CRITICAL в прежнем Debian 12 runtime и его global npm; dev dependencies в runtime не копируются;
- `/health/live` всегда публикует только `{"status":"ok"}`; `/health/ready` публикует только `{"status":"ok"}` либо `{"status":"unavailable"}` и сохраняет различие `200/503`. `APP_VERSION`, database state, текущая и ожидаемая migration versions доступны в безопасных logs/release metadata, но не в публичном payload.

## Database protection

- Constraints дублируют критическую положительность/уникальность; транзакции и row locks описаны в [[transactions-concurrency]].
- Все runtime DB operations проходят shared advisory barrier и отдельный SQL state check после lock в `READ COMMITTED`, включая reads и session touch/delete/cleanup. Runtime только читает persistent maintenance/requested/generation/timestamp; оба maintenance flags должны быть false для admission.
- Command executor повторно проверяет session/generation до создания/replay receipt, закрывая race `auth → reset → command`.
- Owner session mutex сериализует orchestration; сначала коммитится `maintenance_requested=true`, затем exclusive barrier дожидается допущенных transactions и фиксирует `maintenance=true`/generation. Новые admissions закрыты уже при requested; timeout/cancel ожидания сохраняет fail-closed state. Capacity locks используют другие ключи. Workflow concurrency — дополнительная защита, не замена DB mutex.
- Reset транзакционно удаляет mutable synthetic demo и sessions, сохраняет reference fixtures, не запускает seed; verify доступен с закрытым gate. Только успешные initial bootstrap + verify либо reset + verify обновляют timestamp. Через 26 часов API fail-closed.
- Ошибка/cancellation после persisted request или close сохраняет закрытое состояние; только verified success очищает оба флага, unconditional reopen запрещён. Suspend/HTTP 202 Render не считаются доказательством завершения SQL.
- Direct Neon TLS/hostname, реальные owner capabilities и runtime grants проверяются отдельно в hosted qualification. Локальный PostgreSQL non-superuser test доказывает SQL behavior без обращения к Neon.
- История посетителей не требует backup/recovery. При восстановлении достаточно чистых migrations + seed + verify; ограниченное Neon restore window и невозможность гарантировать $0 uptime описаны в [[0009-render-free-neon-free-release|ADR-0009]].

## Проверки baseline

| Проверка | Gate |
|---|---|
| body подменяет `role`/`actorId` | schema rejection, полномочия не меняются |
| другая роль вызывает command | `403`, нет state/event/receipt |
| missing/invalid CSRF или Origin | `403`, нет side effect |
| stale version | `409`, manual refresh path |
| SQL/XSS payload | validation/escaping, нет исполнения |
| oversize body/list | PostgreSQL security test: body `413`, list из 251 ID `400`, бизнес-состояние неизменно |
| public health | exact response contract: только status и `200/503`, version/database/migration details отсутствуют |
| logs | unit test: безопасные JSON level/request fields присутствуют; cookie/token/query/body/DB URL/SQL/raw driver error отсутствуют |
| proxy/IP | local XFF игнорируется; Render peer/CIDR-chain simulation игнорирует spoofed prefix и разделяет rate-limit key реальных client IP |
| Neon URL | config tests отклоняют pooler/downgrade/неоднозначные параметры и неверные expected host/database; TLS использует проверку сертификата/hostname |
| Maintenance | reads/session/commands закрываются под gate; owner fail/cancel не открывает; auth-reset race не создаёт receipt |
| runtime DB role | update/delete immutable tables запрещены |
| image | отдельный clean-container и Trivy gate; текущие результаты в [[quality-gates]] |

`quality/security.test.ts` дополнительно проверяет запрет всех девяти commands для неподходящих ролей, protected audit/payroll queries, forged actor/role, missing/lookalike/null Origin, чужой/устаревший CSRF, cookie tampering, rotation/logout, idle/absolute expiry, inactive user и session rate limit при поддельном `X-Forwarded-For`. `quality/budgets.test.ts` удерживает реальный row lock и доказывает `503`, полный rollback и успешную явную повторную попытку.

### Узкие исключения secret scan

`.gitleaksignore` содержит шесть точных historical fingerprints (commit + path + rule + line). Четыре — синтетические session-secret literals в удалённых Python integration/config tests; два — намеренные AWS/JWT fixtures теста самого secret scanner. Контекст этих строк проверен: это тестовые маркеры, а не действующие credentials. Исключения относятся только к этим historical находкам; текущие файлы сканируются без ignore file. Нет исключений по каталогу, целому правилу или severity; значения находок не публикуются. Изменение fingerprint требует нового разбора.

## Явные ограничения

MVP baseline не включает production IAM пользователей, password reset, MFA, tenant isolation, реальные персональные данные, formal penetration test, SIEM или compliance certification. Локальные tests и plan assertions доказывают только code/config contracts, но не hosted Neon TLS/roles, Render resolved digest/proxy chain/log ingestion, reset cadence/cancellation, secret rotation, cold start или recovery. Эти наблюдения остаются staging/production evidence по [[deployment]]. Подтверждённые CI gates этапа 9 относятся только к прежнему implementation SHA из [[quality-gates]]; текущие изменения удалённо не проверялись.
