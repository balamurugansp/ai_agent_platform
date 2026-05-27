"""
ARB-005: Rate limiting middleware.

Uses slowapi (Starlette-compatible wrapper around limits library).

Limits:
  - Global: RATE_LIMIT_PER_MINUTE requests/IP/minute
  - Workflow runs: RATE_LIMIT_WORKFLOW_PER_MINUTE runs/IP/minute

Usage in routes:
    from app.core.rate_limit import limiter
    from slowapi.errors import RateLimitExceeded

    @router.post("/run")
    @limiter.limit(f"{settings.RATE_LIMIT_WORKFLOW_PER_MINUTE}/minute")
    async def run_workflow(request: Request, ...):
        ...
"""
import logging
from fastapi import Request, Response
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.core.config import settings

logger = logging.getLogger(__name__)


def _get_key(request: Request) -> str:
    """Key function: use real IP, respecting X-Forwarded-For from trusted proxies."""
    forwarded_for = request.headers.get("X-Forwarded-For")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return get_remote_address(request)


# Storage backend: use Redis if available, else in-memory
_storage_uri = settings.REDIS_URL if settings.use_redis else "memory://"

limiter = Limiter(
    key_func=_get_key,
    storage_uri=_storage_uri,
    default_limits=[f"{settings.RATE_LIMIT_PER_MINUTE}/minute"],
    headers_enabled=True,  # adds X-RateLimit-* headers to responses
)


def setup_rate_limiting(app):
    """Call this in main.py to wire rate limiting into the FastAPI app."""
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    app.add_middleware(SlowAPIMiddleware)
    logger.info(
        "Rate limiting enabled: %s req/min global, %s req/min workflows (storage: %s)",
        settings.RATE_LIMIT_PER_MINUTE,
        settings.RATE_LIMIT_WORKFLOW_PER_MINUTE,
        _storage_uri,
    )
