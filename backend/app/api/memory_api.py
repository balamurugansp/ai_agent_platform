"""
Agent Memory management API.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core import memory as mem_module
from app.models.memory import AgentMemory

router = APIRouter(prefix="/memory", tags=["memory"])


@router.get("/{agent_id}")
async def get_agent_memory(
    agent_id: str,
    conversation_key: str = "default",
    db: AsyncSession = Depends(get_db),
):
    """Retrieve conversation memory for an agent."""
    result = await db.execute(
        select(AgentMemory)
        .where(AgentMemory.agent_id == agent_id, AgentMemory.conversation_key == conversation_key)
        .order_by(AgentMemory.seq)
    )
    rows = result.scalars().all()
    return {
        "agent_id": agent_id,
        "conversation_key": conversation_key,
        "message_count": len(rows),
        "total_tokens": sum(r.token_count for r in rows),
        "messages": [
            {"role": r.role, "content": r.content[:500],
             "token_count": r.token_count, "seq": r.seq,
             "created_at": r.created_at}
            for r in rows
        ],
    }


@router.delete("/{agent_id}")
async def clear_agent_memory(
    agent_id: str,
    conversation_key: str = "default",
    db: AsyncSession = Depends(get_db),
):
    """Clear all memory for an agent/conversation."""
    await mem_module.clear_memory(agent_id, conversation_key, db)
    await db.commit()
    return {"cleared": True, "agent_id": agent_id, "conversation_key": conversation_key}


@router.get("/{agent_id}/conversations")
async def list_conversations(agent_id: str, db: AsyncSession = Depends(get_db)):
    """List all conversation keys for an agent."""
    from sqlalchemy import distinct
    result = await db.execute(
        select(distinct(AgentMemory.conversation_key))
        .where(AgentMemory.agent_id == agent_id)
    )
    keys = [r[0] for r in result.fetchall()]
    return {"agent_id": agent_id, "conversation_keys": keys}
