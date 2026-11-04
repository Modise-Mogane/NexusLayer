"""Unified persistent world: regions, coordinate frame, scenario focus.

Stage B: one coherent demonstration region ("Port Meridian") shared by every
simulation scenario. Geography and infrastructure placement are persistent and
scenario-independent; a scenario is an *activity* (mobility + events) applied
to the shared world, plus a camera focus.

Coordinate frame (canonical, engine-wide):
- Units: kilometers for x/y, meters for altitude (see WorldPosition).
  KM_TO_M converts; the engine never mixes units implicitly.
- x = east, y = north. Sea/offshore is +y (north); land is y < ~0.
- Origin (0, 0) is the harbor mouth. to_latlon() maps the fictional grid
  onto a documented fake origin for future real-dataset work; all current
  geography is illustrative, never claimed as a real place.
- Three.js mapping: (x_km, y_km, alt_m) -> (x, 0, z=y) with mobiles'
  altitude compressed (see sim3d/coordinates.ts). Satellite geometry is
  modeled separately (link budgets use slant range to GEO); the 3D satellite
  is a labeled schematic, never at true distance.

All costs/latencies/bandwidths remain illustrative planning values.
"""

import math

KM_TO_M = 1000.0
EARTH_RADIUS_M = 6_371_000.0

# Fictional origin: Null Island vicinity, explicitly NOT a real deployment.
# Real-dataset support later means swapping this origin + projection only.
GEO_ORIGIN = {"lat_deg": 0.0, "lon_deg": 0.0, "fictional": True}

WORLD_META = {
    "name": "Port Meridian demonstration region",
    "fictional": True,
    "units": {"horizontal": "km", "altitude": "m", "km_to_m": KM_TO_M},
    "axes": {"x": "east", "y": "north", "altitude": "up"},
    "origin": {"x_km": 0.0, "y_km": 0.0, "label": "harbor mouth"},
    "geo_origin": GEO_ORIGIN,
    "three_mapping": "(x_km, y_km, alt_m) -> scene (x=x_km, z=y_km); "
                     "aircraft altitude compressed min(alt/1000, 14); "
                     "satellite schematic at fixed height, not to scale",
    "satellite_note": "GEO relay shown as a labeled schematic. Link budgets "
                      "use slant-range geometry to 35,786 km altitude, never "
                      "the rendered distance.",
    "note": "Illustrative fictional geography for connectivity experiments. "
            "Not a real place; coverage shown here is synthetic.",
}

# Regions: bounds in km [min_x, min_y, max_x, max_y], camera in scene units.
REGIONS: list[dict] = [
    {
        "id": "city",
        "name": "Meridian City",
        "kind": "urban",
        "bounds_km": [-16.0, -16.0, 6.0, 0.5],
        "center_km": [-5.0, -8.0],
        "camera": {"pos": [-5.0, 32.0, -40.0], "tgt": [-5.0, 0.0, -8.0]},
        "blurb": "Offices, residences, data center, fiber backbone, city cells.",
        "coverage": "covered",
        "coverage_note": "Dense terrestrial + fiber; satellite fallback available.",
    },
    {
        "id": "suburb",
        "name": "Eastfield Suburb",
        "kind": "suburban",
        "bounds_km": [8.0, -16.0, 30.0, 0.5],
        "center_km": [19.0, -8.0],
        "camera": {"pos": [19.0, 28.0, 26.0], "tgt": [19.0, 0.0, -8.0]},
        "blurb": "Houses, schools, shops, suburban cells and fixed wireless.",
        "coverage": "covered",
        "coverage_note": "Terrestrial coverage; corridor road handover zone.",
    },
    {
        "id": "rural",
        "name": "Saltmeadow Settlement",
        "kind": "rural_underserved",
        "bounds_km": [-48.0, -26.0, -32.0, -14.0],
        "center_km": [-40.0, -20.0],
        "camera": {"pos": [-40.0, 26.0, 14.0], "tgt": [-40.0, 0.0, -20.0]},
        "blurb": "Homes, school, clinic. Local Wi-Fi only; no usable backhaul.",
        "coverage": "none",
        "coverage_note": "No eligible internet route. See Coverage Research for "
                         "candidate infrastructure proposals.",
        "coverage_region_id": "coastal-fishing",
    },
    {
        "id": "harbor",
        "name": "Meridian Harbor",
        "kind": "harbor",
        "bounds_km": [-10.0, -2.0, 6.0, 6.0],
        "center_km": [-2.0, 2.0],
        "camera": {"pos": [14.0, 22.0, 30.0], "tgt": [-2.0, 0.0, 2.0]},
        "blurb": "Piers, port buildings, coastal cells, VSAT terminals, sea lanes.",
        "coverage": "covered",
        "coverage_note": "Coastal LTE near shore; satellite offshore.",
    },
    {
        "id": "airport",
        "name": "Meridian Regional Airport",
        "kind": "airport",
        "bounds_km": [32.0, -8.0, 54.0, 6.0],
        "center_km": [43.0, -1.0],
        "camera": {"pos": [43.0, 26.0, 30.0], "tgt": [43.0, 0.0, -1.0]},
        "blurb": "Terminal, runway, taxiway, ground network, SATCOM-equipped aircraft.",
        "coverage": "covered",
        "coverage_note": "Terminal fiber + cells; aircraft on satellite uplink.",
    },
    {
        "id": "corridor",
        "name": "Coast Corridor",
        "kind": "transport",
        "bounds_km": [-30.0, -22.0, 34.0, -1.0],
        "center_km": [2.0, -5.0],
        "camera": {"pos": [30.0, 16.0, -24.0], "tgt": [0.0, 0.0, -6.0]},
        "blurb": "Coast road, railway reserve, and roadside cells linking regions.",
        "coverage": "covered",
        "coverage_note": "Continuous roadside LTE; handover zone between cells.",
    },
    {
        "id": "offshore",
        "name": "Offshore & sea lanes",
        "kind": "maritime",
        "bounds_km": [-60.0, 4.0, 60.0, 60.0],
        "center_km": [0.0, 30.0],
        "camera": {"pos": [30.0, 34.0, 72.0], "tgt": [0.0, 0.0, 40.0]},
        "blurb": "Shipping lanes beyond terrestrial range; satellite country.",
        "coverage": "weak",
        "coverage_note": "Terrestrial fades with distance; VSAT required offshore.",
    },
]

