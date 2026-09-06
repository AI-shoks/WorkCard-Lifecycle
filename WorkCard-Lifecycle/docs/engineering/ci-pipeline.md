---
artifact_id: engineering.ci-pipeline
status: accepted
version: 13
owner: engineering
updated: 2026-09-06
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
4. применяет миграцию;
5. выполняет seed дважды;
6. запускает runtime DB verification;
7. запускает backend integration suite с runtime и owner URL;
8. валидирует Compose model;
9. запускает `pnpm test:quality`: новые rollback/migration/security/budget tests в отдельных случайных БД и runtime-ролях через `QUALITY_OWNER_URL`.

Owner и runtime credentials существуют только в job environment и являются синтетическими.

## Job `security`

`pnpm security:dependencies` проверяет все scopes зависимостей с блокировкой HIGH/CRITICAL. `pnpm security:secrets` запускает закреплённый Gitleaks для всей доступной Git-истории (`fetch-depth: 0`, `--all`) и отдельного снимка текущего кода/конфигурации. Значения находок скрыты `--redact=100`. Исключены только шесть проверенных исторических тестовых fingerprints из `.gitleaksignore`; текущий код не исключается. Ротация настоящих leaked credentials не подменяется исключением.

## Job `container`

Job зависит от `quality`, строит multi-stage образ с `--no-cache`, выполняет `docker compose up --no-build --wait`, проверяет liveness, readiness и SPA. Runtime — закреплённый distroless Node 24 / Debian 13 без npm/shell; build stage отделён. Этот же runtime image экспортируется и сканируется закреплённым Trivy: OS/application vulnerabilities, HIGH/CRITICAL, `--exit-code 1`, без `--ignore-unfixed` и общего allowlist. `--parallel 1` ограничивает расход памяти без изменения правил. Ошибка сканера также блокирует job. При ошибке печатаются container logs; cleanup ephemeral volumes выполняется всегда.

## Job `browser`, matrix `compact` / `canonical`

Каждая matrix entry имеет собственную PostgreSQL service, новую БД/runtime-роль и production SPA. Compact выполняет по два теста на desktop/mobile и доказывает весь процесс на шести карточках. Canonical отдельно выполняет все 250 lifecycle через UI, три gates, `1 + 59 + 52`, отдельную финальную приёмку, полный audit 254 и один payroll. Recovery использует реальные конкурирующие UI-команды и потерю ответа после настоящего commit, без fake success. Нет test retries, skips или `continue-on-error`; один worker.

## Job `performance`

На отдельной PostgreSQL service `pnpm test:performance` создаёт 10 000 карточек через API и измеряет release/assignment/detail/pagination/audit. JSON содержит объём, среду, дату, raw samples и распределения. Завершение/корректность обязательны; выдуманного business-SLA или threshold для шумного shared runner нет. Интерпретация и локальные результаты — [[quality-gates]].

## Job `release_iac`

`Release and IaC contract` — седьмая обязательная job основного CI и новый preflight gate для ручного release. Она устанавливает actionlint `1.7.12` и Terraform `1.16.1` из фиксированных release URL с проверкой точных SHA-256, а все GitHub Actions остаются закреплены по commit SHA.

Job запускает actionlint для `ci.yml`, `release.yml` и `deploy.yml`, весь `pnpm test:release`, компиляцию JSON Schema и негативные manifest/Trivy/append-only/deployment/smoke tests. Затем выполняются `terraform init -backend=false -lockfile=readonly`, recursive `fmt -check`, `validate` и review-only `plan -refresh=false` с синтетическими secret markers. Plan и tfvars находятся только в `$RUNNER_TEMP`; JSON checker требует точные deployer/actAs/job/secret IAM matrices, единственный production `allUsers`, custom role из двух permissions, отдельные publisher/deployment WIF providers, точные deployer/smoke impersonation targets, reset identity/secret, demo limits и deletion guards при `teardown_mode=false`. Одновременно запрещены широкие admin/token-creator roles, materialized secrets, credential URLs и service-account keys. Job не имеет `id-token: write`, не аутентифицируется в GCP и ничего не применяет.

Конфигурация этой job проверена локально, но для текущих незакоммиченных изменений удалённого CI run ещё нет. Поэтому она является обязательным будущим gate, а не hosted evidence.

## Ручной workflow `release.yml`

