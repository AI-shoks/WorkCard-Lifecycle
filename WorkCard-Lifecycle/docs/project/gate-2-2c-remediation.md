---
artifact_id: project.gate-2-2c-remediation
status: active
version: 1
owner: engineering
updated: 2026-07-31
---

# Gate 2.2C OpenAPI security remediation

Состояние: `READY`
Текущая revision: `1`

Task-card восстановлена до начала remediation по каноническому personal `task-card-template.md` и repository `.codex/templates/remediation.md`. OpenAPI remediation в governance recovery не выполнялась.

## A. Contract — заморожен при READY

### A1. Revision

| Поле | Значение |
|---|---|
| Task ID | `TASK-001` |
| Revision | `1` |
| Change lineage ID | `LIN-001` |
| Дата/автор решения | `2026-07-31T00:28:25+03:00; пользователь, записано Codex` |
| Причина revision | `initial governance recovery: живая task-card отсутствовала` |
| Изменённые поля / заменяет | `initial / N/A` |

`TASK-001`, `LIN-001` и `RCY-001` — первые repo-local ID соответствующих типов: поиск по всем refs, reflog и reachable history не нашёл заполненных task-card или ранее использованных ID. Прежний lineage и review PASS не переносятся; `LIN-001` требует нового independent re-review context.

### A2. Риск и Git-контекст

| Поле | Замороженное значение |
|---|---|
| Класс риска | `R2`: меняется security-контракт OpenAPI; runtime authentication/authorization меняться не должны |
| Repository root / worktree | `C:/Users/artem/.codex/worktrees/stage-6-mvp/Работа для портфолио` |
| Каталог приложения | `WorkCard-Lifecycle` |
| Branch | `codex/stage-6-mvp-implementation` |
| Implementation baseline SHA | `a4bcc72f107c41f4016857395a0cbc4a6b2d26b9` |
| Разрешённый governance overlay | один отдельный commit `docs: restore stage 6 governance state` поверх baseline, содержащий только governance/living-docs recovery и не меняющий implementation fingerprint |
| Snapshot | `SNAP-G2C-PRE-001`; canonical UTF-8 LF manifest SHA-256 `781057dc2b57bd7fd67cea10ef9629cc8ce0a50933b0ddec9ce4db4636d23276` |
| Preservation | `CHK-S-01`: шесть out-of-scope файлов byte-for-byte; три разрешённых overlap-файла сохраняют исходные hunks и получают только remediation delta; index пуст |

Ожидаемый status remediation:

```text
 M WorkCard-Lifecycle/docs/architecture/adr/0006-demo-session-and-authorization.md
 M WorkCard-Lifecycle/docs/architecture/api-contracts.md
 M WorkCard-Lifecycle/docs/architecture/security-baseline.md
 M WorkCard-Lifecycle/openapi/openapi.json
 M WorkCard-Lifecycle/src/workcard_api/app.py
 M WorkCard-Lifecycle/tests/integration/test_release_work_cards_postgres.py
 M WorkCard-Lifecycle/tests/unit/test_auth_api.py
 M WorkCard-Lifecycle/tests/unit/test_problem_details.py
?? WorkCard-Lifecycle/tests/unit/test_release_work_cards_api.py
```

