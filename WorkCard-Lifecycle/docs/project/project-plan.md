---
artifact_id: project.plan
status: active
version: 16
owner: project
updated: 2026-08-07
---

# Project Plan

Это главный трекер проекта. Здесь отмечается выполнение или осознанный пропуск этапов. Детали хранятся в отдельных артефактах, а не разрастаются внутри плана.

## Обозначения

- `[ ]` — не начато;
- `[-]` — в работе;
- `[x]` — выполнено;
- `[~]` — пропущено; причина обязательна в примечании и [[decision-log]].

## Прогресс

| № | Этап | Статус | Результат |
|---:|---|---|---|
| 0 | Инициализация | `[x]` выполнено | Проект имеет управляемую структуру |
| 1 | Product Brief и MVP Scope | `[x]` скорректировано | Scope соответствует подтверждённому AS-IS и явным TO-BE решениям |
| 2 | Доменная спецификация | `[x]` скорректировано | Кардинальности, нормы, роли и first-article gate описаны до кода |
| 3 | Требования и acceptance criteria | `[x]` скорректировано | Новая модель покрыта объективными критериями |
| 4 | UX-проектирование | `[x]` скорректировано | UX-спецификация и отдельный 14-шаговый прототип соответствуют новой модели |
| 5 | Техническая архитектура | `[x]` выполнено | Приняты stack, system/data/API boundaries, транзакции, audit, security и ADR |
| 6 | Инженерный фундамент и backend slices | `[-]` Gate 2.1C remediation accepted; Gate 2.2C accepted; Gate 1/Gate 2 closure pending | Gate 2.1C remediation и Gate 2.2C закрыты; Gate 2 и Stage 6 не закрыты |
| 7 | Backend vertical slice | `[ ]` не начато | Основной сценарий работает через API и БД |
| 8 | Frontend vertical slice | `[ ]` не начато | Основной сценарий выполняется в браузере |
| 9 | Качество | `[ ]` не начато | Критические правила защищены тестами |
| 10 | Релиз | `[ ]` не начато | Проект доступен онлайн и воспроизводимо разворачивается |
| 11 | Упаковка портфолио | `[ ]` не начато | Ценность и глубина проекта понятны работодателю |
| 12 | Финальный аудит | `[ ]` не начато | Проект объективно завершён и готов к демонстрации |

## Этап 0. Инициализация — выполнено

- [x] Создать репозиторий.
- [x] Определить структуру документации.
- [x] Завести [[backlog]].
- [x] Зафиксировать [[definition-of-done]].
- [x] Завести [[decision-log]] и [[risk-register]].
- [x] Закрепить [[case-study-positioning|независимое позиционирование case study]].
- [x] Зафиксировать [[document-governance|правила актуальности, версий и замещения документов]].

## Этап 1. Product Brief и MVP Scope — выполнено

- [x] Зафиксировать [[product-brief|проблему, пользователей и ценность]].
- [x] Зафиксировать [[mvp-scope|границы системы, основной сценарий и out of scope]].
- [x] Принять [[success-criteria|критерии успеха и готовности MVP]].
- [x] Перевести все артефакты этапа в статус `accepted`.

**Первично закрыт:** 2026-07-16. **Скорректирован:** 2026-07-17 после выявления расхождения с подтверждённым AS-IS и повторного semantic review. Product-артефакты версии 4 разделяют первую приёмку, синтетическое per-card закрытие и отдельную цифровую финальную приёмку партии; происхождение решений ведёт [[decision-provenance]].

## Этап 2. Доменная спецификация — выполнено

- [x] [[glossary]]
- [x] [[as-is-to-be|AS-IS и TO-BE]]
- [x] [[domain-model|Сущности, связи и агрегаты]]
- [x] [[business-rules|Бизнес-инварианты]]
- [x] [[commands-events|Команды и доменные события]]
- [x] [[work-card-state-machine|State machine WorkCard]]
- [x] [[roles-permissions|Роли и права]]

**Первично закрыт:** 2026-07-17. **Семантически переоткрыт и скорректирован:** 2026-07-17. Удалены `SequenceNumber`, один комплект и норма партии; введены `ProductionBatch 1 → many WorkCardSet`, operation-scoped нормы, UUID без номера детали и мастерское ведение. `FirstPieceAcceptance`, per-card `ConfirmWorkCardQuality` и aggregate-level `RecordFinalBatchAcceptance` имеют разные команды, scope и evidence; цифровая финальная приёмка не заменяет подписи БТК. Старый результат «47 документов, 0 ошибок» признан только структурным baseline.