Release-image workflow имеет только `workflow_dispatch`, принимает кандидатом `github.sha` выбранной `main` и не содержит push/schedule trigger. Preflight с `actions: read` требует clean checkout и один полный успешный push-run `ci.yml` того же SHA с семью ожидаемыми jobs, включая `Release and IaC contract`. Publish job отдельно получает лишь `contents: read` и `id-token: write`; service-account key или GitHub secret с cloud credential не используется.

После локальной единственной `linux/amd64` сборки workflow получает short-lived credential через Workload Identity Federation. Terraform trust дополнительно ограничен неизменяемыми GitHub repository/owner IDs, `refs/heads/main`, событием `workflow_dispatch` и точным `workflow_ref`. Перед push существующий full-SHA tag приводит к отказу; публикуются только `work-card:<40-char SHA>`, OCI revision label и `APP_VERSION` равны этому SHA.

Deployment/reset orchestration использует другой WIF pool/provider и service account `work-card-deployer`, ограниченный точным `deploy.yml`; publisher credential для этого непригоден. Тот же узко привязанный provider разрешает hosted job impersonate отдельный `work-card-smoke`, который имеет только invocation на private staging service и не получает deploy/log/DB roles. Причина и привилегированная `iam.serviceAccountUser` граница deployer описаны в [[deployment]].

Digest сначала читается из Artifact Registry по tag. Затем образ pull-ится по `image@sha256:…`; его config ID сравнивается с единственным локальным build, а label, environment version и `linux/amd64` перепроверяются. Trivy сканирует tar, сохранённый именно из этого pulled digest, с блокировкой HIGH/CRITICAL. После сканирования WIF credential обновляется, tag и exact reference повторно разрешаются через registry; только при равенстве digest генератор создаёт `docs/release/manifests/<SHA>.json` и вместе с scan JSON загружает его как 30-дневный workflow artifact.

Manifest соответствует [JSON Schema](../release/release-manifest.schema.json) и до записи проходит межполевую и семантическую проверку Trivy report. Он содержит только неизменяемые build/scan факты: source/CI/build-scan URLs, tag, registry/config digests, exact reference, OCI label, platform, scan checksum/summary и checksum SQL migrations. Deployment placeholders отсутствуют. Реальные staging/production/smoke/promotion/rollback события позже добавляются отдельными hash-chained append-only records по [release evidence schema](../release/release-evidence.schema.json); build workflow не создаёт ни каталога evidence, ни пустых записей и не коммитит manifest. `release.yml` не запускает Terraform, Cloud Run jobs, deploy, promotion или rollback. Сам manual run и предварительное создание Artifact Registry/WIF требуют отдельного разрешения.

## Ручной workflow `deploy.yml` — реализован, не исполнялся

Единственный trigger — `workflow_dispatch` из `refs/heads/main` с точной фразой `DEPLOY EXACT DIGEST TO STAGING`; job использует GitHub Environment `staging`. Preflight находит успешный `release.yml` run того же SHA, скачивает artifact именно этого run и заново проверяет manifest, Trivy binding и `buildScanRunUrl`. Workflow не собирает image, не принимает mutable tag и не выполняет Terraform.

Deployment job через `work-card-deployer` сверяет registry digest, а затем до каждого запуска проверяет metadata существующих `migrate`, `seed`, `verify`: единственный exact-digest container, отдельная service account, `taskCount=parallelism=1`, `maxRetries=0`, фиксированные command/args/env, numeric secret versions и Cloud SQL mount. Jobs исполняются без overrides в порядке `migrate → seed → verify` и затем повторно для idempotence/history. Кандидат создаётся без traffic; отдельный validator до переключения требует Ready revision, exact manifest image, `source-sha`/`APP_VERSION`, runtime-only numeric secret refs, canonical origin, app identity и staging Cloud SQL mount. Имя прежней 100%-revision фиксируется заранее; любая последующая ошибка включает отдельный rollback job.

Hosted job использует только `work-card-smoke`: родительский runner обновляет короткоживущий audience-bound Cloud Run ID token через GitHub WIF, проверяет issuer/audience/email/lifetime и передаёт browser только режимный temporary token file. Browser process не наследует GitHub/Google, deployer, DB или owner credentials; trace отключён, внешние origin блокируются, а IAM header вставляется только в one-hop requests точному staging origin. Runner проверяет IAM denial без token, sanitized health, SPA/assets MIME и headers, authentication/Origin/CSRF/role negatives без side effect, proxy spoof/rate-limit key и полный Playwright lifecycle `112 → 3 → 250`; browser запускается до rate-limit exhaustion, retries отсутствуют, safety timeout равен 25 минутам.

