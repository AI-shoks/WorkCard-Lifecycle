---
artifact_id: ux.user-flows
status: accepted
version: 4
owner: ux
updated: 2026-07-17
---

# User Flows

Потоки браузерного MVP v1. Backend проверяет roles, purpose, gate, state и versions; клиент не заявляет optimistic success.

## Core demo sequence

`UC-001 → UC-002 → UC-003(first article) → UC-004 → UC-005 → UC-003(serial) → UC-004 → UC-006 → UC-015 → UC-009`.

```mermaid
flowchart LR
    P1["ПДБ: выбрать паспорт и создать batch 112"] --> P2["ПДБ: выпустить 3 sets / 250 cards"]
    P2 --> M1["MASTER: назначить first-article card"]
    M1 --> M2["MASTER: start + complete"]
    M2 --> Q1["БТК: accept first article"]
    Q1 --> M3["MASTER: serial assignment 60 + 52"]
    M3 --> M4["MASTER: start + complete serial card"]
    M4 --> Q2["БТК: synthetic per-card close"]
    Q2 --> Q3["БТК: принять all-closed партию"]
    Q3 --> A1["ADMIN: mock export"]
```

`UC-007` дополнительно проверяет provenance: per-card close не записывает финальную приёмку, а `UC-015` создаёт её только отдельной командой. `UC-008`, `UC-010`–`UC-014` дают остальные supporting-сценарии.

## F-01. Создание партии

**Связи:** `UC-001`, `US-001`, `AC-BAT-001`.

1. `PLANNER` открывает `S-02`.
2. Выбирает подготовленный паспорт; UI показывает read-only operation plan и нормы.
3. Вводит quantity `112`; полей route/norm нет.
4. После backend success открывается `S-03`, version `1`, статус «Не выпущена».
5. Validation сохраняет выбор/quantity и связывает errors с полями.

## F-02. Атомарный выпуск

**Связи:** `UC-002`, `UC-011`, `AC-BAT-002`, `AC-BAT-003`.

1. `S-03` показывает preview: три комплекта `112`, `112`, `26`, total `250`.
2. `PLANNER` подтверждает однократность выпуска.
3. Команда отправляется с batch version.
4. При успехе UI после refresh показывает все sets, norms, gates и total `250`; sequence/range отсутствуют.
5. Частичный ответ — integrity error, не success.

## F-03. First-article и serial assignment

**Связи:** `UC-003`, `US-003`, `AC-ASG-001`–`003`.

### First article

1. `MASTER` открывает set `FIRST_ARTICLE_PENDING`.
2. Выбирает ровно одну `RELEASED` карточку по row selection; visible label использует operation context, не номер детали.
3. В assignment panel purpose фиксирован как «Первая деталь»; выбирается `WORKER`.
4. Success регистрирует first-article UUID и `ASSIGNED`.

### Serial

1. До `SERIAL_ALLOWED` serial controls недоступны с причиной.
2. После acceptance master выбирает serial cards и одного assignee; каждая команда атомарна.
3. Для fixture first-article assignee уже имеет `1`; master назначает ему ещё `59`, второму — `52`.
4. Summary показывает `Алексей — 60; Сергей — 52; всего 112`, не ranges `1–60`/`61–112`.
5. Error любой карточки оставляет весь текущий набор без изменения.

```mermaid
flowchart TD
    gate{"Gate"} -->|Pending| pilot["Выбрать ровно одну first-article card"]
    gate -->|Serial allowed| bulk["Выбрать serial cards одного set"]
    pilot --> assign["AssignWorkCards + set/card versions"]
    bulk --> assign
    assign --> result{"Весь набор принят?"}
    result -->|Да| refresh["Refresh set, cards, summary"]
    result -->|Нет| unchanged["No optimistic changes"]
```

## F-04. Ведение карточки мастером

**Связи:** `UC-004`, `US-004`, `US-005`, `AC-LIF-001`, `AC-LIF-002`, `AC-AUT-002`.

1. `MASTER` открывает `ASSIGNED` карточку на `S-05` и видит assignee.
2. «Зафиксировать начало» вызывает `StartWorkCard`; status становится `IN_PROGRESS` после refresh.
3. «Зафиксировать завершение» вызывает `CompleteWorkCard`; status становится `COMPLETED`.
4. `WORKER` видит назначение read-only и не видит эти controls.
5. Экран явно различает «исполнитель» и «зафиксировал мастер».

## F-05. `FirstPieceAcceptance`

**Связи:** `UC-005`, `US-006`, `AC-LIF-003`, `AC-LIF-005`.

1. БТК открывает зарегистрированную first-article карточку `COMPLETED`.
2. Диалог сообщает: карточка закроется, serial gate комплекта откроется одной операцией.
3. Success refreshes card (`CLOSED`) and set (`SERIAL_ALLOWED`).
4. Отрицательных actions, rework и повторной acceptance нет.

## F-06. Синтетическое per-card serial quality

**Связи:** `UC-006`, `US-007`, `AC-LIF-004`, `AC-LIF-005`.

1. БТК открывает serial-карточку `COMPLETED` в открытом gate.
2. «Подтвердить качество и закрыть» вызывает positive-only command.
3. Success показывает `CLOSED` только для этой WorkCard; lifecycle controls исчезают.
4. Постоянная provenance-подсказка сообщает: `FinalBatchAcceptance` всей завершённой партии и подписи БТК на физических карточках подтверждены AS-IS, но этим действием не записываются.

## F-07. Отдельная финальная приёмка партии

**Связи:** `UC-015`, `US-021`, `AC-FBA-001`–`007`.

1. БТК открывает `S-03`; UI раздельно показывает `first-article gates: 3/3`, `closed cards: 250/250`, `FinalBatchAcceptance: ещё нет`.
2. До выполнения любого условия action disabled с точной причиной; другие роли его не видят.
3. «Принять завершённую партию» вызывает `RecordFinalBatchAcceptance` с batch version и явным confirmation.
4. Success refreshes batch и показывает `FINAL_ACCEPTED`, `acceptanceId`, актора и время; физическая подпись не показывается.
5. Replay того же command ID показывает существующую запись без нового success; новый command недоступен.

## F-08. Mock payroll

1. `ADMIN_AUDITOR` открывает `CLOSED` карточку.
2. Первый export создаёт запись operation-scoped нормы и открывает `S-07`.
3. Повтор/существующая запись открывает ту же `S-07` без сообщения о новом начислении.
4. Money, taxes, actual time, edit/delete отсутствуют.

## F-09. Audit и correlation

1. `ADMIN_AUDITOR` открывает историю карточки.
2. События показываются по versions/time; technical envelope раскрывается по запросу.
3. Correlation context показывает полный набор выпуска, assignment или first-article acceptance, включая batch/set/card aggregates.
4. UX фиксирует потребность, но не endpoint.

## F-10. Conflict recovery

```mermaid
flowchart TD
    submit["Submit expected versions"] --> conflict{"Conflict?"}
    conflict -->|Нет| success["Refresh confirmed result"]
    conflict -->|Да| preserve["No success / no auto retry"]
    preserve --> reload["Explicit reload all targets"]
    reload --> allowed{"Action still allowed?"}
    allowed -->|Да| confirm["New explicit command"]
    allowed -->|Нет| explain["Hide control, explain current gate/state"]
```

Assignment очищает selection после refresh; first-article acceptance перечитывает и card, и set. «Force overwrite» отсутствует.

## F-11. Role switch

Выбор подготовленной identity обновляет shell, route data и permissions. Command dialogs/selections очищаются. Если route защищён, показывается access state. Предметные данные не меняются.

## Общие правила команд

- подтверждение требуется для release, assignment, first-piece acceptance, synthetic per-card quality, final-batch acceptance и первого export;
- submit блокируется до ответа;
- success отображается только после backend response и refresh;
- клиент не меняет status/gate оптимистически;
- network uncertainty требует read before retry;
- UUID доступен для copy/debug, но никогда не оформляется как номер детали.

Состояния описывает [[ui-states]], permissions — [[permission-ux]]. [Кликабельный прототип](prototype.html) проходит эти flow за 14 шагов и демонстрирует role-aware controls.
