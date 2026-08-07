---
artifact_id: project.gate-2-1c-remediation
status: active
version: 2
owner: engineering
updated: 2026-08-07
---

# Gate 2.1C controlled post-acceptance remediation

Состояние: `SYNCED`
Статус closure: `CLOSED / ACCEPTED`
Текущая revision: `1`
Точка передачи: `CLOSED / ACCEPTED`

Эта task-card создаёт отдельный governance-контур только для finding `BLOCK-G21C-001`. Первоначальный governance-запуск не исправлял runtime, tests, OpenAPI или architecture contracts; последующий явно разрешённый controlled closure выполнил тот же frozen scope без переноса сюда scope, lineage либо evidence Gate 2.2C.

## A. Contract — заморожен при READY

### A1. Revision и назначение

| Поле | Значение |
|---|---|
| Task ID | `TASK-002` |
| Revision | `1` |
| Change lineage ID | `LIN-003` |
| Finding | `BLOCK-G21C-001` |
| Дата/автор решения | `2026-08-06T22:56:50+03:00; прямое решение пользователя, записано Codex` |
| Причина revision | initial controlled post-acceptance remediation Gate 2.1C |
| Изменённые поля | initial A1–A8 |
| Заменяет revision | N/A |

Пользователь явно отменил прежний статус «зарезервировано, но не назначено» и назначил `TASK-002 rev 1 / LIN-003` исключительно этой remediation. `TASK-001`, `LIN-001` и `LIN-002` принадлежат Gate 2.2C и запрещены; `TASK-003` либо другой обходной ID создавать запрещено. `TASK-002 / LIN-003` не распространяются на другие findings.

### A2. Риск и Git-контекст

| Поле | Замороженное значение |
|---|---|
| Класс риска | `R2`: меняется security/authorization precedence runtime command boundary; bypass не подтверждён, но контракт требует specialized independent review |
| Repository root / worktree | `C:/Users/artem/.codex/worktrees/stage-6-mvp/Работа для портфолио` |
| Application root | `C:/Users/artem/.codex/worktrees/stage-6-mvp/Работа для портфолио/WorkCard-Lifecycle` |
| Branch | `codex/stage-6-mvp-implementation` |
| Parent baseline / initial HEAD | `7542044f87ea4dc1a1453321a86e1000814f34b0` |
| Initial status | clean; `git status --short --untracked-files=all` без вывода |
| Initial index | empty; `git diff --cached --name-status` без вывода |
| Governance overlay | один docs-only commit `docs: route gate 2.1c remediation`; только новая card и обязательные router/living-doc updates; implementation fingerprint не меняется |
| Known user changes | нет; `SNAP-G21C-GOV-PRE-001` — пустой Git-layer manifest, SHA-256 empty bytes `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| Frozen future manifest | `SNAP-G21C-R1-PRE-001`; 12 записей ниже; canonical manifest SHA-256 `51e6fafff9b33c5d8ffe56e2fcf5253ed883dca67c3d947dde89050fa5d73f2d` |
| Manifest algorithm | перечисленный порядок; `treatment<TAB>path<TAB>mode<TAB>size<TAB>sha256<LF>`; worktree bytes; UTF-8 без BOM; final LF |
| Preservation | mutable paths получают только разрешённые hunks; `verify-only` и `protected` остаются byte-identical; любой иной path или OpenAPI diff — stop condition |

Future remediation начинается только после отдельного явного разрешения и только от потомка parent baseline, у которого единственный промежуточный delta — указанный governance overlay. Несовпадение branch, parent ancestry, ожидаемого overlay scope, clean status либо empty index является `BASELINE MISMATCH` и останавливает remediation без изменений.

#### Frozen pre-change manifest

| Treatment | Path | Mode | Size | SHA-256 |
|---|---|---:|---:|---|
| `mutable` | `WorkCard-Lifecycle/docs/architecture/api-contracts.md` | `100644` | 36656 | `f2f6e3867b7ca07c48ad27c3de8196c47ef4a005123b367e6aa358da977bffb8` |
| `mutable` | `WorkCard-Lifecycle/src/workcard_api/app.py` | `100644` | 40418 | `3b45e165737cb8b32596df87e4fd9c88929414ad61bce7792b8434b13a7310f8` |
| `mutable` | `WorkCard-Lifecycle/tests/unit/test_create_production_batch_api.py` | `100644` | 19246 | `df8c5521003071dc9923a07df1c6ae78d2ab753f08a8aa7006d0a6a63a69bdf9` |
| `verify-only` | `WorkCard-Lifecycle/openapi/openapi.json` | `100644` | 39007 | `453b715a6ab4677399bd38d9c73d12a6d1d423c80811163becf89794e7b8a93d` |
| `protected` | `WorkCard-Lifecycle/docs/architecture/security-baseline.md` | `100644` | 11838 | `20fc5f7478aa9bc7c6ea6e12ab5b795ae6bd4526ed9429873d9d8183e71690af` |
| `protected` | `WorkCard-Lifecycle/docs/architecture/transactions-concurrency.md` | `100644` | 21399 | `bc7f6cd9ea93396b15c9c8fddd61cee43ec26c652e5a14c3d8cdc9702f4a59f7` |
| `protected` | `WorkCard-Lifecycle/src/workcard_api/auth.py` | `100644` | 5609 | `8e8aab45fb1aac503638f9d115319cf7eb0ba56665dcfcfedd0acbe028a15550` |
| `protected` | `WorkCard-Lifecycle/src/workcard_api/permissions.py` | `100644` | 811 | `5fe005589dc2b30d7bbbfdc65d9f6f9887f13df30222e1f7952eb6a1971b7b7c` |
| `protected` | `WorkCard-Lifecycle/tests/unit/test_auth_api.py` | `100644` | 10655 | `924cdba14f80e5d0a69ba001ed4a621a00bc1cfc54e45bee2021a7d5c4c7116c` |
| `protected` | `WorkCard-Lifecycle/tests/unit/test_problem_details.py` | `100644` | 9131 | `8e4fb3b8b2f6759aea96e3e29c5b7caf1637f46924d283a81c74e3d5674bb1f2` |
| `protected` | `WorkCard-Lifecycle/tests/unit/test_release_work_cards_api.py` | `100644` | 22178 | `3046a91a913ed3a910e8c5aff2394dd19d3e5efd69fac4e4cc7006cb35d726bc` |
| `protected` | `WorkCard-Lifecycle/docs/project/gate-2-2c-remediation.md` | `100644` | 56235 | `0b22d3a60226fa3e33e8e56523143a17881b5a798ccb3c5ed7eefe7803cde405` |

### A3. Одна цель и точный будущий scope

**Одна цель:** исправить только `BLOCK-G21C-001`, чтобы `POST /api/v1/production-batches` выполнял проверки строго `session → CSRF → permission → Origin → body schema`, и доказать collision matrix без изменения остальных гарантий.

#### Разрешённые mutable files — ровно три

| Path | Почему необходим | Требования | Допустимый тип изменения |
|---|---|---|---|
| `WorkCard-Lifecycle/src/workcard_api/app.py` | `trusted_create_batch_actor` является единственным root-cause location и сейчас выполняет `session → permission → Origin → CSRF` | `REQ-301`, `REQ-306` | только перестановка существующего `verify_csrf` перед permission и сохранение Origin после permission; без refactor, новых branches или изменения primitives |
| `WorkCard-Lifecycle/tests/unit/test_create_production_batch_api.py` | существующая route matrix введена в `2852e3c...`, покрывает boundary, но утверждает дефектный порядок и не доказывает требуемые collisions | `REQ-302`, `REQ-303`, `REQ-306` | только минимальная замена/расширение существующей parametrized collision matrix и observation spy; без нового test file |
| `WorkCard-Lifecycle/docs/architecture/api-contracts.md` | это принятый canonical HTTP contract; текущая v10 exact precedence описывает только release route | `REQ-304` | version `10 → 11`, `updated` date и одна непротиворечивая canonical formulation для реализованных create/release command boundaries |

`WorkCard-Lifecycle/openapi/openapi.json` — только `verify-only`: exporter запускается, но bytes обязаны остаться равными `453b715a...`. Он не является разрешённым changed file.

`docs/architecture/transactions-concurrency.md` описывает transaction steps после route checks, а не устанавливает HTTP collision precedence; поэтому его изменение не требуется и запрещено. `security-baseline.md`, `auth.py` и `permissions.py` уже содержат необходимые primitives/guarantees и также не являются root cause.

#### Protected / out of scope

- `WorkCard-Lifecycle/docs/project/gate-2-2c-remediation.md`, `tests/unit/test_release_work_cards_api.py` и вся lineage `TASK-001 / LIN-001 / LIN-002` — byte-protected; Gate 2.2C остаётся `CLOSED / ACCEPTED`;
- `WorkCard-Lifecycle/openapi/openapi.json` — byte-protected verification target;
- `WorkCard-Lifecycle/src/workcard_api/auth.py`, `src/workcard_api/permissions.py`, domain/PostgreSQL gateways, migrations и schema — без изменений;
- `WorkCard-Lifecycle/tests/unit/test_auth_api.py`, `tests/unit/test_problem_details.py`, integration tests и все другие tests — regression checks only, без изменений;
- `WorkCard-Lifecycle/docs/architecture/security-baseline.md`, `transactions-concurrency.md`, domain/requirements/UX docs — без изменений;
- другие findings, Gate 2.1A/B, Gate 2.2A/B/C, Gate 1 closure, Gate 2 closure, Stage 6 closure и Stage 7 — вне scope;
- dependencies, CI, cleanup, formatting вне разрешённых hunks, staging/commit/push/PR реализации — запрещены до отдельного решения.

#### Governance overlay текущего запуска

До freeze/commit разрешены только `docs/project/gate-2-1c-remediation.md`, `docs/documentation-index.md`, `docs/project/project-state.md`, `docs/project/project-plan.md`, `docs/project/backlog.md` и `docs/project/decision-log.md`. Этот overlay не является remediation implementation.

### A4. Канонические источники и historical lineage

| Приоритет | Источник | Revision/section | Область истины |
|---:|---|---|---|
| 1 | Прямое решение пользователя | `2026-08-06; assignment TASK-002 rev 1 / LIN-003 / BLOCK-G21C-001` | назначение, defect, запреты, acceptance и stop point |
| 2 | `C:/Users/artem/Documents/Codex/2026-07-29/chatgpt-codex-claude-git-worktree-ci/personal-ai-audit/personal-ai-rules.md` | `v0.1, §§1–7` | lifecycle, R2 review, baseline, preservation, permissions |
| 3 | Эта task-card | `TASK-002 rev 1, A1–A8` | frozen remediation Contract |
| 4 | [[document-governance]] и [[documentation-index]] | `v3` / governance-overlay version | canonical paths, metadata и router |
| 5 | [[decision-log]] и [[project-state]] | `D-024, D-028` / current state | Gate 2.1 contract origin, current remediation routing и lifecycle boundary |
| 6 | [[api-contracts]], [[security-baseline]], [[transactions-concurrency]], [[audit-log-design]] и [[commands-events]] | `v10`, `v4`, `v4`, `v4`, `v6` at parent baseline | принятые Gate 2.1 command/security/transaction/event contracts |
| 7 | `src/workcard_api/app.py`, `tests/unit/test_create_production_batch_api.py`, `openapi/openapi.json` | `SNAP-G21C-R1-PRE-001` | наблюдаемый defect, executable evidence и accepted machine-readable snapshot |

| Historical commit | Связь с Gate 2.1C |
|---|---|
| `cc370a7ce4cec971edfdac412fd1d804efd93dbe` | `docs: define production batch creation contracts`; D-024 и accepted contract basis |
| `194c19210ea7e9ad9b106219c76880c22bd9a141` | domain/PostgreSQL `CreateProductionBatch` implementation |
| `2852e3c3b3c24f0533b6cbc9106c5bd8cc1be081` | HTTP route, OpenAPI и `test_create_production_batch_api.py`; источник текущего precedence evidence |
| `2ab56fcde3dc5ce88ebae9a9709f55b4ae7b72f0` | accepted OpenAPI snapshot также включает Gate 2.2C; его Gate 2.2C scope не переоткрывается |
| `7542044f87ea4dc1a1453321a86e1000814f34b0` | parent baseline после controlled Gate 2.2C closure |

Post-acceptance remediation не переписывает historical commits, tests, accepted evidence или Gate 2.2C records. Прежнее отсутствие отдельной repository-local manual-acceptance записи для Gate 2.1 в целом не реконструируется: текущее прямое решение пользователя канонично только для назначения этой post-acceptance remediation и не закрывает Gate 2.

### A5. Вопросы

| ID | Вопрос | Класс | Решение | Статус |
|---|---|---|---|---|
| `Q-301` | Можно ли использовать зарезервированные TASK-002/LIN-003? | blocking | пользователь явно назначил их этой remediation и отменил прежний reservation-only status | RESOLVED |
| `Q-302` | Нужен ли другой Task/Lineage ID? | blocking | нет; `TASK-003` и обходные ID запрещены | RESOLVED |
| `Q-303` | Нужны ли изменения auth/permissions/OpenAPI? | blocking | нет; root cause локален в route helper, primitives и schema неизменны; OpenAPI verification-only | RESOLVED |
| `Q-304` | Является ли transaction-doc competing precedence source? | blocking | нет; он описывает transaction entry prerequisites, exact HTTP precedence канонизируется только в `api-contracts.md` v11 | RESOLVED |
| `Q-305` | Можно ли восстановить отсутствующее historical acceptance evidence? | blocking | нет; historical evidence не переписывается, текущее решение записывается prospectively | RESOLVED |

### A6. Acceptance requirements

| Requirement ID | Проверяемый критерий |
|---|---|
| `REQ-301` | Runtime `POST /api/v1/production-batches` выполняет exact precedence `session → CSRF → permission → Origin → body schema` |
| `REQ-302` | Collision matrix доказывает missing/invalid session против всех downstream defects; missing/invalid CSRF против permission denial, invalid Origin и malformed body; permission denial против invalid Origin и malformed body; invalid Origin против malformed body |
| `REQ-303` | Для каждого rejected boundary проверены exact HTTP status и Problem code, `create_batch_gateway.calls == []`, а body validator/parser не вызывается до своей ступени там, где это наблюдаемо через spy/counter |
| `REQ-304` | `docs/architecture/api-contracts.md` повышен ровно до version `11`, дата обновлена, и один canonical exact order описан без competing wording |
| `REQ-305` | `openapi/openapi.json` регенерирован существующим exporter и после этого byte-identical SHA-256 `453b715a6ab4677399bd38d9c73d12a6d1d423c80811163becf89794e7b8a93d`; любой diff останавливает работу до отдельного доказанного объяснения |
| `REQ-306` | Session, CSRF, Origin, permission, authentication challenge/error-header и body-validation guarantees не ослаблены; unauthorized state/gateway effects отсутствуют |
| `REQ-307` | Gate 2.2C остаётся `CLOSED / ACCEPTED`; его task-card, lineage, evidence, release test и accepted snapshot не редактируются |
| `REQ-308` | Меняются только три mutable paths A3 и только разрешёнными hunks; все verify-only/protected manifest entries byte-identical; Gate 2/Stage 6 остаются open, Stage 7 не начинается |

#### Обязательная collision matrix

| First applicable boundary | Одновременные downstream defects | Exact result |
|---|---|---|
| missing session | missing/invalid CSRF, invalid Origin, malformed body; no trusted permission grant | `401 AUTHENTICATION_REQUIRED`; exact `WWW-Authenticate`; no gateway/body parse |
| invalid/revoked session formerly bound to denied `MASTER` | invalid CSRF, invalid Origin, malformed body, permission denial candidate | `401 AUTHENTICATION_REQUIRED`; exact challenge; no gateway/body parse |
| missing CSRF with valid `MASTER` session | permission denial, invalid Origin, malformed body | `403 CSRF_VALIDATION_FAILED`; no `WWW-Authenticate`; no gateway/body parse |
| invalid CSRF with valid `MASTER` session | permission denial, invalid Origin, malformed body | `403 CSRF_VALIDATION_FAILED`; no `WWW-Authenticate`; no gateway/body parse |
| permission denial with valid CSRF | invalid Origin, malformed body | `403 PERMISSION_DENIED`; no `WWW-Authenticate`; no gateway/body parse |
| invalid Origin with valid `PLANNER` session/CSRF | malformed body | `403 ORIGIN_NOT_ALLOWED`; no gateway/body parse |
| all security checks valid | malformed body | `400 REQUEST_VALIDATION_FAILED`; body parser observed exactly at this stage; no gateway call |

### A7. Обязательные проверки

Application commands выполняются из `WorkCard-Lifecycle/`. Alternate, skipped или partial result не считается PASS. Недоступный обязательный tool/check — `BLOCKER` до отдельного решения.

| Check ID | Тип | Requirements | Точная команда/метод | Ожидание |
|---|---|---|---|---|
| `CHK-R-301` | reproduce | `REQ-301/302` | read-only inspect `trusted_create_batch_actor` и current parametrized matrix at frozen SHA | observed `session → permission → Origin → CSRF → body`; finding confirmed |
| `CHK-P-301` | focused collision | `REQ-301–303` | `python -m pytest tests/unit/test_create_production_batch_api.py --no-cov` | all pass; exact matrix, codes, headers, empty gateway, body spy |
| `CHK-P-302` | security regression | `REQ-306/307` | `python -m pytest tests/unit/test_auth_api.py tests/unit/test_problem_details.py tests/unit/test_release_work_cards_api.py --no-cov` | all pass; Gate 2.2/security/error contracts unchanged |
| `CHK-P-303` | unit suite | `REQ-301–308` | `python -m pytest tests/unit` | pass with repository coverage threshold |
| `CHK-P-304` | full suite | `REQ-306/308` | `python -m pytest` | pass; no skipped/failed mandatory tests hidden |
| `CHK-O-301` | OpenAPI regenerate | `REQ-305` | hash before; `python scripts/export_openapi.py`; hash after; `python scripts/export_openapi.py --check`; Git byte compare | exporter/check exit 0; hash remains exact; no OpenAPI diff |
| `CHK-D-301` | contract semantic | `REQ-304` | metadata parse plus targeted semantic search of exact-order wording | v11/date correct; exactly one canonical order; no competing sequence |
| `CHK-Q-301` | quality | `REQ-306/308` | `python -m ruff format --check .`; `python -m ruff check .`; `python -m mypy`; `python -m bandit -c pyproject.toml -r src scripts`; `python scripts/check_no_secrets.py` | every command exit 0 |
| `CHK-G-301` | documentation | `REQ-304/307/308` | `python C:/Users/artem/.codex/skills/project-docs-auditor/scripts/audit_docs.py --root . --fail-on-warning` plus semantic pass | structural 0 errors/warnings; no semantic competing source |
| `CHK-S-301` | preservation/scope | `REQ-305–308` | recompute A2 manifest; exact hunk review; `git diff --check`; cached/status/scope checks | only three allowed paths; protected exact; index empty until separate permission |
| `CHK-RV-301` | independent review | `REQ-301–308` | new specialized security/API reviewer context on `TASK-002 rev 1 / LIN-003` real diff and results | finding closed or explicitly dispositioned; no PASS transfer from Gate 2.2C |

### A8. Разрешения и stop conditions

| Действие | Разрешено | Граница |
|---|---|---|
| Текущий governance overlay и отдельный docs commit | да | только шесть A3 governance paths; subject `docs: route gate 2.1c remediation` |
| Future edits трёх mutable remediation paths | нет в текущем запуске | только после отдельного явного разрешения на `TASK-002 rev 1 / LIN-003` |
| Staging / commit remediation implementation | нет | требуется отдельное явное разрешение после доказанного scope/checks |
| Push / PR / merge / deploy / publication | нет | запрещено |
| Gate 2.2C mutation/reopen | нет | closed accepted history protected |
| Gate 2 / Stage 6 closure; Stage 7 start | нет | вне scope |
| Другие findings/IDs/files | нет | stop and request routing |

Stop immediately without implementation commit if baseline/overlay differs, another file becomes necessary, any protected hash differs, OpenAPI changes bytes, a mandatory check fails, exact collision semantics cannot be proven, Gate 2.2C state changes, or implementation staging/commit lacks separate authorization. A new finding is recorded but not fixed. Future remediation stops at `READY FOR RE-REVIEW`; this governance launch stops at `READY FOR REMEDIATION`.

## B. Evidence — append-only

### B1. Events

| Evidence ID / Event ID | Revision / lineage | Event | Baseline / time | Result |
|---|---|---|---|---|
| `EV-301` | rev 1 / LIN-003 | user governance decision | `7542044...` / 2026-08-06 | TASK-002 rev 1, LIN-003 and BLOCK-G21C-001 exclusively assigned; production remediation prohibited in this launch |
| `EV-302` | rev 1 / LIN-003 | baseline verification | `7542044...` / 2026-08-06 | exact worktree/branch/HEAD; clean status; empty index; lifecycle baseline matched |
| `EV-303` | rev 1 / LIN-003 | canonical source read | parent baseline / 2026-08-06 | personal rules, both AGENTS, router/governance, state/plan/log/backlog, closed Gate 2.2C card, accepted Gate 2.1 contract/evidence and templates read |
| `EV-304` | rev 1 / LIN-003 | root-cause/scope proof | parent baseline / 2026-08-06 | helper order and stale collision matrix confirmed; exact three-file mutable scope; OpenAPI verify-only |
| `EV-305` | rev 1 / LIN-003 | manifest freeze | parent baseline / 2026-08-06 | `SNAP-G21C-R1-PRE-001`; 12 entries; SHA-256 `51e6faff...` |
| `EV-306` | rev 1 / LIN-003 | READY transition | governance overlay / 2026-08-06 | A1–A8 complete and frozen; handoff `READY FOR REMEDIATION`; implementation not started |

### B2. Requirement/evidence matrix

| Evidence ID | Revision / lineage | Requirements | Current evidence | Future checks | Status |
|---|---|---|---|---|---|
| `EV-310` | rev 1 / LIN-003 | `REQ-301–303` | `EV-304`; current defect and missing collisions confirmed | `CHK-P-301–304`, `CHK-RV-301` | pending remediation |
| `EV-311` | rev 1 / LIN-003 | `REQ-304/305` | accepted contract/snapshot and frozen hashes read | `CHK-O-301`, `CHK-D-301`, `CHK-G-301` | pending remediation |
| `EV-312` | rev 1 / LIN-003 | `REQ-306–308` | protected manifest and lifecycle baseline frozen | `CHK-P-302–304`, `CHK-Q-301`, `CHK-S-301`, `CHK-RV-301` | pending remediation |

### B3. Governance commands and results

| Evidence ID | Check | Exact method | Exit / result |
|---|---|---|---|
| `EV-320` | baseline | `Get-Location`; Git root/branch/HEAD/status/cached/unstaged commands | all 0; exact path, branch and HEAD; status/index/diff empty |
| `EV-321` | lifecycle | full semantic read of `project-state.md`, `project-plan.md`, `backlog.md`, `decision-log.md`, router and closed card | matched: Gate 2.2C closed/accepted; Gate 2 and Stage 6 open; Stage 7 not started |
| `EV-322` | history | `git show/log/diff` for `cc370a7...`, `194c192...`, `2852e3c...`, `2ab56fc...`, `7542044...` | all 0; historical lineage and current test provenance confirmed |
| `EV-323` | root cause | exact read `app.py:trusted_create_batch_actor`, security primitives and full create route test | 0; current order `session → permission → Origin → CSRF → body`; no second root-cause file |
| `EV-324` | manifest | Git mode + worktree size/SHA-256; canonical UTF-8 manifest hash | 0; 12/12 entries; `51e6fafff9b33c5d8ffe56e2fcf5253ed883dca67c3d947dde89050fa5d73f2d` |
| `EV-325` | structural audit bootstrap | `python .../audit_docs.py --root . --fail-on-warning` | exit 1; `python` absent from PATH; not counted as PASS |
| `EV-326` | strict structural audit | explicit PostgreSQL 15 pgAdmin Python 3 runtime + `audit_docs.py --root . --fail-on-warning` | exit 0; 60 documents; 0 errors; 0 warnings; structural PASS only |
| `EV-327` | semantic lifecycle/ownership | 17 deterministic assertions plus targeted `rg` precedence pass | exit 0; 17/17; one owning card each for TASK-002, LIN-003 and BLOCK-G21C-001; observed wrong order is labelled defect, not competing target |
| `EV-328` | frozen manifest replay | recompute all 12 A2 worktree byte entries and canonical manifest | exit 0; 12/12 exact; manifest remains `51e6faff...` |
| `EV-329` | pre-stage Git/scope | `git diff --check`; cached check/name-status; forbidden-path diff; untracked enumeration | exits 0; index empty; no implementation/test/OpenAPI/api-contracts/Gate-2.2C diff; sole untracked file is this card |

### B4. Governance overlay files

| Evidence ID | Path | Status | Purpose |
|---|---|---|---|
| `EV-330` | `docs/project/gate-2-1c-remediation.md` | A | canonical `TASK-002 rev 1 / LIN-003` Contract |
| `EV-331` | `docs/documentation-index.md` | M | register active task-card |
| `EV-332` | `docs/project/project-state.md` | M | route current READY remediation without closing Gate/Stage |
| `EV-333` | `docs/project/project-plan.md` | M | reflect Gate 2.1C remediation READY |
| `EV-334` | `docs/project/backlog.md` | M | record governance completion and next authorized remediation step |
| `EV-335` | `docs/project/decision-log.md` | M | record D-028 authoritative assignment and boundaries |

### B5. Gaps and risks

| Evidence ID | Type | Description | Disposition |
|---|---|---|---|
| `EV-340` | GAP | отдельный historical manual-acceptance artifact для Gate 2.1 целиком ранее не найден | preserved; current decision does not reconstruct it or close Gate 2 |
| `EV-341` | risk | precedence remediation touches R2 boundary even though bypass/state mutation is not observed | specialized independent review mandatory |
| `EV-342` | risk | OpenAPI exporter could reveal an unrelated drift | any byte diff is a stop condition, not an authorized cleanup |

### B6. Git preservation

| Evidence ID | Moment | Worktree / branch / SHA | Status / fingerprint | Preservation |
|---|---|---|---|---|
| `EV-350` | pre-governance | exact worktree; `codex/stage-6-mvp-implementation`; `7542044...` | clean; index empty; `SNAP-G21C-GOV-PRE-001` empty manifest | governance overlay limited to EV-330–EV-335 |
| `EV-351` | post-governance pre-commit | same branch/parent | exact six-file docs overlay required | mandatory audit, semantic, diff and staged-scope checks before commit |
| `EV-352` | staged pre-commit | same branch/parent | exact `5 M + 1 A`; no unstaged or untracked paths; cached diff/check exit 0 | only EV-330–EV-335 staged; implementation/test/OpenAPI/api-contracts/Gate-2.2C cached scope empty |

## C. Confirmed finding

| Поле | Значение |
|---|---|
| Finding ID | `BLOCK-G21C-001` |
| Source | direct authoritative user decision `2026-08-06`; reproduced by `EV-323` |
| Severity | `medium`, blocking remediation acceptance: wrong security error precedence; no authorization bypass or state change observed |
| Exact evidence | `src/workcard_api/app.py`, `trusted_create_batch_actor`: session, permission, Origin, CSRF; existing test matrix asserts the same wrong order |
| Required behavior | `session → CSRF → permission → Origin → body schema` |
| Root-cause ID | `RC-G21C-001`: checks ordered incorrectly in one route dependency and mirrored by its test oracle |
| Classification | confirmed / unique / post-acceptance defect |
| Disposition | fix; user; only `TASK-002 rev 1 / LIN-003` |
| Closure | `CLOSED / ACCEPTED`; exact remediation commit `7acc58c3eaaa84de3a637a94202f5f7e34a04612`, independent review и closure evidence `EV-360`–`EV-370` |

## D. Metrics

| Metric | Value |
|---|---|
| First READY | `2026-08-06; EV-306` |
| ACCEPTED / SYNCED | `2026-08-07 / 2026-08-07` |
| Lineage | `TASK-002 rev 1 / LIN-003 / parent 7542044... / SNAP-G21C-R1-PRE-001` |
| Findings / root causes | `medium=1: BLOCK-G21C-001 / RC-G21C-001` |
| Remediation cycles | `1`; exact three-file remediation reviewed and committed |
| Requirement coverage | `8/8 completed`; `REQ-301`–`REQ-308` accepted |
| Mandatory checks | requested focused/collision/security/full pytest, Ruff, mypy, OpenAPI `--check`, documentation audit, semantic and Git/scope checks passed; PostgreSQL integration skips are non-blocking for this HTTP-only remediation |
| Gate/Stage | Gate 2.2C closed/accepted; Gate 2 open; Stage 6 open; Stage 7 not started |

## Historical stop condition before implementation authorization

Первоначальный governance-запуск закончился после отдельного governance commit в состоянии `READY FOR REMEDIATION`. До нового прямого решения пользователя было запрещено исправлять `BLOCK-G21C-001`, stage/commit/push implementation, создавать PR, переоткрывать Gate 2.2C или начинать Stage 7. Прямое решение пользователя 2026-08-07 отдельно разрешило independent review, implementation commit и controlled governance closure в этой же revision/lineage; push/PR и дальнейшие lifecycle-переходы остались запрещены.

## E. Controlled closure — append-only

### E1. Review и verification evidence

| Evidence ID | Revision / lineage | Проверка | Результат |
|---|---|---|---|
| `EV-360` | rev 1 / LIN-003 | current user authorization и baseline | exact worktree/branch/HEAD `3dcaa1e3cbd56904575eac22e40c253ff4853582`; index empty; untracked absent; exact three-file `106+/36-` scope |
| `EV-361` | rev 1 / LIN-003 | full diff и runtime review | exact order `session → CSRF → permission → Origin → body`; runtime delta — одна перестановка; production parser вызывается в handler после trusted actor dependency; gateway вызывается только после parser |
| `EV-362` | rev 1 / LIN-003 | focused create API и отдельная collision matrix | `31 passed`; отдельно `7 passed`; все simultaneous conflicts, status/code/challenge, parser counter и empty gateway доказаны |
| `EV-363` | rev 1 / LIN-003 | security regression | `63 passed`: auth, Problem Details и protected release API tests |
| `EV-364` | rev 1 / LIN-003 | полный pytest | `217 passed, 55 skipped`; coverage `88.51%` при threshold `85%`; skips требуют отдельные PostgreSQL DSN и не являются acceptance requirement этой HTTP-only remediation |
| `EV-365` | rev 1 / LIN-003 | quality | Ruff format: `34 files already formatted`; Ruff lint: pass; mypy: no issues in 16 source files |
| `EV-366` | rev 1 / LIN-003 | OpenAPI `--check` only | exporter check exit `0`; SHA-256 до/после `453b715a6ab4677399bd38d9c73d12a6d1d423c80811163becf89794e7b8a93d`; diff отсутствует |
| `EV-367` | rev 1 / LIN-003 | documentation audit и semantic pass | 60 documents, 0 errors, 0 warnings; `api-contracts.md` version 11; один canonical exact order, competing architecture order отсутствует |
| `EV-368` | rev 1 / LIN-003 | scope/preservation/Git | все verify-only/protected hashes совпали с A2; Gate 2.2C card и release test byte-identical; index/untracked empty; `git diff --check` exit `0` |
| `EV-369` | rev 1 / LIN-003 | implementation commit | `7acc58c3eaaa84de3a637a94202f5f7e34a04612`; subject `fix: enforce create batch security precedence`; ровно три mutable remediation paths |
| `EV-370` | rev 1 / LIN-003 | independent verdict и manual acceptance | specialized security/API review: `ACCEPTED`, findings отсутствуют; прямое решение пользователя условно разрешило closure при успешном review, условие выполнено |

### E2. Requirement closure

| Requirements | Closure evidence | Статус |
|---|---|---|
| `REQ-301`–`REQ-303` | `EV-361`–`EV-363` | ACCEPTED |
| `REQ-304`–`REQ-305` | `EV-366`–`EV-367` | ACCEPTED |
| `REQ-306`–`REQ-308` | `EV-363`–`EV-369` | ACCEPTED |

### E3. Lifecycle synchronization

| Объект | Финальное состояние |
|---|---|
| `BLOCK-G21C-001` | `CLOSED / ACCEPTED` |
| `TASK-002 rev 1` | `CLOSED / ACCEPTED`; lifecycle `SYNCED` |
| `LIN-003` | синхронизирован; новая task или lineage не создавалась |
| Gate 2.1C remediation | `CLOSED / ACCEPTED` |
| Gate 2.2C | `CLOSED / ACCEPTED`; `TASK-001 rev 2 / LIN-002` и historical evidence не изменены |
| Gate 2 / Stage 6 | `OPEN / OPEN` |
| Stage 7 | `NOT STARTED` |
| Push / PR / merge / deploy / publication | `NOT PERFORMED` |
