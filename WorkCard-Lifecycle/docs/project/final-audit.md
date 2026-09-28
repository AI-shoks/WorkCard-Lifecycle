---
artifact_id: project.final-audit
status: active
version: 6
owner: project
updated: 2026-09-28
---

# Финальный аудит — этап 12

**На 28 сентября 2026 года этап 12 и roadmap к закрытию не готовы: FA-03 остаётся открытым.** FA-01/02 закрыты локальными техническими проверками; короткий UI-smoke агента от 27 сентября проверен по сохранённым артефактам и добавлен как отдельное свидетельство. Ниже выполнена сверка полного DoD и указан минимальный дальнейший путь с учётом влияния изменений. Критерии приёмки и статусы этапов не ослаблены.

Источники результата разделены: агент — unit/API/PostgreSQL и ограниченный UI-smoke текущего изменённого кода; пользователь — историческое сообщение «все проверил, все работает», полученное 27 сентября без SHA/окружения и даты самого прохода; CI/release — сохранённые PASS конкретных прежних source/image/executor. Ни один из этих источников не подменяет другой.

## Объект и границы

- Git root — родитель каталога `WorkCard-Lifecycle`; HEAD на начало аудита — `4e813f5a9641abe3068d1dfc544399d557028316`.
- Рабочее дерево уже содержало правки документации, исторического Terraform и untracked материалы портфолио/release. Они сохранены. Основание для diff этого аудита — снимок файлов до его начала, а не чистый HEAD.
- Опубликованный runtime: source SHA `1195892f15f2f240dd04f39e8388d6bb8802d9a7`, image digest `sha256:231d91a73a72275cefa0bbfe25d316b73315eb1f783d5618ebf55019a39ff057`; [manifest](../release/manifests/1195892f15f2f240dd04f39e8388d6bb8802d9a7.json).
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

