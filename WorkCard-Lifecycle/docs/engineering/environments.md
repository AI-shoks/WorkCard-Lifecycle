---
artifact_id: engineering.environments
status: accepted
version: 1
owner: engineering
updated: 2026-07-19
---

# Environments and Secrets

Configuration загружается только из `WORKCARD_*`, валидируется Pydantic при старте и не возвращается через API/health/logs.

## Назначение DSN

| Переменная | Назначение | Допустимый процесс |
|---|---|---|
| `WORKCARD_DATABASE_URL` | least-privilege runtime role | API, readiness, integration runtime operations |
| `WORKCARD_MIGRATION_DATABASE_URL` | owner/migrator role | только explicit migration CLI |
| `WORKCARD_TEST_DATABASE_URL` | admin/setup role изолированного test cluster | bootstrap roles и privilege assertions |

Migration DSN больше не подменяется runtime DSN при отсутствии значения. Runtime role не является owner, superuser и не имеет `CREATEDB`, `CREATEROLE` или schema DDL.

## Основные переменные

- `WORKCARD_ENVIRONMENT=local|test|staging|production`;
- `WORKCARD_SESSION_SIGNING_SECRET` — минимум 32 неплейсхолдерных символа;
- `WORKCARD_SESSION_TTL_SECONDS` — `60..86400`;
- `WORKCARD_ALLOWED_ORIGINS` — непустой allowlist без `*`;
- `WORKCARD_COOKIE_SECURE` — обязательно `true` для staging/production;
- pool/timeout/log/metrics settings — только несекретные operational параметры.

Staging/production origins обязаны использовать HTTPS. Cookie остаётся `HttpOnly`, `Secure`, `SameSite=Strict` и имеет узкий API path. Uvicorn container запускается с отключённым доверием к произвольным forwarded headers.

## Secret handling

`.env` и credential files запрещены в repository; `.env.example` содержит только нерабочие placeholders. CI использует исключительно synthetic test credentials. Усиленный scanner проверяет private keys, GitHub/AWS/JWT/Slack/Stripe/Azure-like tokens, password assignments и database URLs; allowlist ограничен документированными placeholders и scanner self-test fixture.
