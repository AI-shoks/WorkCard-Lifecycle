---
artifact_id: project.backlog
status: active
version: 23
owner: project
updated: 2026-09-05
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

## Выполнено — этап 7

- [x] Реализовать read-only паспорт, operation plans и нормы.
- [x] Реализовать создание партии и нескольких operation-scoped комплектов.
- [x] Реализовать атомарный выпуск UUID-карточек со snapshots.
- [x] Реализовать first-article gate и serial boundary.
- [x] Реализовать массовое назначение и lifecycle-команды мастера.
- [x] Реализовать positive-only подтверждение БТК и финальную приёмку партии.
- [x] Реализовать audit query по `correlationId`.
- [x] Реализовать идемпотентный mock payroll export.
- [x] Покрыть happy path, permissions, инварианты, replay и concurrency интеграционными тестами.
- [x] Подтвердить текущий checkout локальным clean-container startup без переиспользования старого образа.
- [x] Зафиксировать implementation commit [`17d2b04d13b58c7dff677543ed4399751a8593a1`](https://github.com/AI-shoks/WorkCard-Lifecycle/commit/17d2b04d13b58c7dff677543ed4399751a8593a1) и получить полностью зелёные [push CI](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33581627867) и [PR CI](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33581630041) для того же SHA.

## В работе — этап 8

- [x] Заменить readiness-only экран русской role-aware оболочкой с маршрутами `S-01`–`S-07`, breadcrumbs, доступными loading/empty/error states и явным refresh.
- [x] Подключить подготовленные demo identities через реальные `GET /demo-users` и `GET/POST/DELETE /demo-session`: использовать HttpOnly cookie, держать CSRF token только в памяти и очищать command state и защищённый cache при смене роли.
- [x] Реализовать типизированный API client для `/api/v1`, нормализацию `application/problem+json`, request/correlation context и единое правило: mutation считается успешной только после backend response и обязательного read-back.
- [x] Реализовать read-only потоки паспортов, партий, комплектов и карточек с cursor pagination, фильтрами, snapshots, operation-scoped нормами и UUID только во вложенном developer-only контексте.
- [x] Реализовать для ПДБ создание партии и атомарный выпуск всех комплектов с preview `112 → 3 комплекта → 250 карточек`, подтверждением и актуальными versions.
- [x] Реализовать для мастера выбор первой детали, массовое назначение серии в пределах одного комплекта, summary `1 + 59 + 52` и lifecycle-команды start/complete без переназначения и optimistic updates.
- [x] Реализовать для БТК positive-only приёмку первой детали, per-card подтверждение качества и отдельную `FinalBatchAcceptance` с условиями `3/3` gates, `250/250 CLOSED` и read-back actor/time/acceptance ID.
- [x] Реализовать для администратора историю карточки, полный server-side audit по `correlationId` с проверкой authoritative totals и идемпотентный mock payroll export/read-back.
- [x] Реализовать route/action guards по [[permission-ux]]: скрывать чужие действия, объяснять недоступные действия своей роли, не загружать защищённые данные до проверки доступа и не считать frontend окончательной permission boundary.
- [x] Реализовать conflict/network/integrity recovery: без auto retry и force overwrite, с перечитыванием всех затронутых агрегатов, новым явным решением пользователя и отказом от частичного success.
- [x] Покрыть API client, role switch, permissions projection, формы, массовый selection, command states и conflict recovery focused frontend-тестами; расширенные security/performance и полный end-to-end gate оставить этапу 9.
- [x] Проверить русский производственный UI, `aria-*`, disabled reasons и отсутствие ложной нумерации деталей на desktop/mobile; пройти все 14 шагов прототипа и выполнить `window.runUxCopyAudit()`.

### Закрытие этапа 8

- [x] Провести core demo sequence из [[user-flows]] в браузере через реальный API и PostgreSQL на чистом окружении: партия → выпуск → первая деталь → серия → per-card БТК → финальная приёмка → audit/payroll.
- [ ] Подтвердить `pnpm check`, production build и clean-container startup текущего checkout; отдельно проверить browser console, desktop/mobile layout и отсутствие mocked domain success path.
- [x] Обновить roadmap, backlog, README, demo script и релевантную UX/engineering документацию по фактической реализации.
- [ ] Перед закрытием выполнить strict `project-docs-auditor --fail-on-warning`, semantic review и получить зелёные CI jobs для одного implementation SHA.

**Проверено локально 2026-09-05:** `pnpm check` и production build, 157 frontend-тестов (включая 17 интерактивных), 9 обычных API-тестов и отдельно 5/5 integration tests на PostgreSQL 18.6. На новой чистой БД браузер прошёл весь процесс `112 → 3 → 250`: три первые детали, распределение `1 + 59 + 52` в обоих полных комплектах, все 247 серийных карточек, отдельная финальная приёмка, полный audit выпуска `254/254` и единственная payroll-запись с read-back. Предметные команды выполнялись через UI, без mocked success, SQL-подстановок или обхода API. Независимое read-only чтение БД подтвердило итоги и отсутствие дубликатов.

Desktop/mobile UI, все 14 шагов прототипа и `window.runUxCopyAudit()` проверены; strict documentation audit и semantic review выполнены. Подробности и границы доказательств — в [[quality-gates]].

**Этап остаётся открытым:** в двух незакрытых пунктах остались clean-container startup текущей реализации и зелёные CI `quality`/`container` для одного implementation SHA. Docker в текущем окружении недоступен; portable PostgreSQL не заменяет проверку контейнера. Commit и push не выполнялись по указанию пользователя. Исторические CI этапа 7 не подтверждают текущие незакоммиченные изменения. Требования закрытия не отменены.

## Maintenance

- [ ] Перейти на версии `actions/setup-node` и `pnpm/action-setup` с нативным Node.js 24 runtime, когда они доступны и проверены. Текущее предупреждение GitHub о переходе с Node.js 20 на 24 неблокирующее: оба Stage 7 CI runs полностью зелёные.

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
