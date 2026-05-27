import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.database import engine, Base
from app.api.router import api_router

logging.basicConfig(
    level=settings.LOG_LEVEL,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Startup ───────────────────────────────────────────────────────────────
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Database tables created/verified.")
    logger.info("DB backend: %s", "PostgreSQL" if settings.use_postgres else "SQLite (dev)")
    logger.info("EventBus backend: %s", "Redis" if settings.use_redis else "in-process asyncio")

    # Seed workflow templates
    try:
        from app.services.workflow_service import seed_templates
        await seed_templates()
    except Exception as e:
        logger.warning("Template seeding failed (non-fatal): %s", e)

    # Start A2A bus
    try:
        from app.core.a2a_bus import a2a_bus
        await a2a_bus.start()
        logger.info("A2A bus started.")
    except Exception as e:
        logger.warning("A2A bus start failed: %s", e)

    # Load active MCP server connections
    try:
        from app.core.mcp_client import mcp_manager
        from app.core.database import async_session_factory
        from app.models.mcp_server import MCPServer
        from sqlalchemy import select
        async with async_session_factory() as session:
            result = await session.execute(
                select(MCPServer).where(MCPServer.is_active == True)
            )
            servers = [
                {"id": s.id, "transport": s.transport, "url": s.url,
                 "command": s.command, "args": s.args, "env": s.env}
                for s in result.scalars().all()
            ]
        if servers:
            statuses = await mcp_manager.reload_all(servers)
            logger.info("MCP servers loaded: %s", statuses)
    except Exception as e:
        logger.warning("MCP server startup load failed (non-fatal): %s", e)

    # Start Telegram bot
    telegram_task = None
    if settings.TELEGRAM_BOT_TOKEN:
        try:
            from app.channels.telegram import telegram_bot
            telegram_task = asyncio.create_task(telegram_bot.start())
            logger.info("Telegram bot started.")
        except Exception as e:
            logger.warning("Telegram bot start failed (non-fatal): %s", e)

    yield

    # ── Shutdown ──────────────────────────────────────────────────────────────
    from app.core.a2a_bus import a2a_bus
    await a2a_bus.stop()
    if telegram_task:
        telegram_task.cancel()

    from app.core.events import event_bus
    await event_bus.close()
    await engine.dispose()
    logger.info("Shutdown complete.")


app = FastAPI(
    title="Yuno AI Agent Platform",
    version="2.0.0",
    description="Multi-agent orchestration platform with MCP, A2A, memory, and HITL support",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Rate limiting
from app.core.rate_limit import setup_rate_limiting
setup_rate_limiting(app)

# Tracing
from app.core.tracing import setup_tracing
setup_tracing(app, "yuno-platform")

app.include_router(api_router, prefix="/api")


@app.get("/health")
async def health():
    from app.core.mcp_client import mcp_manager
    return {
        "status": "ok",
        "version": "2.0.0",
        "environment": settings.ENVIRONMENT,
        "database": "postgresql" if settings.use_postgres else "sqlite",
        "event_bus": "redis" if settings.use_redis else "in-process",
        "mcp_servers_connected": mcp_manager.connected_count,
    }
