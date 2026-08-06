from __future__ import annotations

import hashlib
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient
from itsdangerous import URLSafeTimedSerializer

from conftest import MASTER_ID, PLANNER_ID, FakeDatabase
from workcard_api.app import create_app
from workcard_api.auth import COOKIE_NAME
from workcard_api.config import Settings

ORIGIN_HEADERS = {"Origin": "http://testserver", "Sec-Fetch-Site": "same-origin"}
SESSION_CHALLENGE = 'WorkcardSession realm="workcard-api"'


def bootstrap(client: TestClient) -> str:
    response = client.get("/api/v1/session/bootstrap")
    assert response.status_code == 200
    assert "HttpOnly" in response.headers["set-cookie"]
    assert "SameSite=strict" in response.headers["set-cookie"]
    assert 0 < response.json()["expiresInSeconds"] <= 1800
    return str(response.json()["csrfToken"])


def select_identity(client: TestClient, identity_id: object = PLANNER_ID) -> dict[str, object]:
    csrf = bootstrap(client)
    response = client.put(
        "/api/v1/session/demo",
        headers=ORIGIN_HEADERS | {"X-CSRF-Token": csrf},
        json={"demoIdentityId": str(identity_id)},
    )
    assert response.status_code == 200
    return dict(response.json())


def saved_cookie(client: TestClient) -> str:
    value = client.cookies.get(COOKIE_NAME)
    assert value is not None
    return str(value)


def set_saved_cookie(client: TestClient, cookie: str) -> None:
    client.cookies.set(COOKIE_NAME, cookie, path="/api/v1")


def test_identity_list_contains_only_server_prepared_identities(client: TestClient) -> None:
    response = client.get("/api/v1/demo-identities")

    assert response.status_code == 200
    assert [(item["displayName"], item["role"]) for item in response.json()["items"]] == [
        ("Планировщик ПДБ", "PLANNER"),
        ("Мастер участка", "MASTER"),
    ]


def test_demo_session_uses_database_role_and_rotates_csrf(client: TestClient) -> None:
    bootstrap_csrf = bootstrap(client)

    selected = client.put(
        "/api/v1/session/demo",
        headers=ORIGIN_HEADERS | {"X-CSRF-Token": bootstrap_csrf},
        json={"demoIdentityId": str(PLANNER_ID)},
    )
    session = client.get("/api/v1/session")

    assert selected.status_code == 200
    assert selected.json()["actor"]["role"] == "PLANNER"
    assert "batch:create" in selected.json()["permissions"]
    assert selected.json()["csrfToken"] != bootstrap_csrf
    assert session.status_code == 200
    assert session.json()["actor"]["id"] == str(PLANNER_ID)


def test_role_field_in_user_payload_is_rejected(client: TestClient) -> None:
    csrf = bootstrap(client)

    response = client.put(
        "/api/v1/session/demo",
        headers=ORIGIN_HEADERS | {"X-CSRF-Token": csrf},
        json={"demoIdentityId": str(PLANNER_ID), "role": "ADMIN_AUDITOR"},
    )

    assert response.status_code == 400
    assert response.json()["code"] == "REQUEST_VALIDATION_FAILED"


def test_missing_csrf_and_cross_origin_are_denied(client: TestClient) -> None:
    csrf = bootstrap(client)

    no_csrf = client.put(
        "/api/v1/session/demo",
        headers=ORIGIN_HEADERS,
        json={"demoIdentityId": str(PLANNER_ID)},
    )
    cross_origin = client.put(
        "/api/v1/session/demo",
        headers={"Origin": "https://attacker.example", "X-CSRF-Token": csrf},
        json={"demoIdentityId": str(PLANNER_ID)},
    )
    missing_origin = client.put(
        "/api/v1/session/demo",
        headers={"X-CSRF-Token": csrf},
        json={"demoIdentityId": str(PLANNER_ID)},
    )
    cross_site_fetch = client.put(
        "/api/v1/session/demo",
        headers={
            "Origin": "http://testserver",
            "Sec-Fetch-Site": "cross-site",
            "X-CSRF-Token": csrf,
        },
        json={"demoIdentityId": str(PLANNER_ID)},
    )

    assert no_csrf.status_code == 403
    assert no_csrf.json()["code"] == "CSRF_VALIDATION_FAILED"
    assert cross_origin.status_code == 403
    assert cross_origin.json()["code"] == "ORIGIN_NOT_ALLOWED"
    assert missing_origin.status_code == 403
    assert missing_origin.json()["code"] == "ORIGIN_NOT_ALLOWED"
    assert cross_site_fetch.status_code == 403
    assert cross_site_fetch.json()["code"] == "ORIGIN_NOT_ALLOWED"


def test_incorrect_csrf_is_denied(client: TestClient) -> None:
    bootstrap(client)

    response = client.put(
        "/api/v1/session/demo",
        headers=ORIGIN_HEADERS | {"X-CSRF-Token": "incorrect"},
        json={"demoIdentityId": str(PLANNER_ID)},
    )

    assert response.status_code == 403
    assert response.json()["code"] == "CSRF_VALIDATION_FAILED"


def test_tampered_cookie_is_unauthorized(client: TestClient) -> None:
    client.cookies.set("workcard_demo_session", "tampered", path="/api/v1")

    response = client.get("/api/v1/session")

    assert response.status_code == 401
    assert response.json()["code"] == "SESSION_REQUIRED"
    assert "traceId" in response.json()


