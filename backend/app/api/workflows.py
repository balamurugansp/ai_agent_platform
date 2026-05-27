import asyncio
import logging
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List

from app.core.database import get_db
from app.core.rate_limit import limiter
from app.core.config import settings
from app.models.agent import Agent
from app.schemas.workflow import WorkflowCreate, WorkflowUpdate, WorkflowResponse, RunWorkflowRequest
from app.schemas.run import WorkflowRunResponse
from app.services.workflow_service import (
    create_workflow, get_workflow, list_workflows, update_workflow, delete_workflow,
    create_run, list_runs, get_run_with_messages,
)
from app.services.run_service import finish_run
from app.runtime.langgraph_runtime import execute_workflow

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/workflows", tags=["Workflows"])


@router.get("", response_model=List[WorkflowResponse])
async def list_workflows_endpoint(db: AsyncSession = Depends(get_db)):
    return await list_workflows(db)


@router.post("", response_model=WorkflowResponse, status_code=201)
async def create_workflow_endpoint(data: WorkflowCreate, db: AsyncSession = Depends(get_db)):
    return await create_workflow(db, data)


@router.get("/{workflow_id}", response_model=WorkflowResponse)
async def get_workflow_endpoint(workflow_id: str, db: AsyncSession = Depends(get_db)):
    wf = await get_workflow(db, workflow_id)
    if not wf:
        raise HTTPException(404, "Workflow not found")
    return wf


@router.put("/{workflow_id}", response_model=WorkflowResponse)
async def update_workflow_endpoint(
    workflow_id: str, data: WorkflowUpdate, db: AsyncSession = Depends(get_db)
):
    wf = await update_workflow(db, workflow_id, data)
    if not wf:
        raise HTTPException(404, "Workflow not found")
    return wf


@router.delete("/{workflow_id}", status_code=204)
async def delete_workflow_endpoint(workflow_id: str, db: AsyncSession = Depends(get_db)):
    ok = await delete_workflow(db, workflow_id)
    if not ok:
        raise HTTPException(404, "Workflow not found")


# ARB-005: workflow run endpoint is rate-limited separately (stricter)
@router.post("/{workflow_id}/run", response_model=WorkflowRunResponse, status_code=202)
@limiter.limit(f"{settings.RATE_LIMIT_WORKFLOW_PER_MINUTE}/minute")
async def run_workflow(
    request: Request,          # required by slowapi
    workflow_id: str,
    req: RunWorkflowRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Trigger a workflow run asynchronously. Returns run ID immediately (202 Accepted)."""
    wf = await get_workflow(db, workflow_id)
    if not wf:
        raise HTTPException(404, "Workflow not found")
    if not wf.nodes:
        raise HTTPException(400, "Workflow has no nodes")

    agent_ids = [n["agent_id"] for n in wf.nodes]
    result = await db.execute(select(Agent).where(Agent.id.in_(agent_ids)))
    agents = {a.id: _agent_to_dict(a) for a in result.scalars().all()}

    run = await create_run(
        db,
        workflow_id=workflow_id,
        input_message=req.message,
        trigger_source=req.trigger_source,
        trigger_data=req.trigger_data,
    )

    workflow_dict = _workflow_to_dict(wf)

    async def _execute():
        try:
            from app.core.database import AsyncSessionLocal
            async with AsyncSessionLocal() as session:
                r = await session.get(type(run), run.id)
                if r:
                    r.status = "running"
                    await session.commit()

            output = await execute_workflow(
                workflow=workflow_dict,
                agents_by_id=agents,
                run_id=run.id,
                input_message=req.message,
            )
            await finish_run(run.id, "completed", output)
        except Exception as exc:
            logger.error("Run %s failed: %s", run.id, exc)
            await finish_run(run.id, "failed", str(exc))

    background_tasks.add_task(_execute)
    return run


@router.get("/{workflow_id}/runs", response_model=List[WorkflowRunResponse])
async def list_runs_endpoint(workflow_id: str, db: AsyncSession = Depends(get_db)):
    return await list_runs(db, workflow_id)


@router.get("/runs/{run_id}", response_model=WorkflowRunResponse)
async def get_run_endpoint(run_id: str, db: AsyncSession = Depends(get_db)):
    run = await get_run_with_messages(db, run_id)
    if not run:
        raise HTTPException(404, "Run not found")
    return run


def _agent_to_dict(a: Agent) -> dict:
    return {
        "id": a.id, "name": a.name, "role": a.role,
        "system_prompt": a.system_prompt, "model": a.model,
        "temperature": a.temperature, "max_tokens": a.max_tokens,
        "tools": a.tools or [], "memory_enabled": a.memory_enabled,
        "memory_window": a.memory_window, "skills": a.skills or [],
        "guardrails": a.guardrails or {},
    }


def _workflow_to_dict(wf) -> dict:
    return {
        "id": wf.id, "name": wf.name,
        "nodes": wf.nodes or [], "edges": wf.edges or [],
        "entry_point": wf.entry_point,
    }
