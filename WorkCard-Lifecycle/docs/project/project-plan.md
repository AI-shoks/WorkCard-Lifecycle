---
artifact_id: project.plan
status: active
version: 40
owner: project
updated: 2026-09-29
---

# Project Plan

Это канонический roadmap проекта. Здесь отмечается выполнение или осознанный пропуск этапов; подробности хранятся в отдельных артефактах.

## Обозначения

- `[ ]` — не начато;
- `[-]` — в работе;
- `[x]` — выполнено;
- `[~]` — пропущено; причина обязательна в [[decision-log]].

## Прогресс

**Текущая цель — обновлённое публичное демо и завершённый портфолио-кейс (D-034).** Пользователь 29 сентября заменил прежний отказ от обновления. Проверенный main `bdb2647520639b9ca690dfd6d00402076463a63a` прошёл [CI 7/7](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/36544788733); точный image опубликован и просканирован. Переключение сайта ещё не выполнено: требуется завершить проверку тарифов/квот и штатный staging/deployment. Этап 12 и roadmap остаются открытыми; rollback drill не проверен. Текущие результаты — [[deployment#Обновление демо 2026-09-29]].

[PR #17](https://github.com/AI-shoks/WorkCard-Lifecycle/pull/17) объединён с main `bdb2647520639b9ca690dfd6d00402076463a63a`; собственный [push CI 36544788733](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/36544788733) прошёл 7/7. Сохранены recovery workflow, helpers и browser harness из main, исправления журнала FA-01/02 и минимальное обновление `fast-uri`. Прежний CI `2d4609ad…` остаётся отдельным историческим результатом.

Оставшийся путь:

- [x] Подготовить объединение с актуальным main и разрешить документальные конфликты, сохранив обе линии изменений.
- [x] Получить разрешение на commit/push/PR/merge и новое обновление существующего демо (D-034).
- [x] Объединить PR #17 и проверить собственный main CI `bdb2647…`: 7/7.
- [x] Опубликовать точный image, сохранить scan/records и проверить совместимость прежнего образа.
- [ ] Завершить текущую проверку тарифов/квот Render/Neon и staging qualification.
- [ ] Выполнить штатный deployment, проверить фактическую версию, health, audit/logging и reset mechanism.
- [ ] Принять итог портфолио с квалифицированной новой размещённой версией и закрыть этап 12/roadmap.

D-034 включает release/deployment и необходимый staging reset. Публичный reset запрещён. FA-05 сохраняется как непроверенный rollback drill; совместимость образов не заменяет испытание.

Этапы 1–11 закрыты; этап 12 и roadmap открыты до квалификации нового размещения. Main `bdb2647…` прошёл CI 7/7, его image опубликован со scan HIGH/CRITICAL=0. Публичный сервис пока использует `1195892…`; актуальные тарифы/квоты, staging и deployment остаются незавершёнными. [[deployment#Обновление демо 2026-09-29|Состояние обновления]].

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
| 10 | Релиз | `[x]` выполнено, 7/7 | Exact digest, Render/Neon Free, staging/production/recovery canonical и compact smoke, elapsed fail-closed подтверждены; rollback drill остаётся непроверенным |
| 11 | Упаковка портфолио | `[x]` выполнено | README, схема, короткий показ, 4 реальных снимка с происхождением, ограничения и ретроспектива; аудит затронутых материалов пройден |
| 12 | Финальный аудит | `[-]` в работе | Main `bdb2647…`: CI 7/7 и image/scan опубликованы; новое размещение ожидает preflight и staging. FA-05 непроверен |

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

**Историческое закрытие этапа 10 «Релиз»: [x], 7/7, на 27 сентября.** Публичный сервис https://work-card-demo.onrender.com использует опубликованный digest source SHA 1195892f15f2f240dd04f39e8388d6bb8802d9a7. [Deploy run](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/35452096053) и [release records](https://github.com/AI-shoks/WorkCard-Lifecycle/releases/tag/work-card-1195892f15f2f240dd04f39e8388d6bb8802d9a7) подтверждают staging, persistent/live Render reference и canonical production smoke. [Recovery canonical](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/36316059944) подтвердил 192,58 часа elapsed, fail-closed API, owner reset и полный 250-card browser на отдельной ранее чисто восстановленной БД; [recovery compact](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/36320856998) прошёл 6-card browser и удалил временный synthetic паспорт. Manual и scheduled reset проходили; сетевой сбой resolver 26 сентября не запускал owner job, 27 сентября reset снова успешен. Два Neon проекта находятся на Free. Rollback drill не заявляется: предыдущего совместимого образа нет.

- **Frontend vertical slice — выполнено:** роли, таблицы партии/комплектов/карточек, массовые действия, история и связь с реальным API.
- **Качество — выполнено:** расширенная стратегия тестов, миграции, security/performance checks и end-to-end сценарий.
- **Релиз — выполнен, 7/7:** exact digest развернут на Render, staging/production/recovery smoke и elapsed fail-closed подтверждены; evidence и ограничения — [[deployment]].
- **Упаковка портфолио — выполнено:** [README](../../README.md), схема реализованной архитектуры, [[demo-script|показ за 5–7 минут]], [[screenshots|галерея]] и [[engineering-retrospective|инженерные решения и ограничения]].
- **Финальный аудит — в работе:** Этапы 1–11 закрыты; этап 12 и roadmap открыты до квалификации нового размещения. Main `bdb2647…` прошёл CI 7/7, его image опубликован со scan HIGH/CRITICAL=0. Публичный сервис пока использует `1195892…`; актуальные тарифы/квоты, staging и deployment остаются незавершёнными. [[deployment#Обновление демо 2026-09-29|Состояние обновления]].

### Этап 11 — выполнено 27 сентября 2026 года

- [x] README объясняет задачу, роль автора, процесс, фактическую архитектуру, доказательства и вход в демо.
- [x] Короткий показ отделён от полного 250-card сценария; предусмотрены холодный старт, пустая БД после reset и показ сохранённых результатов.
- [x] Добавлена схема React/Vite → Fastify → PostgreSQL с owner/runtime и staging/production границами; компоненты сверены с кодом.
- [x] Сохранены четыре настоящих снимка: паспорт, карточка мастера, финальная приёмка desktop и mobile. Даты, сценарии, hashes и неуспешное происхождение диагностического кадра отмечены явно.
- [x] Ограничения и пять инженерных решений с их ценой изложены в [[engineering-retrospective]]; заводское внедрение, бизнес-эффект и rollback drill не заявляются.
- [x] Сверены сохранённые release reports и SHA256 recovery assets, выполнены проверка ссылок, strict documentation audit и целевой semantic review. Проверки приложения повторно не запускались: код и инфраструктура не менялись.

Это закрытие упаковки, а не финальный аудит всего проекта. Первоначальная статическая часть этапа 12 отдельно сверила полный scope/DoD и архитектурные документы с реализацией; на тот момент проверка воспроизводимости ограничивалась чтением инструкций, кода и сохранённых результатов. Ручная проверка позже подтверждена пользователем; последующее локальное закрытие FA-01/02 отражено в [[backlog]]. Основание изменения документов этапа 11 — D-029 в [[decision-log]].

### Этап 12 — статическая часть выполнена, этап открыт

- [x] Сверены MVP scope, 37 AC, traceability и DoD с кодом и содержимым тестов; пробелы не выданы за PASS.
- [x] Разделены source/image SHA, версии automation, окружения, успешные и неуспешные evidence.
- [x] Исправлены живые архитектурные документы; история ADR сохранена через явное замещение.
- [x] Сверены README, схема, сценарий, подписи снимков, ограничения и ретроспектива.
- [x] При первоначальном статическом аудите инструкции запуска проверены чтением; приложение и облачные операции не запускались.
- [x] Выполнены строгий аудит документации, проверка локальных ссылок, смысловая сверка и просмотр diff своих изменений; результаты — [[quality-gates]].
- [x] Пользователь подтвердил успешную ручную проверку демо: «все проверил, все работает». Подтверждение получено 2026-09-27, SHA/окружение не указаны; границы — [[final-audit]].
- [x] FA-01/02 закрыты локально: реализованы гарантии audit payload/version и выполнены существенные негативные API/PostgreSQL проверки; локальные результаты и последующий CI `2d4609ad…` — [[quality-gates]].
- [x] Внести UI-smoke агента от 27 сентября после сверки hashes, DOM/скриншотов и независимого read-only SQL: 250/254, первая приёмка, повтор payroll, финальная приёмка подготовленной API/SQL партии; полный lifecycle не приписан этому проходу.
- [x] Сверить все 22 пункта DoD и подготовить отдельный вывод о готовности с анализом влияния и минимальным планом FA-03 — [[final-audit]].
- [x] Получить и сверить семь CI checks: `2d4609ad…`, run `36449212344`, attempt 1, 7/7 success; logs/reports и 146 SHA-256 совпали. Это выполнение проверки, не закрытие FA-03 или этапа.
- [x] D-032 отдельно утверждён пользователем 29 сентября: FA-03 закрыт по исходникам `2d4609ad…`; этап 12/roadmap пока остаются открытыми, историческая граница hosted evidence и непроверенный FA-05 сохранены. Новый hosted release — отдельное предложение/разрешение; статусное решение не разрешает публикацию или deployment.

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
