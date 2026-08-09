---
artifact_id: project.stage-6-ci-documentation-audit-remediation
status: active
version: 4
owner: engineering
updated: 2026-08-09
---

# Stage 6 canonical CI documentation-audit remediation

Состояние: `CLOSED / ACCEPTED`
Статус closure: `CLOSED / ACCEPTED`
Текущая revision: `1`
Точка передачи: `SYNCED`

Эта task-card маршрутизирует только воспроизводимость обязательного documentation audit в чистом repository checkout. Gate 2 и Stage 6 остаются `OPEN`; Stage 7 остаётся `NOT STARTED`.

## A. Contract — заморожен при READY

### A1. Revision и назначение

| Поле | Значение |
|---|---|
| Task ID | `TASK-003` |
| Revision | `1` |
| Change lineage ID | `LIN-004` |
| Finding | `BLOCK-S6-003` |
| Дата/автор решения | `2026-08-07; прямое решение пользователя, записано Codex` |
| Причина revision | initial narrow Stage 6 canonical CI documentation-audit remediation |
| Изменённые поля | initial A1–A8 |
| Заменяет revision | N/A |

Repository evidence использует `TASK-001`, `TASK-002` и `LIN-001`–`LIN-003`; поэтому новая отдельная task получает следующий последовательный `TASK-003`, а новый baseline/scope — следующий `LIN-004`. Старый запрет создавать `TASK-003` внутри frozen `TASK-002 rev 1` запрещал обход назначенного там `TASK-002`; он не переиспользует и не блокирует новый прямой assignment пользователя для отдельного finding.

### A2. Риск и Git-контекст

