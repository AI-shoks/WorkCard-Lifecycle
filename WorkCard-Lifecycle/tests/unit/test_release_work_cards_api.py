from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path
from uuid import UUID

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from httpx import Response

from conftest import MASTER_ID, PLANNER_ID, FakeDatabase
from workcard_api.app import create_app
from workcard_api.auth import COOKIE_NAME
from workcard_api.config import Settings
from workcard_api.release_work_cards import (
    BatchAlreadyReleased,
    CommandAlreadyProcessed,
    CommandIdReused,
    ConcurrentCommandConflict,
    PermissionDenied,
    ProductionBatchInvalid,
    ProductionBatchNotFound,
    ReleaseWorkCardsCommand,
    ReleaseWorkCardSetResult,
    ReleaseWorkCardsFailure,
    ReleaseWorkCardsResult,
    TrustedActor,
    UnexpectedPersistenceFailure,
    VersionConflict,
    release_work_cards_request_hash,
)

ORIGIN_HEADERS = {"Origin": "http://testserver", "Sec-Fetch-Site": "same-origin"}
SESSION_CHALLENGE = 'WorkcardSession realm="workcard-api"'
PROBLEM_FIELDS = {"type", "title", "status", "code", "detail", "traceId", "errors"}
BATCH_ID = UUID("aaaaaaaa-0000-4000-8000-000000000001")
FIRST_SET_ID = UUID("22000000-0000-4000-8000-000000000001")
SECOND_SET_ID = UUID("22000000-0000-4000-8000-000000000002")
FIRST_PLAN_ID = UUID("21000000-0000-4000-8000-000000000001")
SECOND_PLAN_ID = UUID("21000000-0000-4000-8000-000000000002")
COMMAND_ID = UUID("50000000-0000-4000-8000-000000000001")
CORRELATION_ID = UUID("60000000-0000-4000-8000-000000000001")


class FakeReleaseWorkCardsGateway:
    def __init__(self) -> None:
        self.calls: list[tuple[TrustedActor, ReleaseWorkCardsCommand, str]] = []
        self.failure: ReleaseWorkCardsFailure | None = None

    def release_work_cards(
        self,
        actor: TrustedActor,
        command: ReleaseWorkCardsCommand,
        request_hash: str,
    ) -> ReleaseWorkCardsResult:
        self.calls.append((actor, command, request_hash))
        if self.failure is not None:
            raise self.failure
        return ReleaseWorkCardsResult(
            batch_id=command.batch_id,
            lifecycle_status="RELEASED",
            version=2,
            set_count=2,
            card_count_total=3,
            work_card_sets=(
                ReleaseWorkCardSetResult(
                    set_id=FIRST_SET_ID,
                    operation_plan_id=FIRST_PLAN_ID,
                    position=1,
                    operation_scope={
                        "code": "OP-10",
                        "displayName": "Операция А",  # noqa: RUF001
                    },
                    norm_hours="1.25",
                    planned_card_count=2,
                    gate_status="FIRST_ARTICLE_PENDING",
                    version=1,
                ),
                ReleaseWorkCardSetResult(
                    set_id=SECOND_SET_ID,
                    operation_plan_id=SECOND_PLAN_ID,
                    position=2,
                    operation_scope={"code": "OP-20", "displayName": "Операция Б"},
                    norm_hours="2.00",
                    planned_card_count=1,
                    gate_status="FIRST_ARTICLE_PENDING",
                    version=1,
                ),
            ),
            command_id=command.command_id,
            correlation_id=CORRELATION_ID,
        )


@pytest.fixture
def release_gateway() -> FakeReleaseWorkCardsGateway:
    return FakeReleaseWorkCardsGateway()


@pytest.fixture
def release_application(
    settings: Settings,
    fake_database: FakeDatabase,
    release_gateway: FakeReleaseWorkCardsGateway,
) -> FastAPI:
    return create_app(
        settings,
        fake_database,
        release_work_cards_gateway=release_gateway,
    )


@pytest.fixture
def release_client(release_application: FastAPI) -> Iterator[TestClient]:
    with TestClient(release_application) as client:
        yield client


def select_identity(client: TestClient, identity_id: UUID = PLANNER_ID) -> str:
    bootstrap = client.get("/api/v1/session/bootstrap")
    assert bootstrap.status_code == 200
    selected = client.put(
        "/api/v1/session/demo",
        headers=ORIGIN_HEADERS | {"X-CSRF-Token": bootstrap.json()["csrfToken"]},
        json={"demoIdentityId": str(identity_id)},
    )
    assert selected.status_code == 200
    return str(selected.json()["csrfToken"])


