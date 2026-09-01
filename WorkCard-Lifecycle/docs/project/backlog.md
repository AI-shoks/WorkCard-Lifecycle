---
artifact_id: project.backlog
status: active
version: 13
owner: project
updated: 2026-09-01
---

# Backlog

Оперативные задачи проекта следуют каноническому [[project-plan|roadmap]]. Требования к поведению системы хранятся в `docs/requirements/`, а принятые решения — в [[decision-log]] и [[adr-index|ADR]].

## Выполнено — этапы 1–4

- [x] Product scope, доменная модель, требования и UX согласованы между собой.
- [x] `ProductionBatch 1 → many WorkCardSet`, operation-scoped нормы и UUID без sequence labels закреплены сквозной traceability.
- [x] Positive-only first-article gate, per-card подтверждение качества и отдельная `FinalBatchAcceptance` имеют разные команды и доказательства.
- [x] 14-шаговый прототип и русский производственный UX прошли отдельные проверки.

## Выполнено — этап 5

- [x] Принять [[technology-stack]], [[system-context]] и [[er-model]].
- [x] Зафиксировать [[api-contracts]] и полный audit query по `correlationId`.
- [x] Зафиксировать [[transactions-concurrency]] и [[audit-log-design]].
- [x] Принять [[mock-integrations]] и [[security-baseline]].
- [x] Оформить и принять ADR-0001–ADR-0006.

## Выполнено — этап 6

- [x] Создать pnpm monorepo с `apps/api`, `apps/web` и `packages/contracts`.
- [x] Добавить lint, format, typecheck, tests и production build.
- [x] Добавить PostgreSQL migration, идемпотентный seed и проверку runtime-прав.
- [x] Добавить multi-stage Dockerfile, Compose и health checks.
- [x] Добавить GitHub Actions для code/database quality и clean-container startup.
- [x] Документировать структуру, окружения, локальный запуск и CI.

## Далее — этап 7 (не начато)

- [ ] Реализовать read-only паспорт, operation plans и нормы.
- [ ] Реализовать создание партии и нескольких operation-scoped комплектов.
- [ ] Реализовать атомарный выпуск UUID-карточек со snapshots.
- [ ] Реализовать first-article gate и serial boundary.
- [ ] Реализовать массовое назначение и lifecycle-команды мастера.
- [ ] Реализовать positive-only подтверждение БТК и финальную приёмку партии.
- [ ] Реализовать audit query по `correlationId`.
- [ ] Реализовать идемпотентный mock payroll export.
- [ ] Покрыть happy path, permissions, инварианты, replay и concurrency интеграционными тестами.

## Сохранённые выводы

- Полный аудит массовой операции требует server-side query событий по `correlationId`; клиентское объединение отдельных card histories не доказывает полноту.
- `FinalBatchAcceptance` — immutable batch-level запись и не выводится из per-card закрытий.
- Производственный UI остаётся русским, а технические ID, enum, commands/events и versions скрываются в developer-only контексте.
- Structural audit проверяет структуру и ссылки, но не заменяет semantic review.

## Icebox — после MVP

- отклонение БТК и цикл доработки;
- спор по норме и версионность нормы;
- повторный выпуск карточек;
- ретроактивные карточки;
- уведомления и расширенная аналитика.
