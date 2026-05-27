"""
LangGraph-based multi-agent runtime — v2.

New in v2:
  - MCP dynamic tools via MCPClientManager
  - Pluggable memory (sliding_window | summary)
  - A2A message bus integration with loop detection
  - HITL breakpoint nodes (workflow pauses for human approval)
  - Router nodes (conditional dispatch without LLM call)
  - Infinite loop guard with semantic similarity detection
"""
from __future__ import annotations

import asyncio
import json
import logging
import traceback
import uuid
from datetime import datetime
from typing import Annotated, Any, Dict, List, Optional, TypedDict

import operator
from langchain_core.messages import (
    AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage,
)
from langchain_openai import ChatOpenAI
from langgraph.graph import END, StateGraph
from langgraph.prebuilt import ToolNode

from app.core.config import settings
from app.core.events import event_bus
from app.core.mcp_client import mcp_manager
from app.core import memory as mem_module
from app.core.a2a_bus import a2a_bus, hitl_registry, loop_detector
from app.runtime.tools import get_tools_for_agent

logger = logging.getLogger(__name__)


# ─── Shared graph state ───────────────────────────────────────────────────────

class AgentState(TypedDict):
    messages: Annotated[List[BaseMessage], operator.add]
    current_node: str
    run_id: str
    workflow_id: str
    iteration: int
    max_iterations: int
    shared_context: Dict[str, Any]
    # A2A: sub-conversation tracking
    sub_runs: Dict[str, str]           # agent_id → sub_run_id
    parent_run_id: Optional[str]
    # HITL: pending checkpoint id
    hitl_checkpoint_id: Optional[str]
    hitl_feedback: Optional[str]


# ─── Cost estimation ─────────────────────────────────────────────────────────

COST_PER_1K = {
    "gpt-4o": 0.005,
    "gpt-4o-mini": 0.00015,
    "gpt-4-turbo": 0.01,
    "gpt-3.5-turbo": 0.0005,
    "claude-3-5-sonnet": 0.003,
    "claude-3-haiku": 0.00025,
}

def estimate_cost(model: str, tokens: int) -> float:
    rate = COST_PER_1K.get(model, 0.002)
    return round(tokens / 1000 * rate, 6)


# ─── HITL node factory ────────────────────────────────────────────────────────

def make_hitl_node(node_id: str, node_config: dict, run_id_ref: dict):
    """
    Creates a HITL breakpoint node. Pauses execution until a human
    approves/rejects via the HITL API. Approved feedback is injected
    as a HumanMessage to guide subsequent agents.
    """
    prompt = node_config.get("prompt", "Please review and approve to continue.")
    timeout = node_config.get("timeout_seconds", 0) or None

    async def hitl_node(state: AgentState) -> dict:
        run_id = state.get("run_id", run_id_ref.get("run_id", ""))
        checkpoint_id = str(uuid.uuid4())

        # Persist checkpoint to DB
        try:
            from app.models.hitl import HITLCheckpoint
            from app.core.database import async_session_factory
            async with async_session_factory() as session:
                cp = HITLCheckpoint(
                    id=checkpoint_id,
                    run_id=run_id,
                    workflow_id=state.get("workflow_id", ""),
                    node_id=node_id,
                    agent_id=node_id,
                    agent_name=node_config.get("label", "HITL"),
                    prompt=prompt,
                    context_snapshot={
                        "iteration": state.get("iteration", 0),
                        "last_message": state["messages"][-1].content if state["messages"] else "",
                    },
                )
                session.add(cp)
                await session.commit()
        except Exception as e:
            logger.warning("HITL DB persist failed: %s", e)

        # Notify UI
        await event_bus.publish(run_id, "hitl_checkpoint", {
            "checkpoint_id": checkpoint_id,
            "node_id": node_id,
            "prompt": prompt,
            "context": state["messages"][-1].content if state["messages"] else "",
        })

        # Wait for human resolution
        event = hitl_registry.create_checkpoint(checkpoint_id)
        resolution = await hitl_registry.wait_for_resolution(checkpoint_id, timeout=timeout)

        # Update DB status
        try:
            from app.models.hitl import HITLCheckpoint
            from app.core.database import async_session_factory
            from sqlalchemy import update
            async with async_session_factory() as session:
                await session.execute(
                    update(HITLCheckpoint)
                    .where(HITLCheckpoint.id == checkpoint_id)
                    .values(
                        status="approved" if resolution["approved"] else "rejected",
                        feedback=resolution.get("feedback", ""),
                        resolved_at=datetime.utcnow(),
                    )
                )
                await session.commit()
        except Exception as e:
            logger.warning("HITL DB update failed: %s", e)

        hitl_registry.cleanup(checkpoint_id)

        if not resolution["approved"]:
            await event_bus.publish(run_id, "hitl_rejected", {
                "checkpoint_id": checkpoint_id,
                "feedback": resolution.get("feedback", ""),
            })
            # Inject rejection as message and terminate
            return {
                "messages": [HumanMessage(content=f"[HITL REJECTED]: {resolution.get('feedback', 'No feedback')}")],
                "hitl_checkpoint_id": checkpoint_id,
            }

        feedback = resolution.get("feedback", "")
        await event_bus.publish(run_id, "hitl_approved", {
            "checkpoint_id": checkpoint_id,
            "feedback": feedback,
        })

        msgs = []
        if feedback:
            msgs.append(HumanMessage(content=f"[Human feedback]: {feedback}"))

        return {
            "messages": msgs,
            "hitl_checkpoint_id": checkpoint_id,
            "hitl_feedback": feedback,
        }

    hitl_node.__name__ = f"hitl_{node_id}"
    return hitl_node


