---
artifact_id: ux.wireframes
status: accepted
version: 4
owner: ux
updated: 2026-07-17
---

# Wireframes

Текстовые low-fidelity wireframes фиксируют новую предметную модель и служат спецификацией для отдельного [кликабельного прототипа](prototype.html). Сам текстовый документ не подменяет интерактивный артефакт.

## Общая сетка

- desktop: header, container до 1200 px, 12 columns; mobile: одна column и sticky primary action;
- status, operation scope и business context видимы без вкладок;
- internal UUID — secondary metadata с copy control, а не пользовательский заголовок;
- запрещены карточочные labels `#01`, «3 из 112» и ranges деталей;
- protected data не загружается для роли без доступа.

## W-00. Global shell

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ WorkCard Lifecycle       Партии                Demo: Михаил · MASTER   [⌄] │
├──────────────────────────────────────────────────────────────────────────────┤
│ Партии / B-112 / Операции 010–030 / Рабочая карточка                        │
│ [уведомление: success / validation / conflict]                              │
├──────────────────────────────────────────────────────────────────────────────┤
│                           route content                                     │
└──────────────────────────────────────────────────────────────────────────────┘
```

Breadcrumb не использует номер экземпляра. Полный UUID доступен внутри details.

## W-01. Список партий `S-01`

```text
┌ Партии ─────────────────────────────────────────────── [Создать партию] ┐
│ [Поиск ID/паспорт____] [Выпуск: Все⌄] [Обновить]                      │
│                                                                         │
│ Batch   Паспорт              Quantity  Sets  Cards total  Выпуск       │
│ B-112   PP-DEMO · rev A           112     3          250  Выпущена     │
│ B-108   PP-DEMO · rev A            80     —            —  Не выпущена  │
└─────────────────────────────────────────────────────────────────────────┘
```

Один норматив партии отсутствует. Row opens `S-03`; create доступен только `PLANNER`.

## W-02. Новая партия `S-02`

```text
┌ Новая производственная партия ─────────────────────────────────────────┐
│ Подготовленный паспорт *                                                │
│ [PP-DEMO · rev A · Синтетическое изделие________________________⌄]      │
│                                                                         │
│ Preview (read-only)                                                     │
│ • Операции 010–030 · норма 0.80 ч · planned cards = batch quantity     │
│ • Операции 040–060 · норма 1.25 ч · planned cards = batch quantity     │
│ • Операция 070      · норма 0.45 ч · demo planned cards = 26           │
│                                                                         │
│ Количество партии * [112____________]                                   │
│ Маршрут и нормы подготовлены технологом/БТБ и здесь не редактируются.  │
│                                          [Отмена] [Создать партию]      │
└─────────────────────────────────────────────────────────────────────────┘
```

Operation names и нормы — синтетический fixture. `PLANNER` не получает editable route/norm fields.

## W-03. Партия `S-03`

```text
┌ Партия B-112          [Не выпущена]              [Выпустить карточки] ┐
│ Quantity: 112 · Passport PP-DEMO rev A · Version 1                    │
├────────────────────────────────────────────────────────────────────────┤
│ План комплектов                                                        │
│ Operation scope       Norm       Planned cards       First article     │
│ Операции 010–030      0.80 ч              112        required          │
│ Операции 040–060      1.25 ч              112        required          │
│ Операция 070          0.45 ч               26        required          │
│                                         Total: 250                     │
├────────────────────────────────────────────────────────────────────────┤
│ Один выпуск создаст 3 комплекта и 250 карточек.                        │
│ Каждая карточка получит batchQuantitySnapshot = 112, без номера детали.│
└────────────────────────────────────────────────────────────────────────┘
```

После выпуска table rows become links to each set; actual counts must match `112/112/26`, total `250`. Repeat control disappears.

### Release confirmation

```text
┌ Выпустить все комплекты? ──────────────────────────────────────────┐
│ Будут атомарно созданы 3 комплекта и 250 карточек.                 │
│ Повторный выпуск недоступен. Карточки не нумеруют детали.          │
│                                         [Отмена] [Выпустить]       │
└─────────────────────────────────────────────────────────────────────┘
```

### Готовность и отдельная финальная приёмка

```text
┌ Партия B-112                 [Готова к финальной приёмке] ┐
│ First-article gates                         3 / 3         │
│ Обязательные WorkCard CLOSED              250 / 250       │
│ FinalBatchAcceptance                      Ещё нет          │
│ Batch version                             7                │
│                         [Принять завершённую партию]       │
└─────────────────────────────────────────────────────────────┘
```

Action принадлежит только `QUALITY_CONTROLLER` и появляется при полном completion predicate. Закрытие последней карточки само не меняет batch на accepted.

```text
┌ Партия B-112                         [FINAL_ACCEPTED] ┐
│ FinalBatchAcceptance ID   FBA-8d31…                   │
│ Принял                    Ольга · QUALITY_CONTROLLER  │
│ Время                     17.07.2026 12:04 UTC        │
│ Physical signature        Не хранится                 │
└────────────────────────────────────────────────────────┘
```

## W-04. Комплект и assignment `S-04`

### Pending first article

```text
┌ Операции 010–030 · Партия B-112         [Ожидается первая деталь] ┐
│ Norm: 0.80 ч · Planned cards: 112 · Actual: 112 · Batch qty: 112 │
│ Assignment: 0 / 112     [Purpose: First article] [Обновить]      │
├────┬──────────────────┬──────────┬──────────────┬─────────┬────────┤
│ ✓  │ Internal ID      │ Status   │ Assignee     │ Purpose │ Version│
│ □  │ 9f4e… [copy]     │ RELEASED │ —            │ —       │ 1      │
│ □  │ a12c… [copy]     │ RELEASED │ —            │ —       │ 1      │
│ □  │ c807… [copy]     │ RELEASED │ —            │ —       │ 1      │
└────┴──────────────────┴──────────┴──────────────┴─────────┴────────┘
┌ Выбрано: 1                       [Назначить для первой детали] ┐
└────────────────────────────────────────────────────────────────┘
```

UUID fragments exist only to distinguish digital rows and are explicitly labeled technical. They are not card/detail numbers.

### Serial allowed and distribution

```text
┌ Операции 010–030 · Партия B-112        [Серийная работа разрешена] ┐
│ Norm: 0.80 ч · Planned: 112 · Assigned: 112                       │
│ Distribution: Алексей — 60 · Сергей — 52 · Total — 112            │
│ [Status⌄] [Assignee⌄] [Purpose: SERIAL⌄] [Обновить]               │
└─────────────────────────────────────────────────────────────────────┘
```

Не показываются ranges «1–60» и «61–112».

### Assignment panel

```text
┌ Назначить карточки ────────────────────────────────────────────────┐
│ Operation scope: Операции 010–030 · Purpose: SERIAL               │
│ Выбрано: 52 · Исполнитель * [Сергей · WORKER_______________⌄]     │
│ Internal IDs доступны в раскрываемой technical details.           │
│ Все 52 будут назначены либо не изменится ни одна.                  │
│                                      [Отмена] [Назначить 52]       │
└─────────────────────────────────────────────────────────────────────┘
```

## W-05. WorkCard `S-05`

```text
┌ Рабочая карточка                 [COMPLETED] [Подтвердить качество] ┐
│ Операции 010–030 › Комплект CS-A › Партия B-112                   │
│ Internal UUID: 9f4e2b7a-… [copy] · Version 4                      │
├────────────────────────────────┬────────────────────────────────────┤
│ Выполнение                     │ Производственный контекст          │
│ Assignee: Алексей Смирнов      │ Batch quantity snapshot: 112       │
│ Purpose: SERIAL                │ Operation norm snapshot: 0.80 ч    │
│ Начало зафиксировал: мастер    │ First-article gate: SERIAL_ALLOWED │
│ Завершение зафиксировал: мастер│ Physical detail ID: не ведётся     │
├────────────────────────────────┴────────────────────────────────────┤
│ RELEASED ✓ — ASSIGNED ✓ — IN_PROGRESS ✓ — COMPLETED ● — CLOSED ○   │
│ Следующий шаг: synthetic per-card подтверждение БТК.                │
│ Не означает FinalBatchAcceptance всей партии или физическую подпись.│
│ [Audit] [Mock payroll] — только ADMIN_AUDITOR                       │
└─────────────────────────────────────────────────────────────────────┘
```

For `MASTER`, primary action is «Зафиксировать начало/завершение». For first-article `QUALITY_CONTROLLER`, action says «Принять первую деталь и открыть серию»; for serial — «Подтвердить качество и закрыть карточку». Persistent helper text distinguishes this synthetic per-card close from the separate final-batch action on `S-03` and from signatures on physical cards.

## W-06. Audit `S-06`

```text
┌ Audit                            [Context: WorkCard / Operation⌄] ┐
│ Internal UUID 9f4e… · deterministic order                         │
├────┬──────────────────────────────┬──────────────┬───────┬────────┤
│ v1 │ WorkCardReleased             │ Ирина / ПДБ  │ PLAN  │ 10:43  │
│ v2 │ WorkCardAssigned             │ Михаил       │ MSTR  │ 10:47  │
│ v3 │ WorkCardStarted              │ Михаил       │ MSTR  │ 10:51  │
│ v4 │ WorkCardCompleted            │ Михаил       │ MSTR  │ 11:34  │
│ ... [eventId, commandId, correlationId, typed data] ...             │
│ v8 │ FinalBatchAccepted           │ Ольга / БТК   │ QUAL  │ 12:04  │
└─────────────────────────────────────────────────────────────────────┘
```

Operation context must include all batch/set/card events for the correlation. No edit/delete.

## W-07. Mock payroll `S-07`

```text
┌ Mock payroll record PR-…                         [Demo, not payment] ┐
│ WorkCard UUID   9f4e2b7a-…                                         │
│ Beneficiary     Алексей Смирнов                                    │
│ Operation norm  0.80 ч (snapshot)                                  │
│ Exported        17.07.2026 11:52 UTC                               │
│ Money, taxes, actual time and payment are not calculated.          │
└─────────────────────────────────────────────────────────────────────┘
```

## Mobile

- batch/set tables become cards with same semantics;
- filters use bottom sheet; active filters remain visible;
- selection always shows count and operation scope;
- UUID wraps/copies without becoming heading;
- timeline current/next state duplicated as text.

## Accessibility baseline

- commands keyboard-accessible; dialog focus returns to initiator;
- status/gate never use color alone;
- disabled reason is programmatically linked;
- table checkbox accessible name uses operation context + UUID fragment, not a card number;
- assignment result and gate change announced via `aria-live`;
- DOM order matches visual order.

Системные states — [[ui-states]], role variants — [[permission-ux]]. [Clickable prototype](prototype.html) реализует 14-шаговый core sequence и проверяется в desktop/mobile viewport.
