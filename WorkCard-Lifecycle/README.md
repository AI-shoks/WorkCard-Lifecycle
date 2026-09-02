# Production Work Card Workflow

Независимый portfolio case study цифрового жизненного цикла производственной рабочей карточки. Предметная основа опирается на личный производственный опыт, интервью с бывшим мастером и обезличенную физическую карточку; точные demo-данные и TO-BE-решения синтетические.

## Текущий статус

- Этапы 1–4 завершены: product scope, доменная модель, требования и 14-шаговый UX-прототип согласованы.
- Этап 5 завершён: приняты архитектурные артефакты и ADR-0001–ADR-0006.
- Этап 6 завершён: создан воспроизводимый инженерный фундамент с pnpm workspace, Fastify, React, PostgreSQL bootstrap, Docker Compose и CI.
- Backend vertical slice этапа 7 реализован локально: trusted demo-session, read projections, все девять команд, optimistic concurrency, транзакционный audit, отдельная финальная приёмка и mock payroll.
- Локальный clean-container текущего checkout проходит; следующая контрольная точка — зелёные `quality` и `container` jobs для нового commit SHA. До них этап 7 остаётся на проверке, а frontend vertical slice не объявляется начатым.
- На 2026-09-02 локально проходят format, lint, typecheck, 11 обычных тестов, 5 PostgreSQL integration tests и production build; чистая БД применяет миграции `0001`–`0003`, повторный seed и runtime verification. Последний удалённый зелёный run относится только к `d0ecc812`, не к текущему незакоммиченному diff.

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
