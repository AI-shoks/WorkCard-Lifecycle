---
artifact_id: project.risk-register
status: active
version: 6
owner: project
updated: 2026-07-19
---

# Risk Register

| ID | Риск | Вероятность | Влияние | Мера |
|---|---|---:|---:|---|
| R-001 | Scope вырастет до mini-MES | высокая | высокое | Любое расширение сверять с [[mvp-scope]] |
| R-002 | Проект надолго останется только документацией | средняя | высокое | После базового проектирования собирать малые vertical slices |
| R-003 | UI и API реализуют разные правила | средняя | высокое | Инварианты и permissions обеспечивать на backend |
| R-004 | Двойной payroll export | средняя | высокое | Идемпотентность, уникальное ограничение и integration test |
| R-005 | Audit log расходится с изменением карточки | средняя | высокое | Записывать их в одной транзакции |
| R-006 | Case study выглядит как вымышленное внедрение | средняя | высокое | Явно указывать синтетические данные и mock-интеграции |
| R-007 | Документы противоречат друг другу | средняя | среднее | Один канонический файл на каждый артефакт |
| R-008 | Автоматизация удалит важную историю решения | низкая | высокое | Автоматически только выявлять; удалять после ручной проверки |
| R-009 | Внутренне согласованные документы расходятся с подтверждённым AS-IS | средняя | высокое | Вести [[decision-provenance]] и выполнять семантический проход отдельно от структурного аудита |
| R-010 | Технический ID карточки будет воспринят как номер физической детали | средняя | высокое | Не хранить `sequenceNumber`, не показывать пользовательские `#01`/`3 из N`, явно отделять UUID от серийной прослеживаемости |
| R-011 | Портфолио завысит зрелость UX, назвав текстовые wireframes проходимым прототипом | средняя | среднее | Не закрывать соответствующий exit criterion без интерактивного артефакта или явной смены критерия |
| R-012 | Реализация разойдётся с принятой ER/API/transaction architecture | средняя | высокое | Генерировать OpenAPI, применять explicit SQL migrations и связать integration tests с [[requirements-traceability]] |
| R-013 | Массовая операция сохранит неполный или несопоставимый audit-набор | средняя | высокое | Transaction assertion, unique event/version и отдельный server query по `correlationId` из [[audit-log-design]] |
| R-014 | Demo session ошибочно примут за production IAM или примут signed cookie за единственный источник доверия | средняя | высокое | Явно маркировать prepared identities, проверять active `jti` в PostgreSQL registry, отзывать logout/switch и не заявлять production authentication |
| R-015 | Major/minor dependencies или transitive resolution изменят совместимость | средняя | среднее | Согласовать exact top-level pins/constraints в project/requirements manifests, фиксировать patch image tags, выполнять dependency audit; полный lock-файл не заявлять, а major менять только новой версией [[technology-stack]] |
| R-016 | Локальная проверка будет ошибочно выдана за подтверждение publication runtime | средняя | высокое | До успешного GitHub Actions run сохранять статус `publication CI pending`; отдельно проверить PostgreSQL 18.1, Docker build и container smoke |
