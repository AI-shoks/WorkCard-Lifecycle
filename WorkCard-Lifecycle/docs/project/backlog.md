---
artifact_id: project.backlog
status: active
version: 37
owner: project
updated: 2026-09-17
---

# Backlog

Оперативные задачи проекта следуют каноническому [[project-plan|roadmap]]. Требования к поведению системы хранятся в `docs/requirements/`, а принятые решения — в [[decision-log]] и [[adr-index|ADR]].

**На 2026-09-17 этапы 1–9 закрыты; этап 10 остаётся в работе на 4/7. Текущий target — Render Free + Neon Free по [[0009-render-free-neon-free-release|ADR-0009]]: один публичный GHCR image, отдельные DB projects, owner maintenance barrier и ежедневный reset. Владелец разрешил первый deployment и необходимые scoped Git/cloud/DB действия по [[deployment]]; read-only preflight начат. Локальная реализация не заменяет ещё не завершённые hosted qualification и release evidence.**

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

## Выполнено — этап 8

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
- [x] Подтвердить `pnpm check`, production build и clean-container startup implementation SHA этапа 8; отдельно проверить browser console, desktop/mobile layout и отсутствие mocked domain success path.
- [x] Обновить roadmap, backlog, README, demo script и релевантную UX/engineering документацию по фактической реализации.
- [x] Перед закрытием выполнить strict `project-docs-auditor --fail-on-warning`, semantic review и получить зелёные CI jobs для одного implementation SHA.

**Проверено локально 2026-09-05:** `pnpm check` и production build, 157 frontend-тестов (включая 17 интерактивных), 9 обычных API-тестов и отдельно 5/5 integration tests на PostgreSQL 18.6. На новой чистой БД браузер прошёл весь процесс `112 → 3 → 250`: три первые детали, распределение `1 + 59 + 52` в обоих полных комплектах, все 247 серийных карточек, отдельная финальная приёмка, полный audit выпуска `254/254` и единственная payroll-запись с read-back. Предметные команды выполнялись через UI, без mocked success, SQL-подстановок или обхода API. Независимое read-only чтение БД подтвердило итоги и отсутствие дубликатов.

Desktop/mobile UI, все 14 шагов прототипа и `window.runUxCopyAudit()` проверены; strict documentation audit и semantic review выполнены. Подробности и границы доказательств — в [[quality-gates]].

**Этап 8 закрыт:** SHA `b00ff294a7b7ce1e09379c088969d9a02bd033bf`, успешные [push CI](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33963228130) и [PR CI](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33963230414), включая оба jobs `quality`/`container`. Локальный clean-container прошёл без кэша, на новом томе, с миграциями/seed, healthy приложением/БД и HTTP 200. Docker установлен и Server доступен. Эти результаты подтверждают этап 8 и не переносятся на изменения этапа 9.

## Выполнено — этап 9 «Качество»

