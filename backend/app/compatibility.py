"""Technology compatibility checks for links and devices.

Simplified, documented model: each technology string is normalized into a
family (e.g. "Cellular (LTE)" -> "cellular"). A link is compatible when
both endpoint devices support its family, or when neither endpoint declares
restrictions (legacy scenarios without device bindings stay compatible).

Passive-adapter guard: conversions between radio families (e.g. LTE radio
directly into a satellite modem) are flagged infeasible unless a gateway
device with protocol termination is present on the path.
"""

from dataclasses import dataclass

# Normalized family -> aliases matched case-insensitively by substring.
TECHNOLOGY_FAMILIES: dict[str, tuple[str, ...]] = {
    "ethernet": ("ethernet",),
    "fiber": ("fiber", "olt", "pon", "optical"),
    "wifi": ("wi-fi", "wifi", "802.11"),
    "bluetooth": ("bluetooth", "ble"),
    "cellular": ("cellular", "lte", "5g", "4g", "3g", "2g", "nr", "gsm", "umts"),
    "lpwan": ("lpwan", "lora", "nb-iot", "lte-m", "sigfox"),
    "microwave": ("microwave", "ptp radio", "point-to-point"),
    "satellite": ("vsat", "satellite", "ka-band", "ku-band", "geo", "leo", "feeder"),
    "serial": ("serial", "rs-232", "rs232", "rs-485"),
}

# Families that require active gateway termination to interconnect.
RADIO_FAMILIES = {"cellular", "wifi", "bluetooth", "lpwan", "microwave", "satellite"}
GATEWAY_NODE_TYPES = {"gateway", "router", "edge_compute", "iot_gateway"}

# Port kinds that can interconnect directly without a conversion device.
DIRECT_WIRED_PAIRS = frozenset({("ethernet", "ethernet"), ("serial", "serial")})


def normalize_technology(technology: str) -> str:
    name = technology.lower()
    for family, aliases in TECHNOLOGY_FAMILIES.items():
        if any(alias in name for alias in aliases):
            return family
    return "other:" + technology.lower().strip()


@dataclass(frozen=True)
class CompatibilityResult:
    compatible: bool
    reason: str


def check_link_compatible(
    technology: str,
    source_techs: list[str],
    target_techs: list[str],
) -> CompatibilityResult:
    """Check a link technology against endpoint supported-technology lists."""
    family = normalize_technology(technology)
    if not source_techs and not target_techs:
        return CompatibilityResult(True, "no endpoint restrictions declared")
    source_families = {normalize_technology(t) for t in source_techs} if source_techs else {family}
    target_families = {normalize_technology(t) for t in target_techs} if target_techs else {family}
    if family not in source_families:
        return CompatibilityResult(
            False, f"source endpoint does not support {technology} (family {family})"
        )
    if family not in target_families:
        return CompatibilityResult(
            False, f"target endpoint does not support {technology} (family {family})"
        )
    return CompatibilityResult(True, f"both endpoints support {family}")


def check_port_pair(
    source_port: dict | None,
    target_port: dict | None,
    experimental: bool = False,
) -> CompatibilityResult:
    """Check two named node ports for direct interconnection.

    Ports are NodePortConfig dicts (or None when the link does not model
    ports, in which case the technology-level check applies instead).
    """
    if source_port is None or target_port is None:
        return CompatibilityResult(True, "ports not modeled; technology-level check applies")
    for port, side in ((source_port, "source"), (target_port, "target")):
        if not port.get("enabled", True):
            return CompatibilityResult(False, f"{side} port {port.get('name', '?')} is disabled")
    skind = str(source_port.get("kind", ""))
    tkind = str(target_port.get("kind", ""))
    if "power" in (skind, tkind):
        return CompatibilityResult(False, "power ports cannot carry a data link")
    if skind == tkind:
        if skind == "wifi":
            sch, tch = source_port.get("channel"), target_port.get("channel")
            if sch and tch and str(sch) != str(tch):
                return CompatibilityResult(
                    False, f"Wi-Fi channel mismatch ({sch} vs {tch}); radios cannot associate"
                )
        if skind == "fiber":
            swl, twl = source_port.get("wavelength_nm"), target_port.get("wavelength_nm")
            if swl and twl and abs(float(swl) - float(twl)) > 1.0:
                return CompatibilityResult(
                    False, f"fiber wavelength mismatch ({swl} vs {twl} nm)"
                )
        if skind == "cellular":
            sbands = set(source_port.get("bands") or [])
            tbands = set(target_port.get("bands") or [])
            if sbands and tbands and sbands.isdisjoint(tbands):
                return CompatibilityResult(
                    False, "no common cellular band between modem and cell"
                )
        return CompatibilityResult(True, f"matched {skind} ports")
    if experimental:
        return CompatibilityResult(True, "experimental model: cross-kind link explicitly allowed")
    return CompatibilityResult(
        False,
        f"{skind} cannot connect directly to {tkind}; use a conversion device "
        "(e.g. access point, media converter, gateway) or flag the link experimental",
    )


def check_path_gateways(
    node_ids: list[str],
    link_technologies: list[str],
    node_types: dict[str, str],
) -> CompatibilityResult:
    """Flag paths that join radio families without an intermediate gateway."""
    families = [normalize_technology(t) for t in link_technologies]
    radio_runs: list[str] = []
    for family in families:
        if family in RADIO_FAMILIES:
            if not radio_runs or radio_runs[-1] != family:
                radio_runs.append(family)
        else:
            # Wired segments terminate radio runs only at gateway-capable nodes.
            pass
    distinct_radio = [f for f in dict.fromkeys(radio_runs)]
    if len(distinct_radio) <= 1:
        return CompatibilityResult(True, "single radio family on path")
    middle_types = {node_types.get(nid, "") for nid in node_ids[1:-1]}
    if middle_types & GATEWAY_NODE_TYPES:
        return CompatibilityResult(True, "radio families joined via gateway device")
    # Direct endpoint handover between two access links (e.g. cellular + sat
    # both terminating at the mobile node) is a valid multi-homed endpoint:
    # only flag chains of 3+ links mixing radio without gateway.
    if len(link_technologies) <= 2:
        return CompatibilityResult(True, "endpoint multi-homing across access links")
    return CompatibilityResult(
        False,
        f"radio families {distinct_radio} chained without a gateway; "
        "a passive adapter cannot convert between radio protocols",
    )
