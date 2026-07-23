from __future__ import annotations

import json
import logging
from uuid import uuid4

from fastapi.testclient import TestClient

from conftest import FakeDatabase
from workcard_api.logging import JsonFormatter, bind_request_id, reset_request_id


def test_liveness_is_process_only_and_adds_security_and_trace_headers(
    client: TestClient,
) -> None:
    supplied_request_id = str(uuid4())

    response = client.get("/health/live", headers={"X-Request-Id": supplied_request_id})

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert response.headers["X-Request-Id"] == supplied_request_id
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert "camera=()" in response.headers["Permissions-Policy"]
    assert "frame-ancestors 'none'" in response.headers["Content-Security-Policy"]


def test_readiness_reports_pending_database_without_sensitive_details(
    client: TestClient, fake_database: FakeDatabase
) -> None:
    fake_database.readiness_result = (False, "migrations_pending")

    response = client.get("/health/ready")

    assert response.status_code == 503
    assert response.json()["code"] == "READINESS_UNAVAILABLE"
    assert response.headers["content-type"].startswith("application/problem+json")
    assert "postgresql" not in response.text


def test_metrics_use_route_template_and_status(client: TestClient) -> None:
    client.get("/health/live")

    response = client.get("/metrics")

    assert response.status_code == 200
    assert 'route="/health/live",status="200"' in response.text
    assert "workcard_http_request_duration_seconds" in response.text


def test_invalid_request_id_is_replaced(client: TestClient) -> None:
    response = client.get("/health/live", headers={"X-Request-Id": "log-injection\nvalue"})

    assert response.status_code == 200
    assert response.headers["X-Request-Id"] != "log-injection\nvalue"


def test_json_formatter_uses_allowlist_and_request_context() -> None:
    formatter = JsonFormatter()
    record = logging.LogRecord(
        "test",
        logging.INFO,
        __file__,
        1,
        "completed",
        (),
        None,
    )
    record.cookie = "must-not-be-logged"
    record.status_code = 200
    token = bind_request_id("trace-1")
    try:
        payload = json.loads(formatter.format(record))
    finally:
        reset_request_id(token)

    assert payload["request_id"] == "trace-1"
    assert payload["status_code"] == 200
    assert "cookie" not in payload
