---
artifact_id: engineering.quality-gates
status: accepted
version: 6
owner: engineering
updated: 2026-09-05
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

## Проверка текущего checkout этапа 8 — 5 сентября 2026 года

Результаты ниже относятся к текущей локальной реализации и учитываются отдельно от исторического implementation SHA этапа 7. Они не означают закрытие этапа 8: обязательные browser/container/CI gates перечислены отдельно.

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

Локальные проверки frontend, реального браузерного процесса и UI завершены. Strict documentation audit после обновления результатов: `55` документов, `0` ошибок, `0` предупреждений; semantic review отдельно сопоставил реализацию с ролями, состояниями, cardinality, recovery и AS-IS/TO-BE границами. Локальное завершение не отменяет оставшиеся container/CI требования.

### Оставшиеся обязательные gates

- подтвердить clean-container startup текущего checkout: Docker в доступной среде отсутствует, portable Windows PostgreSQL этот gate не доказывает;
- получить зелёные `quality` и `container` jobs для одного implementation SHA текущей реализации; её изменения ещё не закоммичены и удалённым CI не проверены;
- после будущих изменений для container/CI повторить релевантные проверки и перед закрытием подтвердить strict documentation audit и semantic review окончательного состояния.

Исторические зелёные jobs SHA `17d2b04d13b58c7dff677543ed4399751a8593a1` доказывают только этап 7. Commit/push требуют отдельного разрешения; отсутствие такого разрешения не меняет Definition of Done. Расширенные security/performance и полный автоматизированный browser E2E gate остаются этапу 9.

## Правило слияния

Изменение не готово к commit/PR review, пока релевантный gate не прошёл либо ограничение не описано явно. Failing gate не отключается ради зелёного статуса.
