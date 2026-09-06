---
artifact_id: architecture.adr.0004
status: accepted
version: 1
owner: architecture
updated: 2026-09-01
---

# ADR-0004. Command receipts and complete correlation audit query

## Контекст

`commandId` нужен для replay final acceptance и защиты от неопределённого HTTP outcome. `UC-014` требует доказуемо полный audit массовой операции, события которой принадлежат разным агрегатам.

## Варианты

1. Transactional `command_receipts` + server query по `correlationId`.
2. Только unique domain keys без общего receipt.
3. Клиент объединяет истории каждой карточки.
4. Message broker/outbox как источник correlation history.

## Решение

Каждая успешная mutation создаёт receipt с unique `commandId`, trusted actor/type, server `correlationId`, result и ожидаемым числом events. Audit endpoint читает receipt и все events server-side, возвращая authoritative totals и cursor pages.

## Причины

- concurrent replay сериализуется unique insert;
- сохранённый result отвечает на transport uncertainty без нового side effect;
- expected/actual event counts обнаруживают нарушение целостности;
- один server query охватывает batch/set/card events и не зависит от клиентского merge;
- broker не нужен для локальной transactional history.

## Последствия

- command ID нельзя повторно использовать для другого type/actor;
- failed command не коммитит receipt;
- response body receipt должен быть versioned вместе с API schema;
- event pagination считается полной только по `nextCursor` и totals;
- future outbox будет отдельным решением, а не скрытой частью receipt.
