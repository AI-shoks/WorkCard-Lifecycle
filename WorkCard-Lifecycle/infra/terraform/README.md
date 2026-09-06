# Terraform release infrastructure

Reviewable IaC для этапа 10. Конфигурация описывает три отдельных GCP project, общий immutable Artifact Registry, IAM, две строго ограниченные GitHub Workload Identity границы с отдельными deployer/smoke targets, Cloud SQL PostgreSQL 18, Secret Manager, Cloud Run service и отдельные `migrate`/`reset`/`seed`/`verify` jobs, probes, logging/alerts, production PITR, project-level budgets и teardown guards. Она не является разрешением на `apply` и не доказывает hosted readiness.

## Safety contract

- `terraform apply` в этой задаче не выполняется; project IDs, billing account, image digest, origins и alert contacts в `terraform.tfvars.example` — только заведомые placeholders.
- Настоящие secret payloads отсутствуют в `.tf`, `.tfvars` и plan. `staging_secret_values`/`production_secret_values` являются Terraform `ephemeral`; provider получает их только через write-only `root_password_wo`/`secret_data_wo`, поэтому значения не сохраняются в plan или state.
- Cloud Run ссылается на вычисленные числовые Secret Manager versions. Alias `latest` не используется.
- Service accounts не получают JSON keys. GitHub publisher может быть impersonated только через отдельный WIF token заданных numeric repository/owner ID, из `main`, событием `workflow_dispatch` и точным `release.yml`; ему доступна запись в один Artifact Registry repository. Другой pool/provider доверяет только точному `deploy.yml` и имеет два явных impersonation target: привилегированный deployer и smoke runner без DB/log/deploy roles; publisher token для них непригоден.
- App не имеет owner secret; `migrate`/`seed` получают owner URL и app password, `reset` — только owner URL, `verify` — только runtime URL. У release deployer нет прямого `secretAccessor`, но его `roles/iam.serviceAccountUser` вместе с deploy правами может косвенно выполнять код от workload identities. Поэтому нельзя без оговорки утверждать, что deployer не способен получить secret payload; deployer WIF/workflow — привилегированная граница.
- `roles/run.developer` не используется как разрешение на изменение IAM. На единственный production service deployer получает custom role ровно с `run.services.getIamPolicy` и `run.services.setIamPolicy`; `roles/run.admin` отсутствует. Jobs используют resource-level `roles/run.jobsExecutor`.
- Projects, registry, service accounts, WIF, SQL/database, services, jobs и secret containers защищены от Terraform deletion при `teardown_mode=false`. Default VPC не создаётся; Cloud SQL разрешает только Cloud SQL connectors и не имеет authorized networks.
- Project budget notifications не являются hard spending cap и не останавливают ресурсы. Финансовая граница — заранее записанный `destroyBy` и двухфазный teardown по [deployment runbook](../../docs/release/deployment.md).
- Backend намеренно не назначен на review-only шаге. До первого разрешённого apply нужен отдельный encrypted/versioned remote backend и проверка IAM к нему.

## Review commands

Требуются Terraform `1.16.x`, Google provider `7.45.0` из lock-файла и Node.js 24. Реальные cloud credentials для `fmt`, `validate` и mock-free `plan -refresh=false` новых ресурсов не требуются; review token ниже не даёт доступа к GCP.

```powershell
Copy-Item terraform.tfvars.example review.tfvars

# Только искусственные review markers. В реальном release значения приходят
# из одобренного secret source, а не из shell history, файла или CI logs.
$env:TF_VAR_staging_secret_values = '{"owner_database_password":"review-staging-owner-000000000001","app_database_password":"review-staging-runtime-0000000002","session_signing_secret":"review-staging-session-0000000003"}'
$env:TF_VAR_production_secret_values = '{"owner_database_password":"review-production-owner-0000000001","app_database_password":"review-production-runtime-00000002","session_signing_secret":"review-production-session-00000003"}'
$env:GOOGLE_OAUTH_ACCESS_TOKEN = 'review-only-no-cloud-access'

terraform init -backend=false
terraform fmt -check -recursive
terraform validate
terraform plan -refresh=false -input=false -var-file=review.tfvars -out=review.tfplan
terraform show -json review.tfplan | node scripts/assert-plan-safe.mjs
```

`review.tfvars`, generated plans, local state и `.terraform/` игнорируются Git, включая случайные literal PowerShell outputs `$planPath`. Plan следует сохранять под явным именем либо в отдельном temp-каталоге. Скрипт проверяет точные critical resource counts и IAM address sets: deployer project roles, десять `actAs`, восемь job-executor и шестнадцать secret-access bindings, единственный production `allUsers`, custom role из двух permissions, раздельные publisher/deployment WIF trust boundaries, точные deployer/smoke targets, reset identity/secret, demo capacity и deletion guards. Он также требует две БД, восемь secret versions, два services, восемь jobs, три budgets и `teardown_mode=false`, но не допускает service-account key, широкие admin roles, materialized password/secret fields или PostgreSQL credential URL.

