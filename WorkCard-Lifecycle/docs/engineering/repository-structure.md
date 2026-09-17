---
artifact_id: engineering.repository-structure
status: accepted
version: 10
owner: engineering
updated: 2026-09-17
---

# Repository Structure

Git checkout содержит каталог приложения `WorkCard-Lifecycle/`, организованный как `pnpm` workspace. Структура отделяет deployable-приложения, общие runtime-контракты, инфраструктуру и проектную документацию. GitHub Actions workflow находится на уровне checkout root, потому что GitHub обнаруживает workflows только в корневой `.github/workflows/`.

## Дерево исходного кода

```text
.
├── .github/workflows/               CI, manual release/deploy/rollback и daily/manual reset workflows
├── .github/actions/setup-workspace/ общее закреплённое CI-окружение
└── WorkCard-Lifecycle/
    ├── apps/
    │   ├── api/                     Fastify API, мигратор, seed и проверки БД
    │   │   ├── migrations/          неизменяемые SQL-миграции
    │   │   └── src/                 HTTP runtime и инженерные команды
    │   └── web/                     React SPA и frontend-тесты
    ├── packages/
    │   └── contracts/               общие TypeBox-схемы и TypeScript-типы
    ├── infra/render/                текущий Render Free deployment contract
    ├── infra/terraform/             исторический неактивный GCP IaC
    ├── docs/                        управляемые артефакты и release/evidence schemas
    ├── scripts/                     UX audit, release validator/generator/evidence appender
    ├── quality/                     isolated DB, browser, failure/security/performance tests
    ├── playwright.config.ts         compact/canonical desktop/mobile browser projects
    ├── compose.yaml                 локальный воспроизводимый контур
    ├── Dockerfile                   единый production-образ API + SPA
    └── package.json                 корневые команды quality gate
```

`node_modules`, `dist`, coverage, локальные `.env` и кэши являются производными данными и не входят в Git. `pnpm-lock.yaml`, SQL-миграции, `.env.example` и `.env.owner.example` входят в Git как воспроизводимая спецификация.

`infra/render` задаёт один Free image-backed service и локальные contract checks. `infra/terraform` сохраняет неактивные исторические root/runtime modules, provider lock, GitHub WIF и plan-safety checker. Более ранние незакоммиченные foundation/backend templates и дополнительные safety tests сохранены только в локальном рабочем дереве и не включены в Render/Neon commit. Незакоммиченные Terraform HCL/scripts/templates остаются локальной историей и не входят в текущую публикацию Render/Neon. Активный release gate не применяет GCP Terraform; `.terraform/`, state и plans остаются ignored. Причина перехода — [[0009-render-free-neon-free-release|ADR-0009]].

`scripts/release/create-release-manifest.mjs` после успешной публикации и semantic scan validation создаёт только новый `docs/release/manifests/<SHA>.json` по `docs/release/release-manifest.v2.schema.json`; перезапись существующего build record запрещена. `validate-release-manifest.mjs` проверяет schema, cross-field bindings и исходный Trivy JSON. Последующие реальные lifecycle-факты создаёт `append-release-evidence.mjs` как новые последовательные hash-chained файлы по `docs/release/release-evidence.v2.schema.json`, не меняя initial manifest. Фактические manifest/evidence возникают только по результатам publication/hosted operations; локальные fixtures их не заменяют. Эти scoped операции разрешены владельцем по [[deployment]].

`.env.owner` отделяет local owner credentials от runtime `.env`; оба ignored.

`.quality-results`, `playwright-report` и `test-results` также игнорируются Git; CI прикладывает выбранные JSON/HTML/traces как временные artifacts. `quality/` — инженерные проверки, не новый workspace или production service. Runtime-образ содержит API/SPA и production dependencies без npm/shell; build stage остаётся отдельно.

## Границы

- `apps/web` не обращается к PostgreSQL и не импортирует backend-код; интеграция идёт через same-origin HTTP API.
- `apps/api` владеет подключениями к БД, транзакциями и серверной конфигурацией.
- `packages/contracts` не содержит I/O и предметных обработчиков; пакет экспортирует только общие runtime-схемы и типы.
- SQL-миграции выполняются отдельной owner-ролью. Runtime API получает минимальные права.
- Backend slice остаётся одним deployable: route composition, session boundary, workflow service, problem details и pagination находятся в `apps/api/src`; сетевые сервисы и broker не добавлены согласно [[technology-stack]].

## Правила расширения

1. Новый workspace обязан иметь собственные `package.json`, `tsconfig` и команды `build`, `test`, `typecheck` по необходимости.
2. Новый внешний контракт начинается со схемы в `packages/contracts`; внутренние типы модуля остаются в модуле.
3. Новое изменение схемы получает следующий последовательный SQL-файл; применённый файл не редактируется.
4. Generated output не становится источником истины.
5. Обход границы слоя или новый deployable требует ADR.

## Критерий принятия

Структура принята после успешных workspace typecheck/tests/build, сборки multi-stage образа из чистого Docker build context и подтверждения, что repo-root workflows запускают команды из `WorkCard-Lifecycle/`. Release schema/validator/generator/appender и hosted smoke/evidence validators покрыты позитивными и негативными tests; `ci.yml`, `release.yml`, `deploy.yml`, `reset.yml` и `rollback.yml` требуют `actionlint`. GCP Terraform results являются историческими; активный `release_iac` проверяет новый deployment contract. Фактические текущие проверки — [[quality-gates]]; полный удалённый CI текущего `main` SHA и hosted qualification ещё должны быть подтверждены отдельно.
