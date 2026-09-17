---
artifact_id: engineering.environments
status: accepted
version: 11
owner: engineering
updated: 2026-09-17
---

# Environments and Secrets

Один image содержит SPA/API и owner CLI. Environment-specific конфигурация передаётся при запуске; secrets не входят в image, repository, browser bundle, health или release evidence. Текущий контракт — [[0009-render-free-neon-free-release|ADR-0009]] и [[deployment]].

## Контуры

| Контур | Приложение | PostgreSQL | Секреты |
|---|---|---|---|
| local | Compose или Vite/API | локальная PostgreSQL 18 | раздельные ignored `.env` / `.env.owner`, только synthetic values |
| test/CI | disposable процессы/containers | локальная disposable PostgreSQL 18 | job-scoped synthetic values; никакого Neon |
| staging | локальный/временный Actions Docker | отдельный Neon Free project, PostgreSQL 18 | отдельные owner/runtime environments |
| production | один Render Free image service | другой Neon Free project, PostgreSQL 18 | Render runtime; отдельный owner environment |

Реальные производственные, кадровые и расчётные данные запрещены. Staging не является постоянным вторым Render service и не использует production DB.

## Переменные

| Имя | Потребитель | Контракт |
|---|---|---|
| `APP_ENV` | API/owner | `development`, `test`, `staging`, `production`; последние два требуют Neon contract |
| `APP_VERSION` | API/owner | source SHA из image; metadata без секрета |
| `CONFIGURATION_REVISION` | release evidence | несекретная метка reviewed config/rotation; не provider secret version |
| `RELEASE_EVIDENCE_DURABLE` | Render release adapter | обязательное значение `1`; omission не разрешает promotion без durable journal |
| `RENDER_API_KEY` | adapter / отдельный log-verification job | доступ к Render API; отсутствует в owner/runtime/browser |
| `GH_TOKEN` | release preflight / evidence writer | job-scoped GitHub token; write только для immutable release assets/evidence |
| `GITHUB_REPOSITORY`, `GITHUB_RUN_ID`, `GITHUB_RUN_ATTEMPT` | durable evidence context | несекретный binding к фактическому GitHub run/attempt |
| `WORKCARD_ROLLBACK_AUTHORIZATION` | rollback adapter | явное подтверждение fixed rollback operation; не secret и не SQL input |
| `RENDER_OWNER_ID`, `RENDER_SERVICE_ID`, `RENDER_ORIGIN` | adapter/qualification | exact ожидаемые workspace/service/origin, без payload |
| `HOST`, `PORT` | API | bind `0.0.0.0`, фактический `PORT` Render; Docker health использует тот же порт |
| `LOG_LEVEL` | API/owner | безопасный JSON logger |
| `DATABASE_URL` | API | только SQL-created runtime role, direct Neon TCP/TLS |
| `MIGRATION_DATABASE_URL` | owner CLI | только owner; запрещена runtime/browser |
| `NEON_DATABASE_HOST`, `NEON_DATABASE_NAME` | API/owner | обязательный exact ожидаемый target в staging/production |
| `APP_DATABASE_USER`, `APP_DATABASE_PASSWORD` | bootstrap/release | создание/проверка runtime role; отсутствуют в runtime/browser |
| `SESSION_SIGNING_SECRET` | API | минимум 32 CSPRNG bytes; уникален для каждого контура |
| `APP_ORIGIN` | API | один точный browser origin без path/query/trailing slash; production только HTTPS |
| `PROXY_TRUST_MODE` | API | `none` для local/Actions Docker; Render initial `observe` или qualified `render` |
| `PROXY_TRUSTED_CIDRS` | Render API | отсутствует в `observe`; в `render` — reviewed allowlist наблюдённых peers, не весь internet |
| `RENDER`, `RENDER_SERVICE_ID`, `RENDER_INSTANCE_ID` | Render API | platform metadata, не substitute proxy qualification |
| `STAGING_NEON_HOST` | production owner target guard | несекретный direct staging host; production target обязан отличаться |
| `PRODUCTION_NEON_HOST` | staging owner target guard | несекретный direct production host; staging target обязан отличаться |
| `DEMO_MAX_BATCHES`, `DEMO_MAX_SESSIONS` | API | hosted bounds `20` и `500` |
| `WEB_DIST_PATH` | API | каталог production SPA |
| `COMPOSE_APP_ORIGIN`, `POSTGRES_*` | local/CI | только disposable local configuration |

Runtime во всех средах отвергает `MIGRATION_DATABASE_URL` и `APP_DATABASE_PASSWORD`; не загружайте owner env в API shell. Local owner/bootstrap использует отдельный `.env.owner` из `.env.owner.example`; runtime — `.env` из `.env.example`.

Внутри одного контура `APP_DATABASE_USER` и `APP_DATABASE_PASSWORD` задают SQL runtime-роль, которой соответствует `DATABASE_URL`; owner `MIGRATION_DATABASE_URL` использует другую роль. Оператор проверяет этот binding при разрешённой настройке/rotation, не записывая значения в Git/evidence и не передавая runtime URL owner CLI. Runtime readiness подтверждает успешное подключение отдельно от owner catalog verification.

Staging runtime с `APP_ENV=staging` может использовать direct Neon и `PROXY_TRUST_MODE=none` без Render marker. Local Compose использует `APP_ENV=test` при production Node/image; это не ослабляет hosted TLS contract или loopback guard DB-test helpers.

## Neon TCP/TLS

Runtime и owner URL содержат точный direct hostname, ожидаемое имя database и единственный `sslmode=verify-full`. Сертификат и hostname проверяются. `-pooler`, socket paths, чужие target host/database, downgrade, повторные параметры и конфликтующие overrides отклоняются. `PG*`/TLS overrides нельзя использовать для обхода contract; `NODE_TLS_REJECT_UNAUTHORIZED=0` запрещён. Полный URL содержит пароль и всегда считается secret. Логи не должны печатать URL или raw parser/driver error.

