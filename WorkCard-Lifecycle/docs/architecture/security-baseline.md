---
artifact_id: architecture.security-baseline
status: accepted
version: 1
owner: architecture
updated: 2026-07-18
---

# Security Baseline

Минимальная security-модель demo MVP. Она защищает заявленные permissions, целостность и audit, но не превращает подготовленные demo identities в production IAM.

## Threat assumptions

- пользователь может изменять DOM, JS requests, route params, body, UUID и versions;
- browser/local storage недоверен;
- все demo-роли доступны участнику демонстрации, но только через server allowlist;
- attacker может повторять requests, открывать protected URL и отправлять concurrent commands;
- SQL injection, XSS, CSRF, broken access control и утечки error/log данных считаются релевантными;
- real factory/payroll data и credentials в системе отсутствуют.

## Demo authentication

- `GET /demo-identities` возвращает только prepared display identities;
- `GET /session/bootstrap` выдаёт short-lived signed anonymous cookie со случайным nonce/CSRF binding, но без actor/role;
- `PUT /session/demo` принимает ID из allowlist только с bootstrap/current cookie, связанным CSRF token и trusted Origin, затем rotates cookie/token;
- cookie: `HttpOnly`, `Secure` вне localhost, `SameSite=Strict`, narrow `Path`, ограниченный lifetime;
- signing secret хранится вне repository и меняется между environments;
- actor/role извлекаются backend из проверенной session; body/header role ignored/rejected;
- logout/role switch rotates cookie и CSRF token, очищает permission-sensitive client cache;
- arbitrary account creation, passwords, OAuth и production SSO вне MVP.

Подписанная session доказывает только выбранный demo context, а не личность реального сотрудника. Это явно отражается в README/demo.

## Authorization

- deny by default для routes и commands;
- centralized permission map соответствует [[roles-permissions]];
- command permission проверяется **до** resource lookup, чтобы не раскрывать protected existence;
- object checks подтверждают batch/set/card relations, assignee role, purpose, state и gate;
- frontend hide/disable не считается защитой;
- `ADMIN_AUDITOR` единственный читает audit/payroll;
- `QUALITY_CONTROLLER` единственный вызывает `RecordFinalBatchAcceptance`;
- mass assignment, route IDs и allowed-actions projections повторно проверяются server-side.

## CSRF и origin

- deployment same-origin; permissive CORS не включается;
- первый role selection получает CSRF token из public `GET /session/bootstrap`; дальнейшие mutations — session-bound token из `GET /session`;
- bootstrap и authenticated tokens связаны с nonce в signed cookie, имеют короткий срок и rotate при role switch;
- backend проверяет token и `Origin`/`Sec-Fetch-Site` там, где header доступен;
- обычные GET/HEAD не меняют domain/session state; единственное исключение — bootstrap GET, который выдаёт anonymous cookie/token и не создаёт trusted identity или business effect;
- role switch использует idempotent `PUT` + CSRF и не является domain command.

## Input и output validation

- Fastify route schemas запрещают unknown properties у command bodies;
- UUID, enum, integer/decimal limits, array cardinality и duplicate card IDs проверяются до domain service;
- body size и mass assignment ограничены; canonical maximum assignment — `500` cards;
- SQL использует только parameters; dynamic sort/filter выбирается из allowlist;
- API response сериализуется по schema, чтобы внутренние поля не утекали;
- file upload, arbitrary URL fetch, HTML input и rich text отсутствуют.

## XSS и browser policy

- React text escaping используется по умолчанию; `dangerouslySetInnerHTML` запрещён без отдельного review;
- Content Security Policy: default self, script/style/connect self, object none, base-uri none, frame-ancestors none;
- security headers включают `X-Content-Type-Options: nosniff`, restrictive `Referrer-Policy`, permissions policy и frame protection через CSP;
- technical IDs показываются только в предусмотренном secondary/developer context и никогда не интерпретируются как HTML;
- production source maps не публикуются без осознанного решения.

## Replay, concurrency и integrity

- `X-Command-Id` обязателен для mutations;
- command receipt проверяет type + canonical request hash;
- optimistic versions и transaction rules следуют [[transactions-concurrency]];
- unique constraints защищают final acceptance/payroll/event IDs;
- replay не обходит permission: текущая trusted role проверяется до выдачи result;
- rate limit применяется к session switch, command endpoints и repeated failures, но не заменяет authorization.

## Database access

- runtime использует least-privilege application role без DDL;
- migration role отделена и не используется приложением;
- PostgreSQL не опубликован в internet и доступен только application network;
- application role не имеет update/delete на audit/final acceptance/payroll immutable rows;
- backups/dumps не входят в repository; production-like secrets/data не попадают в fixtures;
- TLS к удалённой DB обязателен; localhost compose может использовать isolated network.

## Secrets и configuration

- secrets только через environment/secret store; `.env` с реальными значениями игнорируется;
- repository содержит `.env.example` без секретов на этапе 6;
- startup валидирует обязательную configuration и аварийно завершается при слабом/отсутствующем signing secret;
- credentials не логируются и не возвращаются в health/config endpoints;
- dependency/secret scans входят в будущие CI quality gates.

## Errors, logs и audit

- client получает Problem Details без SQL/stack/internal object;
- protected `403` формируется до lookup; `404` доступен только авторизованной read/command class;
- operational log содержит trace ID, method, route template, status, duration и при наличии command/correlation ID;
- cookie, CSRF, full request/response, passport snapshot и audit payload не логируются по умолчанию;
- business audit хранится по [[audit-log-design]] и доступен только `ADMIN_AUDITOR`.

## Transport и deployment

- staging/production используют HTTPS и redirect с HTTP;
- trusted proxy count задаётся явно, а не принимается из произвольных forwarded headers;
- контейнер запускается non-root, read-only filesystem где возможно, без лишних capabilities;
- health endpoint не раскрывает version/schema/secrets; readiness может проверять DB без выдачи DSN;
- dependencies/images pin и сканируются на этапах 6/9/10.

## Privacy и честные ограничения

Все identities и производственные данные синтетические. Нельзя загружать реальные ФИО, табельные номера, физические карточки или подписи без отдельной privacy/security модели. Demo session не пригодна для реального производства.

## Security tests

- каждая command role matrix: allow owner, deny остальные;
- direct protected audit/payroll URL безопасно отклоняется;
- actor/role/assignee/purpose/ID/version tampering не проходит;
- CSRF missing/invalid и cross-origin mutation отклоняются;
- unknown JSON fields, oversized body/mass set, injection strings отклоняются;
- stale/replayed/concurrent commands сохраняют единичный корректный result;
- errors/logs не содержат cookie, CSRF, SQL или stack;
- runtime DB role не может update/delete audit/final acceptance/payroll;
- `ConfirmWorkCardQuality` не может вызвать final acceptance косвенно.

## Отложено осознанно

Production IAM/MFA, fine-grained departments, audit export/SIEM, WAF, formal privacy retention, key-management service и incident response относятся к реальному deployment или расширенному scope. Их отсутствие не должно скрываться в позиционировании case study.
