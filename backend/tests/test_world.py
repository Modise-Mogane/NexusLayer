"""Tests for the shared multi-device world on the shared engine."""

import pytest
from fastapi.testclient import TestClient

from app import scenarios
from app.main import app
from app.simulation import SimulationSession
from app.world import build_shared_world_topology


@pytest.fixture()
def world_topology():
    return build_shared_world_topology()


@pytest.fixture()
def client() -> TestClient:
    test_client = TestClient(app)
    test_client.post("/api/simulation/reset")
    return test_client


def _ep(state, endpoint_id):
    return next(e for e in state.endpoint_routes if e.endpoint_id == endpoint_id)


def test_world_seed_persists():
    detail = scenarios.ensure_world_seed()
    assert detail is not None
    assert detail.id == "shared_world"
    assert detail.topology.metadata.environment == "shared_world"


def test_world_routes_all_endpoints_terrestrial_first(world_topology):
    session = SimulationSession(topology=world_topology, scenario_id="world-test")
    state = session.get_state()
    assert [e.endpoint_id for e in state.endpoint_routes] == [
        "ship-1", "aircraft-1", "car-1", "car-phone",
        "laptop-1", "plane-phone", "rural-phone-1", "rural-phone-2",
        "ship-phone", "walker-1",
    ]
    urban = [e for e in state.endpoint_routes if not e.endpoint_id.startswith("rural-")]
    assert all(e.connectivity == "connected" for e in urban)
    # Saltmeadow Settlement: local Wi-Fi only, no backhaul by design.
    for rural_id in ("rural-phone-1", "rural-phone-2"):
        rural = _ep(state, rural_id)
        assert rural.connectivity == "disconnected"
        assert rural.route is None
    # Primary endpoint mirrors the legacy single-route fields.
    assert state.active_route is not None
    assert state.active_route.node_ids == ["ship-1", "ship-router", "ship-cell",
                                           "city-bs", "core-1", "internet-1"]
    ship = _ep(state, "ship-1")
    assert ship.route is not None
    assert ship.route.node_ids == state.active_route.node_ids
    # End-to-end chain: phone -> wifi -> router -> modem -> tower -> core -> internet.
    phone = _ep(state, "ship-phone")
    assert phone.route is not None
    assert phone.route.node_ids == ["ship-phone", "ship-ap", "ship-router", "ship-cell",
                                    "city-bs", "core-1", "internet-1"]
    assert phone.route.latency_ms == pytest.approx(47.0)


def test_world_fair_share_splits_backhaul(world_topology):
    session = SimulationSession(topology=world_topology, scenario_id="world-test")
    state = session.get_state()
    ship = _ep(state, "ship-1")
    phone = _ep(state, "ship-phone")
    # Both share the 75 Mbps LTE uplink.
    assert ship.achieved_mbps == pytest.approx(37.5)
    assert phone.achieved_mbps == pytest.approx(37.5)
    laptop = _ep(state, "laptop-1")
    assert laptop.achieved_mbps == pytest.approx(400.0)


def test_world_no_transit_through_unrelated_endpoints(world_topology):
    session = SimulationSession(topology=world_topology, scenario_id="world-test")
    state = session.get_state()
    endpoints = {e.endpoint_id for e in state.endpoint_routes}
    for ep in state.endpoint_routes:
        if ep.endpoint_id.startswith("rural-"):
            assert ep.route is None  # no backhaul in the settlement
            continue
        assert ep.route is not None
        transit = set(ep.route.node_ids[1:])
        assert not (transit & (endpoints - {ep.endpoint_id})), ep.endpoint_id


def test_ship_sails_offshore_and_fails_over_to_satellite(world_topology):
    session = SimulationSession(topology=world_topology, scenario_id="world-test")
    session.step(ticks=40, dt_seconds=60.0)
    state = session.get_state()
    ship = _ep(state, "ship-1")
    phone = _ep(state, "ship-phone")
    assert ship.connectivity == "degraded"
    assert phone.connectivity == "degraded"
    assert ship.route is not None and "ship-sat" in ship.route.node_ids
    assert phone.route is not None and "ship-sat" in phone.route.node_ids
    # Onboard Wi-Fi stays up; only the backhaul changed.
    wifi = next(l for l in state.links if l.id == "link-shipphone-ap")
    assert wifi.suitable
    lte = next(l for l in state.links if l.id == "link-shipcell-bs")
    assert not lte.suitable
    # Video calling cannot tolerate GEO latency; browsing can.
    assert phone.traffic == "video_call"
    assert not phone.traffic_suitable
    assert any("latency" in note for note in phone.traffic_notes)
    assert ship.traffic_suitable
    types = [e.type for e in session.get_events()]
    assert "failover" in types


