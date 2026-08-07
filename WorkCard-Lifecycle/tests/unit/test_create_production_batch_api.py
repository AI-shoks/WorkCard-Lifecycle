from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path
from uuid import UUID

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from httpx import Response

import workcard_api.app as app_module
from conftest import MASTER_ID, PLANNER_ID, FakeDatabase
from workcard_api.app import CreateProductionBatchRequest, create_app
from workcard_api.auth import COOKIE_NAME
from workcard_api.config import Settings
from workcard_api.production_batches import (
    CommandAlreadyProcessed,
    CommandIdReused,
    ConcurrentCommandConflict,
    CreateProductionBatchCommand,
    CreateProductionBatchFailure,
    CreateProductionBatchResult,
    OperationPlanSnapshot,
    OperationScopeSnapshot,
    ProductionBatchInvalid,
    ProductionPassportNotFound,
    ProductionPassportSnapshot,
    TrustedActor,
    UnexpectedPersistenceFailure,
    create_production_batch_request_hash,
)

ORIGIN_HEADERS = {"Origin": "http://testserver", "Sec-Fetch-Site": "same-origin"}
PROBLEM_FIELDS = {"type", "title", "status", "code", "detail", "traceId", "errors"}
PASSPORT_ID = UUID("20000000-0000-4000-8000-000000000001")
BATCH_ID = UUID("30000000-0000-4000-8000-000000000001")
PLAN_ID = UUID("40000000-0000-4000-8000-000000000001")
COMMAND_ID = UUID("50000000-0000-4000-8000-000000000001")
CORRELATION_ID = UUID("60000000-0000-4000-8000-000000000001")


class FakeCreateProductionBatchGateway:
    def __init__(self) -> None:
        self.calls: list[tuple[TrustedActor, CreateProductionBatchCommand, str]] = []
        self.failure: CreateProductionBatchFailure | None = None

    def create_production_batch(
        self,
        actor: TrustedActor,
        command: CreateProductionBatchCommand,
        request_hash: str,
    ) -> CreateProductionBatchResult:
        self.calls.append((actor, command, request_hash))
        if self.failure is not None:
            raise self.failure
        return CreateProductionBatchResult(
            batch_id=BATCH_ID,
            production_passport_id=command.production_passport_id,
            quantity=command.quantity,
            lifecycle_status="CREATED",
            version=1,
            passport_snapshot=ProductionPassportSnapshot(
                production_passport_id=command.production_passport_id,
                code="PP-001",
                revision="A",
                product_name="Тестовое изделие",
                operation_plans=(
                    OperationPlanSnapshot(
                        operation_plan_id=PLAN_ID,
                        position=1,
                        operation_scope=OperationScopeSnapshot(
                            code="MACHINING",
                            display_name="Механическая обработка",
                        ),
                        norm_hours="1.50",
                        planned_card_count=command.quantity,
                    ),
                ),
            ),
            command_id=command.command_id,
            correlation_id=CORRELATION_ID,
        )


@pytest.fixture
def create_batch_gateway() -> FakeCreateProductionBatchGateway:
    return FakeCreateProductionBatchGateway()


@pytest.fixture
def batch_application(
    settings: Settings,
    fake_database: FakeDatabase,
    create_batch_gateway: FakeCreateProductionBatchGateway,
) -> FastAPI:
    return create_app(settings, fake_database, create_batch_gateway)


@pytest.fixture
def batch_client(batch_application: FastAPI) -> Iterator[TestClient]:
    with TestClient(batch_application) as client:
        yield client


@pytest.fixture
def create_body_parser_calls(
    monkeypatch: pytest.MonkeyPatch,
) -> list[Request]:
    calls: list[Request] = []
    original = app_module.validated_create_production_batch_request

    async def observed_body_parser(request: Request) -> CreateProductionBatchRequest:
        calls.append(request)
        return await original(request)

    monkeypatch.setattr(
        app_module,
        "validated_create_production_batch_request",
        observed_body_parser,
    )
    return calls


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


def command_headers(csrf: str, command_id: object = COMMAND_ID) -> dict[str, str]:
    return ORIGIN_HEADERS | {
        "X-CSRF-Token": csrf,
        "X-Command-Id": str(command_id),
    }


def valid_body(*, quantity: object = 112) -> dict[str, object]:
    return {"productionPassportId": str(PASSPORT_ID), "quantity": quantity}


def assert_problem(response: Response, status: int, code: str) -> None:
    assert response.status_code == status
    assert response.headers["content-type"].startswith("application/problem+json")
    body = response.json()
    assert set(body) == PROBLEM_FIELDS
    assert body["status"] == status
    assert body["code"] == code
    assert body["type"] == f"https://workcard.example/problems/{code.lower().replace('_', '-')}"
    assert body["traceId"]


def test_planner_creates_production_batch_with_exact_envelope_and_trusted_actor(
    batch_client: TestClient,
    create_batch_gateway: FakeCreateProductionBatchGateway,
) -> None:
    csrf = select_identity(batch_client)

    response = batch_client.post(
        "/api/v1/production-batches",
        headers=command_headers(csrf)
        | {
            "X-Actor-Id": str(MASTER_ID),
            "X-Role": "ADMIN_AUDITOR",
        },
        json=valid_body(),
    )

    assert response.status_code == 201
    assert response.headers["etag"] == '"v1"'
    assert response.json() == {
        "data": {
            "batchId": str(BATCH_ID),
            "productionPassportId": str(PASSPORT_ID),
            "quantity": 112,
            "lifecycleStatus": "CREATED",
            "version": 1,
            "passportSnapshot": {
                "productionPassportId": str(PASSPORT_ID),
                "code": "PP-001",
                "revision": "A",
                "productName": "Тестовое изделие",
                "operationPlans": [
                    {
                        "operationPlanId": str(PLAN_ID),
                        "position": 1,
                        "operationScope": {
                            "code": "MACHINING",
                            "displayName": "Механическая обработка",
                        },
                        "normHours": "1.50",
                        "plannedCardCount": 112,
                    }
                ],
            },
        },
        "meta": {
            "commandId": str(COMMAND_ID),
            "correlationId": str(CORRELATION_ID),
            "replayed": False,
        },
    }
    assert create_batch_gateway.calls == [
        (
            TrustedActor(actor_id=PLANNER_ID, role="PLANNER"),
            CreateProductionBatchCommand(
                command_id=COMMAND_ID,
                production_passport_id=PASSPORT_ID,
                quantity=112,
            ),
            create_production_batch_request_hash(PASSPORT_ID, 112),
        )
    ]


@pytest.mark.parametrize("cookie", [None, "tampered"])
def test_missing_or_invalid_session_is_authentication_required_before_schema(
    batch_client: TestClient,
    create_batch_gateway: FakeCreateProductionBatchGateway,
    cookie: str | None,
) -> None:
    if cookie is not None:
        batch_client.cookies.set(COOKIE_NAME, cookie, path="/api/v1")

    response = batch_client.post(
        "/api/v1/production-batches",
        headers=command_headers("not-a-session-token"),
        json={"unknown": True},
    )

    assert_problem(response, 401, "AUTHENTICATION_REQUIRED")
    assert create_batch_gateway.calls == []


def test_forbidden_role_is_denied_before_request_schema(
    batch_client: TestClient,
    create_batch_gateway: FakeCreateProductionBatchGateway,
) -> None:
    csrf = select_identity(batch_client, MASTER_ID)

    response = batch_client.post(
        "/api/v1/production-batches",
        headers=command_headers(csrf),
        json={"unknown": True},
    )

    assert_problem(response, 403, "PERMISSION_DENIED")
    assert create_batch_gateway.calls == []