На входе этой документационной задачи **22/22 SHA-256** из локального task-files.json (см. [сводку hash chain](../testing/fa-0102-evidence.md#Применимость-hashes)) совпали с текущими файлами; набор путей согласован с предыдущим `task.diff`. Проверены raw unit JSON и PostgreSQL logs: 85 + 69 unit, 14 targeted DB, 5 integration PASS / 1 намеренно исключённый retention/reset. HEAD остался `4e813f5a9641abe3068d1dfc544399d557028316`, но идентичность исправлений установлена hashes, а не одним HEAD. В этой задаче меняются только семь документов; исходники приложения и тестов сохраняются.

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

Неуспешные recovery/compact попытки сохранены отдельно от успешных повторов в [[quality-gates]]. Локальные результаты этапов 7–9 относятся к их implementation SHA и средам. Проверенные SHA256 и локальные пути retained reports приведены в отчёте проверок `.quality-results/final-audit-20260927/`; он не публиковался. Online availability, текущий тариф и текущее health в этом аудите не проверены. Для scheduled reset 26/27 сентября найдена ранее записанная сводка, но не отдельный локальный API snapshot; это не новый независимо подтверждённый результат аудита. `main-ci-current.json` относится к 17 сентября и SHA `dfd1810…`, а handoff об успешном CI текущего HEAD — narrative запись без найденного raw/API snapshot.

## Definition of Done и scope

Сверены все 22 пункта [[definition-of-done]]: 8 для документации, 7 для функции и 7 для MVP. «Подтверждено локально» обозначает указанный объём evidence, а не новый общий CI PASS.

| DoD документации | Состояние и основание |
|---|---|
| Цель и границы понятны | Указаны версия, среда, источник результата и ограничения smoke |
| Нет противоречий MVP scope | Positive-only, отдельная final acceptance, synthetic payroll; расширения scope нет |
| Спорные решения связаны с ADR/decision-log | История D-030/D-031 и ADR сохранена; перенос evidence не меняет принятые решения |
| Объективные критерии | 37 AC сопоставлены с assertions; UI числа сверены с DOM/SQL, недостающие gates перечислены ниже |
| Внутренние ссылки актуальны | Строгий auditor и отдельная проверка ссылок затронутых документов; результат в конце отчёта |
| Статус accepted после проверки | Канонические спецификации остаются accepted; final-audit/план/backlog остаются active по правилу living documents в [[document-governance]], это не отметка завершения этапа |
| Обязательные metadata заполнены | Версии и дата семи затронутых файлов обновлены, набор полей сохранён |
| Нет дубликатов или конкурирующих принятых документов | Структурная и смысловая сверки; новые канонические копии не создавались |

| DoD функции | Состояние и основание |
|---|---|
| Acceptance criteria выполнены | Все 37 сопоставлены с кодом; FA-01/02 закрыли найденные пробелы. Полный PASS выбранной версии ещё зависит от FA-03 |
| Позитивные и ключевые негативные сценарии | Локальные unit/API/PostgreSQL PASS сохранены; отдельные 45 negative tests не требуются. UI-smoke покрывает только строки выше |
| Backend permissions и инварианты | API role denials/concurrency и targeted negatives; изменение UI не подменяет backend authority |
| Значимые действия в audit log | FA-01: typed payload/version/insert-count, атомарный rollback; UI release 254/254 и payroll 1/0 подтверждены |
| Loading, empty, error states | Реализация и component/recovery assertions найдены; этот smoke не является новым проходом всех состояний/viewport. Для выбранного checkout остаётся browser/quality CI |
| Документация и demo data обновлены | Документы согласованы; production fixtures не менялись, SMOKE-READY — только локальная подготовка проверки |
| Lint, format, typecheck и CI проходят | Scoped lint/format/API/quality types PASS; полного CI текущего кандидата нет — FA-03 |

| DoD MVP | Состояние и основание |
|---|---|
| Сквозной браузерный сценарий на чистом окружении | Полный canonical — исторический. Новый короткий smoke использовал свежую БД, но две партии и SQL-подготовку финала; он не закрывает этот пункт для новой версии |
| Тот же сценарий независимо через API/БД | Compact HTTP и 250-card API regression прошли локально; 5 PASS / retention/reset вне targeted scope |
| Повтор payroll без нового предметного эффекта | Подтверждён API и двумя UI-командами + независимым read-only SQL: одна запись, события 1/0 |
| Критические тесты стабильны | Targeted tests успешны; нет результатов полного набора выбранного checkout. Требуются обычные CI gates без ослабления skips/retries, не серия повторов ради числа запусков |
| Staging/production health check и базовое логирование | Сохранённое hosted evidence относится к image `1195892…`; health/logging исходники не менялись. Доступность сейчас и размещение нового backend не подтверждены; при включении нового hosted runtime в готовность нужны его собственные observations |
| README, диаграммы, demo script, ограничения актуальны | Исходная сверка сохранена; устаревшее требование короткого smoke заменено ссылкой на выполненный проход, опубликованный образ отделён от локальных исправлений |
| Этап 12 выполнен | Нет. Итоговая сверка подготовлена, но FA-03 и решение о закрытии остаются открытыми |

## FA-03 — выбранная версия и минимальные дальнейшие проверки

Кандидат оценки — **текущее рабочее дерево с FA-01/02**, а не опубликованный source `1195892…`. Его основа: HEAD `4e813f5a9641abe3068d1dfc544399d557028316`, проверенные hashes исправлений и локально сохранённый снимок исходных файлов этой задачи; документационная дельта выделена отдельно, [применимость hashes](../testing/fa-0102-evidence.md#Применимость-hashes) описана публично. Для будущего CI нужен точный commit выбранного состава файлов и сверка его содержимого с этим кандидатом: один HEAD не описывает dirty tree. Commit/push в этой задаче не выполняются.

Сравнение с release source показывает изменение `workflow-service.ts` и новый untracked `audit-event.ts`; UI, contracts, migrations, package/lock, Dockerfile и Compose не изменены. При этом browser harness и release smoke/proxy helpers в HEAD новее release source. Новый общий validator и SQL-проверка версий работают на write path всех команд; scoped PASS не проверяет весь checkout и packaging. Исторические Terraform-правки относятся к неактивному GCP варианту и не создают необходимости cloud/plan/apply для этого решения.

| Недостающее evidence выбранной версии | Почему релевантно / минимальное получение |
|---|---|
| `quality`: полный code/DB gate | Нужна совместимость нового модуля с workspace и общими DB suites, включая не выполнявшийся retention/reset. Получить существующую CI job с `pnpm check`, bootstrap/verify и DB suites; отдельно повторять уже сохранённые 85/69/14/5 tests перед ней не нужно |
| `container`: clean startup и scan нового image | API build и report о Vite build не доказывают включение нового модуля в Linux image и запуск с чистой БД. Достаточна штатная job на новом ephemeral volume, с readiness и image scan; существующие окружения не трогать |
| `browser (compact)` и `browser (canonical)` | Общий audit path изменён, а smoke не провёл serial quality и весь процесс одной партии. Compact даёт полный малый lifecycle/recovery и desktop/mobile; canonical — действующее обязательство 250 UI transitions текущего backend/harness. Нужны штатные matrix entries один раз в выбранном CI, без дополнительного ручного 250-card прохода |
| `performance` | Дополнительный SQL JOIN проверки aggregate versions и проверки массовых обновлений лежат на пути release/assignment. Получить штатный профиль 10 000 карточек и сравнить raw samples с прежним; completion/correctness обязательны, нового SLA/threshold не вводить |
| `security` | Lockfile не менялся: отдельная переустановка/локальный повтор audit ради документации не нужен. Но прежние dependency/image scans датированы, а текущее содержимое не имеет нового secret scan; сохранить обычную обязательную job без переноса старого PASS |
| `release_iac` | Release helpers новее source прежнего image. Нужны tests/schemas, actionlint и Render contract того же checkout в существующей CI job; Terraform/cloud и новый deployment этим gate не требуются |

Это **семь уже обязательных CI checks** из [[ci-pipeline]] и [workflow](../../../.github/workflows/ci.yml), с указанными причинами их применимости. Минимальный дальнейший запуск — один штатный CI выбранного commit, а не отдельный полный локальный прогон плюс CI плюс новый ручной smoke. Сначала проверить, нет ли уже сохранённых результатов именно этого commit/состава; в имеющихся материалах таких результатов для dirty-кандидата нет. Сохранить `head_sha`, run/attempt, conclusions каждой обязательной job и её отчёты. Нынешняя задача требует только документационных проверок.

Отдельная граница — опубликованный runtime: текущий кандидат ещё не имеет нового immutable image/release binding и его staging/production health/logging evidence. Для заявления о готовности **новой размещённой версии** потребуется exact-digest release/hosted qualification по [[deployment]], включая требуемый самим release workflow успешный push-CI того же SHA. Если решение относится к исходникам, в нём следует явно сохранить опубликованный `1195892…` как отдельную исторически квалифицированную версию; размещение исправлений не заявлять. Новый deploy, повтор elapsed recovery и rollback не назначаются автоматически ради переноса UI-отчёта.

## Вывод о готовности этапа 12 и roadmap

**Рекомендация: оставить этап 12 и roadmap открытыми.** Для решения о закрытии нужны: (1) зафиксированный состав текущего кандидата и связь с проверяемым commit; (2) подтверждённые семь обязательных CI checks этого состава с raw evidence; (3) явная граница исходники/опубликованный runtime в итоговом DoD — если заявляется новый hosted runtime, его release/health/logging evidence; (4) отдельное принятие итогового решения после сверки результатов. Исторические CI/release и сообщение пользователя не закрывают эти условия.

FA-05 сохраняется как **непроверенный rollback drill** и ограничение эксплуатационной готовности. Он не был обязательством исторического закрытия этапа 10 и не превращается в требование нового облачного запуска для этой документационной задачи. Его нельзя отметить PASS без предыдущего совместимого image и реального разрешённого drill; итоговое решение должно сохранить это ограничение явно.

## Статус замечаний и влияние

| ID | Замечание | Влияние и дальнейшее действие |
|---|---|---|
| FA-01 — закрыто локально | Внутренний `AuditInsert` и runtime validator проверяют event-specific payload; `insertAuditEvents` сравнивает version с сохранённым root, проверяет фактический INSERT rowCount, а update paths контролируют `+1`. Добавлен обязательный `workCardSetIds` выпуска. | Unit 85/85 и PostgreSQL audit-invariants 6/6 + transactions 2/2 PASS: плохой payload/version, missing root, неверный increment и подавленная вставка откатывают business rows, events и receipt. Public envelope/command contracts и применённые migrations сохранены; независимый commit COUNT не нужен для одной проверенной INSERT в общей транзакции. |
| FA-02 — закрыто локально | Достаточность оценена по существующим assertions и дополнена `quality/negative-workflow.test.ts`: ASG-002, терминальность LIF-005, три независимых FBA-002 predicates и version conflicts. | 6/6 PostgreSQL tests PASS; каждый отказ сверяет восемь полных таблиц и ожидаемый error/conflict. Existing positive/replay/permission/concurrency tests переиспользованы; отдельные 45 tests не заявляются. |
| FA-03 — открыто | Нет полного CI, clean-container/browser/performance/security/release-contract evidence выбранного dirty-кандидата; UI-smoke имеет узкую область. | Анализ влияния и минимальные семь штатных CI checks приведены выше; опубликованный runtime и условия нового hosted release отделены. |
| FA-04 — выполнено, источники разделены | Исторический ручной пункт закрыт сообщением пользователя от 27 сентября без SHA/окружения. Дополнительно агент выполнил целевой UI-smoke текущих исправлений; артефакты сверены 28 сентября. | Пользовательское подтверждение не приписывается текущему коду. Агентский smoke покрывает выпуск/аудит, первую карточку, повтор payroll и финальную приёмку подготовленной партии; полный 250-card lifecycle и общий DoD не заявляются. |
| FA-05 — непроверено | Rollback drill не выполнен: нет предыдущего совместимого image. | Ограничение эксплуатационной готовности; не выдавать повторный deploy того же digest за rollback. Не требует запуска или cloud действий в этой задаче. |

Заводское внедрение, измеренный бизнес-эффект и промышленный SLA не заявляются. Общее demo может спать, быть недоступным по квотам или закрыться после 26 часов без успешного reset.

## Результат ручной проверки пользователя

- [x] Ручная проверка демо выполнена по сообщению пользователя. Подтверждение получено 2026-09-27; неизвестные SHA/окружение не заполняются предположением. Следующий перечень сохранён как справочный для повторного показа.

- При повторной проверке записать дату, адрес/окружение и выбранную версию; при локальном показе выполнить [[local-development|инструкцию запуска]] и readiness отдельно.
- Пройти [[demo-script#Короткий показ|короткий показ]]: роли, паспорт, 112 → 3/250 и первая деталь на своей подготовленной партии либо явно обозначенных исторических материалах; проверить desktop/mobile и понятность запрета серии до БТК.
- Проверить read-back одного действия мастера/БТК и отсутствие доступных чужих действий; после смены роли нет старых защищённых данных.
- Показать отдельную финальную приёмку готовой партии и audit/payroll read-back. Если готовой партии нет, явно использовать исторические экраны/evidence; не обещать завершить 250 карточек за 5–7 минут.
- Записать результат и ограничения. Не закрывать весь roadmap автоматически: FA-01/02 закрыты локально; итоговое решение по DoD и версии принимается отдельно.

## Проверки документации

Исходный strict audit: 61 документ, 0 errors, 0 warnings; итоговый: 63 документа, 0 errors, 0 warnings. Дополнительные 67 локальных ссылок README/HTML корректны; 36 внешних URL не запрашивались. Scoped Prettier README/Home прошёл. Смысловая сверка и diff относительно исходного снимка просмотрены, история ADR-0001/0006 сохранена. Результаты и границы — [[quality-gates]]. Основание правок — D-030 в [[decision-log]]. Техническое продолжение FA-01/02 отдельно прошло строгий аудит: 63 документа, 0 ошибок, 0 предупреждений; смысловая сверка и task diff просмотрены после изменения приложения. Предшествующие правки сохранены.

Перенос UI-smoke 28 сентября: `project-docs-auditor --fail-on-warning` — **PASS, 63 документа, 0 ошибок, 0 предупреждений**. Дополнительно проверена 71 локальная Markdown-ссылка семи затронутых файлов; 33 внешних URL не запрашивались. Смысловая сверка отделяет полное покрытие AC от узкого smoke, источники доказательств и версии. Все 22 пункта DoD сохранены дословно; рекомендации о следующих проверках не меняют критерии. Diff относительно `before/` просмотрен, `git apply --check --reverse --whitespace=error` прошёл без применения patch. Из 297 файлов исходного снимка изменены только семь документов; остальные 290, HEAD/index и 35 файлов прежнего evidence сохранены. `docs/` исключён из Prettier правилами проекта; приложение и окружения повторно не запускались.

## Изолированный состав для одного CI — 2026-09-28

Подготовлен отдельный локальный checkout от `4e813f5a9641abe3068d1dfc544399d557028316`, ветка `codex/fa-03-ci-candidate`. Исходное dirty tree не является целиком составом кандидата: перенесены ровно шесть проверенных TS-файлов FA-01/02, согласованная документация и её ссылки/ADR/исторические свидетельства. Terraform-дельта, локальные правила её игнорирования, посторонние рабочие документы и соседние проекты исключены. Public contracts, SQL migrations, зависимости, сборочная конфигурация, workflows и browser/release harness сохранены из основания. В `infra/render/README.md` перенесено только историческое уточнение текста; infrastructure code не менялся.

Проверенная цепочка применимости: 15 прежних task hashes совпадают непосредственно; для семи намеренно обновлённых документов совпадают before/after hashes документационной задачи. Подготовка отдельно уточняет этот документ, фактический actionlint scope в repository-structure, открытый статус в dashboard и ссылки на evidence; эти уточнения не являются новым runtime результатом. В Git-кандидат входит [публичная сводка](../testing/fa-0102-evidence.md) с [индексом hashes](../testing/evidence/fa-0102-summary.json). Raw-файлы трёх `.quality-results/fa-0102-*` сохранены локально вне кандидата: их персональные пути, PID и снимки соседних изменений не нужны в публикуемом составе. Сводка не выдаётся за raw-доказательство, а hashes документов до редакционных правок не выдаются за hashes финального Git tree. Полный список кандидата, отдельный patch и SHA-256 сохранены в локальном review-пакете подготовки.

Следующий шаг требует отдельного разрешения: один commit выбранного состава и один push новой ветки `codex/fa-03-ci-candidate` для одного штатного `CI` с событием `push`. PR/dispatch/deploy не требуются. До этого commit SHA кандидата и CI run/attempt отсутствуют; base HEAD не выдаётся за идентификатор изменённой версии. После разрешённого запуска нужно сохранить один `head_sha`, run/attempt, выводы всех семи checks, логи и доступные отчёты. FA-03, этап 12 и roadmap остаются открытыми; FA-05 непроверен.
