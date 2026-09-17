---
artifact_id: engineering.quality-gates
status: accepted
version: 20
owner: engineering
updated: 2026-09-17
---

# Quality Gates

Один локальный gate объединяет форматирование кода, статический анализ, строгую типизацию, тесты и production build:

```powershell
pnpm install --frozen-lockfile
pnpm check
```

## Состав `pnpm check`

| Gate | Команда | Что доказывает |
|---|---|---|
| Format | `pnpm format:check` | конфигурация и исходный код соответствуют Prettier |
| Lint | `pnpm lint` | ESLint проверяет JS/TS/React hooks и запрещает неявные globals |
| Types | `pnpm typecheck` | все workspace проходят strict TypeScript без emit |
| Unit/API | `pnpm test` | Vitest проверяет frontend API client, формы, permissions, session/role switch, selection, command/read-back и recovery states; API проверяет health/config/security. DB suite запускается отдельно с явным integration URL |
| Build | `pnpm build` | contracts, API и SPA собираются для production |

Каталог `docs/` исключён из Prettier: governed documentation имеет собственную metadata/link проверку через `project-docs-auditor` и обязательный semantic pass. Корневые README/Home и прочие Markdown вне исключённых каталогов продолжают участвовать в formatter gate.

## Первый публичный deployment — подготовка 2026-09-17

Пользователь разрешил scoped commit/push/PR/merge после обязательных checks, один Render Free image service, два отдельных Neon Free PG18 projects, необходимые secrets/environments, публикацию GHCR, owner operations и hosted qualification. Платные планы/overage, GCP apply/destroy и удаление чужих данных запрещены. Разрешение не является свидетельством выполненного deployment.

Фактический Git root — родительский каталог `WorkCard-Lifecycle`, remote — `AI-shoks/WorkCard-Lifecycle`; подготовка ведётся в `codex/render-neon-first-deployment`. Посторонние `Codex Workflow/`, соседние portfolio artifacts и ранее подготовленные Terraform HCL/scripts/backend templates сохраняются вне scoped commit.

- GitHub: доступ к публичному repository подтверждён; созданы `staging-owner`, `staging-runtime`, `production-owner`, `production` с deployment branch policy только для `main`. Секреты ещё не установлены.
- Render: `My Workspace` (`tea-d8q4f1cvikkc73al6vq0`), Hobby, `No card on file`, начисления/прогноз `$0`, использование `0.75/750` instance hours и `0/5 GB` bandwidth подтверждены в Billing. Квоты общие с существующими сторонними services; они не изменялись. WorkCard service ещё не создан.
- Docker Desktop восстановлен обратимым сохранением служебных socket directories и остановкой только `docker-desktop`; factory reset, удаление WSL disk/контейнеров/volumes не выполнялись. Engine `29.7.2`, `linux/amd64` отвечает; перед новым container gate сохранён inventory существующих ресурсов.
- Повторные локальные lint/typecheck и API `69` tests прошли. Frontend: `140` tests прошли, worker для `interactive-screens.test.tsx` дважды не стартовал в ограниченной оболочке; повтор с одним worker не устранил startup timeout. Assertions/timeouts не менялись, полный frontend gate не объявляется успешным. На host во время WSL startup оставалось менее `200 MiB` свободной RAM; полная проверка кандидата остаётся обязательной в CI.
- Release review: `85/85` release и `2/2` Render tests PASS на Node `24.20.0`; contract checker, actionlint `1.7.12` всех пяти workflows, focused ESLint/Prettier и diff check PASS. Исправлены environment origin для browser, containerd config digest, запрет registry credentials и безопасные cookie/error checks. Clean container build/startup, repeat bootstrap/verify, отдельная readiness и HTTP/assets прошли; runtime UID `65532:65532`, read-only root, `cap_drop=ALL`, `no-new-privileges` и отсутствие owner credentials подтверждены. Trivy `0.74.0` с новой CVE DB: `14` OS и `100` Node packages, `0 HIGH/CRITICAL`. Проверен actual config digest `sha256:28c30dc584a44f20c6993b8b354679ca80fc770677f72eda9125eb26ec49158e`; это локальный QA image, не опубликованный release. Полный formatter exact scoped index PASS; hosted qualification ожидает prerequisites. Публичные URL/digest/release record ещё отсутствуют; rollback не проверен.

## Render Free / Neon Free — предшествующий локальный переход 2026-09-17

Текущий target задан [[0009-render-free-neon-free-release|ADR-0009]]. Изменены runtime/owner TCP/TLS contract, SQL roles, постоянный maintenance/generation barrier, health/Docker contract и GHCR/Render workflows. GCP Terraform/foundation/backend files сохранены неактивными; GCP-only часть deployment gate заменена новым contract. Остальные code, DB, security, browser compact/canonical, container scan и performance gates остаются обязательными.

В предшествующем локальном проходе были разрешены только изменения файлов и безопасные локальные проверки. Подключения к hosted БД, resource/account/billing/secret changes, публикация image, remote workflow/deployment и commit/push тогда не выполнялись. Этот исторический scope не отменяет последующее разрешение на первый deployment, описанное выше. Заявление «GCP deployment ещё не выполнялся» основано на репозитории; GCP аккаунты в текущей задаче не проверяются.

Список обязательной локальной проверки: bootstrap/repeat с non-superuser owner, privileged role rejection, runtime grants, immutable migration checksums; TLS expected-target/downgrade/override negatives; reads/session/command maintenance races, auth-reset race, cancellation, 26h fail-closed; versioned manifest/scan/evidence, deployment contract и workflow actionlint. Реальные hosted TLS/roles, Render proxy chain/client IP, deployment resolved digest, cold start, reset/recovery и account/$0 settings остаются будущей qualification по [[deployment]].

Проверки выполнены на заданных репозиторием Node `24.20.0`, pnpm `11.19.0` и отдельной disposable PostgreSQL `18.6` на loopback; установленная пользовательская БД не использовалась. Полный quality suite — `31/31 PASS`, включая `26` PostgreSQL tests и `5` local target guards. Результаты текущего рабочего дерева:

