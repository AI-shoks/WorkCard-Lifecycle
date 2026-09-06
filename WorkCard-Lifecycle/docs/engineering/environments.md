---
artifact_id: engineering.environments
status: accepted
version: 8
owner: engineering
updated: 2026-09-06
---

# Environments and Secrets

Конфигурация поступает только через environment variables. Образ не содержит environment-specific секретов и одинаков для local, test, staging и production. Hosted binding следует [[deployment]] и [[0007-cloud-run-and-cloud-sql-release|ADR-0007]]; [reviewable Terraform](../../infra/terraform/README.md) описывает resources и binding, но без `apply` и secret values они ещё не созданы.

## Контуры

| Контур | Данные | БД | Секреты | Назначение |
|---|---|---|---|---|
| local | детерминированные синтетические | Docker volume | локальный `.env` с demo-значениями | разработка и демонстрация |
| test/CI | синтетические, пересоздаются | ephemeral PostgreSQL service | job environment | автоматические проверки |
| staging | только разрешённые синтетические | отдельный Cloud SQL PostgreSQL 18 | Secret Manager staging project | hosted smoke и приёмка exact digest |
| production | только общие synthetic demo-данные; mutable rows daily reset | отдельный Cloud SQL PostgreSQL 18 с backups/PITR | Secret Manager production project | публичный interactive portfolio demo без tenant isolation |

Реальные производственные, кадровые и расчётные данные не допускаются ни в один контур MVP.

## Переменные приложения

| Переменная | Потребитель | Правило |
|---|---|---|
| `APP_ENV` | API | только `development`, `test`, `staging`, `production` |
| `APP_VERSION` | API/operator logs | full source commit SHA без секрета; sanitized public health его не показывает |
| `HOST`, `PORT` | API | `HOST=0.0.0.0`; Cloud Run сам inject-ит `PORT=3000` после настройки container port |
| `LOG_LEVEL` | API/jobs | разрешённый уровень Pino; hosted Terraform фиксирует `info` |
| `PROXY_TRUST_MODE` | API | `none` вне Cloud Run; `cloud-run` доверяет только непосредственному platform proxy |
| `DEMO_MAX_BATCHES` | API | hosted значение `20`; целое `1..100`, ограничивает live aggregate roots |
| `DEMO_MAX_SESSIONS` | API | hosted значение `500`; целое `1..10000`, ограничивает server session rows |
| `DATABASE_URL` | API/verify | только runtime-роль; hosted workload требует Cloud SQL Unix socket |
| `WEB_DIST_PATH` | API | каталог собранного SPA |
| `APP_ORIGIN` | API | один точный канонический HTTPS service origin контура, без path/query/trailing slash |
| `SESSION_SIGNING_SECRET` | API | минимум 32 символа; вне development/test обязателен явно |
| `COMPOSE_APP_ORIGIN` | Compose | local same-origin URL собранного приложения; преобразуется в `APP_ORIGIN` контейнера |

`K_SERVICE`/`K_REVISION` для service и `CLOUD_RUN_JOB`/`CLOUD_RUN_EXECUTION` для jobs добавляет сама платформа. Код использует их только как ограниченную границу hosted-конфигурации и безопасный logging context; задавать эти зарезервированные имена Terraform не должен.

## Переменные bootstrap

| Переменная | Доступ | Правило |
|---|---|---|
| `MIGRATION_DATABASE_URL` | только Cloud Run migrate/reset/seed jobs | schema owner/role administration, не передаётся API service |
| `APP_DATABASE_USER` | migrate, verify и local Compose | безопасный PostgreSQL identifier; hosted app извлекает user из `DATABASE_URL` и отдельно переменную не получает |
| `APP_DATABASE_PASSWORD` | migrate/seed job и формирование runtime URL | Secret Manager; не передаётся отдельным значением API service и не логируется |
| `POSTGRES_*` | local/CI database service | инфраструктурные значения контура |

Compose формирует внутренние URL с hostname `database`; host-команды используют loopback URL из `.env`. Пароли с произвольными спецсимволами в hosted environment передаются готовыми URL, корректно закодированными secret store.

## Hosted binding matrix

| Cloud Run workload | Несекретная конфигурация | Доступные secret versions | Запрещено передавать |
|---|---|---|---|
| app service | `APP_ENV`, `APP_VERSION`, `APP_ORIGIN`, `HOST`, `LOG_LEVEL`, `PROXY_TRUST_MODE=cloud-run`, `DEMO_MAX_BATCHES=20`, `DEMO_MAX_SESSIONS=500`, `WEB_DIST_PATH` | `DATABASE_URL`, `SESSION_SIGNING_SECRET` | `MIGRATION_DATABASE_URL`, `APP_DATABASE_PASSWORD`, owner configuration |
| migrate job | `APP_ENV`, `APP_VERSION`, `APP_DATABASE_USER`, `LOG_LEVEL` | `MIGRATION_DATABASE_URL`, `APP_DATABASE_PASSWORD` | `DATABASE_URL`, `SESSION_SIGNING_SECRET` |
| reset job | `APP_ENV`, `APP_VERSION`, `LOG_LEVEL` | только `MIGRATION_DATABASE_URL` | `APP_DATABASE_PASSWORD`, `DATABASE_URL`, `SESSION_SIGNING_SECRET` |
| seed job | `APP_ENV`, `APP_VERSION`, `APP_DATABASE_USER`, `LOG_LEVEL` | `MIGRATION_DATABASE_URL`, `APP_DATABASE_PASSWORD` | `DATABASE_URL`, `SESSION_SIGNING_SECRET` |
| verify job | `APP_ENV`, `APP_VERSION`, `APP_DATABASE_USER`, `LOG_LEVEL` | `DATABASE_URL` | owner URL/password, session secret |

