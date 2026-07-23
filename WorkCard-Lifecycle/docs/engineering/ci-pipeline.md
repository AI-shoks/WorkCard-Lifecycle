---
artifact_id: engineering.ci-pipeline
status: accepted
version: 1
owner: engineering
updated: 2026-07-19
---

# CI Pipeline

`.github/workflows/ci.yml` запускается для push в текущую implementation branch, pull request и вручную. Job имеет read-only repository permission и ограничение времени.

## Foundation job

1. Поднять service container `postgres:18.1-bookworm` с отдельной admin role.
2. Установить Python `3.12.11`, `pip==26.1.2` и exact dev requirements; выполнить `pip check`.
3. Создать отдельные non-superuser migrator/runtime roles через test bootstrap.
4. Отдельно проверить runtime requirements и установленный dev/build environment через `pip-audit`.
5. Выполнить Ruff format/lint, strict mypy, Bandit и secret scan/self-tests.
6. Применить migrations только migration DSN.
7. Выполнить полный pytest suite с branch coverage, включая least-privilege negative tests через runtime DSN.
8. Проверить OpenAPI snapshot и `git diff --check`.
9. Собрать Docker image и запустить минимальный readiness smoke на уже мигрированной PostgreSQL service.

Runtime role не совпадает с admin/migrator, не является owner и не получает DDL. Container запускает Uvicorn non-root, без доверия к forwarded headers; Dockerfile/CI smoke не устанавливают Docker на локальную машину.

## Текущий статус

Pipeline настроен статически, но в этом worktree не публиковался и GitHub Actions не выполнялся. Статус до post-push verification: `Gate 1 remediation validated; publication CI pending`. Только успешный run на PostgreSQL `18.1` с image build/smoke может снять этот остаточный риск.
