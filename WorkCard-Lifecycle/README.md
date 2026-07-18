# Production Work Card Workflow

Независимый portfolio case study цифрового жизненного цикла производственной рабочей карточки. Предметная основа опирается на личный производственный опыт, интервью с бывшим мастером и обезличенную физическую карточку; точные demo-данные и TO-BE-решения синтетические.

## Текущий статус

- Этапы 1–3 скорректированы после семантического review и снова имеют канонические принятые артефакты.
- Этап 4 скорректирован: UX-спецификация дополнена отдельным [14-шаговым кликабельным прототипом](docs/ux/prototype.html).
- Этап 5 «Техническая архитектура» выполнен: приняты stack, system/data/API boundaries, transactions, audit, mock integration, security baseline и шесть ADR.
- Этап 6 «Инженерный фундамент» не начат и остаётся следующей контрольной точкой; работающего full-stack приложения текущий checkout пока не заявляет.
- Draft PR #1 остаётся draft и не должен сливаться без отдельного review/PR workflow.
- Свежая проверка: structural audit — `55` документов, `0` errors, `0` warnings; architecture semantic/ID/metadata gates — PASS. Принятый prototype baseline не изменён.
- План: [[project-plan]], scope: [[mvp-scope]], происхождение решений: [[decision-provenance]], индекс: [[documentation-index]].

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

## Принятая техническая архитектура

- TypeScript modular monolith: React SPA, Fastify API и PostgreSQL;
- current state в реляционных таблицах, append-only audit без event sourcing;
- explicit optimistic versions, ordered locks и atomic state/event transactions;
- отдельный server query полного event set по `correlationId`;
- command receipts, одна immutable `FinalBatchAcceptance` на партию и один `PayrollRecord` на WorkCard;
- prepared demo identities, signed session, backend authorization и CSRF baseline;
- local PostgreSQL mock payroll adapter без network I/O и реальных расчётов.

Подробности: [стек](docs/architecture/technology-stack.md), [системный контекст](docs/architecture/system-context.md), [ER-модель](docs/architecture/er-model.md), [API](docs/architecture/api-contracts.md) и [ADR](docs/architecture/adr/README.md).

## Честные границы

Проект не является внедрённой MES, не хранит серийную идентичность деталей, не редактирует паспорта/нормы, не рассчитывает зарплату и не подключается к реальным системам. Backend permissions и optimistic concurrency зафиксированы архитектурой, но будут доказаны только реализацией и тестами следующих этапов.
