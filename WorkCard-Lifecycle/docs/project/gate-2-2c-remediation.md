---
artifact_id: project.gate-2-2c-remediation
status: active
version: 3
owner: engineering
updated: 2026-08-06
---

# Gate 2.2C OpenAPI security remediation

Состояние: `SYNCED`
Текущая revision: `2`

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

## A (revision 2). Contract — замораживается при READY

`TASK-001 rev 2` полностью заменяет Contract revision 1 для любой будущей remediation. Замороженные A1–A8 revision 1 выше сохранены как история и не переписываются. Revision 2 не объявляет существующие изменения `docs/architecture/api-contracts.md` и `tests/unit/test_release_work_cards_api.py` ранее разрешёнными: они возникли вне allowed scope rev 1, остановлены на full-gate re-review и только перспективно включаются в новый Contract от точного snapshot ниже.

### A1. Revision

| Поле | Значение |
|---|---|
| Task ID | `TASK-001` |
| Revision | `2` |
| Change lineage ID | `LIN-002` |
| Дата/автор решения | `2026-08-01T00:24:13+03:00; пользователь, записано Codex` |
| Причина revision | full-gate re-review вернул `REMEDIATION REQUIRED`: два semantic documentation defects и scope defect revision 1 |
| Изменённые поля | `A1–A8`: новый baseline/snapshot и lineage; findings; цель/scope; источники; вопросы; критерии; checks; permissions |
| Заменяет revision | `TASK-001 rev 1 / LIN-001`; без переноса прежнего review PASS или незаписанных разрешений |

### A2. Риск и Git-контекст

| Поле | Замороженное значение |
|---|---|
| Класс риска | `R2`: Contract касается OpenAPI security и документированного порядка security/input validation; runtime auth/RBAC и архитектурное намерение не меняются |
| Repository root / worktree | `C:/Users/artem/.codex/worktrees/stage-6-mvp/Работа для портфолио` |
| Каталог приложения | `WorkCard-Lifecycle` |
| Branch | `codex/stage-6-mvp-implementation` |
| Baseline SHA / initial HEAD | `785b1a7aa635237135cd15a94e5500ac581e4600`; task-card-only governance delta не меняет implementation baseline |
| Task-card pre-revision baseline | mode `100644`; size `16245`; SHA-256 `d98517fb311de57aeebd5a1814922c8a6b30ae0be7eeca82b2e0767490723d43` |
| Snapshot | `SNAP-G2C-R2-PRE-001`; девять pre-existing dirty implementation/doc/test/OpenAPI files; canonical manifest SHA-256 `13b5ee45ddc9977e69b8b2c92e899bdad798135a46536a5fbfaace74748b9f07` |
| Manifest algorithm | перечисленный ниже порядок путей; `status<TAB>path<TAB>mode<TAB>size<TAB>sha256<LF>`; UTF-8 без BOM; final LF |
| Index | пуст; `git diff --cached --name-status` без вывода |
| Governance-only preservation | в ходе создания rev 2 меняется только эта task-card; все девять записей `SNAP-G2C-R2-PRE-001` обязаны остаться byte-for-byte идентичными |
| Future-remediation preservation | четыре out-of-scope файла остаются byte-for-byte; пять allowed remediation files сохраняют исходные bytes/hunks snapshot и получают только delta, прямо связанный с F-001–F-003; F-004 закрывается самой revision без product-file delta; index остаётся пуст |

Ожидаемый Git status после governance-only revision и до начала remediation:

```text
 M WorkCard-Lifecycle/docs/architecture/adr/0006-demo-session-and-authorization.md
 M WorkCard-Lifecycle/docs/architecture/api-contracts.md
 M WorkCard-Lifecycle/docs/architecture/security-baseline.md
 M WorkCard-Lifecycle/docs/project/gate-2-2c-remediation.md
 M WorkCard-Lifecycle/openapi/openapi.json
 M WorkCard-Lifecycle/src/workcard_api/app.py
 M WorkCard-Lifecycle/tests/integration/test_release_work_cards_postgres.py
 M WorkCard-Lifecycle/tests/unit/test_auth_api.py
 M WorkCard-Lifecycle/tests/unit/test_problem_details.py
?? WorkCard-Lifecycle/tests/unit/test_release_work_cards_api.py
```

