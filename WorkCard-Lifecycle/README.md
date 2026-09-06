# Production Work Card Workflow

Независимый portfolio case study цифрового жизненного цикла производственной рабочей карточки. Предметная основа опирается на личный производственный опыт, интервью с бывшим мастером и обезличенную физическую карточку; точные demo-данные и TO-BE-решения синтетические.

## Текущий статус

**На 6 сентября 2026 года этапы 1–9 закрыты. Этап 10 «Релиз» остаётся в работе на 4/7: код release orchestration и hosted smoke для пятой задачи подготовлен локально, но provisioning, deployment и фактическая hosted qualification ещё не выполнялись.**

- Этапы 1–4 завершены: product scope, доменная модель, требования и 14-шаговый UX-прототип согласованы.
- Этап 5 завершён: приняты архитектурные артефакты и ADR-0001–ADR-0006.
- Этап 6 завершён: создан воспроизводимый инженерный фундамент с pnpm workspace, Fastify, React, PostgreSQL bootstrap, Docker Compose и CI.
- Backend vertical slice этапа 7 завершён implementation commit [`17d2b04d13b58c7dff677543ed4399751a8593a1`](https://github.com/AI-shoks/WorkCard-Lifecycle/commit/17d2b04d13b58c7dff677543ed4399751a8593a1): trusted demo-session, read projections, все девять команд, optimistic concurrency, транзакционный audit, отдельная финальная приёмка и mock payroll.
- Для implementation SHA этапа 7 локально подтверждены format, lint, typecheck, 11 обычных тестов, 5 PostgreSQL integration tests, production build, миграции `0001`–`0003`, повторный seed/runtime verification и clean-container.
- [Push CI](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33581627867) и [PR CI](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33581630041) этого SHA полностью зелёные: `Code and database quality` и `Clean container startup` завершены успешно.
- В текущем checkout реализован frontend vertical slice этапа 8: русские ролевые экраны `S-01`–`S-07`, серверная demo-session, создание и выпуск, назначение и ведение карточек, БТК, журнал действий и тестовый учёт нормо-часов. Команды проходят через реальный API, а успех требует ответа сервера и полного контрольного чтения.
- Исторический результат этапа 8 на 5 сентября 2026 года: реализация прошла `pnpm check` с production build, `157` frontend tests и `9` обычных API tests; отдельно прошли `5/5` реальных PostgreSQL integration tests. Установка с frozen lockfile и dependency audit успешны; после заключительной установки frontend suite повторно дал `157/157`.
- Полный браузерный процесс выполнен на итоговой production SPA и новой чистой PostgreSQL `18.6`: выпуск `3/250`, все `250` lifecycle, отдельная финальная приёмка, полный audit выпуска `254` и единственная payroll-запись с read-back после обновления. Производственные состояния не подставлялись через mocks, API shortcuts или SQL.
- Runtime UI проверен на desktop/mobile: `16` проверок экранов и защищённого доступа, без утечек технических кодов, сломанных accessibility-ссылок и горизонтальных переполнений.
- Этап 8 завершён implementation SHA `b00ff294a7b7ce1e09379c088969d9a02bd033bf`: локальный clean-container без кэша с новым томом и [push CI](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33963228130) / [PR CI](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33963230414) подтвердили `quality` и `container`. Docker установлен и доступен; прежние отметки об отсутствии Docker и commit/push устарели.
- Этап 9 завершён implementation SHA [`3ee65709966f5775928de87783fd2946d085e2bc`](https://github.com/AI-shoks/WorkCard-Lifecycle/commit/3ee65709966f5775928de87783fd2946d085e2bc): реальные Playwright/SPA/API/PostgreSQL проверки, fault injection транзакций и миграций, security gates и воспроизводимый performance profile. Compact (6 карточек) и canonical (250 карточек) проверяются отдельно. Через GitHub API подтверждены [push CI](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33970654850) и [PR CI](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33970656850): `quality`, `container` с image scan, `security`, `browser (compact)`, `browser (canonical)`, `performance` — 6/6 успешных jobs в каждом запуске для этого SHA. Локальные результаты этапа 9: `157` frontend, `10` обычных API, `5` PostgreSQL integration и `10` новых PostgreSQL regression tests — PASS. Подробности — в [Quality gates](docs/engineering/quality-gates.md), [backlog](docs/project/backlog.md) и [Definition of Done](docs/project/definition-of-done.md).
- Первая задача этапа 10 завершена как планирование: [ADR-0007](docs/architecture/adr/0007-cloud-run-and-cloud-sql-release.md) выбирает Cloud Run/Artifact Registry/Cloud SQL PostgreSQL 18, а [Deployment](docs/release/deployment.md) определяет build-once image по full commit SHA + digest, owner-only jobs, secrets/`APP_ORIGIN`, health/logs, staging smoke, production promotion и rollback. Никаких cloud resources, release image/digest или hosted запусков пока не создано.
- Вторая задача этапа 10 завершена как reviewable IaC: [Terraform root](infra/terraform/README.md) описывает release/staging/production projects, IAM, registry, две Cloud SQL, Secret Manager, services/jobs, probes, logs/alerts, production PITR, budgets и раздельные GitHub WIF. Отдельная deployment trust boundary теперь может impersonate deployer и ограниченный smoke runner; последний по ресурсным ролям имеет только `roles/run.invoker` на private staging service. `terraform fmt -check -recursive`, `terraform validate` и локальный review plan `167 to add / 0 to change / 0 to destroy` прошли; strict assertion подтвердил critical IAM/WIF/capacity/deletion guards и отсутствие secret payloads/credential URLs. `terraform apply` не запускался.
- Третья задача этапа 10 реализована в `.github/workflows/release.yml`: только ручной запуск из `main` после полного успешного push-CI того же SHA; один `linux/amd64` build получает immutable full-SHA tag, публикуется через short-lived WIF, перечитывается по registry digest, сканируется Trivy и формирует schema-validated `docs/release/manifests/<SHA>.json`. Manifest хранит только build/scan факты; staging/production/smoke/promotion/rollback факты добавляются отдельными append-only hash-chained records без placeholders. Обязательный CI gate локально проверяет `ci.yml`, `release.yml`, `deploy.yml`, manifest/Trivy/evidence tests и secret/WIF-safe Terraform plan. Ни один release/deploy workflow и новая удалённая CI job не запускались, поэтому cloud resources, release image/digest, фактический manifest и hosted evidence по-прежнему отсутствуют.
- Локальный hardening этапа 10 сохраняет публичный interactive demo, но ограничивает общую synthetic DB 20 партиями/500 sessions, очищает истёкшие sessions и добавляет owner-only daily reset. [ADR-0008](docs/architecture/adr/0008-bounded-public-demo-operations.md) и [Deployment](docs/release/deployment.md) фиксируют `work-card-deployer` как единственного исполнителя public-IAM toggle, custom role из двух permissions вместо `roles/run.admin`, keyless deployment WIF с отдельными deployer/smoke targets, обязательный restore, 7/30-дневный lifetime и двухфазный teardown. Budget alerts прямо не считаются hard spending cap. Это code/plan/runbook evidence, не hosted staging или production evidence.
- Четвёртая задача этапа 10 закрыта на уровне кода/config: `/health/live` и `/health/ready` публикуют только status при сохранении `200/503`; Pino JSON содержит Cloud Logging `severity`, безопасный release/request/job context и redaction; local/test игнорируют `X-Forwarded-For`, а Cloud Run mode доверяет одному platform hop и имеет spoof/rate-limit tests; hosted URL обязан разрешаться `pg@8.23.0` в percent-encoded `/cloudsql/<project>:<region>:<instance>`. Реальная Cloud Run chain, Cloud Logging ingestion и Cloud SQL connection не проверялись и остаются staging evidence.
- Пятая задача этапа 10 начата в ветке release orchestration: корневой `.github/workflows/deploy.yml` требует явную фразу и успешный `release.yml` того же `main` SHA/run attempt, проверяет exact digest и неизменные job/revision boundaries, выполняет `migrate → seed → verify` дважды без overrides, создаёт no-traffic revision, переключает staging и возвращает повторно проверенную Ready previous revision при последующей ошибке. Отдельный hosted runner использует только короткоживущие audience-bound ID tokens smoke identity, обновляет их до истечения, не передаёт browser process GitHub/Google credentials, блокирует внешние origin и связывает безопасные application logs с Cloud Run request logs. Локальные checks не являются hosted qualification; task остаётся незакрытой, потому что `apply`, `workflow_dispatch`, image publication, deployment и hosted smoke не выполнялись.

## Локальный запуск и браузерный сценарий

Из каталога `WorkCard-Lifecycle/` выполните `docker compose up --build --wait --wait-timeout 180` и откройте `http://localhost:3000/`. Вход выбирает подготовленного синтетического пользователя. Полные условия запуска и работы с БД приведены в [Local development](docs/engineering/local-development.md).

[Demo script](docs/portfolio/demo-script.md) описывает полный путь `112 → 3 комплекта → 250 карточек`, распределение `1 + 59 + 52`, отдельную финальную приёмку, проверку 254 событий выпуска и payroll read-back. Для финальной приёмки все карточки должны пройти реальные команды мастера и БТК; готовое закрытое состояние в SPA не подставляется.

Смена роли при незавершённой форме требует подтверждения: отмена сохраняет ввод, подтверждение очищает формы, диалоги, выбор карточек и защищённые данные. При конфликте или неизвестном исходе UI перечитывает связанные объекты без повтора команды; новая попытка требует нового решения пользователя. Технические коды находятся только во вложенном закрытом блоке «Сведений о прототипе».

В проверенном сценарии оба комплекта по `112` получили распределение `1 + 59 + 52`, третий из `26` — `1 + 25`. Первые детали и все `247` карточек обработки партии прошли действия мастера и БТК через UI; actor/time/ID отдельной финальной приёмки совпали с read-back. Payroll выполнил один `POST` и два успешных `GET` той же записи, без нового export при обновлении. Неперехваченных или неожиданных browser errors не было; начальные `401` до входа и `404` отсутствующей payroll-записи являются ожидаемыми состояниями.

Документационный прототип отдельно прошёл `window.runUxCopyAudit()` на desktop/mobile: все `14` шагов, `70` сочетаний роли и шага, `7` системных состояний и `0` нарушений. Живая SPA также прошла отдельный desktop/mobile audit: `16` проверок с `0` нарушений языка, технической границы, accessibility-ссылок и горизонтального layout. Эти два результата не смешиваются; подробности приведены в [Quality gates](docs/engineering/quality-gates.md).

## Репозиторий и навигация

- [Repository](https://github.com/AI-shoks/WorkCard-Lifecycle)
- [Наглядная карта проекта](docs/project-dashboard.html)
- [Roadmap](docs/project/project-plan.md)
- [Backlog](docs/project/backlog.md)
- [Decision log](docs/project/decision-log.md)
- [Architecture](docs/architecture/technology-stack.md)
- [Reviewable Terraform](infra/terraform/README.md)
- [Local development](docs/engineering/local-development.md)
- [[00 Home|Vault index]], [[mvp-scope|scope]], [[decision-provenance|происхождение решений]], [[documentation-index|индекс материалов]]

## Исправленная предметная модель

- одна `ProductionBatch` имеет несколько `WorkCardSet` по операциям/группам;
- норматив принадлежит operation scope / комплекту, а не партии;
- `WorkCard` имеет внутренний UUID и не нумерует/не идентифицирует физическую деталь;
- каждая карточка содержит `batchQuantitySnapshot`;
- мастер назначает карточки и фиксирует начало/завершение;
- БТК положительно принимает первую деталь до серии; отдельное per-card закрытие WorkCard является синтетическим TO-BE-решением;
- отдельная digital `FinalBatchAcceptance` входит в MVP как одна неизменяемая запись всей завершённой партии; она не выводится из карточек и не заменяет физические подписи БТК;
- отрицательный контроль, доработка, переназначение и повторный выпуск вне MVP.

## Канонический demo-fixture

Точное соотношение `112 → 112 + 112 + 26 = 250` выбрано как синтетический demo-сценарий для воспроизводимой проверки. Оно иллюстрирует связь «одна партия → несколько комплектов», но не выдаётся за наблюдавшийся пример реального производства.

1. `PLANNER` как ПДБ выбирает подготовленный паспорт и создаёт партию `112`.
2. Один выпуск создаёт три operation-scoped комплекта `112 + 112 + 26 = 250` карточек.
3. Мастер назначает и проводит first-article карточку; БТК положительно открывает serial gate.
4. Первый полный комплект получает assignment summary `60 + 52 = 112` без диапазонов номеров деталей.
5. Мастер фиксирует serial work, БТК синтетической per-card командой закрывает карточку; это не `FinalBatchAcceptance` всей партии.
6. После `3/3` first-article gates и `250/250 CLOSED` БТК отдельной командой принимает завершённую партию; read-back показывает actor, time и acceptance ID.
7. Admin создаёт единственную mock payroll-запись operation-scoped нормы и читает audit log.

Прототип проходит 14-шаговый сценарий интерактивно, переключает требуемые роли и показывает backend-oriented permission states, включая отдельную финальную приёмку партии и её read-back.

## Честные границы

Проект не является внедрённой MES, не хранит серийную идентичность деталей, не редактирует паспорта/нормы, не рассчитывает зарплату и не подключается к реальным системам. Backend permissions и optimistic concurrency остаются окончательной границей.
