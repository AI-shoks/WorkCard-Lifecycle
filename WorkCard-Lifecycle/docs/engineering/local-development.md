---
artifact_id: engineering.local-development
status: accepted
version: 1
owner: engineering
updated: 2026-07-19
---

# Local Development

Foundation требует Python `3.12`, PostgreSQL и значения из `.env.example`. Реальные production credentials и данные использовать запрещено.

## Чистое Python-окружение

Для воспроизводимой проверки venv и caches создаются вне repository root:

```powershell
python -m venv <external-temp>\venv
<external-temp>\venv\Scripts\python.exe -m pip install --upgrade pip==26.1.2
<external-temp>\venv\Scripts\python.exe -m pip install -r requirements-dev.txt
<external-temp>\venv\Scripts\python.exe -m pip check
```

`PYTHONPYCACHEPREFIX`, `PIP_CACHE_DIR`, `RUFF_CACHE_DIR`, `MYPY_CACHE_DIR`, pytest `--basetemp`/`cache_dir` и `COVERAGE_FILE` также направляются во внешний temporary directory. `.local-packages` не используется.

## Native PostgreSQL

1. Создать отдельную пустую test database и три разные login roles: admin/setup, migrator и runtime.
2. Задать `WORKCARD_TEST_DATABASE_URL`, `WORKCARD_MIGRATION_DATABASE_URL` и `WORKCARD_DATABASE_URL`.
3. Выполнить `python scripts/bootstrap_test_database.py` только для изолированного test cluster.
4. Применить migrations: `python -m workcard_api.migrations up`.
5. Запустить `python -m pytest` и затем приложение runtime role: `python -m uvicorn workcard_api.app:app`.

Локальная remediation проверена на отдельном PostgreSQL `15.10`. Пользовательские кластеры с неизвестными credentials не используются.

## Docker Compose

`.env.example` копируется в игнорируемый `.env`, а все `REPLACE_*` меняются на синтетические локальные значения. После этого предполагаемые команды: `docker compose up --build` и проверка `http://127.0.0.1:8000/health/ready`.

В текущем remediation pass Docker отсутствовал и не устанавливался. Compose, image build и container health smoke настроены статически, но требуют post-push CI verification.