## Этап 3. Требования и acceptance criteria — выполнено

- [x] [[use-cases]]
- [x] [[user-stories]]
- [x] [[negative-scenarios]]
- [x] [[acceptance-criteria|Given / When / Then]]
- [x] [[requirements-traceability|Связь требований с тестами]]

**Первично закрыт:** 2026-07-17. **Скорректирован:** 2026-07-17. Зафиксированы 15 use cases, 21 user story, 45 negative scenarios и 37 acceptance criteria. Цепочка финальной приёмки перестроена как `ASIS-010 + ASIS-011 → D-021 → BR-036–BR-039 → UC-015 → US-021 → AC-FBA-* → Future Tests`.

## Этап 4. UX-проектирование — скорректировано

- [x] [[screen-map|Карта экранов и информационная архитектура]]
- [x] [[user-flows|Пользовательские потоки и массовые операции]]
- [x] [[wireframes]]
- [x] [[ui-states|Пустые состояния, ошибки и загрузка]]
- [x] [[permission-ux|Блокировка запрещённых действий]]
- [x] [[ux-copy-guidelines|Канонические правила UX-текста и автоматический аудит]]
- [x] Создать отдельный интерактивный [кликабельный прототип](../ux/prototype.html) core demo sequence.

**Скорректирован:** 2026-07-17. Пять UX-документов версии 4, канонические правила UX-текста и отдельный 14-шаговый прототип покрывают основной процесс `UC-001 → UC-002 → UC-003(first article) → UC-004 → UC-005 → UC-003(serial) → UC-004 → UC-006 → UC-015 → UC-009`. Производственный интерфейс использует русский язык, явно разделяет три контрольных действия и скрывает исходные технические коды во вложенном закрытом блоке «Технические коды для разработчика»; read-only UX-copy audit проверяет все шаги, роли и расположение технических исключений.

## Этап 5. Техническая архитектура — выполнено

- [x] [[technology-stack|Выбор стека]]
- [x] [[system-context|Структура frontend и backend]]
- [x] [[er-model]]
- [x] [[api-contracts]]
- [x] [[transactions-concurrency|Транзакции и конфликтующие изменения]]
- [x] [[audit-log-design]]
- [x] [[mock-integrations]]
- [x] [[security-baseline]]
- [x] [[adr-index|ADR]]

**Закрыт:** 2026-07-18. Текущий backend stack — Python 3.12/FastAPI в modular monolith, будущая React/TypeScript SPA и PostgreSQL; ADR-0007 заменил только stack-часть исторического ADR-0001. Current state отделён от append-only audit без event sourcing. API сохраняет отдельный server query событий по `correlationId`, явные expected versions и command receipts. Семь ADR сохраняют историю stack, physical aggregate mapping, транзакции, audit, mock payroll и demo authorization. Архитектура не меняет `FinalBatchAcceptance`, state machine, роли или 14-шаговый UX-сценарий.

## Этап 6. Инженерный фундамент и backend slices — в работе

- [x] [[repository-structure]]
- [x] [[local-development|Docker и локальный запуск]]
- [x] [[environments|Конфигурация окружений и секреты]]
- [x] [[database-bootstrap|Миграции и seed-данные]]
- [x] [[quality-gates|Lint, format и typecheck]]
- [x] [[ci-pipeline|CI]]

**Gate 1 Foundation:** application factory, configuration, PostgreSQL pool/migrations, health/observability, prepared demo-session, server-side PostgreSQL revocation registry, Problem Details/OpenAPI, least-privilege roles, dependency/secret gates и CI configuration реализованы. Local remediation на Python 3.12/PostgreSQL 15.10 прошла; статус — `Gate 1 remediation validated; publication CI pending`.

**Gate 2.1:** contracts, domain/PostgreSQL implementation и versioned production-batch API находятся в commits `cc370a7ce4cec971edfdac412fd1d804efd93dbe`, `194c19210ea7e9ad9b106219c76880c22bd9a141` и `2852e3c3b3c24f0533b6cbc9106c5bd8cc1be081`; отдельная manual acceptance-запись не найдена.

