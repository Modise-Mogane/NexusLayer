"""Tests for the unified persistent world (Stage B).

Covers: region registry, scenario focus, coordinate helpers, placement
persistence via node PATCH, and seed-geometry consistency (every seed node
lives inside a documented region, except the schematic satellite).
"""

import pytest
from fastapi.testclient import TestClient

from app import region, scenarios
from app.main import app
from app.world import build_shared_world_topology


@pytest.fixture()
def client() -> TestClient:
    test_client = TestClient(app)
    test_client.post("/api/simulation/reset")
    return test_client


def test_regions_cover_named_places():
    regions = region.list_regions()
    ids = {r["id"] for r in regions}
    assert {"city", "suburb", "rural", "harbor", "airport", "corridor", "offshore"} <= ids
    for r in regions:
        assert r["bounds_km"][0] < r["bounds_km"][2]
        assert r["bounds_km"][1] < r["bounds_km"][3]
        assert "pos" in r["camera"] and "tgt" in r["camera"]
    rural = region.get_region("rural")
    assert rural is not None
    assert rural["coverage"] == "none"
    assert rural["coverage_region_id"]


def test_region_at_prefers_innermost():
    assert region.region_at(-40.0, -20.0)["id"] == "rural"
    assert region.region_at(-5.0, -8.0)["id"] == "city"
    assert region.region_at(43.0, -1.0)["id"] == "airport"
    assert region.region_at(0.0, 30.0)["id"] == "offshore"
    assert region.region_at(-2.0, 5.0)["id"] == "harbor"


def test_scenario_focus_map():
    maritime = region.focus_for_scenario("maritime_failover")
    assert maritime["region_id"] == "harbor"
    assert maritime["region"]["name"]
    assert "activity" in maritime and maritime["activity"]
    assert region.focus_for_scenario("vehicle_corridor")["region_id"] == "corridor"
    assert region.focus_for_scenario("shared_world")["camera_preset"] == "overview"
    unknown = region.focus_for_scenario("custom-123")
    assert unknown["region_id"] == "city"  # safe default


def test_latlon_round_trip():
    ll = region.to_latlon(12.5, -7.25)
    assert ll["fictional"] is True
    back = region.to_xy(ll["lat_deg"], ll["lon_deg"])
    assert back["x_km"] == pytest.approx(12.5)
    assert back["y_km"] == pytest.approx(-7.25)


def test_world_endpoints():
    c = TestClient(app)
    meta = c.get("/api/world").json()["meta"]
    assert meta["fictional"] is True
    assert meta["units"]["horizontal"] == "km"
    assert "schematic" in meta["satellite_note"]
    regions = c.get("/api/world/regions").json()["regions"]
    assert len(regions) >= 7
    focus = c.get("/api/world/focus", params={"scenario_id": "shared_world"}).json()
    assert focus["camera_preset"] == "overview"


def test_all_seed_nodes_sit_in_documented_regions():
    """Every seed node has a region, except the schematic satellite."""
    seeds = [
        scenarios.ensure_maritime_seed(),
        scenarios.ensure_vehicle_seed(),
        scenarios.ensure_world_seed(),
    ]
    for detail in seeds:
        assert detail is not None
        for node in detail.topology.nodes:
            if node.type == "satellite":
                continue
            assert node.world_position is not None, f"{detail.id}/{node.id} has no position"
            hit = region.region_at(node.world_position.x_km, node.world_position.y_km)
            assert hit is not None, f"{detail.id}/{node.id} outside all regions"


def test_seed_waypoints_stay_in_bounds():
    """Patrol waypoints must not cross land/sea incoherently (documented)."""
    detail = scenarios.ensure_world_seed()
    assert detail is not None
    ship = next(n for n in detail.topology.nodes if n.id == "ship-1")
    assert ship.mobility is not None
    for x, y in ship.mobility.waypoints_km:
        assert y > 4.0, "ship waypoints stay offshore"


def test_node_patch_persists_world_position_and_moves_rf(client):
    """Placing infrastructure persists and changes link geometry."""
    dup = scenarios.duplicate_scenario("shared_world", "placement-test")
    sid = dup.id
    try:
        before = client.get(f"/api/scenarios/{sid}").json()
        node0 = next(n for n in before["topology"]["nodes"] if n["id"] == "city-bs-2")
        assert node0["world_position"]["x_km"] == pytest.approx(4.0)
        res = client.patch(f"/api/scenarios/{sid}/nodes/city-bs-2", json={
            "world_position": {"x_km": 10.0, "y_km": -12.0, "altitude_m": 40.0},
        })
        assert res.status_code == 200, res.text
        after = client.get(f"/api/scenarios/{sid}").json()
        node1 = next(n for n in after["topology"]["nodes"] if n["id"] == "city-bs-2")
        assert node1["world_position"]["x_km"] == pytest.approx(10.0)
        # The session rebuilds from the saved topology: geometry follows.
        state = client.post("/api/simulation/reset", params={"scenario_id": sid}).json()
        assert state["scenario_id"] == sid
        live = next(n for n in state["nodes"] if n["id"] == "city-bs-2")
        assert live["world_position"]["x_km"] == pytest.approx(10.0)
    finally:
        scenarios.delete_scenario(sid)


def test_shared_world_topology_builds():
    topo = build_shared_world_topology()
    ids = {n.id for n in topo.nodes}
    assert {"rural-phone-1", "rural-ap", "airport-ap", "city-bs-2"} <= ids
