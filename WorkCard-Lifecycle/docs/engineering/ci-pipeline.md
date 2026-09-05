---
artifact_id: engineering.ci-pipeline
status: accepted
version: 6
owner: engineering
updated: 2026-09-05
---

# CI Pipeline

GitHub Actions workflow находится в `.github/workflows/ci.yml` относительно Git checkout root. Исходный workspace расположен в `WorkCard-Lifecycle/`, поэтому общий `defaults.run.working-directory` направляет все shell steps в корень приложения. Такое размещение позволяет GitHub обнаружить workflow и сохраняет код проекта в существующей директории репозитория.

## Триггеры и безопасность

Pipeline запускается для pull request и push в `main`/`codex/**`. Concurrency отменяет устаревший run той же ветки. Workflow имеет только `contents: read`; deployment, публикация образа и запись в репозиторий отсутствуют.

Общий `.github/actions/setup-workspace/action.yml` использует Node из `WorkCard-Lifecycle/.node-version`, фиксированный `pnpm` и `pnpm install --frozen-lockfile`. Cache key явно строится по `WorkCard-Lifecycle/pnpm-lock.yaml`. Lockfile проходит strict minimum-release-age policy 1440 минут без исключений; build-script разрешён только `esbuild`. Checkout, setup и upload actions закреплены по commit SHA; setup-node/pnpm action работают на Node.js 24.

## Job `quality`

1. поднимает чистую PostgreSQL 18.6 service;
2. устанавливает зависимости с pnpm cache;
3. выполняет `pnpm check`;
4. применяет миграцию;
5. выполняет seed дважды;
6. запускает runtime DB verification;
7. запускает backend integration suite с runtime и owner URL;
8. валидирует Compose model;
9. запускает `pnpm test:quality`: новые rollback/migration/security/budget tests в отдельных случайных БД и runtime-ролях через `QUALITY_OWNER_URL`.

Owner и runtime credentials существуют только в job environment и являются синтетическими.

## Job `security`

`pnpm security:dependencies` проверяет все scopes зависимостей с блокировкой HIGH/CRITICAL. `pnpm security:secrets` запускает закреплённый Gitleaks для всей доступной Git-истории (`fetch-depth: 0`, `--all`) и отдельного снимка текущего кода/конфигурации. Значения находок скрыты `--redact=100`. Исключены только шесть проверенных исторических тестовых fingerprints из `.gitleaksignore`; текущий код не исключается. Ротация настоящих leaked credentials не подменяется исключением.

## Job `container`

Job зависит от `quality`, строит multi-stage образ с `--no-cache`, выполняет `docker compose up --no-build --wait`, проверяет liveness, readiness и SPA. Runtime — закреплённый distroless Node 24 / Debian 13 без npm/shell; build stage отделён. Этот же runtime image экспортируется и сканируется закреплённым Trivy: OS/application vulnerabilities, HIGH/CRITICAL, `--exit-code 1`, без `--ignore-unfixed` и общего allowlist. `--parallel 1` ограничивает расход памяти без изменения правил. Ошибка сканера также блокирует job. При ошибке печатаются container logs; cleanup ephemeral volumes выполняется всегда.

## Job `browser`, matrix `compact` / `canonical`

Каждая matrix entry имеет собственную PostgreSQL service, новую БД/runtime-роль и production SPA. Compact выполняет по два теста на desktop/mobile и доказывает весь процесс на шести карточках. Canonical отдельно выполняет все 250 lifecycle через UI, три gates, `1 + 59 + 52`, отдельную финальную приёмку, полный audit 254 и один payroll. Recovery использует реальные конкурирующие UI-команды и потерю ответа после настоящего commit, без fake success. Нет test retries, skips или `continue-on-error`; один worker.

## Job `performance`

На отдельной PostgreSQL service `pnpm test:performance` создаёт 10 000 карточек через API и измеряет release/assignment/detail/pagination/audit. JSON содержит объём, среду, дату, raw samples и распределения. Завершение/корректность обязательны; выдуманного business-SLA или threshold для шумного shared runner нет. Интерпретация и локальные результаты — [[quality-gates]].

## Кэширование и артефакты

Кэшируется pnpm store по lockfile. `node_modules`, runtime tar, БД и connection credentials не публикуются. Upload ограничен browser HTML/JSON/screenshots/failure trace, performance JSON и redacted secret/image reports; retention 7 дней. Failure trace может содержать временные cookie/CSRF тестовой demo-session: соответствующая изолированная БД удаляется при завершении suite, все данные синтетические. Эти artifacts не предназначены для настоящих пользовательских сессий. Container build не использует host `node_modules` благодаря `.dockerignore`.

## Критерий принятия

Закрытие этапа 9 требует зелёных `quality`, `container` (включая image scan), `security`, обеих `browser` matrix entries и `performance` для одного нового implementation SHA. Локальные проверки и успешные runs прежнего SHA не подменяют этот gate. Commit/push требуют отдельного прямого разрешения; до него CI этапа 9 остаётся непроверенным. Workflow не меняет branch protection через API; здесь зафиксирован критерий приёмки проекта.

Workflow обнаруживается GitHub из корневой `.github/workflows/`, а shell steps выполняются в `WorkCard-Lifecycle/`. Implementation commit [`17d2b04d13b58c7dff677543ed4399751a8593a1`](https://github.com/AI-shoks/WorkCard-Lifecycle/commit/17d2b04d13b58c7dff677543ed4399751a8593a1) подтверждён полностью зелёными [push CI](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33581627867) и [PR CI](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33581630041): в обоих запусках jobs `Code and database quality` и `Clean container startup` завершены успешно. Это закрывает удалённый acceptance gate этапа 7. Неблокирующее предупреждение GitHub о переводе runtime используемых actions с Node.js 20 на 24 учтено как maintenance item в [[backlog]].

## Историческое закрытие этапа 8

SHA `b00ff294a7b7ce1e09379c088969d9a02bd033bf` подтверждён успешными [push CI](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33963228130) и [PR CI](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33963230414), включая `quality` и `container`. Оба SHA/conclusions повторно прочитаны при начале этапа 9.

Локальный clean-container этапа 8 также прошёл без кэша на новом томе, с миграциями/seed, healthy SPA/API/БД и HTTP 200. Docker установлен; отсутствие Docker и незакоммиченный frontend в прежней редакции были устаревшими отметками.

Пользователь разрешил scoped commit/push этапа 9 в `codex/portfolio` 2026-09-05. Обязательные CI jobs нового implementation SHA ещё должны подтвердить реализацию. Текущая проверка учитывается в [[quality-gates]] и [[backlog]].
