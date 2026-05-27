from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List

from app.core.database import get_db
from app.schemas.agent import AgentCreate, AgentUpdate, AgentResponse
from app.services.agent_service import (
    create_agent, get_agent, list_agents, update_agent, delete_agent,
)
from app.runtime.tools import TOOL_DESCRIPTIONS

router = APIRouter(prefix="/agents", tags=["Agents"])


@router.get("/tools")
async def get_available_tools():
    """List all built-in tools agents can use."""
    return [{"name": k, "description": v} for k, v in TOOL_DESCRIPTIONS.items()]


@router.get("", response_model=List[AgentResponse])
async def list_agents_endpoint(db: AsyncSession = Depends(get_db)):
    return await list_agents(db)


@router.post("", response_model=AgentResponse, status_code=201)
async def create_agent_endpoint(data: AgentCreate, db: AsyncSession = Depends(get_db)):
    return await create_agent(db, data)


@router.get("/{agent_id}", response_model=AgentResponse)
async def get_agent_endpoint(agent_id: str, db: AsyncSession = Depends(get_db)):
    agent = await get_agent(db, agent_id)
    if not agent:
        raise HTTPException(404, "Agent not found")
    return agent


@router.put("/{agent_id}", response_model=AgentResponse)
async def update_agent_endpoint(
    agent_id: str, data: AgentUpdate, db: AsyncSession = Depends(get_db)
):
    agent = await update_agent(db, agent_id, data)
    if not agent:
        raise HTTPException(404, "Agent not found")
    return agent


@router.delete("/{agent_id}", status_code=204)
async def delete_agent_endpoint(agent_id: str, db: AsyncSession = Depends(get_db)):
    ok = await delete_agent(db, agent_id)
    if not ok:
        raise HTTPException(404, "Agent not found")
