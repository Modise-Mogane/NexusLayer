"""Physical-layer inspector service: media explainers + honest calculations.

Every value shown is either computed here from declared inputs (with the
formula, inputs, and units exposed) or explicitly marked "Not calculated"
with the missing variables named. Nothing is fabricated: SNR, Shannon
capacity, and packet loss appear only when their model and inputs exist.
"""

import math

from . import hardware, mobility, rf
from .compatibility import normalize_technology
from .models import Topology

SPEED_OF_LIGHT_KM_S = 299792.458
FIBER_REFRACTIVE_INDEX = 1.47

# -- medium explainers -------------------------------------------------------
# Careful wording: guided EM energy (not drifting electrons) for copper;
# modulated light for fiber; modulated RF waves for radio.

MEDIUM_EXPLAINERS: dict[str, dict] = {
    "ethernet": {
        "title": "Copper Ethernet — guided electromagnetic signaling",
        "mechanism": [
            "Data is represented by rapidly changing electrical signals applied to twisted-pair conductors. "
            "The signal propagates as electromagnetic energy guided by the cable, not as electrons traveling "
            "end to end: charge carriers drift slowly while the EM wave travels near 60–80% of light speed.",
            "Modern twisted-pair Ethernet uses differential signaling (equal, opposite voltages on each wire "
            "of a pair) plus echo cancellation and multi-level encoding (e.g. PAM-5 for 1000BASE-T, PAM-4 for "
            "multi-gigabit) to reject noise and reach its rated speed.",
        ],
        "key_points": [
            "Attenuation rises with frequency and length; 100 m is the standard reach limit for twisted pair.",
            "Crosstalk, return loss, and external noise bound the usable signal quality.",
            "Propagation delay is roughly 5 ns per meter of cable.",
        ],
    },
    "fiber": {
        "title": "Fiber optics — modulated light in glass",
        "mechanism": [
            "Data is carried by light from a laser or LED, switched or modulated to encode bits, confined "
            "inside the fiber core by total internal reflection.",
            "The receiver (photodiode + amplifier) converts arriving photons back into an electrical signal. "
            "Link viability is governed by the optical power budget: launched power minus fiber, connector, "
            "and splice losses must still exceed receiver sensitivity.",
        ],
        "key_points": [
            "Common windows: 850 nm (multimode, short reach), 1310/1550 nm (single-mode, long reach).",
            "Attenuation is ~0.2–0.4 dB/km at 1550 nm; connectors/splices add tenths of a dB each.",
            "Light in fiber travels at c / 1.47, about 4.9 µs per km.",
        ],
    },
    "wifi": {
        "title": "Wi-Fi — radio waves in unlicensed spectrum",
        "mechanism": [
            "Data modulates a radio carrier (OFDM subcarriers with QAM constellations in modern 802.11) "
            "radiated by the transmitter antenna as free-space electromagnetic waves.",
            "The receiver captures a fraction of that energy; usable rate follows received power, noise, "
            "interference from neighboring networks, and the negotiated MCS (modulation and coding scheme).",
        ],
        "key_points": [
            "Shared medium: CSMA/CA coordinates access; congestion reduces every station's throughput.",
            "Bands (2.4/5/6 GHz), channel, and width must match on both radios to associate.",
            "Walls and distance dominate real-world range; free-space loss is a best case.",
        ],
    },
    "cellular": {
        "title": "Cellular (LTE/5G) — scheduled radio access + mobile core",
        "mechanism": [
            "The device attaches to a base station (eNodeB/gNodeB) over a scheduled radio interface: the "
            "base station assigns time/frequency resources for uplink and downlink, unlike Wi-Fi contention.",
            "User traffic flows device → radio bearer → base station → mobile core (gateway functions) → "
            "internet. Mobility is managed by the network through measurement reports and handovers.",
        ],
        "key_points": [
            "Both sides must share a supported band and radio technology generation.",
            "Uplink is usually the constraint: handset power (~23 dBm) vs base-station power (~46 dBm).",
            "Access-network security (e.g. 5G-AKA per 3GPP TS 33.501) protects the radio leg only.",
        ],
    },
    "satellite": {
        "title": "Satellite relay — RF uplink, space segment, RF downlink",
        "mechanism": [
            "The terminal transmits a focused RF uplink (e.g. Ka/Ku band) to the satellite; the space "
            "segment relays it (bent-pipe transponder in this model) to a ground gateway on the downlink.",
            "End-to-end latency is dominated by geometry: a GEO round trip is ~240 ms of pure propagation "
            "before processing, queueing, and terrestrial backhaul are added.",
        ],
        "key_points": [
            "Rain fade and atmospheric loss matter at Ka/Ku bands; modeled here as extra loss.",
            "Terminal and gateway need open sky view toward the orbital slot.",
            "Capacity is shared and expensive; see the cost tab for the modeled tariff.",
        ],
    },
    "microwave": {
        "title": "Microwave point-to-point — directional radio relay",
        "mechanism": [
            "Two highly directional antennas form a fixed line-of-sight hop, typically with high-order QAM "
            "for hundreds of Mbps to Gbps over tens of kilometers.",
            "The first Fresnel zone must be clear; rain fade at higher bands can force adaptive modulation "
            "downshifts during storms.",
        ],
        "key_points": [
            "Requires surveyed line of sight and aligned dishes on both ends.",
            "Latency is near propagation delay: ~3.3 µs per km of path.",
        ],
    },
    "serial": {
        "title": "Serial line — baseband electrical signaling",
        "mechanism": [
            "Bits are sent sequentially as voltage levels (e.g. RS-232/RS-485) over copper, typically for "
            "console, telemetry, or industrial control at modest speeds.",
        ],
        "key_points": ["Short reach at high speed; RS-485 differential pairs extend range."],
    },
    "bluetooth": {
        "title": "Bluetooth — short-range radio",
        "mechanism": [
            "Frequency-hopping radio in the 2.4 GHz band for personal-area links, typically meters of range "
            "at low power.",
        ],
        "key_points": ["Pairing/bonding governs access; throughput is modest by design."],
    },
    "lpwan": {
        "title": "LPWAN — long-range, low-rate radio",
        "mechanism": [
            "Narrowband or spread-spectrum modulation (e.g. LoRa chirps, NB-IoT) trades data rate for link "
            "budget, reaching kilometers at milliwatts for sensor traffic.",
        ],
        "key_points": ["Uplink-centric; downlink capacity and duty-cycle limits constrain use cases."],
    },
    "other": {
        "title": "Unmodeled medium",
        "mechanism": ["No physical-medium model is registered for this technology family."],
        "key_points": ["Treat displayed link parameters as configured estimates only."],
    },
}

