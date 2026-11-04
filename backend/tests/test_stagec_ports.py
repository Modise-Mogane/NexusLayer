"""Tests for Phase 2C Stage A2/A3: ports, compatibility, PATCH, link physics."""

import copy

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app import compatibility, phy, scenarios, validation
from app.main import app
from app.models import LinkSecurityConfig, NodePortConfig, Topology
from app.simulation import SimulationSession
from app.topology import load_topology


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app)


def _port(name="eth0", kind="ethernet", **kw):
    data = {"name": name, "kind": kind, "technology": kind}
    data.update(kw)
    return NodePortConfig.model_validate(data).model_dump()


# -- model validation ------------------------------------------------------

def test_port_kind_and_ranges_validated():
    with pytest.raises(ValidationError):
        NodePortConfig.model_validate({"name": "x", "kind": "quantum"})
    with pytest.raises(ValidationError):
        NodePortConfig.model_validate({"name": "x", "kind": "ethernet", "vlan": 5000})
    with pytest.raises(ValidationError):
        NodePortConfig.model_validate({"name": "x", "kind": "ethernet", "mtu": 0})
    with pytest.raises(ValidationError):
        NodePortConfig.model_validate({"name": "x", "kind": "ethernet", "duplex": "sideways"})
    ok = NodePortConfig.model_validate({"name": "e", "kind": "ethernet", "vlan": 10})
    assert ok.vlan == 10
    with pytest.raises(ValidationError):
        LinkSecurityConfig.model_validate({"protocol": "WPA3", "scope": "planetary"})


# -- port-pair compatibility -------------------------------------------------

def test_port_pair_matrix():
    assert compatibility.check_port_pair(None, None).compatible
    assert compatibility.check_port_pair(
        _port("a", "ethernet"), _port("b", "ethernet")).compatible
    assert not compatibility.check_port_pair(
        _port("a", "ethernet", enabled=False), _port("b", "ethernet")).compatible
    assert not compatibility.check_port_pair(
        _port("a", "ethernet"), _port("b", "wifi")).compatible
    assert compatibility.check_port_pair(
        _port("a", "ethernet"), _port("b", "wifi"), experimental=True).compatible
    assert not compatibility.check_port_pair(
        _port("a", "cellular"), _port("b", "satellite")).compatible
    assert not compatibility.check_port_pair(
        _port("a", "power"), _port("b", "ethernet")).compatible
    # Same-kind parameter checks.
    assert not compatibility.check_port_pair(
        _port("a", "wifi", channel="6"), _port("b", "wifi", channel="11")).compatible
    assert compatibility.check_port_pair(
        _port("a", "wifi", channel="6"), _port("b", "wifi", channel="6")).compatible
    assert not compatibility.check_port_pair(
        _port("a", "fiber", wavelength_nm=1310.0),
        _port("b", "fiber", wavelength_nm=1550.0)).compatible
    assert not compatibility.check_port_pair(
        _port("a", "cellular", bands=["B3"]), _port("b", "cellular", bands=["B28"])).compatible
    assert compatibility.check_port_pair(
        _port("a", "cellular", bands=["B3"]), _port("b", "cellular", bands=["B3", "B28"])).compatible


def test_port_check_endpoint(client):
    res = client.post("/api/compatibility/check-ports", json={
        "source_port": {"name": "eth0", "kind": "ethernet"},
        "target_port": {"name": "wlan0", "kind": "wifi"},
    })
    assert res.status_code == 200
    assert res.json()["compatible"] is False
    assert "conversion device" in res.json()["reason"]


# -- PATCH endpoints ---------------------------------------------------------

def test_patch_node_and_link_round_trip(client):
    scenarios.ensure_maritime_seed()
    dup = scenarios.duplicate_scenario("maritime_failover", "port-test-temp")
    sid = dup.id
    try:
        res = client.patch(f"/api/scenarios/{sid}/nodes/ship-1", json={
            "label": "Vessel MV Nexus",
            "ports": [
                {"name": "eth0", "kind": "ethernet", "technology": "Ethernet",
                 "speed_mbps": 1000, "vlan": 10},
                {"name": "lte0", "kind": "cellular", "technology": "Cellular (LTE)",
                 "bands": ["B3"], "tx_power_dbm": 23.0},
            ],
        })
        assert res.status_code == 200, res.text
        node = next(n for n in res.json()["topology"]["nodes"] if n["id"] == "ship-1")
        assert [p["name"] for p in node["ports"]] == ["eth0", "lte0"]
        # Reload persists.
        fetched = client.get(f"/api/scenarios/{sid}").json()
        node2 = next(n for n in fetched["topology"]["nodes"] if n["id"] == "ship-1")
        assert node2["ports"][0]["vlan"] == 10
        # Duplicate port names rejected.
        bad = client.patch(f"/api/scenarios/{sid}/nodes/ship-1", json={
            "ports": [
                {"name": "eth0", "kind": "ethernet"},
                {"name": "eth0", "kind": "wifi"},
            ],
        })
        assert bad.status_code == 400
        # Link patch with ports + security + protocols.
        res = client.patch(f"/api/scenarios/{sid}/links/link-ship-cellular", json={
            "source_port": "lte0",
            "protocols": ["IPv4", "TCP"],
            "security": {"protocol": "5G-AKA", "scope": "link", "enabled": True,
                         "confidentiality": True, "integrity": True},
        })
        assert res.status_code == 200, res.text
        link = next(
            l for l in res.json()["topology"]["links"] if l["id"] == "link-ship-cellular"
        )
        assert link["source_port"] == "lte0"
        assert link["security"]["protocol"] == "5G-AKA"
        assert link["security"]["confidentiality"] is True
        # Bad security scope rejected; new radio kinds accepted.
        bad_sec = client.patch(f"/api/scenarios/{sid}/links/link-ship-cellular", json={
            "security": {"protocol": "WPA3", "scope": "end_to_end"},
        })
        assert bad_sec.status_code == 422
        res = client.patch(f"/api/scenarios/{sid}/nodes/ship-1", json={
            "ports": [{"name": "mw0", "kind": "microwave"}],
        })
        assert res.status_code == 200, res.text
        # Unknown ids 404.
        assert client.patch(f"/api/scenarios/{sid}/nodes/nope", json={}).status_code == 404
        assert client.patch(f"/api/scenarios/{sid}/links/nope", json={}).status_code == 404
        assert client.patch("/api/scenarios/nope/nodes/ship-1", json={}).status_code == 404
    finally:
        scenarios.delete_scenario(sid)


def test_patch_maritime_forks_instead_of_mutating(client):
    scenarios.ensure_maritime_seed()
    before = scenarios.get_scenario("maritime_failover")
    assert before is not None
    res = client.patch(
        "/api/scenarios/maritime_failover/nodes/ship-1",
        json={"label": "Fork probe"},
    )
    assert res.status_code == 200, res.text
    fork_id = res.json()["id"]
    assert fork_id != "maritime_failover"
    try:
        seed = scenarios.get_scenario("maritime_failover")
        assert seed is not None
        ship = next(n for n in seed.topology.nodes if n.id == "ship-1")
        assert ship.label != "Fork probe"
    finally:
        scenarios.delete_scenario(fork_id)


def test_validation_flags_port_problems():
    topo = load_topology()
    data = topo.model_dump()
    data["nodes"][0]["ports"] = [{"name": "eth0", "kind": "ethernet"}]
    data["links"][0]["source_port"] = "missing-port"
    result = validation.validate_topology(Topology.model_validate(data))
    assert any(i["code"] == "unknown_port" for i in result["issues"])


def test_simulation_rejects_incompatible_ports():
    topo = load_topology()
    data = topo.model_dump()
    nodes = {n["id"]: n for n in data["nodes"]}
    link = next(l for l in data["links"] if l["id"] == "link-ship-cellular")
    nodes[link["source"]]["ports"] = [{"name": "e0", "kind": "ethernet"}]
    nodes[link["target"]]["ports"] = [{"name": "w0", "kind": "wifi"}]
    link["source_port"] = "e0"
    link["target_port"] = "w0"
    session = SimulationSession(
        topology=Topology.model_validate(data), scenario_id="port-test")
    state = session.get_state()
    assert state.active_route is not None
    assert "link-ship-cellular" not in state.active_route.link_ids
    # Experimental flag restores eligibility.
    link["experimental"] = True
    session2 = SimulationSession(
        topology=Topology.model_validate(copy.deepcopy(data)), scenario_id="port-test-2")
    assert "link-ship-cellular" in (session2.get_state().active_route.link_ids or [])


def test_physics_explains_radio_link():
    scenarios.ensure_maritime_seed()
    detail = scenarios.get_scenario("maritime_failover")
    assert detail is not None
    view = phy.explain_link(detail.topology, "link-ship-cellular")
    assert view["family"] == "cellular"
    assert "base station" in view["medium_explainer"]["mechanism"][0].lower()
    assert view["distance_km"] is not None and view["distance_km"] > 0
    assert view["frequency_mhz"] == 1800.0
    assert view["wavelength_m"] is not None
    budget = next(c for c in view["calculations"] if c["id"] == "link_budget")
    assert budget["status"] == "calculated"
    assert any(o["label"] == "Received power" for o in budget["outputs"])
    assert any("Free-space" in a for a in budget["assumptions"])
    delay = next(c for c in view["calculations"] if c["id"] == "propagation_delay")
    assert delay["status"] == "calculated"
    snr = next(c for c in view["calculations"] if c["id"] == "snr")
    assert snr["status"] == "not_calculated"
    assert any("noise" in m.lower() for m in snr["missing"])
    assert any("3GPP" in r["label"] for r in view["references"])
    with pytest.raises(KeyError):
        phy.explain_link(detail.topology, "link-nope")


def test_physics_honest_without_geometry():
    topo = load_topology()
    data = topo.model_dump()
    for node in data["nodes"]:
        node["world_position"] = None
    view = phy.explain_link(Topology.model_validate(data), "link-ship-cellular")
    assert view["distance_km"] is None
    budget = next(c for c in view["calculations"] if c["id"] == "link_budget")
    assert budget["status"] == "not_calculated"
    assert any("world positions" in m for m in budget["missing"])


def test_physics_endpoint_round_trip(client):
    scenarios.ensure_maritime_seed()
    res = client.get("/api/scenarios/maritime_failover/links/link-ship-sat/physics")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["family"] == "satellite"
    assert body["live"] is not None
    assert "mechanism" in body["medium_explainer"]
    assert client.get("/api/scenarios/maritime_failover/links/nope/physics").status_code == 404
    assert client.get("/api/scenarios/nope/links/link-ship-cellular/physics").status_code == 404


def test_simulation_rejects_disabled_port():
    topo = load_topology()
    data = topo.model_dump()
    nodes = {n["id"]: n for n in data["nodes"]}
    link = next(l for l in data["links"] if l["id"] == "link-ship-cellular")
    nodes[link["source"]]["ports"] = [{"name": "e0", "kind": "ethernet", "enabled": False}]
    nodes[link["target"]]["ports"] = [{"name": "e1", "kind": "ethernet"}]
    link["source_port"] = "e0"
    link["target_port"] = "e1"
    session = SimulationSession(
        topology=Topology.model_validate(data), scenario_id="port-test-3")
    assert "link-ship-cellular" not in (session.get_state().active_route.link_ids or [])
