---
artifact_id: engineering.quality-gates
status: accepted
version: 1
owner: engineering
updated: 2026-09-01
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
| Unit/API | `pnpm test` | Vitest проверяет frontend health mapping и API liveness/readiness |
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
```

Дополнительно проверяются `/`, `/health/live`, `/health/ready`, desktop/mobile layout и browser console.

## Подтверждённый результат

На 1 сентября 2026 года:

- format, lint, typecheck и build — успешно;
- 5 автоматических тестов — успешно;
- clean container build и startup — успешно;
- migration/seed replay и runtime permission verification — успешно;
- desktop и `390 px` UI — без overflow и ошибок console;
- UX-copy audit — 14 шагов, 70 ролевых вариантов, 7 состояний, 0 нарушений;
- strict documentation audit — обязательный gate перед закрытием этапа.

## Правило слияния

Изменение не готово к commit/PR review, пока релевантный gate не прошёл либо ограничение не описано явно. Failing gate не отключается ради зелёного статуса.