# Registry source ids worth citing per family (see sources.py SEED_SOURCES).
FAMILY_REFERENCES: dict[str, list[dict]] = {
    "ethernet": [{"source_id": "ieee-802-3", "label": "IEEE 802.3 Ethernet Working Group"}],
    "fiber": [{"source_id": "ieee-802-3", "label": "IEEE 802.3 Ethernet Working Group"}],
    "wifi": [{"source_id": "ieee-802-11", "label": "IEEE 802.11 Wireless LAN Working Group"}],
    "cellular": [
        {"source_id": "3gpp-36300", "label": "3GPP TS 36.300 — LTE/E-UTRAN"},
        {"source_id": "3gpp-38300", "label": "3GPP TS 38.300 — 5G NR/NG-RAN"},
    ],
    "satellite": [
        {"source_id": "itu-p618", "label": "ITU-R P.618 — Earth-space propagation"},
        {"source_id": "3gpp-38821", "label": "3GPP TR 38.821 — Non-Terrestrial Networks"},
    ],
    "microwave": [{"source_id": "itu-p452", "label": "ITU-R P.452 — Terrestrial interference"}],
}

SECURITY_REFERENCES = [
    {"label": "3GPP TS 33.501 — 5G security architecture", "note": "Access-network security; radio leg only."},
    {"label": "TLS 1.3 (IETF RFC 8446)", "note": "Transport/application scope; independent of link security."},
    {"label": "WPA3 (Wi-Fi Alliance / IEEE 802.11)", "note": "Wi-Fi link-layer protection where configured."},
]

FAMILY_PRESET = {
    "wifi": "wifi",
    "cellular": "lte_uplink",
    "satellite": "vsat_uplink",
    "microwave": "microwave",
    "lpwan": "lora",
    "bluetooth": "wifi",
}


def _positions(topology: Topology) -> dict[str, dict]:
    return {
        n.id: n.world_position.model_dump() if n.world_position else {}
        for n in topology.nodes
    }


def link_distance_km(topology: Topology, link_id: str) -> tuple[float | None, str]:
    link = next((l for l in topology.links if l.id == link_id), None)
    if link is None:
        return None, "unknown link"
    pos = _positions(topology)
    a, b = pos.get(link.source) or {}, pos.get(link.target) or {}
    if not a or not b:
        return None, "one or both endpoints lack world positions"
    alt = max(float(a.get("altitude_m", 0.0)), float(b.get("altitude_m", 0.0)))
    if alt > 1000.0:
        return rf.slant_range_km(a, b), "slant range (3D, altitude-aware)"
    return mobility.distance_km(a, b), "ground distance (2D)"


