---
artifact_id: engineering.quality-gates
status: accepted
version: 2
owner: engineering
updated: 2026-09-02
---

# Quality Gates

Один локальный gate объединяет форматирование кода, статический анализ, строгую типизацию, тесты и production build:

```powershell
pnpm install --frozen-lockfile
pnpm check
```

## Состав `pnpm check`

| Gate | Команда | Что доказывает |
|---|---|---|
| Format | `pnpm format:check` | конфигурация и исходный код соответствуют Prettier |
| Lint | `pnpm lint` | ESLint проверяет JS/TS/React hooks и запрещает неявные globals |
| Types | `pnpm typecheck` | все workspace проходят strict TypeScript без emit |
| Unit/API | `pnpm test` | Vitest проверяет frontend health, API health/config и пропускает DB suite без явного integration URL |
| Build | `pnpm build` | contracts, API и SPA собираются для production |

Markdown не переписывается Prettier: документация имеет собственную metadata/link проверку через `project-docs-auditor` и обязательный semantic pass. Это сохраняет осознанное форматирование Obsidian-артефактов и не скрывает их отдельный quality gate.

## Интеграционный gate

Перед принятием инфраструктурного изменения выполняются:

```powershell
docker compose config --quiet
docker compose up --build --wait --wait-timeout 180
docker compose run --rm --no-deps migrate
docker compose run --rm --no-deps seed
docker compose run --rm --no-deps app node dist/verify-database.js
pnpm --filter @work-card/api test:integration
pnpm audit --prod --audit-level=high
git diff --check
```

Отдельно `project-docs-auditor` запускается от корня проекта в strict mode `--fail-on-warning`. Дополнительно проверяются `/`, `/health/live`, `/health/ready`, desktop/mobile layout и browser console.

## Подтверждённый результат

На 2 сентября 2026 года:

- format, lint, typecheck и build — успешно;
- 11 обычных автоматических тестов — успешно, включая полную trusted-role command matrix и browser security headers;
- 5 PostgreSQL integration tests — успешно: ранний порядок session/role/Origin-CSRF, `3/250/254`, compact API-only lifecycle, concurrent assignment/final/payroll, replay и immutable grants;
- migrations `0001`–`0003`, seed и runtime permission verification на чистой БД — успешно;
- production build — успешно;
- clean-container текущего checkout локально — успешно;
- удалённый CI текущего незакоммиченного diff не запускался; последний зелёный run относится к `d0ecc812`;
- strict documentation audit остаётся обязательным gate перед закрытием этапа.

## Правило слияния

Изменение не готово к commit/PR review, пока релевантный gate не прошёл либо ограничение не описано явно. Failing gate не отключается ради зелёного статуса.
