"""Tests for Workflow CRUD and run lifecycle."""
import pytest


async def _create_agent(client, name="WorkflowAgent"):
    resp = await client.post("/api/v1/agents", json={
        "name": name,
        "system_prompt": "You are a helpful agent.",
        "model": "gpt-4o-mini",
    })
    assert resp.status_code == 201
    return resp.json()


@pytest.mark.asyncio
async def test_create_workflow(client):
    resp = await client.post("/api/v1/workflows", json={
        "name": "TestWorkflow",
        "description": "A test workflow",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "TestWorkflow"
    assert data["nodes"] == []
    assert data["edges"] == []


@pytest.mark.asyncio
async def test_list_workflows(client):
    await client.post("/api/v1/workflows", json={"name": "WF1"})
    await client.post("/api/v1/workflows", json={"name": "WF2"})
    resp = await client.get("/api/v1/workflows")
    assert resp.status_code == 200
    names = [w["name"] for w in resp.json()]
    assert "WF1" in names
    assert "WF2" in names


@pytest.mark.asyncio
async def test_get_workflow_not_found(client):
    resp = await client.get("/api/v1/workflows/bad-id")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_update_workflow_nodes(client):
    agent = await _create_agent(client, "NodeAgent")
    wf_resp = await client.post("/api/v1/workflows", json={"name": "NodeWF"})
    wf_id = wf_resp.json()["id"]

    nodes = [{
        "id": "node_0",
        "agent_id": agent["id"],
        "position": {"x": 100, "y": 200},
        "data": {"label": agent["name"]},
    }]
    resp = await client.put(f"/api/v1/workflows/{wf_id}", json={
        "nodes": nodes,
        "entry_point": "node_0",
    })
    assert resp.status_code == 200
    assert len(resp.json()["nodes"]) == 1
    assert resp.json()["entry_point"] == "node_0"


@pytest.mark.asyncio
async def test_delete_workflow(client):
    wf_resp = await client.post("/api/v1/workflows", json={"name": "DeleteWF"})
    wf_id = wf_resp.json()["id"]

    resp = await client.delete(f"/api/v1/workflows/{wf_id}")
    assert resp.status_code == 204

    get_resp = await client.get(f"/api/v1/workflows/{wf_id}")
    assert get_resp.status_code == 404


@pytest.mark.asyncio
async def test_run_workflow_no_nodes_returns_400(client):
    wf_resp = await client.post("/api/v1/workflows", json={"name": "EmptyWF"})
    wf_id = wf_resp.json()["id"]

    resp = await client.post(f"/api/v1/workflows/{wf_id}/run", json={"message": "hello"})
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_list_runs(client):
    resp = await client.get("/api/v1/runs")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


@pytest.mark.asyncio
async def test_workflow_multi_edge(client):
    """Verify a workflow with conditional edges can be saved correctly."""
    a1 = await _create_agent(client, "ClassifierAgent")
    a2 = await _create_agent(client, "HandlerAgent")

    wf_resp = await client.post("/api/v1/workflows", json={"name": "ConditionalWF"})
    wf_id = wf_resp.json()["id"]

    nodes = [
        {"id": "node_0", "agent_id": a1["id"], "position": {"x": 0, "y": 0}, "data": {}},
        {"id": "node_1", "agent_id": a2["id"], "position": {"x": 280, "y": 0}, "data": {}},
    ]
    edges = [
        {"id": "e0", "source": "node_0", "target": "node_1", "condition": "contains:ROUTE", "label": ""},
    ]
    resp = await client.put(f"/api/v1/workflows/{wf_id}", json={
        "nodes": nodes, "edges": edges, "entry_point": "node_0",
    })
    assert resp.status_code == 200
    saved_edges = resp.json()["edges"]
    assert saved_edges[0]["condition"] == "contains:ROUTE"