| Проверка | Локальный результат и граница |
|---|---|
| API unit/config/runtime/health | `69 PASS`; `6` DB integration cases пропущены только в обычном unit run и проверены отдельно с явными local URLs |
| Frontend | `158 PASS` |
| PostgreSQL integration | `6 PASS` с non-superuser owner; owner/runtime credentials раздельны |
| PostgreSQL quality | `26 PASS`: bootstrap/repeat, privilege/migration boundaries (включая column ACL/PUBLIC/grant options), maintenance/read/session/command/auth-reset races, cancellation, fail-closed и DB budgets |
| Local DB helper guards | `5 PASS`: remote targets и URL overrides отвергаются до connection; guard не ослаблен для Neon |
| Browser compact | `4 PASS`, desktop/mobile lifecycle и recovery; первый одновременный с тяжёлыми проверками запуск имел desktop timeouts, последовательный повтор прошёл без ослабления assertions/timeouts |
| Browser canonical | `2 PASS` в отдельном повторе на Node `24.20.0` / PostgreSQL `18.6`: полный процесс `250` cards, `762` UI commands и recovery, около `10.5` минут. Assertions/deadlines/retries не менялись. Первый запуск имел timeout ожидания clickable button при успешных API responses; его trace сохранён отдельно |
| Performance | PASS: `40` batches, `120` sets, `10 000` cards, `12 800` audit events, `40` samples; это воспроизводимый профиль, не business SLA |
| Dependencies | `pnpm audit --audit-level=high`: известных уязвимостей не найдено |
| Secrets | Gitleaks `8.30.1`: финальный снимок текущего source `2.51 MB` — `0` находок; история `44` commits также дала `0` и после проверки не менялась. Последующая документационная правка фиксирует только результаты, без новых конфигураций/secret values |
| Static code / build | API/quality typecheck, полный ESLint и итоговый полный production build PASS |
| Release / Render contract | `80 PASS` offline tests; actionlint `1.7.12` всех пяти workflows PASS. Это fixtures/validators, не provider execution |
| Compose model | `docker compose config --quiet` PASS; readiness вынесена в профиль `checks` и отдельный `run` после `up --wait`. Проверена модель, не запуск Linux image |

Текущие container build/startup и Trivy image scan **недоступны**: установленный Docker Desktop не смог поднять engine из-за ошибки переименования stale `sailor-ingest.sock`/доступа к файлу. Factory reset, удаление Docker state и изменение чужих ресурсов не выполнялись. Реальная PostgreSQL на host не заменяет обязательный container gate; сохранённые ниже старые image scans не относятся к текущему diff.

Полный formatter gate не зелёный из-за трёх существовавших до задачи untracked документов в `Codex Workflow/`: `00 Codex Workflow.md`, `IMPLEMENTATION-BOARD.md`, `templates/TASK-CAPTURE.md`. Посторонние файлы не изменяются и не исключаются из gate ради результата. Поэтому `pnpm check` не объявляется полностью успешным даже при отдельных успешных lint/typecheck/tests/build.

Структурный audit после обновления связанных документов: **59 документов, 0 errors, 0 warnings**, `--fail-on-warning`. Semantic pass устранил противоречия между текущими deployment/environments/security/CI/project docs и прежним GCP выбором: ADR-0007/0008 имеют reciprocal supersession к ADR-0009; GCP runbook, результаты и IaC остаются историческими. Отсутствие structural findings само по себе не доказывает поведение приложения.

Все разделы ниже — сохранённые результаты **предыдущих дат и SHA**, включая прежние ограничения локального shell и GCP account observations. Они не являются повторными тестами текущего Render/Neon diff или текущей проверкой внешних аккаунтов.

## Docker, security gates и Google Cloud CLI — 2026-09-09

Проверено текущее рабочее дерево без commit/push. Исходные 21 изменённый tracked file, шесть untracked IaC files и соседние untracked artifacts сохранены. Применены пользовательские корневые инструкции и `WorkCard-Lifecycle/AGENTS.md`; других вложенных `AGENTS.md` не найдено. Дата раздела — локальная `Europe/Moscow`; логи контейнеров используют UTC.

Docker Desktop `4.89.0` уже был установлен в `%LOCALAPPDATA%/Programs/DockerDesktop`, а его CLI уже входил в пользовательский PATH. Ограниченная оболочка не видела этот каталог; повторная проверка от имени пользователя нашла установку, Compose `5.5.0`, Buildx `0.36.1-desktop.1`, WSL `2.7.13.0` и существующий остановленный `docker-desktop`. Переустановка Docker, изменение WSL/Windows features и reboot не потребовались.

