"""Coverage Research: evidence-based gap analysis + ranked proposals.

Regions carry connectivity evidence with explicit provenance. The bundled
seeds are ILLUSTRATIVE SAMPLES (clearly labeled) so the workflow is usable
offline; engineers replace them with ITU/World Bank/GSMA/OpenCellIID figures
via the region editor. The classifier distinguishes:

- no_data: no coverage evidence at all — research needed, not a finding.
- low_adoption: coverage exists but usage is low — affordability/literacy
  problem, not necessarily an infrastructure gap.
- coverage_gap: evidence of missing/weak coverage — infrastructure options.
- adequate: no gap indicated by current evidence.

Proposals are deterministic rankings over catalog equipment with capex/opex
from the hardware library (illustrative prices). A proposal can be saved as
a scenario for simulation. Nothing here deploys infrastructure.
"""

import uuid

from . import database as db
from . import hardware

# Explicitly illustrative sample regions. Replace with measured data.
SEED_REGIONS: list[dict] = [
    {
        "id": "highland-valley",
        "name": "Highland Valley (illustrative sample)",
        "population": 4200,
        "area_km2": 180,
        "terrain": "mountainous",
        "grid_power": "partial",
        "existing_infra": ["2G voice-only macro site (edge of valley)"],
        "backhaul_options": ["microwave relay", "satellite"],
        "coverage_pct": 22,
        "usage_pct": 15,
        "evidence": [
            {"metric": "coverage_pct", "value": 22, "source": "illustrative sample",
             "note": "Replace with GSMA/ITU coverage figures."},
            {"metric": "usage_pct", "value": 15, "source": "illustrative sample",
             "note": "Replace with World Bank IT.NET.USER.ZS or national survey."},
        ],
    },
    {
        "id": "coastal-fishing",
        "name": "Coastal Fishing Belt (illustrative sample)",
        "population": 12000,
        "area_km2": 60,
        "terrain": "coastal plain",
        "grid_power": "available",
        "existing_infra": ["LTE macro site (town)", "fiber PoP 8 km inland"],
        "backhaul_options": ["fiber extension", "microwave relay"],
        "coverage_pct": 68,
        "usage_pct": 34,
        "evidence": [
            {"metric": "coverage_pct", "value": 68, "source": "illustrative sample",
             "note": "Replace with OpenCellID/FCC-style measurements."},
            {"metric": "usage_pct", "value": 34, "source": "illustrative sample",
             "note": "Low usage despite coverage suggests affordability work."},
        ],
    },
    {
        "id": "offshore-platforms",
        "name": "Offshore Platforms (illustrative sample)",
        "population": 180,
        "area_km2": 400,
        "terrain": "open sea",
        "grid_power": "platform generators",
        "existing_infra": ["VSAT terminals (legacy, capacity-constrained)"],
        "backhaul_options": ["satellite", "microwave relay (platform chain)"],
        "coverage_pct": None,
        "usage_pct": None,
        "evidence": [],
    },
]

# Candidate solution templates ranked per region.
SOLUTION_TEMPLATES: list[dict] = [
    {
        "id": "new-lte-site",
        "title": "Additional LTE macro site",
        "devices": ["gen-basestation-lte-01", "gen-tower-coastal-01"],
        "backhaul": "microwave",
        "backhaul_devices": ["gen-microwave-ptp-01"],
        "requires": ["grid_power_or_solar", "site_access"],
        "coverage_gain_pp": 25,
        "latency_ms": 35,
        "capacity_mbps": 150,
        "feasibility_note": "Needs line-of-sight backhaul path survey and power.",
    },
    {
        "id": "microwave-backhaul",
        "title": "Microwave relay backhaul",
        "devices": ["gen-microwave-ptp-01"],
        "backhaul": None,
        "backhaul_devices": [],
        "requires": ["line_of_sight"],
        "coverage_gain_pp": 0,
        "latency_ms": 5,
        "capacity_mbps": 500,
        "feasibility_note": "Backhaul only; pair with an access site. Rain fade planning required.",
    },
    {
        "id": "satellite-backhaul",
        "title": "Satellite backhaul + local access",
        "devices": ["gen-vsat-maritime-01", "gen-wifi-ap-01"],
        "backhaul": "satellite",
        "backhaul_devices": ["gen-sat-gateway-01"],
        "requires": ["open_sky"],
        "coverage_gain_pp": 40,
        "latency_ms": 600,
        "capacity_mbps": 50,
        "feasibility_note": "Works anywhere with sky view; high latency and opex.",
    },
    {
        "id": "community-wireless",
        "title": "Community wireless + shared LTE gateway",
        "devices": ["gen-wifi-ap-01", "gen-iot-gateway-01"],
        "backhaul": "lte_uplink",
        "backhaul_devices": ["gen-gateway-multiwan-01"],
        "requires": ["nearby_lte_signal", "community_power"],
        "coverage_gain_pp": 15,
        "latency_ms": 60,
        "capacity_mbps": 30,
        "feasibility_note": "Low cost where an LTE donor signal exists; capacity is shared.",
    },
]


