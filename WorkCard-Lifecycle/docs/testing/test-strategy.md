---
artifact_id: testing.strategy
status: active
version: 6
owner: quality
updated: 2026-09-27
---

# Test Strategy

Артефакт этапа 9: уровни тестов, критические инварианты, permissions, state machine, миграции, безопасность и производительность.

## Покрытие backend vertical slice

Ниже приведена ранее принятая карта критических критериев финальной приёмки. Test ID обозначает цель трассировки, а не самостоятельный тест или результат запуска; фактическое существующее и новое покрытие описано отдельно после таблицы.

| Test ID | Уровень | Цель |
|---|---|---|
| `T-DOM-FINAL-BATCH-001` | domain | Completion predicate и единственность неизменяемой записи. |
| `T-API-FINAL-BATCH-PREMATURE-001` | integration | Pending gate, неполный комплект или незакрытая WorkCard запрещают команду. |
| `T-API-FINAL-BATCH-IDEMPOTENCY-001` | integration | Replay того же command ID возвращает прежний результат; новый command не создаёт дубль. |
| `T-API-FINAL-BATCH-CONFLICT-001` | integration | Устаревший `expectedVersion` не меняет партию. |
| `T-API-FINAL-BATCH-TXN-001` | integration | Acceptance, партия и audit event фиксируются атомарно. |
| `T-API-FINAL-BATCH-PERMISSION-001` | integration | Команда разрешена только `QUALITY_CONTROLLER`. |
| `T-API-FINAL-BATCH-READ-001` | integration | Read-back неизменяем и не имеет побочного эффекта. |
| `T-API-SECURITY-ORDER` | integration | Session, role и Origin/CSRF выполняются до schema validation; rejected commands не оставляют state/event/receipt. |
| `T-API-E2E-SMALL` | integration | Компактная fixture проходит создание, выпуск, first article, serial lifecycle/quality, final acceptance, payroll и audit/read-back только HTTP-командами. |
| `T-E2E-FINAL-BATCH-001` | browser | Happy path показывает отдельное действие и actor/time/ID после all-closed state. |

Текущий `workflow.integration.test.ts` содержит 6 тестов. Масштабный сценарий проверяет `3 sets / 250 cards / 254 release events`, `60 + 52`, concurrent assignment, replay и полноту audit; перед финальной приёмкой оставшееся массовое CLOSED-состояние в нём готовится owner-SQL и поэтому не объявляется API-only доказательством всех 250 lifecycle-переходов. Отдельный компактный сценарий из двух карточек выполняет каждый заявленный переход через HTTP API, включая final acceptance, payroll и read-back. Остальные проверки покрывают permission/order, CSRF/Origin без side effect, competing final commands, concurrent payroll export и runtime immutable grants. Шестой тест проверяет demo capacity и owner reset mutable данных. Все 37 AC сопоставлены с фактическими тестами и сохранёнными результатами в [[final-audit]]; FA-01/02 закрыты целевыми дополнениями ниже; общая зелёная suite не является доказательством каждой отрицательной ветви каталога. Наличие теста и его успешный запуск фиксируются раздельно.

## Точечное покрытие FA-01/02

`apps/api/src/audit-event.test.ts` проверяет 12 event-specific payload shapes без изменения public response envelope. `quality/audit-invariants.test.ts` использует реальный executor/SQL и инъекции неверного payload/version на границе validator, а также PostgreSQL triggers неправильного increment/stored version и подавленной вставки. В каждом случае сравнивается полный business snapshot. Успешный выпуск проверяет 250 cards, 254 events, действительные workCardSetIds, версии и same-command replay.

