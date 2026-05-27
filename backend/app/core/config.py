"""
ARB-004 / ARB-008: Centralised, validated settings.

All secrets are loaded from environment variables or .env file.
Never hardcode secrets — override via environment in production.

Production checklist:
  - SECRET_KEY: generate with `openssl rand -hex 32`
  - ADMIN_PASSWORD: strong password
  - API_KEYS: comma-separated random UUIDs
  - DATABASE_URL: postgresql+asyncpg://user:pass@host/db
  - REDIS_URL: redis://:password@host:6379/0
  - TELEGRAM_BOT_TOKEN: from @BotFather
  - OPENAI_API_KEY: from platform.openai.com
"""
from typing import List
from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # App
    APP_NAME: str = "Yuno AI Agent Orchestration Platform"
    VERSION: str = "1.0.0"
    LOG_LEVEL: str = "INFO"
    ENVIRONMENT: str = "development"  # development | staging | production

    # Database (ARB-002) — swap to postgresql+asyncpg://... for production
    DATABASE_URL: str = "sqlite+aiosqlite:///./yuno.db"

    # Redis / EventBus (ARB-003) — leave empty to use in-process fallback
    REDIS_URL: str = ""

    # Security (ARB-001) — generate: openssl rand -hex 32
    SECRET_KEY: str = "dev-secret-key-CHANGE-IN-PRODUCTION-use-openssl-rand-hex-32"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480  # 8 hours

    # Admin credentials
    ADMIN_USERNAME: str = "admin"
    ADMIN_PASSWORD: str = "changeme"

    # Comma-separated API keys for service-to-service auth
    API_KEYS: str = ""

    # CORS
    CORS_ORIGINS: str = "http://localhost:5173,http://localhost:3000"

    @property
    def cors_origins_list(self) -> List[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    # LLM
    OPENAI_API_KEY: str = ""
    DEFAULT_MODEL: str = "gpt-4o-mini"

    # Telegram (ARB-008) — never commit to source control
    TELEGRAM_BOT_TOKEN: str = ""

    # Rate limiting (ARB-005)
    RATE_LIMIT_PER_MINUTE: int = 100
    RATE_LIMIT_WORKFLOW_PER_MINUTE: int = 10

    # Observability (ARB-006)
    OTLP_ENDPOINT: str = ""
    ENABLE_TRACING: bool = False

    @model_validator(mode="after")
    def warn_insecure_defaults(self) -> "Settings":
        import logging
        log = logging.getLogger(__name__)
        if self.ENVIRONMENT == "production":
            if "CHANGE-IN-PRODUCTION" in self.SECRET_KEY:
                raise ValueError(
                    "SECRET_KEY must be changed from the default in production! "
                    "Run: openssl rand -hex 32"
                )
            if self.ADMIN_PASSWORD == "changeme":
                raise ValueError(
                    "ADMIN_PASSWORD must be changed from the default in production!"
                )
        else:
            if "CHANGE-IN-PRODUCTION" in self.SECRET_KEY:
                log.warning("Using default SECRET_KEY — set SECRET_KEY in .env before deploying.")
            if self.ADMIN_PASSWORD == "changeme":
                log.warning("Using default ADMIN_PASSWORD — set ADMIN_PASSWORD in .env before deploying.")
        return self

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT == "production"

    @property
    def use_redis(self) -> bool:
        return bool(self.REDIS_URL)

    @property
    def use_postgres(self) -> bool:
        return self.DATABASE_URL.startswith("postgresql")


settings = Settings()