def _new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


def ensure_regions() -> int:
    conn = db.connect()
    try:
        for region in SEED_REGIONS:
            conn.execute(
                "INSERT OR IGNORE INTO regions (id, name, data_json, created_at, updated_at)"
                " VALUES (?, ?, ?, ?, ?)",
                (region["id"], region["name"], db.dump_json(region),
                 db.now_iso(), db.now_iso()),
            )
        conn.commit()
        return conn.execute("SELECT COUNT(*) AS n FROM regions").fetchone()["n"]
    finally:
        conn.close()


def list_regions() -> list[dict]:
    ensure_regions()
    conn = db.connect()
    try:
        rows = conn.execute("SELECT * FROM regions ORDER BY name").fetchall()
        out = []
        for r in rows:
            d = db.row_to_dict(r)
            d["data"] = db.load_json(d.pop("data_json"))
            out.append(d)
        return out
    finally:
        conn.close()


def get_region(rid: str) -> dict | None:
    conn = db.connect()
    try:
        row = conn.execute("SELECT * FROM regions WHERE id = ?", (rid,)).fetchone()
        if row is None:
            return None
        d = db.row_to_dict(row)
        d["data"] = db.load_json(d.pop("data_json"))
        return d
    finally:
        conn.close()


def save_region(rid: str, name: str, data: dict) -> dict:
    conn = db.connect()
    try:
        ts = db.now_iso()
        data = dict(data)
        data["id"] = rid
        data["name"] = name
        conn.execute(
            "INSERT INTO regions (id, name, data_json, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?)"
            " ON CONFLICT(id) DO UPDATE SET name=excluded.name,"
            " data_json=excluded.data_json, updated_at=excluded.updated_at",
            (rid, name, db.dump_json(data), ts, ts),
        )
        conn.commit()
    finally:
        conn.close()
    region = get_region(rid)
    assert region is not None
    return region


def classify_gap(region_data: dict) -> dict:
    """Deterministic gap classification with reasons (no guessing)."""
    coverage = region_data.get("coverage_pct")
    usage = region_data.get("usage_pct")
    evidence = region_data.get("evidence") or []
    if coverage is None:
        return {
            "class": "no_data",
            "summary": "No coverage evidence recorded — research needed before any finding.",
            "recommended_action": "Collect coverage evidence (drive test, OpenCellID, operator maps).",
        }
    if coverage >= 85:
        if usage is not None and usage < 50:
            return {
                "class": "low_adoption",
                "summary": f"Coverage {coverage}% but usage {usage}%: adoption/affordability gap, not an infrastructure gap.",
                "recommended_action": "Investigate affordability, devices, and digital literacy; do not build sites blindly.",
            }
        return {
            "class": "adequate",
            "summary": f"Coverage {coverage}% indicates no infrastructure gap in current evidence.",
            "recommended_action": "Monitor; reassess when evidence refreshes.",
        }
    if usage is not None and usage >= coverage - 5:
        summary = (f"Coverage {coverage}% with usage {usage}%: demand tracks the network edge — "
                   "likely underserved area (estimate from sample evidence).")
    else:
        summary = (f"Coverage {coverage}%: infrastructure gap indicated (estimate from "
                   f"{len(evidence)} evidence record(s)).")
    return {
        "class": "coverage_gap",
        "summary": summary,
        "recommended_action": "Evaluate access + backhaul options below; validate with field data.",
    }


