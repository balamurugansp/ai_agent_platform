"""
Agent Memory Manager — two-tier memory system.

sliding_window: keep the last N messages (fast, simple)
summary:        compress older turns into a running summary using the LLM,
                then keep only the summary + most recent N messages

Memory is persisted in the agent_memories table so conversations survive
server restarts and span multiple runs (cross-session memory).
"""
from __future__ import annotations

import logging
from typing import List, Optional

from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage,
)
from langchain_openai import ChatOpenAI

from app.core.config import settings

logger = logging.getLogger(__name__)

# ─── In-memory cache (agent_id + conversation_key → message list) ─────────────
_CACHE: dict[str, list[dict]] = {}


def _cache_key(agent_id: str, conversation_key: str) -> str:
    return f"{agent_id}:{conversation_key}"


def _to_lc(row: dict) -> BaseMessage:
    role = row.get("role", "human")
    content = row.get("content", "")
    if role == "assistant":
        return AIMessage(content=content)
    elif role == "system":
        return SystemMessage(content=content)
    elif role == "summary":
        return SystemMessage(content=f"[Memory summary]\n{content}")
    else:
        return HumanMessage(content=content)


# ─── Sliding Window ────────────────────────────────────────────────────────────

async def get_sliding_window(
    agent_id: str,
    conversation_key: str,
    window: int = 10,
    db_session=None,
) -> List[BaseMessage]:
    """
    Return the last `window` messages for this agent/conversation pair.
    Loads from DB if not in cache; updates cache on each call.
    """
    key = _cache_key(agent_id, conversation_key)
    if key not in _CACHE:
        await _load_from_db(agent_id, conversation_key, db_session)
    rows = _CACHE.get(key, [])
    recent = rows[-window:] if len(rows) > window else rows
    return [_to_lc(r) for r in recent]


async def append_message(
    agent_id: str,
    conversation_key: str,
    role: str,
    content: str,
    token_count: int = 0,
    db_session=None,
) -> None:
    """Append a new message to memory (cache + DB)."""
    key = _cache_key(agent_id, conversation_key)
    if key not in _CACHE:
        _CACHE[key] = []
    seq = len(_CACHE[key])
    row = {
        "agent_id": agent_id,
        "conversation_key": conversation_key,
        "role": role,
        "content": content,
        "token_count": token_count,
        "seq": seq,
    }
    _CACHE[key].append(row)

    # Persist to DB
    if db_session:
        try:
            from app.models.memory import AgentMemory
            mem = AgentMemory(
                agent_id=agent_id,
                conversation_key=conversation_key,
                role=role,
                content=content,
                token_count=token_count,
                seq=seq,
            )
            db_session.add(mem)
            await db_session.flush()
        except Exception as e:
            logger.warning("Memory DB persist failed: %s", e)


# ─── Summary Memory ────────────────────────────────────────────────────────────

_SUMMARY_LLM: Optional[ChatOpenAI] = None


def _get_summary_llm() -> ChatOpenAI:
    global _SUMMARY_LLM
    if _SUMMARY_LLM is None:
        _SUMMARY_LLM = ChatOpenAI(
            model="gpt-4o-mini",
            temperature=0.0,
            openai_api_key=settings.OPENAI_API_KEY,
        )
    return _SUMMARY_LLM


async def summarize_messages(messages: List[BaseMessage], existing_summary: str = "") -> str:
    """Use the LLM to compress a list of messages into a concise summary."""
    llm = _get_summary_llm()
    conversation_text = "\n".join(
        f"{type(m).__name__}: {m.content}" for m in messages
    )
    prompt_parts = []
    if existing_summary:
        prompt_parts.append(f"Existing summary:\n{existing_summary}\n")
    prompt_parts.append(
        f"New conversation turns to incorporate:\n{conversation_text}\n\n"
        "Produce a concise summary (max 300 words) of the key facts, decisions, and "
        "context from this conversation that an agent must remember."
    )
    response = await llm.ainvoke([HumanMessage(content="\n".join(prompt_parts))])
    return response.content


async def get_summary_memory(
    agent_id: str,
    conversation_key: str,
    window: int = 6,
    token_limit: int = 4000,
    db_session=None,
) -> List[BaseMessage]:
    """
    Return memory using summary compression:
    1. Load all messages from cache/DB
    2. If total tokens > token_limit, summarize the oldest messages
    3. Return [SystemMessage(summary)] + last `window` raw messages
    """
    key = _cache_key(agent_id, conversation_key)
    if key not in _CACHE:
        await _load_from_db(agent_id, conversation_key, db_session)
    rows = _CACHE.get(key, [])

    if not rows:
        return []

    total_tokens = sum(r.get("token_count", 0) for r in rows)
    summary_rows = [r for r in rows if r.get("role") == "summary"]
    existing_summary = summary_rows[-1]["content"] if summary_rows else ""

    if total_tokens <= token_limit:
        # No compression needed
        return [_to_lc(r) for r in rows]

    # Split: older messages → compress; newest window → keep raw
    raw_messages = [r for r in rows if r.get("role") != "summary"]
    keep = raw_messages[-window:]
    compress = raw_messages[:-window]

    if compress:
        try:
            lc_compress = [_to_lc(r) for r in compress]
            new_summary = await summarize_messages(lc_compress, existing_summary)
            # Update cache: replace old messages with summary row
            _CACHE[key] = [
                {"role": "summary", "content": new_summary, "token_count": len(new_summary.split()), "seq": 0}
            ] + keep
            # Persist summary
            if db_session:
                from app.models.memory import AgentMemory
                mem = AgentMemory(
                    agent_id=agent_id,
                    conversation_key=conversation_key,
                    role="summary",
                    content=new_summary,
                    token_count=len(new_summary.split()),
                    seq=0,
                    summary_metadata={"compressed_count": len(compress)},
                )
                db_session.add(mem)
                await db_session.flush()
        except Exception as e:
            logger.warning("Memory summary failed, falling back to sliding window: %s", e)

    return [_to_lc(r) for r in _CACHE.get(key, rows)[-window:]]


async def clear_memory(agent_id: str, conversation_key: str, db_session=None) -> None:
    """Clear all memory for an agent/conversation."""
    key = _cache_key(agent_id, conversation_key)
    _CACHE.pop(key, None)
    if db_session:
        from sqlalchemy import delete
        from app.models.memory import AgentMemory
        await db_session.execute(
            delete(AgentMemory).where(
                AgentMemory.agent_id == agent_id,
                AgentMemory.conversation_key == conversation_key,
            )
        )


async def _load_from_db(agent_id: str, conversation_key: str, db_session) -> None:
    """Load memory rows from DB into cache."""
    if not db_session:
        _CACHE[_cache_key(agent_id, conversation_key)] = []
        return
    try:
        from sqlalchemy import select
        from app.models.memory import AgentMemory
        result = await db_session.execute(
            select(AgentMemory)
            .where(AgentMemory.agent_id == agent_id, AgentMemory.conversation_key == conversation_key)
            .order_by(AgentMemory.seq)
        )
        rows = [
            {
                "role": r.role, "content": r.content,
                "token_count": r.token_count, "seq": r.seq,
            }
            for r in result.scalars().all()
        ]
        _CACHE[_cache_key(agent_id, conversation_key)] = rows
    except Exception as e:
        logger.warning("Memory DB load failed: %s", e)
        _CACHE[_cache_key(agent_id, conversation_key)] = []
