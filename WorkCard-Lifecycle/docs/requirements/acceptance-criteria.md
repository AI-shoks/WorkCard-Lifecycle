---
artifact_id: requirements.acceptance-criteria
status: accepted
version: 6
owner: requirements
updated: 2026-09-02
---

# Acceptance Criteria

37 объективных критериев MVP v1. Если не указано обратное, отказ выполняет единый постконтракт [[negative-scenarios]].

## Партия и выпуск

### AC-BAT-001. Создание партии по паспорту

**Given** доверенный `PLANNER` выбирает существующий подготовленный паспорт и вводит положительный `quantity`
**When** выполняется `CreateProductionBatch`
**Then** создаётся невыпущенная партия версии `1` со снимком паспорта и `ProductionBatchCreated`
**And** партия не содержит одного `normHours`.

**And Given** паспорт отсутствует/невалиден или quantity неверен
**When** команда выполняется
**Then** партия и событие не создаются.

### AC-BAT-002. Полный выпуск нескольких комплектов

**Given** невыпущенная партия актуальной версии имеет `quantity = 112`, а снимок паспорта задаёт три operation scopes с planned counts `112`, `112`, `26`
**When** `PLANNER` выполняет `ReleaseWorkCards`
**Then** одна транзакция создаёт три `WorkCardSet` с собственными operation/norm snapshots и gate `FIRST_ARTICLE_PENDING`
**And** создаёт `250` карточек `RELEASED` с уникальными внутренними UUID и `batchQuantitySnapshot = 112`
**And** ни одна карточка не содержит `sequenceNumber`, номера детали или позиции `n из 112`
**And** партия увеличивает версию на один и сохранён полный набор событий.

### AC-BAT-003. Запрет повторного выпуска

**Given** партия уже выпущена
**When** запрошен второй `ReleaseWorkCards`
**Then** новые комплекты, карточки и события не создаются, существующие данные не меняются.

## Назначение

### AC-ASG-001. First article и распределение `60 + 52`

**Given** комплект `FIRST_ARTICLE_PENDING` содержит `112` неназначенных карточек
**When** `MASTER` назначает одну карточку исполнителю A с purpose `FIRST_ARTICLE`
**Then** атомарно регистрируется first-article UUID, карточка становится `ASSIGNED`, версия комплекта и карточки увеличивается на один.

**And Given** эта карточка положительно принята и gate стал `SERIAL_ALLOWED`
**When** мастер назначает ещё `59` карточек исполнителю A и отдельной атомарной командой `52` карточки исполнителю B
**Then** assignment summary равен `60 + 52 = 112`
**And** распределение выражено counts, а не диапазонами номеров деталей.

### AC-ASG-002. Отказ всего набора

**Given** набор пуст/дублируется/смешивает комплекты, assignee невалиден, карточка не `RELEASED`, версия устарела или serial gate закрыт
**When** выполняется `AssignWorkCards`
**Then** ни комплект, ни одна карточка не изменяются и события назначения не создаются.

### AC-ASG-003. Неизменяемость назначения

**Given** карточка уже назначена и имеет purpose
**When** клиент пытается переназначить, снять назначение или изменить purpose
**Then** действие отсутствует/отклонено, исходные assignee и purpose сохранены.

## Жизненный цикл и first-article gate

### AC-LIF-001. Начало фиксирует мастер

**Given** карточка `ASSIGNED`, доверенный актор `MASTER`, версия актуальна и gate соответствует purpose
**When** выполняется `StartWorkCard`
**Then** карточка становится `IN_PROGRESS`, сохраняет assignee и `recordedByMasterId`, увеличивает версию на один и получает `WorkCardStarted`.

### AC-LIF-002. Завершение фиксирует мастер

**Given** карточка `IN_PROGRESS`, доверенный `MASTER` и актуальная версия
**When** выполняется `CompleteWorkCard`
**Then** карточка становится `COMPLETED`, сохраняет assignee/мастера/время, увеличивает версию на один и получает `WorkCardCompleted`.

### AC-LIF-003. Положительная приёмка первой детали

**Given** зарегистрированная first-article карточка `COMPLETED`, комплект `FIRST_ARTICLE_PENDING`, доверенный БТК и актуальные версии обоих агрегатов
**When** выполняется `AcceptFirstArticle`
**Then** карточка атомарно становится `CLOSED`, комплект — `SERIAL_ALLOWED`
**And** версии обоих агрегатов увеличиваются на один
**And** создаются `WorkCardQualityConfirmed(acceptanceType: FIRST_ARTICLE)` и `FirstArticleAccepted` с общими command/correlation IDs.

### AC-LIF-004. Синтетическое per-card serial quality

