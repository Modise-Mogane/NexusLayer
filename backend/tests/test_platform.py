"""API tests for scenarios, hardware, research, agents, validation."""

import os
import tempfile

import pytest
from fastapi.testclient import TestClient

# Isolate persistence per test session before importing the app.
_tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_tmp.close()
os.environ["NEXUS_DB_PATH"] = _tmp.name

from app.database import init_db  # noqa: E402
from app.main import app  # noqa: E402

init_db()


@pytest.fixture()
def client() -> TestClient:
    test_client = TestClient(app)
    test_client.post("/api/simulation/reset")
    return test_client


def _topology(client: TestClient) -> dict:
    res = client.get("/api/topology")
    assert res.status_code == 200
    return res.json()


def test_hardware_library_lists_representative_devices(client: TestClient):
    res = client.get("/api/hardware")
    assert res.status_code == 200
    devices = res.json()
    ids = {d["device_id"] for d in devices}
    assert "gen-basestation-lte-01" in ids
    assert "gen-vsat-maritime-01" in ids
    assert "gen-gateway-multiwan-01" in ids
    assert "gen-ship-comms-01" in ids
    res = client.get("/api/hardware", params={"search": "base station"})
    assert res.status_code == 200
    assert any("base" in d["device_id"] for d in res.json())


def test_hardware_spec_create_and_feasibility(client: TestClient):
    spec = {
        "device_id": "test-gateway-01",
        "name": "Test Gateway",
        "category": "gateway",
        "family": "networking",
        "model_identifier": "TEST-GW-1",
        "interfaces": [
            {"name": "cellular", "technology": "Cellular (LTE)", "max_throughput_mbps": 150},
            {"name": "sat", "technology": "VSAT (GEO)", "max_throughput_mbps": 50},
        ],
        "throughput_mbps": 40,
        "tx_power_dbm": 30,
        "rx_sensitivity_dbm": -100,
    }
    res = client.post("/api/hardware/check", json=spec)
    assert res.status_code == 200
    assert res.json()["verdict"] in ("feasible_spec", "needs_review")
    res = client.post("/api/hardware", json=spec)
    assert res.status_code == 200
    assert res.json()["device_id"] == "test-gateway-01"
    res = client.get("/api/hardware/test-gateway-01")
    assert res.status_code == 200


def test_scenario_crud_and_duplicate(client: TestClient):
    topo = _topology(client)
    res = client.post("/api/scenarios", json={"name": "Test Scenario", "environment": "maritime", "topology": topo})
    assert res.status_code == 200
    sid = res.json()["id"]
    res = client.get(f"/api/scenarios/{sid}")
    assert res.status_code == 200
    assert res.json()["name"] == "Test Scenario"
    res = client.post(f"/api/scenarios/{sid}/duplicate", json={})
    assert res.status_code == 200
    assert res.json()["id"] != sid
    res = client.delete(f"/api/scenarios/{sid}")
    assert res.status_code == 200
    res = client.get(f"/api/scenarios/{sid}")
    assert res.status_code == 404


def test_maritime_seed_and_templates(client: TestClient):
    res = client.get("/api/scenarios")
    assert res.status_code == 200
    assert any(s["id"] == "maritime_failover" for s in res.json())
    res = client.get("/api/scenarios/templates")
    assert res.status_code == 200
    assert "maritime" in res.json()["templates"]
    res = client.post("/api/scenarios/from-template/rural")
    assert res.status_code == 200
    assert res.json()["environment"] == "rural"


def test_research_submit_assess_review(client: TestClient):
    res = client.post("/api/research", json={
        "title": "Passive LTE to satellite adapter concept",
        "category": "hypothesis",
        "problem": "A passive adapter converts LTE radio directly into satellite communication.",
        "assumptions": "None stated.",
    })
    assert res.status_code == 200
    fid = res.json()["id"]
    res = client.post(f"/api/research/{fid}/assess")
    assert res.status_code == 200
    assert res.json()["verdict"] == "contradicted"
    res = client.get(f"/api/research/{fid}/assessments")
    assert res.status_code == 200
    assert len(res.json()) >= 1
    res = client.post(f"/api/research/{fid}/review", json={"status": "rejected"})
    assert res.status_code == 200
    assert res.json()["status"] == "rejected"


