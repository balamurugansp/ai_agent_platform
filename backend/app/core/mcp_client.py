"""
MCP Client — connects to MCP servers and exposes their capabilities
(Tools, Prompts, Resources) to the agent runtime.

Supports three transports:
  stdio      — spawn a local subprocess, communicate over stdin/stdout
  sse        — connect to a remote server via HTTP Server-Sent Events
  websocket  — connect to a remote server via WebSocket

The MCPClientManager maintains a registry of active connections and
provides LangChain-compatible tool wrappers for use in LangGraph nodes.
"""
from __future__ import annotations

import asyncio
import json
import logging
import subprocess
import uuid
from typing import Any, Dict, List, Optional

import httpx

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


# ─── JSON-RPC helpers ────────────────────────────────────────────────────────

def _rpc(method: str, params: dict | None = None, req_id: str | None = None) -> dict:
    return {
        "jsonrpc": "2.0",
        "method": method,
        "params": params or {},
        "id": req_id or str(uuid.uuid4()),
    }


# ─── Transport base ───────────────────────────────────────────────────────────

class MCPTransport:
    """Abstract transport — subclasses implement send/receive."""

    async def connect(self) -> None:
        raise NotImplementedError

    async def disconnect(self) -> None:
        raise NotImplementedError

    async def send(self, message: dict) -> dict:
        """Send a JSON-RPC request and return the response."""
        raise NotImplementedError

    async def notify(self, message: dict) -> None:
        """Send a notification (no response expected)."""
        raise NotImplementedError


# ─── stdio transport ──────────────────────────────────────────────────────────

class StdioTransport(MCPTransport):
    def __init__(self, command: str, args: list, env: dict | None = None):
        self.command = command
        self.args = args
        self.env = env or {}
        self._process: asyncio.subprocess.Process | None = None
        self._lock = asyncio.Lock()

    async def connect(self) -> None:
        import os
        proc_env = {**os.environ, **self.env}
        self._process = await asyncio.create_subprocess_exec(
            self.command, *self.args,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=proc_env,
        )
        logger.info("MCP stdio process started: %s %s", self.command, self.args)

    async def disconnect(self) -> None:
        if self._process:
            try:
                self._process.terminate()
                await asyncio.wait_for(self._process.wait(), timeout=5.0)
            except Exception:
                self._process.kill()

    async def send(self, message: dict) -> dict:
        async with self._lock:
            if not self._process or not self._process.stdin:
                raise RuntimeError("stdio process not connected")
            payload = json.dumps(message) + "\n"
            self._process.stdin.write(payload.encode())
            await self._process.stdin.drain()
            line = await asyncio.wait_for(self._process.stdout.readline(), timeout=30.0)
            return json.loads(line.decode().strip())

    async def notify(self, message: dict) -> None:
        if self._process and self._process.stdin:
            payload = json.dumps(message) + "\n"
            self._process.stdin.write(payload.encode())
            await self._process.stdin.drain()


# ─── SSE transport ────────────────────────────────────────────────────────────

class SSETransport(MCPTransport):
    """Connects to an MCP server over HTTP Server-Sent Events."""

    def __init__(self, url: str, headers: dict | None = None):
        self.url = url.rstrip("/")
        self.headers = headers or {}
        self._client: httpx.AsyncClient | None = None
        self._pending: Dict[str, asyncio.Future] = {}
        self._listener_task: asyncio.Task | None = None

    async def connect(self) -> None:
        self._client = httpx.AsyncClient(
            headers=self.headers, timeout=httpx.Timeout(60.0)
        )
        self._listener_task = asyncio.create_task(self._listen())
        logger.info("MCP SSE connected: %s", self.url)

    async def _listen(self) -> None:
        """Background task that reads SSE events and resolves pending futures."""
        try:
            async with self._client.stream("GET", f"{self.url}/events") as resp:
                async for line in resp.aiter_lines():
                    if line.startswith("data:"):
                        try:
                            data = json.loads(line[5:].strip())
                            req_id = data.get("id")
                            if req_id and req_id in self._pending:
                                fut = self._pending.pop(req_id)
                                if not fut.done():
                                    fut.set_result(data)
                        except Exception as e:
                            logger.warning("SSE parse error: %s", e)
        except Exception as e:
            logger.error("SSE listener error: %s", e)

    async def disconnect(self) -> None:
        if self._listener_task:
            self._listener_task.cancel()
        if self._client:
            await self._client.aclose()

    async def send(self, message: dict) -> dict:
        req_id = message.get("id", str(uuid.uuid4()))
        message["id"] = req_id
        loop = asyncio.get_event_loop()
        fut: asyncio.Future = loop.create_future()
        self._pending[req_id] = fut
        await self._client.post(f"{self.url}/message", json=message)
        return await asyncio.wait_for(fut, timeout=30.0)

    async def notify(self, message: dict) -> None:
        if self._client:
            await self._client.post(f"{self.url}/message", json=message)


