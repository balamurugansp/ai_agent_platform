"""
WebSocket endpoint for real-time run event streaming.

Connect: ws://localhost:8000/api/v1/ws/{run_id}?token=<jwt>
Special run_id "__global__" receives all events.

Auth: pass JWT via ?token= query param (browsers can't set WS headers).
      OR pass X-API-Key via Sec-WebSocket-Protocol header.
"""
import asyncio
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from app.core.events import event_bus
from app.core.security import decode_token, _valid_api_keys

logger = logging.getLogger(__name__)
router = APIRouter(tags=["WebSocket"])


async def _ws_authenticate(websocket: WebSocket, token: str | None, api_key: str | None) -> bool:
    """Returns True if the connection is authenticated."""
    if token:
        subject = decode_token(token)
        if subject:
            return True
    if api_key and api_key in _valid_api_keys():
        return True
    return False


@router.websocket("/ws/{run_id}")
async def websocket_run_events(
    websocket: WebSocket,
    run_id: str,
    token: str | None = Query(default=None),
    api_key: str | None = Query(default=None, alias="x-api-key"),
):
    # Authenticate before accepting
    authed = await _ws_authenticate(websocket, token, api_key)
    if not authed:
        await websocket.close(code=4001, reason="Unauthorized")
        logger.warning("WS rejected unauthenticated connection for run_id=%s", run_id)
        return

    await websocket.accept()
    queue = event_bus.subscribe(run_id)
    logger.info("WS client connected for run_id=%s", run_id)
    try:
        while True:
            try:
                payload = await asyncio.wait_for(queue.get(), timeout=30)
                await websocket.send_text(payload)
            except asyncio.TimeoutError:
                await websocket.send_text('{"type":"ping"}')
    except WebSocketDisconnect:
        logger.info("WS client disconnected run_id=%s", run_id)
    except Exception as e:
        logger.warning("WS error run_id=%s: %s", run_id, e)
    finally:
        event_bus.unsubscribe(run_id, queue)
