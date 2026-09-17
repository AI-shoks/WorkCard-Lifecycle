---
artifact_id: engineering.ci-pipeline
status: accepted
version: 16
owner: engineering
updated: 2026-09-17
---

# CI Pipeline

GitHub Actions workflows находятся в `.github/workflows/` относительно Git checkout root. Исходный workspace расположен в `WorkCard-Lifecycle/`, поэтому `defaults.run.working-directory` направляет shell steps в корень приложения. Такое размещение позволяет GitHub обнаружить workflows и сохраняет код проекта в существующей директории репозитория.

## Триггеры и безопасность

Основной `ci.yml` запускается для pull request и push в `main`/`codex/**`. Concurrency отменяет устаревший run той же ветки. Этот workflow имеет только `contents: read`; deployment, публикация образа и запись в репозиторий отсутствуют.

Общий `.github/actions/setup-workspace/action.yml` использует Node из `WorkCard-Lifecycle/.node-version`, фиксированный `pnpm` и `pnpm install --frozen-lockfile`. Cache key явно строится по `WorkCard-Lifecycle/pnpm-lock.yaml`. Lockfile проходит strict minimum-release-age policy 1440 минут без исключений; build-script разрешён только `esbuild`. Checkout, setup и upload actions закреплены по commit SHA; setup-node/pnpm action работают на Node.js 24.

## Job `quality`

1. поднимает чистую PostgreSQL 18.6 service;
2. устанавливает зависимости с pnpm cache;
3. выполняет `pnpm check`;
4. выполняет owner bootstrap с migrations + initial seed + verify;
5. повторяет bootstrap/seed checks без обновления reset timestamp;
6. проверяет owner catalog assertions и реальные runtime role boundaries;
7. запускает backend integration suite с runtime и owner URL;
8. валидирует Compose model;
9. запускает `pnpm test:quality`: новые rollback/migration/security/budget tests в отдельных случайных БД и runtime-ролях через `QUALITY_OWNER_URL`.

Owner и runtime credentials существуют только в job environment и являются синтетическими.

## Job `security`

`pnpm security:dependencies` проверяет все scopes зависимостей с блокировкой HIGH/CRITICAL. `pnpm security:secrets` запускает закреплённый Gitleaks для всей доступной Git-истории (`fetch-depth: 0`, `--all`) и отдельного снимка текущего кода/конфигурации. Значения находок скрыты `--redact=100`. Исключены только шесть проверенных исторических тестовых fingerprints из `.gitleaksignore`; текущий код не исключается. Ротация настоящих leaked credentials не подменяется исключением.

## Job `container`

Job зависит от `quality`, строит multi-stage образ с `--no-cache`, выполняет `docker compose up --no-build --wait`, затем отдельно `docker compose run --rm --no-deps readiness` и проверяет liveness/SPA. Одноразовая readiness probe находится в профиле `checks`, а bootstrap — dependency приложения с `service_completed_successfully`; завершённая probe не входит в обычное ожидание running/healthy. Runtime — закреплённый distroless Node 24 / Debian 13 без npm/shell; build stage отделён. Этот же runtime image экспортируется и сканируется закреплённым Trivy: OS/application vulnerabilities, HIGH/CRITICAL, `--exit-code 1`, без `--ignore-unfixed` и общего allowlist. `--parallel 1` ограничивает расход памяти без изменения правил. Ошибка сканера также блокирует job. При ошибке печатаются container logs; cleanup ephemeral volumes выполняется всегда.

## Job `browser`, matrix `compact` / `canonical`

Каждая matrix entry имеет собственную PostgreSQL service, новую БД/runtime-роль и production SPA. Compact выполняет по два теста на desktop/mobile и доказывает весь процесс на шести карточках. Canonical отдельно выполняет все 250 lifecycle через UI, три gates, `1 + 59 + 52`, отдельную финальную приёмку, полный audit 254 и один payroll. Recovery использует реальные конкурирующие UI-команды и потерю ответа после настоящего commit, без fake success. Нет test retries, skips или `continue-on-error`; один worker.

## Job `performance`

На отдельной PostgreSQL service `pnpm test:performance` создаёт 10 000 карточек через API и измеряет release/assignment/detail/pagination/audit. JSON содержит объём, среду, дату, raw samples и распределения. Завершение/корректность обязательны; выдуманного business-SLA или threshold для шумного shared runner нет. Интерпретация и локальные результаты — [[quality-gates]].

## Job `release_iac`

Название job сохранено для совместимости preflight с семью обязательными CI checks. Вместо активного GCP Terraform plan job проверяет Render/Neon deployment contract: один Free image-backed service, health/liveness, no preview/disk/paid jobs, strict target/secret boundaries, immutable GHCR digest и отсутствие rebuild при promotion. GCP Terraform остаётся историческим неактивным вариантом; его прежние локальные результаты сохранены в [[quality-gates]] и [Terraform README](../../infra/terraform/README.md).

Actionlint проверяет `ci.yml`, `release.yml`, `deploy.yml`, `reset.yml`, `rollback.yml`; `pnpm test:release` сохраняет schema compilation и negative manifest/scan/evidence/deployment/smoke tests. Versioned schemas и cross-field validation адаптированы к Render/Neon, а не удалены. CI не имеет hosted secrets, не использует Neon, не создаёт resources и ничего не публикует. Остальные шесть quality jobs сохраняются.

## Ручной `release.yml`

Только `workflow_dispatch` с `main`; preflight требует успешный полный push-CI того же SHA. Одна `linux/amd64` сборка получает full-SHA tag/OCI revision/`APP_VERSION`; существующий tag не перезаписывается. Publisher получает job-scoped `GITHUB_TOKEN` с `packages: write`, без Neon/Render credentials и без GCP WIF/gcloud.

Опубликованный exact GHCR digest pull-ится и сравнивается с локальной сборкой/config/platform, сканируется Trivy HIGH/CRITICAL. Public visibility проверяется anonymous pull; перед первым продвижением package отдельно переводится в public в рамках разрешённой публикации. После первого private push manual `resume_run_id` восстанавливает проверенный digest из отдельного single-file artifact `published-identity-<SHA>-<originalRunAttempt>` исходного run того же SHA; успешные build/push steps проверяются, image повторно не собирается. Этот artifact записывается до anonymous pull, хранится 30d и содержит `published-identity.json` без зависимости от общего upload root. Manifest содержит только проверенные build/scan факты, раздельные source-build/build-scan run bindings, source/CI и migration checksums по [versioned schema](../release/release-manifest.v2.schema.json).

GitHub Release assets сохраняют manifest/scan и последующие [evidence records](../release/release-evidence.v2.schema.json) на весь срок эксплуатации/rollback. Actions artifacts остаются временной диагностикой, а не единственным release archive. Release workflow не выполняет owner DB tasks или Render deployment.

## Ручной `deploy.yml`

Только manual `main` release, связанный с ранее успешным release run и тем же SHA/digest. Workflow повторно проверяет manifest, Trivy binding и migration checksums, не строит image и не принимает mutable tags.

Staging owner job выполняет initial `bootstrap` либо, при обычном release, `node dist/migrate.js`; затем всегда отдельный fixed `reset` на staging Neon target. Migrate оставляет gate закрытым, reset проверяет schema/fixtures и открывает чистое demo с новым verified timestamp. Просроченный предыдущий staging reset не подменяется повторным bootstrap. Runtime запускается из того же image временным Docker на runner с runtime-only environment; readiness и browser/security checks выполняются отдельно от owner process. Browser не получает DB/PG/owner/deployment credentials; local-only DB helper guards не ослаблены.

Production owner migration идёт отдельной границей. Render adapter проверяет service contract и совпадение текущих persistent/live digests. До PATCH он сохраняет staging evidence и `production-attempt` с previous image в GitHub Release, затем обновляет постоянный image reference, записывает deploy ID, ждёт конечный status и сверяет resolved digest. Live record сохраняется до browser smoke; ошибка/отмена smoke сохраняет доступный rollback record. Несекретные факты добавляются schema-validated append-only evidence. Реальная chain/proxy/TLS/logging/cold-start qualification остаётся отдельным hosted requirement; fixture PASS его не создаёт.

## Ручной `rollback.yml`

Manual main-only workflow принимает exact current/previous SHA и sequence retained deployment record, требует `ROLLBACK PREVIOUS COMPATIBLE DIGEST` и использует общую owner/deployment concurrency group. Проверяются оба release records, доступность public target image, текущий persistent/live digest и одинаковые migration checksums. Deploy ID выбранного live/triggered evidence должен совпасть с фактическим current live deployment; prepared intent либо старый record того же digest не принимаются. DB credentials и destructive down migrations отсутствуют.

До PATCH durable archive получает rollback decision/attempt и compatibility binding; после запуска записываются deploy ID и live status/resolved digest до browser smoke. Отдельный browser job не получает provider/DB secrets. Log-verification/evidence job завершает rollback только после full security/canonical/proxy smoke и сохраняет `rollback-decision: completed`; потеря/ошибка smoke не стирает фактический deployment. Подробный операторский порядок — [[deployment]].