def _device_costs(device_ids: list[str]) -> tuple[float, float, list[dict]]:
    capex = opex = 0.0
    items = []
    for did in device_ids:
        spec = hardware.get_device(did)
        if spec is None:
            items.append({"device_id": did, "found": False})
            continue
        capex += spec.cost_usd_approx or 0
        opex += spec.opex_usd_per_month or 0
        items.append({
            "device_id": did, "found": True, "name": spec.name,
            "capex_usd": spec.cost_usd_approx, "opex_usd_per_month": spec.opex_usd_per_month,
        })
    return capex, opex, items


def rank_proposals(region_data: dict) -> list[dict]:
    """Score templates for a region: feasibility first, then cost per coverage point."""
    terrain = str(region_data.get("terrain", "")).lower()
    backhaul_options = [str(b).lower() for b in region_data.get("backhaul_options", [])]
    existing = " ".join(str(e) for e in region_data.get("existing_infra", [])).lower()
    proposals = []
    for tpl in SOLUTION_TEMPLATES:
        capex, opex, items = _device_costs(tpl["devices"] + tpl["backhaul_devices"])
        issues: list[str] = []
        score = 100.0
        # Feasibility adjustments (transparent, deterministic).
        if tpl["id"] == "new-lte-site" and "fiber pop" in existing:
            score += 10
        if tpl["id"] == "new-lte-site" and terrain in ("open sea",):
            issues.append("Macro site not deployable at sea.")
            score -= 80
        if tpl["id"] == "microwave-backhaul" and not any(
                "microwave" in b for b in backhaul_options):
            issues.append("No microwave path identified in region backhaul options.")
            score -= 25
        if tpl["id"] == "satellite-backhaul" and terrain == "open sea":
            score += 15
        if tpl["id"] == "community-wireless" and "lte" not in existing and "lte" not in " ".join(backhaul_options):
            issues.append("No LTE donor signal recorded; verify on site.")
            score -= 20
        gain = tpl["coverage_gain_pp"] or 0
        cost_per_point = round(capex / gain, 2) if gain else None
        if cost_per_point:
            score -= min(cost_per_point / 500, 30)
        else:
            # Backhaul-only options enable access but close no gap themselves.
            score -= 15
            issues.append("Adds no access coverage on its own; pair with an access solution.")
        proposals.append({
            "id": tpl["id"], "title": tpl["title"],
            "devices": items, "capex_usd_approx": capex,
            "opex_usd_per_month": opex,
            "coverage_gain_pp_estimate": gain,
            "cost_per_coverage_point_usd": cost_per_point,
            "latency_ms_estimate": tpl["latency_ms"],
            "capacity_mbps_estimate": tpl["capacity_mbps"],
            "feasibility_note": tpl["feasibility_note"],
            "issues": issues,
            "score": round(score, 1),
            "assumption": "illustrative catalog prices and planning estimates",
        })
    proposals.sort(key=lambda p: p["score"], reverse=True)
    return proposals


def analyze_region(rid: str, created_by: str = "deterministic") -> dict:
    ensure_regions()
    region = get_region(rid)
    if region is None:
        raise KeyError(f"Unknown region {rid!r}")
    data = region["data"]
    gap = classify_gap(data)
    proposals = rank_proposals(data) if gap["class"] in ("coverage_gap", "low_adoption") else []
    report = {
        "id": _new_id("cov"),
        "region_id": rid,
        "region_name": region["name"],
        "gap": gap,
        "proposals": proposals,
        "evidence": data.get("evidence", []),
        "confidence": "low: illustrative sample evidence unless replaced with measured data",
    }
    conn = db.connect()
    try:
        conn.execute(
            "INSERT INTO coverage_reports (id, region_id, created_by, data_json, created_at)"
            " VALUES (?, ?, ?, ?, ?)",
            (report["id"], rid, created_by, db.dump_json(report), db.now_iso()),
        )
        conn.commit()
    finally:
        conn.close()
    return report


