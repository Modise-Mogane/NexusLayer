"""Hardware library: representative illustrative devices + custom designs.

Seed devices ship in backend/data/devices.json with clearly-labeled
ILLUSTRATIVE specifications (not manufacturer datasheets). Custom and
AI-proposed designs are stored in SQLite and merged at read time.
"""

import json
import uuid
from pathlib import Path

from pydantic import BaseModel, Field

from . import database as db

DEVICES_JSON = Path(__file__).resolve().parent.parent / "data" / "devices.json"


class DeviceInterface(BaseModel):
    name: str
    technology: str
    connector: str | None = None
    max_throughput_mbps: float | None = None


class DeviceEvidence(BaseModel):
    source: str = "illustrative"
    confidence: str = "low"
    note: str = "Representative illustrative values, not a manufacturer datasheet."


class DeviceSpec(BaseModel):
    device_id: str
    name: str
    category: str
    family: str
    model_identifier: str
    description: str = ""
    interfaces: list[DeviceInterface] = Field(default_factory=list)
    protocols: list[str] = Field(default_factory=list)
    frequency_bands: list[str] = Field(default_factory=list)
    throughput_mbps: float | None = None
    latency_ms_typical: float | None = None
    tx_power_dbm: float | None = None
    rx_sensitivity_dbm: float | None = None
    range_km: float | None = None
    antenna: str | None = None
    power_watts: float | None = None
    cost_usd_approx: float | None = None
    opex_usd_per_month: float | None = None
    mobility: str = "fixed"
    environment: str = "indoor"
    limitations: list[str] = Field(default_factory=list)
    evidence: DeviceEvidence = Field(default_factory=DeviceEvidence)
    origin: str = "library"


def load_seed_devices() -> list[DeviceSpec]:
    with DEVICES_JSON.open("r", encoding="utf-8") as f:
        data = json.load(f)
    return [DeviceSpec.model_validate({**d, "origin": "library"}) for d in data]


def list_devices(category: str | None = None, search: str | None = None) -> list[DeviceSpec]:
    devices = load_seed_devices()
    conn = db.connect()
    try:
        rows = conn.execute("SELECT data_json, origin FROM devices").fetchall()
        for row in rows:
            payload = db.load_json(row["data_json"])
            payload["origin"] = row["origin"]
            devices.append(DeviceSpec.model_validate(payload))
    finally:
        conn.close()
    if category:
        devices = [d for d in devices if d.category == category]
    if search:
        needle = search.lower()
        devices = [
            d
            for d in devices
            if needle in d.name.lower()
            or needle in d.device_id.lower()
            or needle in d.category.lower()
            or needle in d.family.lower()
            or any(needle in i.technology.lower() for i in d.interfaces)
        ]
    return sorted(devices, key=lambda d: d.device_id)


def get_device(device_id: str) -> DeviceSpec | None:
    for device in list_devices():
        if device.device_id == device_id:
            return device
    return None


def save_device(spec: DeviceSpec, origin: str = "custom") -> DeviceSpec:
    spec.origin = origin
    conn = db.connect()
    try:
        existing = conn.execute(
            "SELECT id FROM devices WHERE device_id = ?", (spec.device_id,)
        ).fetchone()
        payload = spec.model_dump(mode="json")
        ts = db.now_iso()
        if existing:
            conn.execute(
                "UPDATE devices SET data_json = ?, origin = ?, updated_at = ? WHERE device_id = ?",
                (db.dump_json(payload), origin, ts, spec.device_id),
            )
        else:
            conn.execute(
                "INSERT INTO devices (id, device_id, origin, data_json, created_at, updated_at)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                (str(uuid.uuid4()), spec.device_id, origin, db.dump_json(payload), ts, ts),
            )
        conn.commit()
    finally:
        conn.close()
    return spec


def device_technologies(device: DeviceSpec) -> list[str]:
    return [i.technology for i in device.interfaces]


def feasibility_check(spec: DeviceSpec) -> dict:
    """Deterministic specification-level feasibility checks (not manufacturing validation)."""
    issues: list[dict] = []
    warnings: list[dict] = []
    if not spec.interfaces:
        issues.append({"code": "no_interfaces", "message": "Device has no communication interfaces."})
    techs = {i.technology.lower() for i in spec.interfaces}
    radio_words = ("lte", "5g", "cellular", "vsat", "satellite", "wi-fi", "wifi", "lora")
    uses_radio = any(any(w in t for w in radio_words) for t in techs)
    if uses_radio and spec.tx_power_dbm is None:
        warnings.append({"code": "radio_no_tx", "message": "Radio interface without declared transmit power."})
    if uses_radio and spec.rx_sensitivity_dbm is None:
        warnings.append({"code": "radio_no_rx", "message": "Radio interface without declared receive sensitivity."})
    if spec.throughput_mbps is not None:
        slowest = min(
            (i.max_throughput_mbps for i in spec.interfaces if i.max_throughput_mbps),
            default=None,
        )
        if slowest is not None and spec.throughput_mbps > slowest * 1.001:
            issues.append(
                {
                    "code": "throughput_exceeds_interfaces",
                    "message": f"Declared throughput {spec.throughput_mbps} Mbps exceeds slowest interface {slowest} Mbps.",
                }
            )
    if spec.power_watts is not None and spec.power_watts < 0:
        issues.append({"code": "negative_power", "message": "Power consumption cannot be negative."})
    if spec.mobility == "mobile" and not spec.limitations:
        warnings.append(
            {"code": "mobile_no_limits", "message": "Mobile device should declare environmental/operational limitations."}
        )
    tech_list = list(techs)
    if len(tech_list) > 1 and any("satellite" in t or "vsat" in t for t in tech_list) and any(
        "lte" in t or "cellular" in t or "5g" in t for t in tech_list
    ):
        warnings.append(
            {
                "code": "gateway_expected",
                "message": "LTE + satellite in one device implies gateway functionality "
                "(protocol termination, routing, power): verify gateway role is intended.",
            }
        )
    return {
        "verdict": "infeasible" if issues else ("needs_review" if warnings else "feasible_spec"),
        "issues": issues,
        "warnings": warnings,
        "note": "Specification-level checks only; not electronics/RF/manufacturing validation.",
    }