## `reset.yml`

Daily schedule 02:17 UTC и manual trigger с `RESET SYNTHETIC PRODUCTION DEMO` запускают только фиксированный production `reset` текущего проверенного digest. Присутствуют timeout, проверка expected Neon target и main branch, owner-only secrets и общая concurrency group `work-card-owner-and-release` с deployment. Arbitrary commands/SQL, seed и unconditional reopen отсутствуют. DB advisory mutex сериализует owner orchestration также при локальном запуске вне Actions.

Scheduled Actions могут опаздывать, пропускаться или отключаться в неактивном public repository. Без successful reset + verify в течение 26 часов API закрывается DB gate независимо от состояния workflow; `/health/live` продолжает работать. Оператор контролирует last-success и выполняет manual recovery по [[deployment]].

## Кэширование, secrets и артефакты

Кэшируется pnpm store по lockfile. `node_modules`, DB, credentials и owner environment не публикуются. CI browser reports могут содержать только временные synthetic sessions локальной disposable DB; hosted browser trace выключен, sensitive raw logs не входят в evidence. Security scan отчёты redacted.

GitHub environments разделяют `staging-owner`, `staging-runtime`, `production-owner` и `production` (Render adapter). Secrets задаются только в нужных steps/containers. Полная матрица имён — [[environments]]. Current/previous GHCR image и GitHub Release assets не удаляются автоматической retention policy весь срок эксплуатации/rollback; workflow artifacts не заменяют этот архив.

Владелец разрешил scoped commit/push, PR/merge после обязательных gates, полный CI и ручные release/deploy/reset/rollback workflows для установленных ресурсов проекта. Успешные удалённые runs текущей реализации и hosted qualification ещё должны быть привязаны к фактическому `main` SHA/digest; прежние runs этого не доказывают. Фактические результаты перечислены в [[quality-gates]] и release records по [[deployment]].

## Критерий принятия

Закрытие этапа 9 требует зелёных `quality`, `container` (включая image scan), `security`, обеих `browser` matrix entries и `performance` для одного implementation SHA. Локальные проверки и успешные runs прежнего SHA не подменяют этот gate. Scoped commit/push и PR/merge разрешены владельцем для текущей задачи после обязательных проверок; gate полного CI того же `main` SHA перед release сохраняется. Workflow не меняет branch protection через API; здесь зафиксирован критерий приёмки проекта.

Workflow обнаруживается GitHub из корневой `.github/workflows/`, а shell steps выполняются в `WorkCard-Lifecycle/`. Implementation commit [`17d2b04d13b58c7dff677543ed4399751a8593a1`](https://github.com/AI-shoks/WorkCard-Lifecycle/commit/17d2b04d13b58c7dff677543ed4399751a8593a1) подтверждён полностью зелёными [push CI](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33581627867) и [PR CI](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33581630041): в обоих запусках jobs `Code and database quality` и `Clean container startup` завершены успешно. Это закрывает удалённый acceptance gate этапа 7. Неблокирующее предупреждение GitHub о переводе runtime используемых actions с Node.js 20 на 24 учтено как maintenance item в [[backlog]].

## Историческое закрытие этапа 8

SHA `b00ff294a7b7ce1e09379c088969d9a02bd033bf` подтверждён успешными [push CI](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33963228130) и [PR CI](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33963230414), включая `quality` и `container`. Оба SHA/conclusions повторно прочитаны при начале этапа 9.

Локальный clean-container этапа 8 также прошёл без кэша на новом томе, с миграциями/seed, healthy SPA/API/БД и HTTP 200. Docker установлен; отсутствие Docker и незакоммиченный frontend в прежней редакции были устаревшими отметками.

## Закрытие этапа 9

Этап 9 закрыт 2026-09-05: implementation SHA [`3ee65709966f5775928de87783fd2946d085e2bc`](https://github.com/AI-shoks/WorkCard-Lifecycle/commit/3ee65709966f5775928de87783fd2946d085e2bc) на момент проверки совпадал с локальным HEAD и head PR #1 в `codex/portfolio`. Через GitHub API подтверждены [push CI](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33970654850) и [PR CI](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33970656850): все 6 обязательных jobs имеют `completed/success` для того же SHA в каждом запуске, включая image scan в `container`. Полная матрица и локальные результаты — [[quality-gates]]. Это историческое закрытие этапа 9; текущий Render/Neon этап 10 и его локальные проверки описаны выше и в [[quality-gates]], без утверждения о hosted deployment.
