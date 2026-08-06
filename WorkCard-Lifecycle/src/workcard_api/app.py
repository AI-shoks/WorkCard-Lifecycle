from __future__ import annotations

import logging
import time
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping
from contextlib import asynccontextmanager
from typing import Annotated, Any, Literal, cast
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, FastAPI, Header, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.openapi.utils import get_openapi
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, StrictInt, ValidationError
from starlette.concurrency import run_in_threadpool
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
from workcard_api.permissions import has_permission
from workcard_api.postgres_production_batches import PostgresCreateProductionBatchGateway
from workcard_api.postgres_release_work_cards import PostgresReleaseWorkCardsGateway
from workcard_api.production_batches import (
    BATCH_CREATE_PERMISSION,
    CommandAlreadyProcessed,
    CommandIdReused,
    ConcurrentCommandConflict,
    CreateProductionBatchCommand,
    CreateProductionBatchFailure,
    CreateProductionBatchGateway,
    CreateProductionBatchHandler,
    CreateProductionBatchResult,
    PermissionDenied,
    ProductionBatchInvalid,
    ProductionPassportNotFound,
    TrustedActor,
    UnexpectedPersistenceFailure,
)
from workcard_api.release_work_cards import (
    MAX_POSTGRES_INTEGER,
    RELEASE_WORK_CARDS_PERMISSION,
    BatchAlreadyReleased,
    ProductionBatchNotFound,
    ReleaseWorkCardsCommand,
    ReleaseWorkCardsFailure,
    ReleaseWorkCardsGateway,
    ReleaseWorkCardsHandler,
    ReleaseWorkCardsResult,
    VersionConflict,
)
from workcard_api.release_work_cards import (
    CommandAlreadyProcessed as ReleaseCommandAlreadyProcessed,
)
from workcard_api.release_work_cards import (
    CommandIdReused as ReleaseCommandIdReused,
)
from workcard_api.release_work_cards import (
    ConcurrentCommandConflict as ReleaseConcurrentCommandConflict,
)
from workcard_api.release_work_cards import (
    PermissionDenied as ReleasePermissionDenied,
)
from workcard_api.release_work_cards import (
    ProductionBatchInvalid as ReleaseProductionBatchInvalid,
)
from workcard_api.release_work_cards import (
    UnexpectedPersistenceFailure as ReleaseUnexpectedPersistenceFailure,
)

LOGGER = logging.getLogger("workcard_api.http")
CANONICAL_LOWERCASE_UUID_PATTERN = r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
SESSION_AUTHENTICATION_CHALLENGE = 'WorkcardSession realm="workcard-api"'


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


class CreateProductionBatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    productionPassportId: UUID
    quantity: StrictInt


class OperationScopeResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    displayName: str


class OperationPlanResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    operationPlanId: UUID
    position: int
    operationScope: OperationScopeResponse
    normHours: str
    plannedCardCount: int


class ProductionPassportSnapshotResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    productionPassportId: UUID
    code: str
    revision: str
    productName: str
    operationPlans: list[OperationPlanResponse]


class CreateProductionBatchDataResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    batchId: UUID
    productionPassportId: UUID
    quantity: int
    lifecycleStatus: Literal["CREATED"]
    version: Literal[1]
    passportSnapshot: ProductionPassportSnapshotResponse


class CommandMetaResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    commandId: UUID
    correlationId: UUID
    replayed: Literal[False]


class CreateProductionBatchResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: CreateProductionBatchDataResponse
    meta: CommandMetaResponse


class ReleaseWorkCardsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expectedVersion: StrictInt


class ReleaseWorkCardSetResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    setId: UUID
    operationPlanId: UUID
    position: int
    operationScope: OperationScopeResponse
    normHours: str
    plannedCardCount: int
    gateStatus: Literal["FIRST_ARTICLE_PENDING"]
    version: Literal[1]


class ReleaseWorkCardsDataResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    batchId: UUID
    lifecycleStatus: Literal["RELEASED"]
    version: Literal[2]
    setCount: int
    cardCountTotal: int
    workCardSets: list[ReleaseWorkCardSetResponse]


class ReleaseWorkCardsResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: ReleaseWorkCardsDataResponse
    meta: CommandMetaResponse


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