| Status | Path | Mode | Size | SHA-256 | Rev 2 treatment |
|---|---|---:|---:|---|---|
| ` M` | `WorkCard-Lifecycle/docs/architecture/adr/0006-demo-session-and-authorization.md` | `100644` | 3771 | `58d04dcc849095fade63296d829a15d7f4c8dcd9bbbe61a975ebf74971a90fee` | out of scope; byte-preserve |
| ` M` | `WorkCard-Lifecycle/docs/architecture/api-contracts.md` | `100644` | 35486 | `20d50dc37b914c8c82d681387be58ae0fe8dc0abbd912e5b4d963275f0d7e5a6` | pre-existing out-of-scope delta under rev 1; prospectively allowed only for F-002/F-003 |
| ` M` | `WorkCard-Lifecycle/docs/architecture/security-baseline.md` | `100644` | 11838 | `20fc5f7478aa9bc7c6ea6e12ab5b795ae6bd4526ed9429873d9d8183e71690af` | out of scope; byte-preserve |
| ` M` | `WorkCard-Lifecycle/openapi/openapi.json` | `100644` | 39007 | `453b715a6ab4677399bd38d9c73d12a6d1d423c80811163becf89794e7b8a93d` | rev 1 overlap; preserve unless F-001 validation requires minimal correction |
| ` M` | `WorkCard-Lifecycle/src/workcard_api/app.py` | `100644` | 40418 | `3b45e165737cb8b32596df87e4fd9c88929414ad61bce7792b8434b13a7310f8` | rev 1 overlap; preserve unless F-001 validation requires minimal correction |
| ` M` | `WorkCard-Lifecycle/tests/integration/test_release_work_cards_postgres.py` | `100644` | 38104 | `175c31a859258231d5d390ee027cf04ffd871500f046d78d31746e893dfbfdeb` | out of scope; byte-preserve |
| ` M` | `WorkCard-Lifecycle/tests/unit/test_auth_api.py` | `100644` | 10655 | `924cdba14f80e5d0a69ba001ed4a621a00bc1cfc54e45bee2021a7d5c4c7116c` | out of scope; byte-preserve |
| ` M` | `WorkCard-Lifecycle/tests/unit/test_problem_details.py` | `100644` | 9131 | `8e4fb3b8b2f6759aea96e3e29c5b7caf1637f46924d283a81c74e3d5674bb1f2` | rev 1 overlap; preserve unless F-001 validation requires minimal correction |
| `??` | `WorkCard-Lifecycle/tests/unit/test_release_work_cards_api.py` | file | 22122 | `cf85b7f9e509cad76c4b195cba7838cc78820caef523e9173285a205188ace5d` | pre-existing out-of-scope delta under rev 1; prospectively allowed only for F-003 test proof if current test is insufficient |

### A3. Цель и границы

**Одна цель:** подготовить минимальный Gate 2.2C remediation package, который сохраняет exact F-001 OpenAPI security semantics, исправляет два documentation findings и доказательно подтверждает полный precedence `session → CSRF → permission → Origin → body schema`, после чего останавливается на `READY FOR RE-REVIEW`.

**Разрешённые remediation files — ровно пять:**

- `WorkCard-Lifecycle/docs/architecture/api-contracts.md` — только замена ложного `committed` на точное working-tree состояние, exact precedence и обязательное metadata version/date сопровождение принятого документа;
- `WorkCard-Lifecycle/tests/unit/test_release_work_cards_api.py` — сначала read/run confirmation; изменение разрешено только если текущий тест не доказывает exact precedence, и только минимальный test-only hunk для F-003;
- `WorkCard-Lifecycle/src/workcard_api/app.py` — только сохранение/минимальная коррекция F-001 operation security при доказанном FAIL;
- `WorkCard-Lifecycle/tests/unit/test_problem_details.py` — только сохранение/минимальная коррекция semantic F-001 regression при доказанном FAIL;
- `WorkCard-Lifecycle/openapi/openapi.json` — только deterministic exporter output, если F-001 check требует коррекции.

`WorkCard-Lifecycle/docs/project/gate-2-2c-remediation.md` разрешён отдельно только для append-only Evidence/Review/Metrics rev 2; A1–A8 после `READY` неизменяемы. Текущая governance-only задача не выполняет ни одно из разрешённых remediation-изменений.

**Non-goals:** любые другие architecture/living-docs/tests/code/OpenAPI изменения; runtime authentication, authorization, CSRF/Origin/permission logic; schema/migrations/dependencies/CI; cleanup/refactoring; ретроактивное объявление rev 1 scope корректным; staging/implementation commit; push/PR; acceptance, sync или закрытие Gate 2.2C, Gate 2 и Stage 6.

### A4. Канонические источники

