"""
Agent-to-Agent (A2A) Message Bus.

Extends the existing EventBus to provide:
  - At-least-once delivery with retry logic
  - Dead-letter queue for permanently failed messages
  - HITL checkpoint support (pause/resume workflow execution)
  - Semantic loop detection (prevent infinite A2A ping-pong)
  - Parent-child run correlation for conversation stitching

The A2ABus wraps the existing event_bus and adds reliability guarantees.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import time
import uuid
from typing import Any, Callable, Dict, List, Optional

from app.core.events import event_bus

logger = logging.getLogger(__name__)


# ─── Message envelope ────────────────────────────────────────────────────────

class A2AMessage:
    """Envelope wrapping an inter-agent message with delivery metadata."""

    def __init__(
        self,
        run_id: str,
        source_agent_id: str,
        target_agent_id: str,
        payload: dict,
        parent_run_id: str | None = None,
        correlation_id: str | None = None,
        max_retries: int = 3,
    ):
        self.id = str(uuid.uuid4())
        self.run_id = run_id
        self.source_agent_id = source_agent_id
        self.target_agent_id = target_agent_id
        self.payload = payload
        self.parent_run_id = parent_run_id
        self.correlation_id = correlation_id or self.id
        self.max_retries = max_retries
        self.attempt = 0
        self.created_at = time.time()
        self.delivered = False

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "run_id": self.run_id,
            "source_agent_id": self.source_agent_id,
            "target_agent_id": self.target_agent_id,
            "payload": self.payload,
            "parent_run_id": self.parent_run_id,
            "correlation_id": self.correlation_id,
            "attempt": self.attempt,
            "created_at": self.created_at,
        }


# ─── Dead-letter queue (in-process, can be swapped to Redis list) ─────────────

class DeadLetterQueue:
    def __init__(self, max_size: int = 1000):
        self._queue: List[dict] = []
        self._max = max_size

    def push(self, msg: A2AMessage, reason: str) -> None:
        if len(self._queue) >= self._max:
            self._queue.pop(0)
        self._queue.append({"message": msg.to_dict(), "reason": reason, "ts": time.time()})
        logger.warning("A2A DLQ: msg %s → %s (reason: %s)", msg.id, msg.target_agent_id, reason)

    def list(self, limit: int = 50) -> List[dict]:
        return self._queue[-limit:]

    def clear(self) -> None:
        self._queue.clear()


dead_letter_queue = DeadLetterQueue()


# ─── Loop detector ────────────────────────────────────────────────────────────

class LoopDetector:
    """
    Detects infinite loops between agents using:
    1. Max-turn counter per agent pair
    2. Hash-based repetition detection (identical message content → loop)
    """

    def __init__(self):
        # (run_id, source, target) → turn count
        self._turn_counts: Dict[str, int] = {}
        # (run_id, source, target) → last N content hashes
        self._content_hashes: Dict[str, List[str]] = {}

    def _key(self, run_id: str, source: str, target: str) -> str:
        return f"{run_id}:{source}->{target}"

    def check(
        self,
        run_id: str,
        source: str,
        target: str,
        content: str,
        max_turns: int = 20,
        hash_window: int = 3,
    ) -> bool:
        """
        Returns True if a loop is detected.
        Loop conditions:
          1. Turn count between this source→target pair exceeds max_turns
          2. The last hash_window messages have identical content hash
        """
        key = self._key(run_id, source, target)
        count = self._turn_counts.get(key, 0) + 1
        self._turn_counts[key] = count

        # Condition 1: max turn count
        if count > max_turns:
            logger.warning("Loop detected: %s→%s exceeded max_turns=%d", source, target, max_turns)
            return True

        # Condition 2: repetitive content
        content_hash = hashlib.md5(content.encode()).hexdigest()
        hashes = self._content_hashes.get(key, [])
        hashes.append(content_hash)
        if len(hashes) > hash_window:
            hashes = hashes[-hash_window:]
        self._content_hashes[key] = hashes

        if len(hashes) == hash_window and len(set(hashes)) == 1:
            logger.warning("Loop detected: %s→%s repeated identical content %dx", source, target, hash_window)
            return True

        return False

    def reset(self, run_id: str) -> None:
        keys_to_del = [k for k in self._turn_counts if k.startswith(f"{run_id}:")]
        for k in keys_to_del:
            self._turn_counts.pop(k, None)
            self._content_hashes.pop(k, None)


loop_detector = LoopDetector()


# ─── HITL checkpoint registry ────────────────────────────────────────────────

class HITLRegistry:
    """
    Tracks pending HITL checkpoints. When a workflow node of type "hitl"
    is reached, execution pauses here until a human approves or rejects.
    """

    def __init__(self):
        # checkpoint_id → asyncio.Event (set when resolved)
        self._events: Dict[str, asyncio.Event] = {}
        # checkpoint_id → resolution dict {"approved": bool, "feedback": str}
        self._resolutions: Dict[str, dict] = {}

    def create_checkpoint(self, checkpoint_id: str) -> asyncio.Event:
        event = asyncio.Event()
        self._events[checkpoint_id] = event
        return event

    def resolve(self, checkpoint_id: str, approved: bool, feedback: str = "") -> bool:
        """Called by the HITL API to approve/reject a checkpoint."""
        if checkpoint_id not in self._events:
            return False
        self._resolutions[checkpoint_id] = {"approved": approved, "feedback": feedback}
        self._events[checkpoint_id].set()
        return True

    async def wait_for_resolution(
        self, checkpoint_id: str, timeout: float | None = None
    ) -> dict:
        """Block until the checkpoint is resolved or timeout expires."""
        event = self._events.get(checkpoint_id)
        if not event:
            return {"approved": False, "feedback": "Checkpoint not found"}
        try:
            await asyncio.wait_for(event.wait(), timeout=timeout)
        except asyncio.TimeoutError:
            self._resolutions[checkpoint_id] = {
                "approved": True,
                "feedback": "Auto-approved due to timeout",
            }
        return self._resolutions.get(checkpoint_id, {"approved": False, "feedback": "Unknown"})

    def get_pending(self) -> List[str]:
        return [cid for cid, ev in self._events.items() if not ev.is_set()]

    def cleanup(self, checkpoint_id: str) -> None:
        self._events.pop(checkpoint_id, None)
        self._resolutions.pop(checkpoint_id, None)


hitl_registry = HITLRegistry()


# ─── A2A Bus ─────────────────────────────────────────────────────────────────

class A2ABus:
    """
    High-level A2A message bus wrapping EventBus with reliability features.
    """

    def __init__(self):
        self._handlers: Dict[str, List[Callable]] = {}   # agent_id → handlers
        self._retry_queue: asyncio.Queue = asyncio.Queue()
        self._retry_task: asyncio.Task | None = None

    async def start(self) -> None:
        self._retry_task = asyncio.create_task(self._retry_loop())

    async def stop(self) -> None:
        if self._retry_task:
            self._retry_task.cancel()

    def subscribe(self, agent_id: str, handler: Callable) -> None:
        self._handlers.setdefault(agent_id, []).append(handler)

    async def send(
        self,
        run_id: str,
        source_agent_id: str,
        target_agent_id: str,
        payload: dict,
        parent_run_id: str | None = None,
        max_retries: int = 3,
    ) -> str:
        """
        Send a message from one agent to another.
        Returns the message ID.
        Checks for loops before delivery.
        """
        content = payload.get("content", "")

        # Loop detection
        if loop_detector.check(run_id, source_agent_id, target_agent_id, content):
            await event_bus.publish(run_id, "a2a_loop_detected", {
                "source": source_agent_id,
                "target": target_agent_id,
            })
            return ""

        msg = A2AMessage(
            run_id=run_id,
            source_agent_id=source_agent_id,
            target_agent_id=target_agent_id,
            payload=payload,
            parent_run_id=parent_run_id,
            max_retries=max_retries,
        )

        # Publish to EventBus for real-time UI
        await event_bus.publish(run_id, "a2a_message", msg.to_dict())

        # Deliver to local handlers
        await self._deliver(msg)
        return msg.id

    async def _deliver(self, msg: A2AMessage) -> None:
        handlers = self._handlers.get(msg.target_agent_id, [])
        if not handlers:
            # No local handler — message is queued via EventBus (Redis Pub/Sub)
            # This covers distributed multi-container scenarios
            return

        msg.attempt += 1
        for handler in handlers:
            try:
                await handler(msg)
                msg.delivered = True
            except Exception as e:
                logger.warning("A2A delivery attempt %d failed: %s", msg.attempt, e)
                if msg.attempt < msg.max_retries:
                    await self._retry_queue.put((msg, time.time() + 2 ** msg.attempt))
                else:
                    dead_letter_queue.push(msg, str(e))

    async def _retry_loop(self) -> None:
        """Background task: retry failed messages after back-off delay."""
        while True:
            try:
                msg, retry_at = await asyncio.wait_for(self._retry_queue.get(), timeout=1.0)
                delay = max(0.0, retry_at - time.time())
                await asyncio.sleep(delay)
                await self._deliver(msg)
            except asyncio.TimeoutError:
                continue
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("A2A retry loop error: %s", e)


a2a_bus = A2ABus()