@pytest.mark.parametrize(
    (
        "session_case",
        "csrf_mode",
        "origin",
        "expected_status",
        "expected_code",
        "expected_body_parser_calls",
    ),
    [
        pytest.param(
            "missing",
            "missing",
            "https://attacker.example",
            401,
            "AUTHENTICATION_REQUIRED",
            0,
            id="missing-session-before-csrf-permission-origin-body",
        ),
        pytest.param(
            "revoked-master",
            "invalid",
            "https://attacker.example",
            401,
            "AUTHENTICATION_REQUIRED",
            0,
            id="revoked-session-before-csrf-permission-origin-body",
        ),
        pytest.param(
            "master",
            "missing",
            "https://attacker.example",
            403,
            "CSRF_VALIDATION_FAILED",
            0,
            id="missing-csrf-before-permission-origin-body",
        ),
        pytest.param(
            "master",
            "invalid",
            "https://attacker.example",
            403,
            "CSRF_VALIDATION_FAILED",
            0,
            id="invalid-csrf-before-permission-origin-body",
        ),
        pytest.param(
            "master",
            "valid",
            "https://attacker.example",
            403,
            "PERMISSION_DENIED",
            0,
            id="permission-before-origin-body",
        ),
        pytest.param(
            "planner",
            "valid",
            "https://attacker.example",
            403,
            "ORIGIN_NOT_ALLOWED",
            0,
            id="origin-before-body",
        ),
        pytest.param(
            "planner",
            "valid",
            "http://testserver",
            400,
            "REQUEST_VALIDATION_FAILED",
            1,
            id="body-validation-only-after-all-security",
        ),
    ],
)
def test_create_batch_security_collision_matrix(
    batch_client: TestClient,
    create_batch_gateway: FakeCreateProductionBatchGateway,
    create_body_parser_calls: list[Request],
    session_case: str,
    csrf_mode: str,
    origin: str,
    expected_status: int,
    expected_code: str,
    expected_body_parser_calls: int,
) -> None:
    csrf: str | None = None
    if session_case != "missing":
        identity_id = MASTER_ID if session_case in {"master", "revoked-master"} else PLANNER_ID
        csrf = select_identity(batch_client, identity_id)
    if session_case == "revoked-master":
        revoked_cookie = batch_client.cookies.get(COOKIE_NAME)
        selected = batch_client.put(
            "/api/v1/session/demo",
            headers=ORIGIN_HEADERS | {"X-CSRF-Token": csrf},
            json={"demoIdentityId": str(PLANNER_ID)},
        )
        assert selected.status_code == 200
        batch_client.cookies.set(COOKIE_NAME, revoked_cookie, path="/api/v1")

    headers = {
        "Content-Type": "application/json",
        "Origin": origin,
        "Sec-Fetch-Site": "same-origin",
        "X-Command-Id": str(COMMAND_ID),
    }
    if csrf_mode == "invalid":
        headers["X-CSRF-Token"] = "invalid"
    elif csrf_mode == "valid":
        assert csrf is not None
        headers["X-CSRF-Token"] = csrf

    response = batch_client.post(
        "/api/v1/production-batches",
        headers=headers,
        content="{",
    )

    assert_problem(response, expected_status, expected_code)
    if expected_status == 401:
        assert response.headers["www-authenticate"] == 'WorkcardSession realm="workcard-api"'
    else:
        assert "www-authenticate" not in response.headers
    if expected_code == "REQUEST_VALIDATION_FAILED":
        assert response.json()["errors"][0]["path"] == "body"
    assert len(create_body_parser_calls) == expected_body_parser_calls
    assert create_batch_gateway.calls == []


def test_non_json_content_type_is_rejected_after_valid_security(
    batch_client: TestClient,
    create_batch_gateway: FakeCreateProductionBatchGateway,
) -> None:
    csrf = select_identity(batch_client)

    response = batch_client.post(
        "/api/v1/production-batches",
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
    assert create_batch_gateway.calls == []


def test_application_json_with_charset_is_accepted(
    batch_client: TestClient,
    create_batch_gateway: FakeCreateProductionBatchGateway,
) -> None:
    csrf = select_identity(batch_client)

    response = batch_client.post(
        "/api/v1/production-batches",
        headers=command_headers(csrf) | {"Content-Type": "application/json; charset=utf-8"},
        content=json.dumps(valid_body()),
    )

    assert response.status_code == 201
    assert len(create_batch_gateway.calls) == 1


@pytest.mark.parametrize("command_id", [None, "not-a-uuid"])
def test_missing_or_invalid_command_id_is_request_validation_failure(
    batch_client: TestClient,
    create_batch_gateway: FakeCreateProductionBatchGateway,
    command_id: str | None,
) -> None:
    csrf = select_identity(batch_client)
    headers = command_headers(csrf)
    if command_id is None:
        headers.pop("X-Command-Id")
    else:
        headers["X-Command-Id"] = command_id

    response = batch_client.post(
        "/api/v1/production-batches",
        headers=headers,
        json=valid_body(),
    )

    assert_problem(response, 400, "REQUEST_VALIDATION_FAILED")
    assert any(error["path"].startswith("header.") for error in response.json()["errors"])
    assert create_batch_gateway.calls == []


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
def test_csrf_and_origin_failures_reuse_existing_problem_contract(
    batch_client: TestClient,
    create_batch_gateway: FakeCreateProductionBatchGateway,
    case: str,
    expected_code: str,
) -> None:
    csrf = select_identity(batch_client)
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

    response = batch_client.post(
        "/api/v1/production-batches",
        headers=headers,
        json=valid_body(),
    )

    assert_problem(response, 403, expected_code)
    assert create_batch_gateway.calls == []


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("unexpected", True),
        ("actorId", str(MASTER_ID)),
        ("role", "ADMIN_AUDITOR"),
    ],
)
def test_unknown_actor_and_role_body_fields_are_rejected(
    batch_client: TestClient,
    create_batch_gateway: FakeCreateProductionBatchGateway,
    field: str,
    value: object,
) -> None:
    csrf = select_identity(batch_client)
    body = valid_body()
    body[field] = value

    response = batch_client.post(
        "/api/v1/production-batches",
        headers=command_headers(csrf),
        json=body,
    )

    assert_problem(response, 400, "REQUEST_VALIDATION_FAILED")
    assert create_batch_gateway.calls == []


