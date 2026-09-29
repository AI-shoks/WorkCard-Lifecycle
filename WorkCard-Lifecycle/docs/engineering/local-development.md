---
artifact_id: engineering.local-development
status: accepted
version: 8
owner: engineering
updated: 2026-09-27
---

# Local Development

Основной локальный путь — Docker Compose. Он одинаково запускает PostgreSQL, owner bootstrap (migrations + initial seed + verify) и production-сборку приложения, не требуя локальной установки PostgreSQL.

## Предварительные условия

- Docker Desktop с запущенным Linux engine;
- для host-команд — Node.js из `.node-version` и `pnpm` из `packageManager`;
- свободные loopback-порты `3000` и `55439` либо их переопределение в локальном `.env`.

`.env.example` содержит безопасные runtime demo-значения; `.env.owner.example` — отдельные local owner values. Не загружайте owner env в API shell. Из корня `WorkCard-Lifecycle` создайте только отсутствующие локальные файлы, сохранив существующие настройки:

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
if (-not (Test-Path .env.owner)) { Copy-Item .env.owner.example .env.owner }
```

Оба файла исключены из Git. Runtime отвергает `MIGRATION_DATABASE_URL` и `APP_DATABASE_PASSWORD` во всех средах; при переносе прежнего объединённого `.env` сначала разделите их. Ни `.env`, ни `.env.owner` не подходят для Neon.

## Чистый запуск

```powershell
docker compose config --quiet
docker compose up --build --wait --wait-timeout 180
docker compose run --rm --no-deps readiness
```

После готовности:

- приложение: `http://localhost:3000/`;
- liveness: `http://localhost:3000/health/live`;
- readiness: `http://localhost:3000/health/ready`;
- OpenAPI: `http://localhost:3000/api/openapi.json`;
- PostgreSQL для host-команд: `127.0.0.1:55439`.

Owner `bootstrap` должен завершиться с кодом `0`, а `database` и `app` — перейти в `healthy` во время `up --wait`. После этого отдельный `run readiness` должен завершиться с кодом `0`. Docker HEALTHCHECK проверяет `/health/live` на фактическом `PORT`, поэтому одного `healthy` недостаточно для доказательства готовой DB/schema/gate. Compose и CI отдельно проверяют `/health/ready`.

Повторный запуск с сохранённым томом не обновляет время последнего reset. Если оно старше 26 часов, bootstrap не откроет gate: это ожидаемый отказ, а не повод удалить том. Владелец отдельно решает, допустим ли `db:reset-demo` с удалением изменяемых demo-данных и сессий; его owner-подготовка описана в [[database-bootstrap]].

