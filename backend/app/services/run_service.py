"""
Thin helpers for persisting run messages and token counts without
importing a DB session into the runtime (avoids circular deps).
"""
import logging
from datetime import datetime
from app.core.database import AsyncSessionLocal
from app.models.run import RunMessage, WorkflowRun
from sqlalchemy import select

logger = logging.getLogger(__name__)


async def append_run_message(
    run_id: str,
    agent_id: str | None,
    agent_name: str,
    role: str,
    content: str,
    metadata: dict | None = None,
) -> None:
    async with AsyncSessionLocal() as db:
        msg = RunMessage(
            run_id=run_id,
            agent_id=agent_id,
            agent_name=agent_name,
            role=role,
            content=content,
            metadata_=metadata or {},
        )
        db.add(msg)
        await db.commit()


async def update_run_tokens(run_id: str, tokens: int, cost: float) -> None:
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(WorkflowRun).where(WorkflowRun.id == run_id))
        run = result.scalar_one_or_none()
        if run:
            run.tokens_used = (run.tokens_used or 0) + tokens
            run.estimated_cost = (run.estimated_cost or 0.0) + cost
            await db.commit()


async def finish_run(run_id: str, status: str, output: str | None = None) -> None:
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(WorkflowRun).where(WorkflowRun.id == run_id))
        run = result.scalar_one_or_none()
        if run:
            run.status = status
            run.output_message = output
            run.completed_at = datetime.utcnow()
            await db.commit()