# ─── WebSocket transport ──────────────────────────────────────────────────────

class WebSocketTransport(MCPTransport):
    """Connects to an MCP server over WebSocket (ws:// or wss://)."""

    def __init__(self, url: str):
        self.url = url
        self._ws = None
        self._pending: Dict[str, asyncio.Future] = {}
        self._listener_task: asyncio.Task | None = None
        self._lock = asyncio.Lock()

    async def connect(self) -> None:
        import websockets
        self._ws = await websockets.connect(self.url)
        self._listener_task = asyncio.create_task(self._listen())
        logger.info("MCP WebSocket connected: %s", self.url)

    async def _listen(self) -> None:
        try:
            async for raw in self._ws:
                data = json.loads(raw)
                req_id = data.get("id")
                if req_id and req_id in self._pending:
                    fut = self._pending.pop(req_id)
                    if not fut.done():
                        fut.set_result(data)
        except Exception as e:
            logger.error("WS listener error: %s", e)

    async def disconnect(self) -> None:
        if self._listener_task:
            self._listener_task.cancel()
        if self._ws:
            await self._ws.close()

    async def send(self, message: dict) -> dict:
        async with self._lock:
            req_id = message.get("id", str(uuid.uuid4()))
            message["id"] = req_id
            loop = asyncio.get_event_loop()
            fut: asyncio.Future = loop.create_future()
            self._pending[req_id] = fut
            await self._ws.send(json.dumps(message))
            return await asyncio.wait_for(fut, timeout=30.0)

    async def notify(self, message: dict) -> None:
        if self._ws:
            await self._ws.send(json.dumps(message))


# ─── MCP Session ─────────────────────────────────────────────────────────────

class MCPSession:
    """
    A single MCP server connection.
    Handles the MCP initialize handshake and wraps discovery + execution.
    """

    PROTOCOL_VERSION = "2024-11-05"

    def __init__(self, server_id: str, transport: MCPTransport):
        self.server_id = server_id
        self.transport = transport
        self.capabilities: Dict[str, Any] = {}
        self.tools: List[dict] = []
        self.prompts: List[dict] = []
        self.resources: List[dict] = []
        self._initialized = False

    async def initialize(self) -> None:
        await self.transport.connect()

        # MCP initialize handshake
        resp = await self.transport.send(_rpc("initialize", {
            "protocolVersion": self.PROTOCOL_VERSION,
            "capabilities": {
                "tools": {},
                "prompts": {},
                "resources": {},
            },
            "clientInfo": {"name": "yuno-platform", "version": "1.0.0"},
        }))

        if "error" in resp:
            raise RuntimeError(f"MCP init failed: {resp['error']}")

        result = resp.get("result", {})
        self.capabilities = result.get("capabilities", {})

        # Send initialized notification
        await self.transport.notify(_rpc("notifications/initialized"))

        # Discover capabilities
        await self._discover()
        self._initialized = True
        logger.info("MCP session %s initialized, tools=%d prompts=%d resources=%d",
                    self.server_id, len(self.tools), len(self.prompts), len(self.resources))

    async def _discover(self) -> None:
        """Discover all available tools, prompts, and resources."""
        # Tools
        if self.capabilities.get("tools"):
            try:
                resp = await self.transport.send(_rpc("tools/list"))
                self.tools = resp.get("result", {}).get("tools", [])
            except Exception as e:
                logger.warning("Tool discovery failed for %s: %s", self.server_id, e)

        # Prompts
        if self.capabilities.get("prompts"):
            try:
                resp = await self.transport.send(_rpc("prompts/list"))
                self.prompts = resp.get("result", {}).get("prompts", [])
            except Exception as e:
                logger.warning("Prompt discovery failed: %s", e)

        # Resources
        if self.capabilities.get("resources"):
            try:
                resp = await self.transport.send(_rpc("resources/list"))
                self.resources = resp.get("result", {}).get("resources", [])
            except Exception as e:
                logger.warning("Resource discovery failed: %s", e)

    async def call_tool(self, tool_name: str, arguments: dict) -> Any:
        """Execute a tool and return its result."""
        resp = await self.transport.send(_rpc("tools/call", {
            "name": tool_name,
            "arguments": arguments,
        }))
        if "error" in resp:
            raise RuntimeError(f"MCP tool error: {resp['error']}")
        result = resp.get("result", {})
        # Extract text content
        content = result.get("content", [])
        if isinstance(content, list):
            return "\n".join(
                item.get("text", str(item)) for item in content
                if isinstance(item, dict)
            )
        return str(result)

    async def get_prompt(self, prompt_name: str, arguments: dict | None = None) -> str:
        """Retrieve a prompt template from the server."""
        resp = await self.transport.send(_rpc("prompts/get", {
            "name": prompt_name,
            "arguments": arguments or {},
        }))
        if "error" in resp:
            raise RuntimeError(f"MCP prompt error: {resp['error']}")
        messages = resp.get("result", {}).get("messages", [])
        return "\n".join(m.get("content", {}).get("text", "") for m in messages)

    async def read_resource(self, resource_uri: str) -> str:
        """Read a resource by URI."""
        resp = await self.transport.send(_rpc("resources/read", {"uri": resource_uri}))
        if "error" in resp:
            raise RuntimeError(f"MCP resource error: {resp['error']}")
        contents = resp.get("result", {}).get("contents", [])
        return "\n".join(c.get("text", str(c)) for c in contents)

    async def close(self) -> None:
        await self.transport.disconnect()

    def to_langchain_tools(self, whitelist: list | None = None) -> List[StructuredTool]:
        """Wrap discovered MCP tools as LangChain StructuredTools."""
        result = []
        for tool_def in self.tools:
            name = tool_def.get("name", "")
            if whitelist and name not in whitelist:
                continue
            description = tool_def.get("description", "MCP tool")
            input_schema = tool_def.get("inputSchema", {"type": "object", "properties": {}})
            session_ref = self

            # Build a dynamic function that calls the MCP tool
            async def _call(**kwargs: Any) -> str:
                try:
                    return await session_ref.call_tool(name, kwargs)
                except Exception as e:
                    return f"[MCP tool error: {e}]"

            # Create a Pydantic args_schema from the input schema
            fields: dict = {}
            for prop_name, prop_def in input_schema.get("properties", {}).items():
                fields[prop_name] = (str, Field(description=prop_def.get("description", "")))

            ArgsModel = type(f"Args_{name}", (BaseModel,), {"__annotations__": {k: str for k in fields}})

            lc_tool = StructuredTool(
                name=f"mcp_{self.server_id[:8]}_{name}",
                description=f"[MCP:{name}] {description}",
                coroutine=_call,
                args_schema=ArgsModel,
            )
            result.append(lc_tool)
        return result


