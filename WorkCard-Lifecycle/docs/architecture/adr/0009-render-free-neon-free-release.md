---
artifact_id: architecture.adr.0009
status: accepted
version: 2
owner: architecture
updated: 2026-09-17
supersedes:
  - "[[0007-cloud-run-and-cloud-sql-release]]"
  - "[[0008-bounded-public-demo-operations]]"
---

# ADR-0009. Render Free + Neon Free для публичного демо

## Контекст

Владелец выбрал целевую стоимость $0, публичный GHCR image и восстановление чистого синтетического демо из migrations + seed: сохранять действия посетителей не требуется. Репозиторий содержит подготовленную GCP-архитектуру без выполненного deployment; это сведения репозитория, а не результат проверки внешних аккаунтов. GCP Terraform и предыдущие решения сохраняются как история.

## Решение

- Один Render Free web service запускает готовый nonroot `linux/amd64` image с React SPA и Fastify API. Второй постоянный service, previews, disks, Render jobs, registry credentials и keepalive не нужны.
- Production и staging используют разные Neon Free projects с PostgreSQL 18. PG18 доступен в Neon без preview-ограничений с 2026-05-01; при создании явно задаётся major 18, фактический patch фиксируется через SQL в hosted qualification. Staging API работает локально или во временном Docker на Actions runner. Обычный CI использует только disposable локальную PostgreSQL и не имеет Neon credentials. [Neon PG18 GA](https://neon.com/docs/changelog/2026-05-01)
- Единственная release-сборка публикуется в публичный GHCR; один immutable digest проходит scan, staging и production без rebuild. Render хранит постоянный exact image reference; deployment status и resolved digest сверяются после rollout.
- До первой proxy qualification этот же единственный Render service работает в явном `observe`: нет доверия forwarded headers, API/readiness закрыты до DB, доступны liveness/SPA/peer logs. После наблюдения reviewed peers включается `render`; first bootstrap и обязательный smoke завершают открытие demo. Owner tasks исполняются отдельным одноразовым контейнером того же image. Runtime не получает owner URL/password; browser runner не получает ни DB, ни deployment secrets. TLS, role boundaries и переменные определены в [[environments]] и [[database-bootstrap]].
- Owner/runtime подключаются к direct Neon endpoint с `sslmode=verify-full` и проверкой ожидаемых host/database. Transaction pooler несовместим с используемыми session locks и startup options, поэтому запрещён. Обоснование ограничений — [Neon connection pooling](https://neon.com/docs/connect/connection-pooling).
- Runtime-роль создаётся SQL и не получает `neon_superuser`, elevated memberships или ownership. Роли, созданные Neon Console/API/CLI, имеют иной privileged default; переносить этот путь на runtime нельзя. [Neon roles](https://neon.com/docs/manage/roles)

## Общий демо-контур и обслуживание

Сохраняются предупреждение об общей synthetic DB, лимиты 20 партий/500 sessions, session expiry, role permissions, CSRF/Origin и ежедневный reset из ADR-0008. Вместо GCP IAM/drain применяется постоянное owner-managed состояние `maintenance`, `maintenance_requested`, `generation`, `last_reset_verified_at` и PostgreSQL shared/exclusive advisory barrier. Все runtime DB операции входят через shared lock; отдельный SQL statement после lock в `READ COMMITTED` проверяет состояние. Команда перед созданием receipt повторно проверяет session/generation. Owner сериализует orchestration отдельным mutex и сначала коммитит `maintenance_requested=true`, закрывая новые допуски. Затем exclusive barrier дожидается уже допущенных операций и фиксирует `maintenance=true`/новую generation. Timeout или cancellation во время ожидания сохраняет requested flag; только успешная проверенная операция очищает оба флага. GitHub workflows дополнительно имеют общую concurrency group.

Reset удаляет mutable demo и sessions, сохраняет reference fixtures и не выполняет seed. Timestamp обновляется только после успешных reset + verify либо initial bootstrap + verify. Release migration и обычный verify не продлевают срок. Через 26 часов без подтверждённого reset, при maintenance/requested либо неверном состоянии API отвечает `503`; liveness остаётся доступной. Ошибка или cancellation, включая ожидание drain после persisted request, оставляет gate закрытым; reopen в `finally`/trap запрещён. Verify доступен при закрытом gate. Подтверждение Render suspend/HTTP 202 не является свидетельством завершения SQL.

## Ограничения $0

Условия сверены по официальной документации 2026-09-17; это не проверка аккаунтов. Перед первым запуском фиксируются фактический тариф, отсутствие payment method/платных опций и остатки квот выбранного Render workspace и Neon organization.

- Render Free предоставляет 0.1 CPU/512 MB RAM одному instance. Service засыпает после 15 минут без входящего traffic; пробуждение может занять около минуты. 750 free instance hours выдаются на workspace в календарный месяц. Их исчерпание приостанавливает Free services до следующего месяца. Внешний DB traffic может отдельно вызвать suspension при высоком объёме. Free не даёт disks, shell и one-off jobs. [Render Free](https://render.com/docs/free), [Render compute plans](https://render.com/docs/compute-plans)
- Текущий Render Hobby workspace включает общие для workspace **5 GB/month outbound bandwidth**, 500 standard build pipeline minutes и application log retention 7 дней; platform HTTP request logs недоступны. Старые 100 GB legacy Hobby не являются лимитом нового workspace. Без payment method превышение bandwidth приостанавливает Free services, а исчерпание pipeline minutes блокирует новые builds до следующего месяца. При подключённом payment method перерасход может оплачиваться; для этого $0-контура payment method и платные опции не добавляются. Image собирается в GitHub Actions, Render получает готовый digest. [Render pricing](https://render.com/pricing), [Render Free usage limits](https://render.com/docs/free#monthly-usage-limits)
- Neon Free допускает 100 projects и 10 branches на project. Каждый project получает независимо **100 CU-hours/month, 0.5 GB storage и 5 GB/month public network transfer**; compute — до 2 CU, обязательный scale-to-zero после пяти минут idle. Restore history ограничена шестью часами либо 1 GB изменений, monitoring retention — одним днём. Исчерпание compute/egress приостанавливает compute до следующего billing period; storage cap блокирует операции, увеличивающие объём. Free overage не оплачивается и не даёт автоматического перехода на paid plan. Тариф относится к organization: при создании явно выбирается проверенная Free organization, а не неявный default API account. [Neon plans](https://neon.com/docs/introduction/plans), [Neon pricing](https://neon.com/pricing), [Neon network limits](https://neon.com/docs/introduction/network-transfer)
- Public GHCR packages бесплатны; container storage/bandwidth сейчас не тарифицируются. Первая публикация по умолчанию private: отдельная смена visibility и anonymous pull exact digest обязательны до Render. Standard GitHub-hosted runners публичного repository бесплатны; larger runners не входят в этот контракт. Release records и images сохраняются весь срок эксплуатации, независимо от срока временных Actions artifacts. [GHCR billing](https://docs.github.com/en/billing/concepts/product-billing/github-packages), [GHCR visibility](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry), [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- GitHub schedule может опоздать или быть пропущен, а в публичном неактивном repository выключается после 60 дней. Расписание — удобство; DB timestamp и fail-closed 26h — действующая защита. [GitHub schedule](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)

## Замещение и последствия

ADR-0007 и ADR-0008 заменены этим решением целиком, при этом перечисленные выше предметные demo bounds сохранены. GCP IAM/WIF, Cloud SQL socket, production PITR 7d, Secret Manager numeric versions и 7/30-дневный оплачиваемый lifetime больше не являются текущими требованиями. Исторические причины и подготовленный IaC не удаляются: [[deployment-gcp-history]] и [Terraform README](../../../infra/terraform/README.md).

GitHub/Render secrets изменяемые: release record хранит несекретный rotation identifier и проверенный binding, но не выдаёт его за provider-enforced secret version. Rollback возвращает предыдущий совместимый digest без destructive down migrations и отдельно учитывает актуальные credentials. Current/previous images и release records сохраняются весь срок эксплуатации и rollback; временные Actions artifacts этого не обеспечивают.

Новый recovery baseline — чистая PostgreSQL 18, последовательные неизменённые migrations, initial seed и verify. История посетителей может быть потеряна полностью. При недоступности free-квоты демо остаётся недоступным; автоматического перехода на paid tier нет. Возможность exact-digest Render deployment, реальные TLS/roles/proxy chain, холодный запуск, reset/cancellation и полное recovery остаются обязательной hosted qualification по [[deployment]]. Локальные tests их не заменяют.
