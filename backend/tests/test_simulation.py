"""API tests for the simulation engine and existing endpoints."""

import pytest
from fastapi.testclient import TestClient

from app.main import app

CELLULAR_LINK = "link-ship-cellular"
SAT_LINK = "link-ship-sat"
TERRESTRIAL_NODES = ["ship-1", "base-station-1", "internet-1"]
SATELLITE_NODES = ["ship-1", "satellite-1", "sat-gateway-1", "internet-1"]


@pytest.fixture()
def client() -> TestClient:
    test_client = TestClient(app)
    test_client.post("/api/simulation/reset")
    return test_client


def _state(client: TestClient) -> dict:
    res = client.get("/api/simulation/state")
    assert res.status_code == 200
    return res.json()


def _events(client: TestClient) -> list[dict]:
    res = client.get("/api/simulation/events")
    assert res.status_code == 200
    return res.json()["events"]


def test_existing_health_endpoint(client: TestClient) -> None:
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok", "service": "NexusLayer Simulation API"}


def test_existing_topology_endpoint(client: TestClient) -> None:
    res = client.get("/api/topology")
    assert res.status_code == 200
    body = res.json()
    assert len(body["nodes"]) == 5
    assert len(body["links"]) == 5


def test_1_initial_terrestrial_connectivity(client: TestClient) -> None:
    state = _state(client)
    assert state["connectivity"] == "connected"
    route = state["active_route"]
    assert route is not None
    assert route["node_ids"] == TERRESTRIAL_NODES
    assert route["latency_ms"] == pytest.approx(45.0)
    assert route["bandwidth_mbps"] == pytest.approx(50.0)
    assert route["reliability"] == pytest.approx(0.92 * 0.995)
    assert len(state["backup_routes"]) == 1


def test_2_terrestrial_link_failure(client: TestClient) -> None:
    res = client.post("/api/simulation/fail-link", json={"link_id": CELLULAR_LINK})
    assert res.status_code == 200
    state = res.json()
    cellular = next(link for link in state["links"] if link["id"] == CELLULAR_LINK)
    assert cellular["status"] == "down"
    assert cellular["on_active_route"] is False
    types = [e["type"] for e in _events(client)]
    assert "link_failed" in types


def test_3_satellite_failover(client: TestClient) -> None:
    client.post("/api/simulation/fail-link", json={"link_id": CELLULAR_LINK})
    state = _state(client)
    assert state["connectivity"] == "degraded"
    route = state["active_route"]
    assert route is not None
    assert route["node_ids"] == SATELLITE_NODES
    assert route["latency_ms"] == pytest.approx(855.0)
    assert route["bandwidth_mbps"] == pytest.approx(20.0)
    assert route["reliability"] == pytest.approx(0.98 * 0.99 * 0.999)
    types = [e["type"] for e in _events(client)]
    assert "failover" in types


def test_4_all_routes_failed_reports_connectivity_loss(client: TestClient) -> None:
    client.post("/api/simulation/fail-link", json={"link_id": CELLULAR_LINK})
    client.post("/api/simulation/fail-link", json={"link_id": SAT_LINK})
    state = _state(client)
    assert state["connectivity"] == "disconnected"
    assert state["active_route"] is None
    assert state["backup_routes"] == []
    types = [e["type"] for e in _events(client)]
    assert "connectivity_lost" in types
    assert "failover" not in types[types.index("connectivity_lost") :]


def test_5_terrestrial_restoration(client: TestClient) -> None:
    client.post("/api/simulation/fail-link", json={"link_id": CELLULAR_LINK})
    res = client.post("/api/simulation/restore-link", json={"link_id": CELLULAR_LINK})
    assert res.status_code == 200
    state = res.json()
    assert state["connectivity"] == "connected"
    assert state["active_route"]["node_ids"] == TERRESTRIAL_NODES
    cellular = next(link for link in state["links"] if link["id"] == CELLULAR_LINK)
    assert cellular["status"] == "up"
    types = [e["type"] for e in _events(client)]
    assert "link_restored" in types
    assert "failback" in types


def test_6_reset_restores_original_topology(client: TestClient) -> None:
    client.post("/api/simulation/start")
    client.post("/api/simulation/fail-link", json={"link_id": CELLULAR_LINK})
    res = client.post("/api/simulation/reset")
    assert res.status_code == 200
    state = res.json()
    assert state["status"] == "idle"
    assert state["tick"] == 0
    assert state["connectivity"] == "connected"
    assert state["active_route"]["node_ids"] == TERRESTRIAL_NODES
    assert all(link["status"] == "up" for link in state["links"])
    assert all(node["reachable"] for node in state["nodes"])
    events = _events(client)
    assert [e["type"] for e in events] == ["reset"]


def test_7_invalid_link_identifiers(client: TestClient) -> None:
    for path in ("/api/simulation/fail-link", "/api/simulation/restore-link"):
        res = client.post(path, json={"link_id": "link-does-not-exist"})
        assert res.status_code == 404
    # Failed actions must not disturb healthy state.
    state = _state(client)
    assert state["connectivity"] == "connected"


def test_8_repeated_start_pause_reset_are_idempotent(client: TestClient) -> None:
    client.post("/api/simulation/start")
    client.post("/api/simulation/start")
    state = _state(client)
    assert state["status"] == "running"
    assert [e["type"] for e in _events(client)].count("started") == 1

    client.post("/api/simulation/pause")
    client.post("/api/simulation/pause")
    state = _state(client)
    assert state["status"] == "paused"
    assert [e["type"] for e in _events(client)].count("paused") == 1

    client.post("/api/simulation/reset")
    first = _state(client)
    first_events = _events(client)
    client.post("/api/simulation/reset")
    assert _state(client) == first
    second_events = _events(client)
    # Timestamps are wall-clock; everything else must be identical.
    strip = lambda evts: [(e["seq"], e["type"], e["message"]) for e in evts]
    assert strip(second_events) == strip(first_events)


def test_events_are_chronological(client: TestClient) -> None:
    client.post("/api/simulation/start")
    client.post("/api/simulation/fail-link", json={"link_id": CELLULAR_LINK})
    client.post("/api/simulation/restore-link", json={"link_id": CELLULAR_LINK})
    events = _events(client)
    assert [e["seq"] for e in events] == sorted(e["seq"] for e in events)
    assert len({e["seq"] for e in events}) == len(events)