Локальная review-проверка 2026-09-06 на Terraform `1.16.1` завершилась планом `167 to add / 0 to change / 0 to destroy`; strict assertion принял IAM/WIF/capacity/deletion contract. Это только статическая проверка графа ресурсов, не `apply` и не свидетельство существования облачной инфраструктуры. Тот же pinned/checksum-verified review contract добавлен как обязательная `Release and IaC contract` job в `ci.yml`, но удалённого запуска текущих изменений ещё не было.

После проверки удалите две `TF_VAR_*` и `GOOGLE_OAUTH_ACCESS_TOKEN` из процесса. Не используйте искусственные review markers при apply.

## Что именно запланировано

| Граница         | Release                                                 | Staging                                         | Production                                                       |
| --------------- | ------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------- |
| Project         | image/IAM/WIF/budget                                    | private runtime/budget                          | public demo runtime/budget                                       |
| Artifact access | publisher writes immutable tag; deployer reads metadata | Cloud Run service agent reads                   | Cloud Run service agent reads                                    |
| Cloud SQL       | —                                                       | PostgreSQL 18, ZONAL, backups 3, connector-only | PostgreSQL 18, ZONAL, backups 7, PITR/WAL 7 days, retain backups |
| Cloud Run       | —                                                       | IAM-private service, smoke identity             | public `allUsers` invoker                                        |
| Jobs            | —                                                       | four explicit, unscheduled, no retry            | four explicit, unscheduled, no retry                             |
| Logs/alerts     | budget email channel                                    | 30-day logs; DB, job, rollout, 5xx alerts       | то же + `/health/ready` and `/` uptime                           |

Service использует startup `/health/ready` (`5s/3s/24`) и liveness `/health/live` (`10s/3s/3`) probes, `min=0`, combined `max=1`, port `3000` и exact image digest. Public health body содержит только `status`. Service явно получает `PROXY_TRUST_MODE=cloud-run`, `DEMO_MAX_BATCHES=20` и `DEMO_MAX_SESSIONS=500`; app config дополнительно требует platform `K_SERVICE` и доверяет только непосредственному proxy hop. Jobs получают `APP_ENV`, `APP_VERSION` и `LOG_LEVEL=info`, чтобы hosted Unix-socket validation и единый Pino JSON context действовали во всех workload. `reset` выполняет только `node dist/reset-demo.js` под выделенной identity и видит только `MIGRATION_DATABASE_URL`. Terraform игнорирует только Cloud Run traffic allocation: staging pre-traffic validation/rollback реализованы в `deploy.yml`, а production promotion и public-IAM maintenance остаются следующими deployment-задачами.

Сформированные secret URL используют `host=%2Fcloudsql%2F<project>%3A<region>%3A<instance>&sslmode=disable`. Приложение детерминированно проверяет этот формат и разбор закреплённым `pg`, но plan не материализует URL, а локальный test не открывает socket. Фактические proxy chain, Cloud Logging ingestion и Cloud SQL connection подтверждаются только staging smoke.

## Граница release-image workflow

`.github/workflows/release.yml` использует созданные здесь publisher/WIF/repository, но не запускает Terraform. После разрешённой foundation-фазы перенесите три несекретных output в GitHub repository variables:

| Repository variable                      | Terraform output                                      |
| ---------------------------------------- | ----------------------------------------------------- |
| `GCP_RELEASE_PROJECT_ID`                 | `project_ids.release`                                 |
| `GCP_WORKLOAD_IDENTITY_PROVIDER`         | `release_workload_identity.provider`                  |
| `GCP_ARTIFACT_PUBLISHER_SERVICE_ACCOUNT` | `release_workload_identity.publisher_service_account` |

Перед plan/apply получите актуальные immutable GitHub IDs для `github_repository_id` и `github_repository_owner_id`, например read-only запросом `gh api repos/AI-shoks/WorkCard-Lifecycle`; placeholder IDs из example применять нельзя. Сам workflow запускается вручную только из `main`, требует успешный push CI того же SHA со всеми семью обязательными jobs, собирает один image, публикует full-SHA tag, дважды сверяет registry digest, сканирует pulled exact digest и создаёт schema-validated release manifest artifact. Он не выполняет jobs/deploy/promotion и не записывает manifest обратно в repository.

Реализованный `deploy.yml` использует отдельный `deployment_workload_identity.provider`. Provider доверяет только тому же immutable repository/owner ID, `main`, `workflow_dispatch` и точному workflow path; разные `roles/iam.workloadIdentityUser` bindings ведут к `deployment_workload_identity.deployer_service_account` и `deployment_workload_identity.smoke_service_account`. Первый target запускает jobs/rollout и читает logs, второй может только вызвать private staging service. Нельзя переиспользовать publisher provider или выдавать любой из identities JSON key.

После отдельно разрешённых provisioning phases назначаются следующие несекретные repository variables; до `apply` этих значений не существует:

| Repository variable                         | Terraform output или reviewed input                                                                          |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `GCP_DEPLOYMENT_WORKLOAD_IDENTITY_PROVIDER` | `deployment_workload_identity.provider`                                                                      |
| `GCP_RELEASE_DEPLOYER_SERVICE_ACCOUNT`      | `deployment_workload_identity.deployer_service_account`                                                      |
| `GCP_STAGING_SMOKE_SERVICE_ACCOUNT`         | `deployment_workload_identity.smoke_service_account`                                                         |
| `GCP_STAGING_PROJECT_ID`                    | `project_ids.staging`                                                                                        |
| `GCP_STAGING_ORIGIN`                        | `runtime.staging.service_uri`, точно совпадающий с reviewed `app_origins.staging`                            |
| `GCP_STAGING_SECRET_VERSIONS`               | JSON из `runtime.staging.pinned_secret_versions`; только пять numeric generation/version values, без payload |

`deploy.yml` и его smoke runner локально проверены, но outputs нигде не назначены и WIF authentication не проверялась в GCP. Exact workflow contract и bootstrap prerequisite описаны в [deployment](../../docs/release/deployment.md#staging-orchestration-без-выполненного-deployment).

## Общий mutable demo

Production остаётся публичным interactive demo с общей synthetic DB и без tenant isolation. Application отклоняет создание 21-й live партии и 501-й active session; session живёт максимум 8 часов/30 минут idle и очищается opportunistically. `work-card-reset` транзакционно удаляет все mutable rows/sessions, сохраняет reference users/passport/operations и откатывается, если post-check не прошёл.

Reset не имеет scheduler resource. До отдельной разрешённой orchestration оператор обязан запускать его не реже раза в 24 часа через public-IAM maintenance runbook: снять только production `allUsers roles/run.invoker`, подтвердить внешний `403`, drain, выполнить `reset` и `verify`, затем эквивалентно восстановить policy. После 26 часов без успешного reset, capacity stop или failed verification public access остаётся закрытым. Полный контракт и предупреждение о backup/PITR retention находятся в [ADR-0008](../../docs/architecture/adr/0008-bounded-public-demo-operations.md) и [deployment](../../docs/release/deployment.md).

## Будущий apply — только после отдельного разрешения

Initial provisioning нельзя выполнять одним неразделённым rollout. `workload_enablement` поддерживает обязательные фазы для каждого контура:

1. `jobs=false`, `service=false`: projects/APIs, budgets, registry, IAM, SQL, secret versions, logs и alerts.
2. После build/push exact digest — `jobs=true`, `service=false`; затем под отдельно одобренной deployer identity выполнить `migrate -> seed -> verify` в чистом staging. `reset` provisioned одновременно, но в bootstrap не запускается. Production `seed` разрешён только для первого bootstrap или отдельно одобренного fixture change.
3. `service=true` только после успешных jobs. Первая private staging revision создаёт rollback baseline; затем `deploy.yml` повторно доказывает idempotence/history, создаёт no-traffic candidate того же digest и выполняет hosted qualification. Эта двухчастная bootstrap-последовательность требует отдельного review перед реальным запуском; production получает тот же digest только после staging evidence.

Перед каждой фазой обязательны обычный plan review, актуальная cost estimate/billing eligibility, remote state, подтверждённые email channels и числовые secret generation counters. Terraform principal также нужен `serviceusage.services.use` в release project: aliased billing provider использует его как quota project для Billing Budgets API. Изменение пароля или производного DB URL требует увеличить соответствующий counter; прежняя Secret Manager version остаётся disabled-on-destroy для rollback window.

До provisioning также обязательны UTC `provisionedAt`/`destroyBy`: default window 7 дней, абсолютный максимум после одного явного продления — 30 дней. Budget alerts не ограничивают расходы. При deadline сначала public access остаётся закрытым, затем отдельный phase-A plan/apply с `teardown_mode=true` снимает только guards. После нового `plan -destroy` и второго разрешения phase B удаляет весь stack без `-target`. При обычном `teardown_mode=false` strict review отклоняет снятые guards, а `deletion_policy=PREVENT`/`deletion_protection` должны остановить случайное удаление. Точные stop conditions и проверки удаления — в [deployment](../../docs/release/deployment.md#lifetime-и-двухфазный-teardown).

## Намеренно вне реализованной границы

Reset schedule/monitor, production approval/traffic switch, production rollback/teardown drill и любое фактическое hosted evidence относятся к следующим задачам этапа 10. Staging job/revision/smoke orchestration уже реализована как неисполненный код, но не доказывает IAM restore/proxy/socket/logging behavior. Эта Terraform-конфигурация ничего не публикует и не создаёт сама по себе; release/deploy workflows остаются неисполненными до отдельного разрешения на provisioning и manual runs.