**Given** serial-карточка `COMPLETED`, комплект `SERIAL_ALLOWED`, доверенный БТК и актуальная версия
**When** выполняется `ConfirmWorkCardQuality`
**Then** только эта карточка атомарно становится `CLOSED`, версия увеличивается на один и создаётся `WorkCardQualityConfirmed(confirmationScope: WORK_CARD, acceptanceType: SERIAL)`
**And** система не создаёт `FinalBatchAcceptance`, финальную приёмку партии или цифровую подпись БТК.

### AC-LIF-005. Терминальность и граница контроля

**Given** карточка `CLOSED` или first-article gate уже открыт
**When** запрошено повторное lifecycle/acceptance действие
**Then** изменение и событие отсутствуют.

**And Given** запрошены отрицательная приёмка, отклонение, возврат, отдельное закрытие или `REWORK_REQUIRED`
**Then** действие отсутствует/отклонено.

## Финальная приёмка партии

### AC-FBA-001. Положительная финальная приёмка завершённой партии

**Given** выпущенная партия актуальной версии имеет все обязательные `WorkCardSet` в `SERIAL_ALLOWED`, полный `plannedCardCount`, только `CLOSED` WorkCard и ещё не имеет `FinalBatchAcceptance`
**And** доверенный актор — `QUALITY_CONTROLLER`
**When** выполняется `RecordFinalBatchAcceptance`
**Then** одна транзакция создаёт ровно одну неизменяемую `FinalBatchAcceptance`, связывает её с партией, переводит партию в `FINAL_ACCEPTED` и увеличивает её версию на один
**And** создаётся `FinalBatchAccepted` с общими `commandId`/`correlationId` и результирующей версией партии
**And** запись не содержит и не заменяет физическую подпись БТК.

### AC-FBA-002. Запрет преждевременной приёмки

**Given** хотя бы один обязательный комплект не `SERIAL_ALLOWED`, число карточек не равно `plannedCardCount` или хотя бы одна необходимая WorkCard не `CLOSED`
**When** `QUALITY_CONTROLLER` вызывает `RecordFinalBatchAcceptance`
**Then** запись, связь, статус/версия партии и событие не создаются
**And** UI объясняет невыполненные предусловия, не предлагая обход.

### AC-FBA-003. Повторная команда и единственность записи

**Given** финальная приёмка партии уже успешно записана
**When** повторяется тот же `commandId`
**Then** возвращается та же `FinalBatchAcceptance` без новой записи, версии или события.

**And When** новая команда с другим `commandId` пытается принять ту же партию
**Then** она отклоняется как терминальный конфликт, а уникальность `batchId` сохраняет одну запись.

### AC-FBA-004. Version conflict

**Given** `expectedVersion` партии устарела
**When** выполняется `RecordFinalBatchAcceptance`
**Then** команда отклоняется без записи, версии и события
**And** клиент перечитывает партию, completion summary и существующую acceptance перед новой явной попыткой.

### AC-FBA-005. Транзакционная согласованность

**Given** успешная финальная приёмка должна сохранить `FinalBatchAcceptance`, ссылку/статус/версию партии и `FinalBatchAccepted`
**When** любой компонент не сохраняется
**Then** откатывается вся операция; ни read model, ни audit не показывают частичный успех.

### AC-FBA-006. Только `QUALITY_CONTROLLER`

**Given** доверенная роль отличается от `QUALITY_CONTROLLER`, даже если клиент подменил actor/role или показал control вручную
**When** вызывается `RecordFinalBatchAcceptance`
**Then** backend отклоняет команду без предметного изменения и события успеха.

### AC-FBA-007. Read-back финальной приёмки

**Given** существует `FinalBatchAcceptance`
**When** разрешённая demo-роль читает партию или `GetFinalBatchAcceptance`
**Then** возвращаются `acceptanceId`, `batchId`, `controllerId`, `acceptedAt`, исходный `commandId` и результирующая версия партии
**And** карточки остаются отдельными записями, а поле физической подписи отсутствует
**And** чтение не создаёт новую запись, версию или событие.

## Авторизация и чтение

### AC-AUT-001. Backend как граница

**Given** UI показал control или клиент сформировал команду вручную
**When** доверенная роль не разрешена
**Then** backend отклоняет команду без эффекта, а role/actor из тела не повышают полномочия.

### AC-AUT-002. Мастер ведёт lifecycle

**Given** назначенный `WORKER` или любая роль кроме `MASTER`
**When** она вызывает `StartWorkCard` или `CompleteWorkCard`
**Then** backend отклоняет команду даже при допустимых state/version
**And** `MASTER.actorId` не обязан совпадать с assignee, потому что мастер фиксирует работу исполнителя.

### AC-AUT-003. Защита audit/payroll

**Given** роль отличается от `ADMIN_AUDITOR`
**When** запрошены audit history или `PayrollRecord`
**Then** данные не возвращаются, а существование объекта не раскрывается сверх безопасного API.

### AC-READ-001. Чтение без эффекта

**Given** идентифицированная demo-роль
**When** она читает паспорта, партии, комплекты или разрешённые карточки
**Then** возвращаются данные согласно матрице чтения, версии/audit не меняются.

