"""
Human-in-the-Loop checkpoint model.
Created when an agent workflow hits a HITL breakpoint node.
"""
import uuid
from datetime import datetime
from sqlalchemy import String, Text, JSON, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


def _uuid():
    return str(uuid.uuid4())


class HITLCheckpoint(Base):
    __tablename__ = "hitl_checkpoints"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)

    run_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    workflow_id: Mapped[str] = mapped_column(String, nullable=False)
    node_id: Mapped[str] = mapped_column(String, nullable=False)

    # The agent that triggered the HITL pause
    agent_id: Mapped[str] = mapped_column(String, nullable=False)
    agent_name: Mapped[str] = mapped_column(String(200), nullable=False)

    # Current conversation context at pause point
    context_snapshot: Mapped[dict] = mapped_column(JSON, default=dict)

    # Question / prompt shown to human reviewer
    prompt: Mapped[str] = mapped_column(Text, default="Please review and approve to continue.")

    # Status: pending | approved | rejected | timeout
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)

    # Human's feedback/instructions
    feedback: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewer: Mapped[str | None] = mapped_column(String(200), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