| Поле | Замороженное значение |
|---|---|
| Класс риска | `R1`: меняются исполняемый CI workflow и repository-owned Python tooling; runtime/domain/API/schema/security behavior не меняется |
| Repository root / worktree | `C:/Users/artem/.codex/worktrees/stage-6-mvp/Работа для портфолио` |
| Application root | `C:/Users/artem/.codex/worktrees/stage-6-mvp/Работа для портфолио/WorkCard-Lifecycle` |
| Branch | `codex/stage-6-mvp-implementation` |
| Parent baseline / initial HEAD | `0e7c60fc9f5a6f07a0c3b5ab83febc31a15ae66e` |
| Initial status | clean; `git status --short --untracked-files=all` без вывода |
| Initial index | empty; `git diff --cached --name-status` без вывода |
| Pre-work fingerprint | `SNAP-S6DOC-GOV-PRE-001`: empty Git-layer manifest; SHA-256 empty bytes `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| Governance overlay | только эта card и обязательные router/living-doc updates, отдельный docs-only commit |
| Preservation | до задачи пользовательских изменений нет; любой path вне A3 — stop condition |

Implementation разрешена только от чистого потомка parent baseline, у которого единственный промежуточный delta — governance overlay этой task. Несовпадение root, branch, ancestry, overlay scope, clean status или empty index является `BASELINE MISMATCH`.

### A3. Одна цель и точный scope

**Одна цель:** сделать strict canonical documentation audit воспроизводимым на `ubuntu-latest` из normal repository checkout без личного Codex skill или machine-specific path.

#### Governance overlay

- `docs/project/stage-6-ci-documentation-audit-remediation.md`;
- `docs/documentation-index.md`;
- `docs/project/project-state.md`;
- `docs/project/project-plan.md`;
- `docs/project/backlog.md`;
- `docs/project/decision-log.md`.

#### Разрешённые implementation/evidence files

| Path от Git root | Почему необходим |
|---|---|
| `.github/workflows/ci.yml` | выполнить strict audit после normal checkout из repository-owned path |
| `WorkCard-Lifecycle/scripts/audit_docs.py` | repository-owned standard-library auditor, доступный clean runner |
| `WorkCard-Lifecycle/docs/engineering/quality-gates.md` | заменить external placeholder канонической repository-relative командой |
| `WorkCard-Lifecycle/docs/project/stage-6-ci-documentation-audit-remediation.md` | append-only implementation/verification evidence и handoff status |
| `WorkCard-Lifecycle/docs/project/project-state.md` | active task status и сохранение lifecycle boundaries |

#### Protected / out of scope

- application runtime, domain, API, OpenAPI, database schema/migrations, tests и dependencies не меняются;
- существующие CI checks, triggers, PostgreSQL `18.1-bookworm`, DSNs, coverage `>=85%`, Docker build/start/readiness smoke не ослабляются и не удаляются;
- `TASK-001 rev 2 / LIN-002`, `TASK-002 rev 1 / LIN-003`, Gate 2.1C remediation и Gate 2.2C не переоткрываются;
- Gate 1, Gate 2 и Stage 6 acceptance/closure, Stage 7, push/PR/deploy/publication — вне implementation scope.

### A4. Канонические источники

| Приоритет | Источник | Область истины |
|---:|---|---|
| 1 | Прямое решение пользователя от `2026-08-07` | baseline, finding, intended repository-owned solution, required checks и closure rules |
| 2 | `C:/Users/artem/Documents/Codex/2026-07-29/chatgpt-codex-claude-git-worktree-ci/personal-ai-audit/personal-ai-rules.md` v0.1 | lifecycle, baseline, evidence, permissions и R1 review |
| 3 | Эта task-card, `TASK-003 rev 1 / LIN-004`, A1–A8 | frozen scope, requirements, checks и stop conditions |
| 4 | [[quality-gates]] v1 и Git-root `.github/workflows/ci.yml` at parent baseline | canonical audit requirement и фактический CI contract |
| 5 | [[document-governance]], [[documentation-index]] и external auditor source inspected at `C:/Users/artem/.codex/skills/project-docs-auditor/scripts/audit_docs.py` | metadata/audit behavior и source implementation only; personal path is not a CI dependency |
| 6 | [[project-state]], [[project-plan]], [[backlog]] и [[decision-log]] | accepted progress, blockers и next action |

### A5. Подтверждённый finding

| Поле | Значение |
|---|---|
| Finding ID | `BLOCK-S6-003` |
| Severity | `high`: обязательный canonical quality gate отсутствует в hosted CI и не воспроизводим из clean checkout |
| Exact finding | canonical documentation audit не воспроизводим в GitHub CI, потому что его единственная известная реализация находится только в personal external Codex skill |
| Evidence | `quality-gates.md` требует `python <project-docs-auditor>/scripts/audit_docs.py --root . --fail-on-warning`; `.github/workflows/ci.yml` не вызывает auditor; repository checkout не содержит `audit_docs.py` |
| Root cause | `RC-S6DOC-001`: executable audit implementation не был перенесён под ownership репозитория при канонизации gate |
| Disposition | `fix`; прямое решение пользователя |
| Closure | OPEN до repository-owned implementation, local checks, independent R1 review, hosted CI exact-commit PASS и manual acceptance |

### A6. Acceptance requirements

| ID | Требование |
|---|---|
| `REQ-401` | `WorkCard-Lifecycle/scripts/audit_docs.py` существует в clean repository checkout и сохраняет поведение inspected source implementation |
| `REQ-402` | canonical docs используют `python scripts/audit_docs.py --root . --fail-on-warning` без personal/machine path |
| `REQ-403` | GitHub CI выполняет exact repository-owned command с `--fail-on-warning` из `WorkCard-Lifecycle/` |
| `REQ-404` | все ранее принятые CI triggers, database/configuration, quality/security/OpenAPI/Docker/readiness checks сохранены |
| `REQ-405` | strict local documentation audit, script syntax/static checks, workflow validation и `git diff --check` проходят |
| `REQ-406` | canonical hosted CI exact remediation commit запускает documentation audit и весь workflow завершается success |
| `REQ-407` | Gate 2/Stage 6 closure оценивается отдельно; Stage 7 остаётся `NOT STARTED` |

### A7. Обязательные проверки

| ID | Exact check |
|---|---|
| `CHK-DOC-401` | `python scripts/audit_docs.py --root . --fail-on-warning` в CI; локально тот же script/arguments допустимы через уже установленный Python 3.10+ при отсутствии `python` в PATH |
| `CHK-SCRIPT-401` | `python -m py_compile scripts/audit_docs.py` и repository Ruff/Bandit coverage для `scripts` |
| `CHK-CI-401` | parse `.github/workflows/ci.yml` и проверить exact audit step, branch trigger, PostgreSQL/DSN/test/security/OpenAPI/Docker/readiness invariants |
| `CHK-Q-401` | canonical relevant quality suite, включая Ruff format/lint, mypy, Bandit, secret scan, OpenAPI check и pytest в доступной локальной среде |
| `CHK-DIFF-401` | `git diff --check`, exact changed-file scope, empty index before authorized staging |
| `CHK-CI-402` | hosted GitHub Actions workflow for exact remediation commit; audit step PASS; overall PASS |
| `CHK-RV-401` | independent R1 review на exact diff и evidence |

### A8. Разрешения и stop conditions

- Staging и два узких commits (governance routing; remediation/CI implementation с evidence) разрешены текущим прямым запросом пользователя.
- Push, PR mutation, merge, deploy и publication запрещены repository `AGENTS.md`; hosted CI должен запустить отдельно авторизованный actor.
- Новые dependencies, downloads, unpinned external scripts, ослабление `--fail-on-warning` или существующих CI gates запрещены.
- После local implementation commit остановиться в `READY FOR CI VERIFICATION`, если exact hosted CI и independent review не доказаны.
- Gate 2 и Stage 6 закрываются только при выполнении всех пользовательских closure rules и отсутствии других blockers. Stage 7 не начинать.

## B. Evidence — append-only

### B1. Governance and reproduction evidence

| Evidence ID | Событие / команда | Результат |
|---|---|---|
| `EV-401` | exact root/branch/HEAD/status/index verification | exit 0; root/branch/HEAD совпали; worktree clean; index empty; untracked files отсутствуют |
| `EV-402` | canonical governance inspection | expected accepted tasks/findings/gates confirmed; Gate 2 and Stage 6 OPEN; Stage 7 NOT STARTED |
| `EV-403` | `rg` over workflow/canonical gate and repository scripts | workflow audit step absent; canonical external placeholder present; repository auditor absent |
| `EV-404` | external source-control run with installed Python 3.12.8 and `--fail-on-warning` | exit 0; 60 documents, 0 errors, 0 warnings; proves source behavior only, not clean-checkout CI reproducibility |
| `EV-405` | pre-work fingerprint | empty Git-layer manifest; SHA-256 `e3b0c442...b855` |

## C. Finding status at assignment

At assignment, `BLOCK-S6-003` was `OPEN / FIX AUTHORIZED`; implementation and hosted-CI evidence did not exist yet.

## D. Metrics at implementation handoff

| Метрика | Значение |
|---|---|
| Task / revision / lineage | `TASK-003 rev 1 / LIN-004` |
| Risk / review | `R1 / independent review required` |
| Findings / root causes | `high=1: BLOCK-S6-003 / RC-S6DOC-001` |
| Lifecycle | `IMPLEMENTED`; Gate 2 `OPEN`; Stage 6 `OPEN`; Stage 7 `NOT STARTED` |

## E. Implementation and local verification — append-only

### E1. Реализация

| Evidence ID | Событие / изменение | Результат |
|---|---|---|
| `EV-406` | governance routing commit | `854a47d464d7334bf348cc3542ff7e0e0969c432`; ровно шесть A3 governance files; parent `0e7c60f...` является ancestor; post-commit worktree/index clean |
| `EV-407` | repository-owned auditor | external source SHA-256 `224a9943...f63c3` скопирован в `scripts/audit_docs.py`; обязательные repository Ruff format/import/line-length изменения дали SHA-256 `1f8d48fb...4457a`; external и repository `--format json` reports identical |
| `EV-408` | canonical docs и CI | `quality-gates.md` v2 и workflow используют exact `python scripts/audit_docs.py --root . --fail-on-warning`; personal/machine paths отсутствуют |
| `EV-409` | CI preservation | parsed workflow содержит 22 steps; 16 обязательных exact commands, branch trigger, PostgreSQL 18.1, три distinct DSN, unfiltered pytest, branch coverage 85%, Docker/readiness invariants сохранены |

### E2. Verification results

| Evidence ID | Exact command / method | Exit / material result |
|---|---|---|
| `EV-410` | `python scripts/audit_docs.py --root . --fail-on-warning` после session-local добавления installed Python 3.12.8 в `PATH` | `0`; 61 document, 0 errors, 0 warnings |
| `EV-411` | `python -m py_compile scripts/audit_docs.py`; Ruff target/full format+lint | `0 / 0 / 0`; 35 files formatted, all lint checks passed |
| `EV-412` | PyYAML parse + semantic CI/`pyproject.toml` invariant assertions | `0 / 0`; workflow syntax/shape PASS; exact commands and all required CI invariants PASS |
| `EV-413` | mypy; Bandit `-c pyproject.toml -r src scripts`; secret scan; OpenAPI `--check` | `0 / 0 / 0 / 0`; 16 source files clean; Bandit 0 issues over 3635 LOC; secret/OpenAPI gates PASS |
| `EV-414` | full `tests/unit` with repository pytest/coverage config | `0`; 217 passed; branch coverage 88.51%, required 85% reached |
| `EV-415` | `git diff --check`; exact path/ref checks before evidence append | `0`; implementation paths limited to workflow, quality-gate docs and new auditor; canonical path refs exact; no personal path |
| `EV-416` | semantic pass по active living trackers | stale routing-time statements found in documentation index/project plan/backlog and synchronized to `implemented locally / hosted CI pending`; no Gate/Stage closure |
| `EV-417` | remediation/CI implementation commit | `bce60e08bba117399e40b2ee0c095b9456049a4d`; subject `ci: make documentation audit repository-owned`; 8 exact technical/evidence/living-doc paths; `499+/23-` |

### E3. Verification gaps and harness diagnostics

- Initial bare `python` and `py -3.12` invocations were unavailable locally; installed Python `3.12.8` was used without dependency installation. The exact CI command itself was then executed after a session-local `PATH` addition and passed (`EV-410`).
- Two inline YAML attempts failed before reading the workflow because of Windows quoting/import-path harness issues; the corrected PyYAML parse and independent invariant pass both exited `0` (`EV-412`).
- Direct installed `mypy.exe` launcher could not import its package; the equivalent installed module with explicit `.local-packages` path passed (`EV-413`).
- Canonical PostgreSQL bootstrap with CI synthetic credentials exited `1` before migrations/tests because the unrelated local PostgreSQL 15 instance rejects `workcard_admin`; Docker engine is not running. No secret or `.env` was read, credentials were not changed, and full PostgreSQL pytest was not claimed. Hosted CI remains mandatory.
- Local dependency audits were not rerun; both exact dependency-audit steps remain present in CI and require hosted CI evidence for this task.

### E4. Implementation handoff disposition

| Item | Current status | Основание |
|---|---|---|
| `REQ-401`–`REQ-405` | locally proven | `EV-407`–`EV-415` |
| `REQ-406` | OPEN | exact remediation commit hosted CI not available; repository policy forbids push |
| `REQ-407` | proven | Gate 2 and Stage 6 remain OPEN; Stage 7 remains NOT STARTED |
| `CHK-RV-401` | OPEN | independent R1 review not performed in implementation context |
| `BLOCK-S6-003` | `REMEDIATED LOCALLY / OPEN` | implementation and local evidence exist; hosted CI, independent review and acceptance pending |
| Task handoff | `READY FOR CI VERIFICATION` | implementation commit `bce60e08bba117399e40b2ee0c095b9456049a4d`; no push/PR/publication performed; hosted CI and independent review pending |

## F. Independent R1 closure — append-only

### F1. Review and hosted-CI evidence

| Evidence ID | Проверка | Результат |
|---|---|---|
| `EV-418` | independent baseline verification | exact repository/application roots, branch `codex/stage-6-mvp-implementation` и HEAD `2439f9aaecd912258206258bb73b71a54c855ab3`; worktree clean; index empty; untracked files отсутствуют |
| `EV-419` | parent-baseline-to-HEAD lineage and scope review | parent `0e7c60fc9f5a6f07a0c3b5ab83febc31a15ae66e` является ancestor; commits `854a47d... → bce60e0... → 2439f9a...`; все 9 changed paths входят в A3 governance/implementation scope; workflow delta добавляет только exact documentation-audit step |
| `EV-420` | upstream auditor preservation | external source SHA-256 `224a9943...f63c3`, repository SHA-256 `1f8d48fb...4457a`; diff ограничен Ruff formatting и переносом `Iterable` из `typing` в `collections.abc`; отчёты обоих auditor для текущих docs идентичны: 61/0/0 |
| `EV-421` | independent local strict verification | session-local `PATH` к уже установленному Python 3.12.8; exact `python scripts/audit_docs.py --root . --fail-on-warning` exit `0`, 61 documents, 0 errors, 0 warnings; synthetic one-warning report дал exit `0` без strict flag и exit `1` с `--fail-on-warning` |
| `EV-422` | GitHub Actions run metadata | workflow `quality`, run `31303490227`, attempt 1, event `push`, branch `codex/stage-6-mvp-implementation`, exact head SHA `2439f9aaecd912258206258bb73b71a54c855ab3`; run и единственный `foundation` job завершились `success` |
| `EV-423` | hosted repository-owned documentation audit | checkout log показывает exact SHA; step `Audit project documentation` выполнил `python scripts/audit_docs.py --root . --fail-on-warning`; exit success, 61 documents, 0 errors, 0 warnings, structural PASS |
| `EV-424` | preserved hosted CI gates | PostgreSQL `18.1-bookworm` health/bootstrap, оба dependency audits, Ruff format/lint, mypy, Bandit, secret scan, migrations `0001`–`0003`, full pytest `272 passed` with branch coverage `93.22%` against `85%`, OpenAPI check, `git diff --check`, Docker build/start и readiness — success; ожидаемые negative PostgreSQL statements не являются job failures |
| `EV-425` | independent R1 verdict and conditional manual acceptance | `ACCEPTED — BLOCK-S6-003 CLOSED`; blocking findings отсутствуют; прямой запрос пользователя условно разрешил acceptance/closure и narrow governance-only synchronization при успешном review, условие выполнено |

### F2. Requirement and finding closure

| Item | Closure evidence | Финальный статус |
|---|---|---|
| `REQ-401`–`REQ-405` | `EV-407`–`EV-415`, independently replayed by `EV-418`–`EV-421` | `ACCEPTED` |
| `REQ-406` | `EV-422`–`EV-424` | `ACCEPTED` |
| `REQ-407` | `EV-418`, `EV-425`; lifecycle boundaries preserved | `ACCEPTED` |
| `CHK-RV-401` | independent exact-baseline/diff/CI review `EV-418`–`EV-425` | `PASS` |
| `BLOCK-S6-003` | root cause removed and exact hosted CI/review proven | `CLOSED / ACCEPTED` |
| Review findings | none | `0 open` |

### F3. Lifecycle synchronization

| Объект | Финальное состояние |
|---|---|
| `TASK-003 rev 1` | `CLOSED / ACCEPTED`; lifecycle `SYNCED` |
| `LIN-004` | synchronized; новая revision/lineage не создавалась |
| `BLOCK-S6-003` | `CLOSED / ACCEPTED` |
| `BLOCK-S6-001` / `BLOCK-S6-002` | `OPEN`; отдельный scope и отдельное acceptance-решение обязательны |
| Gate 2 / Stage 6 | `OPEN / OPEN` |
| Stage 7 | `NOT STARTED` |
| Implementation changes during acceptance sync | `NOT PERFORMED` |
| Push / PR / merge / deploy / publication | `NOT PERFORMED` |
