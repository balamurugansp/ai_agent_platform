"""
Persistent agent memory — stores conversation turns per agent per run context.
"""
import uuid
from datetime import datetime
from sqlalchemy import String, Text, Integer, JSON, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


def _uuid():
    return str(uuid.uuid4())


class AgentMemory(Base):
    __tablename__ = "agent_memories"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)

    # Scope: agent + conversation_key (workflow_id or channel chat_id)
    agent_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    conversation_key: Mapped[str] = mapped_column(String(200), nullable=False, index=True)

    # Role: "human" | "assistant" | "tool" | "summary"
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)

    # Token count for this message
    token_count: Mapped[int] = mapped_column(Integer, default=0)

    # Sequence number within conversation
    seq: Mapped[int] = mapped_column(Integer, default=0)

    # Summary metadata (when role == "summary")
    summary_metadata: Mapped[dict] = mapped_column(JSON, default=dict)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
