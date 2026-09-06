---
artifact_id: architecture.adr.0007
status: accepted
version: 2
owner: architecture
updated: 2026-09-06
---

# ADR-0007. Cloud Run and Cloud SQL release platform

## Контекст

MVP поставляется одним OCI image с SPA/API и использует PostgreSQL 18. Релиз должен продвигать один и тот же image digest через staging и production, запускать миграции/seed отдельно от runtime с owner-доступом, хранить secrets вне image и давать наблюдаемый rollback. Фактический deployment пока не разрешён и не выполняется.

## Варианты

1. Google Cloud Run + Artifact Registry + Cloud SQL + Secret Manager/Cloud Logging.
2. Render image-backed service + Render Postgres + one-off jobs.
3. Виртуальная машина с Docker и отдельной managed PostgreSQL.
4. Kubernetes и managed PostgreSQL.

## Решение

Использовать Cloud Run service и Cloud SQL for PostgreSQL 18 в `europe-west1`. Staging и production находятся в разных GCP projects и разных Cloud SQL instances; общий Artifact Registry расположен в release project. Cloud Run Jobs с отдельными service identities выполняют `migrate`, `reset`, `seed` и runtime `verify`. Service и jobs получают один exact Artifact Registry digest; production promotion меняет revision/traffic, а не пересобирает image.

Операционный контракт, secrets, smoke и rollback определены в [[deployment]]; bounded shared demo, узкий public-IAM operator и lifetime — в [[0008-bounded-public-demo-operations|ADR-0008]].

## Причины

- Cloud Run принимает точный `image@sha256:…`, а revision сохраняет resolved digest и неизменяемую конфигурацию.
- Cloud Run Jobs позволяют отделить owner secrets и право исполнения от публичного application service.
- Artifact Registry поддерживает immutable tags и общий digest для обоих runtime projects.
- Cloud SQL является управляемой PostgreSQL, поддерживает major 18, backups и PITR.
- Cloud Run traffic revisions дают быстрый application rollback без Kubernetes/VM operations.
- Secret Manager и Cloud Logging закрывают минимальный hosting secret/logging контур без добавления внешнего APM.

Render остаётся жизнеспособной более простой альтернативой, но его one-off job наследует build artifact и все environment variables базового service. Для строгой owner/runtime границы потребовался бы дополнительный постоянно описываемый base service и отдельная проверка того, какой digest он считает последним успешным. VM переносит patching, process supervision и rollback на автора; Kubernetes несоразмерен одному stateless process и одной БД.

## Последствия

- появляются три логических GCP projects и cross-project read access к одному registry; IAM/IaC сложнее single-platform dashboard;
- Cloud SQL patch управляется provider и не фиксируется Docker digest: release квалифицирует фактический PostgreSQL 18 patch;
- дешёвый single-zone database profile не даёт оснований заявлять HA или application SLA;
- Cloud Run `min=0`, `max=1` допускает cold start и не даёт instance-level HA; это сохраняет текущие DB/rate-limit budgets, числовой latency SLA не заявляется;
- каноническим browser origin первого релиза остаётся стабильный HTTPS service URL Cloud Run; custom domain/CORS не входят в решение;
- schema rollback остаётся forward-only: traffic rollback допустим только для backward-compatible migration;
- выбор платформы не доказывает availability, TLS, backup, secret isolation или успешный deploy — для этого нужны hosted evidence этапа 10.

## Статус

Решение принято как целевая платформа первой hosted release. Создание ресурсов, расход средств, публикация image и deployment требуют отдельной реализации и явного запуска.
