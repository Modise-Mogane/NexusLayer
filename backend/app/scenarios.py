"""Saved scenarios: CRUD + reusable templates (SQLite-backed)."""

import uuid

from pydantic import BaseModel, Field

from . import database as db
from .models import Topology
from .topology import load_topology

ENVIRONMENTS = ("generic", "maritime", "urban_vehicle", "aviation", "railway", "rural", "hybrid", "shared_world")


class ScenarioSummary(BaseModel):
    id: str
    name: str
    environment: str
    version: int
    node_count: int = 0
    link_count: int = 0
    updated_at: str = ""


class ScenarioDetail(ScenarioSummary):
    topology: Topology


def _summarize(sid: str, name: str, env: str, version: int, data: dict, updated: str) -> ScenarioSummary:
    topo = data
    return ScenarioSummary(
        id=sid, name=name, environment=env, version=version,
        node_count=len(topo.get("nodes", [])), link_count=len(topo.get("links", [])),
        updated_at=updated,
    )


def list_scenarios() -> list[ScenarioSummary]:
    conn = db.connect()
    try:
        rows = conn.execute(
            "SELECT id, name, environment, version, data_json, updated_at FROM scenarios ORDER BY updated_at DESC"
        ).fetchall()
        out = []
        for row in rows:
            out.append(_summarize(row["id"], row["name"], row["environment"], row["version"], db.load_json(row["data_json"]), row["updated_at"]))
        return out
    finally:
        conn.close()


def get_scenario(sid: str) -> ScenarioDetail | None:
    conn = db.connect()
    try:
        row = conn.execute(
            "SELECT id, name, environment, version, data_json, updated_at FROM scenarios WHERE id = ?", (sid,)
        ).fetchone()
        if row is None:
            return None
        data = db.load_json(row["data_json"])
        summary = _summarize(row["id"], row["name"], row["environment"], row["version"], data, row["updated_at"])
        return ScenarioDetail(**summary.model_dump(), topology=Topology.model_validate(data))
    finally:
        conn.close()


class ScenarioConflict(Exception):
    """The scenario changed after it was loaded."""


def save_scenario(name: str, environment: str, topology: Topology, sid: str | None = None, expected_version: int | None = None) -> ScenarioDetail:
    if environment not in ENVIRONMENTS:
        raise ValueError(f"Unknown environment {environment!r}; expected one of {list(ENVIRONMENTS)}")
    conn = db.connect()
    try:
        ts = db.now_iso()
        payload = topology.model_dump(mode="json")
        if sid is not None:
            if expected_version is None:
                raise ValueError("Expected scenario version is required")
            cur = conn.execute(
                "UPDATE scenarios SET name=?, environment=?, version=version+1, data_json=?, updated_at=? WHERE id=? AND version=?",
                (name, environment, db.dump_json(payload), ts, sid, expected_version),
            )
            if cur.rowcount == 0:
                if conn.execute("SELECT 1 FROM scenarios WHERE id=?", (sid,)).fetchone() is None:
                    raise KeyError(f"Unknown scenario id: {sid!r}")
                raise ScenarioConflict("Scenario changed since it was loaded; your edits have not been saved. Reload or save a copy.")

        else:
            sid = str(uuid.uuid4())[:8]
            version = 1
            conn.execute(
                "INSERT INTO scenarios (id, name, environment, version, data_json, created_at, updated_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?)",
                (sid, name, environment, version, db.dump_json(payload), ts, ts),
            )
        conn.commit()
    finally:
        conn.close()
    detail = get_scenario(sid)
    assert detail is not None
    return detail


def duplicate_scenario(sid: str, name: str | None = None) -> ScenarioDetail:
    detail = get_scenario(sid)
    if detail is None:
        raise KeyError(f"Unknown scenario id: {sid!r}")
    return save_scenario(name or f"{detail.name} (copy)", detail.environment, detail.topology)


