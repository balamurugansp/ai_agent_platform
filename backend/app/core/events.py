"""
ARB-003: EventBus with Redis Pub/Sub (production) or asyncio.Queue (dev).

Auto-selects backend based on REDIS_URL setting:
  - REDIS_URL set   → Redis Pub/Sub (supports multi-instance deployments)
  - REDIS_URL empty → In-process asyncio.Queue (single-instance dev only)
"""
import asyncio
import json
import logging
from abc import ABC, abstractmethod
from typing import Any, Dict, Set
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


# ── Abstract base ─────────────────────────────────────────────────────────────
class BaseEventBus(ABC):
    @abstractmethod
    def subscribe(self, run_id: str) -> asyncio.Queue:
        pass

    @abstractmethod
    def unsubscribe(self, run_id: str, queue: asyncio.Queue):
        pass

    @abstractmethod
    async def publish(self, run_id: str, event_type: str, data: Any):
        pass

    @abstractmethod
    async def publish_global(self, event_type: str, data: Any):
        pass

    def _build_payload(self, run_id: str, event_type: str, data: Any) -> str:
        return json.dumps({
            "type": event_type,
            "run_id": run_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "data": data,
        })


# ── asyncio.Queue backend (development / single instance) ─────────────────────
class InProcessEventBus(BaseEventBus):
    def __init__(self):
        self._queues: Dict[str, Set[asyncio.Queue]] = {}

    def subscribe(self, run_id: str) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=200)
        self._queues.setdefault(run_id, set()).add(q)
        return q

    def unsubscribe(self, run_id: str, queue: asyncio.Queue):
        if run_id in self._queues:
            self._queues[run_id].discard(queue)
            if not self._queues[run_id]:
                del self._queues[run_id]

    async def _fan_out(self, run_id: str, payload: str):
        queues = self._queues.get(run_id, set())
        dead = set()
        for q in list(queues):
            try:
                q.put_nowait(payload)
            except asyncio.QueueFull:
                dead.add(q)
        for q in dead:
            self._queues[run_id].discard(q)

    async def publish(self, run_id: str, event_type: str, data: Any):
        payload = self._build_payload(run_id, event_type, data)
        await self._fan_out(run_id, payload)

    async def publish_global(self, event_type: str, data: Any):
        payload = self._build_payload("__global__", event_type, data)
        for run_id in list(self._queues):
            await self._fan_out(run_id, payload)


# ── Redis Pub/Sub backend (production / multi-instance) ───────────────────────
class RedisEventBus(BaseEventBus):
    """
    Uses Redis Pub/Sub channels named `run:<run_id>` and `run:__global__`.
    Each WebSocket subscriber creates a local asyncio.Queue that is fed
    by a background listener task.
    """

    def __init__(self, redis_url: str):
        self._redis_url = redis_url
        self._redis = None
        self._queues: Dict[str, Set[asyncio.Queue]] = {}
        self._listener_tasks: Dict[str, asyncio.Task] = {}

    async def _get_redis(self):
        if self._redis is None:
            try:
                import redis.asyncio as aioredis
                self._redis = aioredis.from_url(
                    self._redis_url,
                    encoding="utf-8",
                    decode_responses=True,
                    socket_connect_timeout=5,
                    socket_timeout=5,
                )
                await self._redis.ping()
                logger.info("Redis EventBus connected: %s", self._redis_url)
            except Exception as e:
                logger.error("Redis connection failed: %s — falling back to in-process bus", e)
                self._redis = None
                raise
        return self._redis

    def _channel(self, run_id: str) -> str:
        return f"yuno:run:{run_id}"

    def subscribe(self, run_id: str) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=500)
        self._queues.setdefault(run_id, set()).add(q)
        # Start listener for this channel if not already running
        if run_id not in self._listener_tasks or self._listener_tasks[run_id].done():
            self._listener_tasks[run_id] = asyncio.create_task(
                self._listen(run_id), name=f"redis-listener-{run_id}"
            )
        return q

    def unsubscribe(self, run_id: str, queue: asyncio.Queue):
        if run_id in self._queues:
            self._queues[run_id].discard(queue)
            if not self._queues[run_id]:
                del self._queues[run_id]
                task = self._listener_tasks.pop(run_id, None)
                if task and not task.done():
                    task.cancel()

    async def _listen(self, run_id: str):
        channel = self._channel(run_id)
        global_channel = self._channel("__global__")
        try:
            redis = await self._get_redis()
            pubsub = redis.pubsub()
            await pubsub.subscribe(channel, global_channel)
            async for message in pubsub.listen():
                if message["type"] != "message":
                    continue
                payload = message["data"]
                for q in list(self._queues.get(run_id, set())):
                    try:
                        q.put_nowait(payload)
                    except asyncio.QueueFull:
                        pass
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.warning("Redis listener error for %s: %s", run_id, e)

    async def publish(self, run_id: str, event_type: str, data: Any):
        payload = self._build_payload(run_id, event_type, data)
        try:
            redis = await self._get_redis()
            await redis.publish(self._channel(run_id), payload)
        except Exception as e:
            logger.warning("Redis publish failed: %s", e)

    async def publish_global(self, event_type: str, data: Any):
        payload = self._build_payload("__global__", event_type, data)
        try:
            redis = await self._get_redis()
            await redis.publish(self._channel("__global__"), payload)
        except Exception as e:
            logger.warning("Redis global publish failed: %s", e)


# ── Factory ───────────────────────────────────────────────────────────────────
def create_event_bus() -> BaseEventBus:
    from app.core.config import settings
    if settings.use_redis:
        logger.info("EventBus: Redis backend (%s)", settings.REDIS_URL)
        return RedisEventBus(settings.REDIS_URL)
    else:
        logger.info("EventBus: In-process asyncio.Queue backend (dev mode)")
        return InProcessEventBus()


event_bus: BaseEventBus = create_event_bus()