- [x] Реализовать автоматизированный compact и отдельный canonical browser lifecycle через UI, реальный API и изолированный PostgreSQL.
- [x] Добавить browser version conflict и восстановление после потери ответа уже закоммиченной команды без повторной mutation.
- [x] Добавить fault injection audit insert для всех девяти команд и late receipt/business insert failure; сравнивать полное бизнес-состояние, события и receipts.
- [x] Проверить ошибки и повторный/конкурентный запуск существующего migration runner; защитить неизменность полной применённой истории.
- [x] Добавить HTTP permissions/session/CSRF/input, rate/time budgets и log privacy regression coverage.
- [x] Добавить CI dependency audit всех scopes, redacted Git/current secret scan и HIGH/CRITICAL image gate без общего `ignore-unfixed`.
- [x] Реализовать воспроизводимый performance profile на 10 000 карточках с raw measurements и условиями, без выдуманного SLA.
- [x] Завершить локальные проверки итогового diff, включая compact desktop/mobile, canonical 250, image scan и clean-container.
- [x] Обновить затронутые документы, выполнить strict `project-docs-auditor --fail-on-warning` и целевой semantic review.
- [x] Получить отдельное прямое разрешение на scoped commit/push этапа 9: пользователь разрешил 2026-09-05 отправку в `codex/portfolio`.
- [x] Подтвердить все 6 обязательных CI jobs implementation SHA [`3ee65709966f5775928de87783fd2946d085e2bc`](https://github.com/AI-shoks/WorkCard-Lifecycle/commit/3ee65709966f5775928de87783fd2946d085e2bc) по [[ci-pipeline]]: [push CI](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33970654850) и [PR CI](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33970656850) — 6/6 `success` в каждом запуске.

**Этап 9 закрыт 2026-09-05:** результаты локальной реализации относятся к implementation SHA `3ee65709966f5775928de87783fd2946d085e2bc`. `pnpm check` прошёл с 157 frontend и 15 API tests (10 обычных + 5 PostgreSQL), новые PostgreSQL проверки — 10/10. Compact desktop/mobile и отдельный canonical 250 UI процесс успешны; dependency/secret/image gates, новый no-cache clean-container и профиль 10 000 карточек выполнены. Strict docs: 55 документов, 0 errors/warnings; semantic review — без конфликтов. Точные условия, исправления и ограничения — [[quality-gates]]. Через GitHub API подтверждены `quality`, `container` с image scan, `security`, `browser (compact)`, `browser (canonical)` и `performance` для того же SHA в обоих запусках выше.

## В работе — этап 10 «Релиз»

- [x] Принять текущий $0 release design в [[0009-render-free-neon-free-release|ADR-0009]]; заменить ADR-0007/0008 с сохранением истории, bounded public demo и clean synthetic recovery.
- [x] Описать один Render Free image-backed service и отдельные Neon Free projects; прежний GCP Terraform/foundation/backend contract сохранить неактивным историческим вариантом.
- [x] Адаптировать manual main-only build-once workflow к public GHCR, exact digest/scan/migration checksums, versioned release evidence и lifetime retention; заменить GCP-only IaC gate deployment-contract checks без удаления других gates.
- [x] Реализовать runtime/owner pre-deploy contract: direct Neon verify-full target validation, SQL runtime-role boundary, persistent maintenance/generation, shared/exclusive barrier и 26h fail-closed, liveness без DB и безопасный Render proxy/logging contract.
- [ ] Завершить фактическую hosted qualification того же digest: temporary staging Docker + отдельный Neon project, non-superuser owner/repeat, TLS, роль, races/cancellation, browser compact/canonical, proxy/logging/cold start и clean recovery. Локальные fixtures не закрывают пункт.
- [ ] Выполнить разрешённое production promotion в Render; подтвердить persistent reference/resolved digest, daily/manual reset и совместимый rollback, quotas/$0 settings, secret boundaries и retention release records. При отсутствии предыдущего совместимого image явно сохранить rollback как непроверенный.
- [ ] Сохранить фактическое hosted evidence, strict documentation audit и semantic review; закрыть этап только по этим результатам.

**Прогресс этапа 10 — 4/7:** локально реализованные design/config/workflows/runtime controls не являются удалённым запуском. Результаты проверок текущего дерева — [[quality-gates]]. Историческая GCP foundation preparation `136/0/0`, full `167/0/0`, GCS templates и preflight сохранены в [[deployment-gcp-history]] и [Terraform README](../../infra/terraform/README.md); они не активный next step, а незакоммиченные Terraform HCL/scripts/templates не входят в текущую публикацию. Scoped commit/push, PR/merge после gates, GHCR publication и Render/Neon operations разрешены; следующий результат — фактический hosted deployment с evidence по [[deployment]], который ещё не подтверждён.

## Maintenance

- [x] Закрепить `actions/setup-node` и `pnpm/action-setup` с нативным Node.js 24 runtime по SHA в общем setup action; удалённая проверка подтверждена обоими CI runs этапа 9, указанными выше.

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