def test_invalid_quantity_maps_to_production_batch_invalid(
    batch_client: TestClient,
    create_batch_gateway: FakeCreateProductionBatchGateway,
) -> None:
    csrf = select_identity(batch_client)

    response = batch_client.post(
        "/api/v1/production-batches",
        headers=command_headers(csrf),
        json=valid_body(quantity=0),
    )

    assert_problem(response, 422, "PRODUCTION_BATCH_INVALID")
    assert create_batch_gateway.calls == []


def test_missing_passport_maps_to_resource_not_found(
    batch_client: TestClient,
    create_batch_gateway: FakeCreateProductionBatchGateway,
) -> None:
    create_batch_gateway.failure = ProductionPassportNotFound()
    csrf = select_identity(batch_client)

    response = batch_client.post(
        "/api/v1/production-batches",
        headers=command_headers(csrf),
        json=valid_body(),
    )

    assert_problem(response, 404, "RESOURCE_NOT_FOUND")


@pytest.mark.parametrize(
    ("failure", "expected_code"),
    [
        (CommandAlreadyProcessed(), "COMMAND_ALREADY_PROCESSED"),
        (CommandIdReused(), "COMMAND_ID_REUSED"),
        (ConcurrentCommandConflict(), "CONCURRENT_MODIFICATION"),
        (ProductionBatchInvalid(), "PRODUCTION_BATCH_INVALID"),
    ],
)
def test_typed_gate_failures_map_to_problem_details(
    batch_client: TestClient,
    create_batch_gateway: FakeCreateProductionBatchGateway,
    failure: CreateProductionBatchFailure,
    expected_code: str,
) -> None:
    create_batch_gateway.failure = failure
    csrf = select_identity(batch_client)

    response = batch_client.post(
        "/api/v1/production-batches",
        headers=command_headers(csrf),
        json=valid_body(),
    )

    expected_status = 422 if expected_code == "PRODUCTION_BATCH_INVALID" else 409
    assert_problem(response, expected_status, expected_code)


def test_unexpected_persistence_failure_is_safe_internal_error(
    batch_client: TestClient,
    create_batch_gateway: FakeCreateProductionBatchGateway,
) -> None:
    create_batch_gateway.failure = UnexpectedPersistenceFailure(
        "postgresql secret_table constraint internal-stack-marker"
    )
    csrf = select_identity(batch_client)

    response = batch_client.post(
        "/api/v1/production-batches",
        headers=command_headers(csrf),
        json=valid_body(),
    )

    assert_problem(response, 500, "INTERNAL_ERROR")
    assert "postgresql" not in response.text
    assert "secret_table" not in response.text
    assert "internal-stack-marker" not in response.text


def test_runtime_openapi_matches_committed_snapshot_and_create_contract(
    batch_application: FastAPI,
) -> None:
    schema = batch_application.openapi()
    committed = json.loads(
        (Path(__file__).resolve().parents[2] / "openapi" / "openapi.json").read_text(
            encoding="utf-8"
        )
    )

    assert schema == committed
    operation = schema["paths"]["/api/v1/production-batches"]["post"]
    assert schema["components"]["securitySchemes"]["SessionCookie"] == {
        "type": "apiKey",
        "in": "cookie",
        "name": COOKIE_NAME,
    }
    assert operation["security"] == [{"SessionCookie": []}]
    assert operation["requestBody"] == {
        "required": True,
        "content": {
            "application/json": {
                "schema": {"$ref": "#/components/schemas/CreateProductionBatchRequest"}
            }
        },
    }
    assert schema["components"]["schemas"]["CreateProductionBatchRequest"] == {
        "additionalProperties": False,
        "properties": {
            "productionPassportId": {
                "format": "uuid",
                "title": "Productionpassportid",
                "type": "string",
            },
            "quantity": {"title": "Quantity", "type": "integer"},
        },
        "required": ["productionPassportId", "quantity"],
        "title": "CreateProductionBatchRequest",
        "type": "object",
    }
    assert operation["responses"]["201"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/CreateProductionBatchResponse"
    }
    assert "ETag" in operation["responses"]["201"]["headers"]
    parameters = {parameter["name"]: parameter for parameter in operation["parameters"]}
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
    assert parameters["X-Command-Id"] == {
        "name": "X-Command-Id",
        "in": "header",
        "required": True,
        "schema": {
            "type": "string",
            "format": "uuid",
            "title": "X-Command-Id",
        },
    }
    for status in ("400", "401", "403", "404", "405", "409", "422", "500"):
        assert set(operation["responses"][status]["content"]) == {"application/problem+json"}
    assert "HTTPValidationError" not in str(operation)
