import uuid
from datetime import datetime
from sqlalchemy import String, Text, Boolean, Integer, JSON, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


def _uuid():
    return str(uuid.uuid4())


class Workflow(Base):
    __tablename__ = "workflows"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")

    # ReactFlow-compatible node list
    # Node types: "agent" | "router" | "hitl" | "start" | "end"
    # Each node: {id, type, agent_id?, position: {x,y}, data: {label, config, ...}}
    nodes: Mapped[list] = mapped_column(JSON, default=list)

    # Edge list: {id, source, target, condition, label, sourceHandle, targetHandle}
    edges: Mapped[list] = mapped_column(JSON, default=list)

    # Node id to start at
    entry_point: Mapped[str] = mapped_column(String(100), default="")

    # A2A message delivery config
    # "at_least_once" (default) | "exactly_once"
    delivery_guarantee: Mapped[str] = mapped_column(String(20), default="at_least_once")
    # Max retries for failed inter-agent messages
    max_retries: Mapped[int] = mapped_column(Integer, default=3)

    # Template name if cloned from a template
    template_name: Mapped[str | None] = mapped_column(String(100), nullable=True)

    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )
