---
artifact_id: engineering.local-development
status: accepted
version: 2
owner: engineering
updated: 2026-09-02
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

## Диагностика и остановка

```powershell
docker compose ps --all
docker compose logs --follow app database
docker compose down
```

`docker compose down --volumes` дополнительно удаляет только именованный том `work-card-lifecycle-postgres` и все локальные demo-данные. Эту команду выполняют осознанно перед проверкой полностью чистого bootstrap.

## Проверенный baseline

1 сентября 2026 года foundation clean build создал образ и подтвердил UI/health. 2 сентября текущий backend checkout прошёл local clean-container startup; отдельная чистая БД применила `0001`–`0003`, повторный seed/verify и 5 backend integration tests. Основной Compose-стек также пересобран из текущего checkout с сохранением существующего volume. Удалённый CI этого незакоммиченного diff ещё не запускался; проектный PostgreSQL использует `55439` по умолчанию.