# ─── Router node factory ─────────────────────────────────────────────────────

def make_router_node(node_id: str, node_config: dict):
    """
    A router node performs no LLM call — it just passes state through.
    Routing decisions are made by the edge conditions from this node.
    """
    async def router_node(state: AgentState) -> dict:
        return {"current_node": node_id}

    router_node.__name__ = f"router_{node_id}"
    return router_node


# ─── Agent node factory ───────────────────────────────────────────────────────

def make_agent_node(agent_cfg: dict, run_id_ref: dict, conversation_key: str = ""):
    model_name  = agent_cfg.get("model", settings.DEFAULT_MODEL)
    temperature = agent_cfg.get("temperature", 0.7)
    max_tokens  = agent_cfg.get("max_tokens", 2048)
    system_prompt = agent_cfg.get("system_prompt", "You are a helpful assistant.")
    tool_names: List[str] = agent_cfg.get("tools", [])
    memory_enabled = agent_cfg.get("memory_enabled", True)
    memory_type    = agent_cfg.get("memory_type", "sliding_window")
    memory_window  = agent_cfg.get("memory_window", 10)
    memory_token_limit = agent_cfg.get("memory_token_limit", 4000)
    mcp_server_ids  = agent_cfg.get("mcp_server_ids", [])
    mcp_whitelist   = agent_cfg.get("mcp_tool_whitelist", [])
    agent_name  = agent_cfg.get("name", "Agent")
    agent_id    = agent_cfg.get("id", "")
    hitl_every  = agent_cfg.get("hitl_every_n_turns", 0)
    hitl_timeout = agent_cfg.get("hitl_timeout_seconds", 0)

    # Build system prompt with skills
    skills = agent_cfg.get("skills", [])
    if skills:
        system_prompt += "\n\nYour skills:\n" + "\n".join(f"- {s}" for s in skills)

    # Built-in tools
    tools = get_tools_for_agent(tool_names)
    # MCP tools
    mcp_tools = mcp_manager.get_tools_for_agent(mcp_server_ids, mcp_whitelist or None)
    tools.extend(mcp_tools)

    llm = ChatOpenAI(
        model=model_name, temperature=temperature,
        max_tokens=max_tokens, openai_api_key=settings.OPENAI_API_KEY,
    )
    llm_with_tools = llm.bind_tools(tools) if tools else llm

    async def agent_node(state: AgentState) -> dict:
        run_id = state.get("run_id", run_id_ref.get("run_id", ""))
        iteration = state.get("iteration", 0)

        await event_bus.publish(run_id, "agent_started", {
            "agent_id": agent_id, "agent_name": agent_name, "iteration": iteration,
        })

        # ── Memory retrieval ─────────────────────────────────────────────────
        conv_key = conversation_key or run_id
        if memory_enabled:
            try:
                if memory_type == "summary":
                    memory_msgs = await mem_module.get_summary_memory(
                        agent_id, conv_key, memory_window, memory_token_limit
                    )
                else:
                    memory_msgs = await mem_module.get_sliding_window(
                        agent_id, conv_key, memory_window
                    )
            except Exception as e:
                logger.warning("Memory retrieval failed: %s", e)
                memory_msgs = state["messages"][-memory_window:]
        else:
            memory_msgs = state["messages"][-memory_window:]

        invoke_messages = [SystemMessage(content=system_prompt)] + memory_msgs

        # ── HITL auto-pause ──────────────────────────────────────────────────
        if hitl_every and iteration > 0 and iteration % hitl_every == 0:
            checkpoint_id = str(uuid.uuid4())
            prompt = f"Agent '{agent_name}' has completed {iteration} turns. Approve to continue?"
            event = hitl_registry.create_checkpoint(checkpoint_id)
            await event_bus.publish(run_id, "hitl_checkpoint", {
                "checkpoint_id": checkpoint_id, "node_id": agent_id, "prompt": prompt,
            })
            timeout_val = float(hitl_timeout) if hitl_timeout else None
            resolution = await hitl_registry.wait_for_resolution(checkpoint_id, timeout=timeout_val)
            hitl_registry.cleanup(checkpoint_id)
            if not resolution.get("approved", True):
                return {
                    "messages": [AIMessage(content="[Execution halted by reviewer]")],
                    "current_node": agent_id, "iteration": iteration + 1,
                }
            if resolution.get("feedback"):
                invoke_messages.append(HumanMessage(content=f"[Human guidance]: {resolution['feedback']}"))

        # ── LLM inference ─────────────────────────────────────────────────────
        try:
            response: AIMessage = await llm_with_tools.ainvoke(invoke_messages)
        except Exception as exc:
            logger.error("LLM call failed for %s: %s", agent_name, exc)
            await event_bus.publish(run_id, "agent_error", {"agent_id": agent_id, "error": str(exc)})
            return {"messages": [AIMessage(content=f"[Agent error: {exc}]")],
                    "current_node": agent_id, "iteration": iteration + 1}

        usage = getattr(response, "usage_metadata", None) or {}
        total_tokens = usage.get("total_tokens", 0) if isinstance(usage, dict) else 0

        await event_bus.publish(run_id, "agent_message", {
            "agent_id": agent_id, "agent_name": agent_name,
            "role": "assistant", "content": response.content,
            "tokens": total_tokens, "tool_calls": bool(response.tool_calls),
        })

        # ── Persist memory ───────────────────────────────────────────────────
        last_human = next(
            (m.content for m in reversed(state["messages"]) if isinstance(m, HumanMessage)), ""
        )
        if memory_enabled and last_human:
            await mem_module.append_message(agent_id, conv_key, "human", last_human, 0)
        if memory_enabled and response.content:
            await mem_module.append_message(agent_id, conv_key, "assistant", response.content, total_tokens)

        # ── Persist run message to DB ────────────────────────────────────────
        try:
            from app.services.run_service import append_run_message, update_run_tokens
            await append_run_message(
                run_id=run_id, agent_id=agent_id, agent_name=agent_name,
                role="assistant",
                content=response.content or json.dumps([tc for tc in (response.tool_calls or [])]),
                metadata={"tokens": total_tokens},
            )
            if total_tokens:
                await update_run_tokens(run_id, total_tokens, estimate_cost(model_name, total_tokens))
        except Exception as e:
            logger.warning("DB persist failed: %s", e)

        return {
            "messages": [response],
            "current_node": agent_id,
            "iteration": iteration + 1,
        }

    agent_node.__name__ = f"agent_{agent_id}"
    return agent_node