### AC-DEM-001. Безопасный role switch

**Given** участник выбирает подготовленную demo-личность
**When** меняется доверенный session context
**Then** permissions перечитываются, предметные данные/версии/audit не меняются, неизвестная роль не активируется.

### AC-READ-002. Происхождение без ложной трассировки

**Given** fixture-партия успешно выпущена
**When** demo-роль читает её структуру
**Then** видны `112 → sets(112,112,26) → total 250`, operation scope и норма каждого комплекта
**And** каждая карточка показывает `batchQuantitySnapshot = 112` и технический UUID как secondary metadata
**And** sequence, `#01`, `3 из 112` и утверждение о физической детали отсутствуют
**And** первый полный комплект показывает assignment summary `60 + 52 = 112`
**And** provenance явно показывает: первая и финальная приёмки с физическими подписями — подтверждённые AS-IS факты, а digital `FinalBatchAcceptance` и `WorkCardQualityConfirmation` — отдельные синтетические TO-BE-записи без оцифровки подписи
**And** ни одна или все `CLOSED` WorkCard не выдаются за записанную финальную приёмку партии.

### AC-READ-003. Чтение payroll без export

**Given** существует `PayrollRecord`
**When** `ADMIN_AUDITOR` читает её
**Then** возвращаются ID, workCard, beneficiary, operation-scoped norm snapshot и время, без новых записей/событий/версий.

## Конкурентность, транзакции и аудит

### AC-CON-001. Явный conflict

**Given** версия любого изменяемого агрегата отличается от expected
**When** выполняется команда
**Then** вся команда отклоняется без эффекта и клиент должен перечитать все затронутые агрегаты.

### AC-CON-002. Осознанное восстановление

**Given** команда отклонена по `AC-CON-001`
**When** клиент перечитывает данные
**Then** получает актуальные state/gate/versions, повтор со старыми версиями снова отклоняется, а новая команда требует новой явной проверки/подтверждения.

### AC-TXN-001. Атомарность

**Given** любая изменяющая команда, включая создание партии, выпуск, assignment, first-article acceptance и final-batch acceptance
**When** любая предметная запись или событие не сохраняется
**Then** откатывается вся операция; частичный набор и состояние без события не наблюдаются.

### AC-AUD-001. Полнота и порядок истории

**Given** агрегат прошёл успешные команды
**When** `ADMIN_AUDITOR` читает историю
**Then** каждое событие содержит уникальный ID, type, UTC time, aggregate/version, actor/role, commandId, correlationId и typed data
**And** история одного агрегата упорядочена по версии и времени.

### AC-AUD-002. Неизменяемость и семантика успеха

**Given** audit events сохранены
**When** выполняются команды или отказы
**Then** события не редактируются/не удаляются, а отказ не появляется как событие успеха.

### AC-AUD-003. Корреляция массовой операции

**Given** выпуск, массовое assignment или first-article acceptance успешны
**When** аудитор открывает operation context
**Then** полный набор событий всех агрегатов имеет общий correlationId и исходный commandId и покрывает весь результат; неуспех не оставляет части набора.

### AC-AUD-004. Валидность события и версии

**Given** успешная изменяющая команда должна сохранить события
**When** формируется транзакция
**Then** event IDs уникальны, обязательные поля заполнены, aggregateVersion равна версии после изменения, каждая изменённая версия увеличена ровно на один; нарушение откатывает всё.

## Mock payroll

### AC-PAY-001. Первый export

**Given** карточка `CLOSED`, имеет assignee, актуальную версию и не экспортировалась
**When** `ADMIN_AUDITOR` выполняет export
**Then** создаётся одна `PayrollRecord` с beneficiary и operation-scoped `normHoursSnapshot`, одно событие, а status карточки не меняется.

### AC-PAY-002. Идемпотентный повтор

**Given** запись уже существует
**When** export повторяется
**Then** возвращается та же запись без второй записи и события.

### AC-PAY-003. Граница export

**Given** карточка не `CLOSED`, без assignee или роль неверна
**When** запрошен export
**Then** запись/событие не создаются.

**And Given** export успешен
**Then** результат — только demo-норма, не деньги, налоги, фактическое время или реальная интеграция.

### AC-PAY-004. Конкурентный первый export

**Given** записи ещё нет
**When** два admin-а конкурентно запускают первый export
**Then** сохраняются ровно одна запись и одно событие, второй результат ссылается на ту же запись.

### AC-PAY-005. Целостность payroll

**Given** первый export успешен
**Then** beneficiary совпадает с assignee, норма — со snapshot карточки/комплекта, а ID/workCard/beneficiary/norm неизменяемы.

## Критерий покрытия

Каждая команда из [[commands-events]] имеет позитивный criterion, role denial, version conflict и применимый data/state/gate denial. Полная цепочка — в [[requirements-traceability]].