`quality/negative-workflow.test.ts` дополняет existing assertions существенными ASG-002/LIF-005/FBA-002/version negatives. Каждая ошибка проверяет HTTP/code и восемь таблиц целиком. FBA fixtures сначала достигают готовности через HTTP, затем отдельное owner-only изменение внутри disposable DB изолирует ровно одно предусловие; SQL assertions подтверждают остальные. Это тестовая подготовка, не обход runtime guard. В `transactions.test.ts` дополнительно подтверждён новый payroll command после export: прежняя record, нулевой event count и только новый receipt.

Фактические PASS 2026-09-27: validator 85/85, targeted PostgreSQL 14/14; дополнительные gates и ограничения — [[quality-gates]]. Для этого исправления браузер/E2E не запускались, предыдущий manual/CI PASS не переносится. Применённые migrations не менялись; новый infrastructure/runtime mechanism вне command service не добавлялся.

## Автоматизация этапа 9

Новые проверки находятся в `quality/`; существующие unit/component и backend integration tests сохраняются. Production SPA собирается обычным `pnpm build`, браузер использует настоящий Fastify API и PostgreSQL, runtime-права и серверную session/CSRF boundary.

| Команда | Покрытие | Граница доказательства |
|---|---|---|
| `pnpm test:quality` | Fault injection всех девяти команд, миграции, permissions/session/CSRF, лимиты и DB lock timeout | Нужен `QUALITY_OWNER_URL`; без него suite падает, не пропускается |
| `pnpm test:browser` | `112 → 3 комплекта по 2 → 6 карточек`, весь lifecycle, отдельная финальная приёмка, audit/payroll/read-back; desktop и mobile | Компактная fixture проверяет все виды переходов и несколько operation-scoped норм, но не объём 250 |
| `pnpm test:browser:canonical` | `112 → 112 + 112 + 26 → 250 CLOSED`; три first-article gates, `1 + 59 + 52` в обоих полных комплектах, все 247 серийных карточек, отдельная финальная приёмка и полный audit 254 | Каждый производственный переход выполняется через UI; отдельный обязательный CI matrix job |
| `pnpm test:performance` | 40 партий, 120 комплектов, 10 000 карточек; выпуск 250, assignment 59, detail и все страницы cards/audit | Измерения HTTP + API + PostgreSQL; не нагрузочная квалификация production и не бизнес-SLA |
| `pnpm security:dependencies`, `pnpm security:secrets` | Все dependency scopes; Git history и текущий исходный код | Срез известных уязвимостей и правил сканера на дату запуска |

`quality/browser/lifecycle.spec.ts` создаёт партию, выпускает комплекты, назначает и проводит карточки, принимает БТК и запускает payroll только через controls SPA. SQL используется для подготовленных справочников и независимого чтения результата под read-only соединением. Технические UUID служат адресами ресурсов внутри теста и не выводятся в производственный UI. Тест сверяет отсутствие финальной приёмки после всех per-card закрытий, её отдельный read-back, полноту audit и единственность payroll после reload. Повторный выпуск disabled, у исполнителя нет lifecycle-команд, закрытый audit route недоступен.

`quality/browser/recovery.spec.ts` открывает один актуальный ресурс в двух вкладках: первая успешная UI-команда делает вторую версию устаревшей, и backend возвращает реальный `409`. Затем сетевой перехват пересылает UI-команду настоящему серверу, дожидается успешного commit и обрывает ответ (`route.fetch` → `route.abort`). Подставленных успешных ответов нет. Проверяются автоматические безопасные чтения карточки/комплекта, отсутствие повторной mutation и ложного success, единственный event/receipt и устойчивость после reload.

`quality/transactions.test.ts` устанавливает PostgreSQL trigger, принудительно отклоняющий audit insert после бизнес-записей. Для всех девяти команд полный снимок восьми бизнес-/audit-/receipt-таблиц до и после отказа совпадает. После удаления trigger тот же command ID успешно выполняется один раз; replay не меняет snapshot. Дополнительно проверяются сбой вставки карточки при выпуске и поздний сбой `UPDATE command_receipts`, когда события уже вставлены в незавершённой транзакции. Справочники и технические session timestamps в бизнес-снимок не входят.