| Status | Path | Mode | Size | SHA-256 |
|---|---|---:|---:|---|
| ` M` | `WorkCard-Lifecycle/docs/architecture/adr/0006-demo-session-and-authorization.md` | `100644` | 3771 | `58d04dcc849095fade63296d829a15d7f4c8dcd9bbbe61a975ebf74971a90fee` |
| ` M` | `WorkCard-Lifecycle/docs/architecture/api-contracts.md` | `100644` | 35223 | `180430083f6266ea0aa42b99098b96cc3069cab26ee9155cd836cd7b9a4ad524` |
| ` M` | `WorkCard-Lifecycle/docs/architecture/security-baseline.md` | `100644` | 11838 | `20fc5f7478aa9bc7c6ea6e12ab5b795ae6bd4526ed9429873d9d8183e71690af` |
| ` M` overlap | `WorkCard-Lifecycle/openapi/openapi.json` | `100644` | 38725 | `35d3f8fef625da39e3d00b62027dba933554c26a34746efd535c0c53c0efaaca` |
| ` M` overlap | `WorkCard-Lifecycle/src/workcard_api/app.py` | `100644` | 40491 | `5ebc1b41a5ff9001dbe3878a8b9cefb673fbed1dcb1de50e99186e7c6d672e5a` |
| ` M` | `WorkCard-Lifecycle/tests/integration/test_release_work_cards_postgres.py` | `100644` | 38104 | `175c31a859258231d5d390ee027cf04ffd871500f046d78d31746e893dfbfdeb` |
| ` M` | `WorkCard-Lifecycle/tests/unit/test_auth_api.py` | `100644` | 10655 | `924cdba14f80e5d0a69ba001ed4a621a00bc1cfc54e45bee2021a7d5c4c7116c` |
| ` M` overlap | `WorkCard-Lifecycle/tests/unit/test_problem_details.py` | `100644` | 8262 | `3308ae95f1ad10d93650d086a37cb9537e472d52974e81485a5fbf4d578d0f3b` |
| `??` | `WorkCard-Lifecycle/tests/unit/test_release_work_cards_api.py` | file | 22337 | `112e2e088bedb0601b179d827c9012311eae4d13b384f568cb21eb8fbed1222e` |
| index | staged entries | — | 0 | empty |

Governance overlay является metadata-only потомком `a4bcc72...`. Remediation отдельно проверяет overlay commit scope и текущий `HEAD`; implementation diff остаётся привязан к `a4bcc72...`.

### A3. Цель и границы

**Одна цель:** пять protected OpenAPI operations имеют ровно `[{"SessionCookie": []}]`, а четыре public operations полностью не имеют поля `security`.

**Разрешено изменять только:**

- `WorkCard-Lifecycle/src/workcard_api/app.py`;
- `WorkCard-Lifecycle/tests/unit/test_problem_details.py`;
- `WorkCard-Lifecycle/openapi/openapi.json`.

Overlap с pre-existing diff разрешён только для этих трёх файлов и минимальных remediation hunks.

**Required remediation:** существующий цикл `session_authenticated_operations` назначает `operation["security"] = [{"SessionCookie": []}]`; semantic regression test проверяет protected/public operations; snapshot перегенерируется существующим `scripts/export_openapi.py`.

**Non-goals:** domain/PostgreSQL production logic, schema, migrations, runtime auth/RBAC, living-docs, governance, `.obsidian`, dependencies, CI, cleanup/refactoring и следующий finding/gate. Git staging/commit/push/merge/rebase/checkout/switch/reset/restore/stash/clean запрещены. Gate 2.2C, Gate 2 и Stage 6 не закрываются.

### A4. Канонические источники

| Приоритет | Источник | Revision/раздел | Область истины |
|---:|---|---|---|
| 1 | Эта task-card | `TASK-001 rev 1, A1–A8` | записанное решение пользователя, scope, finding, criteria, checks, запреты |
| 2 | `C:/Users/artem/Documents/Codex/2026-07-29/chatgpt-codex-claude-git-worktree-ci/personal-ai-audit/personal-ai-rules.md` | `v0.1` | lifecycle, preservation, risk, review |
| 3 | `docs/project/decision-log.md` | `v14, D-025–D-026` | Gate 2.2 boundary и governance recovery |
| 4 | `docs/architecture/security-baseline.md` | `SNAP-G2C-PRE-001`, SHA-256 `20fc5f...` | session/security contract |
| 5 | `docs/architecture/api-contracts.md` | `SNAP-G2C-PRE-001`, SHA-256 `180430...` | endpoint contract |
| 6 | `src/workcard_api/app.py` и `openapi/openapi.json` | baseline + snapshot | наблюдаемая генерация и confirmed defect |
| 7 | `.codex/templates/remediation.md` | `dc819f3c91f4707109a6733942479dbb77cdb6ff` | narrow remediation format |

### A5. Вопросы

| ID | Вопрос | Класс | Решение | Статус |
|---|---|---|---|---|
| `Q-01` | Governance commit поверх baseline | blocking | explicit metadata-only overlay; implementation baseline/fingerprint неизменны | RESOLVED |
| `Q-02` | Перенос прежнего lineage/review | blocking | запрещён: evidence отсутствует; создан `LIN-001`, нужен новый reviewer context | RESOLVED |
| `Q-03` | PostgreSQL 18.1 verification | non-blocking | вне remediation; остаётся GAP и не заявляется выполненной | RESOLVED |