def release_path(batch_id: object = BATCH_ID) -> str:
    return f"/api/v1/production-batches/{batch_id}/actions/release-work-cards"


def command_headers(csrf: str, command_id: object = COMMAND_ID) -> dict[str, str]:
    return ORIGIN_HEADERS | {
        "X-CSRF-Token": csrf,
        "X-Command-Id": str(command_id),
    }


def valid_body(*, expected_version: object = 1) -> dict[str, object]:
    return {"expectedVersion": expected_version}


def assert_problem(response: Response, status: int, code: str) -> None:
    assert response.status_code == status
    assert response.headers["content-type"].startswith("application/problem+json")
    body = response.json()
    assert set(body) == PROBLEM_FIELDS
    assert body["status"] == status
    assert body["code"] == code
    assert body["type"] == f"https://workcard.example/problems/{code.lower().replace('_', '-')}"
    assert body["traceId"]
    assert "etag" not in response.headers


def test_planner_releases_work_cards_with_exact_envelope_headers_and_trusted_actor(
    release_client: TestClient,
    release_gateway: FakeReleaseWorkCardsGateway,
) -> None:
    csrf = select_identity(release_client)

    response = release_client.post(
        release_path(),
        headers=command_headers(csrf)
        | {
            "X-Actor-Id": str(MASTER_ID),
            "X-Role": "ADMIN_AUDITOR",
        },
        json=valid_body(),
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    assert response.headers["etag"] == '"v2"'
    assert response.headers["x-request-id"]
    assert response.json() == {
        "data": {
            "batchId": str(BATCH_ID),
            "lifecycleStatus": "RELEASED",
            "version": 2,
            "setCount": 2,
            "cardCountTotal": 3,
            "workCardSets": [
                {
                    "setId": str(FIRST_SET_ID),
                    "operationPlanId": str(FIRST_PLAN_ID),
                    "position": 1,
                    "operationScope": {
                        "code": "OP-10",
                        "displayName": "Операция А",  # noqa: RUF001
                    },
                    "normHours": "1.25",
                    "plannedCardCount": 2,
                    "gateStatus": "FIRST_ARTICLE_PENDING",
                    "version": 1,
                },
                {
                    "setId": str(SECOND_SET_ID),
                    "operationPlanId": str(SECOND_PLAN_ID),
                    "position": 2,
                    "operationScope": {
                        "code": "OP-20",
                        "displayName": "Операция Б",
                    },
                    "normHours": "2.00",
                    "plannedCardCount": 1,
                    "gateStatus": "FIRST_ARTICLE_PENDING",
                    "version": 1,
                },
            ],
        },
        "meta": {
            "commandId": str(COMMAND_ID),
            "correlationId": str(CORRELATION_ID),
            "replayed": False,
        },
    }
    assert release_gateway.calls == [
        (
            TrustedActor(actor_id=PLANNER_ID, role="PLANNER"),
            ReleaseWorkCardsCommand(
                command_id=COMMAND_ID,
                batch_id=BATCH_ID,
                expected_version=1,
            ),
            release_work_cards_request_hash(BATCH_ID, 1),
        )
    ]


@pytest.mark.parametrize("cookie", [None, "tampered"])
def test_missing_or_invalid_session_precedes_malformed_json(
    release_client: TestClient,
    release_gateway: FakeReleaseWorkCardsGateway,
    cookie: str | None,
) -> None:
    if cookie is not None:
        release_client.cookies.set(COOKIE_NAME, cookie, path="/api/v1")

    response = release_client.post(
        release_path(),
        headers=command_headers("invalid") | {"Content-Type": "application/json"},
        content="{",
    )

    assert_problem(response, 401, "AUTHENTICATION_REQUIRED")
    assert response.headers["www-authenticate"] == SESSION_CHALLENGE
    assert release_gateway.calls == []


def test_csrf_failure_precedes_permission_denial(
    release_client: TestClient,
    release_gateway: FakeReleaseWorkCardsGateway,
) -> None:
    select_identity(release_client, MASTER_ID)

    response = release_client.post(
        release_path(),
        headers=command_headers("invalid"),
        json=valid_body(),
    )

    assert_problem(response, 403, "CSRF_VALIDATION_FAILED")
    assert "www-authenticate" not in response.headers
    assert release_gateway.calls == []


@pytest.mark.parametrize(
    ("case", "expected_status", "expected_code"),
    [
        ("missing-session", 401, "AUTHENTICATION_REQUIRED"),
        ("invalid-session", 401, "AUTHENTICATION_REQUIRED"),
        ("permission", 403, "PERMISSION_DENIED"),
        ("csrf-before-origin", 403, "CSRF_VALIDATION_FAILED"),
        ("origin-before-body", 403, "ORIGIN_NOT_ALLOWED"),
        ("body", 400, "REQUEST_VALIDATION_FAILED"),
    ],
)
def test_exact_security_precedence_before_malformed_body(
    release_client: TestClient,
    release_gateway: FakeReleaseWorkCardsGateway,
    case: str,
    expected_status: int,
    expected_code: str,
) -> None:
    csrf: str | None = None
    if case == "invalid-session":
        release_client.cookies.set(COOKIE_NAME, "tampered", path="/api/v1")
    elif case == "permission":
        csrf = select_identity(release_client, MASTER_ID)
    elif case not in {"missing-session"}:
        csrf = select_identity(release_client)

    headers = {
        "Content-Type": "application/json",
        "X-Command-Id": str(COMMAND_ID),
        "Origin": "https://attacker.example" if case == "permission" else "http://testserver",
        "Sec-Fetch-Site": "same-origin",
        "X-CSRF-Token": csrf or "invalid",
    }
    if case == "csrf-before-origin":
        headers["X-CSRF-Token"] = "invalid"
        headers["Origin"] = "https://attacker.example"
        headers["Sec-Fetch-Site"] = "cross-site"
    elif case == "origin-before-body":
        headers["Origin"] = "https://attacker.example"

    response = release_client.post(release_path(), headers=headers, content="{")

    assert_problem(response, expected_status, expected_code)
    if expected_status == 401:
        assert response.headers["www-authenticate"] == SESSION_CHALLENGE
    else:
        assert "www-authenticate" not in response.headers
    if expected_code == "REQUEST_VALIDATION_FAILED":
        assert response.json()["errors"][0]["path"] == "body"
    assert release_gateway.calls == []


@pytest.mark.parametrize(
    ("case", "expected_code"),
    [
        ("missing-csrf", "CSRF_VALIDATION_FAILED"),
        ("invalid-csrf", "CSRF_VALIDATION_FAILED"),
        ("missing-origin", "ORIGIN_NOT_ALLOWED"),
        ("untrusted-origin", "ORIGIN_NOT_ALLOWED"),
        ("cross-site", "ORIGIN_NOT_ALLOWED"),
    ],
)
def test_csrf_and_origin_failures_reuse_shared_problem_contract(
    release_client: TestClient,
    release_gateway: FakeReleaseWorkCardsGateway,
    case: str,
    expected_code: str,
) -> None:
    csrf = select_identity(release_client)
    headers = command_headers(csrf)
    if case == "missing-csrf":
        headers.pop("X-CSRF-Token")
    elif case == "invalid-csrf":
        headers["X-CSRF-Token"] = "invalid"
    elif case == "missing-origin":
        headers.pop("Origin")
    elif case == "untrusted-origin":
        headers["Origin"] = "https://attacker.example"
    else:
        headers["Sec-Fetch-Site"] = "cross-site"

    response = release_client.post(release_path(), headers=headers, json=valid_body())

    assert_problem(response, 403, expected_code)
    assert release_gateway.calls == []


def test_non_json_content_type_is_rejected_after_valid_security(
    release_client: TestClient,
    release_gateway: FakeReleaseWorkCardsGateway,
) -> None:
    csrf = select_identity(release_client)

    response = release_client.post(
        release_path(),
        headers=command_headers(csrf) | {"Content-Type": "text/plain"},
        content=json.dumps(valid_body()),
    )

    assert_problem(response, 400, "REQUEST_VALIDATION_FAILED")
    assert response.json()["errors"] == [
        {
            "path": "body",
            "message": "Input should be valid JSON with application/json content type",
        }
    ]
    assert release_gateway.calls == []


def test_application_json_with_charset_is_accepted(
    release_client: TestClient,
    release_gateway: FakeReleaseWorkCardsGateway,
) -> None:
    csrf = select_identity(release_client)

    response = release_client.post(
        release_path(),
        headers=command_headers(csrf) | {"Content-Type": "application/json; charset=utf-8"},
        content=json.dumps(valid_body()),
    )

    assert response.status_code == 200
    assert len(release_gateway.calls) == 1


@pytest.mark.parametrize("command_id", [None, "not-a-uuid"])
def test_missing_or_invalid_command_id_is_request_validation_failure(
    release_client: TestClient,
    release_gateway: FakeReleaseWorkCardsGateway,
    command_id: str | None,
) -> None:
    csrf = select_identity(release_client)
    headers = command_headers(csrf)
    if command_id is None:
        headers.pop("X-Command-Id")
    else:
        headers["X-Command-Id"] = command_id

    response = release_client.post(release_path(), headers=headers, json=valid_body())

    assert_problem(response, 400, "REQUEST_VALIDATION_FAILED")
    assert any(error["path"].startswith("header.") for error in response.json()["errors"])
    assert release_gateway.calls == []


@pytest.mark.parametrize(
    "batch_id",
    ["not-a-uuid", str(BATCH_ID).upper(), f"{{{BATCH_ID}}}"],
)
def test_batch_id_must_be_lowercase_canonical_uuid(
    release_client: TestClient,
    release_gateway: FakeReleaseWorkCardsGateway,
    batch_id: str,
) -> None:
    csrf = select_identity(release_client)

    response = release_client.post(
        release_path(batch_id),
        headers=command_headers(csrf),
        json=valid_body(),
    )

    assert_problem(response, 400, "REQUEST_VALIDATION_FAILED")
    assert response.json()["errors"] == [
        {"path": "path.batchId", "message": "Input should be a lowercase canonical UUID"}
    ]
    assert release_gateway.calls == []


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"expectedVersion": "1"},
        {"expectedVersion": True},
        {"expectedVersion": 1.0},
        {"expectedVersion": None},
        {"expectedVersion": 1, "unexpected": True},
    ],
)
def test_invalid_request_shape_is_request_validation_failure(
    release_client: TestClient,
    release_gateway: FakeReleaseWorkCardsGateway,
    body: dict[str, object],
) -> None:
    csrf = select_identity(release_client)

    response = release_client.post(
        release_path(),
        headers=command_headers(csrf),
        json=body,
    )

    assert_problem(response, 400, "REQUEST_VALIDATION_FAILED")
    assert response.json()["errors"]
    assert release_gateway.calls == []