def test_ship_returning_triggers_failback(world_topology):
    session = SimulationSession(topology=world_topology, scenario_id="world-test")
    session.step(ticks=230, dt_seconds=60.0)
    state = session.get_state()
    ship = _ep(state, "ship-1")
    assert ship.connectivity == "connected"
    assert ship.route is not None and "ship-cell" in ship.route.node_ids
    types = [e.type for e in session.get_events()]
    assert "failover" in types
    assert "handover" in types  # voluntary return gated by dwell/hysteresis


def test_car_hands_over_between_cells(world_topology):
    session = SimulationSession(topology=world_topology, scenario_id="world-test")
    session.step(ticks=60, dt_seconds=60.0)
    state = session.get_state()
    car = _ep(state, "car-1")
    assert car.route is not None
    assert "bs-east" in car.route.node_ids
    assert car.connectivity == "degraded"
    types = [e.type for e in session.get_events()]
    assert "failover" in types


def test_followers_ride_with_leader(world_topology):
    session = SimulationSession(topology=world_topology, scenario_id="world-test")
    session.step(ticks=5, dt_seconds=60.0)
    assert session._positions["ship-phone"] == session._positions["ship-1"]
    assert session._positions["car-phone"] == session._positions["car-1"]
    assert session._positions["plane-phone"]["x_km"] == pytest.approx(
        session._positions["aircraft-1"]["x_km"]
    )


def test_operator_course_overrides_waypoints(world_topology):
    session = SimulationSession(topology=world_topology, scenario_id="world-test")
    session.set_course("car-1", 10.0, 0.0)
    node = next(n for n in session._topology.nodes if n.id == "car-1")
    assert node.mobility.waypoints_km == []
    x0 = session._positions["car-1"]["x_km"]
    session.step(ticks=1, dt_seconds=3600.0)
    assert session._positions["car-1"]["x_km"] == pytest.approx(x0 + 10.0)


def test_waypoint_loop_rotates(world_topology):
    session = SimulationSession(topology=world_topology, scenario_id="world-test")
    node = next(n for n in session._topology.nodes if n.id == "car-1")
    first = list(node.mobility.waypoints_km[0])
    session.step(ticks=70, dt_seconds=60.0)
    assert list(node.mobility.waypoints_km[-1]) == first


def test_set_endpoint_traffic(world_topology):
    session = SimulationSession(topology=world_topology, scenario_id="world-test")
    session.set_endpoint_traffic("laptop-1", "voice")
    state = session.get_state()
    assert _ep(state, "laptop-1").traffic == "voice"
    with pytest.raises(KeyError):
        session.set_endpoint_traffic("laptop-nope", "voice")
    with pytest.raises(ValueError):
        session.set_endpoint_traffic("laptop-1", "holodeck")


def test_report_endpoint_uses_recorded_history(client: TestClient):
    client.post("/api/simulation/step", json={"ticks": 3, "dt_seconds": 60.0})
    res = client.get("/api/simulation/report")
    assert res.status_code == 200
    body = res.json()
    assert body["scenario_id"] == "maritime_failover"
    assert body["endpoints"], "report must summarize endpoints"
    assert body["costs"]["currency"] == "USD"
    assert "illustrative" in body["costs"]["assumption"]
    assert body["recommendations"], "report must include recommendations"
    assert body["confidence"].startswith("low:")


def test_traffic_api_and_profiles(client: TestClient):
    res = client.get("/api/simulation/traffic-profiles")
    assert res.status_code == 200
    body = res.json()
    assert body["default"] == "browsing"
    assert {p["id"] for p in body["profiles"]} >= {"voice", "video_call", "emergency"}
    res = client.post("/api/simulation/traffic",
                      json={"node_id": "ship-1", "profile": "emergency"})
    assert res.status_code == 200
    eps = {e["endpoint_id"]: e for e in res.json()["endpoint_routes"]}
    assert eps["ship-1"]["traffic"] == "emergency"
    res = client.post("/api/simulation/traffic",
                      json={"node_id": "ship-1", "profile": "holodeck"})
    assert res.status_code == 400
    res = client.post("/api/simulation/traffic",
                      json={"node_id": "nope", "profile": "voice"})
    assert res.status_code == 404
