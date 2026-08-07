---
artifact_id: project.backlog
status: active
version: 20
owner: project
updated: 2026-08-07
---

# Backlog

## Выполнено — этап 1

- [x] Проверить формулировку проблемы в [[product-brief]].
- [x] Подтвердить роли пользователей MVP v1.
- [x] Подтвердить основной happy path в [[mvp-scope]].
- [x] Подтвердить границу: отклонение БТК относится к итерации 2.
- [x] Согласовать измеримые [[success-criteria]].
- [x] Перевести артефакты этапа 1 в `accepted`.

## Выполнено — этап 2

- [x] Согласовать термины в [[glossary]].
- [x] Описать AS-IS и TO-BE.
- [x] Зафиксировать агрегаты и владение инвариантами.
- [x] Зафиксировать бизнес-инварианты MVP v1.
- [x] Утвердить команды и события.
- [x] Утвердить state machine.
- [x] Утвердить матрицу ролей и прав.

## Выполнено — этап 3

- [x] Описать акторов, предусловия и потоки в [[use-cases]].
- [x] Подготовить проверяемые [[user-stories]].
- [x] Зафиксировать [[negative-scenarios]].
- [x] Описать [[acceptance-criteria|Given / When / Then]].
- [x] Связать scope, требования и будущие тесты в [[requirements-traceability]].

## Выполнено — этап 4

- [x] Подготовить [[screen-map|карту экранов и информационную архитектуру]].
- [x] Описать [[user-flows|пользовательские потоки и массовые операции]].
- [x] Разработать [[wireframes]].
- [x] Зафиксировать [[ui-states|loading, empty и error states]].
- [x] Описать [[permission-ux|UX разрешённых и запрещённых действий]].

## Выполнено — доменная коррекция этапов 1–4

- [x] Добавить [[decision-provenance|реестр происхождения решений]].
- [x] Исправить `ProductionBatch 1 → many WorkCardSet` и operation-scoped нормы.
- [x] Удалить `SequenceNumber`, пользовательские `#01`, `n из N` и ложную идентификацию деталей.
- [x] Добавить `batchQuantitySnapshot`, fixture `112 → 112 + 112 + 26 = 250` и `60 + 52 = 112`.
- [x] Включить positive-only first-article gate без отрицательного цикла.
- [x] Сопоставить `PLANNER` с ПДБ, а технолога/БТБ — с read-only seed-данными.
- [x] Передать assignment/start/complete мастеру; оставить `WORKER` read-only assignee/beneficiary.
- [x] Обновить 15 use cases, 21 story, 45 negative scenarios и 37 acceptance criteria.
- [x] Обновить пять UX-артефактов, README и navigation pages.

## Выполнено — честное закрытие этапа 4

- [x] Создать интерактивный [кликабельный прототип](../ux/prototype.html) core demo sequence.
- [x] Проверить 14 шагов, desktop/mobile layouts, role denial, отдельную final-batch acceptance и отсутствие sequence labels в headless DOM.
- [x] Повторить strict structural audit и semantic pass.
- [x] Вернуть этапу 4 статус «выполнено»; PR #1 оставить draft до отдельного review.

## Выполнено — отдельная digital FinalBatchAcceptance в MVP v1

- [x] Принять `D-021` и добавить `TOBE-008`, сохранив `ASIS-010`/`ASIS-011` и границу физических подписей.
- [x] Описать `RecordFinalBatchAcceptance`, неизменяемую запись и `FinalBatchAccepted` с optimistic concurrency и атомарностью.
- [x] Добавить `UC-015`, `US-021`, `AC-FBA-001`–`007`, `NS-041`–`045` и future tests.
- [x] Перестроить traceability от evidence до тестов, не используя read-only `UC-007` как основную команду.
- [x] Добавить batch-level action, permission gating и actor/time/ID read-back в UX и прототип.
- [x] Повторить structural audit (`48 / 0 / 0`), semantic/ID/metadata gates и headless positive/negative/permission/replay checks.

## Выполнено — полный UX-copy audit прототипа

- [x] Проверить пользовательский текст всех 14 шагов, пяти ролей и дополнительных системных состояний.
- [x] Перевести производственное отображение на русский язык без изменения доменных команд, ролей, прав и переходов.
- [x] Разделить приёмку первой детали, подтверждение качества карточки и финальную приёмку партии однозначными подписями.
- [x] Добавить [[ux-copy-guidelines|канонические правила UX-текста]], репозиторные инструкции и read-only DOM-аудит.
- [x] Перенести технические ID, enum, команды, события и версии во вложенный закрытый блок «Технические коды для разработчика»; верхний уровень «Сведений о прототипе» оставить полностью русским.

## Выполнено — этап 5

- [x] Принять [[technology-stack|технологический стек]].
- [x] Описать [[system-context|системный контекст и границы frontend/backend]].
- [x] Подготовить [[er-model]] и [[api-contracts]].
- [x] В [[api-contracts]] принять отдельный server query событий по `correlationId` как источник полного аудита массовой операции.
- [x] Зафиксировать [[transactions-concurrency|транзакции и конкурентность]].
- [x] Спроектировать [[audit-log-design|хранение аудита]] и [[mock-integrations|mock-интеграции]].
- [x] Принять [[security-baseline]] и шесть [[adr-index|ADR]].
- [x] Сохранить каноническую доменную логику `FinalBatchAcceptance`, роли, state machine и UX-сценарий без изменений.

Server correlation query закрывает отложенное решение `UC-014`: клиентское объединение отдельных card histories не является доказательством полноты. Архитектура остаётся одним PostgreSQL transaction boundary; реальная payroll/ERP, отрицательная приёмка и rework не добавлены.

