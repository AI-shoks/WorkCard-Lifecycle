---
artifact_id: project.backlog
status: active
version: 10
owner: project
updated: 2026-07-17
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
- [x] Обновить 14 use cases, 20 stories, 40 negative scenarios и 30 acceptance criteria.
- [x] Обновить пять UX-артефактов, README и navigation pages.

## Выполнено — честное закрытие этапа 4

- [x] Создать интерактивный [кликабельный прототип](../ux/prototype.html) core demo sequence.
- [x] Проверить 12 шагов, desktop/mobile layouts, role denial и отсутствие sequence labels в headless Chrome.
- [x] Повторить strict structural audit и semantic pass.
- [x] Вернуть этапу 4 статус «выполнено»; PR #1 оставить draft до отдельного review.

## Далее — этап 5 (не начато)

- [ ] Принять [[technology-stack|технологический стек]].
- [ ] Описать [[system-context|системный контекст и границы frontend/backend]].
- [ ] Подготовить [[er-model]] и [[api-contracts]].
- [ ] В [[api-contracts]] выбрать способ полного аудита массовой операции: отдельный query событий по `correlationId` (предпочтительно для событий разных агрегатов) либо доказуемо полное клиентское сопоставление историй карточек.
- [ ] Зафиксировать [[transactions-concurrency|транзакции и конкурентность]].
- [ ] Спроектировать [[audit-log-design|хранение аудита]] и [[mock-integrations|mock-интеграции]].
- [ ] Принять [[security-baseline]] и необходимые ADR.

Эти задачи начинать только по отдельному указанию после review доменной коррекции. В архитектуре сохранить отдельный server query по `correlationId` как предпочтительный вариант полного аудита массовой операции; UX endpoint не предрешает.

## Icebox — после MVP

- [ ] Отклонение БТК и цикл доработки.
- [ ] Спор по норме и версионность нормы.
- [ ] Повторный выпуск карточек.
- [ ] Ретроактивные карточки.
- [ ] Уведомления и расширенная аналитика.

## Выполненные улучшения процесса

- [x] Создать skill `project-docs-auditor` на основе [[document-governance]].