@pytest.mark.parametrize("expected_version", [1, 2_147_483_647])
def test_expected_version_boundaries_are_accepted(
    release_client: TestClient,
    release_gateway: FakeReleaseWorkCardsGateway,
    expected_version: int,
) -> None:
    csrf = select_identity(release_client)

    response = release_client.post(
        release_path(),
        headers=command_headers(csrf),
        json=valid_body(expected_version=expected_version),
    )

    assert response.status_code == 200
    assert release_gateway.calls == [
        (
            TrustedActor(actor_id=PLANNER_ID, role="PLANNER"),
            ReleaseWorkCardsCommand(
                command_id=COMMAND_ID,
                batch_id=BATCH_ID,
                expected_version=expected_version,
            ),
            release_work_cards_request_hash(BATCH_ID, expected_version),
        )
    ]


@pytest.mark.parametrize("expected_version", [0, -1, 2_147_483_648])
def test_semantically_invalid_expected_version_maps_to_production_batch_invalid(
    release_client: TestClient,
    release_gateway: FakeReleaseWorkCardsGateway,
    expected_version: int,
) -> None:
    csrf = select_identity(release_client)

    response = release_client.post(
        release_path(),
        headers=command_headers(csrf),
        json=valid_body(expected_version=expected_version),
    )

    assert_problem(response, 422, "PRODUCTION_BATCH_INVALID")
    assert release_gateway.calls == []


