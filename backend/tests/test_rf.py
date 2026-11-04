"""Tests for RF link-budget models and RF-driven handovers."""

import pytest

from app import rf
from app.simulation import SimulationSession
from app.topology import load_topology


def test_fspl_known_value():
    # FSPL(1 km, 1000 MHz) = 0 + 60 + 32.44
    assert rf.fspl_db(1.0, 1000.0) == pytest.approx(92.44)
    # Doubling distance adds ~6.02 dB.
    assert rf.fspl_db(2.0, 1000.0) - rf.fspl_db(1.0, 1000.0) == pytest.approx(6.0206, abs=1e-3)


def test_received_power_and_margin():
    params = rf.TECH_PRESETS["lte_uplink"]
    rx, loss = rf.received_power_dbm(params, 5.0)
    assert loss == pytest.approx(rf.fspl_db(5.0, 1800.0))
    assert rx == pytest.approx(23 + 2 + 18 - loss - 15)
    result = rf.evaluate(params, 5.0, True)
    assert result.suitable is True
    assert result.margin_db == pytest.approx(rx + 104.0)
    assert "dBm" in result.reason and "margin" in result.reason


def test_handover_threshold_and_hysteresis():
    params = rf.TECH_PRESETS["lte_uplink"]
    # Far away: unsuitable.
    far = rf.evaluate(params, 40.0, True)
    assert far.suitable is False
    # Hysteresis band: previously-down link needs margin + hysteresis.
    mid_dist = 22.0
    down = rf.evaluate(params, mid_dist, False)
    up = rf.evaluate(params, mid_dist, True)
    assert up.suitable is True
    # At 22 km margin is ~7.6: above 6 (holds) but below 9 (no re-qualify).
    assert down.suitable is False
    near = rf.evaluate(params, 10.0, False)
    assert near.suitable is True


def test_satellite_preset_suitable_at_geo_range():
    params = rf.TECH_PRESETS["vsat_uplink"]
    result = rf.evaluate(params, 35786.0, True)
    assert result.suitable is True
    assert result.margin_db > 3.0


def test_effective_range_matches_threshold():
    params = rf.TECH_PRESETS["lte_uplink"]
    radius = rf.effective_range_km(params)
    assert radius == pytest.approx(26.5, abs=0.5)
    at_edge = rf.evaluate(params, radius, True)
    assert at_edge.margin_db == pytest.approx(params.required_margin_db, abs=0.05)


def test_slant_range_uses_altitude():
    a = {"x_km": 5.0, "y_km": 0.0, "altitude_m": 0.0}
    b = {"x_km": 0.0, "y_km": 0.0, "altitude_m": 35786000.0}
    assert rf.slant_range_km(a, b) == pytest.approx(35786.0, abs=1.0)


def test_params_preset_detection():
    assert rf.params_from_dict({}, "Cellular (LTE)").label.startswith("LTE uplink")
    assert rf.params_from_dict({}, "VSAT (GEO)").label.startswith("VSAT")
    assert rf.params_from_dict({}, "LoRa").label.startswith("LoRa")
    custom = rf.params_from_dict({"tx_power_dbm": 30, "preset": "wifi"}, "Wi-Fi")
    assert custom is not None and custom.tx_power_dbm == 30.0
    assert rf.params_from_dict(None) is None


def _rf_maritime():
    topo = load_topology()
    data = topo.model_dump(mode="json")
    for node in data["nodes"]:
        if node["id"] == "ship-1":
            node["world_position"] = {"x_km": 5.0, "y_km": 0.0, "altitude_m": 0.0}
            node["mobility"] = {"velocity_x_kmh": 30.0, "velocity_y_kmh": 0.0,
                                "waypoints_km": [], "speed_kmh": 0.0}
        if node["id"] == "base-station-1":
            node["world_position"] = {"x_km": 0.0, "y_km": 0.0, "altitude_m": 60.0}
        if node["id"] == "satellite-1":
            node["world_position"] = {"x_km": 0.0, "y_km": 0.0, "altitude_m": 35786000.0}
        if node["id"] == "sat-gateway-1":
            node["world_position"] = {"x_km": -2.0, "y_km": 3.0, "altitude_m": 10.0}
        if node["id"] == "internet-1":
            node["world_position"] = {"x_km": -4.0, "y_km": 0.0, "altitude_m": 0.0}
    for link in data["links"]:
        if link["id"] == "link-ship-cellular":
            link["medium"] = "wireless"
            link["rf"] = {"model": "link_budget", "preset": "lte_uplink"}
        if link["id"] == "link-ship-sat":
            link["medium"] = "wireless"
            link["rf"] = {"model": "link_budget", "preset": "vsat_uplink"}
        if link["id"] == "link-sat-feeder":
            link["medium"] = "wireless"
            link["rf"] = {"model": "link_budget", "preset": "vsat_uplink"}
    from app.models import Topology

    return Topology.model_validate(data)


def test_rf_driven_handover_and_signal_fields():
    session = SimulationSession(topology=_rf_maritime(), scenario_id="rf-test")
    state = session.get_state()
    assert state.connectivity == "connected"
    cellular = next(l for l in state.links if l.id == "link-ship-cellular")
    assert cellular.suitability_model == "link_budget"
    assert cellular.rx_dbm is not None and cellular.margin_db is not None
    assert cellular.margin_db > 6.0
    assert cellular.coverage_radius_km == pytest.approx(26.5, abs=0.5)
    assert all(e.tick >= 0 for e in session.get_events())
    session.step(ticks=2, dt_seconds=3600.0)
    state = session.get_state()
    assert state.connectivity == "degraded"
    assert state.active_route is not None
    assert state.active_route.node_ids[1] == "satellite-1"
    cellular = next(l for l in state.links if l.id == "link-ship-cellular")
    assert cellular.suitable is False
    assert "margin" in cellular.suitability_reason


def test_link_params_update_affects_routing():
    session = SimulationSession(topology=_rf_maritime(), scenario_id="rf-test-2")
    session.update_link_params("link-ship-cellular", {"cost_per_gb": 99.0})
    assert session._links_by_id["link-ship-cellular"].cost_per_gb == 99.0
    session.set_policy("lowest_cost")
    state = session.get_state()
    # Satellite path still pricier in the file topology (0 cost) — terrestrial wins.
    assert state.active_route is not None
    session.update_link_params("link-ship-cellular", {"rf": None})
    assert session._links_by_id["link-ship-cellular"].rf is None
    with pytest.raises(KeyError):
        session.update_link_params("link-nope", {})


def test_node_position_move_triggers_reevaluation():
    session = SimulationSession(topology=_rf_maritime(), scenario_id="rf-test-3")
    # Move the base station far inland: link budget collapses -> satellite.
    session.set_node_position("base-station-1", -100.0, 0.0)
    state = session.get_state()
    assert state.connectivity == "degraded"
    cellular = next(l for l in state.links if l.id == "link-ship-cellular")
    assert cellular.suitable is False
    with pytest.raises(KeyError):
        session.set_node_position("node-nope", 0.0, 0.0)