## Выполнено локально — Gate 1 этапа 6

- [x] Зафиксировать [[repository-structure]].
- [x] Настроить [[local-development|native и Docker local path]].
- [x] Описать [[environments|окружения, три DSN и секреты]].
- [x] Подготовить [[database-bootstrap|миграции `0001–0003`, seed и session registry]].
- [x] Настроить [[quality-gates|format/lint/typecheck/audit/tests/docs/OpenAPI gates]].
- [x] Подготовить [[ci-pipeline|PostgreSQL 18.1, separate roles и container smoke CI]].
- [x] Устранить replay после logout/role switch и проверить expiry/CSRF matrix.
- [x] Унифицировать runtime/OpenAPI Problem Details, включая `404/405/503`.
- [x] Проверить least-privilege runtime role и сохранение исходной migration error.

Текущий статус: `Gate 1 remediation validated; publication CI pending`.

## Реализовано в рабочей ветке — Gate 2

- [x] Gate 2.1 contracts, domain/PostgreSQL implementation и versioned production-batch API.
- [x] Gate 2.2A: зафиксировать `ReleaseWorkCards` contracts и D-025.
- [x] Gate 2.2B: реализовать `ReleaseWorkCards` domain/PostgreSQL slice в `a4bcc72f107c41f4016857395a0cbc4a6b2d26b9`.

Эти implementation-факты не означают `ACCEPTED`: отдельные acceptance-записи Gate 2.1 и Gate 2.2A/B не найдены. Поэтому Gate 2 и Stage 6 не закрыты.

## Завершено — controlled Gate 2.1C remediation

- [x] Прямым решением пользователя назначить `TASK-002 rev 1 / LIN-003` исключительно finding `BLOCK-G21C-001`, не используя lineage Gate 2.2C и не создавая обходной ID.
- [x] Создать [[gate-2-1c-remediation]] с parent baseline `7542044f87ea4dc1a1453321a86e1000814f34b0`, frozen manifest, exact трехфайловым future scope, collision matrix, acceptance/checks и stop conditions.
- [x] Остановить governance-запуск в `READY FOR REMEDIATION` без изменений production, tests, OpenAPI и `api-contracts.md`.
- [x] Выполнить exact three-file remediation, отдельную семисценарную collision matrix и полный набор review/checks без OpenAPI diff.
- [x] Получить independent security/API verdict `ACCEPTED`, закрыть `BLOCK-G21C-001` и зафиксировать implementation commit `7acc58c3eaaa84de3a637a94202f5f7e34a04612`.
- [x] Закрыть `TASK-002 rev 1` как `CLOSED / ACCEPTED`, синхронизировать `LIN-003`/lifecycle до `SYNCED` и Gate 2.1C remediation до `CLOSED / ACCEPTED` без push/PR и без изменения Gate 2/Stage 6.

## Завершено — Gate 2.2C

- [x] Восстановить [[project-state]] и [[gate-2-2c-remediation|TASK-001 rev 1]], не меняя существующий Gate 2.2C diff.
- [x] Создать `TASK-001 rev 2 / LIN-002` и выполнить narrow remediation F-002–F-004 без изменения frozen history.
- [x] Доказать `REQ-201`–`REQ-206` focused/unit/OpenAPI/static/diff и semantic gates.
- [x] Получить независимый финальный re-review с verdict `ACCEPTED`; открытых findings нет.
- [x] Получить ручную приёмку Gate 2.2C от пользователя 2026-08-06.
- [x] Зафиксировать принятый scope commit `2ab56fcde3dc5ce88ebae9a9709f55b4ae7b72f0` и синхронизировать task-card до `SYNCED` без push/PR.

## Осталось в этапе 6

### В работе — canonical CI documentation audit remediation

- [x] Назначить [[stage-6-ci-documentation-audit-remediation|TASK-003 rev 1 / LIN-004]] для `BLOCK-S6-003` и заморозить exact scope/baseline/checks.
- [x] Добавить repository-owned `scripts/audit_docs.py` без новых dependencies.
- [x] Обновить canonical [[quality-gates]] и CI на `python scripts/audit_docs.py --root . --fail-on-warning`.
- [x] Выполнить local strict audit/static/regression checks.
- [ ] Зафиксировать remediation commit и передать exact SHA в independent review/hosted CI.
- [ ] Не закрывать remediation, Gate 2 или Stage 6 без independent review, exact hosted CI PASS и остальных closure criteria.

- [ ] Выполнить опубликованный GitHub Actions run на PostgreSQL 18.1.
- [ ] Подтвердить Docker image build и container readiness smoke.
- [ ] После успешного publication CI отдельно решить вопрос окончательного закрытия Gate 1.
- [ ] Получить и записать отдельную manual acceptance обязательных Gate 2.1 и Gate 2.2A/B, затем отдельно решить закрытие Gate 2.
- [ ] Сохранить PostgreSQL 18.1 independent verification Stage 6 как `GAP`, пока она фактически не выполнена.
- [ ] Не закрывать Stage 6 до закрытия Gate 1 и Gate 2 и выполнения publication runtime criteria.
- [ ] Не начинать Stage 7 в рамках controlled closure Stage 6.

## Icebox — после MVP

- [ ] Отклонение БТК и цикл доработки.
- [ ] Спор по норме и версионность нормы.
- [ ] Повторный выпуск карточек.
- [ ] Ретроактивные карточки.
- [ ] Уведомления и расширенная аналитика.

## Выполненные улучшения процесса

- [x] Создать skill `project-docs-auditor` на основе [[document-governance]].