def _budget_params(link, source_port: dict | None) -> tuple[rf.BudgetParams | None, list[str]]:
    """Resolve link-budget params: link rf config, else port values, else family preset."""
    notes: list[str] = []
    family = normalize_technology(link.technology)
    rf_data = link.rf.model_dump() if link.rf else {}
    params = rf.params_from_dict(rf_data or None, link.technology)
    if params is not None and (link.rf is not None):
        notes.append(f"link RF config ({link.rf.preset or 'custom'})")
        return params, notes
    preset_name = (link.rf.preset if link.rf and link.rf.preset else None) or FAMILY_PRESET.get(family)
    base = rf.TECH_PRESETS.get(preset_name or "")
    if base is None:
        return None, [f"no link-budget preset for family {family!r}"]
    values = dict(base.__dict__)
    notes.append(f"illustrative preset {preset_name} (no link RF config)")
    if source_port:
        if source_port.get("frequency_mhz"):
            values["frequency_mhz"] = float(source_port["frequency_mhz"])
            notes.append("frequency from source port")
        if source_port.get("tx_power_dbm") is not None:
            values["tx_power_dbm"] = float(source_port["tx_power_dbm"])
            notes.append("TX power from source port")
        if source_port.get("antenna_gain_dbi") is not None:
            values["tx_gain_dbi"] = float(source_port["antenna_gain_dbi"])
            notes.append("TX gain from source port")
    return rf.BudgetParams(**values), notes