**Gate 2.1C controlled post-acceptance remediation:** `TASK-002 rev 1 / LIN-003` исправил только `BLOCK-G21C-001`; exact precedence создания партии теперь `session → CSRF → permission → Origin → body`. Независимый security/API review — `ACCEPTED`; implementation commit `7acc58c3eaaa84de3a637a94202f5f7e34a04612`; [[gate-2-1c-remediation]] синхронизирована, finding и remediation — `CLOSED / ACCEPTED`.

**Gate 2.2A/B:** `ReleaseWorkCards` contracts находятся в `c1f1ceb7e6cb42f7289d49604d5966db1ea27759`, domain/PostgreSQL implementation — в `a4bcc72f107c41f4016857395a0cbc4a6b2d26b9`; отдельные manual acceptance-записи не найдены.

**Gate 2.2C:** `TASK-001 rev 2 / LIN-002` прошёл независимый финальный re-review с verdict `ACCEPTED`; подтверждённых findings нет, F-002–F-004 закрыты, REQ-201–REQ-206 доказаны. Пользователь вручную принял Gate 2.2C 2026-08-06. Принятый scope находится в commit `2ab56fcde3dc5ce88ebae9a9709f55b4ae7b72f0`; task-card синхронизирована. Gate 2.2C закрыт.

**Не закрыто:** Gate 2 не принят целиком без acceptance обязательных Gate 2.1 и Gate 2.2A/B. GitHub Actions, Docker image/container smoke и PostgreSQL 18.1 verification не подтверждены; Gate 1 сохраняет `publication CI pending`. Поэтому Stage 6 остаётся открытым. Stage 7 не начат.

**Lifecycle-решение:** `2026-08-07`; Gate 2.1C remediation — `CLOSED / ACCEPTED`, Gate 2.2C — `CLOSED / ACCEPTED`, Gate 2 — `OPEN`, Stage 6 — `OPEN`, Stage 7 — `NOT STARTED`. Push и PR не выполнялись.

## Этап 7. Backend vertical slice

- [ ] Read-only паспорт, operation plans и нормы технолога/БТБ.
- [ ] Партия и несколько operation-scoped `WorkCardSet`.
- [ ] Генерация UUID-карточек без sequence, со snapshots.
- [ ] First-article gate и serial boundary.
- [ ] Массовое назначение.
- [ ] Переходы состояний.
- [ ] Lifecycle-команды мастера и positive-only БТК.
- [ ] Закрытие и audit log.
- [ ] Mock payroll export и защита от повтора.

## Этап 8. Frontend vertical slice

- [ ] Переключение ролей.
- [ ] Таблицы партии, нескольких комплектов и карточек без нумерации деталей.
- [ ] Массовые действия и формы.
- [ ] История карточки и статусы.
- [ ] Обработка ошибок.
- [ ] Связь с реальным API.

## Этап 9. Качество

- [ ] [[test-strategy|Unit, integration и end-to-end тесты]].
- [ ] Тесты state machine, permissions и инвариантов.
- [ ] Тест повторного экспорта.
- [ ] Тест миграций.
- [ ] Базовые проверки безопасности и производительности.

## Этап 10. Релиз

- [ ] [[deployment|Staging и production deployment]].
- [ ] CI/CD, health checks и логирование.
- [ ] Smoke tests.
- [ ] Проверка запуска с чистого окружения.

## Этап 11. Упаковка портфолио

- [ ] README и архитектурные диаграммы.
- [ ] ADR, AS-IS и TO-BE.
- [ ] [[demo-script]], скриншоты и короткое видео.
- [ ] Тестовые учётные записи.
- [ ] Ограничения, дальнейшее развитие и ретроспектива.

## Этап 12. Финальный аудит

- [ ] Сверка с [[mvp-scope]].
- [ ] Проверка всех критериев готовности.
- [ ] Отсутствие критических дефектов.
- [ ] Актуальность документации.
- [ ] Воспроизводимый запуск.
- [ ] Честное позиционирование и готовность к демонстрации.

## Сквозные процессы

На каждом этапе поддерживаем [[backlog]], контролируем scope, обновляем документацию по правилам [[document-governance]], фиксируем ADR и риски, сохраняем понятную Git-историю и регулярно собираем рабочий демонстрационный срез.

## После базового MVP

### Итерация 2

- отклонение БТК и доработка;
- спор по норме;
- версионность нормы;
- повторный выпуск карточек.

### Итерация 3

- ретроактивные карточки;
- уведомления;
- расширенная аналитика;
- улучшенная ролевая модель;
- доработка UX.
