---
artifact_id: engineering.local-development
status: accepted
version: 5
owner: engineering
updated: 2026-09-05
---

# Local Development

Основной локальный путь — Docker Compose. Он одинаково запускает PostgreSQL, миграцию, детерминированный seed и production-сборку приложения, не требуя локальной установки PostgreSQL.

## Предварительные условия

- Docker Desktop с запущенным Linux engine;
- для host-команд — Node.js из `.node-version` и `pnpm` из `packageManager`;
- свободные loopback-порты `3000` и `55439` либо их переопределение в локальном `.env`.

`.env.example` содержит только безопасные demo-значения. При необходимости создайте локальный файл:

```powershell
Copy-Item .env.example .env
```

`.env` исключён из Git.

## Чистый запуск

```powershell
docker compose config --quiet
docker compose up --build --wait --wait-timeout 180
```

После готовности:

- приложение: `http://localhost:3000/`;
- liveness: `http://localhost:3000/health/live`;
- readiness: `http://localhost:3000/health/ready`;
- OpenAPI: `http://localhost:3000/api/openapi.json`;
- PostgreSQL для host-команд: `127.0.0.1:55439`.

Контейнеры `migrate` и `seed` должны завершиться с кодом `0`; `database` и `app` — перейти в `healthy`.

## Разработка на host

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

Vite обслуживает frontend с hot reload и проксирует `/api` и `/health` на API. Для работы с контейнерной БД host-процессы используют URL из `.env`.

`APP_ORIGIN=http://localhost:5173` разрешает mutation через Vite proxy. Compose передаёт отдельный `COMPOSE_APP_ORIGIN=http://localhost:3000`, поскольку production-сборка SPA и API работает под одним origin. `SESSION_SIGNING_SECRET` в `.env.example` допустим только для локального синтетического контура.

DB integration tests запускаются после migrate/seed против отдельной disposable БД или CI service:

```powershell
$env:INTEGRATION_DATABASE_URL = $env:DATABASE_URL
$env:INTEGRATION_MIGRATION_DATABASE_URL = $env:MIGRATION_DATABASE_URL
pnpm --filter @work-card/api test:integration
```

### Проверка с отдельной PostgreSQL на host

Если Docker недоступен, browser/API и DB integration можно проверить с PostgreSQL `18.6` на host, в том числе portable runtime на Windows. Для этого выделяют отдельный cluster с loopback listener и две чистые БД: одну для браузерного сценария, вторую для integration suite. Системный PostgreSQL, его службы и существующие данные не используются и не перенастраиваются. Порт выбирается свободным и не является частью предметной fixture.

После создания отдельной пустой БД задайте owner/runtime URL и учётные данные через локальное окружение; placeholders ниже нужно заменить своими значениями, не сохраняя их в документации:

```powershell
$env:MIGRATION_DATABASE_URL = '<owner-url-for-disposable-database>'
$env:DATABASE_URL = '<runtime-url-for-the-same-database>'
$env:APP_DATABASE_USER = '<runtime-role-name>'
$env:APP_DATABASE_PASSWORD = '<runtime-password>'
pnpm db:migrate
pnpm db:migrate
pnpm db:seed
pnpm db:seed
pnpm db:verify
```

Повторный migrate проверяет уже применённые версии и checksums, повторный seed подтверждает неизменность reference data, а `db:verify` подключается именно runtime-ролью. Выполните тот же bootstrap для второй чистой БД, направьте на неё `INTEGRATION_DATABASE_URL` и `INTEGRATION_MIGRATION_DATABASE_URL` и запустите integration suite. Не направляйте integration suite на БД активного браузерного сценария.

Host PostgreSQL подтверждает работу реальной БД и API, но не проверяет Dockerfile, Compose, Linux image или clean-container startup. Контейнерный gate остаётся отдельным обязательством.

### Production SPA на host и обновление assets

Для проверки собранной SPA сервер API должен раздавать текущую `apps/web/dist` под тем же origin. До запуска задайте `DATABASE_URL`, точный `APP_ORIGIN`, loopback `HOST`/свободный `PORT` и локальный `SESSION_SIGNING_SECRET` согласно [[environments]]. Путь к сборке передавайте абсолютным, потому что package script запускается из `apps/api`:

```powershell
pnpm build
$env:WEB_DIST_PATH = (Resolve-Path 'apps/web/dist').Path
pnpm --filter @work-card/api start
```