Запуск выявил недоступные старые AF_UNIX sockets `Docker/run/sailor-ingest.sock`, затем `docker-secrets-engine/engine.sock`. Остановлены только процессы собственных неудавшихся запусков; служебные каталоги обратимо переименованы. Во втором каталоге предварительно подтверждён единственный нулевой `engine.sock`. Резервные копии сохранены в `%LOCALAPPDATA%`: `Docker/run.local-tools-backup-20260909`, `Docker/run.local-tools-backup-20260909-attempt2`, `docker-secrets-engine.local-tools-backup-20260909`. WSL-диск и прежние данные не сбрасывались. Похожий последовательный сбой описан в [трекере Docker](https://github.com/docker/desktop-feedback/issues/460); фактическая диагностика этого прохода основана на локальных логах.

| Проверка | Результат |
|---|---|
| Docker daemon / isolation | PASS: Engine `29.7.2`, `linux/amd64`; отдельный Compose project `wcl-local-tools-20260909`, image `wcl-local-tools-20260909-app:local`, новый том `wcl-local-tools-20260909-postgres`, loopback HTTP `35549` / PostgreSQL `55489`. Использован существующий `quality/compose.override.yaml`; исходный `.env` не загружался |
| Compose config | PASS: основной файл и изолированная merged model; проверены уникальные image/volume names и свободные порты |
| Clean container | PASS: `compose build --no-cache app` с локальным `APP_VERSION=0.1.0-local-tools`, затем `up --no-build --wait --wait-timeout 180`; app/DB healthy, initial migrate/seed exit `0` |
| Повторный bootstrap / runtime | PASS: repeat migrate/history `0001`–`0003`, repeat seed и `node dist/verify-database.js`; UID `65532:65532`, read-only root, `cap_drop=ALL`, `no-new-privileges:true` |
| HTTP / assets | PASS: `/`, `/health/live`, `/health/ready`, JS и CSS — `200`, правильные MIME; оба health payload ровно `{"status":"ok"}` |
| Gitleaks | PASS: существующий `pnpm security:secrets`, pinned `v8.30.1`, `--all` history (`44` commits) и current-source snapshot; оба JSON содержат `0` findings. Сеть scanner-контейнеров отключена, mounts исходников read-only, redaction `100%`; прежние узкие history ignores не расширялись |
| Trivy exact image | PASS: pinned `0.74.0`, свежая загруженная CVE DB, `--scanners vuln --parallel 1 --severity HIGH,CRITICAL --exit-code 1`, без `--ignore-unfixed`; Debian `13.6`, `14` OS и `100` Node packages, findings `0` |
| Google Cloud CLI | PASS: официальная подписанная установка только для текущего пользователя, SDK `583.0.0`, bundled Python `3.14.7`, user PATH, сохранённое `disable_usage_reporting=True`; обычный PowerShell launcher и настоящий `gcloud.cmd` через preflight wrapper работают |
| Foundation preparation | PASS только локальной части: `9/9` preflight fixtures и повторно прочитанные GitHub IDs `1303711056` / `294865028`. Сохранённых/активных Google accounts `0`, ADC file отсутствует; настоящий GCP preflight не запускался |

Docker containerd store возвращает локальный image ID `sha256:a6ffe1f46f255ceaf774e6d471c2d2c86f6f018888d37d6ad3835c0e996f1bc3`. Он совпал у построенного image и запущенного app. Отдельно из `docker save` проверены tag, bytes/config SHA-256 `sha256:1a0907963c8d2c02e8ac6ed540a0a30e7e2100636f2ecaa050d2d43d67637655`, `linux/amd64`, UID и OCI revision; `Trivy.Metadata.ImageID` совпал именно с config digest. Это локальный QA image, без registry publication и release manifest. Дополнительный локальный валидатор отчёта первоначально ожидал тип `npm`; он исправлен на наблюдаемый `lang-pkgs/node-pkg`, тот же успешный отчёт проверен повторно без повторной сборки или сканирования.

После проверки удалены только собственные тестовые контейнеры, сеть и том. Исходные четыре остановленных контейнера и два тома сохранились; их inventory сравнен до/после. Сверка SHA-256 исходных `240` файлов нашла изменения только в трёх документах этого прохода, остальные `237` файлов сохранены, staged diff пуст. Прежние ignored Gitleaks reports также сохранены.

Несекретные команды и результаты сохранены в ignored `.quality-results/local-tools-2026-09-09/`: `container-gates.ps1`, `toolchain-summary.json`, `docker-before.json`/`docker-after.json`, build/start/verify/scan/cleanup logs, `runtime-verification.json`, `runtime-image.tar`, `image-vulnerabilities.json`, `scan-summary.json`, Gitleaks reports, `gcloud-verification.json` и `preservation.json`. Code/browser/performance/offline Terraform gates от 2026-09-08 остаются отдельными историческими результатами; они не объявляются повторно выполненными сегодня.

Установка разрешена пользователем в этом проходе. Google OAuth/ADC login, Billing Overview, реальные billing/IAM/API/backend проверки, remote Terraform initialization, cloud writes, image publication, GitHub settings и commit/push не выполнялись. Текущий Free Trial status неизвестен. Исторический следующий read-only foundation preflight был подготовлен в [Terraform README](../../infra/terraform/README.md): нужны выбранный principal/ADC, реальные billing account, organization/folder, три project IDs и существующий защищённый state bucket. Этап 10 остаётся `4/7` до hosted qualification.

## Локальная готовность при Pending Free Trial — 2026-09-08

Проверяется текущее незакоммиченное рабочее дерево ветки `codex/stage-10-task-5-foundation-plan`. При старте уже были 18 изменённых tracked files в границах задачи (включая корневой `ci.yml`) и четыре untracked foundation/backend/preflight files внутри WorkCard-Lifecycle; staged diff был пуст. Существующие изменения сохранены, соседний `WorkCard-Project-Dashboard-Site` и social preview не изменялись. Этот проход добавляет локальные исправления safety/preflight и [[deployment|чек-лист развёртывания, бюджетов и семи суток]], но не повышает этап 10 выше 4/7.

Системный Node в PATH — `24.18.0`, ниже package engines. Использован уже существующий bundled Node `24.19.0` (разрешён `>=24.19.0 <25`) и pnpm `11.19.0`; глобальный PATH, `.node-version` (`24.20.0` для CI), lockfile и зависимости не менялись. Terraform `1.16.1`, cached provider `7.45.0`, actionlint `1.7.12`, PostgreSQL `18.6` и Chromium найдены локально. Установок и скачивания toolchain не было.

| Проверка | Текущий результат |
|---|---|
| `pnpm check` | PASS: format, ESLint, strict types, `158` frontend + `24` обычных API tests, `58` release tests, production build. Шесть DB integration tests в этом gate закономерно skipped без integration URL; они отдельно выполнены ниже |
| `pnpm security:dependencies` | PASS: `No known vulnerabilities found`, все dependency scopes; это не скан runtime image |
| Database bootstrap | PASS на отдельном PostgreSQL `18.6`: initial и repeat migrate/history checks, seed дважды, runtime verification/grants; существующая application DB не использовалась |
| API integration / `pnpm test:quality` | PASS: `6/6` integration и `11/11` PostgreSQL regression tests, включая transactions/migrations/security/budgets |
| `pnpm test:browser` | PASS: `4/4` compact lifecycle/recovery на desktop и mobile, около 1,2 минуты |
| `pnpm test:browser:canonical` | PASS: `2/2`, полный процесс 250 карточек с финальной приёмкой/audit/payroll и recovery, около 8,6 минуты; исходный timeout сохранён |
| `pnpm test:performance` | PASS: 40 партий, 120 комплектов, 10 000 карточек, 12 800 событий; 40 samples основных операций. Локальный p95: release 250 — 99,13 мс, detail на 10 000 карточках — 23,18 мс; это не hosted SLA |
| Workflow syntax | PASS: существующий actionlint `1.7.12` для корневых `ci.yml`, `release.yml`, `deploy.yml`; удалённый CI не запускался |
| Offline Terraform | PASS: isolated `init -backend=false -input=false -lockfile=readonly`, recursive `fmt -check`, `validate`; с одним contact full `167 create / 0 change / 0 destroy`, foundation `136 / 0 / 0`. Дополнительные реальные offline plans с двумя contacts: full `170 / 0 / 0`, foundation `139 / 0 / 0`, strict assertions PASS |
| Negative Terraform inputs | PASS: все восемь недопустимых случаев завершились exit 1 — нет parent, общие secrets двух окружений, jobs без SHA/image, service без origin, более 7 суток без extension, более 30 суток с extension, production без обязательного PITR, staging без smoke identity |
| Plan safety regression | PASS: `test-plan-safety.mjs` на реальном JSON каждого плана — `27/27` full и `27/27` foundation; positive baseline и negatives проверяют WIF, чужую workload identity, checks, budgets, secrets, teardown/actions, phase substitution и согласованность дополнительных alert contacts |
| Read-only preflight fixtures | PASS: `9/9` тестов без SDK/GCP, включая raw GCS metadata, отказ при плохих inputs/CLI errors и реальное выполнение temporary `gcloud.cmd` с точными аргументами в Windows |
| Final focused code check | PASS: явный Prettier для новых/изменённых IaC scripts, focused ESLint и общий финальный Node run release/preflight — `67/67`, `0` skipped; CI diff просмотрен |
| Documentation audit | Strict PASS после исправлений: `57` документов, `0` errors / `0` warnings; semantic review исправил origin-by-phase, состав teardown по state, approval после подготовки plan и reset только для запущенного production |

Первый конкурентный `pnpm check` получил два timeout по 5 секунд при создании Fastify app. Sequential диагностика API/web прошла с исходными assertions/timeouts, затем обычный неизменённый `pnpm check` без тяжёлых соседних процессов завершился exit 0. Приложение, таймауты и gate ради результата не менялись; оба лога сохранены. `pg_ctl start` в sandbox не смог создать restricted token Windows (error 87); прямой запуск `postgres.exe` на новом scratch cluster позволил пройти DB suite без изменения прав/служб. Собственный cluster остановлен, его data dir удалён после проверки пути.

PostgreSQL quality suite выполнялась последовательно с `--maxWorkers=1 --no-file-parallelism`; проверки и данные не упрощались. Browser/performance использовали отдельный новый cluster и существующий Chromium. После завершения собственных data directories и password files осталось 0; прежние три browser/performance JSON восстановлены, SHA-256 совпали с исходными. Финальные tracked application/quality source diffs пусты. При отдельном focused check локальный `pnpm exec prettier` не разрешил shim; прямой запуск уже установленного CLI через Node выполнил проверку успешно, установка не потребовалась.

Terraform review выполнялся в новой ignored копии только конфигурации/example inputs, без исходных backend/state/реальных tfvars и credentials, с filesystem-mirror-only provider installation, отключённым checkpoint, loopback proxy и искусственными ephemeral review markers. Рецепт — [Terraform README](../../infra/terraform/README.md#review-commands). Он подтверждает структуру и запреты, но не GCP APIs, IAM/quota, существование projects или backend write/lock capability. Computed service URI и actAs target `.name` сверяются дополнительно по фактическим outputs/hosted metadata; неизвестные apply-time значения не объявляются наблюдёнными.

Независимый IaC review воспроизвёл ложный PASS старого checker для missing parent, повторно использованных staging/production secrets и WIF condition с `|| true`. Root/module safety checks переведены в блокирующие input validations; JSON guard отклоняет failed/missing/unexpected-unknown checks, требует точное AND-only WIF condition и workload member. Budget credit treatment теперь явно `EXCLUDE_ALL_CREDITS`, чтобы promotional/free-tier credits не скрывали usage от alerts. Regression tests включены в `release_iac`. Изменения не создают spending cap или автоматический teardown.

Локальные несекретные логи находятся в ignored `.quality-results/local-readiness-2026-09-08/` (`code-summary.json`, code/dependencies, `db-native/`, `runtime/evidence/`, `final-release-preflight.log`, `prior-evidence-restored.json`) и `.quality-results/iac-review-20260908/` (offline plans/negative controls). Это воспроизводимые local QA результаты, не release manifest/evidence и не hosted qualification.

### Зафиксированные ограничения на 2026-09-08

Таблица сохраняет состояние прежней ограниченной оболочки. Docker впоследствии найден и восстановлен, Google Cloud CLI установлен; актуальные результаты — в разделе 2026-09-09 выше. Облачные prerequisites по-прежнему требуют отдельного подтверждения.

| Блокер | Что пока не подтверждено | Минимальный следующий способ |
|---|---|---|
| Docker отсутствует | Compose model, clean container startup, Gitleaks history/current-source и Trivy exact image scan текущего дерева | Отдельно разрешить установку/запуск Docker и выполнить существующие gates; либо после отдельного commit/push approval получить все соответствующие CI jobs именно нового SHA. Исторические JSON не заменяют свежий gate |
| Google Cloud CLI отсутствует; ADC не настроены | Настоящий read-only foundation preflight | Отдельно разрешить Google Cloud CLI, настроить short-lived account/ADC и выполнить `check-foundation-prerequisites.mjs` с реальными несекретными inputs; fixtures не являются GCP PASS |
| Free Trial Pending, реальные inputs/approvals отсутствуют | Billing eligibility/currency, organization/folder, project IDs, contacts, approved cost/lifetime, IAM/quotas и защищённый существующий GCS backend | После активации подтвердить Billing Overview, заполнить и рассмотреть inputs по [[deployment]]; отсутствие organization/folder или state bucket требует отдельного решения, а не выдуманного ID |
| Нет provisioned WIF/registry/workloads и exact release image | GitHub settings, publication, hosted staging, production promotion/rollback, proxy/log/socket/reset observations | Последовательно выполнить отдельно разрешённые foundation, release-image, staging и production фазы по [[deployment-gcp-history]] с фактическими digest/revision/job evidence |

Python не в PATH, но strict docs audit работает через существующий `C:/Users/artem/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe`. Для локального `pnpm check` достаточно в отдельной PowerShell-сессии временно добавить `C:/Users/artem/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin` в начало PATH; системную версию менять не требуется. Terraform доступен по `C:/Users/artem/AppData/Local/Temp/workcard-terraform-1.16.1/terraform.exe`; наличие temporary binary следует перепроверять перед новым проходом.

Google Cloud и GitHub settings не изменялись; `terraform apply/destroy`, remote backend initialization, release/deploy workflows, публикация image и commit/push не выполнялись. Следующий шаг после Pending — read-only подтверждение Free trial account, currency, credits и даты окончания в Billing Overview; это не разрешение на provisioning.

## Foundation-plan этапа 10 — 2026-09-06

Ветка `codex/stage-10-task-5-foundation-plan` создана от перечитанного `origin/main` merge-коммита `551f5b8dc966abda4e93219b4887f297aad61354`. Проверка намеренно остановлена до cloud mutation:

| Проверка | Результат |
|---|---|
| Terraform toolchain | PASS: официальный Terraform `1.16.1` запущен из временного каталога; SHA256 архива совпал с опубликованным HashiCorp `5c6c6d8fedf56ce29c55f0c1fc91de3c259f42c2d220a28e827b5b60fd47bfa1`; provider lock остаётся `google 7.45.0` |
| Format/validation | PASS: `terraform fmt -check -recursive`, `terraform validate`, Node syntax обоих safety/preflight scripts |
| Foundation graph | PASS: offline `-refresh=false` plan ровно `136 create / 0 change / 0 destroy`, оба окружения `jobs=false`/`service=false`; exact type/action, IAM/WIF, deletion, no-workload и no-secret assertions приняты |
| Full regression graph | PASS: прежний full contract остаётся `167 create / 0 change / 0 destroy` |
| Negative controls | PASS: plan fail-closed отклоняет jobs/service без SHA/digest/origin и lifetime 8 суток без extension approval; safety checker отклоняет foundation-граф в full-режиме |
| Repository checks | PASS: release contracts `58/58`, Prettier, focused ESLint и high-confidence pattern scan `0` findings в `20` изменённых files. Контейнерный Gitleaks не стартовал без Docker и остаётся обязательным удалённым gate, а не локальным PASS |
| Read-only prerequisites | PASS только для публичных GitHub IDs: repository `1303711056`, owner `294865028`. `gcloud`, ADC и Google credential env отсутствуют; реальные hierarchy/billing/project/backend inputs не предоставлены, поэтому GCP/IAM/quota/backend checks — BLOCKED |
| GitHub settings boundary | Read-only API вернул `0` environments; состояние repository variables недоступно текущей авторизации. Environment/variables/settings не создавались и не изменялись |
| Governed docs | PASS: `project-docs-auditor` проверил `57` документов, `0` errors / `0` warnings; semantic pass сохраняет этап 10 на `4/7` и отделяет structural plan от apply-ready/hosted evidence |

Plan использовал только example placeholders, ephemeral review markers и локальный provider graph; временные plan и process inputs удалены. `terraform apply`, remote backend initialization/refresh, `release.yml`, `deploy.yml`, GitHub settings mutations и любые cloud writes не выполнялись. Этот результат проверяет форму первого foundation-plan, но не является apply-ready plan.

## Интеграционный gate — историческая последовательность

Ниже сохранены команды прежнего Compose contract до ADR-0009. Они **не предназначены для исполнения в текущем checkout**: services `migrate`/`seed` заменены owner `bootstrap`, а verification требует owner boundary. Актуальная последовательность, включая отдельный `run readiness` после `up --wait`, находится в [[local-development#Чистый запуск|Local development]]. Исторический список:

```powershell
docker compose config --quiet
docker compose up --build --wait --wait-timeout 180
docker compose run --rm --no-deps migrate
docker compose run --rm --no-deps seed
docker compose run --rm --no-deps app node dist/verify-database.js
pnpm --filter @work-card/api test:integration
pnpm audit --prod --audit-level=high
git diff --check
```

Отдельно `project-docs-auditor` запускается от корня проекта в strict mode `--fail-on-warning`. Дополнительно проверяются `/`, `/health/live`, `/health/ready`, desktop/mobile layout и browser console.

## Исторический результат этапа 7

На 2 сентября 2026 года:

- format, lint, typecheck и build — успешно;
- 11 обычных автоматических тестов — успешно, включая полную trusted-role command matrix и browser security headers;
- 5 PostgreSQL integration tests — успешно: ранний порядок session/role/Origin-CSRF, `3/250/254`, compact API-only lifecycle, concurrent assignment/final/payroll, replay и immutable grants;
- migrations `0001`–`0003`, seed и runtime permission verification на чистой БД — успешно;
- production build — успешно;
- clean-container текущего checkout локально — успешно;
- implementation commit [`17d2b04d13b58c7dff677543ed4399751a8593a1`](https://github.com/AI-shoks/WorkCard-Lifecycle/commit/17d2b04d13b58c7dff677543ed4399751a8593a1) опубликован и проверен;
- [push CI](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33581627867) и [PR CI](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33581630041) для implementation SHA полностью зелёные: `Code and database quality` и `Clean container startup` завершены успешно;
- strict documentation audit при закрытии этапа 7 — 55 документов, 0 ошибок, 0 предупреждений.

## Исторический результат этапа 8 — 5 сентября 2026 года

Результаты ниже относятся к implementation SHA этапа 8 `b00ff294a7b7ce1e09379c088969d9a02bd033bf` и не переносятся на изменения этапа 9.

| Проверка | Результат |
|---|---|
| `pnpm install --frozen-lockfile` | PASS, зависимости установлены без изменения lockfile |
| `pnpm check` после исправлений кода | PASS: format, lint, typecheck, tests и production build |
| Frontend focused suite | PASS: `157` тестов в `20` файлах, включая `17` интерактивных jsdom-тестов |
| Обычные API tests | PASS: `9` тестов; DB suite не подменяется unit-прогоном |
| Реальная PostgreSQL integration suite | PASS: `5/5` на отдельной чистой PostgreSQL `18.6` |
| Database bootstrap | PASS: `0001`–`0003`, повторный migrate/checksums, seed дважды, runtime verification |
| `pnpm audit --prod --audit-level=high` | PASS: известных уязвимостей не найдено на момент проверки |
| Документационный prototype UX audit | PASS на desktop `1440×1000` и mobile `390×844` |
| Реальный browser core sequence | PASS: production SPA, новый чистый PostgreSQL `18.6`, все `250` lifecycle, отдельная финальная приёмка, audit и payroll/read-back |
| Runtime desktop/mobile UI audit | PASS: `16` проверок экранов `S-01`–`S-07` и безопасного отказа защищённого audit route на desktop `1440×1000` и mobile `390×844` |

После заключительной установки с `--frozen-lockfile` frontend suite повторно прошёл все `157` тестов. Браузерный проход использовал итоговую production-сборку с перезапущенным API, а не прежний процесс раздачи assets.

Frontend coverage включает типизированные ответы и обязательный read-back, ранние route/action guards, очистку защищённого состояния при смене роли, формы и их ошибки, массовый выбор одного комплекта, подтверждения команд и восстановление всех целей без автоматического повтора mutation. Интерактивные jsdom-тесты проверяют события и DOM-состояния компонентов; они не являются браузерным сценарием через PostgreSQL.

В ходе проверки исправлены и защищены regression tests: неизменность версии комплекта при serial assignment согласно [[transactions-concurrency]], readiness финальной приёмки по полному плану произвольного подготовленного паспорта, отдельные диалоги assignment/payroll, сохранение ввода при `422`, подтверждение смены роли при незавершённой форме и вложенная закрытая граница технических кодов. Бизнес-инварианты и backend permission boundary сохранены.

### Документационный прототип

`window.runUxCopyAudit()` выполнен в обоих viewport: все `14` шагов, `70` сочетаний шага и роли, `7` системных состояний. Зафиксировано `0` нарушений UX-copy, `0` переполнений viewport и `0` browser errors. Проверены русские подписи, accessibility-текст и отсутствие технических кодов вне вложенного developer context. Это результат проверки `docs/ux/prototype.html`, а не доказательство выполнения производственных команд живой SPA.

### Реальный браузерный сценарий

На отдельной чистой PostgreSQL `18.6` через живую SPA и реальный API созданы партия `112` и три комплекта общим объёмом `250` карточек. Первые детали всех трёх комплектов проведены мастером и положительно приняты БТК. Назначения подтверждены в обоих комплектах по `112` как `1 + 59 + 52`, а в комплекте из `26` — как `1 + 25`.

Для всех `247` карточек обработки партии мастер через кнопки приложения зафиксировал начало и завершение, затем БТК положительно подтвердил качество каждой карточки. Вместе с тремя первыми деталями это дало полный `250/250 CLOSED` итог. Domain mocks, API shortcuts и SQL-обновления производственных состояний не использовались.

После этого БТК отдельно подтвердил финальную приёмку партии. Actor, время и acceptance ID совпали с обязательным read-back; закрытие карточек само по себе эту запись не создавало. В браузерном журнале полный контекст выпуска подтвердил `254` события: expected total, server total и все уникальные клиентские события совпали.

Дополнительные браузерные проверки подтвердили полный контекст назначения `59/59` и приёмки первой детали `2/2`. Оба подготовленных исполнителя открыли свои карточки без кнопок мастера и БТК. Повторный выпуск на desktop/mobile заблокирован с доступной через `aria-describedby` причиной «Партия уже выпущена; повторный выпуск недоступен».

Тестовый учёт нормо-часов отправил один export `POST`, а контрольное чтение и повторное открытие дали два успешных `GET` одной неизменяемой записи. Перезагрузка не отправила новый export. Исполнитель и operation-scoped норма сохранились.

Независимая SQL-проверка под runtime-ролью в транзакции `READ ONLY` подтвердила `FINAL_ACCEPTED`, `250/250 CLOSED` (`3` первые детали и `247` серийных), три открытых допуска и состав комплектов `112/112/26`. В БД ровно одна финальная приёмка, одна payroll-запись с совпадающим исполнителем и снимком нормы, а release correlation содержит `254` уникальных события (`250 + 3 + 1`). Дубликатов финальной приёмки и payroll нет; immutable triggers и запрет runtime `UPDATE/DELETE` проверены.

Отдельно в живом браузере проверена смена роли при незавершённой форме: отмена сохранила введённое количество `113` и не отправила `POST` смены сессии; подтверждение очистило прежнюю форму и загрузило новые permissions. В console/network наблюдались только ожидаемые ответы `401` до входа и `404` для ещё отсутствовавшей payroll-записи; неперехваченных и неожиданных browser errors не было.

Заключительный runtime UI audit прошёл `16` проверок: `S-01`–`S-07` и безопасный отказ защищённого audit route в двух viewport — desktop `1440×1000` и mobile `390×844`. Зафиксировано `0` недокументированных утечек латиницы/UUID, `0` сломанных ссылок `aria-labelledby`/`aria-describedby`, `0` неправильно расположенных или открытых по умолчанию technical exception blocks и `0` горизонтальных переполнений; `lang="ru"` сохранён. Допустимые business-коды паспорта/операций проверялись по [[ux-copy-guidelines]], без общего разрешения произвольной латиницы. Итоговые мобильные экраны партии и payroll также визуально просмотрены по снимкам.

Локальные проверки frontend, реального браузерного процесса и UI завершены. Strict documentation audit после обновления результатов: `55` документов, `0` ошибок, `0` предупреждений; semantic review отдельно сопоставил реализацию с ролями, состояниями, cardinality, recovery и AS-IS/TO-BE границами.

### Закрытие этапа 8

Для SHA `b00ff294a7b7ce1e09379c088969d9a02bd033bf` прошли [push CI](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33963228130) и [PR CI](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33963230414): `quality` и `container` успешны в обоих runs. Локальный clean-container выполнен без кэша на новом томе: миграции/seed, healthy приложение/БД, HTTP 200 для SPA и обоих health endpoints. Статусы runs и SHA повторно прочитаны через GitHub API при начале этапа 9. Старые отметки об отсутствии Docker и невыполненных commit/push устарели.

## Результаты этапа 9 — 5 сентября 2026 года

Локальные результаты ниже получены для реализации, зафиксированной implementation SHA [`3ee65709966f5775928de87783fd2946d085e2bc`](https://github.com/AI-shoks/WorkCard-Lifecycle/commit/3ee65709966f5775928de87783fd2946d085e2bc), поверх этапа 8 `b00ff294…`. Состав воспроизводимых команд и точные границы fixture — [[test-strategy]]. При синхронизации статусов тяжёлые проверки повторно не запускались; удалённые результаты этого SHA подтверждены отдельно в разделе закрытия ниже.

| Проверка | Фактическое состояние локально |
|---|---|
| Новые PostgreSQL regression tests | PASS итогового кода: `10/10` в четырёх файлах, включая audit/business/receipt rollback, SQL/history/grants failure и restart, session/CSRF/permissions, rate limit и lock timeout |
| Компактный browser lifecycle и recovery | PASS отдельно на desktop `1440×1000` и mobile `390×844`: по 2 теста, `6 CLOSED`, отдельная финальная приёмка, audit 10 и одна payroll-запись |
| Канонический browser gate | PASS: `2/2` desktop tests; полный lifecycle `250 CLOSED`, отдельная финальная приёмка, audit `254`, единственный payroll и recovery. Основной проход 14,5 минуты, suite 14,8 минуты на локальной машине |
| Dependency audit всех scopes | PASS: `pnpm security:dependencies`, известных уязвимостей не найдено |
| Secret scan | PASS: 40 Git commits и текущий исходный код; шесть узких исторических fixture fingerprints описаны в [[security-baseline]] |
| Production build и clean-container | PASS окончательного кода: no-cache build, новый том `wcl-quality-0905-verified-postgres`, БД `55479`, HTTP `35539`; migrate/seed exit 0, runtime grants, healthy app/DB, SPA/live/ready 200, UID 65532, read-only/cap-drop/no-new-privileges |
| Image vulnerabilities | PASS окончательного образа `sha256:855c8bfb1e5a2803bc06d2dca3b39915baf74667a5f6814178bb464695580f1f`: Trivy 0.74.0 проверил 14 OS и 100 Node packages, HIGH/CRITICAL 0, включая unfixed; JSON `.quality-results/image-vulnerabilities-verified.json` |
| Workflow syntax/expressions | PASS локально: actionlint 1.7.12; последующий CI implementation SHA подтверждён в разделе закрытия ниже |
| Итоговый `pnpm check` | PASS: format, lint, strict types (включая `quality/`), production build, `157` frontend и `15` API тестов (`10` обычных + `5` реальных PostgreSQL integration); integration URL явно направлены в тестовый Compose |
| Strict docs | PASS: `project-docs-auditor --fail-on-warning`, 55 документов, 0 ошибок, 0 предупреждений |
| Документационный prototype UX audit | PASS: desktop `1440×1000` и mobile `390×844`, в каждом 14 шагов, 70 ролевых вариантов, 7 системных состояний, 0 нарушений/переполнений/browser errors. Desktop canonical и mobile compact snapshots финальной приёмки также визуально просмотрены |

Браузерный негативный сценарий подтверждает реальный `409` между двумя вкладками и потерю ответа после commit с единственным event/receipt, автоматическими безопасными reads и без повторной mutation. Первый canonical запуск не завершился во время параллельного тяжёлого сканирования: trace показал успешный API response за 312 мс и задержку browser automation. Повтор без сканера прошёл, assertions и таймауты не ослаблялись. Уточнение ранее зарезервированного code `TOO_MANY_REQUESTS` после запуска браузера отдельно проверяется security suite; оно не меняет успешный lifecycle или conflict/recovery.

Первый Trivy упёрся в ресурсы при параллельном запуске; отдельный scan прежнего Debian 12 runtime обнаружил HIGH/CRITICAL OS/global npm уязвимости. Исправление — закреплённый distroless Node `24.20.0` / Debian `13.6` runtime без npm/shell, без игнорирования CVE. Build stage и production dependency versions сохранены. Проверки не объявляют временной сбой сканера или старый образ успешными.

### Производительность

Локальный профиль окончательного кода, 2026-09-05: Windows `10.0.26200`, Node `24.19.0`, Intel Core i3-10110U, 4 logical CPUs, 7,84 GiB host RAM, PostgreSQL `18.6` в Docker Desktop с примерно 3,74 GiB RAM. `quality/performance.ts` создаёт 40 партий и 120 комплектов через HTTP, всего 10 000 карточек и 12 800 событий. Команды измеряются при росте БД; чтения — после полного объёма и `ANALYZE`, с одним прогревочным detail read. Сканеры, browser suites и build при измерении не выполнялись. Никакие производственные состояния не подготавливаются SQL-изменениями. Для 40 samples median — среднее двух центральных значений; p95 — nearest rank.

| Операция | Samples | Median, ms | p95, ms |
|---|---:|---:|---:|
| Выпуск 250 карточек | 40 | 125,84 | 257,41 |
| Атомарное назначение 59 карточек | 40 | 57,64 | 147,41 |
| Detail партии при 10 000 карточек | 40 | 26,23 | 52,01 |
| Полные 112 карточек, все страницы | 40 | 56,49 | 94,74 |
| Полный audit выпуска 254, все страницы | 40 | 94,61 | 190,29 |

Четыре конкурентных detail reads завершились за 132,18 мс одним smoke sample; это не статистика нагрузки. Raw samples, timestamp и условия сохраняются в `.quality-results/performance.json` и CI artifact. Принятые документы не задают числовой бизнес-SLA: gate проверяет корректность, объём и завершение под явными runtime budgets, сохраняет показатели для сравнения. Профиль не измеряет длительную production-нагрузку, внешнюю сеть, production hardware, final acceptance на большой истории или payroll throughput. После уточнения расчёта median профиль выполнен заново; focused format/lint/quality types прошли, production-код после полного `pnpm check` не менялся.

### Целевой semantic review

Сопоставлены diff и тесты с [[acceptance-criteria]], [[mvp-scope]], [[roles-permissions]], [[glossary]], [[transactions-concurrency]], [[api-contracts]] и [[definition-of-done]]. Подтверждены отдельные first-article / per-card / final-batch действия, `112 → 3 → 250`, operation-scoped нормы, UUID без идентичности физической детали, backend permissions, атомарные audit/receipts и синтетический payroll без денег. Browser setup содержит только справочники; production mutations идут через UI. Новые fault fixtures не подменяют результат browser flow. Успешные API схемы сохранены, ответ 429 использует ранее принятый `TOO_MANY_REQUESTS`.

При проверке реализации различались прежние 5 integration tests, новые PostgreSQL и browser suites, compact и canonical, локальные результаты и последующий CI implementation SHA. Негативная приёмка, переделка, переназначение, deployment и этапы 10–12 не добавлены. Соседние пользовательские dashboard/Home/Obsidian/site изменения не входили в implementation commit этапа 9. Семантических противоречий в затронутых канонических документах не найдено; структурный audit учитывается отдельно.

## Базовые проверки release orchestration этапа 10 — 2026-09-06

Эти результаты относятся к release-orchestration implementation, позже вошедшей в merge-base `origin/main` `551f5b8`. Они сохраняют прогресс этапа 10 ровно `4/7`: пятая задача начата как локально проверенная реализация, но не закрыта без provisioning и hosted qualification. Тогда выполнились следующие локальные gates:

| Проверка | Результат текущего checkout |
|---|---|
| `pnpm check` | PASS: Prettier, ESLint, strict typecheck, `158/158` frontend tests, `24/24` обычных API tests (`6` PostgreSQL integration корректно skipped без URL), `58/58` release tests и production build |
| Runtime contracts | PASS в общей API suite: sanitized health/logging, server-generated request ID, `remoteIp`/Cloud Trace correlation, local XFF spoof rejection, one-hop client IP/rate-limit key и encoded Cloud SQL socket URL |
| Release/deploy contracts | PASS `58/58`: immutable manifest/Trivy binding, append-only evidence chain, successful release run того же SHA/run attempt, exact-digest jobs/revision, renewable smoke-only token boundary, log correlation, negative controls и Ready-revision rollback contract |
| Workflow syntax | PASS: actionlint `1.7.12` для `ci.yml`, `release.yml` и `deploy.yml` |
| IAM/demo hardening | PASS runnable checks: `17/17` focused API tests для config/app/reset transaction flow, `18/18` focused interactive UI tests; capacity/session cleanup и transactional reset также имеют PostgreSQL tests, но они не исполнились без БД |
| UX-copy audit | PASS read-only `window.runUxCopyAudit()` в desktop `1440×1000` и mobile `390×844`: по `14` шагов, `70` role variants, `7` system states, `0` production violations в каждом viewport |
| Terraform contract | PASS на Terraform `1.16.1`: recursive `fmt -check`, `validate`, локальный `plan -refresh=false` `167 to add / 0 to change / 0 to destroy`; safety checker подтвердил exact IAM/actAs/job/secret matrices, единственный `allUsers`, две WIF-границы с раздельными publisher/deployer/smoke targets, восемь jobs, demo limits, reset и deletion guards, а также отсутствие broad roles/secret payloads/credential URLs |
| Strict docs | PASS: финальный `project-docs-auditor --fail-on-warning`, `57` документов, `0` ошибок, `0` предупреждений; semantic pass отдельно сверяет статусы и hosted/local границу |

Новая `Release and IaC contract` job остаётся седьмым обязательным CI gate и теперь также проверяет `deploy.yml`, но удалённо не запускалась. Plan использовал только example inputs, фиктивный локальный token и `-refresh=false`; это не обращение к GCP и не проверка существования ресурсов. Hosted runner проверен только на mock HTTP/metadata/log fixtures: IAM token, HTTPS Cloud Run, browser lifecycle, реальный image digest и Cloud Logging не наблюдались. В текущем shell отсутствуют Docker/PostgreSQL и `QUALITY_OWNER_URL`/integration URLs, поэтому реальные DB проверки reset/capacity не выдаются за успешные. `terraform apply`, `workflow_dispatch`, build/push image и deployment не выполнялись; manifest/evidence records и hosted evidence не создавались.

Смысловая сверка `backlog`/`deployment`/ADR/security/environment/API/audit contracts не нашла конфликтов: public interactive scope сохранён без tenant isolation; live retention, backup/PITR и log retention разделены; deployer indirect workload-identity risk оговорён; budget alerts не названы spending cap. Фактические IAM close/restore, daily reset, Cloud Logging ingestion, Cloud Run header chain и Cloud SQL socket mount/connection явно оставлены обязательным hosted evidence.

Отдельный локальный `pnpm security:secrets` текущего diff не стартовал: Docker CLI отсутствует в данном shell, поэтому дочерний Gitleaks вернул `status=null`. Это не трактуется ни как находка, ни как успешный scan; прежние подтверждённые результаты этапа 9 остаются историческими, а новая версия всё ещё должна пройти обязательную удалённую `security` job.

## Закрытие этапа 9 — 2026-09-05

Implementation SHA [`3ee65709966f5775928de87783fd2946d085e2bc`](https://github.com/AI-shoks/WorkCard-Lifecycle/commit/3ee65709966f5775928de87783fd2946d085e2bc) на момент проверки совпадал с локальным HEAD и head [PR #1](https://github.com/AI-shoks/WorkCard-Lifecycle/pull/1) в `codex/portfolio`. GitHub API подтвердил `head_sha`, событие, `completed/success` обоих исторических runs и каждой обязательной на том SHA job: [push CI 33970654850](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33970654850) и [PR CI 33970656850](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33970656850), attempt 1.

| Обязательная job | Push | PR |
|---|---|---|
| `quality` — Code and database quality | [success](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33970654850/job/101318449484) | [success](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33970656850/job/101318454526) |
| `container` — Clean container startup, включая image scan | [success](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33970654850/job/101318641884) | [success](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33970656850/job/101318638566) |
| `security` — Dependency and secret security | [success](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33970654850/job/101318449620) | [success](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33970656850/job/101318454641) |
| `browser (compact)` — Browser (compact) | [success](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33970654850/job/101318641905) | [success](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33970656850/job/101318638658) |
| `browser (canonical)` — Browser (canonical) | [success](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33970654850/job/101318641863) | [success](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33970656850/job/101318638591) |
| `performance` — Representative performance profile | [success](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33970654850/job/101318641906) | [success](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33970656850/job/101318638598) |

Итого 6/6 обязательных jobs успешны в каждом запуске, 12/12 суммарно; обязательный шаг сканирования образа также завершён успешно в обоих runs. Результаты прежних этапов сохранены выше со своими SHA и CI. Эти runs проверяют implementation commit этапа 9; текущая синхронизация документации в них не входила.

Синхронизация статусов после закрытия прошла `project-docs-auditor --fail-on-warning`: 55 документов, 0 ошибок, 0 предупреждений. Отдельная смысловая сверка не нашла конфликтов статусов, `git diff --check` — PASS. Тяжёлые тесты повторно не запускались.

## Правило слияния

Изменение не готово к commit/PR review, пока релевантный gate не прошёл либо ограничение не описано явно. Failing gate не отключается ради зелёного статуса.