| Приоритет | Источник | Revision/раздел | Область истины |
|---:|---|---|---|
| 1 | Эта task-card | `TASK-001 rev 2, A1–A8` | записанное актуальное решение пользователя, baseline, scope, criteria, checks и запреты |
| 2 | Текущее явное решение пользователя | `2026-08-01; три medium findings и governance-only boundary` | принятые findings, разрешение новой revision и запрет remediation в этом действии |
| 3 | `C:/Users/artem/Documents/Codex/2026-07-29/chatgpt-codex-claude-git-worktree-ci/personal-ai-audit/personal-ai-rules.md` | `v0.1, §§1–7` | revision lifecycle, overlap decision, preservation, risk и review |
| 4 | Эта task-card выше | `TASK-001 rev 1 / LIN-001, frozen A1–A8 и B–D` | исторический scope/evidence; не действует для будущей remediation |
| 5 | `docs/project/decision-log.md` | `v14, D-025–D-026` | Gate 2.2 boundary и governance recovery |
| 6 | `docs/architecture/api-contracts.md` | `SNAP-G2C-R2-PRE-001`, SHA-256 `20d50dc...` | наблюдаемые F-002/F-003 и документационный target |
| 7 | `tests/unit/test_release_work_cards_api.py` | `SNAP-G2C-R2-PRE-001`, SHA-256 `cf85b7f...` | наблюдаемый precedence-test candidate; execution ещё не PASS |
| 8 | `src/workcard_api/app.py`, `tests/unit/test_problem_details.py`, `openapi/openapi.json` | `SNAP-G2C-R2-PRE-001`, per-file SHA-256 A2 | существующий F-001 remediation candidate и machine-readable evidence |
| 9 | `.codex/templates/remediation.md` и personal `task-card-template.md` | current repository copy / `v0.1` | narrow remediation и revision format |

### A5. Вопросы

| ID | Вопрос | Класс | Решение | Статус |
|---|---|---|---|---|
| `Q-201` | Допустима ли ратификация существующего out-of-scope delta новой revision? | blocking | ретроактивная ратификация запрещена; personal rules разрешают перспективную обработку пересечения только после явного решения, нового snapshot, нового Contract и нового lineage; выбран именно этот путь | RESOLVED |
| `Q-202` | Как учитывать `api-contracts.md` и `test_release_work_cards_api.py`? | blocking | записать как существовавшие и неразрешённые rev 1 delta; принять их exact bytes в rev 2 baseline; разрешить только F-002/F-003 treatment, без заявления прежнего разрешения или PASS | RESOLVED |
| `Q-203` | Отсутствует ли review source artifact/thread? | non-blocking | три finding приняты из прямого full-gate результата пользователя и воспроизводимы по snapshot; reviewer/thread остаётся GAP, поэтому LIN-002 требует нового independent review context | RESOLVED |
| `Q-204` | Нужен ли отдельный governance commit? | non-blocking | применимые rules требуют отдельного разрешения на commit, но не требуют commit для frozen revision; условие пользователя не активировано, task-card остаётся единственным governance diff | RESOLVED |
| `Q-205` | Stale router labels `rev 1` вне allowed file | non-blocking | routers указывают тот же canonical task-card path, а task-specific Contract имеет приоритет; labels остаются recorded GAP до отдельной разрешённой sync, не дают права использовать rev 1 и не позволяют заявить `SYNCED` | RESOLVED |

### A6. Критерии приёмки

| Requirement ID | Проверяемый критерий |
|---|---|
| `REQ-201` | `api-contracts.md` прямо говорит, что текущий `openapi/openapi.json` — generated working-tree snapshot, dirty относительно `785b1a7...`, и не называет его committed; version повышена относительно snapshot version 9 и дата обновлена |
| `REQ-202` | `api-contracts.md` фиксирует один полный exact порядок: `session → CSRF → permission → Origin → body schema`; соседние пункты и prose ему не противоречат |
| `REQ-203` | Focused precedence tests доказательно различают все границы: invalid/missing session побеждает CSRF/body; invalid CSRF побеждает permission/Origin/body; permission denial побеждает Origin/body; invalid Origin побеждает malformed body; gateway не вызывается |
| `REQ-204` | F-001 semantics остаются exact: пять protected operations имеют ровно `[{"SessionCookie": []}]`, четыре public operations не имеют key `security`; runtime auth/RBAC behavior не меняется |
| `REQ-205` | Все mandatory checks A7 учтены; четыре out-of-scope files byte-identical; пять allowed files отличаются от A2 только разрешёнными finding hunks; index пуст |
| `REQ-206` | Результат только `READY FOR RE-REVIEW`; прежние review/evidence не переносятся как PASS; Gate 2.2C, Gate 2 и Stage 6 остаются открыты |

### A7. Обязательные проверки

Текущая governance-only revision выполняет только `CHK-GOV-*`, `CHK-DIFF-201` и `CHK-S-201`. Остальные проверки обязательны после отдельно начатой remediation и не выполняются в этом действии.