def test_agents_run_deterministic_without_credentials(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("MODEL_API_KEY", raising=False)
    monkeypatch.delenv("META_MODEL_API_KEY", raising=False)
    monkeypatch.delenv("META_MODEL", raising=False)
    monkeypatch.delenv("MODEL_BASE_URL", raising=False)
    res = client.get("/api/agents/status")
    assert res.status_code == 200
    assert "architect" in res.json()["capabilities"]
    res = client.post("/api/agents/run", json={
        "capability": "connectivity",
        "prompt": "pick a route",
        "context": {
            "policy": "lowest_latency",
            "routes": [
                {"node_ids": ["a", "b"], "link_ids": ["l1"], "latency_ms": 10, "bandwidth_mbps": 50, "reliability": 0.9},
                {"node_ids": ["a", "c"], "link_ids": ["l2"], "latency_ms": 99, "bandwidth_mbps": 50, "reliability": 0.9},
            ],
        },
    })
    assert res.status_code == 200
    body = res.json()
    assert body["provenance"].startswith("local_deterministic")
    assert body["result"]["local"]["selected_link_ids"] == ["l1"]
    assert body["result"]["ai"] is None
    res = client.post("/api/agents/run", json={"capability": "hardware", "prompt": "LTE and satellite gateway for a ship"})
    assert res.status_code == 200
    assert res.json()["result"]["local"]["concept"] is not None
    res = client.post("/api/agents/verify")
    assert res.status_code == 200
    assert res.json()["verified"] is False
    assert "MODEL_API_KEY" not in res.text and "Bearer" not in res.text


def test_architecture_validation_flags_disconnected(client: TestClient):
    topo = _topology(client)
    topo["nodes"].append({"id": "lonely-1", "type": "sensor", "label": "Lonely sensor"})
    res = client.post("/api/architecture/validate", json=topo)
    assert res.status_code == 200
    body = res.json()
    assert body["valid"] is False
    assert any(i["code"] == "disconnected_node" for i in body["issues"])


def test_step_and_policy_and_analysis_endpoints(client: TestClient):
    res = client.post("/api/simulation/step", json={"ticks": 2, "dt_seconds": 60})
    assert res.status_code == 200
    assert res.json()["tick"] >= 2
    res = client.post("/api/simulation/policy", json={"policy": "lowest_cost"})
    assert res.status_code == 200
    assert res.json()["routing_policy"] == "lowest_cost"
    res = client.post("/api/simulation/policy", json={"policy": "nope"})
    assert res.status_code == 400
    res = client.get("/api/simulation/analysis")
    assert res.status_code == 200
    assert "handover_history" in res.json()


def test_stale_scenario_save_is_rejected(client: TestClient):
    created = client.post('/api/scenarios', json={'name': 'Concurrent', 'environment': 'maritime', 'topology': _topology(client)}).json()
    path = f"/api/scenarios/{created['id']}"
    first = {'name': 'First edit', 'environment': 'maritime', 'topology': created['topology'], 'expected_version': created['version']}
    stale = {**first, 'name': 'Stale edit'}
    assert client.put(path, json=first).status_code == 200
    assert client.put(path, json=stale).status_code == 409
    assert client.get(path).json()['name'] == 'First edit'


def test_legacy_seed_is_preserved_when_seed_revision_increases(monkeypatch, tmp_path):
    monkeypatch.setenv("NEXUS_DB_PATH", str(tmp_path / "seeds.db"))
    from app import scenarios
    original = scenarios.ensure_world_seed()
    assert original is not None
    edited = scenarios.save_scenario('Custom world', original.environment, original.topology,
                                     sid=original.id, expected_version=original.version)
    monkeypatch.setattr(scenarios, 'WORLD_SEED_VERSION', edited.version + 10)
    after = scenarios.ensure_world_seed()
    assert after.name == 'Custom world'
    assert after.version == edited.version
