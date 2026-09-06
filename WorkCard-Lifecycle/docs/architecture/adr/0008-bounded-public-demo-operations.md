---
artifact_id: architecture.adr.0008
status: accepted
version: 2
owner: architecture
updated: 2026-09-06
---

# ADR-0008. Bounded shared public demo operations

## Контекст

Production-контур задуман как честный интерактивный portfolio demo: любой посетитель может выбрать одну из подготовленных demo-ролей и выполнить разрешённые backend-команды. Все посетители используют одну synthetic DB, видят общие изменения, а tenant isolation намеренно не входит в MVP. Без эксплуатационной границы такой режим накапливает партии, audit и sessions, делает сценарий невоспроизводимым и оставляет платные cloud resources без срока жизни.

Отдельно production migration и reset требуют временно снять `allUsers roles/run.invoker`. Имеющийся `roles/run.developer` не включает изменение IAM policy сервиса, а выдавать project-wide `roles/run.admin` ради одной операции несоразмерно.

## Рассмотренные варианты

1. Оставить постоянно доступный неограниченный общий demo.
2. Сохранить публичный interactive demo, но ограничить live data, sessions и срок размещения, ежедневно возвращая synthetic reference state.
3. Разрешать доступ только в назначенные временные окна.
4. Сделать demo private или строить tenant isolation.

## Решение

Сохраняется вариант 2. В пределах явно одобренного срока размещения demo остаётся публичным и интерактивным; это не переход к private или appointment-only режиму и не добавление tenant architecture.

- В UI явно сказано, что контур общий, изменения видны другим посетителям, а данные сбрасываются ежедневно.
- Reference fixtures (`demo_users`, `production_passports`, `operation_plans`) сохраняются. Один owner-only `reset` удаляет все sessions и все изменяемые партии, карточки, receipts, audit, acceptance и payroll records в одной транзакции, затем проверяет пустые счётчики и наличие reference fixtures.
- Live DB ограничена 20 партиями. Новая партия отклоняется до создания receipt/audit при достижении лимита.
- Одновременно допускается не более 500 server sessions. Они живут не более 8 часов и 30 минут без активности; истёкшие записи удаляются при обращении и создании новой session, а полный reset удаляет остаток.
- Reset должен успешно завершаться не реже одного раза за 24 часа. До него public invoker снимается, внешний отказ доступа проверяется, запросы дренируются минимум 35 секунд, затем выполняется `work-card-reset`; доступ возвращается только после проверки reference fixtures/readiness. Если с прошлого успешного reset прошло более 26 часов, достигнут лимит или verification не прошёл, demo остаётся закрытым до ручного восстановления.
- Live mutable rows обычно существуют менее 24 часов. Из-за production PITR/backup их прежние версии могут сохраняться до 7 дней. Platform application logs хранятся 30 дней. Реальные персональные, кадровые и производственные данные запрещены.
- При первом разрешённом provisioning оператор обязан записать `provisionedAt` и `destroyBy`. По умолчанию окно составляет 7 календарных дней; одно явно одобренное продление допускается в пределах абсолютного максимума 30 календарных дней от первого provisioning. По достижении `destroyBy` выполняется двухфазный teardown из [[deployment]].

Budget notifications остаются сигналом оператору, а не механизмом остановки расходов и не hard spending cap. Срок жизни и teardown являются обязательной финансовой границей независимо от состояния alerts.

## IAM и аутентификация

Единственный исполнитель изменения production service IAM и запуска DB jobs — service account `work-card-deployer` в release project.

- `roles/run.developer` сохраняется для revision/deployment операций, но не считается достаточным для IAM policy.
- Только на конкретном production Cloud Run service deployer получает custom role `workCardPublicInvokerPolicyOperator` с ровно `run.services.getIamPolicy` и `run.services.setIamPolicy`.
- `roles/run.admin`, `roles/owner`, `roles/editor` и user-managed service-account keys не используются.
- Deployment orchestration получает short-lived credentials через отдельный GitHub WIF pool/provider, ограниченный immutable repository/owner IDs, `main`, `workflow_dispatch` и точным `.github/workflows/deploy.yml`. Отдельные bindings разрешают impersonation только deployer или smoke identity; release-image publisher использует другой pool и не может обменять свой token на эти identities. Это контракт конфигурации до первого разрешённого provisioning и hosted run, а не утверждение о существовании WIF в GCP.

`run.services.setIamPolicy` технически позволяет менять всю IAM policy этого сервиса, поэтому runbook дополнительно разрешает только удаление/возврат точного `allUsers roles/run.invoker`, сохраняет снимки до/после и прекращает операцию при любом другом diff.

У deployer нет прямого `roles/secretmanager.secretAccessor`. Однако `roles/iam.serviceAccountUser` на workload identities вместе с правом создавать/обновлять Cloud Run workloads означает косвенную возможность выполнить код с полномочиями присоединённой identity. Поэтому нельзя утверждать, что deployer принципиально не способен получить secret payload: его WIF и workflow являются привилегированной границей, а неожиданный deploy/job execution или чтение secret workload identity считается инцидентом.

## Последствия

- Посетители не получают персональное пространство и могут видеть или изменить общий synthetic сценарий; UI и portfolio description обязаны говорить об этом прямо.
- Daily reset уничтожает предметный audit как demo-данные. Он не используется как release evidence; release evidence хранится отдельно и reset его не затрагивает.
- Лимиты дают предсказуемый верхний предел live dataset, но не заменяют rate limiting, monitoring и ручное закрытие при abuse.
- Reset не планируется Cloud Scheduler в этой итерации: до отдельной разрешённой orchestration его выполняет оператор по runbook. Пропущенный reset ведёт к закрытию public access, а не к молчаливому продолжению.
- Terraform plan-safety проверяет точную IAM-матрицу, оба WIF trust boundary, единственный `allUsers` binding, reset identity/secret и deletion guards.
- Принятие этого решения и локальные tests не доказывают, что IAM, reset, backups, alerts или teardown работают в GCP. Staging и production остаются незавершёнными без hosted evidence.

## Операционный контракт

Точные команды, recovery, evidence, lifetime и двухфазный teardown описаны в [[deployment]]. Threat boundaries и data policy синхронизированы с [[security-baseline]].