| Check ID | Тип | Requirements | Команда/метод | Ожидание |
|---|---|---|---|---|
| `CHK-GOV-201` | baseline | REQ-205/206 | exact root/branch/HEAD/status/index commands | baseline A2 совпадает; index empty |
| `CHK-GOV-202` | structural docs | REQ-205/206 | `python C:/Users/artem/.codex/skills/project-docs-auditor/scripts/audit_docs.py --root .` из `WorkCard-Lifecycle` | 0 errors; warnings записаны, не скрыты |
| `CHK-GOV-203` | semantic governance | REQ-206 | targeted search `TASK-001 rev 1|Gate 2.2C` в active routers + осмысленное сравнение | stale labels перечислены как GAP; competing task-card path отсутствует |
| `CHK-DOC-201` | documentation | REQ-201 | сравнить intro `api-contracts.md` с `git status --short -- openapi/openapi.json` и baseline `785b1a7...` | working-tree/dirty statement exact; `committed` не относится к текущему snapshot |
| `CHK-DOC-202` | documentation | REQ-202 | semantic read `## Порядок обработки` и соседних security rules | exact five-step precedence без противоречия |
| `CHK-P-201` | focused positive/negative | REQ-203 | `python -m pytest tests/unit/test_release_work_cards_api.py::test_csrf_failure_precedes_permission_denial tests/unit/test_release_work_cards_api.py::test_exact_security_precedence_before_malformed_body` | PASS; all parametrized cases; gateway calls empty |
| `CHK-P-202` | regression | REQ-203/204 | `python -m pytest tests/unit/test_release_work_cards_api.py tests/unit/test_problem_details.py` | PASS |
| `CHK-P-203` | unit suite | REQ-204/205 | `python -m pytest tests/unit` | PASS |
| `CHK-O-201` | snapshot | REQ-204 | `python scripts/export_openapi.py --check` | current |
| `CHK-O-202` | semantic negative | REQ-204 | parsed JSON exact nine-operation gate from rev 1 | protected exact; public key absent, not `security: []` |
| `CHK-Q-201` | format/lint/types | REQ-205 | `python -m ruff format --check .`; `python -m ruff check .`; `python -m mypy src` | all PASS |
| `CHK-DIFF-201` | diff/index | REQ-205 | `git diff --check`; `git diff --cached --check`; `git diff --cached --name-only` | exit 0; index command has no output |
| `CHK-S-201` | preservation | REQ-205 | recompute A2 SHA-256 manifest; byte compare four protected files; hunk compare five overlaps; separate task-card delta | exact preservation contract satisfied |
| `CHK-RV-201` | independent re-review | REQ-201–206 | new specialized security/API/docs reviewer context on LIN-002 real diff and results | all F-001–F-004 closed or explicitly dispositioned; only then reviewer may return no open findings |

### A8. Разрешения

| Действие | Разрешено | Граница |
|---|---|---|
| Создание rev 2 в task-card | да | текущая governance-only задача пользователя; только этот файл |
| Future remediation пяти A3 files | да | только после rev 2 `READY`; только F-001–F-003 minimal delta; F-004 не разрешает product delta |
| Append-only task Evidence/Review/Metrics | да | только эта task-card; frozen A1–A8 не менять |
| Изменение иных dirty files | нет | четыре protected paths A2 byte-preserved |
| Staging / implementation commit | нет | remediation permission не включает Git mutation |
| Governance commit | нет | правила не требуют; условное разрешение пользователя не активировано |
| Push / PR / deploy / publication | нет | запрещено |
| Checkout/switch/merge/rebase/reset/restore/stash/clean | нет | запрещено |
| Schema/migrations/dependencies/CI/runtime auth/RBAC | нет | вне scope |
| Gate 2.2C / Gate 2 / Stage 6 closure | нет | stop at `READY FOR RE-REVIEW` |

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

### B7. Revision 2 governance evidence

| Evidence ID | Revision / lineage | Check/event | Exact method | Exit / result |
|---|---|---|---|---|
| `EV-050` | rev 2 / LIN-002 | user decision / new revision | direct instruction `2026-08-01`; A1–A8 | new prospective Contract authorized; rev 1 out-of-scope delta not retroactively authorized |
| `EV-051` | rev 2 / LIN-002 | `CHK-GOV-201` | `git rev-parse --show-toplevel`; `git branch --show-current`; `git rev-parse HEAD`; `git status --short`; cached name/status | 0; exact worktree/branch/`785b1a7...`; 8 modified + 1 untracked pre-governance; index empty |
| `EV-052` | rev 2 / LIN-002 | pre-work fingerprint | SHA-256/size/mode for nine dirty paths; canonical manifest A2 | 0; `SNAP-G2C-R2-PRE-001`; manifest `13b5ee45...`; task-card baseline `d98517fb...` |
| `EV-053` | rev 2 / LIN-002 | F-002–F-004 reproduction | targeted `git diff`, `rg` and semantic read of `api-contracts.md`, `test_release_work_cards_api.py`, rev 1 A3/A8 | 0; false `committed`, incomplete documented order and two missing rev 1 paths confirmed; implementation tests not run |
| `EV-054` | rev 2 / LIN-002 | `CHK-GOV-202` | Python 3.12.8 `audit_docs.py --root .` from `WorkCard-Lifecycle` | 0; 59 documents; 0 errors; 0 warnings; structural PASS only |
| `EV-055` | rev 2 / LIN-002 | `CHK-GOV-203` | targeted router search and semantic comparison | 0; stale `rev 1` labels in `documentation-index.md`, `project-state.md`, `backlog.md`; same canonical task-card path; no competing card; non-blocking GAP under Q-205 |
| `EV-056` | rev 2 / LIN-002 | `CHK-DIFF-201` governance pass | `git diff --check`; cached check/name-only | 0; no whitespace errors; only LF→CRLF Git notices; index empty |
| `EV-057` | rev 2 / LIN-002 | `CHK-S-201` governance preservation | recompute size/SHA-256 of all nine A2 entries | 0; 9/9 exact matches; task-card is sole governance delta |
| `EV-058` | rev 2 / LIN-002 | READY transition | Contract completeness + EV-050–EV-057; `2026-08-01T00:30:16+03:00` | rev 2 READY; remediation/re-review/acceptance/sync not started |

