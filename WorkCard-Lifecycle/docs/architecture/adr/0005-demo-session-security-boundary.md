---
artifact_id: architecture.adr.0005
status: accepted
version: 1
owner: architecture
updated: 2026-09-01
---

# ADR-0005. Server-backed demo session as the authorization boundary

## Контекст

Demo должен переключать пять ролей без реального account management. Одновременно `BR-001` запрещает доверять role/actor из UI, а public portfolio не должен выдавать простой role header за authentication.

## Варианты

1. Подготовленные users + server-backed signed cookie session и CSRF.
2. Клиентский `X-Role` header/localStorage.
3. Полный OIDC provider для MVP.
4. Один admin user без role switch.

## Решение

Role switch принимает только ID подготовленного active demo-user. API создаёт opaque server session и восстанавливает actor/role на каждом запросе. Cookie HttpOnly/SameSite/Secure; mutations требуют CSRF token и Origin check. Права проверяются backend для каждого route/resource.

## Причины

- сохраняется интерактивный demo sequence;
- клиент не может повысить полномочия произвольным enum/header;
- session invalidation и role switch детерминированы;
- OIDC не добавляет доказательства предметной логики MVP и требует внешней зависимости.

## Последствия

- это demo-auth без passwords/MFA и не production IAM;
- public fixture содержит только синтетические identities;
- role switch очищает frontend cache;
- будущий реальный IdP заменит adapter/trusted context, но не permission rules;
- ограничения явно отражаются в [[security-baseline]] и portfolio copy.
