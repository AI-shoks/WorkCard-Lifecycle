---
artifact_id: engineering.ci-pipeline
status: accepted
version: 2
owner: engineering
updated: 2026-09-02
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
7. валидирует Compose model.

Owner и runtime credentials существуют только в job environment и являются синтетическими.

## Job `container`

Job зависит от `quality`, строит multi-stage образ через `docker compose up --build --wait`, проверяет liveness, readiness и SPA. При ошибке печатает container logs; cleanup с удалением ephemeral volumes выполняется всегда.

## Кэширование и артефакты

Кэшируется только pnpm store по lockfile. `node_modules`, собранный образ, БД и секреты не публикуются. Container build остаётся clean-room доказательством, а не использует host `node_modules` благодаря `.dockerignore`.

## Критерий принятия

Workflow обнаруживается GitHub из корневой `.github/workflows/`, а shell steps выполняются в `WorkCard-Lifecycle/`. Оба jobs должны пройти на первом remote run после исправления размещения; локальные code gates остаются отдельным обязательным доказательством.
