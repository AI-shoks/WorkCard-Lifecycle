from __future__ import annotations

from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from httpx import Response
from starlette.exceptions import HTTPException as StarletteHTTPException

from conftest import FakeDatabase

ORIGIN_HEADERS = {"Origin": "http://testserver", "Sec-Fetch-Site": "same-origin"}
PROBLEM_FIELDS = {"type", "title", "status", "code", "detail", "traceId", "errors"}


def assert_problem(response: Response, status: int, code: str) -> None:
    assert response.status_code == status
    assert response.headers["content-type"].startswith("application/problem+json")
    body = response.json()
    assert set(body) == PROBLEM_FIELDS
    assert body["status"] == status
    assert body["code"] == code
    assert body["type"].startswith("https://workcard.example/problems/")
    assert body["traceId"]


def test_error_contract_matrix(
    client: TestClient,
    application: FastAPI,
    fake_database: FakeDatabase,
) -> None:
    bootstrap = client.get("/api/v1/session/bootstrap")
    csrf = bootstrap.json()["csrfToken"]

    malformed_body = client.put(
        "/api/v1/session/demo",
        headers=ORIGIN_HEADERS | {"X-CSRF-Token": csrf, "Content-Type": "application/json"},
        content="{",
    )
    invalid_identity = client.put(
        "/api/v1/session/demo",
        headers=ORIGIN_HEADERS | {"X-CSRF-Token": csrf},
        json={"demoIdentityId": str(uuid4())},
    )
    unknown_route = client.get("/api/v1/not-a-route")
    unsupported_method = client.post("/health/live")

    fake_database.readiness_result = (False, "migrations_pending")
    readiness = client.get("/health/ready")

    fake_database.raise_on_identity_list = True
    with TestClient(application, raise_server_exceptions=False) as failure_client:
        generic_failure = failure_client.get("/api/v1/demo-identities")

    assert_problem(malformed_body, 400, "REQUEST_VALIDATION_FAILED")
    assert malformed_body.json()["errors"]
    assert_problem(invalid_identity, 422, "DEMO_IDENTITY_INVALID")
    assert_problem(unknown_route, 404, "RESOURCE_NOT_FOUND")
    assert_problem(unsupported_method, 405, "METHOD_NOT_ALLOWED")
    assert_problem(readiness, 503, "READINESS_UNAVAILABLE")
    assert_problem(generic_failure, 500, "INTERNAL_ERROR")


def test_http_exception_forwards_only_allow_for_method_not_allowed(
    application: FastAPI,
) -> None:
    @application.get("/synthetic-http-error")
    def synthetic_http_error() -> None:
        raise StarletteHTTPException(
            status_code=405,
            headers={
                "aLlOw": "POST",
                "Set-Cookie": "internal=value",
                "X-Internal-Debug": "secret",
                "WWW-Authenticate": "Basic realm=internal",
                "X-Arbitrary-Exception-Header": "must-not-escape",
            },
        )

    with TestClient(application) as test_client:
        response = test_client.get("/synthetic-http-error")

    assert response.headers.get_list("Allow") == ["POST"]
    for forbidden_header in (
        "set-cookie",
        "x-internal-debug",
        "www-authenticate",
        "x-arbitrary-exception-header",
    ):
        assert forbidden_header not in response.headers
    trace_id = response.json()["traceId"]
    assert response.json() == {
        "type": "https://workcard.example/problems/method-not-allowed",
        "title": "Метод не разрешён",
        "status": 405,
        "code": "METHOD_NOT_ALLOWED",
        "detail": "Используйте поддерживаемый метод запроса.",
        "traceId": trace_id,
        "errors": [],
    }


@pytest.mark.parametrize(
    ("status_code", "headers", "expected_code"),
    [
        (405, {"Set-Cookie": "internal=value"}, "METHOD_NOT_ALLOWED"),
        (
            418,
            {"Allow": "POST", "X-Internal-Debug": "secret"},
            "HTTP_ERROR",
        ),
    ],
)
def test_http_exception_drops_headers_without_405_allow(
    application: FastAPI,
    status_code: int,
    headers: dict[str, str],
    expected_code: str,
) -> None:
    @application.get("/synthetic-http-error-without-allowed-header")
    def synthetic_http_error() -> None:
        raise StarletteHTTPException(status_code=status_code, headers=headers)

    with TestClient(application) as test_client:
        response = test_client.get("/synthetic-http-error-without-allowed-header")

    assert_problem(response, status_code, expected_code)
    assert "allow" not in response.headers
    assert "set-cookie" not in response.headers
    assert "x-internal-debug" not in response.headers


