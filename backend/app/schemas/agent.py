from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime


class AgentCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    role: str = "assistant"
    system_prompt: str = "You are a helpful assistant."
    model: str = "gpt-4o-mini"
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    max_tokens: int = Field(default=2048, ge=1, le=32000)
    tools: List[str] = []
    memory_enabled: bool = True
    memory_window: int = Field(default=10, ge=1, le=100)
    channels: List[Dict[str, Any]] = []
    schedule: Optional[str] = None
    guardrails: Dict[str, Any] = {}
    skills: List[str] = []


class AgentUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    system_prompt: Optional[str] = None
    model: Optional[str] = None
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    tools: Optional[List[str]] = None
    memory_enabled: Optional[bool] = None
    memory_window: Optional[int] = None
    channels: Optional[List[Dict[str, Any]]] = None
    schedule: Optional[str] = None
    guardrails: Optional[Dict[str, Any]] = None
    skills: Optional[List[str]] = None


class AgentResponse(BaseModel):
    id: str
    name: str
    role: str
    system_prompt: str
    model: str
    temperature: float
    max_tokens: int
    tools: List[str]
    memory_enabled: bool
    memory_window: int
    channels: List[Dict[str, Any]]
    schedule: Optional[str]
    guardrails: Dict[str, Any]
    skills: List[str]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
