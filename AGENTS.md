# Repository engineering instructions

## Applicability

- The application lives in `WorkCard-Lifecycle/`; run application commands from there unless a command explicitly targets the Git root.
- This file defines repository-wide engineering rules for every future task.
- `WorkCard-Lifecycle/AGENTS.md` remains the additional local authority for Russian production UI and UX copy.

## Sources of truth

- Use `WorkCard-Lifecycle/docs/documentation-index.md` and `WorkCard-Lifecycle/docs/project/document-governance.md` to identify canonical artifacts: accepted documents and active operational records are authoritative.
- Product scope is defined by `WorkCard-Lifecycle/docs/product/mvp-scope.md`.
- Domain provenance and project decisions are defined by `WorkCard-Lifecycle/docs/project/decision-provenance.md` and `WorkCard-Lifecycle/docs/project/decision-log.md`.
- Architecture decisions are defined by the current, non-superseded ADRs indexed in `WorkCard-Lifecycle/docs/architecture/adr/README.md`.
- Executable contracts are the implementation, SQL migrations, tests, `openapi/openapi.json`, dependency files, and `.github/workflows/ci.yml`, within their documented responsibilities.
- If authoritative documents, code, tests, schema, or API contracts conflict, stop before changing anything. Report the exact conflict and request a decision; do not choose a convenient interpretation.

## Baseline before work

- Before edits, record all of the following in the task evidence:
  - absolute working directory;
  - current branch;
  - full `HEAD` SHA;
  - complete `git status --short` output.
- Use read-only commands such as:

```text
Get-Location
git branch --show-current
git rev-parse HEAD
git status --short
```

- Preserve pre-existing changes and distinguish them from task changes.

## Scope and implementation

- Perform only the explicitly approved scope. Stop and ask before expanding it or starting another gate.
- Do not perform unrelated cleanup, renaming, dependency updates, formatting, or refactoring.
- First reproduce the reported problem or capture the current behavior with a focused command, test, request, or other inspectable evidence.
- Implement the smallest useful vertical slice that proves the requested behavior end to end.
- Keep the patch minimal and preserve established module, API, schema, and UX boundaries.
- Never modify `.obsidian/graph.json`.

## Approval gates

- Obtain explicit approval before adding, removing, or changing production dependencies.
- Obtain explicit approval before changing an API, OpenAPI contract, database schema, or persisted data shape.
- Obtain explicit approval before creating, editing, applying, or reverting migrations.
- Obtain explicit approval before changing authentication, authorization, session security, permissions, roles, or RBAC.
- Obtain explicit approval before changing CI, release, deployment, or publishing configuration.
- Obtain explicit approval before creating or amending commits or mutating a pull request.
- Approval is specific to the proposed action; one approval does not waive another gate.

## Permanent prohibitions

- Do not push, merge, deploy, or publish.
- Do not read secrets, credentials, token stores, or `.env` files.
- Do not connect to, copy, query, or modify real production data or production systems.
- Use only synthetic, isolated development or test data.

## Verification

- Every change requires verification proportional to its risk: run focused tests first, then all relevant repository gates.
- The canonical CI definition is `.github/workflows/ci.yml`; its exact environment, order, PostgreSQL bootstrap/migrations, audits, checks, test suite, image build, and container readiness smoke are authoritative.
- Existing repository checks invoked by that workflow from `WorkCard-Lifecycle/` include:

```text
python -m pip check
python -m pip_audit -r requirements.txt
python -m pip_audit
python -m ruff format --check .
python -m ruff check .
python -m mypy
python -m bandit -c pyproject.toml -r src scripts
python scripts/check_no_secrets.py
python -m pytest
python scripts/export_openapi.py --check
git diff --check
```

- Database-dependent checks must follow the isolated service configuration and bootstrap/migration sequence in `.github/workflows/ci.yml`; never point them at an unknown or production database.
- Do not invent commands or add scripts merely to claim verification. If a canonical check cannot run, mark it skipped and explain why.

## Completion report

- Report each command exactly as executed, its exit status, and the material result.
- Report skipped checks, environment limitations, pre-existing changes, and residual risks.
- Include final `git diff --stat` and `git status --short`, and identify every changed file.
- Do not declare the task complete without tool evidence for the diff and relevant checks.
- Do not claim success from expected behavior, code inspection, or prose alone.