def test_generated_openapi_matches_problem_details_runtime(application: FastAPI) -> None:
    schema = application.openapi()
    paths = schema["paths"]

    expected = {
        ("/health/live", "get"): {"404", "405", "500"},
        ("/health/ready", "get"): {"404", "405", "500", "503"},
        ("/api/v1/demo-identities", "get"): {"404", "405", "500"},
        ("/api/v1/session/bootstrap", "get"): {"404", "405", "500"},
        ("/api/v1/session/demo", "put"): {
            "400",
            "401",
            "403",
            "404",
            "405",
            "422",
            "500",
        },
        ("/api/v1/session", "get"): {"401", "404", "405", "500"},
        ("/api/v1/session", "delete"): {"401", "403", "404", "405", "500"},
    }
    for (path, method), statuses in expected.items():
        responses = paths[path][method]["responses"]
        assert statuses <= set(responses)
        for status in statuses:
            content = responses[status]["content"]
            assert set(content) == {"application/problem+json"}
            assert content["application/problem+json"]["schema"] == {
                "$ref": "#/components/schemas/ProblemDetails"
            }

    demo_responses = paths["/api/v1/session/demo"]["put"]["responses"]
    assert demo_responses["400"]["content"]["application/problem+json"]["schema"] == {
        "$ref": "#/components/schemas/ProblemDetails"
    }
    assert "HTTPValidationError" not in str(demo_responses)

    problem_schema = schema["components"]["schemas"]["ProblemDetails"]
    assert set(problem_schema["required"]) == PROBLEM_FIELDS

    challenge_header = {
        "WWW-Authenticate": {
            "description": "Project-defined cookie session authentication challenge",
            "schema": {
                "type": "string",
                "const": 'WorkcardSession realm="workcard-api"',
            },
        }
    }
    protected_operations = {
        ("/api/v1/session/demo", "put"),
        ("/api/v1/session", "get"),
        ("/api/v1/session", "delete"),
        ("/api/v1/production-batches", "post"),
        (
            "/api/v1/production-batches/{batchId}/actions/release-work-cards",
            "post",
        ),
    }
    public_operations = {
        ("/health/live", "get"),
        ("/health/ready", "get"),
        ("/api/v1/demo-identities", "get"),
        ("/api/v1/session/bootstrap", "get"),
    }
    actual_operations = {
        (path, method)
        for path, path_item in paths.items()
        for method, operation in path_item.items()
        if isinstance(operation, dict) and "responses" in operation
    }
    assert actual_operations == protected_operations | public_operations

    for path, method in protected_operations:
        responses = paths[path][method]["responses"]
        assert responses["401"]["headers"] == challenge_header
        for status, response in responses.items():
            if status != "401":
                assert "WWW-Authenticate" not in response.get("headers", {})
    for path, method in public_operations:
        for response in paths[path][method]["responses"].values():
            assert "WWW-Authenticate" not in response.get("headers", {})

    security_schemes = schema["components"]["securitySchemes"]
    assert security_schemes == {
        "SessionCookie": {
            "type": "apiKey",
            "in": "cookie",
            "name": "workcard_demo_session",
        }
    }
    assert all(
        definition["type"] not in {"http", "oauth2", "openIdConnect"}
        for definition in security_schemes.values()
    )


def test_generated_openapi_declares_exact_operation_security(
    application: FastAPI,
) -> None:
    paths = application.openapi()["paths"]
    protected_operations = (
        ("/api/v1/session/demo", "put"),
        ("/api/v1/session", "get"),
        ("/api/v1/session", "delete"),
        ("/api/v1/production-batches", "post"),
        (
            "/api/v1/production-batches/{batchId}/actions/release-work-cards",
            "post",
        ),
    )
    public_operations = (
        ("/api/v1/demo-identities", "get"),
        ("/api/v1/session/bootstrap", "get"),
        ("/health/live", "get"),
        ("/health/ready", "get"),
    )

    for path, method in protected_operations:
        assert paths[path][method]["security"] == [{"SessionCookie": []}]
    for path, method in public_operations:
        assert "security" not in paths[path][method]
