# Narrow task handoff

Заполните каждый placeholder перед передачей задачи. Передавайте только минимальный контекст и проверяемые свидетельства, необходимые для этой подзадачи; не прикладывайте весь репозиторий или полную историю чатов. Пропущенное разрешение считается запретом. Если точное значение или разрешённая область неизвестны, остановитесь и зафиксируйте gap — не расширяйте scope самостоятельно.

## 1. Task

- Конкретная подзадача: `<TASK>`
- Ожидаемый конечный результат: `<EXPECTED_RESULT>`
- Краткое определение готовности: `<DONE_CRITERIA_SUMMARY>`

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

До изменений запишите фактический worktree, Git root, branch, полный HEAD SHA и полный initial Git status. Если baseline не совпадает, остановитесь и сообщите расхождение; не исправляйте его через checkout, switch, reset или иные mutations без отдельного явного разрешения пользователя.

## 3. Current state

- Уже реализовано:
  - `<IMPLEMENTED_ITEM_1>`
  - `<IMPLEMENTED_ITEM_2>`
- Уже проверено:
  - `<VERIFIED_ITEM_WITH_COMMAND_AND_RESULT_1>`
  - `<VERIFIED_ITEM_WITH_COMMAND_AND_RESULT_2>`
- Принятые решения, которые нельзя пересматривать в этой подзадаче:
  - `<ACCEPTED_DECISION_1>`
  - `<ACCEPTED_DECISION_2>`

Указывайте только факты, влияющие на выполнение задачи, и минимальные ссылки на их источники.

## 4. Allowed scope

Разрешено читать только следующие файлы; перечислите точные repo-relative paths без glob-шаблонов и расплывчатых каталогов:

- `<FILE_ALLOWED_TO_READ_1>`
- `<FILE_ALLOWED_TO_READ_2>`

Разрешено изменять только следующие файлы; перечислите каждый файл отдельно:

- `<FILE_ALLOWED_TO_CHANGE_1>`
- `<FILE_ALLOWED_TO_CHANGE_2>`

Разрешены только следующие команды и проверки:

```text
<ALLOWED_COMMAND_1>
<ALLOWED_COMMAND_2>
```

Разрешение читать файл не означает разрешение изменять его. Разрешение выполнить команду не разрешает дополнительные mutations. Если точный список заранее неизвестен или оказался неполным, остановитесь, зафиксируйте gap и запросите уточнение.

## 5. Out of scope

- Файлы и области, которые нельзя менять:
  - `<PROTECTED_FILE_OR_AREA_1>`
  - `<PROTECTED_FILE_OR_AREA_2>`
- Архитектурные и продуктовые вопросы, которые нельзя расширять или пересматривать:
  - `<ARCHITECTURE_OR_PRODUCT_BOUNDARY_1>`
  - `<ARCHITECTURE_OR_PRODUCT_BOUNDARY_2>`
- Соседние подзадачи и следующий gate: `<NEXT_TASKS_AND_GATE_NOT_TO_START>`

Не выполняйте попутный cleanup, refactoring, переименование, обновление зависимостей или форматирование вне явно разрешённых файлов.

## 6. Required implementation

- Конкретные изменения:
  1. `<REQUIRED_CHANGE_1>`
  2. `<REQUIRED_CHANGE_2>`
- Обязательные ограничения:
  - `<IMPLEMENTATION_CONSTRAINT_1>`
  - `<IMPLEMENTATION_CONSTRAINT_2>`
- Критерии корректности:
  - `<CORRECTNESS_CRITERION_1>`
  - `<CORRECTNESS_CRITERION_2>`

Сделайте минимальный patch, достаточный для этих критериев. Не добавляйте поведение или артефакты, не перечисленные в этой секции.

## 7. Validation

Выполните обязательные проверки в указанном порядке:

| Command | Expected result | Expected exit code |
| --- | --- | --- |
| `<VALIDATION_COMMAND_1>` | `<EXPECTED_RESULT_1>` | `<EXPECTED_EXIT_CODE_1>` |
| `<VALIDATION_COMMAND_2>` | `<EXPECTED_RESULT_2>` | `<EXPECTED_EXIT_CODE_2>` |

- Если зависимость, сервис, версия baseline или инструмент недоступны, не устанавливайте и не заменяйте их без явного разрешения. Запишите точную недоступность, команду, вывод и exit code; отметьте проверку как skipped или blocked и остановитесь, если критерий корректности нельзя подтвердить.
- Не подменяйте недоступный baseline другой версией. Если пользователь явно разрешил отклонение, отдельно зафиксируйте исходный недоступный baseline, разрешённую замену и влияние на достоверность проверки.
- Не выдавайте альтернативную или частичную проверку за обязательную. Все verification gaps и остаточные риски должны попасть в completion report.

## 8. Git and publication boundaries

Заполните каждое поле значением `YES` или `NO`; по умолчанию используется `NO`. Значение `YES` описывает допустимую границу, но не заменяет явное подтверждение пользователя непосредственно перед mutation. Handoff не может отменить более строгие repository-level запреты.

- Staging разрешён: `<STAGING_ALLOWED_YES_OR_NO>`
- Commit разрешён: `<COMMIT_ALLOWED_YES_OR_NO>`
- Разрешённое commit message: `<COMMIT_MESSAGE_OR_NOT_APPLICABLE>`
- Push разрешён: `NO`
- Создание или изменение PR разрешено: `<PR_MUTATION_ALLOWED_YES_OR_NO>`
- Создание или изменение branch разрешено: `<BRANCH_MUTATION_ALLOWED_YES_OR_NO>`
- Создание или изменение worktree разрешено: `<WORKTREE_MUTATION_ALLOWED_YES_OR_NO>`
- Checkout, switch, merge или rebase разрешены: `<OTHER_GIT_MUTATIONS_ALLOWED_YES_OR_NO>`
- Иные публикации разрешены: `NO`

Не выполняйте mutation, помеченную `YES`, пока пользователь явно не подтвердит именно это действие в рабочем чате.

## 9. Completion report

Сообщите:

- Фактический baseline:
  - Worktree: `<ACTUAL_WORKTREE_PATH>`
  - Git root: `<ACTUAL_GIT_ROOT>`
  - Branch: `<ACTUAL_BRANCH>`
  - Initial HEAD: `<ACTUAL_INITIAL_HEAD_SHA>`
  - Initial Git status: `<ACTUAL_INITIAL_GIT_STATUS>`
- Изменённые файлы:
  - `<CHANGED_FILE_1>`
  - `<CHANGED_FILE_2>`
- Результаты проверок:

| Command | Material result | Exit code |
| --- | --- | --- |
| `<EXECUTED_COMMAND_1>` | `<ACTUAL_RESULT_1>` | `<ACTUAL_EXIT_CODE_1>` |
| `<EXECUTED_COMMAND_2>` | `<ACTUAL_RESULT_2>` | `<ACTUAL_EXIT_CODE_2>` |

- Итоговый Git status:

```text
<FINAL_GIT_STATUS>
```

- Ограничения, skipped/blocked checks и verification gaps: `<LIMITATIONS_AND_VERIFICATION_GAPS_OR_NONE>`
- Остаточные риски: `<RESIDUAL_RISKS_OR_NONE>`
- Scope не расширялся: `<YES_OR_NO_WITH_EXPLANATION>`

## 10. Stop condition

- Остановитесь после: `<EXACT_STOP_POINT>`
- Не переходите автоматически к следующей задаче, соседней подзадаче или следующему gate.
- Если работа не может быть завершена в заданном scope, остановитесь после фиксации blocker/gap и запроса решения; не обходите ограничение расширением scope.