### A6. Критерии

| ID | Проверяемый критерий |
|---|---|
| `REQ-01` | `PUT /api/v1/session/demo`, `GET /api/v1/session`, `DELETE /api/v1/session`, `POST /api/v1/production-batches` и `POST /api/v1/production-batches/{batchId}/actions/release-work-cards` имеют exact `security == [{"SessionCookie": []}]` |
| `REQ-02` | `GET /api/v1/demo-identities`, `GET /api/v1/session/bootstrap`, `GET /health/live` и `GET /health/ready` не имеют поля `security`; `security: []` запрещён |
| `REQ-03` | Semantic regression покрывает REQ-01/02; snapshot перегенерирован existing exporter |
| `REQ-04` | Все обязательные checks A7 проходят; skipped/alternate не считаются PASS |
| `REQ-05` | `CHK-S-01` доказывает сохранность pre-existing diff и пустой index; production logic, migrations, living-docs и `.obsidian` remediation не меняет |
| `REQ-06` | Результат только `READY FOR RE-REVIEW`; Gate/Stage открыты |

### A7. Обязательные проверки

Команды приложения выполняются из `WorkCard-Lifecycle/`. Existing exporter — `scripts/export_openapi.py`. Если `python` отсутствует в `PATH`, используется обнаруженный Python 3.12.8 с теми же module arguments; это не заменяет PostgreSQL 18.1 verification.

| Check ID | Тип | Requirements | Команда/метод | Ожидание |
|---|---|---|---|---|
| `CHK-R-01` | reproduce | REQ-01 | independent JSON read текущего snapshot | три session operations без security; два business operations exact |
| `CHK-P-01` | positive | REQ-01–03 | `python -m pytest tests/unit/test_problem_details.py` | PASS |
| `CHK-P-02` | regression | REQ-01–04 | `python -m pytest tests/unit` | PASS |
| `CHK-P-03` | snapshot | REQ-03 | `python scripts/export_openapi.py --check` | current |
| `CHK-P-04` | format | REQ-04 | `python -m ruff format --check .` | PASS |
| `CHK-P-05` | lint | REQ-04 | `python -m ruff check .` | PASS |
| `CHK-P-06` | types | REQ-04 | `python -m mypy src` | PASS |
| `CHK-P-07` | diff | REQ-04/05 | `git diff --check` | exit 0 |
| `CHK-N-01` | negative | REQ-01/02 | independent parsed JSON gate по девяти exact method/path pairs | exact protected structure; public field absent |
| `CHK-N-02` | index | REQ-05 | `git diff --cached --check` и `git diff --cached --name-only` | exit 0; no output |
| `CHK-S-01` | preservation | REQ-05 | recomputed manifest + byte/hunk compare с `SNAP-G2C-PRE-001` | six files byte-identical; three overlaps only remediation delta |
| `CHK-RV-01` | review | REQ-01–06 | specialized independent security/OpenAPI re-review | после `READY FOR RE-REVIEW` в новом reviewer context |

Semantic gate сравнивает parsed structures, не текст: protected security равно `[{"SessionCookie":[]}]`, а public operation object не содержит key.

### A8. Разрешения

| Действие | Разрешено | Граница |
|---|---|---|
| Изменение трёх файлов A3 | да | только `TASK-001 rev 1` |
| Staging / commit | нет | governance permission не переносится |
| Push / PR / deploy / publication | нет | запрещено |
| Branch/worktree mutations | нет | запрещено |
| Schema/migrations/dependencies/CI/runtime RBAC | нет | вне scope |
| Production data/systems | нет | synthetic local only |

## B. Evidence — append-only

### B1. Events

| Evidence ID | Revision/lineage | Cycle/event | Baseline/time | Результат |
|---|---|---|---|---|
| `EV-001` | rev 1 / LIN-001 | user decision / recovery | a4bcc72f... / 2026-07-31T00:28:25+03:00 | governance recovery и отдельный docs commit разрешены; remediation сейчас запрещена |
| `EV-002` | rev 1 / LIN-001 | history/template research | a4bcc72f... / 2026-07-31 | filled cards/IDs не найдены; применены canonical templates |
| `EV-003` | rev 1 / LIN-001 | READY transition | baseline + governance overlay / 2026-07-31T00:28:25+03:00 | A1–A8 frozen; remediation не начата |
| `EV-004` | rev 1 / LIN-001 | RCY-001 planned | same baseline / N/A | future remediation/re-review events use RCY-001 |

