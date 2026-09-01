---
artifact_id: engineering.local-development
status: accepted
version: 1
owner: engineering
updated: 2026-09-01
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

- приложение: `http://127.0.0.1:3000/`;
- liveness: `http://127.0.0.1:3000/health/live`;
- readiness: `http://127.0.0.1:3000/health/ready`;
- OpenAPI: `http://127.0.0.1:3000/api/openapi.json`;
- PostgreSQL для host-команд: `127.0.0.1:55439`.

Контейнеры `migrate` и `seed` должны завершиться с кодом `0`; `database` и `app` — перейти в `healthy`.

## Разработка на host

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

Vite обслуживает frontend с hot reload и проксирует `/api` и `/health` на API. Для работы с контейнерной БД host-процессы используют URL из `.env`.

## Диагностика и остановка

```powershell
docker compose ps --all
docker compose logs --follow app database
docker compose down
```

`docker compose down --volumes` дополнительно удаляет только именованный том `work-card-lifecycle-postgres` и все локальные demo-данные. Эту команду выполняют осознанно перед проверкой полностью чистого bootstrap.

## Проверенный baseline

1 сентября 2026 года clean build создал образ, PostgreSQL 18.6 применил миграцию `0001`, повторные migration/seed завершились без изменений, а UI и оба health endpoint ответили успешно. Особенность рабочей станции — занятые локальными PostgreSQL порты `5432` и `55432`, поэтому проект использует `55439` по умолчанию.
