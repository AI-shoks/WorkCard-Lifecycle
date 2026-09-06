---
artifact_id: engineering.quality-gates
status: accepted
version: 14
owner: engineering
updated: 2026-09-06
---

# Quality Gates

Один локальный gate объединяет форматирование кода, статический анализ, строгую типизацию, тесты и production build:

```powershell
pnpm install --frozen-lockfile
pnpm check
```

## Состав `pnpm check`

| Gate | Команда | Что доказывает |
|---|---|---|
| Format | `pnpm format:check` | конфигурация и исходный код соответствуют Prettier |
| Lint | `pnpm lint` | ESLint проверяет JS/TS/React hooks и запрещает неявные globals |
| Types | `pnpm typecheck` | все workspace проходят strict TypeScript без emit |
| Unit/API | `pnpm test` | Vitest проверяет frontend API client, формы, permissions, session/role switch, selection, command/read-back и recovery states; API проверяет health/config/security. DB suite запускается отдельно с явным integration URL |
| Build | `pnpm build` | contracts, API и SPA собираются для production |

Markdown не переписывается Prettier: документация имеет собственную metadata/link проверку через `project-docs-auditor` и обязательный semantic pass. Это сохраняет осознанное форматирование Obsidian-артефактов и не скрывает их отдельный quality gate.

## Интеграционный gate

Перед принятием инфраструктурного изменения выполняются:

```powershell
docker compose config --quiet
docker compose up --build --wait --wait-timeout 180
docker compose run --rm --no-deps migrate
docker compose run --rm --no-deps seed
docker compose run --rm --no-deps app node dist/verify-database.js
pnpm --filter @work-card/api test:integration
pnpm audit --prod --audit-level=high
git diff --check
```

Отдельно `project-docs-auditor` запускается от корня проекта в strict mode `--fail-on-warning`. Дополнительно проверяются `/`, `/health/live`, `/health/ready`, desktop/mobile layout и browser console.

## Исторический результат этапа 7

На 2 сентября 2026 года:

