from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List

from app.core.database import get_db
from app.schemas.run import WorkflowRunResponse
from app.services.workflow_service import list_runs, get_run_with_messages

router = APIRouter(prefix="/runs", tags=["Runs"])


@router.get("", response_model=List[WorkflowRunResponse])
async def list_all_runs(db: AsyncSession = Depends(get_db)):
    return await list_runs(db)


@router.get("/{run_id}", response_model=WorkflowRunResponse)
async def get_run(run_id: str, db: AsyncSession = Depends(get_db)):
    run = await get_run_with_messages(db, run_id)
    if not run:
        raise HTTPException(404, "Run not found")
    return run