# ─── Edge router ─────────────────────────────────────────────────────────────

def build_edge_router(edges_from_node: List[dict], node_id: str):
    def router(state: AgentState) -> str:
        last_msg = state["messages"][-1] if state["messages"] else None
        last_content = (last_msg.content if last_msg and hasattr(last_msg, "content") else "").lower()

        if state.get("iteration", 0) >= state.get("max_iterations", 20):
            return END

        for edge in edges_from_node:
            target = edge["target"]
            condition = edge.get("condition", "").strip()
            if not condition:
                return target
            if condition.startswith("contains:"):
                if condition[9:].lower() in last_content:
                    return target
            elif condition.startswith("ends_with:"):
                if last_content.endswith(condition[10:].lower()):
                    return target
            elif condition.startswith("python:"):
                try:
                    if eval(condition[7:], {"state": state, "content": last_content}):
                        return target
                except Exception:
                    pass
        return END

    return router


# ─── Graph builder ────────────────────────────────────────────────────────────

def build_graph(
    workflow: dict,
    agents_by_id: Dict[str, dict],
    run_id_ref: dict,
    conversation_key: str = "",
) -> Any:
    graph = StateGraph(AgentState)
    node_ids = []

    for node in workflow.get("nodes", []):
        node_id   = node["id"]
        node_type = node.get("type", "agent")
        node_data = node.get("data", {})

        if node_type == "hitl":
            fn = make_hitl_node(node_id, node_data, run_id_ref)
            graph.add_node(node_id, fn)
            node_ids.append(node_id)

        elif node_type == "router":
            fn = make_router_node(node_id, node_data)
            graph.add_node(node_id, fn)
            node_ids.append(node_id)

        elif node_type == "agent":
            agent_id  = node.get("agent_id") or node_data.get("agent_id", "")
            agent_cfg = agents_by_id.get(agent_id)
            if not agent_cfg:
                logger.warning("Agent %s not found for node %s", agent_id, node_id)
                continue

            fn   = make_agent_node(agent_cfg, run_id_ref, conversation_key)
            tools = get_tools_for_agent(agent_cfg.get("tools", []))
            tools.extend(mcp_manager.get_tools_for_agent(
                agent_cfg.get("mcp_server_ids", []),
                agent_cfg.get("mcp_tool_whitelist", []) or None,
            ))

            if tools:
                tool_node_id = f"{node_id}__tools"
                graph.add_node(node_id, fn)
                graph.add_node(tool_node_id, ToolNode(tools))

                def _make_tool_router(nid, tid):
                    def _tr(state: AgentState) -> str:
                        last = state["messages"][-1] if state["messages"] else None
                        return tid if (hasattr(last, "tool_calls") and last.tool_calls) else "__cont__"
                    return _tr

                graph.add_conditional_edges(
                    node_id, _make_tool_router(node_id, tool_node_id),
                    {tool_node_id: tool_node_id, "__cont__": "__cont__"},
                )
                graph.add_edge(tool_node_id, node_id)
            else:
                graph.add_node(node_id, fn)
            node_ids.append(node_id)

    # Build inter-node edges
    edges_by_source: Dict[str, List[dict]] = {}
    for edge in workflow.get("edges", []):
        edges_by_source.setdefault(edge["source"], []).append(edge)

    for node_id in node_ids:
        node_edges = edges_by_source.get(node_id, [])
        if not node_edges:
            graph.add_edge(node_id, END)
        elif len(node_edges) == 1 and not node_edges[0].get("condition", "").strip():
            tgt = node_edges[0]["target"]
            graph.add_edge(node_id, tgt if tgt in node_ids else END)
        else:
            router_fn = build_edge_router(node_edges, node_id)
            valid = {e["target"]: e["target"] for e in node_edges if e["target"] in node_ids}
            valid[END] = END
            graph.add_conditional_edges(node_id, router_fn, valid)

    entry = workflow.get("entry_point", node_ids[0] if node_ids else "")
    if entry:
        graph.set_entry_point(entry)

    return graph.compile()


