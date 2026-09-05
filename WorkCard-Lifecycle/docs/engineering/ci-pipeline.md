---
artifact_id: engineering.ci-pipeline
status: accepted
version: 5
owner: engineering
updated: 2026-09-05
---

# CI Pipeline

GitHub Actions workflow находится в `.github/workflows/ci.yml` относительно Git checkout root. Исходный workspace расположен в `WorkCard-Lifecycle/`, поэтому общий `defaults.run.working-directory` направляет все shell steps в корень приложения. Такое размещение позволяет GitHub обнаружить workflow и сохраняет код проекта в существующей директории репозитория.

## Триггеры и безопасность

Pipeline запускается для pull request и push в `main`/`codex/**`. Concurrency отменяет устаревший run той же ветки. Workflow имеет только `contents: read`; deployment, публикация образа и запись в репозиторий отсутствуют.

Dependency install использует Node из `WorkCard-Lifecycle/.node-version`, фиксированный `pnpm` и `pnpm install --frozen-lockfile`. Cache key явно строится по `WorkCard-Lifecycle/pnpm-lock.yaml`. Lockfile проходит включённую minimum-release-age policy; build-script разрешён только пакету `esbuild`.

## Job `quality`

1. поднимает чистую PostgreSQL 18.6 service;
2. устанавливает зависимости с pnpm cache;
3. выполняет `pnpm check`;
4. применяет миграцию;
5. выполняет seed дважды;
6. запускает runtime DB verification;
7. запускает backend integration suite с runtime и owner URL;
8. валидирует Compose model.

Owner и runtime credentials существуют только в job environment и являются синтетическими.

Dependency audit, secret scan и image vulnerability scan в текущий workflow не входят; это явный security/quality gap этапа 9, а не уже реализованный gate.

## Job `container`

Job зависит от `quality`, строит multi-stage образ через `docker compose up --build --wait`, проверяет liveness, readiness и SPA. При ошибке печатает container logs; cleanup с удалением ephemeral volumes выполняется всегда.

## Кэширование и артефакты

Кэшируется только pnpm store по lockfile. `node_modules`, собранный образ, БД и секреты не публикуются. Container build остаётся clean-room доказательством, а не использует host `node_modules` благодаря `.dockerignore`.

## Критерий принятия

Закрытие этапа требует зелёных `quality` и `container` jobs для одного implementation SHA, содержащего проверяемую реализацию. Локальные проверки, portable PostgreSQL и успешные runs прежнего SHA не подменяют этот gate. Commit и push выполняются только после отдельного разрешения пользователя; отсутствие такого разрешения не разрешает отмечать удалённый CI выполненным.

Workflow обнаруживается GitHub из корневой `.github/workflows/`, а shell steps выполняются в `WorkCard-Lifecycle/`. Implementation commit [`17d2b04d13b58c7dff677543ed4399751a8593a1`](https://github.com/AI-shoks/WorkCard-Lifecycle/commit/17d2b04d13b58c7dff677543ed4399751a8593a1) подтверждён полностью зелёными [push CI](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33581627867) и [PR CI](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33581630041): в обоих запусках jobs `Code and database quality` и `Clean container startup` завершены успешно. Это закрывает удалённый acceptance gate этапа 7. Неблокирующее предупреждение GitHub о переводе runtime используемых actions с Node.js 20 на 24 учтено как maintenance item в [[backlog]].

## Состояние проверки этапа 8 на 5 сентября 2026 года

Текущие изменения frontend vertical slice находятся в рабочем checkout без нового implementation commit. Удалённый CI для них ещё не запускался; приведённые выше runs доказывают только этап 7 и не распространяются на незакоммиченные изменения.

Локальная проверка использовала отдельный portable PostgreSQL `18.6` на Windows, раздельные чистые browser/integration БД и реальные backend integration tests. Миграции `0001`–`0003`, повторный migrate/checksums, seed дважды, runtime verification и `5/5` integration tests прошли. Системные службы и данные не менялись. Docker отсутствует, поэтому local clean-container текущего checkout остаётся непроверенным; portable runtime не является доказательством job `container`.

Оставшиеся условия — clean-container текущей реализации и полностью зелёные `quality`/`container` для одного её implementation SHA. Их статус учитывается в [[backlog]], без переноса исторического успеха этапа 7 на этап 8.
