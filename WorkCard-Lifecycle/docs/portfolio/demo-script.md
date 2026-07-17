---
artifact_id: portfolio.demo-script
status: planned
version: 0
owner: portfolio
updated: 2026-07-17
---

# Demo Script

Артефакт этапа 11. Сценарий будет проходить happy path MVP v1 без отклонения БТК и цикла доработки.

## Черновой маршрут

Создание партии → выпуск нескольких комплектов → first-article assignment и приёмка → serial assignment `60 + 52` → master start/complete → synthetic per-card close → подготовленное `250/250 CLOSED` состояние → отдельная `RecordFinalBatchAcceptance` с actor/time/ID → mock payroll export → audit log → демонстрация защиты от повторов.
