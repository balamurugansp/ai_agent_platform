import uuid
from datetime import datetime
from sqlalchemy import String, Text, Integer, Float, JSON, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


def _uuid():
    return str(uuid.uuid4())


class WorkflowRun(Base):
    __tablename__ = "workflow_runs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    workflow_id: Mapped[str] = mapped_column(String, ForeignKey("workflows.id"), nullable=False)

    # pending | running | completed | failed | cancelled
    status: Mapped[str] = mapped_column(String(50), default="pending")

    # What triggered this run: api | telegram | schedule
    trigger_source: Mapped[str] = mapped_column(String(50), default="api")
    trigger_data: Mapped[dict] = mapped_column(JSON, default=dict)  # e.g. telegram chat_id

    input_message: Mapped[str] = mapped_column(Text, default="")
    output_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    tokens_used: Mapped[int] = mapped_column(Integer, default=0)
    estimated_cost: Mapped[float] = mapped_column(Float, default=0.0)

    started_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    messages: Mapped[list["RunMessage"]] = relationship(
        "RunMessage", back_populates="run", order_by="RunMessage.created_at"
    )


class RunMessage(Base):
    __tablename__ = "run_messages"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    run_id: Mapped[str] = mapped_column(String, ForeignKey("workflow_runs.id"), nullable=False)

    agent_id: Mapped[str | None] = mapped_column(String, nullable=True)
    agent_name: Mapped[str] = mapped_column(String(200), default="")

    # user | assistant | system | tool | handoff
    role: Mapped[str] = mapped_column(String(50), default="assistant")
    content: Mapped[str] = mapped_column(Text, default="")
    metadata_: Mapped[dict] = mapped_column(JSON, default=dict, name="metadata")

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    run: Mapped["WorkflowRun"] = relationship("WorkflowRun", back_populates="messages")


class AgentMemory(Base):
    """Persisted per-agent conversation context."""
    __tablename__ = "agent_memory"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    agent_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    context_id: Mapped[str] = mapped_column(String, nullable=False, index=True)  # workflow_id or telegram chat_id
    messages: Mapped[list] = mapped_column(JSON, default=list)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )
