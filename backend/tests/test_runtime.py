"""Tests for LangGraph runtime internals (unit tests, no LLM calls)."""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from langchain_core.messages import HumanMessage, AIMessage

from app.runtime.tools import calculator, get_current_time, TOOL_REGISTRY, get_tools_for_agent
from app.runtime.langgraph_runtime import build_edge_router, AgentState


# ─── Tool tests ───────────────────────────────────────────────────────────────

def test_calculator_basic():
    result = calculator.invoke({"expression": "2 + 2"})
    assert "4" in str(result)


def test_calculator_complex():
    result = calculator.invoke({"expression": "sqrt(144)"})
    assert "12" in str(result)


def test_calculator_error():
    result = calculator.invoke({"expression": "import os"})
    assert "error" in result.lower()


def test_get_current_time():
    result = get_current_time.invoke({})
    assert "UTC" in result


def test_tool_registry_complete():
    expected = {"web_search", "calculator", "get_current_time", "http_request", "summarize_text"}
    assert expected.issubset(set(TOOL_REGISTRY.keys()))


def test_get_tools_for_agent():
    tools = get_tools_for_agent(["calculator", "get_current_time"])
    assert len(tools) == 2

def test_get_tools_unknown_ignored():
    tools = get_tools_for_agent(["nonexistent_tool", "calculator"])
    assert len(tools) == 1


# ─── Edge router tests ────────────────────────────────────────────────────────

def make_state(content: str, iteration: int = 0) -> AgentState:
    return {
        "messages": [AIMessage(content=content)],
        "current_node": "node_0",
        "run_id": "test-run",
        "workflow_id": "test-wf",
        "iteration": iteration,
        "max_iterations": 20,
        "shared_context": {},
    }


def test_edge_router_unconditional():
    edges = [{"source": "a", "target": "b", "condition": ""}]
    router = build_edge_router(edges, "a")
    state = make_state("anything")
    assert router(state) == "b"


def test_edge_router_contains_match():
    edges = [{"source": "a", "target": "b", "condition": "contains:done"}]
    router = build_edge_router(edges, "a")
    assert router(make_state("Task is DONE now")) == "b"


def test_edge_router_contains_no_match():
    from langgraph.graph import END
    edges = [{"source": "a", "target": "b", "condition": "contains:done"}]
    router = build_edge_router(edges, "a")
    assert router(make_state("Still working...")) == END


def test_edge_router_ends_with():
    edges = [{"source": "a", "target": "b", "condition": "ends_with:complete"}]
    router = build_edge_router(edges, "a")
    assert router(make_state("Task complete")) == "b"
    from langgraph.graph import END
    assert router(make_state("Not done yet")) == END


def test_edge_router_max_iterations():
    from langgraph.graph import END
    edges = [{"source": "a", "target": "b", "condition": ""}]
    router = build_edge_router(edges, "a")
    state = make_state("anything", iteration=25)
    assert router(state) == END


def test_edge_router_multiple_conditions():
    edges = [
        {"source": "a", "target": "support", "condition": "contains:ROUTE:SUPPORT"},
        {"source": "a", "target": "escalate", "condition": "contains:ROUTE:ESCALATE"},
    ]
    router = build_edge_router(edges, "a")
    assert router(make_state("ROUTE:SUPPORT this query")) == "support"
    assert router(make_state("ROUTE:ESCALATE this complaint")) == "escalate"


def test_edge_router_python_condition():
    edges = [{"source": "a", "target": "b", "condition": "python:len(state['messages']) > 0"}]
    router = build_edge_router(edges, "a")
    assert router(make_state("anything")) == "b"


# ─── Graph building ───────────────────────────────────────────────────────────

def test_build_graph_single_node():
    from app.runtime.langgraph_runtime import build_graph
    workflow = {
        "id": "test-wf",
        "nodes": [{"id": "n0", "agent_id": "a1"}],
        "edges": [],
        "entry_point": "n0",
    }
    agents = {
        "a1": {
            "id": "a1", "name": "Agent1", "role": "assistant",
            "system_prompt": "test", "model": "gpt-4o-mini",
            "temperature": 0.7, "max_tokens": 1024,
            "tools": [], "memory_enabled": True, "memory_window": 5,
            "skills": [], "guardrails": {},
        }
    }
    run_id_ref = {"run_id": "test"}
    # Should compile without errors
    graph = build_graph(workflow, agents, run_id_ref)
    assert graph is not None
