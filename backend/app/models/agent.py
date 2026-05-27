import uuid
from datetime import datetime
from sqlalchemy import String, Text, Boolean, Integer, Float, JSON, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


def _uuid():
    return str(uuid.uuid4())


class Agent(Base):
    __tablename__ = "agents"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    role: Mapped[str] = mapped_column(String(100), default="assistant")
    system_prompt: Mapped[str] = mapped_column(Text, default="You are a helpful assistant.")
    model: Mapped[str] = mapped_column(String(100), default="gpt-4o-mini")
    temperature: Mapped[float] = mapped_column(Float, default=0.7)
    max_tokens: Mapped[int] = mapped_column(Integer, default=2048)

    # ── Built-in tools ────────────────────────────────────────────────────────
    # List of built-in tool names e.g. ["web_search", "calculator"]
    tools: Mapped[list] = mapped_column(JSON, default=list)

    # ── MCP tool bindings ─────────────────────────────────────────────────────
    # IDs of MCPServer rows whose tools this agent can call
    mcp_server_ids: Mapped[list] = mapped_column(JSON, default=list)
    # Whitelist: if non-empty, only these MCP tool names are permitted
    mcp_tool_whitelist: Mapped[list] = mapped_column(JSON, default=list)

    # ── Memory ────────────────────────────────────────────────────────────────
    memory_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    # "sliding_window" keeps the last N turns; "summary" compresses older turns via LLM
    memory_type: Mapped[str] = mapped_column(String(20), default="sliding_window")
    memory_window: Mapped[int] = mapped_column(Integer, default=10)
    # Max tokens stored before summary compression kicks in
    memory_token_limit: Mapped[int] = mapped_column(Integer, default=4000)

    # ── Human-in-the-Loop ────────────────────────────────────────────────────
    hitl_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    # Pause after every N turns (0 = never auto-pause)
    hitl_every_n_turns: Mapped[int] = mapped_column(Integer, default=0)
    # Timeout in seconds before auto-approving (0 = wait forever)
    hitl_timeout_seconds: Mapped[int] = mapped_column(Integer, default=0)

    # ── A2A / Guardrails ─────────────────────────────────────────────────────
    max_turns: Mapped[int] = mapped_column(Integer, default=20)
    # Semantic similarity threshold for loop detection (0.95 = very similar = loop)
    loop_detection_threshold: Mapped[float] = mapped_column(Float, default=0.95)

    # ── Channel bindings ──────────────────────────────────────────────────────
    channels: Mapped[list] = mapped_column(JSON, default=list)

    # ── Scheduling ────────────────────────────────────────────────────────────
    schedule: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # ── Guardrails ────────────────────────────────────────────────────────────
    guardrails: Mapped[dict] = mapped_column(JSON, default=dict)

    # ── Skills (extra context injected into system prompt) ────────────────────
    skills: Mapped[list] = mapped_column(JSON, default=list)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )
