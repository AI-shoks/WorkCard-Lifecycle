from __future__ import annotations

from functools import lru_cache
from typing import Literal, Self

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

Environment = Literal["local", "test", "staging", "production"]


class Settings(BaseSettings):
    """Validated process configuration loaded only from WORKCARD_* variables."""

    model_config = SettingsConfigDict(
        env_prefix="WORKCARD_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    environment: Environment = "local"
    app_name: str = "Production Work Card Workflow"
    api_prefix: str = "/api/v1"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"
    database_url: SecretStr
    migration_database_url: SecretStr | None = None
    database_pool_min_size: int = Field(default=1, ge=1, le=20)
    database_pool_max_size: int = Field(default=5, ge=1, le=50)
    database_timeout_seconds: float = Field(default=2.0, gt=0, le=30)
    session_signing_secret: SecretStr
    session_ttl_seconds: int = Field(default=1800, ge=60, le=86400)
    allowed_origins: list[str] = Field(default_factory=lambda: ["http://localhost:8000"])
    cookie_secure: bool = False
    metrics_enabled: bool = True

    @field_validator("session_signing_secret")
    @classmethod
    def validate_signing_secret(cls, value: SecretStr) -> SecretStr:
        secret = value.get_secret_value()
        if len(secret) < 32 or secret.startswith("REPLACE_"):
            raise ValueError(
                "session signing secret must contain at least 32 non-placeholder chars"
            )
        return value

    @field_validator("database_pool_max_size")
    @classmethod
    def validate_pool_size(cls, value: int, info: object) -> int:
        data = getattr(info, "data", {})
        minimum = data.get("database_pool_min_size", 1)
        if value < minimum:
            raise ValueError("database_pool_max_size must be >= database_pool_min_size")
        return value

    @field_validator("allowed_origins")
    @classmethod
    def validate_origins(cls, value: list[str]) -> list[str]:
        if not value or any(origin == "*" for origin in value):
            raise ValueError("allowed_origins must be an explicit non-empty allowlist")
        return value

    @model_validator(mode="after")
    def validate_deployed_cookie_and_origins(self) -> Self:
        if self.environment in {"staging", "production"}:
            if not self.cookie_secure:
                raise ValueError("cookie_secure must be enabled outside local/test")
            if any(not origin.startswith("https://") for origin in self.allowed_origins):
                raise ValueError("staging/production origins must use https")
        return self

    @property
    def database_dsn(self) -> str:
        return self.database_url.get_secret_value()

    @property
    def migration_database_dsn(self) -> str:
        configured = self.migration_database_url
        if configured is None:
            raise RuntimeError("WORKCARD_MIGRATION_DATABASE_URL is required for migrations")
        return configured.get_secret_value()


@lru_cache
def get_settings() -> Settings:
    return Settings()
