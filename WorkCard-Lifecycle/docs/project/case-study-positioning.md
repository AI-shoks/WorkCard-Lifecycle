---
artifact_id: project.case-study-positioning
status: accepted
version: 10
owner: project
updated: 2026-09-05
---

# Case Study Positioning

Проект — **независимый portfolio case study**, а не результат реального внедрения на конкретном предприятии. Его предметная основа опирается на личный производственный опыт автора, ретроспективное интервью с бывшим мастером и изучение обезличенной физической рабочей карточки. Это не формальное обследование предприятия и не даёт права раскрывать или приписывать проекту конкретный заводской регламент.

## Что утверждаем

- подтверждённые выводы `CONFIRMED_AS_IS` отделены от синтетических `TO_BE_DECISION` в [[decision-provenance]];
- физические карточки, роли ПДБ/технолога/БТБ, первая и финальная приёмки, самоконтроль и мастерское ведение заданий описываются только в обезличенном виде;
- данные, партия, нормы, пользователи и payroll являются синтетическими;
- implementation commit [`17d2b04d13b58c7dff677543ed4399751a8593a1`](https://github.com/AI-shoks/WorkCard-Lifecycle/commit/17d2b04d13b58c7dff677543ed4399751a8593a1) демонстрирует product analysis, AS-IS/TO-BE analysis, domain modeling, requirements engineering, UX design, traceability, принятую техническую архитектуру, воспроизводимый инженерный фундамент и проверенный backend vertical slice;
- отдельная цифровая `FinalBatchAcceptance` является синтетическим TO-BE-решением уровня партии, а не утверждением о существующей заводской ИС;
- связанный frontend flow закрыт на этапе 8 SHA [`b00ff294a7b7ce1e09379c088969d9a02bd033bf`](https://github.com/AI-shoks/WorkCard-Lifecycle/commit/b00ff294a7b7ce1e09379c088969d9a02bd033bf), полный quality-этап — на этапе 9 SHA [`3ee65709966f5775928de87783fd2946d085e2bc`](https://github.com/AI-shoks/WorkCard-Lifecycle/commit/3ee65709966f5775928de87783fd2946d085e2bc); этап 10 в работе на 4/7: release design, reviewable Terraform, release-image workflow и runtime pre-deploy controls реализованы, а provisioning и hosted evidence ещё нет;
- ограничения и допущения документируются явно.

## Чего не утверждаем

- что решение внедрено на заводе;
- что интервью является формальным аудитом или исчерпывающим регламентом предприятия;
- что метрики получены от реального предприятия;
- что mock payroll рассчитывает настоящую зарплату;
- что система соответствует всем требованиям промышленной MES;
- что уже выполнены deployment, staging/production qualification или фактический hosted runtime.

## Публичная доказательность

- в репозитории публикуются обобщённые факты, решения и проверяемые сценарии, но не персональные данные и не исходная карточка;
- точные коды операций, названия изделий, нормы и demo-личности являются синтетическими;
- технический UUID `WorkCard` не называется номером детали и не создаёт ложной серийной прослеживаемости;
- синтетическое per-card закрытие WorkCard не называется финальной приёмкой всей партии или цифровой подписью БТК;
- цифровая финальная приёмка показывается отдельной неизменяемой записью actor/time/ID и не называется копией подписи на физической карточке;
- утверждения о бизнес-функциях появятся только после их кода, тестов и воспроизводимой демонстрации.

Исторический implementation commit этапа 7 и DB integration tests дают два раздельных доказательства: масштабный выпуск `3 → 250` с `254` release events и компактный API-only процесс от создания партии до final acceptance, payroll и audit/read-back. Они также проверяют trusted roles, ранний auth/CSRF order, concurrency, replay и immutable boundaries. Этап 8 добавил реальный browser flow, а этап 9 — compact/canonical browser gates, PostgreSQL regressions, security/image gates и performance profile. Для SHA этапа 9 успешны все 6 обязательных jobs в [push CI](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33970654850) и [PR CI](https://github.com/AI-shoks/WorkCard-Lifecycle/actions/runs/33970656850). Эти результаты не доказывают production deployment: он относится к этапу 10.
