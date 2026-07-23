from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel, ConfigDict


class ProblemFieldError(BaseModel):
    model_config = ConfigDict(extra="forbid")

    path: str
    message: str


class ProblemDetails(BaseModel):
    """Machine-readable error response shared by runtime and OpenAPI."""

    model_config = ConfigDict(extra="forbid")

    type: str
    title: str
    status: int
    code: str
    detail: str
    traceId: str
    errors: list[ProblemFieldError]


@dataclass(slots=True)
class Problem:
    status: int
    code: str
    title: str
    detail: str
    type_slug: str
    errors: list[ProblemFieldError] = field(default_factory=list)

    def body(self, trace_id: str) -> dict[str, Any]:
        details = ProblemDetails(
            type=f"https://workcard.example/problems/{self.type_slug}",
            title=self.title,
            status=self.status,
            code=self.code,
            detail=self.detail,
            traceId=trace_id,
            errors=self.errors,
        )
        return details.model_dump(mode="json")


class ProblemError(Exception):
    def __init__(self, problem: Problem) -> None:
        super().__init__(problem.code)
        self.problem = problem
