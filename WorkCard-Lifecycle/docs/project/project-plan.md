---
artifact_id: project.plan
status: active
version: 23
owner: project
updated: 2026-09-06
---

# Project Plan

Это канонический roadmap проекта. Здесь отмечается выполнение или осознанный пропуск этапов; подробности хранятся в отдельных артефактах.

## Обозначения

- `[ ]` — не начато;
- `[-]` — в работе;
- `[x]` — выполнено;
- `[~]` — пропущено; причина обязательна в [[decision-log]].

## Прогресс

**На 2026-09-06 этапы 1–9 закрыты. Этап 10 «Релиз» остаётся в работе на 4/7: `deploy.yml` и hosted smoke runner для пятой задачи реализованы локально, но provisioning, deployment и hosted qualification ещё не выполнялись.**

| № | Этап | Статус | Результат |
|---:|---|---|---|
| 0 | Инициализация | `[x]` выполнено | Проект имеет управляемую структуру |
| 1 | Product Brief и MVP Scope | `[x]` выполнено | Scope отделяет подтверждённый AS-IS от синтетического TO-BE |
| 2 | Доменная спецификация | `[x]` выполнено | Агрегаты, состояния, роли и инварианты приняты |
| 3 | Требования и acceptance criteria | `[x]` выполнено | Сценарии связаны с проверяемыми критериями |
| 4 | UX-проектирование | `[x]` выполнено | 14-шаговый прототип и UX-спецификация согласованы с моделью |
| 5 | Техническая архитектура | `[x]` выполнено | Приняты данные, API, транзакции, безопасность и шесть ADR |
| 6 | Инженерный фундамент | `[x]` выполнено | Созданы monorepo, БД bootstrap, контейнерный runtime и CI |
| 7 | Backend vertical slice | `[x]` выполнено | Код, DB integration, local clean-container и CI implementation SHA подтверждены |
| 8 | Frontend vertical slice | `[x]` выполнено | Полный браузерный процесс, clean-container и CI подтверждены для `b00ff294…` |
| 9 | Качество | `[x]` выполнено | SHA `3ee65709966f5775928de87783fd2946d085e2bc`: все 6 обязательных jobs успешны в push и PR; ссылки ниже |
| 10 | Релиз | `[-]` в работе, 4/7 | Design, IaC, release-image workflow и runtime controls приняты; orchestration/runner подготовлены, но provisioning/hosted evidence ещё нет |
| 11 | Упаковка портфолио | `[ ]` не начато | Ценность и глубина проекта понятны работодателю |
| 12 | Финальный аудит | `[ ]` не начато | Результат готов к честной демонстрации |

## Этапы 0–4 — выполнены

- Product framing: [[product-brief]], [[mvp-scope]], [[success-criteria]], [[decision-provenance]].
- Domain: [[glossary]], [[domain-model]], [[business-rules]], [[commands-events]], [[work-card-state-machine]], [[roles-permissions]].
- Requirements: [[use-cases]], [[user-stories]], [[negative-scenarios]], [[acceptance-criteria]], [[requirements-traceability]].
- UX: [[screen-map]], [[user-flows]], [[wireframes]], [[ui-states]], [[permission-ux]], [[ux-copy-guidelines]] и [14-шаговый прототип](../ux/prototype.html).

Предыдущие этапы закрепили `ProductionBatch 1 → many WorkCardSet`, operation-scoped нормы, UUID карточек без физической нумерации, positive-only first-article gate, мастерское ведение карточек и отдельную цифровую финальную приёмку партии.

## Этап 5. Техническая архитектура — выполнено

- [x] [[technology-stack|Технологический стек]].
- [x] [[system-context|Системный контекст и границы frontend/backend]].
- [x] [[er-model|Реляционная модель]].
- [x] [[api-contracts|HTTP API и ошибки]].
- [x] [[transactions-concurrency|Транзакции и конкурентность]].
- [x] [[audit-log-design|Транзакционный audit log]].
- [x] [[mock-integrations|Mock-интеграции]].
- [x] [[security-baseline|Security baseline]].
- [x] [[adr-index|ADR-0001–ADR-0006]].

**Закрыт:** 2026-09-01. Архитектура сохраняет принятые предметные границы, server-side query событий по `correlationId`, optimistic concurrency, доверенный серверный actor context и идемпотентный локальный payroll adapter.

## Этап 6. Инженерный фундамент — выполнено

- [x] [[repository-structure|Структура pnpm monorepo]].
- [x] [[local-development|Локальный и контейнерный запуск]].
- [x] [[environments|Конфигурация окружений и секретов]].
- [x] [[database-bootstrap|Миграции, seed и runtime verification]].
- [x] [[quality-gates|Format, lint, typecheck, tests и build]].
- [x] [[ci-pipeline|CI и clean-container smoke test]].

**Закрыт:** 2026-09-01. Foundation содержит Fastify API с health endpoints, React shell, общие контракты, PostgreSQL bootstrap, multi-stage Docker image, Compose и GitHub Actions. На момент закрытия этапа 6 он ещё не реализовывал производственный backend-сценарий этапа 7.

## Этап 7. Backend vertical slice — выполнено

- [x] Read-only паспорт, operation plans и нормы технолога/БТБ.
- [x] Партия и несколько operation-scoped `WorkCardSet`.
- [x] Генерация UUID-карточек без sequence labels, со snapshots.
- [x] First-article gate и serial boundary.
- [x] Массовое назначение, включая fixture `1 + 59 + 52`.
- [x] Lifecycle-команды мастера и positive-only БТК.
- [x] Финальная приёмка партии и audit log.
- [x] Mock payroll export и защита от повтора.
- [x] API/integration tests критических разрешений, инвариантов и конфликтов.
- [x] Подтвердить обновлённый образ и clean-container startup локально на текущем checkout.
- [x] Подтвердить implementation commit удалёнными `quality`/`container` jobs для того же SHA.