### B8. RCY-002 remediation evidence — append-only

| Evidence ID | Revision / lineage / cycle | Check/event | Exact method | Exit / result |
|---|---|---|---|---|
| `EV-060` | rev 2 / LIN-002 / RCY-002 | remediation start | root/branch/HEAD/status/index + SHA-256 replay of A2 and task-card; `2026-08-01` | 0; exact `785b1a7...`, expected dirty set, index empty, all snapshot hashes matched |
| `EV-061` | rev 2 / LIN-002 / RCY-002 | implementation | minimal diff from `SNAP-G2C-R2-PRE-001` | only `docs/architecture/api-contracts.md`: version `9→10`, date, working-tree/baseline wording and exact ReleaseWorkCards precedence; test/code/OpenAPI bytes preserved |
| `EV-062` | rev 2 / LIN-002 / RCY-002 | `CHK-DOC-201/202` | targeted diff/`rg` + semantic read of intro, `## Порядок обработки` and related accepted architecture summaries | 0; generated dirty snapshot statement exact; `session → CSRF → permission → Origin → body schema` exact; other documents contain only non-ordering high-level summaries, no competing exact sequence |
| `EV-063` | rev 2 / LIN-002 / RCY-002 | `CHK-P-201` isolated run | Python 3.12.8 project environment; two exact node IDs with repository default addopts | 1; all 7 cases passed, then standalone coverage 50.09% was below global 85% threshold; no test/runtime/security failure |
| `EV-064` | rev 2 / LIN-002 / RCY-002 | `CHK-P-201` focused result | same two exact node IDs with `--no-cov` to isolate assertions | 0; 7 passed; every precedence boundary and `gateway.calls == []` passed |
| `EV-065` | rev 2 / LIN-002 / RCY-002 | `CHK-P-202` isolated run | exact two unit files with repository default addopts | 1; all 50 tests passed, then standalone coverage 59.16% was below global 85% threshold; no test/runtime/security failure |
| `EV-066` | rev 2 / LIN-002 / RCY-002 | `CHK-P-202` focused result | same two files with `--no-cov` to isolate assertions | 0; 50 passed |
| `EV-067` | rev 2 / LIN-002 / RCY-002 | `CHK-P-203` | full `tests/unit` with repository default coverage config | 0; 215 passed; coverage 88.51%, required 85% reached |
| `EV-068` | rev 2 / LIN-002 / RCY-002 | `CHK-O-201` | existing `scripts/export_openapi.py --check` under Python 3.12.8 project environment | 0; working-tree snapshot current; exporter made no change |
| `EV-069` | rev 2 / LIN-002 / RCY-002 | `CHK-O-202` | independent parsed JSON gate over exact nine method/path pairs | 0; five protected operations exact `[{"SessionCookie": []}]`; four public operation objects omit key `security` |
| `EV-070` | rev 2 / LIN-002 / RCY-002 | `CHK-Q-201` format | Ruff `format --check .` | 0; 34 files already formatted |
| `EV-071` | rev 2 / LIN-002 / RCY-002 | `CHK-Q-201` lint | Ruff `check .` | 0; all checks passed |
| `EV-072` | rev 2 / LIN-002 / RCY-002 | `CHK-Q-201` types | mypy `src` | 0; no issues in 16 source files |
| `EV-073` | rev 2 / LIN-002 / RCY-002 | `CHK-GOV-202/203` | project-docs-auditor + targeted semantic search | 0; 59 documents, 0 errors, 0 warnings; no semantic conflict requiring in-scope change |
| `EV-074` | rev 2 / LIN-002 / RCY-002 | `CHK-DIFF-201` | `git diff --check`; cached check/name-only | 0; no whitespace error; LF→CRLF notices only; index empty |
| `EV-075` | rev 2 / LIN-002 / RCY-002 | `CHK-S-201` | post-remediation size/SHA-256 comparison against A2 | 0; four out-of-scope files exact; `app.py`, `test_problem_details.py`, `openapi.json` and `test_release_work_cards_api.py` exact; only authorized `api-contracts.md` delta, post SHA-256 `f2f6e3867b7ca07c48ad27c3de8196c47ef4a005123b367e6aa358da977bffb8` |
| `EV-076` | rev 2 / LIN-002 / RCY-002 | implementation handoff | requirements/check review; `2026-08-01T07:23:34+03:00` | `READY FOR RE-REVIEW`; F-001–F-004 closure remains subject to independent re-review; Gate/Stage remain open |

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

