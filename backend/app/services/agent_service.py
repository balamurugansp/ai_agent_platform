from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from app.models.agent import Agent
from app.schemas.agent import AgentCreate, AgentUpdate
from typing import List, Optional


async def create_agent(db: AsyncSession, data: AgentCreate) -> Agent:
    agent = Agent(**data.model_dump())
    db.add(agent)
    await db.commit()
    await db.refresh(agent)
    return agent


async def get_agent(db: AsyncSession, agent_id: str) -> Optional[Agent]:
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    return result.scalar_one_or_none()


async def list_agents(db: AsyncSession) -> List[Agent]:
    result = await db.execute(select(Agent).order_by(Agent.created_at.desc()))
    return list(result.scalars().all())


async def update_agent(db: AsyncSession, agent_id: str, data: AgentUpdate) -> Optional[Agent]:
    agent = await get_agent(db, agent_id)
    if not agent:
        return None
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(agent, field, value)
    await db.commit()
    await db.refresh(agent)
    return agent


async def delete_agent(db: AsyncSession, agent_id: str) -> bool:
    agent = await get_agent(db, agent_id)
    if not agent:
        return False
    await db.delete(agent)
    await db.commit()
    return True