После каждого нового `pnpm build` production API необходимо остановить и запустить заново. `@fastify/static` зарегистрирован с `wildcard: false`, поэтому пути файлов фиксируются при запуске API; новая Vite-сборка меняет имена assets. Если оставить старый процесс, запрос нового `.js`/`.css` может попасть в SPA fallback и получить HTML.

После перезапуска проверьте `/`, `/health/live`, `/health/ready` и browser Network/Console. Файлы из актуального `index.html` должны отвечать `200` с JavaScript/CSS MIME-типом, а не `text/html`; ошибок загрузки модулей и MIME mismatch быть не должно. Vite development server использует свой hot reload и не заменяет эту проверку production-раздачи.

## Диагностика и остановка

```powershell
docker compose ps --all
docker compose logs --follow app database
docker compose down
```

`docker compose down --volumes` дополнительно удаляет только именованный том `work-card-lifecycle-postgres` и все локальные demo-данные. Эту команду выполняют осознанно перед проверкой полностью чистого bootstrap.

## Проверенный baseline

1 сентября 2026 года foundation clean build создал образ и подтвердил UI/health. 2 сентября implementation commit [`17d2b04d13b58c7dff677543ed4399751a8593a1`](https://github.com/AI-shoks/WorkCard-Lifecycle/commit/17d2b04d13b58c7dff677543ed4399751a8593a1) прошёл local clean-container startup; отдельная чистая БД применила `0001`–`0003`, повторный seed/verify и 5 backend integration tests. Основной Compose-стек также пересобран с сохранением существующего volume. [Push CI](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33581627867) и [PR CI](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33581630041) для того же SHA подтвердили code/database quality и clean-container startup; проектный PostgreSQL использует `55439` по умолчанию.

### Проверка текущего checkout 5 сентября 2026 года

Для frontend-работ этапа 8 поднят отдельный portable PostgreSQL `18.6` на Windows с раздельными чистыми browser/integration БД. Применение миграций `0001`–`0003`, повторный migrate с проверкой checksums, seed дважды, runtime verification и все `5/5` реальных PostgreSQL integration tests завершились успешно. Системные службы и существующие данные не менялись.

Первоначальная отметка о недоступном Docker устарела: установленный Docker Desktop был запущен, выполнен clean-container без кэша с новым томом, миграциями, seed, healthy app/DB и HTTP 200 SPA/health. Этап 8 завершён SHA `b00ff294a7b7ce1e09379c088969d9a02bd033bf`; [push CI](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33963228130) и [PR CI](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33963230414) подтвердили `quality`/`container`. Эти результаты не доказывают последующие изменения этапа 9.

## Изолированные проверки этапа 9

Для тестов нужен отдельный PostgreSQL server/control DB и owner с правом создавать disposable БД/роли. `QUALITY_OWNER_URL` обязателен: fallback на application DB отсутствует. Каждый suite создаёт собственную `q9_*` БД и runtime-роль, удаляя только их после выполнения. Справочные fixtures не создают production batches/cards/results.

```powershell
$env:QUALITY_OWNER_URL = '<owner-url-for-isolated-local-control-database>'
pnpm test:quality
pnpm build
pnpm exec playwright install chromium
pnpm test:browser
pnpm test:browser:canonical
pnpm test:performance
pnpm security:dependencies
pnpm security:secrets
```

Compact browser suite проверяет 6 карточек на desktop/mobile; отдельная canonical команда проходит все 250 через UI. Performance создаёт 40 партий / 10 000 карточек через API и сохраняет измерения в `.quality-results/performance.json`. Не запускайте измерения или браузер вместе с тяжёлым build/image scan на ограниченной машине. Точные условия и результаты — в [[quality-gates]].

Для отдельного Compose используйте `-p <quality-project> -f compose.yaml -f quality/compose.override.yaml`, задав `QUALITY_PROJECT` тем же значением, свободные `POSTGRES_PORT`/`PORT` и соответствующий `COMPOSE_APP_ORIGIN`. Override меняет не только project name, но и явно именованный volume/image. До старта проверьте отсутствие такого volume; до удаления — точные имена и Compose labels. Остановка с `down --volumes` допустима только для этого проверенного тестового проекта, а не для обычного demo stack. Установка Docker повторно и глобальный prune не нужны.