def problem_response(
    problem: Problem,
    trace_id: str,
    headers: Mapping[str, str] | None = None,
) -> JSONResponse:
    return JSONResponse(
        status_code=problem.status,
        content=problem.body(trace_id),
        media_type="application/problem+json",
        headers=headers,
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


def create_production_batch_response(
    result: CreateProductionBatchResult,
) -> CreateProductionBatchResponse:
    return CreateProductionBatchResponse(
        data=CreateProductionBatchDataResponse(
            batchId=result.batch_id,
            productionPassportId=result.production_passport_id,
            quantity=result.quantity,
            lifecycleStatus=result.lifecycle_status,
            version=result.version,
            passportSnapshot=ProductionPassportSnapshotResponse.model_validate(
                result.passport_snapshot.to_json()
            ),
        ),
        meta=CommandMetaResponse(
            commandId=result.command_id,
            correlationId=result.correlation_id,
            replayed=result.replayed,
        ),
    )


def release_work_cards_response(result: ReleaseWorkCardsResult) -> ReleaseWorkCardsResponse:
    return ReleaseWorkCardsResponse(
        data=ReleaseWorkCardsDataResponse(
            batchId=result.batch_id,
            lifecycleStatus=result.lifecycle_status,
            version=result.version,
            setCount=result.set_count,
            cardCountTotal=result.card_count_total,
            workCardSets=[
                ReleaseWorkCardSetResponse(
                    setId=item.set_id,
                    operationPlanId=item.operation_plan_id,
                    position=item.position,
                    operationScope=OperationScopeResponse.model_validate(item.operation_scope),
                    normHours=item.norm_hours,
                    plannedCardCount=item.planned_card_count,
                    gateStatus=item.gate_status,
                    version=item.version,
                )
                for item in result.work_card_sets
            ],
        ),
        meta=CommandMetaResponse(
            commandId=result.command_id,
            correlationId=result.correlation_id,
            replayed=result.replayed,
        ),
    )


async def validated_create_production_batch_request(
    request: Request,
) -> CreateProductionBatchRequest:
    media_type = request.headers.get("content-type", "").partition(";")[0].strip().lower()
    if media_type != "application/json":
        raise RequestValidationError(
            [
                {
                    "type": "json_type",
                    "loc": ("body",),
                    "msg": "Input should be valid JSON with application/json content type",
                    "input": None,
                }
            ]
        )
    body = await request.body()
    try:
        return CreateProductionBatchRequest.model_validate_json(body)
    except ValidationError as error:
        errors = [{**item, "loc": ("body", *item["loc"])} for item in error.errors()]
        raise RequestValidationError(errors, body=body) from error


async def validated_release_work_cards_request(request: Request) -> ReleaseWorkCardsRequest:
    media_type = request.headers.get("content-type", "").partition(";")[0].strip().lower()
    if media_type != "application/json":
        raise RequestValidationError(
            [
                {
                    "type": "json_type",
                    "loc": ("body",),
                    "msg": "Input should be valid JSON with application/json content type",
                    "input": None,
                }
            ]
        )
    body = await request.body()
    try:
        return ReleaseWorkCardsRequest.model_validate_json(body)
    except ValidationError as error:
        errors = [{**item, "loc": ("body", *item["loc"])} for item in error.errors()]
        raise RequestValidationError(errors, body=body) from error


def validated_release_batch_id(value: str) -> UUID:
    try:
        batch_id = UUID(value)
    except ValueError as error:
        raise _release_batch_id_validation_error(value) from error
    if value != str(batch_id):
        raise _release_batch_id_validation_error(value)
    return batch_id


def _release_batch_id_validation_error(value: str) -> RequestValidationError:
    return RequestValidationError(
        [
            {
                "type": "uuid_parsing",
                "loc": ("path", "batchId"),
                "msg": "Input should be a lowercase canonical UUID",
                "input": value,
            }
        ]
    )


def authentication_required_problem() -> Problem:
    return Problem(
        status=401,
        code="AUTHENTICATION_REQUIRED",
        title="Требуется аутентификация",
        detail="Выберите подготовленную демонстрационную роль.",
        type_slug="authentication-required",
    )


def permission_denied_problem() -> Problem:
    return Problem(
        status=403,
        code="PERMISSION_DENIED",
        title="Недостаточно прав",
        detail="Текущая роль не может выполнить это действие.",
        type_slug="permission-denied",
    )


def create_production_batch_problem(error: CreateProductionBatchFailure) -> Problem:
    if isinstance(error, PermissionDenied):
        return permission_denied_problem()
    if isinstance(error, ProductionPassportNotFound):
        return Problem(
            status=404,
            code="RESOURCE_NOT_FOUND",
            title="Ресурс не найден",  # noqa: RUF001 - intentional Russian UI copy
            detail="Выбранный производственный паспорт не найден.",
            type_slug="resource-not-found",
        )
    if isinstance(error, CommandAlreadyProcessed):
        return Problem(
            status=409,
            code="COMMAND_ALREADY_PROCESSED",
            title="Команда уже обработана",
            detail="Создайте новую команду для повторного действия.",
            type_slug="command-already-processed",
        )
    if isinstance(error, CommandIdReused):
        return Problem(
            status=409,
            code="COMMAND_ID_REUSED",
            title="Идентификатор команды уже использован",
            detail="Повторите действие с новым идентификатором команды.",  # noqa: RUF001
            type_slug="command-id-reused",
        )
    if isinstance(error, ConcurrentCommandConflict):
        return Problem(
            status=409,
            code="CONCURRENT_MODIFICATION",
            title="Конкурирующее изменение",
            detail="Обновите данные и повторите действие.",
            type_slug="concurrent-modification",
        )
    if isinstance(error, ProductionBatchInvalid):
        return Problem(
            status=422,
            code="PRODUCTION_BATCH_INVALID",
            title="Партия не может быть создана",
            detail="Проверьте количество и выбранный производственный паспорт.",
            type_slug="production-batch-invalid",
        )
    if isinstance(error, UnexpectedPersistenceFailure):
        return Problem(
            status=500,
            code="INTERNAL_ERROR",
            title="Внутренняя ошибка",
            detail="Повторите запрос позднее.",
            type_slug="internal-error",
        )
    return Problem(
        status=500,
        code="INTERNAL_ERROR",
        title="Внутренняя ошибка",
        detail="Повторите запрос позднее.",
        type_slug="internal-error",
    )


def release_work_cards_problem(error: ReleaseWorkCardsFailure) -> Problem:
    if isinstance(error, ReleasePermissionDenied):
        return permission_denied_problem()
    if isinstance(error, ProductionBatchNotFound):
        return Problem(
            status=404,
            code="RESOURCE_NOT_FOUND",
            title="Ресурс не найден",  # noqa: RUF001 - intentional Russian UI copy
            detail="Выбранная производственная партия не найдена.",
            type_slug="resource-not-found",
        )
    if isinstance(error, ReleaseCommandAlreadyProcessed):
        return Problem(
            status=409,
            code="COMMAND_ALREADY_PROCESSED",
            title="Команда уже обработана",
            detail="Создайте новую команду для повторного действия.",
            type_slug="command-already-processed",
        )
    if isinstance(error, ReleaseCommandIdReused):
        return Problem(
            status=409,
            code="COMMAND_ID_REUSED",
            title="Идентификатор команды уже использован",
            detail="Повторите действие с новым идентификатором команды.",  # noqa: RUF001
            type_slug="command-id-reused",
        )
    if isinstance(error, BatchAlreadyReleased):
        return Problem(
            status=409,
            code="BATCH_ALREADY_RELEASED",
            title="Карточки уже выпущены",
            detail="Повторный выпуск карточек для этой партии запрещён.",
            type_slug="batch-already-released",
        )
    if isinstance(error, VersionConflict):
        return Problem(
            status=409,
            code="VERSION_CONFLICT",
            title="Данные изменились",
            detail="Обновите данные партии и повторите действие новой командой.",
            type_slug="version-conflict",
        )
    if isinstance(error, ReleaseConcurrentCommandConflict):
        return Problem(
            status=409,
            code="CONCURRENT_MODIFICATION",
            title="Конкурирующее изменение",
            detail="Обновите данные и повторите действие.",
            type_slug="concurrent-modification",
        )
    if isinstance(error, ReleaseProductionBatchInvalid):
        return Problem(
            status=422,
            code="PRODUCTION_BATCH_INVALID",
            title="Карточки не могут быть выпущены",
            detail="Проверьте данные партии и её производственного паспорта.",
            type_slug="production-batch-invalid",
        )
    if isinstance(error, ReleaseUnexpectedPersistenceFailure):
        return Problem(
            status=500,
            code="INTERNAL_ERROR",
            title="Внутренняя ошибка",
            detail="Повторите запрос позднее.",
            type_slug="internal-error",
        )
    return Problem(
        status=500,
        code="INTERNAL_ERROR",
        title="Внутренняя ошибка",
        detail="Повторите запрос позднее.",
        type_slug="internal-error",
    )


def create_app(
    settings: Settings | None = None,
    database: DatabaseGateway | None = None,
    create_batch_gateway: CreateProductionBatchGateway | None = None,
    release_work_cards_gateway: ReleaseWorkCardsGateway | None = None,
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
    batch_gateway = create_batch_gateway or PostgresCreateProductionBatchGateway(
        cast(PostgresDatabase, db)
    )
    create_batch_handler = CreateProductionBatchHandler(batch_gateway)
    release_gateway = release_work_cards_gateway or PostgresReleaseWorkCardsGateway(
        cast(PostgresDatabase, db)
    )
    release_work_cards_handler = ReleaseWorkCardsHandler(release_gateway)
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
        components = schema.setdefault("components", {})
        components.setdefault("schemas", {})["CreateProductionBatchRequest"] = (
            CreateProductionBatchRequest.model_json_schema(
                ref_template="#/components/schemas/{model}"
            )
        )
        release_request_schema = ReleaseWorkCardsRequest.model_json_schema(
            ref_template="#/components/schemas/{model}"
        )
        release_request_schema["properties"]["expectedVersion"].update(
            {"minimum": 1, "maximum": MAX_POSTGRES_INTEGER}
        )
        components.setdefault("schemas", {})["ReleaseWorkCardsRequest"] = release_request_schema
        components.setdefault("securitySchemes", {})["SessionCookie"] = {
            "type": "apiKey",
            "in": "cookie",
            "name": COOKIE_NAME,
        }
        create_batch_operation = schema["paths"][f"{app_settings.api_prefix}/production-batches"][
            "post"
        ]
        create_batch_operation.setdefault("parameters", []).extend(
            [
                {
                    "name": "Origin",
                    "in": "header",
                    "required": True,
                    "schema": {"type": "string", "title": "Origin"},
                },
                {
                    "name": CSRF_HEADER,
                    "in": "header",
                    "required": True,
                    "schema": {"type": "string", "title": CSRF_HEADER},
                },
            ]
        )
        create_batch_operation["requestBody"] = {
            "required": True,
            "content": {
                "application/json": {
                    "schema": {"$ref": "#/components/schemas/CreateProductionBatchRequest"}
                }
            },
        }
        release_operation = schema["paths"][
            f"{app_settings.api_prefix}/production-batches/{{batchId}}/actions/release-work-cards"
        ]["post"]
        release_operation.setdefault("parameters", []).extend(
            [
                {
                    "name": "Origin",
                    "in": "header",
                    "required": True,
                    "schema": {"type": "string", "title": "Origin"},
                },
                {
                    "name": CSRF_HEADER,
                    "in": "header",
                    "required": True,
                    "schema": {"type": "string", "title": CSRF_HEADER},
                },
            ]
        )
        for parameter in release_operation["parameters"]:
            if parameter.get("name") == "batchId" and parameter.get("in") == "path":
                parameter["schema"].update(
                    {
                        "format": "uuid",
                        "pattern": CANONICAL_LOWERCASE_UUID_PATTERN,
                    }
                )
        release_operation["requestBody"] = {
            "required": True,
            "content": {
                "application/json": {
                    "schema": {"$ref": "#/components/schemas/ReleaseWorkCardsRequest"}
                }
            },
        }
        session_authenticated_operations = (
            schema["paths"][f"{app_settings.api_prefix}/session/demo"]["put"],
            schema["paths"][f"{app_settings.api_prefix}/session"]["get"],
            schema["paths"][f"{app_settings.api_prefix}/session"]["delete"],
            create_batch_operation,
            release_operation,
        )
        for operation in session_authenticated_operations:
            operation["security"] = [{"SessionCookie": []}]
            operation["responses"]["401"]["headers"] = {
                "WWW-Authenticate": {
                    "description": "Project-defined cookie session authentication challenge",
                    "schema": {
                        "type": "string",
                        "const": SESSION_AUTHENTICATION_CHALLENGE,
                    },
                }
            }
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
        headers = (
            {"WWW-Authenticate": SESSION_AUTHENTICATION_CHALLENGE}
            if error.problem.status == 401
            else None
        )
        return problem_response(error.problem, request_id(request), headers=headers)

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
        response_headers = None
        if error.status_code == 405 and error.headers is not None:
            for header_name, header_value in error.headers.items():
                if header_name.lower() == "allow":
                    response_headers = {"Allow": header_value}
                    break
        return problem_response(problem, request_id(request), headers=response_headers)

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

    def trusted_create_batch_actor(request: Request) -> TrustedActor:
        try:
            current, identity = authenticated_identity(request, sessions, db)
        except ProblemError as error:
            if error.problem.status != 401:
                raise
            raise ProblemError(authentication_required_problem()) from error
        if identity.role != "PLANNER" or not has_permission(identity.role, BATCH_CREATE_PERMISSION):
            raise ProblemError(permission_denied_problem())
        validate_origin(request, app_settings)
        sessions.verify_csrf(current, request.headers.get(CSRF_HEADER))
        return TrustedActor(actor_id=identity.id, role=identity.role)

    @api.post(
        "/production-batches",
        status_code=201,
        response_model=CreateProductionBatchResponse,
        responses={
            201: {
                "description": "Production batch created",
                "headers": {
                    "ETag": {
                        "description": "Version of the created production batch",
                        "schema": {"type": "string", "example": '"v1"'},
                    }
                },
            },
            **problem_responses(400, 401, 403, 404, 405, 409, 422, 500),
        },
        tags=["production-batches"],
    )
    async def create_production_batch(
        request: Request,
        response: Response,
        command_id: Annotated[UUID, Header(alias="X-Command-Id")],
        actor: TrustedActor = Depends(trusted_create_batch_actor),  # noqa: B008
    ) -> CreateProductionBatchResponse:
        payload = await validated_create_production_batch_request(request)
        command = CreateProductionBatchCommand(
            command_id=command_id,
            production_passport_id=payload.productionPassportId,
            quantity=payload.quantity,
        )
        try:
            result = await run_in_threadpool(create_batch_handler.handle, actor, command)
        except CreateProductionBatchFailure as error:
            raise ProblemError(create_production_batch_problem(error)) from error
        response.headers["ETag"] = f'"v{result.version}"'
        return create_production_batch_response(result)

    def trusted_release_work_cards_actor(request: Request) -> TrustedActor:
        try:
            current, identity = authenticated_identity(request, sessions, db)
        except ProblemError as error:
            if error.problem.status != 401:
                raise
            raise ProblemError(authentication_required_problem()) from error
        sessions.verify_csrf(current, request.headers.get(CSRF_HEADER))
        if identity.role != "PLANNER" or not has_permission(
            identity.role, RELEASE_WORK_CARDS_PERMISSION
        ):
            raise ProblemError(permission_denied_problem())
        validate_origin(request, app_settings)
        return TrustedActor(actor_id=identity.id, role=identity.role)

    @api.post(
        "/production-batches/{batchId}/actions/release-work-cards",
        status_code=200,
        response_model=ReleaseWorkCardsResponse,
        responses={
            200: {
                "description": "Work cards released",
                "headers": {
                    "ETag": {
                        "description": "Version of the released production batch",
                        "schema": {"type": "string", "example": '"v2"'},
                    }
                },
            },
            **problem_responses(400, 401, 403, 404, 405, 409, 422, 500),
        },
        tags=["production-batches"],
    )
    async def release_work_cards(
        request: Request,
        response: Response,
        batchId: str,
        command_id: Annotated[UUID, Header(alias="X-Command-Id")],
        actor: TrustedActor = Depends(trusted_release_work_cards_actor),  # noqa: B008
    ) -> ReleaseWorkCardsResponse:
        batch_id = validated_release_batch_id(batchId)
        payload = await validated_release_work_cards_request(request)
        command = ReleaseWorkCardsCommand(
            command_id=command_id,
            batch_id=batch_id,
            expected_version=payload.expectedVersion,
        )
        try:
            result = await run_in_threadpool(release_work_cards_handler.handle, actor, command)
        except ReleaseWorkCardsFailure as error:
            raise ProblemError(release_work_cards_problem(error)) from error
        response.headers["ETag"] = f'"v{result.version}"'
        return release_work_cards_response(result)

    app.include_router(api)
    return app


app = create_app()
