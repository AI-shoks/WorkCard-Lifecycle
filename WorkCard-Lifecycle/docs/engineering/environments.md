---
artifact_id: engineering.environments
status: accepted
version: 1
owner: engineering
updated: 2026-09-01
---

# Environments and Secrets

Конфигурация поступает только через environment variables. Образ не содержит environment-specific секретов и одинаков для local, test, staging и production.

## Контуры

| Контур | Данные | БД | Секреты | Назначение |
|---|---|---|---|---|
| local | детерминированные синтетические | Docker volume | локальный `.env` с demo-значениями | разработка и демонстрация |
| test/CI | синтетические, пересоздаются | ephemeral PostgreSQL service | job environment | автоматические проверки |
| staging | только разрешённые синтетические | управляемая отдельная БД | secret store платформы | smoke и приёмка релиза |
| production | только разрешённые данные MVP | управляемая отдельная БД | secret store платформы | публичный portfolio demo |

Реальные производственные, кадровые и расчётные данные не допускаются ни в один контур MVP.

## Переменные приложения

| Переменная | Потребитель | Правило |
|---|---|---|
| `APP_ENV` | API | только `development`, `test`, `staging`, `production` |
| `APP_VERSION` | API/health | версия сборки без секрета |
| `HOST`, `PORT` | API | bind address и порт |
| `LOG_LEVEL` | API | разрешённый уровень Pino |
| `DATABASE_URL` | API/verify | только runtime-роль |
| `WEB_DIST_PATH` | API | каталог собранного SPA |

## Переменные bootstrap

| Переменная | Доступ | Правило |
|---|---|---|
| `MIGRATION_DATABASE_URL` | только migrate/seed job | owner/DDL, не передаётся API |
| `APP_DATABASE_USER` | migrate, app, verify | безопасный PostgreSQL identifier |
| `APP_DATABASE_PASSWORD` | migrate и формирование runtime URL | секрет; не логируется |
| `POSTGRES_*` | local/CI database service | инфраструктурные значения контура |

Compose формирует внутренние URL с hostname `database`; host-команды используют loopback URL из `.env`. Пароли с произвольными спецсимволами в hosted environment передаются готовыми URL, корректно закодированными secret store.

## Политика секретов

- `.env` и логи исключены из Git; `.env.example` не содержит настоящих секретов.
- owner URL отсутствует в environment runtime-контейнера `app`.
- логи редактируют `authorization`, cookie и CSRF header.
- секреты не передаются в browser bundle, health response или OpenAPI.
- staging/production credentials уникальны для контура и ротируются платформой.
- утечка секрета требует ротации; удаление строки из Git не считается устранением утечки.

## Критерий принятия

Compose model проверен, runtime-контейнер стартует без owner URL, а отдельная проверка подтверждает read-only права роли приложения.