def list_reports(region_id: str | None = None) -> list[dict]:
    conn = db.connect()
    try:
        if region_id:
            rows = conn.execute(
                "SELECT * FROM coverage_reports WHERE region_id = ? ORDER BY created_at DESC",
                (region_id,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM coverage_reports ORDER BY created_at DESC LIMIT 50"
            ).fetchall()
        out = []
        for r in rows:
            d = db.row_to_dict(r)
            d["data"] = db.load_json(d.pop("data_json"))
            out.append(d)
        return out
    finally:
        conn.close()


def proposal_to_scenario(report_id: str, proposal_id: str) -> dict:
    """Save a proposal as a runnable scenario (small rural topology)."""
    from . import scenarios as scenario_store
    from .models import Topology

    conn = db.connect()
    try:
        row = conn.execute(
            "SELECT * FROM coverage_reports WHERE id = ?", (report_id,)
        ).fetchone()
        if row is None:
            raise KeyError(f"Unknown coverage report {report_id!r}")
        report = db.load_json(row["data_json"])
    finally:
        conn.close()
    proposal = next((p for p in report.get("proposals", []) if p["id"] == proposal_id), None)
    if proposal is None:
        raise KeyError(f"Unknown proposal {proposal_id!r} in report {report_id}")
    use_satellite = proposal_id == "satellite-backhaul"
    access_tech = "Cellular (LTE)" if proposal_id in ("new-lte-site", "community-wireless") else (
        "VSAT (GEO)" if use_satellite else "Wi-Fi")
    backhaul_tech = "Microwave PtP" if proposal_id in ("new-lte-site", "microwave-backhaul") else (
        "VSAT (GEO)" if use_satellite else "Cellular (LTE)")
    topo = Topology.model_validate({
        "metadata": {
            "name": f"Coverage: {proposal['title']} ({report['region_name'][:40]})",
            "description": f"Candidate from coverage report {report_id}. Synthetic planning values.",
            "synthetic": True, "version": 1, "environment": "rural",
        },
        "nodes": [
            {"id": "village-pop", "type": "iot_gateway", "label": "Village PoP",
             "position": {"x": 120, "y": 220},
             "world_position": {"x_km": 0.0, "y_km": 0.0, "altitude_m": 10.0},
             "supported_technologies": [access_tech, "Wi-Fi"],
             "properties": {"role": "community access", "note": "synthetic example"}},
            {"id": "relay-1", "type": "gateway", "label": "Relay / Donor Site",
             "position": {"x": 360, "y": 220},
             "world_position": {"x_km": 12.0, "y_km": 0.0, "altitude_m": 40.0},
             "supported_technologies": [access_tech, backhaul_tech],
             "properties": {"role": "backhaul relay", "note": "synthetic example"}},
            {"id": "core-1", "type": "core", "label": "Core / Backhaul",
             "position": {"x": 560, "y": 220},
             "world_position": {"x_km": 24.0, "y_km": 2.0, "altitude_m": 0.0},
             "supported_technologies": ["Fiber", backhaul_tech],
             "properties": {"role": "aggregation", "note": "synthetic example"}},
            {"id": "internet-1", "type": "internet", "label": "Internet",
             "position": {"x": 720, "y": 220},
             "world_position": {"x_km": 30.0, "y_km": 2.0, "altitude_m": 0.0},
             "properties": {"role": "endpoint", "note": "synthetic example"}},
        ],
        "links": [
            {"id": "link-access", "source": "village-pop", "target": "relay-1",
             "label": "Access", "latency_ms": 30, "bandwidth_mbps": 60,
             "reliability": 0.9, "cost_per_gb": 0.4, "status": "active",
             "technology": access_tech, "medium": "wireless",
             "rf": {"model": "link_budget", "preset": "lte_uplink"}},
            {"id": "link-backhaul", "source": "relay-1", "target": "core-1",
             "label": "Backhaul", "latency_ms": 500 if use_satellite else 5,
             "bandwidth_mbps": 40 if use_satellite else 500,
             "reliability": 0.97 if use_satellite else 0.99,
             "cost_per_gb": 8.0 if use_satellite else 0.1, "status": "active",
             "technology": backhaul_tech, "medium": "wireless"},
            {"id": "link-core", "source": "core-1", "target": "internet-1",
             "label": "Upstream", "latency_ms": 5, "bandwidth_mbps": 1000,
             "reliability": 0.999, "cost_per_gb": 0.02, "status": "active",
             "technology": "Fiber", "medium": "wired"},
        ],
    })
    detail = scenario_store.save_scenario(
        f"Coverage proposal: {proposal['title']}", "rural", topo)
    return {"scenario_id": detail.id, "report_id": report_id, "proposal_id": proposal_id}