## C2. Full-gate re-review findings for revision 2

Review source: direct user-provided full-gate result `REMEDIATION REQUIRED` on `2026-08-01`; original reviewer thread/artifact locator is unavailable (`EV-053`, Q-203). Findings are accepted for remediation because their observable facts were independently reproduced against `785b1a7... + SNAP-G2C-R2-PRE-001`. Это не переносит прежний review PASS; `LIN-002` требует нового independent review context.

| Finding ID | Severity | Evidence | Confirmation / classification | Root cause | Disposition | Closure |
|---|---|---|---|---|---|---|
| `F-002` | `medium`: документация неверно характеризует состояние machine-readable contract | `docs/architecture/api-contracts.md:11` говорит `Текущий committed snapshot`, тогда как `openapi/openapi.json` имеет working-tree modification относительно `785b1a7...`; EV-053 | confirmed / unique | `RC-002`: documentation state drift | fix; user | OPEN; REQ-201 + CHK-DOC-201 + re-review |
| `F-003` | `medium`: неполный security/input precedence contract | `docs/architecture/api-contracts.md:483–488` объединяет session/CSRF и пропускает Origin; требуемая цепочка `session → CSRF → permission → Origin → body schema`; EV-053 | confirmed / unique | `RC-003`: precedence collapsed in prose | fix; user | OPEN; REQ-202/203 + CHK-DOC-202/CHK-P-201 + re-review |
| `F-004` | `medium`: frozen Contract не разрешал два реально присутствующих path | rev 1 A3/A8 разрешают только `app.py`, `test_problem_details.py`, `openapi.json`, но snapshot содержит delta `api-contracts.md` и untracked `test_release_work_cards_api.py`; EV-051–EV-053 | confirmed / unique | `RC-004`: incomplete allowed-scope enumeration | fix by new revision; user | candidate governance fix A1–A8; OPEN до independent re-review; прежние delta не названы ранее разрешёнными |

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

### D2. Revision 2 metric note — append-only

| Метрика | Значение |
|---|---|
| Current lineage | `LIN-002 → TASK-001 rev 2; baseline 785b1a7... + SNAP-G2C-R2-PRE-001`; LIN-001 evidence/review не переносится как PASS |
| Full-gate findings | `medium=3`: F-002/F-003/F-004; confirmation EV-053; root causes RC-002/RC-003/RC-004 |
| All recorded findings | `medium=4`: F-001–F-004; все closure остаются OPEN до required evidence/re-review |
| Remediation cycles | rev 2 remediation not started; `RCY-002` planned |
| ACCEPTED / SYNCED | `N/A / N/A` |
| Gate/Stage | Gate 2.2C, Gate 2 и Stage 6 открыты |

### D3. RCY-002 remediation metrics — append-only

| Метрика | Значение |
|---|---|
| Cycle / lineage | `RCY-002 / LIN-002 / TASK-001 rev 2`; originating implementer context |
| Фактически изменённые product files | `1`: `docs/architecture/api-contracts.md`; task-card дополнена только append-only evidence/metrics |
| Test result | focused 7/7 PASS; two-file 50/50 PASS; full unit 215/215 PASS; global coverage 88.51% ≥ 85% |
| Standalone coverage side effect | exact narrow invocations exit 1 only after all tests passed because isolated coverage was 50.09%/59.16%; supplemental focused runs exit 0 and full mandatory coverage gate exit 0; no high/medium defect |
| OpenAPI | exporter current; five protected exact; four public key-absent; runtime/OpenAPI files unchanged |
| Requirement status | REQ-201–REQ-205 implementation evidence present; REQ-206 satisfied at `READY FOR RE-REVIEW`; independent CHK-RV-201 pending |
| Finding status | F-001–F-004 remediation candidate complete; closure remains OPEN until independent re-review |
| Preservation | four out-of-scope files byte-identical; four unneeded allowed files byte-identical; index empty |
| Git/publication | no staging, commit, push, PR or branch/worktree mutation |
| Gate/Stage | Gate 2.2C, Gate 2 and Stage 6 remain open |

## Stop condition

После минимального remediation и CHK-P/N/S остановиться со статусом `READY FOR RE-REVIEW`. Independent re-review выполняется отдельно; следующий finding, Gate или Stage не начинать и не закрывать.

## Stop condition — revision 2

Эта governance-only revision останавливается в `READY`: implementation, tests, OpenAPI и architecture documentation не исправлялись. Будущая remediation выполняет только A3/A7 revision 2 и останавливается на `READY FOR RE-REVIEW`; Gate 2.2C, Gate 2 и Stage 6 не принимаются и не закрываются.

## E. F-003 test-matrix remediation follow-up — append-only

### E1. Evidence

