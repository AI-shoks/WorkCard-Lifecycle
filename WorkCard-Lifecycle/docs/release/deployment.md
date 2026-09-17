---
artifact_id: release.deployment
status: accepted
version: 14
owner: release
updated: 2026-09-17
---

# Deployment

Текущий локально реализованный контракт — [[0009-render-free-neon-free-release|ADR-0009]]: один Render Free service из публичного GHCR image, отдельные Neon Free PostgreSQL 18 projects для production/staging. Действия посетителей не сохраняются при recovery; чистое synthetic demo из migrations + seed является достаточным восстановлением. Владелец разрешил scoped commit/push, PR и merge после обязательных проверок, создание этих трёх ресурсов, настройку environments/secrets, публикацию GHCR, workflows и owner operations на созданных для демо БД. Эти разрешения действуют только для однозначно установленных аккаунтов/ресурсов проекта и не требуют повторного подтверждения. Платные планы/add-ons/overage, добавление payment method, GCP apply/destroy и изменение посторонних ресурсов запрещены. Фактический deployment и hosted qualification ещё должны быть подтверждены release records.

Репозиторий — источник текущей реализации. Workflows находятся в `.github/workflows/` родительского Git root; shell steps работают в `WorkCard-Lifecycle/`. GCP Terraform неактивен. Полный прежний runbook, включая foundation/backend work, сохранён в [[deployment-gcp-history]]; его исторические сведения об аккаунтах не являются новой внешней проверкой.

## Deployment contract

| Область | Контракт |
|---|---|
| App | один image-backed Render web service, явно Free; SPA + Fastify same-origin; один instance |
| Registry | публичный GHCR, одна `linux/amd64` сборка; production reference только `image@sha256:…` |
| Staging app | локальный или временный Actions Docker; второго постоянного Render service нет |
| DB | отдельные Neon Free projects для staging/production; PostgreSQL major 18; runtime и owner direct endpoints |
| TLS | единственный `sslmode=verify-full`; exact expected host/database; pooler/downgrade/overrides запрещены |
| Owner | одноразовый container того же digest; fixed owner CLI commands; отсутствует в runtime/browser |
| Health | Render `healthCheckPath=/health/live`, без SQL; release/Compose/CI отдельно требуют `/health/ready` |
| Maintenance | DB shared/exclusive barrier + owner mutex, persistent state, 26h fail-closed |
| Ограничения | без previews, disks, paid jobs, second service, migrations at API startup и keepalive |