@pytest.mark.parametrize(
    ("failure", "status", "code"),
    [
        (PermissionDenied(), 403, "PERMISSION_DENIED"),
        (ProductionBatchNotFound(), 404, "RESOURCE_NOT_FOUND"),
        (CommandAlreadyProcessed(), 409, "COMMAND_ALREADY_PROCESSED"),
        (CommandIdReused(), 409, "COMMAND_ID_REUSED"),
        (BatchAlreadyReleased(), 409, "BATCH_ALREADY_RELEASED"),
        (VersionConflict(), 409, "VERSION_CONFLICT"),
        (ConcurrentCommandConflict(), 409, "CONCURRENT_MODIFICATION"),
        (ProductionBatchInvalid(), 422, "PRODUCTION_BATCH_INVALID"),
    ],
)
def test_typed_release_failures_map_to_exact_problem_details(
    release_client: TestClient,
    release_gateway: FakeReleaseWorkCardsGateway,
    failure: ReleaseWorkCardsFailure,
    status: int,
    code: str,
) -> None:
    release_gateway.failure = failure
    csrf = select_identity(release_client)

    response = release_client.post(
        release_path(),
        headers=command_headers(csrf),
        json=valid_body(),
    )

    assert_problem(response, status, code)
    assert response.json()["errors"] == []
    if code == "VERSION_CONFLICT":
        assert "version" not in response.json()["detail"].lower()


