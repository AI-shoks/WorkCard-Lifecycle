---
artifact_id: engineering.quality-gates
status: accepted
version: 1
owner: engineering
updated: 2026-07-19
---

# Quality Gates

## Обязательные команды

```powershell
python -m pip check
python -m pip_audit -r requirements.txt
python -m pip_audit
python -m ruff format --check .
python -m ruff check .
python -m mypy
python -m bandit -c pyproject.toml -r src scripts
python scripts/check_no_secrets.py
python scripts/export_openapi.py --check
python -m pytest
git diff --check
```

Runtime audit и audit установленного dev/build environment — два отдельных gates. Runtime-only audit нельзя называть полным. Bootstrap использует `pip==26.1.2`; test runner — `pytest==9.0.3`. Остальные top-level pins меняются только при необходимости.

Pytest включает branch coverage и требует не менее `85%`. Integration suite обязана работать через отдельный runtime DSN, а admin/migration DSNs использовать только для setup, migrations и privilege assertions. Обязательны migration idempotency, replay/expiry, Problem Details runtime/OpenAPI и negative privilege matrices.

Strict documentation gate:

```powershell
python <project-docs-auditor>/scripts/audit_docs.py --root . --fail-on-warning
```

Локальная remediation прошла на Python `3.12.13` и PostgreSQL `15.10`. Starlette TestClient/httpx2 deprecation warning является informational. Docker runtime, PostgreSQL `18.1` и GitHub Actions требуют publication verification и не считаются локально пройденными.
