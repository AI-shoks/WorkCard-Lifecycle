---
artifact_id: project.risk-register
status: active
version: 7
owner: project
updated: 2026-09-06
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
| R-012 | Mutable tag или rebuild между staging/production создаст непроверенный release | средняя | высокое | Build once; full commit SHA + Artifact Registry digest; exact digest recheck в обоих Cloud Run revisions по [[deployment]] |
| R-013 | Owner DB secret попадёт в runtime service или общий CI context | средняя | высокое | Terraform описывает разные identities и exact secret access: owner URL только у `migrate`/`seed`/`reset`; deployer не имеет прямого accessor, но его `iam.serviceAccountUser` + deploy права могут косвенно использовать workload identity, поэтому WIF/workflow считаются привилегированной границей; после `apply` обязательны IAM inspection и audit |
| R-014 | Application rollback окажется несовместим с уже применённой schema | средняя | высокое | Только backward-compatible migrations в rollback window; destructive change требует expand/contract, restore rehearsal и ADR |
| R-015 | Release plan, reviewable IaC или неисполненный workflow будут ошибочно выданы за работающий hosted deployment | средняя | высокое | Явно фиксировать, что plan `166 to add`, workflow code и локальные проверки не равны `apply`/публикации; этап 10 закрывать только по фактическим SHA/digest/revision/smoke evidence |
| R-016 | Постоянная стоимость Cloud SQL превысит бюджет portfolio demo | средняя | высокое | Обычные budget alerts не являются hard spending cap. До `apply` нужны смета/billing eligibility и `destroyBy`; default window 7 дней, абсолютный максимум 30 дней, затем двухфазный teardown по [[deployment]] независимо от alerts |
| R-017 | Общая публичная mutable DB будет испорчена одним посетителем или накопит данные до отказа | высокая | высокое | Явное предупреждение в UI; только synthetic data; лимиты 20 партий/500 sessions; session expiry/cleanup; owner-only reset каждые 24 часа и fail-closed после 26 часов или при отказе verification по [[0008-bounded-public-demo-operations|ADR-0008]] |
| R-018 | Runbook снимет public access и не вернёт его либо расширит IAM policy сверх `allUsers roles/run.invoker` | средняя | высокое | Единственный executor — `work-card-deployer`; custom role содержит только get/set IAM на одном production service, не `roles/run.admin`; runbook сохраняет policy snapshots, использует обязательный restore и останавливается при постороннем diff |
| R-019 | `deletion_policy=PREVENT` сорвёт teardown или защита будет снята в обычном plan | средняя | высокое | `teardown_mode=false` проверяется plan-safety; удаление выполняется только двумя отдельными одобренными plan/apply: сначала точечно снять guards, затем новый destroy plan; обычный review обязан иметь 0 destroy |
