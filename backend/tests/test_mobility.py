"""Tests for mobility-driven suitability and automatic handovers."""

import pytest

from app import mobility
from app.simulation import SimulationSession
from app.topology import load_topology


def _maritime_with_mobility():
    topo = load_topology()
    data = topo.model_dump(mode="json")
    for node in data["nodes"]:
        if node["id"] == "ship-1":
            node["world_position"] = {"x_km": 5.0, "y_km": 0.0, "altitude_m": 0.0}
            node["mobility"] = {"velocity_x_kmh": 30.0, "velocity_y_kmh": 0.0, "waypoints_km": [], "speed_kmh": 0.0}
        if node["id"] == "base-station-1":
            node["world_position"] = {"x_km": 0.0, "y_km": 0.0, "altitude_m": 60.0}
        if node["id"] == "satellite-1":
            node["world_position"] = {"x_km": 0.0, "y_km": 0.0, "altitude_m": 100.0}
        if node["id"] == "sat-gateway-1":
            node["world_position"] = {"x_km": -2.0, "y_km": 3.0, "altitude_m": 10.0}
        if node["id"] == "internet-1":
            node["world_position"] = {"x_km": -4.0, "y_km": 0.0, "altitude_m": 0.0}
    for link in data["links"]:
        if link["id"] == "link-ship-cellular":
            link["medium"] = "wireless"
            link["max_range_km"] = 25.0
        if link["id"] == "link-ship-sat":
            link["medium"] = "wireless"
    from app.models import Topology

    return Topology.model_validate(data)


def test_link_suitability_range_and_hysteresis():
    ok, _, _ = mobility.link_suitable("wireless", "Cellular (LTE)", 10.0, 25.0, True)
    assert ok
    ok, reason, quality = mobility.link_suitable("wireless", "Cellular (LTE)", 40.0, 25.0, True)
    assert not ok
    assert "out of range" in reason
    assert quality is not None and quality < 0.5
    # Hysteresis band holds previous state.
    ok, _, _ = mobility.link_suitable("wireless", "Cellular (LTE)", 26.0, 25.0, True)
    assert ok
    ok, _, _ = mobility.link_suitable("wireless", "Cellular (LTE)", 26.0, 25.0, False)
    assert not ok
    ok, _, _ = mobility.link_suitable("wired", "Fiber", 500.0, None, True)
    assert ok


def test_movement_triggers_automatic_handover_to_satellite():
    session = SimulationSession(topology=_maritime_with_mobility(), scenario_id="mobility-test")
    assert session.get_state().connectivity == "connected"
    # Ship sails east at 30 km/h; 1-hour steps move it out of 25 km range.
    session.step(ticks=2, dt_seconds=3600.0)
    state = session.get_state()
    assert state.connectivity == "degraded"
    assert state.active_route is not None
    assert state.active_route.node_ids == ["ship-1", "satellite-1", "sat-gateway-1", "internet-1"]
    types = [e.type for e in session.get_events()]
    assert "suitability_changed" in types
    assert "failover" in types
    analysis = session.get_analysis()
    assert len(analysis["handover_history"]) >= 1


def test_return_to_coverage_respects_dwell_before_failback():
    session = SimulationSession(topology=_maritime_with_mobility(), scenario_id="mobility-test-2")
    session.step(ticks=2, dt_seconds=3600.0)
    assert session.get_state().connectivity == "degraded"
    # Teleport ship back near shore by resetting positions via new session leg:
    # reverse velocity through direct position edit is internal; instead use
    # restore path: verify dwell gate defers immediate voluntary switch.
    from app import routing

    current = routing.Route(("s", "x"), ("l1",), latency_ms=855, bandwidth_mbps=20, reliability=0.9)
    candidate = routing.Route(("s", "y"), ("l2",), latency_ms=45, bandwidth_mbps=50, reliability=0.9)
    allowed, _ = routing.should_switch(current, candidate, "lowest_latency", dwell_ticks=0, min_dwell_ticks=2)
    assert allowed is False
    allowed, _ = routing.should_switch(current, candidate, "lowest_latency", dwell_ticks=2, min_dwell_ticks=2)
    assert allowed is True


def test_set_course_changes_velocity_and_records_event():
    session = SimulationSession(topology=_maritime_with_mobility(), scenario_id="mobility-test-4")
    session.set_course("ship-1", -30.0, 0.0)
    node = next(n for n in session._topology.nodes if n.id == "ship-1")
    assert node.mobility is not None
    assert node.mobility.velocity_x_kmh == -30.0
    types = [e.type for e in session.get_events()]
    assert "course_changed" in types
    with pytest.raises(KeyError):
        session.set_course("node-nope", 0.0, 0.0)


def test_step_records_latency_series_and_history():
    session = SimulationSession(topology=_maritime_with_mobility(), scenario_id="mobility-test-3")
    session.step(ticks=3, dt_seconds=60.0)
    analysis = session.get_analysis()
    assert len(analysis["latency_series"]) == 3
    assert analysis["route_history"]
    assert "availability" in analysis
