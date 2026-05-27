"""
MCP Server Registry model.
Each row represents one MCP server connection the platform can use.
"""
import uuid
from datetime import datetime
from sqlalchemy import String, Text, Boolean, JSON, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


def _uuid():
    return str(uuid.uuid4())


class MCPServer(Base):
    __tablename__ = "mcp_servers"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")

    # Transport: "stdio" | "sse" | "websocket"
    transport: Mapped[str] = mapped_column(String(20), default="stdio")

    # For SSE / WebSocket transports
    url: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # For stdio transport
    command: Mapped[str | None] = mapped_column(String(500), nullable=True)   # e.g. "npx"
    args: Mapped[list] = mapped_column(JSON, default=list)                    # e.g. ["-y", "@mcp/server-fs"]
    env: Mapped[dict] = mapped_column(JSON, default=dict)                     # extra env vars

    # Discovered capabilities (populated after connect)
    capabilities: Mapped[dict] = mapped_column(JSON, default=dict)
    # {
    #   "tools": [{"name": ..., "description": ..., "inputSchema": {...}}],
    #   "prompts": [{"name": ..., "description": ...}],
    #   "resources": [{"name": ..., "uri": ..., "mimeType": ...}]
    # }

    # Connection state
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_connected_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="disconnected")  # connected|disconnected|error
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )
