"""Tests for Agent CRUD operations."""
import pytest
import pytest_asyncio


@pytest.mark.asyncio
async def test_list_agents_empty(client):
    resp = await client.get("/api/v1/agents")
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_create_agent(client):
    payload = {
        "name": "TestAgent",
        "role": "assistant",
        "system_prompt": "You are a test agent.",
        "model": "gpt-4o-mini",
        "temperature": 0.5,
        "max_tokens": 1024,
        "tools": ["calculator"],
        "memory_enabled": True,
        "memory_window": 5,
    }
    resp = await client.post("/api/v1/agents", json=payload)
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "TestAgent"
    assert data["tools"] == ["calculator"]
    assert "id" in data
    return data


@pytest.mark.asyncio
async def test_get_agent(client):
    # Create first
    create_resp = await client.post("/api/v1/agents", json={
        "name": "GetAgent", "system_prompt": "test"
    })
    agent_id = create_resp.json()["id"]

    resp = await client.get(f"/api/v1/agents/{agent_id}")
    assert resp.status_code == 200
    assert resp.json()["id"] == agent_id


@pytest.mark.asyncio
async def test_get_agent_not_found(client):
    resp = await client.get("/api/v1/agents/nonexistent-id")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_update_agent(client):
    create_resp = await client.post("/api/v1/agents", json={
        "name": "UpdateAgent", "system_prompt": "original"
    })
    agent_id = create_resp.json()["id"]

    resp = await client.put(f"/api/v1/agents/{agent_id}", json={
        "name": "UpdatedAgent",
        "system_prompt": "updated prompt",
    })
    assert resp.status_code == 200
    assert resp.json()["name"] == "UpdatedAgent"
    assert resp.json()["system_prompt"] == "updated prompt"


@pytest.mark.asyncio
async def test_delete_agent(client):
    create_resp = await client.post("/api/v1/agents", json={
        "name": "DeleteAgent", "system_prompt": "delete me"
    })
    agent_id = create_resp.json()["id"]

    resp = await client.delete(f"/api/v1/agents/{agent_id}")
    assert resp.status_code == 204

    get_resp = await client.get(f"/api/v1/agents/{agent_id}")
    assert get_resp.status_code == 404


@pytest.mark.asyncio
async def test_list_available_tools(client):
    resp = await client.get("/api/v1/agents/tools")
    assert resp.status_code == 200
    tools = resp.json()
    assert isinstance(tools, list)
    tool_names = [t["name"] for t in tools]
    assert "calculator" in tool_names
    assert "web_search" in tool_names


@pytest.mark.asyncio
async def test_agent_with_channels(client):
    resp = await client.post("/api/v1/agents", json={
        "name": "TelegramAgent",
        "system_prompt": "test",
        "channels": [{"channel": "telegram"}],
    })
    assert resp.status_code == 201
    assert resp.json()["channels"] == [{"channel": "telegram"}]


@pytest.mark.asyncio
async def test_agent_validation(client):
    # Name is required
    resp = await client.post("/api/v1/agents", json={"system_prompt": "test"})
    assert resp.status_code == 422

    # Temperature bounds
    resp = await client.post("/api/v1/agents", json={
        "name": "Bad", "temperature": 5.0
    })
    assert resp.status_code == 422