# ─── Client Manager (singleton) ───────────────────────────────────────────────

class MCPClientManager:
    """
    Manages all active MCP server connections.
    Loaded at startup from the database; connections are maintained in memory.
    """

    def __init__(self):
        self._sessions: Dict[str, MCPSession] = {}

    def _build_transport(self, server: dict) -> MCPTransport:
        transport = server.get("transport", "stdio")
        if transport == "stdio":
            return StdioTransport(
                command=server.get("command", ""),
                args=server.get("args", []),
                env=server.get("env", {}),
            )
        elif transport == "sse":
            return SSETransport(url=server["url"])
        elif transport == "websocket":
            return WebSocketTransport(url=server["url"])
        else:
            raise ValueError(f"Unknown MCP transport: {transport}")

    async def connect(self, server: dict) -> dict:
        """
        Connect to an MCP server. server is a plain dict from the DB row.
        Returns updated capability dict.
        """
        server_id = server["id"]

        # Disconnect existing session if any
        if server_id in self._sessions:
            await self.disconnect(server_id)

        transport = self._build_transport(server)
        session = MCPSession(server_id, transport)
        await session.initialize()
        self._sessions[server_id] = session

        return {
            "tools": session.tools,
            "prompts": session.prompts,
            "resources": session.resources,
        }

    async def disconnect(self, server_id: str) -> None:
        if server_id in self._sessions:
            try:
                await self._sessions[server_id].close()
            except Exception:
                pass
            del self._sessions[server_id]

    def get_session(self, server_id: str) -> MCPSession | None:
        return self._sessions.get(server_id)

    def get_tools_for_agent(
        self,
        mcp_server_ids: list,
        whitelist: list | None = None,
    ) -> List[StructuredTool]:
        """Return LangChain tools from all bound MCP servers for an agent."""
        tools: List[StructuredTool] = []
        for server_id in mcp_server_ids:
            session = self._sessions.get(server_id)
            if session and session._initialized:
                tools.extend(session.to_langchain_tools(whitelist or None))
        return tools

    async def reload_all(self, servers: list) -> dict:
        """Reconnect all active MCP servers from a list of DB rows."""
        statuses = {}
        for server in servers:
            if not server.get("is_active"):
                continue
            try:
                await self.connect(server)
                statuses[server["id"]] = "connected"
            except Exception as e:
                logger.error("MCP connect failed %s: %s", server.get("name"), e)
                statuses[server["id"]] = f"error: {e}"
        return statuses

    @property
    def connected_count(self) -> int:
        return len(self._sessions)


# Singleton
mcp_manager = MCPClientManager()