Одноразовый service `readiness` находится в профиле `checks` и вызывается явно после `up --wait`: явный target автоматически доступен без включения профиля, согласно [Compose profiles](https://docs.docker.com/compose/how-tos/profiles/). Это исключает ожидание running/healthy для уже завершившейся standalone probe; соответствующее поведение `--wait` видно в [Compose start implementation](https://raw.githubusercontent.com/docker/compose/main/pkg/compose/start.go). `bootstrap` остаётся обычной dependency приложения с `service_completed_successfully`.

## Разработка на host

Сначала подготовьте и оставьте работающую БД по Compose-инструкции выше либо используйте отдельную PostgreSQL по следующему разделу. `pnpm dev` сам не запускает PostgreSQL и не выполняет bootstrap. Если Compose-приложение уже занимает `3000`, остановите только его командой `docker compose stop app`, сохранив работающую `database`.

В новой runtime shell, из корня проекта:

```powershell
pnpm install --frozen-lockfile
$env:DOTENV_CONFIG_PATH = (Resolve-Path '.env').Path
pnpm dev
```

API и owner CLI импортируют `dotenv/config`; package scripts исполняются из `apps/api`, поэтому корневая `.env` и тем более `.env.owner` автоматически не выбираются. Абсолютный `DOTENV_CONFIG_PATH` делает выбор явным. Уже установленные переменные shell имеют приоритет над файлом: runtime shell должна быть свободна от owner credentials, а owner-команды выполняются в другой shell.

Vite обслуживает frontend на `http://localhost:5173` с hot reload и проксирует `/api` и `/health` на фиксированный `http://127.0.0.1:3000` из `apps/web/vite.config.ts`. Для этого пути оставьте API `PORT=3000`; переопределение порта Compose не меняет Vite proxy. Для контейнерной БД используется runtime URL из `.env`; при изменении `POSTGRES_PORT` обновите и этот URL.

`APP_ORIGIN=http://localhost:5173` разрешает mutation через Vite proxy. Compose передаёт отдельный `COMPOSE_APP_ORIGIN=http://localhost:3000`, поскольку production-сборка SPA и API работает под одним origin. `SESSION_SIGNING_SECRET` в `.env.example` допустим только для локального синтетического контура.

DB integration tests запускаются после owner bootstrap против отдельной disposable БД или CI service. В отдельной test shell явно задайте `INTEGRATION_DATABASE_URL` и `INTEGRATION_MIGRATION_DATABASE_URL` только для этого локального target; application URL не используется как fallback:

```powershell
pnpm --filter @work-card/api test:integration
```

### Проверка с отдельной PostgreSQL на host

Если Docker недоступен, browser/API и DB integration можно проверить с PostgreSQL `18.6` на host, в том числе portable runtime на Windows. Для этого выделяют отдельный cluster с loopback listener и две чистые БД: одну для браузерного сценария, вторую для integration suite. Системный PostgreSQL, его службы и существующие данные не используются и не перенастраиваются. Порт выбирается свободным и не является частью предметной fixture.

После создания отдельной пустой DB выполняйте owner команды в отдельной shell: env names `MIGRATION_DATABASE_URL`, `APP_DATABASE_USER`, `APP_DATABASE_PASSWORD` берутся из ignored `.env.owner` для disposable target. Runtime shell имеет только `.env` с runtime `DATABASE_URL`; реальные значения/URL не публикуются.

```powershell
$env:DOTENV_CONFIG_PATH = (Resolve-Path '.env.owner').Path
pnpm db:bootstrap
pnpm db:bootstrap
pnpm db:verify
```

Повтор проверяет SQL checksums, seed fixtures и role boundary, не продлевая reset timestamp. Owner verify использует catalog checks и не требует runtime URL. Прямой отказ mutation проверяют integration/quality suite runtime connections. Bootstrap integration target отдельно от DB активного browser сценария. Через 26 часов нужно выполнить owner `pnpm db:reset-demo`; повтор bootstrap не является заменой reset.

Host PostgreSQL подтверждает работу реальной БД и API, но не проверяет Dockerfile, Compose, Linux image или clean-container startup. Контейнерный gate остаётся отдельным обязательством.

### Production SPA на host и обновление assets

Для проверки собранной SPA сервер API должен раздавать текущую `apps/web/dist` под тем же origin. В чистой runtime shell без owner env до запуска задайте `APP_ENV=development` либо `test`, runtime `DATABASE_URL`, точный `APP_ORIGIN`, loopback `HOST`/свободный `PORT` и локальный `SESSION_SIGNING_SECRET` согласно [[environments]]. Путь к сборке передавайте абсолютным, потому что package script запускается из `apps/api`:

```powershell
pnpm build
$env:DOTENV_CONFIG_PATH = (Resolve-Path '.env').Path
$env:APP_ORIGIN = 'http://localhost:3000'
$env:HOST = '127.0.0.1'
$env:PORT = '3000'
$env:WEB_DIST_PATH = (Resolve-Path 'apps/web/dist').Path
pnpm --filter @work-card/api start
```

Пример использует свободный `3000` и локальную `.env`; при другом порте измените вместе `PORT` и `APP_ORIGIN`. В этой same-origin схеме значение `APP_ORIGIN=http://localhost:5173` из Vite-примера не подходит.

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

### Историческая проверка checkout от 5 сентября 2026 года

Для frontend-работ этапа 8 поднят отдельный portable PostgreSQL `18.6` на Windows с раздельными чистыми browser/integration БД. Применение миграций `0001`–`0003`, повторный migrate с проверкой checksums, seed дважды, runtime verification и все `5/5` реальных PostgreSQL integration tests завершились успешно. Системные службы и существующие данные не менялись.

Первоначальная отметка о недоступном Docker устарела: установленный Docker Desktop был запущен, выполнен clean-container без кэша с новым томом, миграциями, seed, healthy app/DB и HTTP 200 SPA/health. Этап 8 завершён SHA `b00ff294a7b7ce1e09379c088969d9a02bd033bf`; [push CI](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33963228130) и [PR CI](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33963230414) подтвердили `quality`/`container`. Эти результаты не доказывают последующие изменения этапа 9.

## Изолированные проверки этапа 9

Для тестов нужен отдельный PostgreSQL server/control DB и owner с правом создавать disposable БД/роли. `QUALITY_OWNER_URL` обязателен: fallback на application DB отсутствует. Guard разрешает только явно допустимый local/CI host; его нельзя ослаблять ради Neon. Каждый suite создаёт собственную `q9_*` БД и runtime-роль, удаляя только их после выполнения. Справочные fixtures не создают production batches/cards/results.

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

## Статическая сверка запуска 27 сентября 2026 года

Команды сопоставлены с root/API/web `package.json`, `.node-version`, `compose.yaml`, `Dockerfile`, env examples, `config.ts`, `server.ts`, `owner-cli.ts` и Vite proxy. Исправлен явный выбор env-файлов для host-команд. Приложение, контейнеры, bootstrap/reset, браузер и тестовые сценарии в этом аудите не запускались. Позднее пользователь подтвердил успешную ручную проверку демо, не указав SHA/окружение; это не отдельное доказательство clean startup текущего рабочего дерева. Исторические результаты выше не переносятся на него автоматически.