# ─── Run executor ─────────────────────────────────────────────────────────────

async def execute_workflow(
    workflow: dict,
    agents_by_id: Dict[str, dict],
    run_id: str,
    input_message: str,
    max_iterations: int = 20,
    parent_run_id: str | None = None,
    conversation_key: str = "",
) -> str:
    run_id_ref = {"run_id": run_id}
    loop_detector.reset(run_id)

    compiled = build_graph(workflow, agents_by_id, run_id_ref, conversation_key or run_id)

    initial_state: AgentState = {
        "messages": [HumanMessage(content=input_message)],
        "current_node": "",
        "run_id": run_id,
        "workflow_id": workflow.get("id", ""),
        "iteration": 0,
        "max_iterations": max_iterations,
        "shared_context": {},
        "sub_runs": {},
        "parent_run_id": parent_run_id,
        "hitl_checkpoint_id": None,
        "hitl_feedback": None,
    }

    try:
        await event_bus.publish(run_id, "run_started", {
            "input": input_message, "parent_run_id": parent_run_id
        })

        final_state = await compiled.ainvoke(initial_state)

        ai_messages = [
            m for m in final_state.get("messages", [])
            if isinstance(m, AIMessage) and m.content
        ]
        output = ai_messages[-1].content if ai_messages else "Workflow completed with no output."

        await event_bus.publish(run_id, "run_completed", {"output": output})
        return output

    except Exception as exc:
        error = traceback.format_exc()
        logger.error("Workflow execution failed run=%s: %s", run_id, error)
        await event_bus.publish(run_id, "run_failed", {"error": str(exc)})
        raise