Direct endpoint необходим из-за session advisory locks и startup timeout options. Общая PostgreSQL session у transaction pooler не обеспечивает эти ожидания. Реальное TLS соединение и CA/hostname validation проверяются только в отдельно разрешённой hosted qualification; unit tests доказывают contract/parser behavior.

## Secret boundaries

| Процесс | Доступно | Не передаётся |
|---|---|---|
| Render runtime / staging runtime container | `DATABASE_URL`, `SESSION_SIGNING_SECRET`, несекретный target/origin/proxy contract | owner URL/password, Render API token |
| owner bootstrap/release | `MIGRATION_DATABASE_URL`, `APP_DATABASE_USER`, `APP_DATABASE_PASSWORD`, target metadata | session secret, runtime URL |
| owner reset/verify | `MIGRATION_DATABASE_URL`, target metadata | runtime URL/password, session secret |
| browser smoke | exact origin и несекретные expected metadata | любые DB/owner/PG/cloud/deployment credentials |
| Render adapter / rollback adapter | `RENDER_API_KEY`, job-scoped `GH_TOKEN`, service metadata и configuration revision | DB/owner credentials |
| Render log verification | `RENDER_API_KEY`, reviewed peer CIDRs и source/report metadata | DB/owner/runtime credentials; browser process здесь не запускается |
| GHCR publisher | job-scoped `GITHUB_TOKEN` с `packages: write` | Neon и Render secrets |

GitHub Environments разделены: `staging-owner`, `staging-runtime`, `production-owner`, `production`; последний обслуживает Render adapter. Owner secrets передаются только соответствующим owner steps/containers; наследовать их browser process запрещено. Runtime и browser не должны работать на self-hosted shared runner с сохранёнными owner credentials.

Фактическое состояние на 2026-09-17: через `gh` в точном repository `AI-shoks/WorkCard-Lifecycle` созданы все четыре environment; у каждого custom deployment branch policy допускает только branch `main`. Secrets пока не установлены. Новый Render service и Neon projects для этого демо ещё не созданы; наличие environment не доказывает подключение к БД или runtime/owner binding.

GitHub/Render не предоставляют числовое неизменяемое secret-version binding прежнего Secret Manager. У оператора есть отдельные rotation identifiers; evidence записывает только эти имена/идентификаторы, время и binding checks, без payload. Rotation DB/session credentials выполняется отдельным разрешённым действием; session-secret rotation инвалидирует demo sessions. Rollback приложения не восстанавливает прежние secret values автоматически.

## Origin, proxy и logging

Production `APP_ORIGIN` совпадает с каноническим HTTPS Render URL. Staging temporary Docker допускает HTTP только на loopback (`localhost`, `127.0.0.1`, `::1`) и имеет отдельный exact origin; смена origin требует повторной проверки Origin/CSRF/cookie. HTTPS включает `Secure`; cookie остаётся `HttpOnly; SameSite=Lax`, CSRF живёт только в памяти SPA.

Для первого запуска `PROXY_TRUST_MODE=observe` разрешён только на Render: CIDR allowlist отсутствует, forwarded headers не получают доверия, все `/api*` и `/health/ready` принудительно отвечают `503` до DB, даже если owner gate случайно открыт. Liveness/SPA и sanitized peer logs остаются доступны. После наблюдения реального socket peer оператор рассматривает exact IP/обоснованный CIDR, переключает `render` и выполняет обязательную chain/client-IP/spoof qualification; угадывать Render диапазон не нужно. Initial owner migration держит persistent DB gate закрытым до bootstrap + verify. Последовательность — [[deployment#Первый запуск без предположения о proxy|Deployment]].

Безусловный `trustProxy=true` запрещён. Код доверяет только проверенному immediate peer из `PROXY_TRUSTED_CIDRS` и цепочке адресов из этого allowlist; localhost test не доказывает реальную Render header chain. Перед публичным запуском нужно наблюдать socket peer, добавляемые Render заголовки, client IP и spoofed XFF, включая cold start/redeploy. Неизвестная цепочка блокирует qualification, а не расширяет allowlist автоматически.

Pino пишет однострочный JSON с безопасными service/version/request/command fields и техническими `remoteAddress` (socket peer), `remoteIp` (resolved client), `protocol` для квалификации proxy chain. Публикуемые observation summaries относятся к synthetic runner requests; raw visitor logs не входят в release assets. Query/body/headers/cookies, SQL, DB URL, CSRF/session tokens и raw driver messages/stack исключены. Render application logs доступны на Hobby с retention 7 дней; platform HTTP request logs требуют Pro+, поэтому $0 qualification опирается на собственный request ID/peer/IP/protocol и независимый egress IP runner, а не на недоступные request logs. Источник — [Render logging](https://render.com/docs/logging). Фактическое ingestion всё равно проверяется отдельно. Idle pool errors обрабатываются безопасно без падения процесса и без credential leakage.

## Граница проверки

Владелец разрешил настройку environments/secrets и создание одного Render Free service и двух Neon Free projects в рамках первого deployment. Read-only preflight GitHub и выбранного Render workspace начат; подтверждённые billing facts и границы ресурсов записаны в [[deployment]]. Создание demo targets, реальные DB operations, публикация image и hosted qualification ещё требуют фактических records. Фактический Neon Free plan и общий $0-профиль эксплуатации ещё не подтверждены. Разрешение не распространяется на посторонние БД/resources или платные опции; обычный CI сохраняет только disposable PostgreSQL. Доказанные проверки и конкретные ограничения — [[quality-gates]]; hosted checklist — [[deployment]].
