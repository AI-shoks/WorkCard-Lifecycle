# Production Work Card Workflow

Независимый portfolio case study цифрового жизненного цикла производственной рабочей карточки. Предметная основа опирается на личный производственный опыт, интервью с бывшим мастером и обезличенную физическую карточку; точные demo-данные и TO-BE-решения синтетические.

## Текущий статус

- Этапы 1–4 завершены: product scope, доменная модель, требования и 14-шаговый UX-прототип согласованы.
- Этап 5 завершён: приняты архитектурные артефакты и ADR-0001–ADR-0006.
- Этап 6 завершён: создан воспроизводимый инженерный фундамент с pnpm workspace, Fastify, React, PostgreSQL bootstrap, Docker Compose и CI.
- Backend vertical slice этапа 7 завершён implementation commit [`17d2b04d13b58c7dff677543ed4399751a8593a1`](https://github.com/AI-shoks/WorkCard-Lifecycle/commit/17d2b04d13b58c7dff677543ed4399751a8593a1): trusted demo-session, read projections, все девять команд, optimistic concurrency, транзакционный audit, отдельная финальная приёмка и mock payroll.
- Для implementation SHA этапа 7 локально подтверждены format, lint, typecheck, 11 обычных тестов, 5 PostgreSQL integration tests, production build, миграции `0001`–`0003`, повторный seed/runtime verification и clean-container.
- [Push CI](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33581627867) и [PR CI](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33581630041) этого SHA полностью зелёные: `Code and database quality` и `Clean container startup` завершены успешно.
- В текущем checkout реализован frontend vertical slice этапа 8: русские ролевые экраны `S-01`–`S-07`, серверная demo-session, создание и выпуск, назначение и ведение карточек, БТК, журнал действий и тестовый учёт нормо-часов. Команды проходят через реальный API, а успех требует ответа сервера и полного контрольного чтения.
- На 5 сентября 2026 года текущая реализация прошла `pnpm check` с production build: `157` frontend tests и `9` обычных API tests; отдельно прошли `5/5` реальных PostgreSQL integration tests. Установка с frozen lockfile и dependency audit успешны; после заключительной установки frontend suite повторно дал `157/157`.
- Полный браузерный процесс выполнен на итоговой production SPA и новой чистой PostgreSQL `18.6`: выпуск `3/250`, все `250` lifecycle, отдельная финальная приёмка, полный audit выпуска `254` и единственная payroll-запись с read-back после обновления. Производственные состояния не подставлялись через mocks, API shortcuts или SQL.
- Runtime UI проверен на desktop/mobile: `16` проверок экранов и защищённого доступа, без утечек технических кодов, сломанных accessibility-ссылок и горизонтальных переполнений.
- Этап 8 остаётся в работе до clean-container текущего checkout и зелёных CI jobs его implementation SHA. Docker в доступной среде отсутствует, текущие изменения не закоммичены и удалённым CI не проверены. Полные результаты — в [Quality gates](docs/engineering/quality-gates.md), обязательства — в [backlog](docs/project/backlog.md) и [Definition of Done](docs/project/definition-of-done.md).

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
