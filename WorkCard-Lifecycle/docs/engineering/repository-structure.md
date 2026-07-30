---
artifact_id: engineering.repository-structure
status: accepted
version: 2
owner: engineering
updated: 2026-07-31
---

# Repository Structure

Каноническая структура Stage 6 сохраняет Foundation ownership boundaries и явно показывает добавленные Gate 2 slices.

```text
.
├── .github/workflows/ci.yml       publication quality gate
├── db/
│   ├── bootstrap/                 создание локальной runtime role
│   └── migrations/                forward-only SQL migrations
├── docs/                          канонические project/domain/engineering документы
├── openapi/openapi.json           generated и committed API snapshot
├── scripts/                       OpenAPI, secret scan и test-DB bootstrap
├── src/workcard_api/              FastAPI foundation и Gate 2 services/repositories
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

`src/workcard_api` содержит configuration, application factory, PostgreSQL gateway, migrations, health/metrics/logging, prepared demo-session, единый error contract, а также добавленные production-batch и `ReleaseWorkCards` domain/PostgreSQL slices. Миграции сохраняют принятую physical schema, synthetic reference data и server-side session registry.

Gate 2.1 и Gate 2.2B реализованы в рабочей ветке; Gate 2.2C API/test/OpenAPI diff находится в remediation и не считается завершённым. Assignment, post-release WorkCard lifecycle, БТК, payroll commands, background jobs и React SPA остаются последующими slices. Stage 6 не закрыт.

## Правила владения

- runtime code не выполняет migrations и использует только `WORKCARD_DATABASE_URL`;
- migration CLI требует отдельный `WORKCARD_MIGRATION_DATABASE_URL`;
- test/admin DSN применяется только для подготовки изолированной integration database и privilege assertions;
- OpenAPI меняется только через `scripts/export_openapi.py` и проверяется snapshot gate;
- новые SQL-изменения добавляются следующим свободным номером, применённые migrations не переписываются;
- generated caches, coverage, `.env`, venv и PostgreSQL data directory не являются repository artifacts.