**Закрыт 2026-09-02:** implementation commit [`17d2b04d13b58c7dff677543ed4399751a8593a1`](https://github.com/AI-shoks/WorkCard-Lifecycle/commit/17d2b04d13b58c7dff677543ed4399751a8593a1) локально прошёл 11 обычных тестов, 5 PostgreSQL integration tests, production build, clean-container, миграции `0001`–`0003`, повторный seed и runtime grants verification. Большой сценарий подтверждает `3 sets / 250 cards / 254 release events`, а компактная fixture из двух карточек проходит все lifecycle-переходы, финальную приёмку, payroll и audit/read-back только через HTTP API. [Push CI](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33581627867) и [PR CI](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33581630041) для того же SHA полностью зелёные: оба jobs `Code and database quality` и `Clean container startup` завершены успешно.

## Этапы 8–12

**Этап 8 закрыт, 2026-09-05:** implementation SHA `b00ff294a7b7ce1e09379c088969d9a02bd033bf`; [push CI](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33963228130) и [PR CI](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33963230414) имеют успешные `quality` и `container` для этого SHA. Локально подтверждены clean-container без кэша на новом томе, миграции/seed, healthy SPA/API/БД и HTTP 200. Ранее прошли 157 frontend, 9 API и 5 PostgreSQL integration tests, полный браузерный процесс `112 → 3 → 250`, отдельная финальная приёмка, audit `254/254`, единственный payroll, desktop/mobile и UX-copy. Старые отметки об отсутствии Docker и невыполненных commit/push сняты по подтверждённым результатам; они не являются ограничениями этапа 9.

**Этап 9 закрыт, 2026-09-05:** implementation SHA [`3ee65709966f5775928de87783fd2946d085e2bc`](https://github.com/AI-shoks/WorkCard-Lifecycle/commit/3ee65709966f5775928de87783fd2946d085e2bc) на момент проверки совпадал с локальным HEAD и head PR #1 в `codex/portfolio`. Через GitHub API подтверждены успешные [push CI](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33970654850) и [PR CI](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33970656850): `quality`, `container` с image scan, `security`, `browser (compact)`, `browser (canonical)` и `performance` — все 6/6 в каждом запуске. Локальные browser/PostgreSQL/security/performance/clean-container gates, strict documentation audit и semantic review также пройдены; результаты этапа 9 и ссылки на каждую job сохранены отдельно от этапов 7–8 в [[quality-gates]]. Воспроизводимые проверки описаны в [[test-strategy]].

**Этап 10 «Релиз»: `[-]` в работе, ровно 4/7.** [[0007-cloud-run-and-cloud-sql-release|ADR-0007]], [[0008-bounded-public-demo-operations|ADR-0008]] и [[deployment]] фиксируют release/IAM/demo design; [infra/terraform](../../infra/terraform/README.md) описывает reviewable IaC, раздельные publisher/deployment WIF, deployer/smoke identities, reset и deletion guards; корневой `.github/workflows/release.yml` вручную собирает один full-SHA image и создаёт проверяемый manifest/evidence contract. Runtime controls включают sanitized health/logging/proxy/socket boundary, лимиты 20 партий/500 sessions, expired cleanup и owner-only reset. Пятая задача начата корневым `.github/workflows/deploy.yml`: он связывает successful release artifact того же SHA с exact-digest jobs/revision, отдельным HTTPS-only smoke runner, Cloud Logging observations и append-only evidence, но ни разу не запускался. Local tests/plan не являются доказательством фактической IAM close/restore, reset cadence, Cloud Run chain, Cloud Logging ingestion или Cloud SQL connection: эти наблюдения остаются hosted evidence. `apply`, workflow и удалённый CI для текущих изменений не запускались, поэтому cloud resources, опубликованный image, фактический release SHA/digest manifest и hosted evidence отсутствуют; этап не закрыт.

- **Frontend vertical slice — выполнено:** роли, таблицы партии/комплектов/карточек, массовые действия, история и связь с реальным API.
- **Качество — выполнено:** расширенная стратегия тестов, миграции, security/performance checks и end-to-end сценарий.
- **Релиз — в работе, 4/7:** design, reviewable IaC, release-image workflow и runtime pre-deploy controls приняты; staging orchestration/runner готовы только как локально проверенный код, а provisioning, публикация image, исполнение staging/production и hosted evidence ещё предстоят.
- **Упаковка портфолио — не начато:** README, диаграммы, demo script, скриншоты, ограничения и ретроспектива.
- **Финальный аудит — не начато:** сверка scope, критериев готовности, документации и воспроизводимости.

### Исходный прогноз и оставшаяся работа

Это оценка сфокусированного труда, а не обещанная календарная дата:

- исходная оценка этапа 9 — 2–4 рабочих дня; этап закрыт 2026-09-05;
- этапы 10–12 — 3–5 рабочих дней;
- исходная оценка этапов 9–12 — 5–9 сфокусированных рабочих дней; сохранена как история планирования и не заменяет фактические критерии закрытия.

## После базового MVP

- отклонение БТК и доработка;
- спор по норме и версионность нормы;
- повторный выпуск карточек;
- ретроактивные карточки;
- уведомления, аналитика и развитие ролевой модели.

## Сквозной процесс

Каждый этап проходит цикл `inspect → implement → relevant tests → diff review → final relevant check`. [[backlog]] хранит актуальные задачи, [[decision-log]] и ADR — решения, а structural audit всегда дополняется отдельным semantic review.
