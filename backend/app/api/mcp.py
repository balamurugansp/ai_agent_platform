"""
MCP Server Registry API.
Manage MCP server connections and discover/execute their capabilities.
"""
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.mcp_client import mcp_manager
from app.models.mcp_server import MCPServer

router = APIRouter(prefix="/mcp", tags=["mcp"])


# ─── Schemas ─────────────────────────────────────────────────────────────────

class MCPServerCreate(BaseModel):
    name: str
    description: str = ""
    transport: str = Field("stdio", pattern="^(stdio|sse|websocket)$")
    url: str | None = None
    command: str | None = None
    args: list = []
    env: dict = {}
    is_active: bool = True


class MCPServerUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    transport: str | None = None
    url: str | None = None
    command: str | None = None
    args: list | None = None
    env: dict | None = None
    is_active: bool | None = None


class MCPServerResponse(BaseModel):
    id: str
    name: str
    description: str
    transport: str
    url: str | None
    command: str | None
    args: list
    env: dict
    capabilities: dict
    is_active: bool
    status: str
    error_message: str | None
    last_connected_at: datetime | None
    created_at: datetime

    class Config:
        from_attributes = True


class ToolCallRequest(BaseModel):
    server_id: str
    tool_name: str
    arguments: dict = {}


class PromptGetRequest(BaseModel):
    server_id: str
    prompt_name: str
    arguments: dict = {}


class ResourceReadRequest(BaseModel):
    server_id: str
    resource_uri: str


# ─── CRUD endpoints ───────────────────────────────────────────────────────────

@router.get("/servers", response_model=list[MCPServerResponse])
async def list_servers(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(MCPServer).order_by(MCPServer.created_at.desc()))
    return result.scalars().all()


@router.post("/servers", response_model=MCPServerResponse, status_code=201)
async def create_server(data: MCPServerCreate, db: AsyncSession = Depends(get_db)):
    srv = MCPServer(**data.model_dump())
    db.add(srv)
    await db.commit()
    await db.refresh(srv)
    return srv


@router.get("/servers/{server_id}", response_model=MCPServerResponse)
async def get_server(server_id: str, db: AsyncSession = Depends(get_db)):
    srv = await db.get(MCPServer, server_id)
    if not srv:
        raise HTTPException(404, "MCP server not found")
    return srv


@router.patch("/servers/{server_id}", response_model=MCPServerResponse)
async def update_server(
    server_id: str, data: MCPServerUpdate, db: AsyncSession = Depends(get_db)
):
    srv = await db.get(MCPServer, server_id)
    if not srv:
        raise HTTPException(404, "MCP server not found")
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(srv, field, value)
    await db.commit()
    await db.refresh(srv)
    return srv


@router.delete("/servers/{server_id}", status_code=204)
async def delete_server(server_id: str, db: AsyncSession = Depends(get_db)):
    srv = await db.get(MCPServer, server_id)
    if not srv:
        raise HTTPException(404, "MCP server not found")
    await mcp_manager.disconnect(server_id)
    await db.delete(srv)
    await db.commit()


# ─── Connection management ────────────────────────────────────────────────────

@router.post("/servers/{server_id}/connect")
async def connect_server(server_id: str, db: AsyncSession = Depends(get_db)):
    """Connect (or reconnect) to an MCP server and discover its capabilities."""
    srv = await db.get(MCPServer, server_id)
    if not srv:
        raise HTTPException(404, "MCP server not found")

    srv_dict = {
        "id": srv.id, "transport": srv.transport, "url": srv.url,
        "command": srv.command, "args": srv.args, "env": srv.env,
    }

    try:
        capabilities = await mcp_manager.connect(srv_dict)
        srv.capabilities = capabilities
        srv.status = "connected"
        srv.last_connected_at = datetime.utcnow()
        srv.error_message = None
    except Exception as e:
        srv.status = "error"
        srv.error_message = str(e)
        await db.commit()
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"MCP connect failed: {e}")

    await db.commit()
    await db.refresh(srv)
    return {"status": "connected", "capabilities": capabilities}


@router.post("/servers/{server_id}/disconnect")
async def disconnect_server(server_id: str, db: AsyncSession = Depends(get_db)):
    await mcp_manager.disconnect(server_id)
    srv = await db.get(MCPServer, server_id)
    if srv:
        srv.status = "disconnected"
        await db.commit()
    return {"status": "disconnected"}


# ─── Capability execution ─────────────────────────────────────────────────────

@router.post("/tools/call")
async def call_tool(req: ToolCallRequest) -> dict:
    """Execute an MCP tool directly from the UI."""
    session = mcp_manager.get_session(req.server_id)
    if not session:
        raise HTTPException(400, "MCP server not connected. Connect it first.")
    try:
        result = await session.call_tool(req.tool_name, req.arguments)
        return {"result": result}
    except Exception as e:
        raise HTTPException(500, f"Tool execution error: {e}")


@router.post("/prompts/get")
async def get_prompt(req: PromptGetRequest) -> dict:
    """Retrieve a prompt template from an MCP server."""
    session = mcp_manager.get_session(req.server_id)
    if not session:
        raise HTTPException(400, "MCP server not connected")
    try:
        result = await session.get_prompt(req.prompt_name, req.arguments)
        return {"prompt": result}
    except Exception as e:
        raise HTTPException(500, f"Prompt retrieval error: {e}")


@router.post("/resources/read")
async def read_resource(req: ResourceReadRequest) -> dict:
    """Read a resource from an MCP server."""
    session = mcp_manager.get_session(req.server_id)
    if not session:
        raise HTTPException(400, "MCP server not connected")
    try:
        result = await session.read_resource(req.resource_uri)
        return {"content": result}
    except Exception as e:
        raise HTTPException(500, f"Resource read error: {e}")


@router.get("/dlq")
async def get_dead_letter_queue() -> dict:
    """Return messages that failed permanent delivery."""
    from app.core.a2a_bus import dead_letter_queue
    return {"messages": dead_letter_queue.list()}


@router.delete("/dlq")
async def clear_dead_letter_queue() -> dict:
    from app.core.a2a_bus import dead_letter_queue
    dead_letter_queue.clear()
    return {"cleared": True}