Каждый workload ссылается на конкретный числовой Secret Manager version. Alias `latest` запрещён для release configuration. Service identities получают `secretAccessor` только на перечисленные secrets; staging identity не читает production project. Publisher и deployment workflow используют разные short-lived WIF providers и не хранят service-account JSON key. Deployment provider имеет явные targets `work-card-deployer` и `work-card-smoke`: первый остаётся привилегированным из-за `iam.serviceAccountUser` + deploy permission, второй получает только `roles/run.invoker` на private staging service. Hosted browser process дополнительно отклоняет DB/owner/PG/cloud-credential variables, не наследует GitHub OIDC и читает лишь обновляемый audience-bound ID token из удаляемого temporary file.

Hosted `DATABASE_URL` и `MIGRATION_DATABASE_URL` направляются в Cloud SQL Auth Proxy Unix socket `/cloudsql/<project>:<region>:<instance>`. Socket path передаётся как полностью percent-encoded `host` query parameter PostgreSQL URL, `sslmode=disable`; пароль также URL-encoded. При наличии `K_SERVICE`/`CLOUD_RUN_JOB` startup fail-fast отклоняет TCP, raw/unencoded или неоднозначный host, лишние query parameters, неверный connection name, порт и путь длиннее лимита Unix socket. Unit test отдельно подтверждает, что закреплённый `pg@8.23.0` разбирает URL в ожидаемый `Client.host`; это не проверка наличия socket или подключения к Cloud SQL. Connection name и DB username не считаются secrets, но полный URL считается secret из-за password.

## `APP_ORIGIN`

- staging и production имеют разные значения;
- значение равно origin страницы в browser и начинается с `https://`;
- Cloud Run revision tag URL, локальный proxy URL и будущий custom domain не добавляются как второй origin;
- смена service URL/custom domain требует отдельной revision и browser security regression check;
- `APP_ORIGIN` с HTTPS автоматически включает `Secure` для session cookie.

Конкретный service origin передаётся Terraform как обязательный input и проверяется по фактическому Cloud Run URI. В Git хранится только placeholder example, а не выдуманное release-значение.

## Политика секретов

- `.env` и логи исключены из Git; `.env.example` не содержит настоящих секретов.
- owner URL отсутствует в environment runtime-контейнера `app`.
- staging/production используют разные secret resources и DB roles; secret payload не копируется между контурами.
- `SESSION_SIGNING_SECRET` создаётся CSPRNG минимум из 32 random bytes; rotation означает новый закреплённый version и инвалидирует существующие demo sessions.
- Cloud Run configuration фиксирует числовой secret version вместе с revision, чтобы rollback не зависел от изменяемого alias.
- Pino пишет однострочный JSON с ISO `time`, Cloud Logging `severity` и `message`; app records содержат `appVersion`, service/revision, request ID, route template, status и duration, jobs — command/execution/phase/outcome.
- logger исключает query/body/headers/cookies, CSRF/session tokens, DB URL, SQL и raw driver message/stack; автоматический тест проверяет injected markers согласно [[security-baseline]].
- session cookie подписана, имеет `HttpOnly`/`SameSite=Lax`, а `Secure` включается для HTTPS origin; SPA хранит CSRF только в памяти и очищает защищённое состояние при смене роли.
- секреты не передаются в browser bundle, health response или OpenAPI.
- уникальные staging/production secret resources, numeric versions и workload bindings описаны Terraform; сами credentials, `apply` и hosted inspection ещё не выполнены.
- утечка секрета требует ротации; удаление строки из Git не считается устранением утечки.

## Критерий принятия

Для локального контура Compose model проверен, runtime-контейнер стартует без owner URL, а отдельная проверка подтверждает ограниченные права роли приложения. Кодовые tests подтверждают sanitized health, JSON logging/redaction, запрет proxy trust вне Cloud Run, one-hop spoof resistance/rate-limit key, разбор Unix-socket URL текущим `pg` и отсутствие DB/owner credentials в hosted runner. Для hosted контуров reviewable plan и `deploy.yml` tests доказывают структуру ownership/configuration contract, но фактическая готовность по-прежнему требует `apply`, IAM inspection, exact secret-version binding, hosted `migrate → seed → verify`, безопасного `reset`, IAM close/restore, наблюдения реальной proxy chain/client IP и подключения через смонтированный socket в smoke по [[deployment]].
