from __future__ import annotations

import logging
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from typing import Any
from uuid import UUID, uuid4

from fastapi import APIRouter, FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.openapi.utils import get_openapi
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict
from starlette.exceptions import HTTPException as StarletteHTTPException

from workcard_api.auth import (
    COOKIE_NAME,
    CSRF_HEADER,
    ROLE_PERMISSIONS,
    SessionManager,
    authenticated_identity,
    validate_origin,
)
from workcard_api.config import Settings, get_settings
from workcard_api.database import DatabaseGateway, PostgresDatabase
from workcard_api.errors import Problem, ProblemDetails, ProblemError, ProblemFieldError
from workcard_api.logging import (
    bind_request_id,
    configure_logging,
    reset_request_id,
)
from workcard_api.migrations import latest_migration_version
from workcard_api.models import DemoIdentity, Role
from workcard_api.observability import Metrics

LOGGER = logging.getLogger("workcard_api.http")


class IdentityResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: UUID
    displayName: str
    role: Role


class IdentityListResponse(BaseModel):
    items: list[IdentityResponse]


class BootstrapResponse(BaseModel):
    csrfToken: str
    expiresInSeconds: int


class SelectIdentityRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    demoIdentityId: UUID


class SessionResponse(BaseModel):
    actor: IdentityResponse
    permissions: list[str]
    csrfToken: str
    expiresInSeconds: int


class HealthResponse(BaseModel):
    status: str


class ReadinessResponse(BaseModel):
    status: str
    checks: dict[str, str]


def problem_responses(*statuses: int) -> dict[int | str, dict[str, Any]]:
    return {
        status: {
            "model": ProblemDetails,
            "description": "Problem Details error response",
        }
        for status in statuses
    }


def identity_response(identity: DemoIdentity) -> IdentityResponse:
    return IdentityResponse(
        id=identity.id,
        displayName=identity.display_name,
        role=identity.role,
    )


def problem_response(problem: Problem, trace_id: str) -> JSONResponse:
    return JSONResponse(
        status_code=problem.status,
        content=problem.body(trace_id),
        media_type="application/problem+json",
    )


def request_id(request: Request) -> str:
    return str(getattr(request.state, "request_id", "unknown"))


def set_session_cookie(response: Response, cookie: str, settings: Settings) -> None:
    response.set_cookie(
        COOKIE_NAME,
        cookie,
        max_age=settings.session_ttl_seconds,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="strict",
        path=settings.api_prefix,
    )