def explain_link(topology: Topology, link_id: str, live: dict | None = None) -> dict:
    """Full physical-layer explanation for one link. Raises KeyError if unknown."""
    link = next((l for l in topology.links if l.id == link_id), None)
    if link is None:
        raise KeyError(f"Unknown link {link_id!r}")
    nodes = {n.id: n for n in topology.nodes}
    src, dst = nodes.get(link.source), nodes.get(link.target)
    family = normalize_technology(link.technology)
    family_key = family if family in MEDIUM_EXPLAINERS else "other"

    sport = None
    if link.source_port and src:
        sport = next((p.model_dump() for p in src.ports if p.name == link.source_port), None)
    tport = None
    if link.target_port and dst:
        tport = next((p.model_dump() for p in dst.ports if p.name == link.target_port), None)

    distance_km, distance_how = link_distance_km(topology, link_id)

    calculations: list[dict] = []
    # -- link budget (radio families only) --
    if family in FAMILY_PRESET or (link.rf and link.rf.model == "link_budget"):
        params, notes = _budget_params(link, sport)
        if params is None:
            calculations.append({
                "id": "link_budget", "title": "Radio link budget",
                "status": "not_calculated", "missing": notes,
                "formula": "RX (dBm) = TX + Gtx + Grx − path loss − other losses",
            })
        elif distance_km is None:
            calculations.append({
                "id": "link_budget", "title": "Radio link budget",
                "status": "not_calculated",
                "missing": [f"distance: {distance_how}"],
                "formula": "RX (dBm) = TX + Gtx + Grx − path loss − other losses",
            })
        else:
            rx_dbm, fspl = rf.received_power_dbm(params, distance_km)
            margin = rx_dbm - params.rx_sensitivity_dbm
            result = rf.evaluate(params, distance_km, True)
            calculations.append({
                "id": "link_budget", "title": "Radio link budget (uplink direction assumed)",
                "status": "calculated",
                "formula": "RX (dBm) = TX + Gtx + Grx − FSPL − other losses",
                "assumptions": notes + [
                    "Free-space path loss (best case; no shadowing, fading, or interference)",
                    "Uplink direction assumed; downlink differs by TX power and gains",
                ],
                "inputs": [
                    {"label": "Distance", "value": round(distance_km, 3), "unit": "km", "how": distance_how},
                    {"label": "Frequency", "value": params.frequency_mhz, "unit": "MHz"},
                    {"label": "TX power", "value": params.tx_power_dbm, "unit": "dBm"},
                    {"label": "TX antenna gain", "value": params.tx_gain_dbi, "unit": "dBi"},
                    {"label": "RX antenna gain", "value": params.rx_gain_dbi, "unit": "dBi"},
                    {"label": "Other losses", "value": params.extra_loss_db, "unit": "dB"},
                    {"label": "RX sensitivity", "value": params.rx_sensitivity_dbm, "unit": "dBm"},
                    {"label": "Required margin", "value": params.required_margin_db, "unit": "dB"},
                ],
                "outputs": [
                    {"label": "Path loss (FSPL)", "value": round(fspl, 2), "unit": "dB",
                     "formula": "20·log10(d_km) + 20·log10(f_MHz) + 32.44"},
                    {"label": "Received power", "value": round(rx_dbm, 2), "unit": "dBm"},
                    {"label": "Link margin", "value": round(margin, 2), "unit": "dB",
                     "formula": "RX − sensitivity"},
                    {"label": "Suitable", "value": result.suitable, "unit": "",
                     "formula": f"margin ≥ {params.required_margin_db} dB"},
                ],
            })
    # -- propagation delay --
    if distance_km is not None:
        speed = SPEED_OF_LIGHT_KM_S / (FIBER_REFRACTIVE_INDEX if family == "fiber" else 1.0)
        delay_us = distance_km / speed * 1e6
        calculations.append({
            "id": "propagation_delay", "title": "Propagation delay",
            "status": "calculated",
            "formula": "t = d / v" + (" (v = c/1.47 in fiber)" if family == "fiber" else " (v = c)"),
            "inputs": [{"label": "Distance", "value": round(distance_km, 3), "unit": "km", "how": distance_how}],
            "outputs": [{"label": "One-way delay", "value": round(delay_us, 2), "unit": "µs"}],
        })
    else:
        calculations.append({
            "id": "propagation_delay", "title": "Propagation delay",
            "status": "not_calculated", "missing": [f"distance: {distance_how}"],
            "formula": "t = d / v",
        })
    # -- wavelength --
    freq_mhz = None
    if link.rf and link.rf.frequency_mhz:
        freq_mhz = link.rf.frequency_mhz
    elif sport and sport.get("frequency_mhz"):
        freq_mhz = float(sport["frequency_mhz"])
    else:
        preset = rf.TECH_PRESETS.get(FAMILY_PRESET.get(family, ""))
        if preset and family in FAMILY_PRESET:
            freq_mhz = preset.frequency_mhz
    wavelength_m = SPEED_OF_LIGHT_KM_S * 1000 / (freq_mhz * 1e6) if freq_mhz else None
    # -- honestly unmodeled quantities --
    calculations.append({
        "id": "snr", "title": "SNR / SINR",
        "status": "not_calculated",
        "missing": ["noise floor (thermal + receiver NF)", "interference model"],
        "formula": "SNR = RX − noise",
    })
    calculations.append({
        "id": "shannon", "title": "Theoretical (Shannon) capacity",
        "status": "not_calculated",
        "missing": ["SNR (see above)", "allocated bandwidth"],
        "formula": "C = B · log2(1 + SNR)",
    })
    calculations.append({
        "id": "packet_loss", "title": "Packet loss",
        "status": "not_calculated",
        "missing": ["error model (no fading/interference simulation in this phase)"],
        "formula": "—",
    })

    sec = link.security.model_dump() if link.security else None
    security_view = None
    if sec:
        security_view = {
            **sec,
            "scope_warning": (
                f"Protects this hop only ({sec['scope']} scope). "
                "It does not imply other hops or the end-to-end path are encrypted."
                if sec["scope"] != "application" else
                "Application scope on this hop; verify every other hop independently."
            ),
        }

    costs: dict = {"cost_per_gb_usd": link.cost_per_gb, "devices": []}
    for node in (src, dst):
        if node is not None and node.device_id:
            spec = hardware.get_device(node.device_id)
            if spec:
                costs["devices"].append({
                    "node_id": node.id, "name": spec.name,
                    "capex_usd_approx": spec.cost_usd_approx,
                    "opex_usd_per_month": spec.opex_usd_per_month,
                })

    return {
        "link_id": link.id,
        "label": link.label or link.id,
        "technology": link.technology,
        "medium": link.medium,
        "family": family,
        "source": {"id": link.source, "label": src.label if src else link.source,
                   "type": src.type if src else "", "port": link.source_port},
        "target": {"id": link.target, "label": dst.label if dst else link.target,
                   "type": dst.type if dst else "", "port": link.target_port},
        "configured": {
            "latency_ms": link.latency_ms,
            "bandwidth_mbps": link.bandwidth_mbps,
            "reliability": link.reliability,
            "status": link.status,
            "note": "Configured planning estimates, not measurements.",
        },
        "distance_km": round(distance_km, 3) if distance_km is not None else None,
        "distance_how": distance_how,
        "frequency_mhz": freq_mhz,
        "wavelength_m": round(wavelength_m, 4) if wavelength_m else None,
        "medium_explainer": MEDIUM_EXPLAINERS[family_key],
        "calculations": calculations,
        "protocols": link.protocols,
        "security": security_view,
        "live": live,
        "costs": costs,
        "references": FAMILY_REFERENCES.get(family, []),
        "security_references": SECURITY_REFERENCES,
        "provenance": "deterministic: rf.py link budget + topology geometry; presets illustrative",
    }