### B2. Матрица

| Evidence ID | Requirements | Checks | Result |
|---|---|---|---|
| `EV-010` | REQ-01–03 | CHK-P-01–03, CHK-N-01 | pending remediation |
| `EV-011` | REQ-04 | CHK-P-04–07 | pending remediation |
| `EV-012` | REQ-05 | CHK-N-02, CHK-S-01 | pending remediation |
| `EV-013` | REQ-06 | CHK-RV-01 | pending re-review |

### B3. Команды и среда

| Evidence ID | Check | Метод | Exit | Итог |
|---|---|---|---:|---|
| `EV-020` | baseline | пять required Git commands | 0 | exact root/branch/HEAD; 8 modified + 1 untracked; index empty |
| `EV-021` | fingerprint | SHA-256/size/mode manifest | 0 | `SNAP-G2C-PRE-001`; `781057dc...` |
| `EV-022` | docs audit | explicit Python 3.12.8 `audit_docs.py --root .` | 0 | 57 documents; 0 errors; 0 warnings |
| `EV-023` | environment | `python audit_docs.py --root .` | 1 | `python` absent in PATH; successful explicit-interpreter rerun |
| `EV-024` | CHK-R-01 | parsed OpenAPI enumeration | 0 | confirmed exact three missing protected security; four public absent |
| `EV-025` | history | branch/log/show/ls-tree/grep/reflog research | 0/1 no-match | no filled cards; only templates |

### B4. Remediation files

Remediation не начата. Governance recovery находится в отдельном commit и не является implementation `TASK-001`.

### B5. Gaps/risks

| Evidence ID | Тип | Описание | Disposition |
|---|---|---|---|
| `EV-030` | GAP | PostgreSQL 18.1 independent verification не выполнялась | open; не заявлять, отдельная authorized task |
| `EV-031` | GAP | original Task ID/lineage/reviewer thread не восстановимы | new LIN-001/reviewer context; no PASS transfer |
| `EV-032` | risk | remediation готовит только re-review package | stop at `READY FOR RE-REVIEW` |
| `EV-033` | GAP | intro `docs/architecture/api-contracts.md` содержит preserved stale Gate 1 state sentence | separate task; current state in `project-state.md` |

### B6. Git preservation

| Evidence ID | Момент | Baseline/status | Fingerprint | Preservation |
|---|---|---|---|---|
| `EV-040` | pre-governance/remediation | a4bcc72f...; 8 modified + 1 untracked; index empty | A2 / `781057dc...` | CHK-S-01 pending |
| `EV-041` | post-remediation | pending | recompute required | compare EV-040 |

## C. Confirmed finding

| Поле | Значение |
|---|---|
| Finding ID / source | `F-001`; user-confirmed, original review artifact unavailable (EV-031) |
| Severity | `medium`: runtime protection не опровергнута, machine-readable security contract неверен |
| Evidence | EV-024: three protected session operations lack operation-level security |
| Confirmation | confirmed; unique; Root-cause `RC-001` |
| Disposition | fix; user |
| Required fix | exact loop assignment, semantic regression, regenerated snapshot |
| Closure | OPEN; remediation checks + independent re-review |

## D. Metrics

| Метрика | Значение |
|---|---|
| First READY | `2026-07-31T00:28:25+03:00; EV-003` |
| ACCEPTED / SYNCED | N/A / N/A |
| Lineage | `LIN-001 → TASK-001 rev 1; a4bcc72f... + governance overlay; new reviewer context` |
| Remediation cycles | 0 completed; RCY-001 planned |
| Confirmed findings/root causes | medium=1, F-001 / 1, RC-001 |
| Requirement evidence / checks | 0/6 accepted; 1/12 reproduced |
| PostgreSQL 18.1 | GAP; EV-030 |
| Token telemetry / defect window | unavailable / N/A |

## Stop condition

После минимального remediation и CHK-P/N/S остановиться со статусом `READY FOR RE-REVIEW`. Independent re-review выполняется отдельно; следующий finding, Gate или Stage не начинать и не закрывать.
