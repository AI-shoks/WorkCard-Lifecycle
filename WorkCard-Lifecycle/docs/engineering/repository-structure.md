---
artifact_id: engineering.repository-structure
status: accepted
version: 3
owner: engineering
updated: 2026-09-02
---

# Repository Structure

Git checkout содержит каталог приложения `WorkCard-Lifecycle/`, организованный как `pnpm` workspace. Структура отделяет deployable-приложения, общие runtime-контракты, инфраструктуру и проектную документацию. GitHub Actions workflow находится на уровне checkout root, потому что GitHub обнаруживает workflows только в корневой `.github/workflows/`.

## Дерево исходного кода

```text
.
├── .github/workflows/ci.yml         GitHub Actions workflow
└── WorkCard-Lifecycle/
    ├── apps/
    │   ├── api/                     Fastify API, мигратор, seed и проверки БД
    │   │   ├── migrations/          неизменяемые SQL-миграции
    │   │   └── src/                 HTTP runtime и инженерные команды
    │   └── web/                     React SPA и frontend-тесты
    ├── packages/
    │   └── contracts/               общие TypeBox-схемы и TypeScript-типы
    ├── docs/                        управляемые проектные артефакты
    ├── scripts/                     проверки документационного прототипа
    ├── compose.yaml                 локальный воспроизводимый контур
    ├── Dockerfile                   единый production-образ API + SPA
    └── package.json                 корневые команды quality gate
```

`node_modules`, `dist`, coverage, локальные `.env` и кэши являются производными данными и не входят в Git. `pnpm-lock.yaml`, SQL-миграции и `.env.example` входят в Git как воспроизводимая спецификация.

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

Структура принята после успешных workspace typecheck/tests/build, сборки multi-stage образа из чистого Docker build context и подтверждения, что repo-root workflow запускает команды из `WorkCard-Lifecycle/`.