def test_unexpected_persistence_failure_is_safe_internal_error(
    release_client: TestClient,
    release_gateway: FakeReleaseWorkCardsGateway,
) -> None:
    release_gateway.failure = UnexpectedPersistenceFailure(
        "postgresql secret_table constraint internal-stack-marker"
    )
    csrf = select_identity(release_client)

    response = release_client.post(
        release_path(),
        headers=command_headers(csrf),
        json=valid_body(),
    )

    assert_problem(response, 500, "INTERNAL_ERROR")
    assert "postgresql" not in response.text
    assert "secret_table" not in response.text
    assert "internal-stack-marker" not in response.text


def test_release_route_rejects_unsupported_method_with_problem_details(
    release_client: TestClient,
) -> None:
    response = release_client.put(release_path())

    assert_problem(response, 405, "METHOD_NOT_ALLOWED")
    assert response.headers["allow"] == "POST"


def test_runtime_openapi_matches_snapshot_and_release_contract(
    release_application: FastAPI,
) -> None:
    schema = release_application.openapi()
    committed = json.loads(
        (Path(__file__).resolve().parents[2] / "openapi" / "openapi.json").read_text(
            encoding="utf-8"
        )
    )

    assert schema == committed
    operation = schema["paths"]["/api/v1/production-batches/{batchId}/actions/release-work-cards"][
        "post"
    ]
    assert schema["components"]["securitySchemes"] == {
        "SessionCookie": {
            "type": "apiKey",
            "in": "cookie",
            "name": COOKIE_NAME,
        }
    }
    assert operation["security"] == [{"SessionCookie": []}]
    assert operation["requestBody"] == {
        "required": True,
        "content": {
            "application/json": {"schema": {"$ref": "#/components/schemas/ReleaseWorkCardsRequest"}}
        },
    }
    assert schema["components"]["schemas"]["ReleaseWorkCardsRequest"] == {
        "additionalProperties": False,
        "properties": {
            "expectedVersion": {
                "maximum": 2_147_483_647,
                "minimum": 1,
                "title": "Expectedversion",
                "type": "integer",
            }
        },
        "required": ["expectedVersion"],
        "title": "ReleaseWorkCardsRequest",
        "type": "object",
    }
    assert operation["responses"]["200"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/ReleaseWorkCardsResponse"
    }
    assert "ETag" in operation["responses"]["200"]["headers"]
    assert operation["responses"]["401"]["headers"] == {
        "WWW-Authenticate": {
            "description": "Project-defined cookie session authentication challenge",
            "schema": {
                "type": "string",
                "const": SESSION_CHALLENGE,
            },
        }
    }
    parameters = {parameter["name"]: parameter for parameter in operation["parameters"]}
    assert parameters["batchId"] == {
        "name": "batchId",
        "in": "path",
        "required": True,
        "schema": {
            "format": "uuid",
            "pattern": ("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"),
            "title": "Batchid",
            "type": "string",
        },
    }
    assert parameters["Origin"] == {
        "name": "Origin",
        "in": "header",
        "required": True,
        "schema": {"type": "string", "title": "Origin"},
    }
    assert parameters["X-CSRF-Token"] == {
        "name": "X-CSRF-Token",
        "in": "header",
        "required": True,
        "schema": {"type": "string", "title": "X-CSRF-Token"},
    }
    assert parameters["X-Command-Id"]["in"] == "header"
    assert parameters["X-Command-Id"]["required"] is True
    assert parameters["X-Command-Id"]["schema"]["format"] == "uuid"
    for status in ("400", "401", "403", "404", "405", "409", "422", "500"):
        assert set(operation["responses"][status]["content"]) == {"application/problem+json"}
    assert "HTTPValidationError" not in str(operation)