Отдельная post-smoke job возвращается к deployer только для `roles/logging.viewer`: по server-generated request IDs и Cloud Trace она связывает application completion с Cloud Run request log, сверяет status/client IP/severity и отвергает query/header/body/DB markers. Успешные job execution IDs, revision/digest, numeric versions и hashes smoke/observation reports записываются в два schema-validated append-only records и публикуются только как workflow artifacts. Ни token, ни DB URL, ни Playwright trace туда не входят.

Workflow требует уже provisioned staging jobs/service, действующие outputs/repository variables и предыдущую 100%-revision для автоматического rollback. В текущем checkout выполнены только локальные static/unit/plan проверки: `terraform apply`, `release.yml`, `deploy.yml`, image publication и hosted запросы не запускались.

## Кэширование и артефакты

Кэшируется pnpm store по lockfile. `node_modules`, runtime tar, БД и connection credentials не публикуются. CI upload ограничен browser HTML/JSON/screenshots/failure trace, performance JSON и redacted secret/image reports; retention 7 дней. Staging orchestration при фактическом успешном запуске хранит 30 дней только manifest, numeric metadata, append-only evidence, smoke JSON, observation summary и trace-free HTML/screenshots. Failure trace обычного CI может содержать временные cookie/CSRF тестовой demo-session: соответствующая изолированная БД удаляется при завершении suite, все данные синтетические. Эти artifacts не предназначены для настоящих пользовательских сессий. Container build не использует host `node_modules` благодаря `.dockerignore`.

## Критерий принятия

Закрытие этапа 9 требует зелёных `quality`, `container` (включая image scan), `security`, обеих `browser` matrix entries и `performance` для одного implementation SHA. Локальные проверки и успешные runs прежнего SHA не подменяют этот gate. Commit/push требуют отдельного прямого разрешения. Workflow не меняет branch protection через API; здесь зафиксирован критерий приёмки проекта.

Workflow обнаруживается GitHub из корневой `.github/workflows/`, а shell steps выполняются в `WorkCard-Lifecycle/`. Implementation commit [`17d2b04d13b58c7dff677543ed4399751a8593a1`](https://github.com/AI-shoks/WorkCard-Lifecycle/commit/17d2b04d13b58c7dff677543ed4399751a8593a1) подтверждён полностью зелёными [push CI](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33581627867) и [PR CI](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33581630041): в обоих запусках jobs `Code and database quality` и `Clean container startup` завершены успешно. Это закрывает удалённый acceptance gate этапа 7. Неблокирующее предупреждение GitHub о переводе runtime используемых actions с Node.js 20 на 24 учтено как maintenance item в [[backlog]].

## Историческое закрытие этапа 8

SHA `b00ff294a7b7ce1e09379c088969d9a02bd033bf` подтверждён успешными [push CI](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33963228130) и [PR CI](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33963230414), включая `quality` и `container`. Оба SHA/conclusions повторно прочитаны при начале этапа 9.

Локальный clean-container этапа 8 также прошёл без кэша на новом томе, с миграциями/seed, healthy SPA/API/БД и HTTP 200. Docker установлен; отсутствие Docker и незакоммиченный frontend в прежней редакции были устаревшими отметками.

## Закрытие этапа 9

Этап 9 закрыт 2026-09-05: implementation SHA [`3ee65709966f5775928de87783fd2946d085e2bc`](https://github.com/AI-shoks/WorkCard-Lifecycle/commit/3ee65709966f5775928de87783fd2946d085e2bc) на момент проверки совпадал с локальным HEAD и head PR #1 в `codex/portfolio`. Через GitHub API подтверждены [push CI](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33970654850) и [PR CI](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33970656850): все 6 обязательных jobs имеют `completed/success` для того же SHA в каждом запуске, включая image scan в `container`. Полная матрица и локальные результаты — [[quality-gates]]. Этапы 1–9 закрыты; этап 10 в работе: release design, reviewable Terraform, manual release-image workflow и локальный код staging orchestration/runner приняты к review, но `apply`/workflow не запускались и ничего не развёрнуто.
