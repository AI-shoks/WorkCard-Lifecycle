---
artifact_id: project.final-audit
status: active
version: 12
owner: project
updated: 2026-10-01
---

# Финальный аудит — этап 12

**Этап 12 завершён 1 октября 2026 года для обновлённого независимого портфолио-кейса.** Публичный сервис использует image приложения `a5d6302b7793055ad37883d394de04fd20afaea0` после [CI 7/7](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/36867881849), [release](https://github.com/AI-shoks/WorkCard-Lifecycle/releases/tag/work-card-a5d6302b7793055ad37883d394de04fd20afaea0) и [staging/public deployment](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/36901516374). Фактические результаты и ограничения — [[deployment#Обновление демо 2026-09-29]].

## Итог D-034 — 2026-10-01

Таблица 22 пунктов ниже сохраняет историческую оценку D-032 для другого исходного SHA на 28–29 сентября. Для выбранной новой версии пункты 9–19 подтверждены CI приложения, full staging и публичным browser lifecycle; пункт 20 — готовностью Neon/Render, HTTP health, public smoke и корреляцией 49/49 request IDs с application logs в [deploy 36901516374](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/36901516374); пункт 21 — обновлёнными README, схемой, demo script и явными ограничениями; пункт 22 — этим итоговым аудитом и закрытыми [[project-plan|планом]]/[[backlog|backlog]]. Таким образом, **22/22 пунктов DoD выполнены в области синтетического MVP и портфолио-кейса**; это не утверждение о заводском внедрении или промышленном SLA.

FA-05 остаётся непроверенным rollback drill: сохранённый совместимый предыдущий image и план возврата не заменяют реального испытания. Четыре moderate advisory, Free-квоты и возможный сон сервиса, общая синтетическая БД, ежедневный reset и ещё не наблюдавшийся scheduled reset нового image — действующие ограничения. Документационные коммиты после размещения не меняют SHA приложения.

Локальные проверки FA-01/02, узкий UI-smoke агента, сообщение пользователя от 27 сентября без SHA/окружения, новый CI точного commit и исторический hosted runtime учитываются раздельно. Новый CI квалифицирует исходники в CI-среде. Read-only HTTP/БД проверка 29 сентября подтвердила доступность прежнего hosted source; новый image ещё не размещён.

## Обновление после PR #17 — 2026-09-29

[PR #17](https://github.com/AI-shoks/WorkCard-Lifecycle/pull/17) объединён с main `bdb2647520639b9ca690dfd6d00402076463a63a`; собственный [push CI 36544788733](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/36544788733) прошёл 7/7. Сохранены recovery workflow, helpers и browser harness из main, исправления журнала FA-01/02 и минимальное обновление `fast-uri`. Прежний CI `2d4609ad…` остаётся отдельным историческим результатом.

Новая цель D-034 требует штатного обновления существующего демо. [Release 36597671054](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/36597671054) успешен; source/image и восстановление зафиксированы в [[deployment#Обновление демо 2026-09-29]]. Preflight ещё не завершён: нужны актуальные workspace billing/usage Render и plan/quotas Neon. Staging и production qualification нового image не выполнялись. DoD № 20 для новой версии и № 22 остаются незакрытыми.

Разделы ниже сохраняют исходную трассировку C/D/H и решения своих дат; они не подменяют release qualification нового main.

## Объект и границы первоначального аудита

- Источник: Git root — родитель каталога `WorkCard-Lifecycle`; HEAD `4e813f5a9641abe3068d1dfc544399d557028316`, ветка `codex/card-set-browser-lanes`; прежние изменения сохранены.
- Кандидат: изолированный checkout, ветка `codex/fa-03-ci-candidate`, HEAD `2d4609ad0188a0ec2e77ef1065195971aa14c455`, parent `4e813f5a9641abe3068d1dfc544399d557028316`, tree `2c5169a7d61c38536a5e9e14b36a13a363064208`. Опубликованная дельта: 51 файл, +2463/−318. На входе checkout чист; новый документационный diff оставлен unstaged и не входит в CI commit.
- В первоначальном аудите рабочее дерево источника уже содержало правки документации, исторического Terraform и untracked материалы портфолио/release; основанием того diff был снимок до аудита. Они сохранены. Настоящий документационный diff построен отдельно поверх чистого HEAD кандидата, с контрольным снимком до правок.
- Последний документированный hosted runtime: source SHA `1195892f15f2f240dd04f39e8388d6bb8802d9a7`, image digest `sha256:231d91a73a72275cefa0bbfe25d316b73315eb1f783d5618ebf55019a39ff057`; [manifest](../release/manifests/1195892f15f2f240dd04f39e8388d6bb8802d9a7.json).
- На начало исходного статического аудита сравнение release source → HEAD → рабочее дерево не выявило изменений `apps/`, `packages/`, SQL migrations, lockfile и конфигурации сборки приложения. Это было основанием применять сохранённые runtime-результаты к прежнему коду приложения, **не** доказательством зелёного CI checkout: browser harness, release helpers и документы менялись.
- В исходном статическом аудите приложение, контейнеры, браузер, E2E, reset, deployment и облачные операции не запускались. Техническое продолжение ниже использовало только unit/API и новую disposable PostgreSQL; рабочие окружения не сбрасывались. Внешние URL не запрашивались; ссылки на runs сверялись с локально сохранёнными records. Позднее пользователь подтвердил ручную проверку демо; это отдельное свидетельство пользователя, не новый автоматический прогон.

## Трассировка всех 37 acceptance criteria

Исходная цепочка AS-IS → decision → BR → UC → US → AC сохранена в [[requirements-traceability]]. Test ID из проектного каталога — цель покрытия; фактическое покрытие ниже определяется содержимым файлов. Наличие assertions не равно успешному выполнению. Запуски и версии вынесены в следующий раздел.

Обозначения источников: [service](../../apps/api/src/workflow-service.ts), [routes](../../apps/api/src/api-routes.ts), [contracts](../../packages/contracts/src/workflow.ts), [SQL](../../apps/api/migrations/0002_backend-vertical-slice.sql), [API integration](../../apps/api/src/workflow.integration.test.ts), [browser lifecycle](../../quality/browser/lifecycle.spec.ts).

| Критерии | Реализация и фактические тесты | Вывод статической сверки |
|---|---|---|
| AC-BAT-001–003 | `createBatch`, `releaseWorkCards`, contract schemas; API `T-API-BATCH/RELEASE`, lifecycle, [batch UI tests](../../apps/web/src/batch-commands.test.ts) | Снимки, выпуск 3/250 и отказ повторного выпуска реализованы. Масштабный API test проверяет UUID/snapshots/нормы; browser проверяет disabled повторного выпуска. Это не отдельный backend negative test каждого варианта BAT-001/003. |
| AC-ASG-001–003 | `assignWorkCards`, SQL locks, выбор worker; API `T-API-ASSIGN/LIFECYCLE`, [master tests](../../apps/web/src/master-commands.test.ts), lifecycle | Есть атомарный выбор первой детали, 1+59+52, competing assignment и guards. Переназначение отсутствует. FA-02 добавляет полные before/after snapshots при пустом/повторном/смешанном выборе, невалидном assignee, закрытом gate, неверном state и stale set/card version; отдельный тест на каждую строку каталога не требуется. |
| AC-LIF-001–005 | `startWorkCard`, `completeWorkCard`, `acceptFirstArticle`, `confirmWorkCardQuality`; API compact HTTP, browser, [security](../../quality/security.test.ts) | Переходы, gate, мастер/БТК и positive-only scope соответствуют коду. Happy path и role denials покрыты; новые проверки повторяют start/complete/quality для CLOSED обоих purposes и first acceptance при открытом gate с актуальными versions. Непредусмотренные MVP команды отсутствуют в routes/contracts; полный перебор всех состояний не заявляется. |
| AC-FBA-001–007 | `recordFinalBatchAcceptance`, `getFinalBatchAcceptance`, unique batch FK; API `T-API-FINAL/PAYROLL/AUDIT`, `T-API-E2E-SMALL`, [transactions](../../quality/transactions.test.ts), security, lifecycle, [quality UI tests](../../apps/web/src/quality-commands.test.ts) | Отдельная immutable запись, replay/concurrent winner, read-back, permission и audit rollback присутствуют. API large test подготавливает остаток CLOSED owner-SQL; только browser canonical доказывает все 250 UI lifecycle. Новые PostgreSQL tests независимо изолируют pending gate, отсутствующую serial card и незакрытую card, явно проверяя, что остальные предусловия выполнены. |
| AC-AUT-001–003 | route authorization/session/Origin/CSRF; security и API `T-API-SECURITY-ORDER` | Backend отклоняет чужие команды и audit/payroll reads до schema/resource validation; worker не получает lifecycle authority. |
| AC-READ-001–003 | read methods, contracts, worker filters, [read model](../../apps/web/src/read-model.test.ts), [presenters](../../apps/web/src/read-presenters.test.ts), API compact read-back | Нет бизнес-записей в чтениях, физической нумерации и смешения per-card/final acceptance; payroll читается отдельно. Служебное обновление session last-seen не является изменением доменного агрегата. |
| AC-DEM-001 | [session manager](../../apps/api/src/session-manager.ts), [session tests](../../apps/api/src/session-manager.test.ts), security, [frontend session](../../apps/web/src/demo-session.test.ts), interactive screens | Смена личности, token/cookie rotation и очистка защищённого UI state реализованы. |
| AC-CON-001–002 | expected versions + row locks; API competing assignment/final acceptance; [browser recovery](../../quality/browser/recovery.spec.ts), [UI recovery](../../apps/web/src/command-recovery.test.ts) | Есть реальный 409 и потеря ответа после commit; перечитывание без автоматического повтора mutation. Новые assertions проверяют все восемь команд с expected version, включая обе roots first acceptance, set/card назначения и payroll до/после export. Create не имеет previous version. |
| AC-TXN-001 | `executeCommand` + PostgreSQL transaction; transactions fault injection | Все 9 команд проверяются на rollback при audit insert failure, а выпуск — также при business insert и late receipt failure. Это не fault injection каждого возможного SQL statement. |
| AC-AUD-001–004 | `insertAuditEvents`, history/correlation queries, SQL constraints; API audit, [admin audit tests](../../apps/web/src/admin-audit.test.ts), transactions | Полный correlation 254 и SQL unique/immutable ограничения сохранены. FA-01 добавляет внутренние типы/валидацию 12 payload shapes, SQL сверку event version с actual root, проверку increment +1 и audit INSERT rowCount; rollback доказан полными snapshots. Обязательные workCardSetIds выпуска добавлены по каталогу. Публичная response-схема остаётся совместимой. |
| AC-PAY-001–005 | `exportWorkCardToPayroll`, unique work-card record, SQL grants; API concurrent export/replay, compact HTTP, transactions, [payroll UI](../../apps/web/src/payroll-commands.test.ts) | Локальная запись нормы assignee, один event, read-back и идемпотентность; без денег и внешней системы. Конкуренция сериализуется блокировкой карточки. Наличие port/adapter классов не требуется поведением и не подтверждается кодом. |

Каталог содержит **45** negative scenarios, включая безопасные повторы; это не 45 доказанных отдельных тестов. DoD требует позитивные и ключевые негативные сценарии. Успешный общий lifecycle не доказывает все перечисленные отказы; отдельные 45 тестов не предписываются, важны проверяемые assertions для ключевых условий.

## Техническое продолжение FA-01/02 — локальный результат

Основа — фактический HEAD `4e813f5a9641abe3068d1dfc544399d557028316` плюс dirty tree. Перед изменениями сохранён снимок 287 tracked/untracked файлов проекта; task diff строится относительно этого снимка, не HEAD. Прежние правки документации/инфраструктуры сохранены. Код приложения теперь отличается от опубликованного образа, поэтому старые CI/E2E/manual PASS на него не переносятся.

- [Валидатор и тип](../../apps/api/src/audit-event.ts), [unit tests](../../apps/api/src/audit-event.test.ts): 85/85 PASS. Валидация применяется при новой записи; старые события и произвольный owner SQL не перепроверяются.
- [Audit invariants](../../quality/audit-invariants.test.ts): 6/6 PASS; массовый выпуск 250/254, ошибки payload/event version/missing root, RETURNING increment и фактическая stored version, неполная вставка. После снятия SQL fault выпуск и same-command replay корректны; `workCardSetIds` сверены с реальными rows.
- [Transactions](../../quality/transactions.test.ts): 2/2 PASS; все девять команд откатываются при audit insert failure, выпуск также при business/late receipt failure. First acceptance/final acceptance и replay проходят; новый payroll command после export добавляет только receipt с `event_count = 0`.
- [Key negatives](../../quality/negative-workflow.test.ts): 6/6 PASS; таблица покрытия и границы — [[requirements-traceability]]. Missing-card fixture удаляет только собственную serial card disposable DB; остальные final prerequisites независимо проверены SQL.
- PostgreSQL 18.6, Windows, Node 24.19.0, Vitest 4.1.11: новый временный cluster, SCRAM, loopback `127.0.0.1:40046`. Runner проверяет точные data directory/PID/address/port/version и отдельные имена DB/roles, очищает inherited DB environment. Quality suites создают собственные случайные DB; API integration использует отдельные non-superuser owner/runtime роли. Рабочая/публичная БД не использовалась.

Полный список результатов, команды и локальные логи — [[quality-gates#Техническое закрытие FA-01/02 — 2026-09-27|targeted gates]]. Во время технического продолжения браузер, полный E2E, контейнерный/release/security/performance gate и облачные операции не запускались; rollback drill не проверен. Последующий целевой UI-smoke агента описан ниже. Повторять его на тех же исходниках только ради переноса результата в документы не требуется. Этап 12 и roadmap открыты; полнота квалификации выбранной версии рассматривается отдельно в FA-03.

## UI-smoke агента и проверка применимости — 2026-09-28

Прочитаны локальные report.md, web.json, семь DOM-снимков, шесть скриншотов, console.json, read-only результат БД и исходник его assertions. [Публичная сводка](../testing/fa-0102-evidence.md#UI-smoke) сохраняет результаты и ограничения; raw-архив с локальными данными остаётся вне Git-кандидата. Новых запросов к приложению или БД не выполнялось. Сам проход состоялся 27 сентября через Computer Use по отдельному разрешению пользователя: API из текущих исходников через tsx, Vite production build по отчёту запуска, отдельная disposable PostgreSQL 18.6 и приложение на loopback.

На входе предшествующей задачи переноса UI-smoke **22/22 SHA-256** из локального task-files.json (см. [сводку hash chain](../testing/fa-0102-evidence.md#Применимость-hashes)) совпали с текущими файлами; набор путей согласован с предыдущим `task.diff`. Проверены raw unit JSON и PostgreSQL logs: 85 + 69 unit, 14 targeted DB, 5 integration PASS / 1 намеренно исключённый retention/reset. HEAD остался `4e813f5a9641abe3068d1dfc544399d557028316`, но идентичность исправлений установлена hashes, а не одним HEAD. В том переносе изменились только семь документов; исходники приложения и тестов были сохранены.

| Сценарий | Согласованные UI и DB свидетельства | Граница вывода |
|---|---|---|
| Создание и выпуск DEMO-250 | [сводка UI/SQL](../testing/fa-0102-evidence.md#UI-smoke): 112 изделий, 3 комплекта, 112/112/26 = 250 карточек, повторный выпуск disabled; SQL подтверждает planned/actual counts | Создание партии и выпуск выполнены через UI |
| Полный аудит выпуска | [сводка UI/SQL](../testing/fa-0102-evidence.md#UI-smoke): сервер ожидал/насчитал 254, клиент получил 254 уникальных события; SQL receipt и actual events = 254 | Полнота одного выпуска, не полный жизненный цикл всех карточек |
| Первая карточка | [сводка UI/SQL](../testing/fa-0102-evidence.md#UI-smoke): назначение, начало, завершение и приёмка первой детали; CLOSED, допуск открыт. SQL: card version 5, events versions 1–5, один SERIAL_ALLOWED set | Эти переходы выполнены через UI; серийные карточки этой партии через UI не завершались |
| Первый и повторный payroll | [Сводка UI/SQL](../testing/fa-0102-evidence.md#UI-smoke): одна запись и один серверный timestamp. SQL: два разных command_id, 201/200, одинаковый payrollRecord, одна row, event_count и actual events 1/0 | Две вкладки и две отдельные последовательные команды; одновременная гонка этим smoke не доказана, её покрывает API regression |
| Отдельная финальная приёмка SMOKE-READY | [Сводка UI/SQL](../testing/fa-0102-evidence.md#UI-smoke): запись БТК сохранена. SQL: FINAL_ACCEPTED, batch/result/event versions 3/3/3, одно событие | Только финальная приёмка и повторное чтение выполнены через UI; партия создана/выпущена API, её 250 CLOSED и допуски подготовлены owner SQL в disposable DB |

В двух проверенных вкладках сохранено 0 console warn/error. Кнопки активировались клавиатурой Enter/Space: мышиные действия инструмента не срабатывали. Это ограничение способа проверки; совместимость мыши и полный desktop/mobile regression не заявляются. Ошибка диагностического SQL-запроса к отсутствующей колонке была исправлена до успешного read-only результата и не является дефектом приложения.

Применимость ограничена проверенными исходниками и указанной средой: список из 22 файлов не является полным снимком checkout во время smoke, а `web.json` не содержит digest web bundle или самостоятельный raw build log. Поэтому smoke принимается как узкое UI-доказательство FA-01/02, но не как CI, clean-container либо квалификация нового immutable image. Снимок 297 файлов проекта/shared workflows, evidence-check.json и source comparison, учитывающий untracked код, сохранены локально. Публично доступны [сводка применимости](../testing/fa-0102-evidence.md#Применимость-hashes) и [hashes исходных отчётов](../testing/evidence/fa-0102-summary.json), без raw-снимков рабочего дерева. Полный E2E и UI-smoke повторно не запускались.

## Сохранённые результаты и версии

| Evidence | Версия / окружение | Что можно утверждать |
|---|---|---|
| CI [35210700261](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/35210700261), release [35211261430](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/35211261430), retained manifest/scan | Source `1195892…`; GitHub CI PostgreSQL и Linux image | Сохранены успешные code/DB/container/security/compact/canonical/performance/release-contract gates и build/scan exact digest. Это срез на дату запуска, не новый dependency/image scan. |
| Deploy [35452096053](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/35452096053), evidence records 0001–0005 | Тот же image; workflow checkout `f402e43055bb34e68cca2d1f9c017eab41a84c0a`; staging Docker + отдельный Neon, production Render | Сохранены staging и production canonical smoke, persistent/resolved digest и read-back. Версия automation отличается от source image. |
| Recovery [36316059944](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/36316059944) | Тот же image; automation `5e88574a83bdd1ac9e6fd822902a72178bf23481`; runner/container `http://127.0.0.1:3001` + Neon recovery DB | Реальные 192,58 часа, 200/503/503 до owner reset, затем canonical 250, audit 254 и payroll. Это recovery, не повторный production Render показ. |
| Compact [36320856998](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/36320856998) | Тот же image; automation `4dd511676da53f57d18582e4d59c6ab3539043b6`; runner/container + recovery DB | 6-card desktop lifecycle с отдельным synthetic паспортом и owner cleanup. Не доказательство canonical 250 или hosted mobile. |
| [[screenshots|Четыре снимка]] | Один public read-only экран 27 сентября; локальные сентябрьские проходы | Кадры имеют собственные даты/источники и SHA256. Диагностический кадр из failed run не является PASS; screenshots не доказывают состояние текущей общей БД. |

Неуспешные recovery/compact попытки сохранены отдельно от успешных повторов в [[quality-gates]]. Локальные результаты этапов 7–9 относятся к их implementation SHA и средам. Проверенные SHA256 и локальные пути retained reports приведены в отчёте проверок `.quality-results/final-audit-20260927/`; он не публиковался. Online availability, текущий тариф и текущее health в этом аудите не проверены. Для scheduled reset 26/27 сентября найдена ранее записанная сводка, но не отдельный локальный API snapshot; это не новый независимо подтверждённый результат аудита. `main-ci-current.json` относится к 17 сентября и SHA `dfd1810…`, а прежний handoff об успешном CI HEAD `4e813f5…` — narrative запись без найденного raw/API snapshot. Новый run `36449212344` для `2d4609ad…` проверен отдельно ниже.

## Definition of Done и scope

Все **22 исходных пункта** [[definition-of-done]] сохранены: 8 для документации, 7 для функции, 7 для MVP. «Подтверждено» означает достаточность приведённых свидетельств в указанной области, а не исчерпывающий перебор состояний или утверждение статусов.

Обозначения свидетельств:

- **C** — commit `2d4609ad0188a0ec2e77ef1065195971aa14c455`, push-CI `36449212344/1`, GitHub Linux runners, Node 24.20.0, PostgreSQL 18.6; browser — Chromium. Jobs, raw reports и границы — [[quality-gates#CI кандидата FA-03 — 2026-09-28]].
- **D** — документационная сверка от 28 сентября поверх C: metadata/links, смысловая сверка и diff. D не является частью CI C. Последующее объединение с main от 29 сентября описано отдельно ниже; его собственный CI ещё впереди.
- **H** — source `1195892f15f2f240dd04f39e8388d6bb8802d9a7`, исторический image и staging/production evidence из [[deployment]] и таблицы выше. Новый запрос к runtime не выполнялся.

| № | Исходный пункт DoD | Что подтверждено | Свидетельство и версия / среда | Ограничение или отдельное решение |
|---|---|---|---|---|
| 1 | Цель и границы файла понятны без устного пояснения | Подтверждено: предмет, версия, источники результата указаны | D: объект аудита, таблицы DoD/CI, смысловая сверка | C, D и H не объединяются в один PASS |
| 2 | Нет противоречий с принятым MVP scope | Подтверждено: positive-only, отдельная final acceptance, synthetic payroll | C + D: [[mvp-scope]], трассировка 37 AC выше | Нет заводского внедрения, реальных выплат или расширения MVP |
| 3 | Спорные решения связаны с ADR/decision-log | Подтверждено: история сохранена, D-032 принят | D: [[decision-log]], D-032 утверждён 29 сентября; [[adr-index]] | Итоговое закрытие этапа 12 ещё не принято |
| 4 | Есть объективные критерии проверки | Подтверждено: AC сопоставлены с assertions и CI results | C: quality/browser; D: матрица DoD | Каталог 45 negatives не равен 45 отдельно выполненным tests |
| 5 | Внутренние ссылки актуальны | Подтверждено в изменённых документах | D: project-docs-auditor и Markdown/HTML links, раздел проверок ниже | Hosted URL не использованы как health probes |
| 6 | Статус изменён на accepted после проверки | Подтверждено по governance: спецификации accepted, живые реестры active | C + D: metadata, [[document-governance]] | Active у аудита/плана/backlog не означает закрытия; статусы принятия не повышались |
| 7 | Заполнены обязательные поля document-governance | Подтверждено: artifact_id/status/version/owner/updated | D: frontmatter изменённых governed документов | README и HTML не получают чужую metadata-схему |
| 8 | Нет дубликата artifact_id или конкурирующего принятого документа | Подтверждено: канонические пути сохранены, копий нет | D: ID сверены с реестром, выполнен semantic review | Структурный auditor не доказывает непротиворечивость всего текста |
| 9 | Acceptance criteria выполнены | Подтверждено в принятом MVP scope: трассировка 37 AC и релевантные PASS | C: quality — 154 API unit, 158 web unit, 6 integration, 72 DB regressions; browser | Сохраняются границы SQL fixtures и неполного перебора negatives из таблицы AC |
| 10 | Позитивные и ключевые негативные сценарии покрыты | Подтверждено: lifecycle, guards, faults, replay, recovery | C: quality, compact 6/6, canonical 3/3; [[requirements-traceability]] | Не заявляется полный перебор состояний или 45 отдельных negative tests |
| 11 | Permissions и инварианты проверяются на backend | Подтверждено: роли, security order, versions, concurrency, grants | C: integration, DB security/negative/transaction suites | UI не подменяет backend authority; реальная identity-система вне MVP |
| 12 | Значимые действия попадают в audit log | Подтверждено: payload/version/count, атомарность, read-back | C: audit unit/invariants/transactions; canonical 254 release events | Произвольный owner SQL и старые события не перевалидируются |
| 13 | UI обрабатывает loading, empty, error states | Подтверждено реализацией, component assertions и recovery | C: 158 web unit, compact desktop/mobile, canonical desktop | Не исчерпывающий визуальный аудит всех viewport/браузеров |
| 14 | Документация и demo data обновлены | Подтверждено: документы согласованы, synthetic fixtures/reset проверены | C: bootstrap, integration 6/6, lifecycle; D: связанные документы | Публичная БД не обновлялась; smoke SQL fixture не объявлена продуктовой demo data |
| 15 | Lint, format, typecheck и CI проходят | Подтверждено: pnpm check и все семь обязательных checks | C: quality log, conclusions `36449212344/1`; D проверен документационно | Будущий изменённый commit не наследует CI автоматически |
| 16 | Сквозной браузерный сценарий на чистом окружении | Подтверждено: canonical 250, compact 6, отдельные final acceptance/payroll | C: browser jobs с отдельной PostgreSQL, container clean startup | Canonical — desktop, mobile — compact; временная CI-среда, не hosted release |
| 17 | API/БД обеспечивают тот же сценарий независимо от UI | Подтверждено: compact HTTP-only lifecycle, независимые DB assertions | C: integration 6/6, DB regressions 72/72 | В большом API fixture остаток CLOSED готовится SQL; 250 UI transitions доказывает canonical |
| 18 | Повтор payroll возвращает запись без нового предметного эффекта | Подтверждено: replay/concurrent export, одна запись, нет нового domain event | C: integration/transactions, browser payroll/audit read-back | Новый command может добавить receipt; это не новый предметный эффект и не внешняя выплата |
| 19 | Критические тесты стабильны | Подтверждено на штатном CI с первой попытки; browser retries/skips/flaky/failures = 0 | C: attempt 1, compact 6/6, canonical 3/3, остальные suites по logs | Один run не доказывает долговременную flake rate; 6 integration skips unit-фазы затем выполнены 6/6; условные steps не пропуск required checks |
| 20 | Staging/production имеют health check и базовое логирование | Подтверждено только исторически для H; C имеет CI health | H: deploy `35452096053`, records 0001–0005, [[deployment]]; C: container | Доступность сейчас и hosted C не проверены. Для новой размещённой версии нужны её release/health/logging evidence и отдельное разрешение |
| 21 | README, диаграммы, demo script и ограничения актуальны | Подтверждено: архитектурная сверка сохранена, статусы дополнены C/H | C + D: README, Home, demo script, deployment, план/backlog/dashboard | Старые снимки/ручное сообщение сохраняют свои версии; история с email/локальными путями не очищена |
| 22 | Выполнен этап 12 — финальный аудит | Сверка подготовлена; пункт завершения пока не выполнен | D: аудит, принятое D-032; [[project-plan]]/[[backlog]] открыты | Нужно отдельное утверждение итогового решения; автоматического закрытия нет |

Итог: **20 подтверждено в указанной области; № 20 — только исторический hosted результат; № 22 — ожидает решения. Это не 22/22 PASS единой новой размещённой версии.** FA-05 остаётся непроверенным rollback drill.

## FA-03 — выбранная версия и минимальные дальнейшие проверки

Заголовок сохранён для существующих ссылок; получение CI теперь выполнено. Квалифицируется **точный commit C**, а не всё dirty tree источника или runtime H. В опубликованном составе 51 файл, включая шесть проверенных TS-файлов FA-01/02; parent/tree и +2463/−318 сверены с Git и удалённой веткой. Новый документационный diff D отделён от C.

На 28 сентября проверены GitHub API run/attempt/jobs/check-runs/artifacts, локальные ci-result/execution records, полные логи и отчёты. Все семь checks — completed/success; для SHA найден один штатный push-run, attempt 1. `candidate-tree.json` остаётся снимком подготовки: `commit_sha:null`/`ci_run:null` не описывают текущее выполнение. Снимок не исправлялся задним числом.

Повторно вычислены SHA-256 **146/146** индексированных файлов; проверены **6 ZIP, 103 извлечённых файла, 5/5 artifact digests**. SHA-256 неизменённого `sha256-index.json`: `56954058f40c6ebde763a6cd002e4d361287ce519a3414a360feb40ab92fe629`. Полные logs — raw evidence; quality-result/release_iac-result — производные сводки, отдельных uploaded JSON этих jobs нет. Raw evidence и review остаются вне Git. Результаты jobs и performance comparison — [[quality-gates#CI кандидата FA-03 — 2026-09-28]].

Обязательные quality/container/security/browser compact/browser canonical/performance/release_iac закрывают прежний пробел CI выбранного состава: общий audit write path проверен вместе с упаковкой, чистым запуском, DB regressions и полным browser lifecycle. Повтор tests, UI-smoke, E2E, performance/security или CI для этой сверки не нужен.

Новый hosted release не выполнялся. Утверждение размещения C потребует отдельного предложения по [[deployment]] и отдельного разрешения; этот аудит такие операции не назначает. CI image scan не создаёт hosted release binding. FA-05 не превращается в требование облачных действий.

## Граница завершения портфолио — 2026-09-29

**Историческая граница на 29 сентября:** пользователь заменил прежний отказ от обновления целью D-034. Тогда проверенный main `bdb2647520639b9ca690dfd6d00402076463a63a` прошёл [CI 7/7](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/36544788733), но новое размещение ещё не было выполнено и этап 12/roadmap оставались открытыми. Последующий результат 1 октября приведён в начале документа и в [[deployment#Обновление демо 2026-09-29]].

[PR #17](https://github.com/AI-shoks/WorkCard-Lifecycle/pull/17) объединён с main `bdb2647520639b9ca690dfd6d00402076463a63a`; собственный [push CI 36544788733](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/36544788733) прошёл 7/7. Сохранены recovery workflow, helpers и browser harness из main, исправления журнала FA-01/02 и минимальное обновление `fast-uri`. Прежний CI `2d4609ad…` остаётся отдельным историческим результатом.

Пункты DoD 15–19 должны быть связаны с CI окончательного состава после интеграции. Пункт 20 остаётся историческим свидетельством конкретного прежнего runtime; новые health/logging или текущая доступность не заявляются. Пункт 22 закрывается итоговым решением с этими явно названными версиями и ограничениями. Это не 22/22 PASS новой размещённой версии.

Интеграция PR #17 завершена. После D-034 остаются preflight, staging, размещение точного image и итоговый DoD; повторной публикации приложения после документационных коммитов не требуется.

После утверждения D-032 новый CI интеграции выявил HIGH advisories в прежних версиях `fast-uri`; минимальное обновление lockfile и оставшийся moderate advisory тестовой зависимости описаны в [[quality-gates#Security после интеграции — 2026-09-29]]. D-032 сохраняет историческую квалификацию C на дату её проверки и не подтверждает текущую безопасность старого hosted H. Публичное демо сохраняет прежние зависимости; достижимость уязвимостей в нём не проверялась. Этап 12/roadmap остаются открытыми.

## Исторический вывод D-032 о готовности этапа 12 и roadmap

**Решение D-032 отдельно утверждено пользователем 2026-09-29:**

1. Принять CI `36449212344/1` и закрыть FA-03 **в части квалификации исходников `2d4609ad0188a0ec2e77ef1065195971aa14c455`**. Дефицита обязательных CI checks этого commit больше нет.
2. Этап 12 и roadmap пока оставить открытыми: DoD № 20 имеет hosted evidence только для H, а № 22 требует итогового решения. Не объявлять весь MVP новой размещённой версией C. Вопрос завершения с явно названной версией остаётся отдельным; критерии не переписываются и deployment автоматически не назначается.
3. Сохранить FA-05 как непроверенный rollback drill и ограничение эксплуатационной готовности. Ручное сообщение пользователя без SHA/окружения и исторический health/logging не подтверждают C или доступность сейчас.
4. Сохранить принятое ограничение приватности: опубликованная история содержит известные исторические email и локальные пути, она не очищена. Подтверждённые privacy/noreply настройки будущих commits не удаляют старые сведения.

FA-03 закрыт в указанной области; этап 12 и roadmap открыты. D-032 меняет только согласованные документационные статусы. Отдельное разрешение пользователя от 29 сентября на commit, push, PR и merge подготовленного объединения после успешного CI записано в [[decision-log]]; release/deployment и ручные rerun/dispatch этим не разрешены.

## Статус замечаний и влияние

| ID | Замечание | Влияние и дальнейшее действие |
|---|---|---|
| FA-01 — закрыто локально | Внутренний `AuditInsert` и runtime validator проверяют event-specific payload; `insertAuditEvents` сравнивает version с сохранённым root, проверяет фактический INSERT rowCount, а update paths контролируют `+1`. Добавлен обязательный `workCardSetIds` выпуска. | Unit 85/85 и PostgreSQL audit-invariants 6/6 + transactions 2/2 PASS: плохой payload/version, missing root, неверный increment и подавленная вставка откатывают business rows, events и receipt. Public envelope/command contracts и применённые migrations сохранены; независимый commit COUNT не нужен для одной проверенной INSERT в общей транзакции. |
| FA-02 — закрыто локально | Достаточность оценена по существующим assertions и дополнена `quality/negative-workflow.test.ts`: ASG-002, терминальность LIF-005, три независимых FBA-002 predicates и version conflicts. | 6/6 PostgreSQL tests PASS; каждый отказ сверяет восемь полных таблиц и ожидаемый error/conflict. Existing positive/replay/permission/concurrency tests переиспользованы; отдельные 45 tests не заявляются. |
| FA-03 — закрыто по исходникам | CI `36449212344/1`: 7/7 success для `2d4609ad…`; head/tree, logs/reports и SHA-256 сверены. | Квалификация этих исходников принята пользователем по D-032 29 сентября. Объединённый состав с main проходит собственный CI. Новый hosted runtime не выпускался; этап 12/roadmap автоматически не закрываются. |
| FA-04 — выполнено, источники разделены | Исторический ручной пункт закрыт сообщением пользователя от 27 сентября без SHA/окружения. Дополнительно агент выполнил целевой UI-smoke текущих исправлений; артефакты сверены 28 сентября. | Пользовательское подтверждение не приписывается текущему коду. Агентский smoke покрывает выпуск/аудит, первую карточку, повтор payroll и финальную приёмку подготовленной партии; полный 250-card lifecycle и общий DoD не заявляются. |
| FA-05 — непроверено | Rollback drill не выполнен. После release `bdb2647…` сохранены два image с одинаковой историей миграций. | Ограничение эксплуатационной готовности; совместимость, наличие workflow и повторный deploy того же digest не заменяют реальный drill. |

Заводское внедрение, измеренный бизнес-эффект и промышленный SLA не заявляются. Общее demo может спать, быть недоступным по квотам или закрыться после 26 часов без успешного reset.

## Результат ручной проверки пользователя

- [x] Ручная проверка демо выполнена по сообщению пользователя. Подтверждение получено 2026-09-27; неизвестные SHA/окружение не заполняются предположением. Следующий перечень сохранён как справочный для повторного показа.

- При повторной проверке записать дату, адрес/окружение и выбранную версию; при локальном показе выполнить [[local-development|инструкцию запуска]] и readiness отдельно.
- Пройти [[demo-script#Короткий показ|короткий показ]]: роли, паспорт, 112 → 3/250 и первая деталь на своей подготовленной партии либо явно обозначенных исторических материалах; проверить desktop/mobile и понятность запрета серии до БТК.
- Проверить read-back одного действия мастера/БТК и отсутствие доступных чужих действий; после смены роли нет старых защищённых данных.
- Показать отдельную финальную приёмку готовой партии и audit/payroll read-back. Если готовой партии нет, явно использовать исторические экраны/evidence; не обещать завершить 250 карточек за 5–7 минут.
- Записать результат и ограничения. Не закрывать весь roadmap автоматически: FA-01/02 закрыты локально; итоговое решение по DoD и версии принимается отдельно.

## Проверки документации

При сверке 28 сентября после CI были изменены 13 документов: 11 governed Markdown, README и документационный HTML dashboard. Проверки ограничены их metadata/links, коллизиями ID с реестром, согласованностью статусов и diff; критерии и gates сохранены. Результат того прохода — [[quality-gates#Документационная сверка после CI]]. Старые результаты ниже относятся к прежним проходам.

Исходный strict audit: 61 документ, 0 errors, 0 warnings; итоговый: 63 документа, 0 errors, 0 warnings. Дополнительные 67 локальных ссылок README/HTML корректны; 36 внешних URL не запрашивались. Scoped Prettier README/Home прошёл. Смысловая сверка и diff относительно исходного снимка просмотрены, история ADR-0001/0006 сохранена. Результаты и границы — [[quality-gates]]. Основание правок — D-030 в [[decision-log]]. Техническое продолжение FA-01/02 отдельно прошло строгий аудит: 63 документа, 0 ошибок, 0 предупреждений; смысловая сверка и task diff просмотрены после изменения приложения. Предшествующие правки сохранены.

Перенос UI-smoke 28 сентября: `project-docs-auditor --fail-on-warning` — **PASS, 63 документа, 0 ошибок, 0 предупреждений**. Дополнительно проверена 71 локальная Markdown-ссылка семи затронутых файлов; 33 внешних URL не запрашивались. Смысловая сверка отделяет полное покрытие AC от узкого smoke, источники доказательств и версии. Все 22 пункта DoD сохранены дословно; рекомендации о следующих проверках не меняют критерии. Diff относительно `before/` просмотрен, `git apply --check --reverse --whitespace=error` прошёл без применения patch. Из 297 файлов исходного снимка изменены только семь документов; остальные 290, HEAD/index и 35 файлов прежнего evidence сохранены. `docs/` исключён из Prettier правилами проекта; приложение и окружения повторно не запускались.

## Изолированный состав и выполненный CI — 2026-09-28

Подготовлен отдельный локальный checkout от `4e813f5a9641abe3068d1dfc544399d557028316`, ветка `codex/fa-03-ci-candidate`. Исходное dirty tree не является целиком составом кандидата: перенесены ровно шесть проверенных TS-файлов FA-01/02, согласованная документация и её ссылки/ADR/исторические свидетельства. Terraform-дельта, локальные правила её игнорирования, посторонние рабочие документы и соседние проекты исключены. Public contracts, SQL migrations, зависимости, сборочная конфигурация, workflows и browser/release harness сохранены из основания. В `infra/render/README.md` перенесено только историческое уточнение текста; infrastructure code не менялся.

Проверенная цепочка применимости: 15 прежних task hashes совпадают непосредственно; для семи намеренно обновлённых документов совпадают before/after hashes документационной задачи. Подготовка отдельно уточняет этот документ, фактический actionlint scope в repository-structure, открытый статус в dashboard и ссылки на evidence; эти уточнения не являются новым runtime результатом. В Git-кандидат входит [публичная сводка](../testing/fa-0102-evidence.md) с [индексом hashes](../testing/evidence/fa-0102-summary.json). Raw-файлы трёх `.quality-results/fa-0102-*` сохранены локально вне кандидата: их персональные пути, PID и снимки соседних изменений не нужны в публикуемом составе. Сводка не выдаётся за raw-доказательство, а hashes документов до редакционных правок не выдаются за hashes финального Git tree. Полный список кандидата, отдельный patch и SHA-256 сохранены в локальном review-пакете подготовки.

Ранее разрешённые один commit и один push выполнены: `2d4609ad0188a0ec2e77ef1065195971aa14c455`, CI `36449212344/1`, 7/7 success. Review сохраняет подготовку и execution records раздельно. На момент сверки 28 сентября был подготовлен только unstaged документационный diff; commit/push, PR, rerun/dispatch, release/deployment и переписывание истории не выполнялись. На 28 сентября FA-03, этап 12/roadmap оставались открытыми; FA-05 непроверен. Последующее утверждение D-032 от 29 сентября приведено выше.
