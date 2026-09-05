---
artifact_id: project.plan
status: active
version: 14
owner: project
updated: 2026-09-05
---

# Project Plan

Это канонический roadmap проекта. Здесь отмечается выполнение или осознанный пропуск этапов; подробности хранятся в отдельных артефактах.

## Обозначения

- `[ ]` — не начато;
- `[-]` — в работе;
- `[x]` — выполнено;
- `[~]` — пропущено; причина обязательна в [[decision-log]].

## Прогресс

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
| 8 | Frontend vertical slice | `[-]` в работе | Полный браузерный процесс и локальные проверки пройдены; остаются clean-container и CI implementation SHA |
| 9 | Качество | `[ ]` не начато | Критические правила защищены тестами |
| 10 | Релиз | `[ ]` не начато | Проект воспроизводимо разворачивается |
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

**Этап 8, проверка 2026-09-05:** роли и маршруты `S-01`–`S-07` работают с реальным API; `pnpm check` прошёл с 157 frontend-тестами и 9 обычными API-тестами, отдельно прошли 5 PostgreSQL 18.6 integration tests. На новой чистой БД весь браузерный процесс завершил `3/3` first-article gates, `250/250 CLOSED`, отдельную финальную приёмку, полный audit `254/254` и единственную payroll-запись. Проверены desktop/mobile, 14 шагов прототипа, UX-copy, strict audit и semantic review. Этап не закрыт до clean-container startup и зелёных `quality`/`container` для одного implementation SHA: Docker локально отсутствует, commit/push требуют отдельного разрешения пользователя. Фактические результаты — [[quality-gates]], незакрытые критерии — [[backlog]].

- **Frontend vertical slice:** роли, таблицы партии/комплектов/карточек, массовые действия, история и связь с реальным API.
- **Качество:** расширенная стратегия тестов, миграции, security/performance checks и end-to-end сценарий.
- **Релиз:** staging/production, CI/CD, health checks, логи и запуск с чистого окружения.
- **Упаковка портфолио:** README, диаграммы, demo script, скриншоты, ограничения и ретроспектива.
- **Финальный аудит:** сверка scope, критериев готовности, документации и воспроизводимости.

### Базовый прогноз

Это оценка сфокусированного труда, а не обещанная календарная дата:

- остаток этапа 8 — контейнерная и удалённая CI-проверка после отдельного разрешения на commit/push; прежняя оценка 6–10 дней относилась к ещё не реализованному frontend;
- этап 9 — 2–4 рабочих дня;
- этапы 10–12 — 3–5 рабочих дней;
- общий остаток этапов 9–12 — 5–9 сфокусированных рабочих дней без оценки ожидания разрешения и CI для этапа 8.

## После базового MVP

- отклонение БТК и доработка;
- спор по норме и версионность нормы;
- повторный выпуск карточек;
- ретроактивные карточки;
- уведомления, аналитика и развитие ролевой модели.

## Сквозной процесс

Каждый этап проходит цикл `inspect → implement → relevant tests → diff review → final relevant check`. [[backlog]] хранит актуальные задачи, [[decision-log]] и ADR — решения, а structural audit всегда дополняется отдельным semantic review.
