# Narrow review remediation

Заполните все placeholders до начала работы. Только findings, явно принятые в разделе 3, разрешают исправления. Recommendation сама по себе не становится remediation task.

## 1. Remediation task

- Remediation task: `<REMEDIATION_TASK>`
- Исправляемый дефект или группа связанных дефектов: `<DEFECT_OR_RELATED_DEFECT_GROUP>`
- Источник findings: `<REVIEW_SOURCE>`
- Идентификаторы принятых findings: `<ACCEPTED_FINDING_IDS>`
- Ожидаемый результат remediation: `<EXPECTED_REMEDIATION_RESULT>`
- Критерий завершения: `<COMPLETION_CRITERION>`

## 2. Repository and baseline

- Worktree: `<WORKTREE_PATH>`
- Git root: `<GIT_ROOT>`
- Каталог приложения: `<APPLICATION_DIRECTORY>`
- Branch: `<BRANCH>`
- HEAD: `<HEAD_SHA>`
- Ожидаемый initial Git status:

```text
<EXPECTED_INITIAL_GIT_STATUS>
```

- Commit или diff, относительно которого выполнялось review: `<REVIEWED_COMMIT_OR_DIFF>`

Если фактический baseline отличается, остановитесь и зафиксируйте расхождение; не изменяйте baseline самостоятельно.

## 3. Accepted findings

Повторите строку для каждого явно принятого finding. Допустимые категории: `confirmed defect` или `accepted risk`.

| Identifier | Category | Severity | Exact evidence or location | Concrete impact | Required fix |
| --- | --- | --- | --- | --- | --- |
| `<FINDING_ID>` | `<CONFIRMED_DEFECT_OR_ACCEPTED_RISK>` | `<SEVERITY>` | `<EVIDENCE>` | `<IMPACT>` | `<REQUIRED_FIX>` |

Исправляйте только findings из этой таблицы. Recommendation, отсутствующая в таблице, не разрешает изменение. Если finding невозможно подтвердить в allowed scope, остановитесь и запишите `<VERIFICATION_GAP>`; не расширяйте scope для подтверждения или исправления.

## 4. Rejected or deferred findings

Повторите строку для каждого непринятого finding.

| Identifier | Status | Reason | Scope prohibition |
| --- | --- | --- | --- |
| `<FINDING_ID>` | `<REJECTED_OR_DEFERRED>` | `<REJECTION_OR_DEFERRAL_REASON>` | `DO NOT FIX IN THIS REMEDIATION` |

## 5. Allowed scope

Разрешено читать только следующие точные repo-relative paths:

- `<FILE_ALLOWED_TO_READ_1>`
- `<FILE_ALLOWED_TO_READ_2>`

Разрешено изменять только следующие точные repo-relative paths:

- `<FILE_ALLOWED_TO_CHANGE_1>`
- `<FILE_ALLOWED_TO_CHANGE_2>`

Разрешены только следующие точные команды:

```text
<ALLOWED_COMMAND_1>
<ALLOWED_COMMAND_2>
```

Любой неуказанный файл или команда находится вне scope. Не расширяйте scope самостоятельно; при недостаточном scope остановитесь и зафиксируйте `<SCOPE_GAP>`.

## 6. Required remediation

- Минимальные изменения:
  1. `<MINIMAL_CHANGE_1>`
  2. `<MINIMAL_CHANGE_2>`
- Поведение, которое должно измениться: `<BEHAVIOR_TO_CHANGE>`
- Поведение, которое обязано остаться неизменным: `<BEHAVIOR_TO_PRESERVE>`
- Ограничения совместимости: `<COMPATIBILITY_CONSTRAINTS>`
- Попутный refactoring и cleanup: `PROHIBITED`

Если требуемое исправление предполагает архитектурное изменение вне allowed scope, остановитесь, зафиксируйте `<ARCHITECTURAL_DECISION_REQUIRED>` и запросите отдельное решение; не выполняйте такое изменение в этой remediation-подзадаче.

## 7. Regression boundaries

- Существующие сценарии, которые нельзя сломать:
  - `<PROTECTED_SCENARIO_1>`
  - `<PROTECTED_SCENARIO_2>`
- Принятые архитектурные и продуктовые решения:
  - `<ACCEPTED_ARCHITECTURE_OR_PRODUCT_DECISION_1>`
  - `<ACCEPTED_ARCHITECTURE_OR_PRODUCT_DECISION_2>`
- Файлы или интерфейсы, которые нельзя пересматривать:
  - `<PROTECTED_FILE_OR_INTERFACE_1>`
  - `<PROTECTED_FILE_OR_INTERFACE_2>`
- Соседние findings, не входящие в remediation:
  - `<OUT_OF_SCOPE_FINDING_1>`
  - `<OUT_OF_SCOPE_FINDING_2>`

## 8. Validation

| Purpose | Exact command | Expected result | Expected exit code |
| --- | --- | --- | --- |
| Воспроизведение исходного дефекта | `<DEFECT_REPRODUCTION_CHECK>` | `<EXPECTED_REPRODUCTION_RESULT>` | `<EXPECTED_REPRODUCTION_EXIT_CODE>` |
| Проверка исправления | `<REMEDIATION_CHECK>` | `<EXPECTED_REMEDIATION_CHECK_RESULT>` | `<EXPECTED_REMEDIATION_EXIT_CODE>` |
| Обязательный regression test | `<REGRESSION_TEST>` | `<EXPECTED_REGRESSION_RESULT>` | `<EXPECTED_REGRESSION_EXIT_CODE>` |
| Static check | `<STATIC_CHECK>` | `<EXPECTED_STATIC_CHECK_RESULT>` | `<EXPECTED_STATIC_CHECK_EXIT_CODE>` |

- Поведение при недоступной зависимости или инструменте: `<UNAVAILABLE_DEPENDENCY_OR_TOOL_HANDLING>`
- Обязательные evidence для skipped или blocked проверки: `<COMMAND_OUTPUT_EXIT_CODE_AND_REASON>`
- Verification gaps: `<VERIFICATION_GAPS_OR_NONE>`

Не устанавливайте замену и не расширяйте scope без разрешения. Не выдавайте partial, alternate, skipped или blocked validation за полную проверку.

## 9. Reviewer re-check package

- Минимальный diff или точный список файлов для re-check: `<MINIMAL_RECHECK_DIFF_OR_FILES>`
- Исходные findings: `<ORIGINAL_FINDINGS>`
- Результаты validation с exit codes: `<VALIDATION_RESULTS>`
- Известные ограничения: `<KNOWN_LIMITATIONS_OR_NONE>`

Передавайте reviewer только этот минимальный пакет. Не передавайте весь репозиторий, если он не требуется для проверки принятых findings.

## 10. Git and publication boundaries

Заполните разрешения значениями `YES` или `NO`; незаполненное поле означает `NO`.

- Staging: `<STAGING_ALLOWED_YES_OR_NO>`
- Commit: `<COMMIT_ALLOWED_YES_OR_NO>`
- Допустимое commit message: `<ALLOWED_COMMIT_MESSAGE_OR_NOT_APPLICABLE>`
- Push: `NO`
- PR mutations: `<PR_MUTATIONS_ALLOWED_YES_OR_NO>`
- Branch mutations: `<BRANCH_MUTATIONS_ALLOWED_YES_OR_NO>`
- Worktree mutations: `<WORKTREE_MUTATIONS_ALLOWED_YES_OR_NO>`
- Checkout, switch, merge или rebase: `<OTHER_GIT_MUTATIONS_ALLOWED_YES_OR_NO>`
- Отдельное пользовательское подтверждение перед каждой разрешённой mutation: `REQUIRED`

Template не может отменить более строгие repository-level запреты. Для остальных разрешаемых mutations значение `YES` задаёт только допустимую границу и не заменяет отдельное пользовательское подтверждение непосредственно перед mutation.

## 11. Completion report

- Фактический baseline:
  - Worktree: `<ACTUAL_WORKTREE_PATH>`
  - Git root: `<ACTUAL_GIT_ROOT>`
  - Branch: `<ACTUAL_BRANCH>`
  - Initial HEAD: `<ACTUAL_INITIAL_HEAD_SHA>`
  - Initial Git status: `<ACTUAL_INITIAL_GIT_STATUS>`
- Исправленные findings:
  - `<FIXED_FINDING_ID_1>`
  - `<FIXED_FINDING_ID_2>`
- Изменённые файлы:
  - `<CHANGED_FILE_1>`
  - `<CHANGED_FILE_2>`

| Executed check | Material result | Exit code |
| --- | --- | --- |
| `<EXECUTED_CHECK_1>` | `<ACTUAL_RESULT_1>` | `<ACTUAL_EXIT_CODE_1>` |
| `<EXECUTED_CHECK_2>` | `<ACTUAL_RESULT_2>` | `<ACTUAL_EXIT_CODE_2>` |

- Итоговый Git status:

```text
<FINAL_GIT_STATUS>
```

- Verification gaps: `<FINAL_VERIFICATION_GAPS_OR_NONE>`
- Остаточные риски: `<RESIDUAL_RISKS_OR_NONE>`
- Подтверждение отсутствия изменений вне scope: `<NO_OUT_OF_SCOPE_CHANGES_CONFIRMATION>`

## 12. Stop condition

- Точная точка остановки: `<EXACT_STOP_POINT>`
- Другие findings, следующая подзадача и следующий gate после этой точки: `DO NOT START`
- Новый дефект вне scope: зафиксировать как `<NEW_OUT_OF_SCOPE_DEFECT>` с evidence `<NEW_DEFECT_EVIDENCE>`, но не исправлять.
