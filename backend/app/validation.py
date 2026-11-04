"""Architecture validation: missing connections, incompatibility, endpoints."""

from . import compatibility
from .models import Topology


def validate_topology(topology: Topology) -> dict:
    issues: list[dict] = []
    recommendations: list[str] = []
    node_ids = {n.id for n in topology.nodes}
    by_id = {n.id: n for n in topology.nodes}

    for link in topology.links:
        if link.source not in node_ids or link.target not in node_ids:
            issues.append({"severity": "error", "code": "unknown_node",
                           "message": f"Link {link.id} references a missing node."})
            continue
        src, dst = by_id[link.source], by_id[link.target]
        result = compatibility.check_link_compatible(
            link.technology, src.supported_technologies, dst.supported_technologies
        )
        if not result.compatible:
            issues.append({"severity": "error", "code": "incompatible_interface",
                           "message": f"Link {link.id}: {result.reason}."})
        if link.source_port or link.target_port:
            sport = next((p for p in src.ports if p.name == link.source_port), None)
            tport = next((p for p in dst.ports if p.name == link.target_port), None)
            if link.source_port and sport is None:
                issues.append({"severity": "error", "code": "unknown_port",
                               "message": f"Link {link.id} names unknown source port {link.source_port!r}."})
            if link.target_port and tport is None:
                issues.append({"severity": "error", "code": "unknown_port",
                               "message": f"Link {link.id} names unknown target port {link.target_port!r}."})
            port_check = compatibility.check_port_pair(
                sport.model_dump() if sport else None,
                tport.model_dump() if tport else None,
                link.experimental,
            )
            if not port_check.compatible:
                issues.append({"severity": "error", "code": "incompatible_ports",
                               "message": f"Link {link.id}: {port_check.reason}."})
        if link.medium == "wireless" and link.max_range_km is None and "satellite" not in link.technology.lower() and "vsat" not in link.technology.lower() and "feeder" not in link.technology.lower():
            issues.append({"severity": "warning", "code": "wireless_no_range",
                           "message": f"Wireless link {link.id} has no max_range_km; movement cannot affect it."})

    incident: dict[str, int] = {n.id: 0 for n in topology.nodes}
    for link in topology.links:
        if link.source in incident:
            incident[link.source] += 1
        if link.target in incident:
            incident[link.target] += 1
    for nid, count in incident.items():
        if count == 0:
            issues.append({"severity": "error", "code": "disconnected_node",
                           "message": f"Node {by_id[nid].label} ({nid}) has no connections."})

    endpoints = [n for n in topology.nodes if n.type in ("ship", "car", "vehicle", "aircraft", "train", "drone")]
    if not endpoints:
        issues.append({"severity": "warning", "code": "no_mobile_endpoint",
                       "message": "No mobile endpoint (ship/car/aircraft/train) present."})
    if not any(n.type == "internet" for n in topology.nodes):
        issues.append({"severity": "error", "code": "no_internet",
                       "message": "No internet node present; routes cannot terminate."})
    for ep in endpoints:
        count = incident.get(ep.id, 0)
        if count == 1:
            recommendations.append(f"Endpoint {ep.label} has one access link; add a backup technology for failover.")

    techs = {l.technology for l in topology.links}
    if len(techs) > 2:
        recommendations.append("Multiple technologies present: verify a gateway provides protocol termination between radio families.")

    errors = sum(1 for i in issues if i["severity"] == "error")
    return {
        "valid": errors == 0,
        "issues": issues,
        "recommendations": recommendations,
        "summary": f"{errors} error(s), {len(issues) - errors} warning(s).",
    }
