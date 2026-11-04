"""Tests for the connected-vehicle corridor on the shared engine."""

import pytest

from app import scenarios
from app.simulation import SimulationSession


@pytest.fixture()
def vehicle_topology():
    detail = scenarios.ensure_vehicle_seed()
    assert detail is not None
    return detail.topology


def test_vehicle_seed_topology(vehicle_topology):
    node_ids = {n.id for n in vehicle_topology.nodes}
    assert {"car-1", "bs-west-1", "bs-east-1", "internet-1"} <= node_ids
    assert vehicle_topology.metadata.environment == "urban_vehicle"


def test_vehicle_drives_and_hands_over(vehicle_topology):
    session = SimulationSession(topology=vehicle_topology, scenario_id="vehicle-test")
    state = session.get_state()
    assert state.connectivity == "connected"
    assert state.active_route is not None
    assert state.active_route.node_ids == ["car-1", "bs-west-1", "internet-1"]
    # Drive east in 5-minute steps until the west cell drops.
    for _ in range(30):
        session.step(ticks=1, dt_seconds=300.0)
        if session.get_state().connectivity == "degraded":
            break
    state = session.get_state()
    assert state.active_route is not None
    assert state.active_route.node_ids == ["car-1", "bs-east-1", "internet-1"]
    analysis = session.get_analysis()
    assert len(analysis["handover_history"]) >= 1
    types = [e.type for e in session.get_events()]
    assert "suitability_changed" in types


def test_vehicle_eventually_leaves_coverage(vehicle_topology):
    session = SimulationSession(topology=vehicle_topology, scenario_id="vehicle-test-2")
    for _ in range(40):
        session.step(ticks=1, dt_seconds=600.0)
    state = session.get_state()
    # Car drives past the east cell into a dead zone.
    assert state.connectivity == "disconnected"
    assert state.active_route is None


def test_vehicle_uses_rf_models(vehicle_topology):
    session = SimulationSession(topology=vehicle_topology, scenario_id="vehicle-test-3")
    state = session.get_state()
    west = next(l for l in state.links if l.id == "link-car-west")
    assert west.suitability_model == "link_budget"
    assert west.rx_dbm is not None and west.margin_db is not None
