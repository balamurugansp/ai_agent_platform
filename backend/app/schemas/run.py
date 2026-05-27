from pydantic import BaseModel
from typing import Optional, Dict, Any, List
from datetime import datetime


class RunMessageResponse(BaseModel):
    id: str
    run_id: str
    agent_id: Optional[str]
    agent_name: str
    role: str
    content: str
    metadata_: Dict[str, Any] = {}
    created_at: datetime

    model_config = {"from_attributes": True}


class WorkflowRunResponse(BaseModel):
    id: str
    workflow_id: str
    status: str
    trigger_source: str
    trigger_data: Dict[str, Any]
    input_message: str
    output_message: Optional[str]
    tokens_used: int
    estimated_cost: float
    started_at: datetime
    completed_at: Optional[datetime]
    messages: List[RunMessageResponse] = []

    model_config = {"from_attributes": True}