def test_logout_requires_current_csrf_and_clears_session(client: TestClient) -> None:
    bootstrap_csrf = bootstrap(client)
    selected = client.put(
        "/api/v1/session/demo",
        headers=ORIGIN_HEADERS | {"X-CSRF-Token": bootstrap_csrf},
        json={"demoIdentityId": str(PLANNER_ID)},
    )

    deleted = client.delete(
        "/api/v1/session",
        headers=ORIGIN_HEADERS | {"X-CSRF-Token": selected.json()["csrfToken"]},
    )

    assert deleted.status_code == 204
    assert client.get("/api/v1/session").status_code == 401


def test_saved_authenticated_cookie_is_rejected_after_logout(
    client: TestClient,
    application: FastAPI,
) -> None:
    selected = select_identity(client)
    cookie = saved_cookie(client)

    deleted = client.delete(
        "/api/v1/session",
        headers=ORIGIN_HEADERS | {"X-CSRF-Token": str(selected["csrfToken"])},
    )

    assert deleted.status_code == 204
    with TestClient(application) as replay_client:
        set_saved_cookie(replay_client, cookie)
        replay = replay_client.get("/api/v1/session")
    assert replay.status_code == 401
    assert replay.json()["code"] == "SESSION_REQUIRED"


def test_role_switch_revokes_old_cookie_and_old_csrf_for_independent_client(
    client: TestClient,
    application: FastAPI,
) -> None:
    selected = select_identity(client)
    old_cookie = saved_cookie(client)
    old_csrf = str(selected["csrfToken"])

    switched = client.put(
        "/api/v1/session/demo",
        headers=ORIGIN_HEADERS | {"X-CSRF-Token": old_csrf},
        json={"demoIdentityId": str(MASTER_ID)},
    )

    assert switched.status_code == 200
    assert switched.json()["actor"]["role"] == "MASTER"
    assert saved_cookie(client) != old_cookie
    with TestClient(application) as replay_client:
        set_saved_cookie(replay_client, old_cookie)
        old_session = replay_client.get("/api/v1/session")
        old_cookie_and_csrf = replay_client.put(
            "/api/v1/session/demo",
            headers=ORIGIN_HEADERS | {"X-CSRF-Token": old_csrf},
            json={"demoIdentityId": str(PLANNER_ID)},
        )
    assert old_session.status_code == 401
    assert old_cookie_and_csrf.status_code == 401


def test_remaining_ttl_does_not_increase_and_expiry_is_rejected(
    client: TestClient,
    fake_database: FakeDatabase,
) -> None:
    select_identity(client)
    first = client.get("/api/v1/session")
    second = client.get("/api/v1/session")

    assert first.status_code == second.status_code == 200
    assert second.json()["expiresInSeconds"] <= first.json()["expiresInSeconds"]

    fake_database.set_active_sessions_near_expiry()
    near_expiry = client.get("/api/v1/session")
    assert near_expiry.status_code == 200
    assert near_expiry.json()["expiresInSeconds"] == 0

    fake_database.expire_all_sessions()
    expired = client.get("/api/v1/session")
    assert expired.status_code == 401
    assert expired.headers.get_list("WWW-Authenticate") == [SESSION_CHALLENGE]


def test_revoked_and_malformed_jti_are_rejected(
    client: TestClient,
    fake_database: FakeDatabase,
    settings: Settings,
) -> None:
    select_identity(client)
    active_jti = next(
        jti for jti, record in fake_database.sessions.items() if record.revoked_at is None
    )
    assert fake_database.revoke_session(active_jti)
    assert client.get("/api/v1/session").status_code == 401

    serializer = URLSafeTimedSerializer(
        settings.session_signing_secret.get_secret_value(),
        salt="workcard-demo-session-v1",
        signer_kwargs={"digest_method": hashlib.sha256},
    )
    set_saved_cookie(client, serializer.dumps({"jti": "not-a-uuid"}))
    malformed = client.get("/api/v1/session")
    assert malformed.status_code == 401


def test_unknown_signed_jti_is_rejected(client: TestClient, settings: Settings) -> None:
    serializer = URLSafeTimedSerializer(
        settings.session_signing_secret.get_secret_value(),
        salt="workcard-demo-session-v1",
        signer_kwargs={"digest_method": hashlib.sha256},
    )
    set_saved_cookie(client, serializer.dumps({"jti": str(uuid4())}))

    response = client.get("/api/v1/session")

    assert response.status_code == 401


def test_staging_cookie_flags_ignore_spoofed_forwarded_headers() -> None:
    settings = Settings(
        environment="staging",
        database_url="postgresql://unused:unused@localhost/unused",
        session_signing_secret="staging-only-signing-secret-at-least-32-characters",
        allowed_origins=["https://workcard.example"],
        cookie_secure=True,
    )
    application = create_app(settings, FakeDatabase())

    with TestClient(application, base_url="https://workcard.example") as staging_client:
        response = staging_client.get(
            "/api/v1/session/bootstrap",
            headers={
                "X-Forwarded-Proto": "http",
                "X-Forwarded-Host": "attacker.example",
            },
        )
        rejected = staging_client.put(
            "/api/v1/session/demo",
            headers={
                "Origin": "https://attacker.example",
                "Sec-Fetch-Site": "same-origin",
                "X-Forwarded-Host": "workcard.example",
                "X-CSRF-Token": response.json()["csrfToken"],
            },
            json={"demoIdentityId": str(PLANNER_ID)},
        )

    cookie = response.headers["set-cookie"]
    assert "Secure" in cookie
    assert "HttpOnly" in cookie
    assert "SameSite=strict" in cookie
    assert "Path=/api/v1" in cookie
    assert rejected.status_code == 403
    assert rejected.json()["code"] == "ORIGIN_NOT_ALLOWED"