Конфигурация и её validator — [infra/render](../../infra/render/README.md). PostgreSQL patch определяется Neon; фактический `SELECT version()` фиксируется при hosted запуске. PG18 доступен без preview-ограничений с 2026-05-01; это не подтверждение patch конкретного проекта. [Neon PG18 GA](https://neon.com/docs/changelog/2026-05-01)

## Стоимость, сон и recovery window

$0 — целевой эксплуатационный профиль, а не обещание непрерывной доступности. Оператор до первого запуска подтверждает Free в Render/Neon, отсутствие платных add-ons и auto-upgrade, состояние payment method/overage и доступные GitHub квоты. Без этого платные перерасходы Render нельзя исключить. Подробные сверенные limits и источники — [[0009-render-free-neon-free-release#Ограничения $0|ADR-0009]].

Cold start, quota exhaustion и suspension допустимы; постоянный ping/keepalive запрещён. Неограниченного трафика нет: Neon connection/storage/compute и исходящий Render traffic контролируются по dashboard при эксплуатации. При исчерпании квот демо остаётся недоступным, без автоматического перехода на платный план. Neon recovery window существенно короче прежнего GCP PITR; история посетителей не является recovery obligation.

## Образ, CI и release evidence

1. Ручной `release.yml` принимается только с `main` и после успешного полного push-CI того же SHA. Сохраняются code/database, security, container + Trivy, compact/canonical browser, performance и deployment-contract gates.
2. Собрать ровно один `linux/amd64` image с source SHA/OCI revision/`APP_VERSION`; занятый full-SHA tag не перезаписывать. Публикация GHCR использует job-scoped `GITHUB_TOKEN`, отдельный от deployment secrets.
3. Pull exact digest, сверить config digest/labels/platform, выполнить Trivy OS/npm HIGH/CRITICAL без blanket exceptions. GHCR package должен быть публичным; anonymous pull обязателен. Если первая публикация создала private package, владелец отдельно меняет visibility и запускает новый manual run того же SHA с `resume_run_id` исходного run. Проверяются исходные успешные build/push steps и сохранённая image identity; используется тот же digest без повторной сборки. Отдельный single-file artifact `published-identity-<SHA>-<originalRunAttempt>` содержит `published-identity.json`, сохраняется до anonymous pull и хранится 30d для этого ограниченного resume; его потеря не разрешает перезаписывать full-SHA tag.
4. Сформировать versioned [manifest](release-manifest.v2.schema.json): source/CI/build URLs, image/config digest, scan checksum/summary, SQL checksums. Schema и межполевые validators обязательны; fake deployment placeholders запрещены.
5. Фактические staging/deploy/smoke/promotion/rollback события добавляются отдельными append-only hash-chained records по [evidence schema](release-evidence.v2.schema.json). Новая версия схемы отражает Render/Neon; историческая GCP schema сохраняет свой смысл и не переименовывает старое evidence в новое.

Manifest и проверяемые release assets сохраняются как GitHub Release records, а не только Actions artifacts. Release record создаётся только по соответствующей фактической публикации/операции; локальные fixtures и незакоммиченное дерево не заменяют source SHA и hosted evidence.

## Staging и production

`deploy.yml` вручную запускается только из `main` с подтверждением `PROMOTE EXACT DIGEST`; фиксированные operations — `release` (по умолчанию) или initial `bootstrap`, optional `release_sha` выбирает ранее опубликованный full SHA. Workflow получает ранее опубликованный immutable digest и проверяет его manifest/CI/scan/checksums. Он не собирает image. Owner orchestration и runtime/browser jobs разделены по секретам; точная матрица — [[environments]].

Staging owner при первом запуске выполняет fixed `bootstrap`, при последующих — `node dist/migrate.js`, который оставляет gate закрытым; затем в обоих случаях выполняет fixed `reset`. Такая последовательность проверяет новую schema и готовит чистое staging demo, даже если предыдущий reset старше 26 часов. Runtime контейнер того же digest стартует временно с runtime URL и отдельным origin; ожидается readiness, затем выполняются security и browser smoke. Browser получает только HTTP origin/несекретные metadata. Test DB helpers сохраняют localhost guard; для Neon используется отдельный явный owner/release путь, а не override локальных тестов.

Production owner аналогично применяет forward migration под закрытым gate. `node scripts/release/render-adapter.mjs MANIFEST OUTPUT` получает `RENDER_API_KEY`, job-scoped `GH_TOKEN` для записи evidence и несекретные `RENDER_OWNER_ID`, `RENDER_SERVICE_ID`, `RENDER_ORIGIN`, `CONFIGURATION_REVISION`, `RELEASE_EVIDENCE_DURABLE`; это отдельная deployment secret boundary. `RELEASE_EVIDENCE_DURABLE=1` обязателен даже для прямого CLI: local-only journal не разрешает mutation. Render adapter сначала проверяет service ID/type/Free/image-backed/single-instance/no disk/no previews и совпадение предыдущего persistent reference с фактическим live resolved digest. Drift требует явного reconciliation. До изменения сервиса staging report и `production-attempt` с previous image сохраняются в GitHub Release. Затем adapter **обновляет постоянный image reference сервиса**, запускает deployment, сохраняет полученный deploy ID, ожидает конечный успешный status и сверяет resolved digest с manifest. Live deployment record сохраняется до browser smoke, поэтому failed/cancelled smoke не уничтожает prior-image evidence. Deploy response/HTTP 202 и success request не являются proof rollout. Несовпадение reference/digest, неизвестный API shape или неуспешный deployment прекращают продвижение.

После readiness выполняется ограниченный public smoke; health response сохраняет только status. Реальные Render proxy chain, client IP и spoofed XFF, TLS certificate/host, owner/runtime role boundaries, logging/redaction, cold start и post-deploy exact digest фиксируются как hosted evidence. Зелёный локальный adapter fixture не заменяет эти наблюдения. На $0 нет platform HTTP request logs (они Pro+): qualification связывает собственный `requestId`, socket peer из allowlist, protocol и resolved client IP с независимым egress IP runner через публичный HTTPS Cloudflare trace без credentials. Отсутствие/несовпадение observations закрывает gate qualification; app logs и их Hobby retention 7d описаны в [[environments]].

## Owner commands и maintenance

Команды внутри immutable image:

```text
node dist/owner-maintenance.js bootstrap
node dist/owner-maintenance.js reset
node dist/owner-maintenance.js verify
node dist/owner-maintenance.js release
```

`bootstrap` — initial migrations + seed + verify; только успешное первое создание demo устанавливает начальный verified timestamp. `reset` — удалить mutable demo/sessions, verify, обновить timestamp; seed не запускается. `verify` работает при закрытом gate и не изменяет timestamp. `release` применяет migrations/grants и verify, сохраняя прежнюю давность reset. Owner target contract проверяется до DB task; secret values нигде не показываются.

Каждая orchestration сериализуется DB advisory mutex; deploy/reset/rollback workflows имеют общую concurrency group `work-card-owner-and-release` и не отменяют текущий owner run новым запуском. После mutex owner сначала коммитит `maintenance_requested=true`, закрывая новые admissions, затем exclusive barrier дожидается runtime shared locks и фиксирует maintenance/generation. Runtime отдельно читает состояние после lock в `READ COMMITTED`; session/generation перепроверяются перед receipt. Это относится к queries, session touch/delete/cleanup и commands. Fail-closed age — 26 часов с последнего successful reset или initial bootstrap.

Ошибка/отмена сохраняет закрытые admissions даже при timeout/termination во время drain: `maintenance_requested=true` уже закоммичен до ожидания exclusive lock. Только успешная verified операция очищает и requested, и maintenance; ни `finally`, ни shell trap их не открывают. Для восстановления после прерванной операции оператор проверяет target/digest/history, выполняет `verify` при закрытом gate и новый полный `reset` либо исправленный `release`; ручной SQL для фиктивного timestamp запрещён. Не считать остановку Render, HTTP 202 или фиксированную паузу завершением SQL.

## Daily/manual reset

`reset.yml` ежедневно в 02:17 UTC либо вручную с подтверждением `RESET SYNTHETIC PRODUCTION DEMO` запускает только фиксированный production `reset` из текущего проверенного digest; требуется `main`, timeout и target checks. Daily schedule и manual trigger используют ту же owner/concurrency границу; arbitrary shell/SQL/command input отсутствует. Отдельный production adapter job через `current-render-image.mjs` читает постоянный Render reference, делает public pull, получает OCI source SHA и валидирует durable release + CI того же SHA. Затем isolated `production-owner` job получает только `MIGRATION_DATABASE_URL`, `NEON_DATABASE_HOST`, `NEON_DATABASE_NAME` и несекретный `STAGING_NEON_HOST` для отказа при совпадении targets. Owner job не получает Render API key, runtime URL/password или session secret. Runtime, browser и обычный CI не получают owner credentials. Workflow failure требует оператора, а не reopen. Reset не является keepalive, не вызывает API и не запускает seed.

Оператор контролирует `last_reset_verified_at` и результаты Actions. Расписание не гарантировано: задержки/пропуски и отключение неактивного public repository учитываются по [[0009-render-free-neon-free-release|ADR-0009]]. При просрочке API самостоятельно закрывается при следующей DB операции, даже если workflow ни разу не был запущен.

## Хранение и rollback

- Current и previous compatible digests, их full-SHA tags, manifests, scan reports, SQL checksums, evidence chain и несекретные rotation identifiers сохраняются в публичном GHCR/GitHub Releases **весь срок эксплуатации и разрешённого rollback**. Автоматическая package/asset cleanup выключена; истекающие Actions artifacts служат только диагностикой (обычные 3d, scan 30d). Durable assets — `release-record.tar.gz`, checksum `.sha256`, последовательные `evidence-0001.json` и последующие records, `<report-name>-<run-id>-<attempt>.json`; их hashes/bindings проверяются.
- Перед deployment проверяются доступность текущего/предыдущего image без credentials и целостность records. Потеря предыдущего image либо evidence останавливает promotion; небольшой Render history не является самостоятельным архивом.
- Ручной main-only `rollback.yml` принимает `current_sha`, `target_sha`, четырёхзначный `deployment_record_sequence` и подтверждение `ROLLBACK PREVIOUS COMPATIBLE DIGEST`. Используется общая concurrency group `work-card-owner-and-release`. Workflow получает оба retained manifests, проверяет public target image и prior-image record; mutable tags и новые сборки не принимаются. Helper `rollback-render.mjs CURRENT_MANIFEST TARGET_MANIFEST CURRENT_DEPLOYMENT_RECORD OUTPUT` требует `WORKCARD_ROLLBACK_AUTHORIZATION`, Render metadata/key и GitHub evidence context; standalone вызов без durable journal не является поддержанным обходом workflow.
- Rollback target должен быть exact previous digest из live `production-deployment`/`rollback-deployment` либо triggered `production-attempt`/`rollback-attempt` record с `deployId`. Этот ID обязан совпасть с текущим фактическим live Render deployment; проверка повторяется непосредственно перед PATCH. Старый record того же digest не подходит. Prepared intent без deploy ID не даёт права на автоматический rollback; несовпадение persistent/live state требует отдельного reconciliation до новой операции. Консервативный compatibility gate требует одинаковые migration checksums. Перед PATCH сверяются current persistent/live state; current release получает durable `rollback-decision: required`, target release — `rollback-attempt: prepared`. После запуска сохраняется deploy ID, после status/resolved-digest verification — `rollback-deployment: live` и compatibility/report assets **до browser smoke**. Ошибка/cancellation не удаляет эти записи.
- Отдельный job выполняет `public-smoke.mjs TARGET_MANIFEST ORIGIN render OUTPUT` без DB/provider credentials. Затем отдельный job проверяет Render logs через `render-observations.mjs REPORT OUTPUT` и reviewed CIDRs. `retain-evidence.mjs TARGET_SHA CURRENT_SHA` сохраняет full smoke/observations и добавляет `rollback-decision: completed` только после успешной проверки. До этого rollback не считается завершённым. Применяются актуальные явно проверенные secrets; image rollback не откатывает их значения автоматически. DB owner credentials и down migrations в rollback workflow отсутствуют.
- Destructive down migrations запрещены. Если прежний image несовместим с новой schema, traffic rollback не выполнять: оставить gate закрытым и исправить вперёд либо выполнить чистое восстановление synthetic demo на созданной для него БД в разрешённом scope.
- DB recovery может потерять все visitor actions: новый PostgreSQL 18 target, immutable migrations, initial seed, verify, новый runtime binding и qualification. Не нужно переносить history или обещать восстановление из короткого Neon PITR окна.

## Первый запуск без предположения о proxy

Одного свободного Render service достаточно для безопасного наблюдения:

1. После разрешённой publication получить exact digest и пройти temporary staging. Initial production owner контейнер того же digest выполняет только `node dist/migrate.js`: runtime role/schema созданы, persistent maintenance gate остаётся закрытым, initial seed ещё не выполнен. Это отдельный фиксированный низкоуровневый prerequisite; он не запускается API.
2. Создать единственный Free image service с runtime-only secrets, точным HTTPS origin и `PROXY_TRUST_MODE=observe`; `PROXY_TRUSTED_CIDRS` отсутствует. Даже случайно открытое DB state не позволяет `/api*` или readiness: observation hook возвращает `503` до SQL. `/health/live`, SPA и sanitized request logs доступны; доверия XFF нет.
3. Выполнить `node scripts/release/proxy-probe.mjs ORIGIN SOURCE_SHA observe OUTPUT` без DB/provider credentials, затем `node scripts/release/render-observations.mjs REPORT OUTPUT` в отдельном процессе с `RENDER_API_KEY`. Ограниченные liveness probes подтверждают закрытые API/readiness; результат `discovery-only` содержит реальные socket peers, но не является qualification. Дополнить наблюдения cold-start/redeploy. Рассмотреть exact IP либо диапазон, подтверждённый данными платформы; не угадывать диапазон и не ставить all-network CIDR. Задать reviewed `PROXY_TRUSTED_CIDRS`, переключить `PROXY_TRUST_MODE=render` и `CONFIGURATION_REVISION`. Persistent DB gate пока закрыт.
4. Повторить `proxy-probe.mjs ORIGIN SOURCE_SHA proxy-only OUTPUT` и `render-observations.mjs REPORT OUTPUT`: проверить liveness/log peer chain, HTTPS, client IP и spoofed XFF по независимому runner egress. Отсутствие evidence останавливает launch. Далее `node dist/owner-maintenance.js bootstrap` завершает seed + verify и открывает gate в рамках уже разрешённых owner operations.
5. Полный обязательный hosted smoke/records, включая реальные sessions/Origin/CSRF и app readiness, остаётся gate promotion. Режим `observe` никогда не квалифицируется как готовое демо: readiness всегда `503`.

Эта разрешённая hosted процедура ещё должна быть подтверждена фактическими records. Observe не является дополнительным сервисом, не включает keepalive и не требует owner credentials в runtime.

## Перед первым разрешённым deployment

1. Завершить локальные gates и strict docs audit; выполнить scoped commit/push, PR и merge после обязательных проверок. Получить успешный полный CI того же `main` SHA, который будет опубликован. Текущие uncommitted changes не имеют удалённого CI.
2. Подтвердить точные аккаунты/targets, тариф/квоты/$0, разные direct host/database и владельца эксплуатации. Создать только два разрешённых Neon Free PG18 projects; единственный Render Free image service создаётся с опубликованным digest по процедуре closed-gate observe выше.
3. Настроить environments, runtime/owner secret boundaries и rotation identifiers по [[environments]], не записывая payload в Git/evidence. Production runtime secrets/origin задаются при создании Render service; proxy allowlist — только после безопасного наблюдения по последовательности выше. Никаких runtime owner credentials.
4. Выполнить image publication и отдельное изменение GHCR public visibility; сохранить manifest/scan/assets на весь lifecycle. Настроить target metadata для Render adapter и reset current digest без mutable tags; первая private публикация продолжается через `resume_run_id` без rebuild.
5. Выполнить staging initial bootstrap + verify и exact-digest browser/security qualification; production сначала проходит closed-gate observe, затем initial bootstrap + verify и production promotion. Выполнить compatible rollback drill при наличии предыдущего совместимого image; без такого образа не заявлять rollback проверенным. Проверить maintenance races/cancellation, cold start, role/TLS/logging и clean recovery на hosted targets.
6. Назначить владельца daily/manual reset, quota checks, secret rotation и retention; убедиться в 26h fail-closed. Только фактическое evidence закрывает этап 10.

Preflight 2026-09-17 подтвердил публичный repository `AI-shoks/WorkCard-Lifecycle` и рабочий GitHub login. Исторический read-only preflight Render workspace `tea-d8q4f1cvikkc73al6vq0` показал Hobby, отсутствие payment method, начисление и прогноз $0, использование 0.75/750 Free instance hours и 0/5 GB bandwidth. Пользователь затем выбрал отдельный Render аккаунт для WorkCard; прежний workspace и его посторонние services не используются и не изменяются. Его billing facts не переносятся на новый аккаунт.

Новый UI preflight 2026-09-17 подтвердил отдельный account `usr-dalsn92d0e5s738gnrbg` и workspace `tea-dalsn92d0e5s738gnr60`: вход email/password, пустой список services, Hobby, без payment method, pending charges и invoices; использование `0/750` Free instance hours, `0/5 GB` bandwidth и `0/500` pipeline minutes. На момент первичного UI preflight 2FA была выключена, Git credentials и API keys отсутствовали. Новый owner ID уже установлен как `production.RENDER_OWNER_ID` в GitHub и как `RenderOwnerId` в локальном DPAPI bundle; repository binding и четыре исходных защищённых значения сохранены. Service ID, exact origin и reviewed proxy allowlist определяются после создания единственного разрешённого service. Общий $0-профиль эксплуатации ещё зависит от проверки Neon.

Затем в новом аккаунте создан постоянный key `workcard-lifecycle-production-deploy`: сохранён как `SecureString` в DPAPI bundle с ACL только для текущего Windows пользователя, `SYSTEM` и `Administrators`, без наследования, и передан exact stdin в GitHub `production.RENDER_API_KEY`. Значение не выводилось. Официальные API reads подтвердили account `usr-dalsn92d0e5s738gnrbg` через `/users`, ровно один workspace `tea-dalsn92d0e5s738gnr60` через `/owners` и пустой `/services` для этого owner. Это подтверждение credentials/target binding, не deployment; runtime/owner/browser этот ключ не получают.

После scoped PR/merge и полного CI main SHA `1195892f15f2f240dd04f39e8388d6bb8802d9a7` image опубликован один раз: [release record](https://github.com/AI-shoks/WorkCard-Lifecycle/releases/tag/work-card-1195892f15f2f240dd04f39e8388d6bb8802d9a7), exact digest `sha256:231d91a73a72275cefa0bbfe25d316b73315eb1f783d5618ebf55019a39ff057`. Anonymous pull и опубликованный scan прошли; resume не потребовался. Смена Render аккаунта не меняет этот release: при следующем manual deploy явно выбирать этот `release_sha`, не собирать повторно.

Neon login и Free organization/targets, новые ресурсы, реальные DB operations и hosted qualification ещё не подтверждены. Render API key и его account/owner binding готовы к следующим разрешённым операциям, но service ещё не создан и публичный URL приложения отсутствует. Предыдущего совместимого опубликованного image нет, rollback не проверен. По репозиторию GCP deployment не выполнялся; отсутствие GCP ресурсов в аккаунте не утверждается, их удаление не планируется. Полные фактические результаты и оставшиеся проверки — [[quality-gates]].
