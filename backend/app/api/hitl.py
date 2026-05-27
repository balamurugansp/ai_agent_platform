"""
Human-in-the-Loop approval API.
"""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.a2a_bus import hitl_registry
from app.models.hitl import HITLCheckpoint

router = APIRouter(prefix="/hitl", tags=["hitl"])


class HITLResolution(BaseModel):
    approved: bool
    feedback: str = ""
    reviewer: str = "human"


@router.get("/checkpoints")
async def list_checkpoints(
    status: str | None = None, db: AsyncSession = Depends(get_db)
):
    """List all HITL checkpoints, optionally filtered by status."""
    q = select(HITLCheckpoint).order_by(HITLCheckpoint.created_at.desc())
    if status:
        q = q.where(HITLCheckpoint.status == status)
    result = await db.execute(q)
    rows = result.scalars().all()
    return [
        {
            "id": r.id, "run_id": r.run_id, "workflow_id": r.workflow_id,
            "node_id": r.node_id, "agent_id": r.agent_id, "agent_name": r.agent_name,
            "prompt": r.prompt, "status": r.status, "feedback": r.feedback,
            "context_snapshot": r.context_snapshot,
            "created_at": r.created_at, "resolved_at": r.resolved_at,
        }
        for r in rows
    ]


@router.get("/checkpoints/pending")
async def pending_checkpoints():
    """Return IDs of checkpoints currently blocking workflow execution."""
    return {"pending": hitl_registry.get_pending()}


@router.post("/checkpoints/{checkpoint_id}/resolve")
async def resolve_checkpoint(
    checkpoint_id: str,
    resolution: HITLResolution,
    db: AsyncSession = Depends(get_db),
):
    """Approve or reject a HITL checkpoint to resume or halt the workflow."""
    resolved = hitl_registry.resolve(
        checkpoint_id, resolution.approved, resolution.feedback
    )
    if not resolved:
        # Maybe not in the in-memory registry (e.g. after restart)
        # Try to update DB anyway
        cp = await db.get(HITLCheckpoint, checkpoint_id)
        if cp:
            cp.status = "approved" if resolution.approved else "rejected"
            cp.feedback = resolution.feedback
            cp.reviewer = resolution.reviewer
            cp.resolved_at = datetime.utcnow()
            await db.commit()
        else:
            raise HTTPException(404, "Checkpoint not found")

    # Update DB
    cp = await db.get(HITLCheckpoint, checkpoint_id)
    if cp:
        cp.status = "approved" if resolution.approved else "rejected"
        cp.feedback = resolution.feedback
        cp.reviewer = resolution.reviewer
        cp.resolved_at = datetime.utcnow()
        await db.commit()

    return {"checkpoint_id": checkpoint_id, "resolved": True, "approved": resolution.approved}


@router.get("/checkpoints/{checkpoint_id}")
async def get_checkpoint(checkpoint_id: str, db: AsyncSession = Depends(get_db)):
    cp = await db.get(HITLCheckpoint, checkpoint_id)
    if not cp:
        raise HTTPException(404, "Checkpoint not found")
    return {
        "id": cp.id, "run_id": cp.run_id, "status": cp.status,
        "prompt": cp.prompt, "feedback": cp.feedback,
        "context_snapshot": cp.context_snapshot,
        "created_at": cp.created_at, "resolved_at": cp.resolved_at,
    }