Finding source: прямое подтверждённое пользователем finding `F-003 / TASK-001 rev 2 / REQ-203` от `2026-08-06`: существующий permission-case доказывал только `permission → body`, потому что использовал trusted Origin, а отдельный PLANNER-case доказывал только `Origin → body`. Перестановка permission и Origin оставалась незамеченной. Это same-lineage продолжение `LIN-002 / RCY-002`, а не новая revision, task-card, lineage или governance cycle.

Точный test-only diff в существующей parametrized precedence-матрице:

```diff
-        "Origin": "http://testserver",
+        "Origin": "https://attacker.example" if case == "permission" else "http://testserver",
```

Permission-row по-прежнему выбирает `MASTER_ID` через `select_identity`, поэтому сохраняет authenticated session и valid CSRF; `content="{"` остаётся malformed body; row по-прежнему ожидает `403 / PERMISSION_DENIED`; общий `assert release_gateway.calls == []` не изменён. Дублирующий тест не добавлялся.

| Evidence ID | Check/event | Exact method | Exit / result |
|---|---|---|---|
| `EV-077` | remediation baseline | exact root/branch/HEAD/status/index; SHA-256 fingerprint всех tracked/untracked файлов кроме двух разрешённых путей | 0; exact worktree, `codex/stage-6-mvp-implementation`, `785b1a7aa635237135cd15a94e5500ac581e4600`, index empty; 115-file preservation aggregate `fdee1cf57dcd93cbacaa3fb0b54029c2e419d5b2676db7b6894ad2773b687529` |
| `EV-078` | minimal implementation | one-line conditional Origin in existing permission-case | 0; test file `cf85b7f... / 22122 bytes → 3046a91a... / 22178 bytes`; no duplicate test |
| `EV-079` | `CHK-P-201` | exact two node IDs with `--no-cov` under Python 3.12.8 local environment | 0; 7 passed; permission beats untrusted Origin and malformed body; gateway calls empty |
| `EV-080` | `CHK-P-202` | `tests/unit/test_release_work_cards_api.py tests/unit/test_problem_details.py --no-cov` | 0; 50 passed |
| `EV-081` | `CHK-P-203` | full `tests/unit` with repository default coverage config | 0; 215 passed; coverage 88.51%, required 85% reached |
| `EV-082` | semantic test-matrix gate | read-only Python AST parse of parametrization and target function | 0; exact conflict found: authenticated `MASTER`, valid CSRF, invalid Origin, malformed body, expected `403 PERMISSION_DENIED`, `gateway.calls == []` |
| `EV-083` | `CHK-O-201/202` | exporter `--check`; independent parsed nine-operation JSON gate | 0 / 0; five protected exact `[{"SessionCookie": []}]`; four public operations omit key `security` |
| `EV-084` | documentation audit/semantic gate | project-docs-auditor `--fail-on-warning`; parsed `## Порядок обработки` numbered steps and exact arrow sequence | 0 / 0; 59 documents, 0 errors, 0 warnings; exact `session → CSRF → permission → Origin → body schema` |
| `EV-085` | quality | Ruff `format --check ..`; Ruff `check ..`; mypy `src` | 0 / 0 / 0; 34 formatted; lint clean; no issues in 16 source files |
| `EV-086` | diff/index | `git diff --check`; cached diff check/name-only/name-status | 0 / 0 / 0 / 0; LF→CRLF notices only; cached path count 0; index empty |
| `EV-087` | preservation | recomputed 115-file aggregate excluding the two allowed paths plus exact key-path SHA-256 checks | 0; aggregate unchanged `fdee1cf5...`; `app.py`, `test_problem_details.py`, `openapi.json` and `api-contracts.md` hashes exact |
| `EV-088` | execution-harness diagnostics | initial PATH/bootstrap/quoting attempts before successful equivalent reruns | exits `1 / 4 / 1 / 1`; non-ASCII `PYTHONPATH`, missing explicit application root, PowerShell quoting and cp1251 output only; no product/runtime assertion failed; successful checks are EV-079–EV-085 |

### E2. Review handoff

| Поле | Значение |
|---|---|
| Remediation status | `READY FOR RE-REVIEW` |
| Finding | `F-003` remediation evidence present; closure remains subject to independent final re-review |
| Independent review in this action | not performed |
| Git/publication | index empty; no `git add`, commit, push or PR |
| Gate/Stage | Gate 2.2C, Gate 2 and Stage 6 remain open |

### E3. Metrics

| Метрика | Значение |
|---|---|
| Revision / lineage / cycle | `TASK-001 rev 2 / LIN-002 / RCY-002 continuation`; no new governance cycle |
| Фактически изменённые files | `tests/unit/test_release_work_cards_api.py` one-line matrix delta; this task-card append-only Evidence/Review/Metrics |
| Tests | focused 7/7; two-file 50/50; full unit 215/215; coverage 88.51% |
| Semantic gates | test matrix exact conflict PASS; OpenAPI 5 protected/4 public PASS; documentation exact precedence PASS |
| Preservation | 115-file aggregate outside allowed paths unchanged; runtime, OpenAPI and architecture documentation unchanged |
| Stop condition | `READY FOR RE-REVIEW`; independent final re-review required |

## F. Independent final re-review, manual acceptance and controlled closure — append-only

### F1. Review and acceptance record

Эта запись не проводит повторный review. Она фиксирует прямое решение пользователя от `2026-08-06`: независимый финальный re-review `TASK-001 rev 2 / LIN-002` завершён verdict `ACCEPTED`, подтверждённых findings нет, F-002–F-004 устранены, REQ-201–REQ-206 доказаны. Отдельный reviewer-thread/artifact locator в controlled-closure контекст не передан; источник verdict — текущее явное решение пользователя.

| Evidence ID | Событие | Источник / метод | Результат |
|---|---|---|---|
| `EV-089` | controlled-closure baseline | exact root/branch/HEAD/status/stat/index/scope; `git diff --check`; staged checks | exit 0; exact `785b1a7aa635237135cd15a94e5500ac581e4600`, 9 tracked modified + 1 untracked, tracked `1324+/28-`, index empty; exact ten-file scope |
| `EV-090` | implementation commit | exact staged `9 M + 1 A`; `git diff --cached --check`; commit | exit 0; `2ab56fcde3dc5ce88ebae9a9709f55b4ae7b72f0`, subject `feat: add work card release HTTP API`, 10 files, `1989+/28-` |
| `EV-091` | independent final re-review | direct user-provided result `2026-08-06`; review not repeated in closure | verdict `ACCEPTED`; no confirmed/open findings; F-002–F-004 closed; REQ-201–REQ-206 proven |
| `EV-092` | manual acceptance | direct explicit user decision `2026-08-06T19:52:12+03:00` | Gate 2.2C accepted; implementation commit authorized and recorded; lifecycle sync authorized |
| `EV-093` | lifecycle pre-stage verification | project-docs-auditor `--fail-on-warning`; 13-assertion semantic lifecycle gate; `git diff --check`; exact scope and forbidden-path comparison | exits `0 / 0 / 0 / 0`; 59 documents, 0 errors, 0 warnings; 13/13 semantic assertions; only six lifecycle Markdown files; no post-implementation code/test/OpenAPI/architecture diff |

### F2. Final finding and requirement disposition

Исторические строки C/C2 и D/D2/D3 выше не переписываются. Эта append-only запись является актуальным disposition.

| Item | Final status | Evidence |
|---|---|---|
| `F-001` | `CLOSED` | exact OpenAPI semantics EV-083; independent verdict `ACCEPTED` EV-091 |
| `F-002` | `CLOSED` | REQ-201 / EV-061–EV-062; independent verdict `ACCEPTED` EV-091 |
| `F-003` | `CLOSED` | REQ-202–REQ-203 / EV-077–EV-085; independent verdict `ACCEPTED` EV-091 |
| `F-004` | `CLOSED` | rev 2 prospective scope and preservation EV-050–EV-058, EV-075, EV-087; independent verdict `ACCEPTED` EV-091 |
| `REQ-201`–`REQ-206` | `PROVEN` | remediation evidence EV-061–EV-087 and independent verdict `ACCEPTED` EV-091 |

### F3. Lifecycle disposition

| Уровень | Статус на 2026-08-06 | Основание |
|---|---|---|
| `TASK-001 rev 2 / LIN-002` | `SYNCED` | Contract выполнен; final re-review `ACCEPTED`; findings closed; manual acceptance записана; implementation commit и lifecycle-doc sync зафиксированы |
| Gate 2.2C | `CLOSED / ACCEPTED` | task `SYNCED`, implementation commit `2ab56fcde3dc5ce88ebae9a9709f55b4ae7b72f0` |
| Gate 2 | `OPEN` | implementation commits Gate 2.1 и Gate 2.2A/B существуют, но отдельные manual acceptance-записи обязательных частей не найдены |
| Stage 6 | `OPEN` | Gate 1 остаётся `publication CI pending`; GitHub Actions/PostgreSQL 18.1 и Docker image/readiness smoke не подтверждены; Gate 2 не закрыт |
| Stage 7 | `NOT STARTED` | текущая authorization прямо запрещает начинать Stage 7 |

### F4. Residual gaps and publication status

- `GAP-S6-001`: PostgreSQL 18.1 independent/publication verification Stage 6 не выполнена.
- `GAP-S6-002`: отдельных manual acceptance-записей Gate 2.1 и Gate 2.2A/B нет; implementation commits не подменяют acceptance.
- После implementation commit принятая `docs/architecture/api-contracts.md` исторически описывает OpenAPI как dirty относительно `785b1a7...`; её изменение после первого commit прямо запрещено текущей controlled-closure authorization. Актуальный lifecycle-статус хранит [[project-state]]; отдельная correction task потребуется до Stage 6 closure.
- Push и PR не выполнялись; deploy/publication не выполнялись.
- Lifecycle commit является docs-only и не изменяет production code, tests, OpenAPI или architecture documents.