def create_app(
    settings: Settings | None = None,
    database: DatabaseGateway | None = None,
) -> FastAPI:
    app_settings = settings or get_settings()
    configure_logging(app_settings.log_level)
    db = database or PostgresDatabase(
        app_settings.database_dsn,
        min_size=app_settings.database_pool_min_size,
        max_size=app_settings.database_pool_max_size,
        timeout=app_settings.database_timeout_seconds,
    )
    sessions = SessionManager(app_settings, db)
    metrics = Metrics.create()
    expected_migration = latest_migration_version()

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        db.open()
        LOGGER.info("application started", extra={"event": "application_started"})
        try:
            yield
        finally:
            db.close()
            LOGGER.info("application stopped", extra={"event": "application_stopped"})

    app = FastAPI(
        title=app_settings.app_name,
        version="0.1.0",
        openapi_version="3.1.0",
        lifespan=lifespan,
        docs_url="/docs" if app_settings.environment in {"local", "test"} else None,
        redoc_url=None,
    )
    app.state.settings = app_settings
    app.state.database = db
    app.state.sessions = sessions
    app.state.metrics = metrics

    def custom_openapi() -> dict[str, Any]:
        if app.openapi_schema is not None:
            return app.openapi_schema
        schema = get_openapi(
            title=app.title,
            version=app.version,
            openapi_version=app.openapi_version,
            routes=app.routes,
        )
        for path_item in schema.get("paths", {}).values():
            for operation in path_item.values():
                if not isinstance(operation, dict) or "responses" not in operation:
                    continue
                responses = operation["responses"]
                validation = responses.get("422")
                validation_schema = (
                    validation.get("content", {}).get("application/json", {}).get("schema", {})
                    if isinstance(validation, dict)
                    else {}
                )
                if validation_schema.get("$ref", "").endswith("HTTPValidationError"):
                    responses.pop("422")
                for status, response_definition in responses.items():
                    if not status.isdigit() or int(status) < 400:
                        continue
                    content = response_definition.get("content", {})
                    json_content = content.pop("application/json", None)
                    if json_content is not None:
                        content["application/problem+json"] = json_content
        app.openapi_schema = schema
        return schema

    app.openapi = custom_openapi  # type: ignore[method-assign]

    @app.middleware("http")
    async def request_observability(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        header_request_id = request.headers.get("X-Request-Id")
        try:
            current_request_id = str(UUID(header_request_id)) if header_request_id else str(uuid4())
        except ValueError:
            current_request_id = str(uuid4())
        request.state.request_id = current_request_id
        token = bind_request_id(current_request_id)
        started = time.perf_counter()
        try:
            response = await call_next(request)
        finally:
            reset_request_id(token)
        route = getattr(request.scope.get("route"), "path", "unmatched")
        duration = time.perf_counter() - started
        if app_settings.metrics_enabled:
            metrics.requests.labels(request.method, route, str(response.status_code)).inc()
            metrics.duration.labels(request.method, route).observe(duration)
        LOGGER.info(
            "request completed",
            extra={
                "request_id": current_request_id,
                "method": request.method,
                "route": route,
                "status_code": response.status_code,
                "duration_ms": round(duration * 1000, 3),
                "event": "http_request_completed",
            },
        )
        response.headers["X-Request-Id"] = current_request_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
        )
        return response

    @app.exception_handler(ProblemError)
    async def handle_problem(request: Request, error: ProblemError) -> JSONResponse:
        return problem_response(error.problem, request_id(request))

    @app.exception_handler(RequestValidationError)
    async def handle_validation(request: Request, error: RequestValidationError) -> JSONResponse:
        safe_errors = [
            ProblemFieldError(
                path=".".join(str(part) for part in item["loc"]),
                message=item["msg"],
            )
            for item in error.errors()
        ]
        return problem_response(
            Problem(
                status=400,
                code="REQUEST_VALIDATION_FAILED",
                title="Некорректный запрос",
                detail="Проверьте формат и обязательные поля.",
                type_slug="request-validation-failed",
                errors=safe_errors,
            ),
            request_id(request),
        )

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_error(request: Request, error: StarletteHTTPException) -> JSONResponse:
        if error.status_code == 404:
            problem = Problem(
                status=404,
                code="RESOURCE_NOT_FOUND",
                title="Ресурс не найден",  # noqa: RUF001 - intentional Russian UI copy
                detail="Проверьте адрес запроса.",
                type_slug="resource-not-found",
            )
        elif error.status_code == 405:
            problem = Problem(
                status=405,
                code="METHOD_NOT_ALLOWED",
                title="Метод не разрешён",
                detail="Используйте поддерживаемый метод запроса.",
                type_slug="method-not-allowed",
            )
        else:
            problem = Problem(
                status=error.status_code,
                code="HTTP_ERROR",
                title="Запрос отклонён",
                detail="Запрос не может быть выполнен.",
                type_slug="http-error",
            )
        return problem_response(problem, request_id(request))

    @app.exception_handler(Exception)
    async def handle_unexpected(request: Request, error: Exception) -> JSONResponse:
        LOGGER.exception("unhandled request failure", exc_info=error)
        return problem_response(
            Problem(
                status=500,
                code="INTERNAL_ERROR",
                title="Внутренняя ошибка",
                detail="Повторите запрос позднее.",
                type_slug="internal-error",
            ),
            request_id(request),
        )

    @app.get(
        "/health/live",
        response_model=HealthResponse,
        responses=problem_responses(404, 405, 500),
        tags=["health"],
    )
    def health_live() -> HealthResponse:
        return HealthResponse(status="ok")

    @app.get(
        "/health/ready",
        response_model=ReadinessResponse,
        responses=problem_responses(404, 405, 500, 503),
        tags=["health"],
    )
    def health_ready() -> ReadinessResponse:
        ready, database_status = db.readiness(expected_migration)
        if not ready:
            raise ProblemError(
                Problem(
                    status=503,
                    code="READINESS_UNAVAILABLE",
                    title="Приложение не готово",
                    detail="Проверка зависимости базы данных не пройдена.",
                    type_slug="readiness-unavailable",
                )
            )
        return ReadinessResponse(status="ready", checks={"database": database_status})

    @app.get("/metrics", include_in_schema=False)
    def prometheus_metrics() -> Response:
        if not app_settings.metrics_enabled:
            return Response(status_code=404)
        return Response(content=metrics.render(), media_type="text/plain; version=0.0.4")

    api = APIRouter(prefix=app_settings.api_prefix)

    @api.get(
        "/demo-identities",
        response_model=IdentityListResponse,
        responses=problem_responses(404, 405, 500),
        tags=["session"],
    )
    def list_demo_identities() -> IdentityListResponse:
        return IdentityListResponse(
            items=[identity_response(identity) for identity in db.list_demo_identities()]
        )

    @api.get(
        "/session/bootstrap",
        response_model=BootstrapResponse,
        responses=problem_responses(404, 405, 500),
        tags=["session"],
    )
    def bootstrap_session(response: Response) -> BootstrapResponse:
        cookie, csrf, session = sessions.create()
        set_session_cookie(response, cookie, app_settings)
        return BootstrapResponse(
            csrfToken=csrf,
            expiresInSeconds=sessions.remaining_ttl_seconds(session),
        )

    @api.put(
        "/session/demo",
        response_model=SessionResponse,
        responses=problem_responses(400, 401, 403, 404, 405, 422, 500),
        tags=["session"],
    )
    def select_demo_identity(
        payload: SelectIdentityRequest,
        request: Request,
        response: Response,
    ) -> SessionResponse:
        validate_origin(request, app_settings)
        current = sessions.load(request.cookies.get(COOKIE_NAME))
        sessions.verify_csrf(current, request.headers.get(CSRF_HEADER))
        identity = db.get_demo_identity(payload.demoIdentityId)
        if identity is None:
            raise ProblemError(
                Problem(
                    status=422,
                    code="DEMO_IDENTITY_INVALID",
                    title="Демонстрационная роль недоступна",
                    detail="Выберите роль из подготовленного списка.",
                    type_slug="demo-identity-invalid",
                )
            )
        cookie, csrf, session = sessions.rotate(current, identity.id, identity.role)
        set_session_cookie(response, cookie, app_settings)
        return SessionResponse(
            actor=identity_response(identity),
            permissions=list(ROLE_PERMISSIONS[identity.role]),
            csrfToken=csrf,
            expiresInSeconds=sessions.remaining_ttl_seconds(session),
        )

    @api.get(
        "/session",
        response_model=SessionResponse,
        responses=problem_responses(401, 404, 405, 500),
        tags=["session"],
    )
    def get_session(request: Request) -> SessionResponse:
        current, identity = authenticated_identity(request, sessions, db)
        csrf = sessions.csrf_for(current)
        return SessionResponse(
            actor=identity_response(identity),
            permissions=list(ROLE_PERMISSIONS[identity.role]),
            csrfToken=csrf,
            expiresInSeconds=sessions.remaining_ttl_seconds(current),
        )

    @api.delete(
        "/session",
        status_code=204,
        response_class=Response,
        responses=problem_responses(401, 403, 404, 405, 500),
        tags=["session"],
    )
    def delete_session(request: Request, response: Response) -> Response:
        validate_origin(request, app_settings)
        current, _ = authenticated_identity(request, sessions, db)
        sessions.verify_csrf(current, request.headers.get(CSRF_HEADER))
        sessions.revoke(current)
        response.delete_cookie(COOKIE_NAME, path=app_settings.api_prefix)
        response.status_code = 204
        return response

    app.include_router(api)
    return app


app = create_app()