# Scenario -> world focus. The world persists; selecting a scenario moves the
# camera to its region and describes which activity becomes prominent.
SCENARIO_FOCUS: dict[str, dict] = {
    "maritime_failover": {
        "region_id": "harbor", "camera_preset": "harbor",
        "activity": "Vessel sails from the harbor offshore; coastal LTE hands "
                    "over to satellite backhaul.",
    },
    "vehicle_corridor": {
        "region_id": "corridor", "camera_preset": "corridor",
        "activity": "Connected car drives the corridor road between west and "
                    "east cells with automatic handover.",
    },
    "shared_world": {
        "region_id": "city", "camera_preset": "overview",
        "activity": "Full multi-device day: ship, aircraft, car, pedestrian, "
                    "laptop, and the underserved settlement share one clock.",
    },
}
DEFAULT_FOCUS = {
    "region_id": "city", "camera_preset": "overview",
    "activity": "Custom architecture experiment on the shared world.",
}


def list_regions() -> list[dict]:
    return [dict(r) for r in REGIONS]


def get_region(region_id: str) -> dict | None:
    for region in REGIONS:
        if region["id"] == region_id:
            return dict(region)
    return None


def region_at(x_km: float, y_km: float) -> dict | None:
    """Innermost region containing the point (smallest area wins on overlap)."""
    hits = [
        r for r in REGIONS
        if r["bounds_km"][0] <= x_km <= r["bounds_km"][2]
        and r["bounds_km"][1] <= y_km <= r["bounds_km"][3]
    ]
    if not hits:
        return None
    hits.sort(key=lambda r: (r["bounds_km"][2] - r["bounds_km"][0]) * (r["bounds_km"][3] - r["bounds_km"][1]))
    return dict(hits[0])


def focus_for_scenario(scenario_id: str) -> dict:
    focus = SCENARIO_FOCUS.get(scenario_id, DEFAULT_FOCUS)
    region = get_region(focus["region_id"])
    return {**focus, "scenario_id": scenario_id, "region": region}


def to_latlon(x_km: float, y_km: float) -> dict:
    """Equirectangular projection of the fictional grid (future real data)."""
    lat = GEO_ORIGIN["lat_deg"] + math.degrees(y_km * KM_TO_M / EARTH_RADIUS_M)
    lon = GEO_ORIGIN["lon_deg"] + math.degrees(
        x_km * KM_TO_M / (EARTH_RADIUS_M * math.cos(math.radians(GEO_ORIGIN["lat_deg"])))
    )
    return {"lat_deg": lat, "lon_deg": lon, "fictional": True}


def to_xy(lat_deg: float, lon_deg: float) -> dict:
    """Inverse of to_latlon (same fictional origin)."""
    y_km = math.radians(lat_deg - GEO_ORIGIN["lat_deg"]) * EARTH_RADIUS_M / KM_TO_M
    x_km = (
        math.radians(lon_deg - GEO_ORIGIN["lon_deg"])
        * EARTH_RADIUS_M
        * math.cos(math.radians(GEO_ORIGIN["lat_deg"]))
        / KM_TO_M
    )
    return {"x_km": x_km, "y_km": y_km}
