---
artifact_id: project.risk-register
status: active
version: 11
owner: project
updated: 2026-09-17
---

# Risk Register

| ID | Риск | Вероятность | Влияние | Мера |
|---|---|---:|---:|---|
| R-001 | Scope вырастет до mini-MES | высокая | высокое | Любое расширение сверять с [[mvp-scope]] |
| R-002 | Проект надолго останется только документацией | средняя | высокое | После базового проектирования собирать малые vertical slices |
| R-003 | UI и API реализуют разные правила | средняя | высокое | Инварианты и permissions обеспечивать на backend |
| R-004 | Двойной payroll export | средняя | высокое | Идемпотентность, уникальное ограничение и integration test |
| R-005 | Audit log расходится с изменением карточки | средняя | высокое | Записывать их в одной транзакции |
| R-006 | Case study выглядит как вымышленное внедрение | средняя | высокое | Явно указывать синтетические данные и mock-интеграции |
| R-007 | Документы противоречат друг другу | средняя | среднее | Один канонический файл на каждый артефакт |
| R-008 | Автоматизация удалит важную историю решения | низкая | высокое | Автоматически только выявлять; удалять после ручной проверки |
| R-009 | Внутренне согласованные документы расходятся с подтверждённым AS-IS | средняя | высокое | Вести [[decision-provenance]] и выполнять семантический проход отдельно от структурного аудита |
| R-010 | Технический ID карточки будет воспринят как номер физической детали | средняя | высокое | Не хранить `sequenceNumber`, не показывать пользовательские `#01`/`3 из N`, явно отделять UUID от серийной прослеживаемости |
| R-011 | Портфолио завысит зрелость UX, назвав текстовые wireframes проходимым прототипом | средняя | среднее | Не закрывать соответствующий exit criterion без интерактивного артефакта или явной смены критерия |
| R-012 | Mutable tag или rebuild между staging/production создаст непроверенный release | средняя | высокое | Build once; public GHCR digest; manifest/scan/checksums и Render persistent reference/resolved digest сверяются по [[deployment]] |
| R-013 | Owner DB secret попадёт в runtime service или browser/обычный CI | средняя | высокое | Отдельные GitHub owner/runtime/Render environments, step-scoped secrets, один owner контейнер exact digest; runtime без owner, browser без DB/PG/deployment variables. Реальный binding проверяется hosted по [[environments]] |
| R-014 | Application rollback окажется несовместим с уже применённой schema | средняя | высокое | Только backward-compatible migrations в rollback window; destructive change требует expand/contract, restore rehearsal и ADR |
| R-015 | Локальный код/config или workflow fixture будут выданы за работающий deployment | средняя | высокое | Разделять локальные tests и будущие hosted observations; этап 10 закрывается по фактическому digest/deployment/TLS/proxy/reset/smoke evidence. Аккаунты в этой задаче не инспектируются |
| R-016 | Исторический GCP: Постоянная стоимость Cloud SQL превысит бюджет portfolio demo | средняя | высокое | Foundation сразу создаёт две always-on Cloud SQL; текущий list-price subtotal около `$4.31/7 суток` без usage-dependent backup/log/network/tax/FX. Обычные budget alerts не являются hard spending cap. До `apply` нужны фактическая смета/billing eligibility и fail-closed `destroyBy`; default window 7 дней, абсолютный максимум 30 дней с extension approval, затем двухфазный teardown по [[deployment-gcp-history]] |
| R-017 | Общая публичная DB будет испорчена посетителем или накопит данные до отказа | высокая | высокое | Synthetic-only, предупреждение, 20 партий/500 sessions, expiry/cleanup, daily owner reset без seed и автоматический 26h fail-closed по [[0009-render-free-neon-free-release|ADR-0009]] |
| R-018 | Исторический GCP: Runbook снимет public access и не вернёт его либо расширит IAM policy сверх `allUsers roles/run.invoker` | средняя | высокое | Единственный executor — `work-card-deployer`; custom role содержит только get/set IAM на одном production service, не `roles/run.admin`; runbook сохраняет policy snapshots, использует обязательный restore и останавливается при постороннем diff |
| R-019 | Исторический GCP: `deletion_policy=PREVENT` сорвёт teardown или защита будет снята в обычном plan | средняя | высокое | `teardown_mode=false` проверяется plan-safety; удаление выполняется только двумя отдельными одобренными plan/apply: сначала точечно снять guards, затем новый destroy plan; обычный review обязан иметь 0 destroy |
| R-020 | Исторический GCP: Короткоживущий Cloud Run ID token истечёт внутри канонического hosted smoke либо попадёт в diagnostic artifact/на внешний origin | средняя | высокое | Chromium устанавливается до token exchange; broker проверяет issuer/audience/email/lifetime и обновляет token за 2 минуты до expiry; browser не получает OIDC/Google credentials, trace отключён, external origin блокируются, IAM header добавляется one-hop только к exact staging origin, temporary token file удаляется и не загружается |
| R-021 | Исторический GCP: Локальный state или недостаточно защищённый remote backend раскроет чувствительные Terraform данные либо допустит concurrent plan/apply | средняя | высокое | Не активировать backend и не строить реальный plan, пока заранее существующий отдельный GCS bucket не подтвердит versioning, uniform access, public access prevention, непубличный least-privilege IAM и write/lock access; backend/credentials/state/plan не коммитить, remote plan выполнять с locking и отдельным review |

## Текущие Render/Neon риски

GCP-only R-016/R-018–R-021 выше сохранены как история неактивного варианта, а не инструкция к действию.

| ID | Риск | Вероятность | Влияние | Мера |
|---|---|---|---|---|
| R-022 | Free quotas, sleep или external DB traffic остановят demo; overage станет платным | высокая | высокое | Проверить Free/account billing до запуска, запрет paid options/auto-upgrade, quota checks; принять недоступность вместо обещания uptime; без keepalive |
| R-023 | Scheduled reset не запустится или опоздает | высокая | среднее | DB `last_reset_verified_at` и 26h fail-closed независимо от Actions, manual reset и назначенный оператор |
| R-024 | Auth-reset race либо session cleanup пройдёт maintenance | средняя | высокое | Shared barrier для каждой DB операции, separate SQL state check после lock, generation/session revalidation до receipt; exclusive owner close и отдельный mutex |
| R-025 | Отмена maintenance откроет непроверенное demo | средняя | высокое | Gate сохраняется в DB до recovery; no unconditional reopen, verify при закрытом gate, targeted cancellation tests |
| R-026 | Короткий Neon recovery window не сохранит visitor history | высокая | принято | History не требуется; recovery из неизменённых migrations + initial seed + verify, с полной потерей действий посетителей |
| R-027 | Истекут Actions artifacts либо пропадёт previous digest | средняя | высокое | GHCR current/previous и GitHub Release records хранить весь lifecycle/rollback; перед promotion проверять доступность и hashes, не включать автоматическое удаление |
| R-028 | Render proxy trust ошибочно примет spoofed IP | средняя | высокое | Явный peer/CIDR-chain allowlist; обязательная hosted chain qualification, не расширять trust при отсутствии evidence |
| R-029 | Mutable secret rotation сломает app rollback | средняя | высокое | Отдельные rotation identifiers/binding checks, не выдавать их за Secret Manager versions; rollback проверяет актуальные credentials без раскрытия payload |
