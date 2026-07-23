from __future__ import annotations

from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient
from httpx import Response

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
