from fastapi import APIRouter, Depends
from app.api.auth import router as auth_router
from app.api.agents import router as agents_router
from app.api.workflows import router as workflows_router
from app.api.runs import router as runs_router
from app.api.websocket import router as ws_router
from app.api.mcp import router as mcp_router
from app.api.hitl import router as hitl_router
from app.api.memory_api import router as memory_router
from app.core.security import get_current_user

api_router = APIRouter()

# Public
api_router.include_router(auth_router, prefix="/auth")

# Protected (JWT / API key required)
protected = APIRouter(dependencies=[Depends(get_current_user)])
protected.include_router(agents_router, prefix="/agents")
protected.include_router(workflows_router, prefix="/workflows")
protected.include_router(runs_router, prefix="/runs")
protected.include_router(mcp_router)
protected.include_router(hitl_router)
protected.include_router(memory_router)
api_router.include_router(protected)

# WebSocket (auth handled inside handler)
api_router.include_router(ws_router)