`quality/migrations.test.ts` вызывает существующий migration runner на копиях реальных SQL-файлов и отдельных БД. Проверяются SQL failure и принудительный отказ history insert с откатом DDL/data/history, повтор после исправления, конкурентный запуск под advisory lock, checksum drift, отсутствующий применённый файл, duplicate versions и реальный отказ `0003` на потере точности `numeric`. Отдельный сбой grants после успешного SQL сохраняет прежние права; history уже применённого файла остаётся, повтор после явного исправления fixture не исполняет DDL заново. Новая система миграций не создаётся; каждый файл и grants остаются отдельными транзакциями.

`quality/security.test.ts` проверяет фактические HTTP routes всех ролей до schema/resource validation, закрытые audit/payroll reads, CSRF другой сессии, отсутствующий/недопустимый Origin, поддельную cookie, body spoofing, SQL-shaped input, payload/list limits, rotation/logout/idle/absolute expiry/disabled identity и rate limit с поддельным forwarded IP. `runtime-protection.test.ts` проверяет реальную конфигурацию логирования и отсутствие headers/body/query/driver secrets в response/logs. `quality/budgets.test.ts` проверяет активные PostgreSQL time budgets и rollback заблокированной команды.

## Maintenance и deployment contract

Для перехода [[0009-render-free-neon-free-release|ADR-0009]] обязательны отдельные локальные PostgreSQL проверки non-superuser bootstrap/repeat и privileged role rejection, owner-only state grants, immutable migration checksums, shared/exclusive barrier для read/session/command, auth-reset receipt race, cancellation и 26h fail-closed. Тесты доказывают SQL/code behavior на disposable DB; они не подключаются к Neon и не заменяют hosted qualification.

Config tests требуют direct Neon `verify-full`, expected host/database и отказывают pooler/downgrade/неоднозначным overrides. Runtime pool errors и Render proxy peer/CIDR-chain рассматриваются отдельно от реального network evidence. Release tests сохраняют versioned schemas, scan/checksum/evidence bindings и exact digest contract, добавляя Render status/resolved digest и fixed owner/reset boundaries. Не нужно удалять существующие security, browser compact/canonical, container scan или performance gates.

## Изоляция и воспроизведение

`QUALITY_OWNER_URL` должен явно указывать локальный/CI PostgreSQL. Host guard не ослабляется для Neon; hosted release использует отдельный явный owner CLI и target contract. `quality/database.ts` создаёт случайные `q9_*` БД и отдельные runtime-роли, выполняет миграции и удаляет только созданные этим вызовом ресурсы в `finally`. Системные и demo-БД не выбираются по умолчанию; тесты не используют `DATABASE_URL` приложения как fallback. Для локального Docker используйте отдельный Compose project, порт и `quality/compose.override.yaml`: в основном Compose том имеет явное имя, поэтому одного `-p` недостаточно.

Пример после подготовки отдельного PostgreSQL и задания `QUALITY_OWNER_URL`:

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm test:quality
pnpm exec playwright install chromium
pnpm test:browser
pnpm test:browser:canonical
pnpm test:performance
pnpm security:dependencies
pnpm security:secrets
```

Playwright сохраняет JSON/HTML, screenshots и trace при ошибке. `retries=0`, `forbidOnly=true`, один worker; canonical timeout рассчитан на 750 отдельных UI lifecycle-решений с навигацией и read-back, а не заменяет assertions. Performance сохраняет условия и raw samples в `.quality-results/performance.json`. Фактические результаты и статус закрытия — [[quality-gates]], состав обязательных jobs — [[ci-pipeline]].

Не покрываются production IAM, hosted TLS/secret rotation, внешняя сеть и длительная многопользовательская нагрузка; эти результаты не объявляют завершёнными этапы 10–12. Отрицательная приёмка, переделка и переназначение остаются вне MVP.