- format, lint, typecheck и build — успешно;
- 11 обычных автоматических тестов — успешно, включая полную trusted-role command matrix и browser security headers;
- 5 PostgreSQL integration tests — успешно: ранний порядок session/role/Origin-CSRF, `3/250/254`, compact API-only lifecycle, concurrent assignment/final/payroll, replay и immutable grants;
- migrations `0001`–`0003`, seed и runtime permission verification на чистой БД — успешно;
- production build — успешно;
- clean-container текущего checkout локально — успешно;
- implementation commit [`17d2b04d13b58c7dff677543ed4399751a8593a1`](https://github.com/AI-shoks/WorkCard-Lifecycle/commit/17d2b04d13b58c7dff677543ed4399751a8593a1) опубликован и проверен;
- [push CI](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33581627867) и [PR CI](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33581630041) для implementation SHA полностью зелёные: `Code and database quality` и `Clean container startup` завершены успешно;
- strict documentation audit при закрытии этапа 7 — 55 документов, 0 ошибок, 0 предупреждений.

## Исторический результат этапа 8 — 5 сентября 2026 года

Результаты ниже относятся к implementation SHA этапа 8 `b00ff294a7b7ce1e09379c088969d9a02bd033bf` и не переносятся на изменения этапа 9.

| Проверка | Результат |
|---|---|
| `pnpm install --frozen-lockfile` | PASS, зависимости установлены без изменения lockfile |
| `pnpm check` после исправлений кода | PASS: format, lint, typecheck, tests и production build |
| Frontend focused suite | PASS: `157` тестов в `20` файлах, включая `17` интерактивных jsdom-тестов |
| Обычные API tests | PASS: `9` тестов; DB suite не подменяется unit-прогоном |
| Реальная PostgreSQL integration suite | PASS: `5/5` на отдельной чистой PostgreSQL `18.6` |
| Database bootstrap | PASS: `0001`–`0003`, повторный migrate/checksums, seed дважды, runtime verification |
| `pnpm audit --prod --audit-level=high` | PASS: известных уязвимостей не найдено на момент проверки |
| Документационный prototype UX audit | PASS на desktop `1440×1000` и mobile `390×844` |
| Реальный browser core sequence | PASS: production SPA, новый чистый PostgreSQL `18.6`, все `250` lifecycle, отдельная финальная приёмка, audit и payroll/read-back |
| Runtime desktop/mobile UI audit | PASS: `16` проверок экранов `S-01`–`S-07` и безопасного отказа защищённого audit route на desktop `1440×1000` и mobile `390×844` |

После заключительной установки с `--frozen-lockfile` frontend suite повторно прошёл все `157` тестов. Браузерный проход использовал итоговую production-сборку с перезапущенным API, а не прежний процесс раздачи assets.

Frontend coverage включает типизированные ответы и обязательный read-back, ранние route/action guards, очистку защищённого состояния при смене роли, формы и их ошибки, массовый выбор одного комплекта, подтверждения команд и восстановление всех целей без автоматического повтора mutation. Интерактивные jsdom-тесты проверяют события и DOM-состояния компонентов; они не являются браузерным сценарием через PostgreSQL.

В ходе проверки исправлены и защищены regression tests: неизменность версии комплекта при serial assignment согласно [[transactions-concurrency]], readiness финальной приёмки по полному плану произвольного подготовленного паспорта, отдельные диалоги assignment/payroll, сохранение ввода при `422`, подтверждение смены роли при незавершённой форме и вложенная закрытая граница технических кодов. Бизнес-инварианты и backend permission boundary сохранены.

### Документационный прототип

`window.runUxCopyAudit()` выполнен в обоих viewport: все `14` шагов, `70` сочетаний шага и роли, `7` системных состояний. Зафиксировано `0` нарушений UX-copy, `0` переполнений viewport и `0` browser errors. Проверены русские подписи, accessibility-текст и отсутствие технических кодов вне вложенного developer context. Это результат проверки `docs/ux/prototype.html`, а не доказательство выполнения производственных команд живой SPA.

### Реальный браузерный сценарий

На отдельной чистой PostgreSQL `18.6` через живую SPA и реальный API созданы партия `112` и три комплекта общим объёмом `250` карточек. Первые детали всех трёх комплектов проведены мастером и положительно приняты БТК. Назначения подтверждены в обоих комплектах по `112` как `1 + 59 + 52`, а в комплекте из `26` — как `1 + 25`.

Для всех `247` карточек обработки партии мастер через кнопки приложения зафиксировал начало и завершение, затем БТК положительно подтвердил качество каждой карточки. Вместе с тремя первыми деталями это дало полный `250/250 CLOSED` итог. Domain mocks, API shortcuts и SQL-обновления производственных состояний не использовались.

После этого БТК отдельно подтвердил финальную приёмку партии. Actor, время и acceptance ID совпали с обязательным read-back; закрытие карточек само по себе эту запись не создавало. В браузерном журнале полный контекст выпуска подтвердил `254` события: expected total, server total и все уникальные клиентские события совпали.

Дополнительные браузерные проверки подтвердили полный контекст назначения `59/59` и приёмки первой детали `2/2`. Оба подготовленных исполнителя открыли свои карточки без кнопок мастера и БТК. Повторный выпуск на desktop/mobile заблокирован с доступной через `aria-describedby` причиной «Партия уже выпущена; повторный выпуск недоступен».

Тестовый учёт нормо-часов отправил один export `POST`, а контрольное чтение и повторное открытие дали два успешных `GET` одной неизменяемой записи. Перезагрузка не отправила новый export. Исполнитель и operation-scoped норма сохранились.

Независимая SQL-проверка под runtime-ролью в транзакции `READ ONLY` подтвердила `FINAL_ACCEPTED`, `250/250 CLOSED` (`3` первые детали и `247` серийных), три открытых допуска и состав комплектов `112/112/26`. В БД ровно одна финальная приёмка, одна payroll-запись с совпадающим исполнителем и снимком нормы, а release correlation содержит `254` уникальных события (`250 + 3 + 1`). Дубликатов финальной приёмки и payroll нет; immutable triggers и запрет runtime `UPDATE/DELETE` проверены.

Отдельно в живом браузере проверена смена роли при незавершённой форме: отмена сохранила введённое количество `113` и не отправила `POST` смены сессии; подтверждение очистило прежнюю форму и загрузило новые permissions. В console/network наблюдались только ожидаемые ответы `401` до входа и `404` для ещё отсутствовавшей payroll-записи; неперехваченных и неожиданных browser errors не было.

Заключительный runtime UI audit прошёл `16` проверок: `S-01`–`S-07` и безопасный отказ защищённого audit route в двух viewport — desktop `1440×1000` и mobile `390×844`. Зафиксировано `0` недокументированных утечек латиницы/UUID, `0` сломанных ссылок `aria-labelledby`/`aria-describedby`, `0` неправильно расположенных или открытых по умолчанию technical exception blocks и `0` горизонтальных переполнений; `lang="ru"` сохранён. Допустимые business-коды паспорта/операций проверялись по [[ux-copy-guidelines]], без общего разрешения произвольной латиницы. Итоговые мобильные экраны партии и payroll также визуально просмотрены по снимкам.

Локальные проверки frontend, реального браузерного процесса и UI завершены. Strict documentation audit после обновления результатов: `55` документов, `0` ошибок, `0` предупреждений; semantic review отдельно сопоставил реализацию с ролями, состояниями, cardinality, recovery и AS-IS/TO-BE границами.

### Закрытие этапа 8

Для SHA `b00ff294a7b7ce1e09379c088969d9a02bd033bf` прошли [push CI](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33963228130) и [PR CI](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33963230414): `quality` и `container` успешны в обоих runs. Локальный clean-container выполнен без кэша на новом томе: миграции/seed, healthy приложение/БД, HTTP 200 для SPA и обоих health endpoints. Статусы runs и SHA повторно прочитаны через GitHub API при начале этапа 9. Старые отметки об отсутствии Docker и невыполненных commit/push устарели.

## Результаты этапа 9 — 5 сентября 2026 года

Локальные результаты ниже получены для реализации, зафиксированной implementation SHA [`3ee65709966f5775928de87783fd2946d085e2bc`](https://github.com/AI-shoks/WorkCard-Lifecycle/commit/3ee65709966f5775928de87783fd2946d085e2bc), поверх этапа 8 `b00ff294…`. Состав воспроизводимых команд и точные границы fixture — [[test-strategy]]. При синхронизации статусов тяжёлые проверки повторно не запускались; удалённые результаты этого SHA подтверждены отдельно в разделе закрытия ниже.

| Проверка | Фактическое состояние локально |
|---|---|
| Новые PostgreSQL regression tests | PASS итогового кода: `10/10` в четырёх файлах, включая audit/business/receipt rollback, SQL/history/grants failure и restart, session/CSRF/permissions, rate limit и lock timeout |
| Компактный browser lifecycle и recovery | PASS отдельно на desktop `1440×1000` и mobile `390×844`: по 2 теста, `6 CLOSED`, отдельная финальная приёмка, audit 10 и одна payroll-запись |
| Канонический browser gate | PASS: `2/2` desktop tests; полный lifecycle `250 CLOSED`, отдельная финальная приёмка, audit `254`, единственный payroll и recovery. Основной проход 14,5 минуты, suite 14,8 минуты на локальной машине |
| Dependency audit всех scopes | PASS: `pnpm security:dependencies`, известных уязвимостей не найдено |
| Secret scan | PASS: 40 Git commits и текущий исходный код; шесть узких исторических fixture fingerprints описаны в [[security-baseline]] |
| Production build и clean-container | PASS окончательного кода: no-cache build, новый том `wcl-quality-0905-verified-postgres`, БД `55479`, HTTP `35539`; migrate/seed exit 0, runtime grants, healthy app/DB, SPA/live/ready 200, UID 65532, read-only/cap-drop/no-new-privileges |
| Image vulnerabilities | PASS окончательного образа `sha256:855c8bfb1e5a2803bc06d2dca3b39915baf74667a5f6814178bb464695580f1f`: Trivy 0.74.0 проверил 14 OS и 100 Node packages, HIGH/CRITICAL 0, включая unfixed; JSON `.quality-results/image-vulnerabilities-verified.json` |
| Workflow syntax/expressions | PASS локально: actionlint 1.7.12; последующий CI implementation SHA подтверждён в разделе закрытия ниже |
| Итоговый `pnpm check` | PASS: format, lint, strict types (включая `quality/`), production build, `157` frontend и `15` API тестов (`10` обычных + `5` реальных PostgreSQL integration); integration URL явно направлены в тестовый Compose |
| Strict docs | PASS: `project-docs-auditor --fail-on-warning`, 55 документов, 0 ошибок, 0 предупреждений |
| Документационный prototype UX audit | PASS: desktop `1440×1000` и mobile `390×844`, в каждом 14 шагов, 70 ролевых вариантов, 7 системных состояний, 0 нарушений/переполнений/browser errors. Desktop canonical и mobile compact snapshots финальной приёмки также визуально просмотрены |

Браузерный негативный сценарий подтверждает реальный `409` между двумя вкладками и потерю ответа после commit с единственным event/receipt, автоматическими безопасными reads и без повторной mutation. Первый canonical запуск не завершился во время параллельного тяжёлого сканирования: trace показал успешный API response за 312 мс и задержку browser automation. Повтор без сканера прошёл, assertions и таймауты не ослаблялись. Уточнение ранее зарезервированного code `TOO_MANY_REQUESTS` после запуска браузера отдельно проверяется security suite; оно не меняет успешный lifecycle или conflict/recovery.

Первый Trivy упёрся в ресурсы при параллельном запуске; отдельный scan прежнего Debian 12 runtime обнаружил HIGH/CRITICAL OS/global npm уязвимости. Исправление — закреплённый distroless Node `24.20.0` / Debian `13.6` runtime без npm/shell, без игнорирования CVE. Build stage и production dependency versions сохранены. Проверки не объявляют временной сбой сканера или старый образ успешными.

### Производительность

Локальный профиль окончательного кода, 2026-09-05: Windows `10.0.26200`, Node `24.19.0`, Intel Core i3-10110U, 4 logical CPUs, 7,84 GiB host RAM, PostgreSQL `18.6` в Docker Desktop с примерно 3,74 GiB RAM. `quality/performance.ts` создаёт 40 партий и 120 комплектов через HTTP, всего 10 000 карточек и 12 800 событий. Команды измеряются при росте БД; чтения — после полного объёма и `ANALYZE`, с одним прогревочным detail read. Сканеры, browser suites и build при измерении не выполнялись. Никакие производственные состояния не подготавливаются SQL-изменениями. Для 40 samples median — среднее двух центральных значений; p95 — nearest rank.

| Операция | Samples | Median, ms | p95, ms |
|---|---:|---:|---:|
| Выпуск 250 карточек | 40 | 125,84 | 257,41 |
| Атомарное назначение 59 карточек | 40 | 57,64 | 147,41 |
| Detail партии при 10 000 карточек | 40 | 26,23 | 52,01 |
| Полные 112 карточек, все страницы | 40 | 56,49 | 94,74 |
| Полный audit выпуска 254, все страницы | 40 | 94,61 | 190,29 |

Четыре конкурентных detail reads завершились за 132,18 мс одним smoke sample; это не статистика нагрузки. Raw samples, timestamp и условия сохраняются в `.quality-results/performance.json` и CI artifact. Принятые документы не задают числовой бизнес-SLA: gate проверяет корректность, объём и завершение под явными runtime budgets, сохраняет показатели для сравнения. Профиль не измеряет длительную production-нагрузку, внешнюю сеть, production hardware, final acceptance на большой истории или payroll throughput. После уточнения расчёта median профиль выполнен заново; focused format/lint/quality types прошли, production-код после полного `pnpm check` не менялся.

### Целевой semantic review

Сопоставлены diff и тесты с [[acceptance-criteria]], [[mvp-scope]], [[roles-permissions]], [[glossary]], [[transactions-concurrency]], [[api-contracts]] и [[definition-of-done]]. Подтверждены отдельные first-article / per-card / final-batch действия, `112 → 3 → 250`, operation-scoped нормы, UUID без идентичности физической детали, backend permissions, атомарные audit/receipts и синтетический payroll без денег. Browser setup содержит только справочники; production mutations идут через UI. Новые fault fixtures не подменяют результат browser flow. Успешные API схемы сохранены, ответ 429 использует ранее принятый `TOO_MANY_REQUESTS`.

При проверке реализации различались прежние 5 integration tests, новые PostgreSQL и browser suites, compact и canonical, локальные результаты и последующий CI implementation SHA. Негативная приёмка, переделка, переназначение, deployment и этапы 10–12 не добавлены. Соседние пользовательские dashboard/Home/Obsidian/site изменения не входили в implementation commit этапа 9. Семантических противоречий в затронутых канонических документах не найдено; структурный audit учитывается отдельно.

## Локальные проверки укрепления этапа 10 — 2026-09-06

Текущие незакоммиченные изменения сохраняют прогресс этапа 10 ровно `4/7`. Четвёртая задача закрыта как runtime pre-deploy implementation с локальной детерминированной проверкой, но не как hosted qualification. Выполнились следующие локальные gates:

| Проверка | Результат текущего checkout |
|---|---|
| `pnpm check` | PASS на Node `24.18.0` / pnpm `11.19.0`: Prettier, ESLint, strict typecheck, `158/158` frontend tests, `24/24` обычных API tests (`6` PostgreSQL integration корректно skipped без URL), `34/34` release tests и production build |
| Focused runtime contracts | PASS: `22/22` в `app`, `config`, `runtime-protection` и web health tests; проверены exact sanitized payloads/status codes, все Pino severity mappings, safe structured logs, server-generated request ID, local XFF spoof rejection, one-hop client IP/rate-limit key и разбор encoded socket URL самим `pg` |
| Release contract | PASS: JSON Schema и cross-field bindings manifest, semantic Trivy validation, exclusive manifest write, append-only evidence sequence/hash chain и негативные сценарии |
| Workflow syntax | PASS: actionlint `1.7.12` для `ci.yml` и `release.yml`; Windows archive SHA-256 проверен |
| IAM/demo hardening | PASS runnable checks: `17/17` focused API tests для config/app/reset transaction flow, `18/18` focused interactive UI tests; capacity/session cleanup и transactional reset также имеют PostgreSQL tests, но они не исполнились без БД |
| UX-copy audit | PASS read-only `window.runUxCopyAudit()` в desktop `1440×1000` и mobile `390×844`: по `14` шагов, `70` role variants, `7` system states, `0` production violations в каждом viewport |
| Terraform contract | PASS на Terraform `1.16.1`: recursive `fmt -check`, `validate`, локальный `plan -refresh=false` `166 to add / 0 to change / 0 to destroy`; safety checker подтвердил exact IAM/actAs/job/secret matrices, единственный `allUsers`, две WIF-границы, восемь jobs, demo limits, reset и deletion guards, а также отсутствие broad roles/secret payloads/credential URLs |
| Strict docs | PASS: финальный повторный `project-docs-auditor --fail-on-warning`, `57` документов, `0` ошибок, `0` предупреждений |

Новая `Release and IaC contract` job добавлена как седьмой обязательный CI gate и включена в release preflight, но удалённо не запускалась. Plan использовал только example inputs, фиктивный локальный token и `-refresh=false`; это не обращение к GCP и не проверка существования ресурсов. В текущем shell отсутствуют Docker/PostgreSQL и `QUALITY_OWNER_URL`/integration URLs, поэтому новые реальные DB проверки reset/capacity не выдаются за успешные. `terraform apply`, `workflow_dispatch`, build/push image и deployment не выполнялись; manifest/evidence records и hosted evidence не создавались.

Смысловая сверка `backlog`/`deployment`/ADR/security/environment/API/audit contracts не нашла конфликтов: public interactive scope сохранён без tenant isolation; live retention, backup/PITR и log retention разделены; deployer indirect workload-identity risk оговорён; budget alerts не названы spending cap. Фактические IAM close/restore, daily reset, Cloud Logging ingestion, Cloud Run header chain и Cloud SQL socket mount/connection явно оставлены обязательным hosted evidence.

Отдельный локальный `pnpm security:secrets` текущего diff не стартовал: Docker CLI отсутствует в данном shell, поэтому дочерний Gitleaks вернул `status=null`. Это не трактуется ни как находка, ни как успешный scan; прежние подтверждённые результаты этапа 9 остаются историческими, а новая версия всё ещё должна пройти обязательную удалённую `security` job.

## Закрытие этапа 9 — 2026-09-05

Implementation SHA [`3ee65709966f5775928de87783fd2946d085e2bc`](https://github.com/AI-shoks/WorkCard-Lifecycle/commit/3ee65709966f5775928de87783fd2946d085e2bc) на момент проверки совпадал с локальным HEAD и head [PR #1](https://github.com/AI-shoks/WorkCard-Lifecycle/pull/1) в `codex/portfolio`. GitHub API подтвердил `head_sha`, событие, `completed/success` обоих исторических runs и каждой обязательной на том SHA job: [push CI 33970654850](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33970654850) и [PR CI 33970656850](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33970656850), attempt 1.

| Обязательная job | Push | PR |
|---|---|---|
| `quality` — Code and database quality | [success](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33970654850/job/101318449484) | [success](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33970656850/job/101318454526) |
| `container` — Clean container startup, включая image scan | [success](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33970654850/job/101318641884) | [success](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33970656850/job/101318638566) |
| `security` — Dependency and secret security | [success](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33970654850/job/101318449620) | [success](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33970656850/job/101318454641) |
| `browser (compact)` — Browser (compact) | [success](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33970654850/job/101318641905) | [success](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33970656850/job/101318638658) |
| `browser (canonical)` — Browser (canonical) | [success](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33970654850/job/101318641863) | [success](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33970656850/job/101318638591) |
| `performance` — Representative performance profile | [success](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33970654850/job/101318641906) | [success](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33970656850/job/101318638598) |

Итого 6/6 обязательных jobs успешны в каждом запуске, 12/12 суммарно; обязательный шаг сканирования образа также завершён успешно в обоих runs. Результаты прежних этапов сохранены выше со своими SHA и CI. Эти runs проверяют implementation commit этапа 9; текущая синхронизация документации в них не входила.

Синхронизация статусов после закрытия прошла `project-docs-auditor --fail-on-warning`: 55 документов, 0 ошибок, 0 предупреждений. Отдельная смысловая сверка не нашла конфликтов статусов, `git diff --check` — PASS. Тяжёлые тесты повторно не запускались.

## Правило слияния

Изменение не готово к commit/PR review, пока релевантный gate не прошёл либо ограничение не описано явно. Failing gate не отключается ради зелёного статуса.