def delete_scenario(sid: str) -> bool:
    conn = db.connect()
    try:
        cur = conn.execute("DELETE FROM scenarios WHERE id = ?", (sid,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


SEED_VERSION = 4


def ensure_maritime_seed() -> ScenarioDetail | None:
    """Seed the bundled maritime regression scenario (re-seeds when outdated)."""
    existing = get_scenario("maritime_failover")
    if existing is not None:
        # Legacy seed revision cannot distinguish edits from seed upgrades.
        return existing
    topo = load_topology()
    # Enrich with mobility world data for the 3D vertical slice (idempotent).
    # Unified Port Meridian frame: the vessel leaves the harbor sailing +y
    # (offshore/north). Relative geometry matches v3 exactly (5 km start,
    # sailing directly away), so handover timing is unchanged.
    data = topo.model_dump(mode="json")
    world = {
        "ship-1": {"x_km": -2.0, "y_km": 5.0, "altitude_m": 0.0},
        "base-station-1": {"x_km": -2.0, "y_km": 0.0, "altitude_m": 60.0},
        "satellite-1": {"x_km": 0.0, "y_km": 0.0, "altitude_m": 35786000.0},
        "sat-gateway-1": {"x_km": -6.0, "y_km": -4.0, "altitude_m": 10.0},
        "internet-1": {"x_km": -14.0, "y_km": -14.0, "altitude_m": 0.0},
    }
    for node in data["nodes"]:
        if node["id"] in world:
            node["world_position"] = world[node["id"]]
        if node["id"] == "ship-1":
            node["mobility"] = {"velocity_x_kmh": 0.0, "velocity_y_kmh": 20.0, "waypoints_km": [], "speed_kmh": 0.0}
            node["device_id"] = "gen-ship-comms-01"
        if node["id"] == "base-station-1":
            node["device_id"] = "gen-basestation-lte-01"
        if node["id"] == "satellite-1":
            node["device_id"] = "gen-vsat-maritime-01"
        if node["id"] == "sat-gateway-1":
            node["device_id"] = "gen-sat-gateway-01"
    for link in data["links"]:
        if link["id"] == "link-ship-cellular":
            link["medium"] = "wireless"
            link["max_range_km"] = 25.0
            link["cost_per_gb"] = 0.50
            link["rf"] = {"model": "link_budget", "preset": "lte_uplink"}
        elif link["id"] == "link-ship-sat":
            link["medium"] = "wireless"
            link["max_range_km"] = None
            link["cost_per_gb"] = 8.00
            link["rf"] = {"model": "link_budget", "preset": "vsat_uplink"}
        elif link["id"] == "link-sat-feeder":
            link["medium"] = "wireless"
            link["cost_per_gb"] = 1.00
            link["rf"] = {"model": "link_budget", "preset": "vsat_uplink"}
        else:
            link["medium"] = "wired"
            link["cost_per_gb"] = 0.05
    data["metadata"]["environment"] = "maritime"
    data["metadata"]["version"] = SEED_VERSION
    topo = Topology.model_validate(data)
    conn = db.connect()
    try:
        ts = db.now_iso()
        conn.execute(
            "INSERT INTO scenarios (id, name, environment, version, data_json, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)",
            ("maritime_failover", "Maritime Failover", "maritime", SEED_VERSION, db.dump_json(topo.model_dump(mode="json")), ts, ts),
        )
        conn.commit()
    finally:
        conn.close()
    return get_scenario("maritime_failover")


VEHICLE_SEED_VERSION = 2


def ensure_vehicle_seed() -> ScenarioDetail | None:
    """Seed the connected-vehicle corridor demo (re-seeds when outdated).

    Unified Port Meridian frame: the car road shifts rigidly to (0, -12) and
    the two cells stand 8 km south of it in open fields — the exact v1
    lateral offset, mirrored south, so handover timing is unchanged.
    Backhaul terminates at the city data center like every other scenario.
    """
    existing = get_scenario("vehicle_corridor")
    if existing is not None:
        # Legacy seed revision cannot distinguish edits from seed upgrades.
        return existing
    topo = Topology.model_validate({
        "metadata": {
            "name": "Vehicle Corridor",
            "description": "Synthetic example: a connected car driving east along a road "
                           "between two cellular coverage zones. All values illustrative.",
            "synthetic": True,
            "version": VEHICLE_SEED_VERSION,
            "environment": "urban_vehicle",
        },
        "nodes": [
            {"id": "car-1", "type": "car", "label": "Connected Car",
             "position": {"x": 80, "y": 220},
             "world_position": {"x_km": -25.0, "y_km": -12.0, "altitude_m": 0.0},
             "mobility": {"velocity_x_kmh": 40.0, "velocity_y_kmh": 0.0,
                          "waypoints_km": [], "speed_kmh": 0.0},
             "device_id": "gen-car-gateway-01",
             "supported_technologies": ["Cellular (LTE)", "Wi-Fi"],
             "properties": {"role": "mobile endpoint", "note": "synthetic example"}},
            {"id": "bs-west-1", "type": "base_station", "label": "West Base Station",
             "position": {"x": 360, "y": 80},
             "world_position": {"x_km": -15.0, "y_km": -20.0, "altitude_m": 40.0},
             "device_id": "gen-basestation-lte-01",
             "supported_technologies": ["Cellular (LTE)", "Fiber"],
             "properties": {"role": "terrestrial access", "note": "synthetic example"}},
            {"id": "bs-east-1", "type": "base_station", "label": "East Base Station",
             "position": {"x": 360, "y": 360},
             "world_position": {"x_km": 25.0, "y_km": -20.0, "altitude_m": 40.0},
             "device_id": "gen-basestation-lte-01",
             "supported_technologies": ["Cellular (LTE)", "Fiber"],
             "properties": {"role": "terrestrial access", "note": "synthetic example"}},
            {"id": "internet-1", "type": "internet", "label": "Internet",
             "position": {"x": 640, "y": 220},
             "world_position": {"x_km": -14.0, "y_km": -14.0, "altitude_m": 0.0},
             "properties": {"role": "endpoint", "note": "synthetic example"}},
        ],
        "links": [
            {"id": "link-car-west", "source": "car-1", "target": "bs-west-1",
             "label": "West cell", "latency_ms": 30, "bandwidth_mbps": 80,
             "reliability": 0.93, "cost_per_gb": 0.4, "status": "active",
             "technology": "Cellular (LTE)", "medium": "wireless",
             "rf": {"model": "link_budget", "preset": "lte_uplink"}},
            {"id": "link-car-east", "source": "car-1", "target": "bs-east-1",
             "label": "East cell", "latency_ms": 30, "bandwidth_mbps": 80,
             "reliability": 0.93, "cost_per_gb": 0.4, "status": "standby",
             "technology": "Cellular (LTE)", "medium": "wireless",
             "rf": {"model": "link_budget", "preset": "lte_uplink"}},
            {"id": "link-west-backhaul", "source": "bs-west-1", "target": "internet-1",
             "label": "Backhaul", "latency_ms": 8, "bandwidth_mbps": 1000,
             "reliability": 0.995, "cost_per_gb": 0.05, "status": "active",
             "technology": "Fiber", "medium": "wired"},
            {"id": "link-east-backhaul", "source": "bs-east-1", "target": "internet-1",
             "label": "Backhaul", "latency_ms": 8, "bandwidth_mbps": 1000,
             "reliability": 0.995, "cost_per_gb": 0.05, "status": "active",
             "technology": "Fiber", "medium": "wired"},
        ],
    })
    conn = db.connect()
    try:
        ts = db.now_iso()
        conn.execute(
            "INSERT INTO scenarios (id, name, environment, version, data_json, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)",
            ("vehicle_corridor", "Vehicle Corridor", "urban_vehicle", VEHICLE_SEED_VERSION,
             db.dump_json(topo.model_dump(mode="json")), ts, ts),
        )
        conn.commit()
    finally:
        conn.close()
    return get_scenario("vehicle_corridor")


WORLD_SEED_VERSION = 2


def ensure_world_seed() -> ScenarioDetail | None:
    """Seed the shared multi-device world (re-seeds when outdated)."""
    from .world import build_shared_world_topology

    existing = get_scenario("shared_world")
    if existing is not None:
        # Legacy seed revision cannot distinguish edits from seed upgrades.
        return existing
    topo = build_shared_world_topology()
    conn = db.connect()
    try:
        ts = db.now_iso()
        conn.execute(
            "INSERT INTO scenarios (id, name, environment, version, data_json, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)",
            ("shared_world", "Shared World", "shared_world", WORLD_SEED_VERSION,
             db.dump_json(topo.model_dump(mode="json")), ts, ts),
        )
        conn.commit()
    finally:
        conn.close()
    return get_scenario("shared_world")


def template_topology(kind: str) -> Topology:
    """Build a small working template topology for an environment kind."""
    if kind == "shared_world":
        from .world import build_shared_world_topology

        return build_shared_world_topology()
    base = load_topology()
    data = base.model_dump(mode="json")
    if kind == "maritime":
        return base
    renames = {
        "urban_vehicle": ("Urban Vehicle", "car-1", "Connected Car", "car"),
        "aviation": ("Aviation Link", "aircraft-1", "Aircraft", "aircraft"),
        "railway": ("Railway Link", "train-1", "Train", "train"),
        "rural": ("Rural Broadband", "village-1", "Village PoP", "iot_gateway"),
        "hybrid": ("Hybrid Terrestrial-Satellite", "site-1", "Remote Site", "gateway"),
    }
    if kind not in renames:
        raise KeyError(f"Unknown template {kind!r}")
    name, new_id, label, ntype = renames[kind]
    data["metadata"]["name"] = name
    data["metadata"]["environment"] = kind
    for node in data["nodes"]:
        if node["id"] == "ship-1":
            node["id"] = new_id
            node["label"] = label
            node["type"] = ntype
    for link in data["links"]:
        if link["source"] == "ship-1":
            link["source"] = new_id
        if link["target"] == "ship-1":
            link["target"] = new_id
    return Topology.model_validate(data)
