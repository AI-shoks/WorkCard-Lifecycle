---
artifact_id: engineering.repository-structure
status: accepted
version: 1
owner: engineering
updated: 2026-07-19
---

# Repository Structure

Каноническая структура Foundation Gate. Она готовит модульный монолит, но не скрывает реализацию Gate 2.

```text
.
├── .github/workflows/ci.yml       publication quality gate
├── db/
│   ├── bootstrap/                 создание локальной runtime role
│   └── migrations/                forward-only SQL migrations
├── docs/                          канонические project/domain/engineering документы
├── openapi/openapi.json           generated и committed API snapshot
├── scripts/                       OpenAPI, secret scan и test-DB bootstrap
├── src/workcard_api/              FastAPI Foundation package
├── tests/
│   ├── unit/                      unit/API/security contract tests
│   └── integration/               PostgreSQL и least-privilege tests
├── Dockerfile
├── compose.yaml
├── pyproject.toml
├── requirements.txt
└── requirements-dev.txt
```

## Границы Foundation

`src/workcard_api` содержит configuration, application factory, PostgreSQL gateway, migrations, health/metrics/logging, prepared demo-session и единый error contract. Миграции содержат принятую physical schema, synthetic reference data и server-side session registry.

Import, generation, assignment, WorkCard lifecycle, БТК, payroll commands, background jobs, React SPA и business repositories не реализованы. Это последующие slices этапа 6 и Gate 2, которые остаются не начатыми.

## Правила владения

- runtime code не выполняет migrations и использует только `WORKCARD_DATABASE_URL`;
- migration CLI требует отдельный `WORKCARD_MIGRATION_DATABASE_URL`;
- test/admin DSN применяется только для подготовки изолированной integration database и privilege assertions;
- OpenAPI меняется только через `scripts/export_openapi.py` и проверяется snapshot gate;
- новые SQL-изменения добавляются следующим свободным номером, применённые migrations не переписываются;
- generated caches, coverage, `.env`, venv и PostgreSQL data directory не являются repository artifacts.
