"""Inter-device communication sessions (Stage C4).

Resolves an end-to-end path between two addressable world entities over the
*live* simulation graph (failed/down/unsuitable links excluded, interface
compatibility enforced), then estimates delivery from the same synthetic
latency/bandwidth/cost figures the routing engine uses. Every record names
its hops, media, security scope, and assumptions; failures explain the
blocking constraint instead of failing silently.
"""

from pydantic import BaseModel, Field

from . import phy as phy_module
from . import routing as routing_module
from . import scenarios as scenario_store
from . import simulation as sim_module
from . import traffic as traffic_module

# Message kind -> (default size KB, traffic profile id).
KINDS: dict[str, tuple[float, str]] = {
    "message": (4.0, "messaging"),
    "telemetry": (1.0, "telemetry"),
    "file": (5120.0, "file_transfer"),
    "voice": (750.0, "voice"),  # ~1 min call equivalent
    "video": (9000.0, "video_call"),  # ~1 min call equivalent
}


class MessageSendRequest(BaseModel):
    scenario_id: str = "maritime_failover"
    source_id: str = Field(min_length=1)
    dest_id: str = Field(min_length=1)
    kind: str = Field(default="message", pattern="^(message|telemetry|file|voice|video)$")
    size_kb: float | None = Field(default=None, ge=0.01, le=10_000_000)


class MessageHop(BaseModel):
    link_id: str
    from_id: str
    from_label: str
    to_id: str
    to_label: str
    technology: str
    medium: str
    latency_ms: float
    bandwidth_mbps: float
    distance_km: float | None = None
    security: str


class MessageRecord(BaseModel):
    id: str
    scenario_id: str
    source_id: str
    source_label: str
    dest_id: str
    dest_label: str
    kind: str
    size_kb: float
    status: str  # delivered | failed
    reason: str
    hops: list[MessageHop] = []
    path_labels: list[str] = []
    latency_ms: float | None = None
    achieved_mbps: float | None = None
    transfer_ms: float | None = None
    total_ms: float | None = None
    cost_usd: float | None = None
    reliability: float | None = None
    meets_profile: bool = False
    profile_notes: list[str] = []
    tick: int = 0
    sim_time_s: float = 0.0
    assumptions: list[str] = []


_COUNTER = 0


def _next_id() -> str:
    global _COUNTER
    _COUNTER += 1
    return f"msg-{_COUNTER:04d}"


def _hop_security(link) -> str:
    sec = link.security
    if sec is None:
        return "no link security configured (modeled as open)"
    proto = getattr(sec, "security_protocol", None) or "unspecified protocol"
    scope = getattr(sec, "scope", None) or "this hop only"
    return f"{proto} ({scope}) — hop-scoped, not end-to-end"


def _diagnose(session, source_id: str, dest_id: str) -> str:
    """Explain why no eligible path exists, using the raw topology."""
    raw = routing_module.find_paths(session._graph, source_id, dest_id)
    if not raw:
        extra = ""
        if session._failed_links:
            extra = f" ({len(session._failed_links)} link(s) down in this session: " \
                + ", ".join(sorted(session._failed_links)[:4]) + ")"
        elif session._unsuitable_links:
            extra = f" ({len(session._unsuitable_links)} link(s) currently unsuitable)"
        return f"No topological path exists between {source_id} and {dest_id}." + extra
    first = raw[0]
    link_by_id = {link.id: link for link in session._topology.links}
    problems: list[str] = []
    for lid in first.link_ids:
        link = link_by_id[lid]
        if lid in session._failed_links or link.status == "down":
            problems.append(f"{lid} is down")
        elif lid in session._unsuitable_links:
            problems.append(f"{lid} is unsuitable ({link.technology})")
    if problems:
        return "Shortest path blocked: " + "; ".join(problems[:3]) + "."
    ok, reason = session._route_feasible(first, frozenset({dest_id}))
    if not ok:
        return f"Shortest path rejected: {reason}."
    return "No eligible path under current conditions."


def send_message(body: MessageSendRequest) -> MessageRecord:
    session = sim_module.get_session(body.scenario_id)
    detail = scenario_store.get_scenario(body.scenario_id)
    if detail is None:
        raise KeyError(f"Unknown scenario {body.scenario_id!r}")
    labels = {n.id: n.label for n in detail.topology.nodes}
    if body.source_id not in labels:
        raise KeyError(f"Unknown node {body.source_id!r}")
    if body.dest_id not in labels:
        raise KeyError(f"Unknown node {body.dest_id!r}")
    if body.source_id == body.dest_id:
        raise ValueError("Source and destination are the same device")

    default_kb, profile_id = KINDS[body.kind]
    size_kb = body.size_kb if body.kind == "file" and body.size_kb else default_kb
    profile = traffic_module.TRAFFIC_PROFILES[profile_id]
    route = session.resolve_device_route(body.source_id, body.dest_id)

    base_assumptions = [
        "Path resolved on live link states (down/unsuitable excluded).",
        "Links treated as bidirectional with configured latency (documented simplification).",
        "Transfer time = payload / fair-share bottleneck; protocol overhead not modeled.",
        "Costs are synthetic planning figures (capex/opex separated in reports).",
    ]

    if route is None:
        reason = _diagnose(session, body.source_id, body.dest_id)
        record = MessageRecord(
            id=_next_id(), scenario_id=body.scenario_id,
            source_id=body.source_id, source_label=labels[body.source_id],
            dest_id=body.dest_id, dest_label=labels[body.dest_id],
            kind=body.kind, size_kb=size_kb, status="failed", reason=reason,
            tick=session._tick, sim_time_s=session._sim_time_s,
            assumptions=base_assumptions,
        )
        session.store_message(record.model_dump(mode="json"))
        session.log_message(f"{record.id}: {body.kind} {labels[body.source_id]} → "
                            f"{labels[body.dest_id]} FAILED ({reason})")
        return record

    link_by_id = {link.id: link for link in detail.topology.links}
    # Fair share: active endpoint routes already using each link + this message.
    state = session.get_state()
    sharers: dict[str, int] = {}
    for ep in state.endpoint_routes:
        if ep.route:
            for lid in ep.route.link_ids:
                sharers[lid] = sharers.get(lid, 0) + 1
    link_bw = {lid: link_by_id[lid].bandwidth_mbps for lid in route.link_ids}
    msg_sharers = {lid: sharers.get(lid, 0) + 1 for lid in route.link_ids}
    achieved = traffic_module.fair_share_achieved(list(route.link_ids), link_bw, msg_sharers)

    hops: list[MessageHop] = []
    node_ids = list(route.node_ids)
    for i, lid in enumerate(route.link_ids):
        link = link_by_id[lid]
        a, b = node_ids[i], node_ids[i + 1]
        try:
            dist, _ = phy_module.link_distance_km(detail.topology, lid)
        except (KeyError, ValueError):
            dist = None
        hops.append(MessageHop(
            link_id=lid, from_id=a, from_label=labels.get(a, a),
            to_id=b, to_label=labels.get(b, b),
            technology=link.technology, medium=link.medium,
            latency_ms=link.latency_ms, bandwidth_mbps=link.bandwidth_mbps,
            distance_km=dist, security=_hop_security(link),
        ))

    transfer_ms = (size_kb * 8 / 1000) / achieved * 1000 if achieved > 0 else None
    total_ms = route.latency_ms + (transfer_ms or 0.0)
    meets, notes = traffic_module.check_suitability(profile, route.latency_ms, achieved)
    cost = route.cost_per_gb * (size_kb / 1e6)
    record = MessageRecord(
        id=_next_id(), scenario_id=body.scenario_id,
        source_id=body.source_id, source_label=labels[body.source_id],
        dest_id=body.dest_id, dest_label=labels[body.dest_id],
        kind=body.kind, size_kb=size_kb, status="delivered",
        reason=f"Delivered over {len(hops)} hop(s) under policy {state.routing_policy}.",
        hops=hops, path_labels=[labels.get(n, n) for n in node_ids],
        latency_ms=route.latency_ms, achieved_mbps=achieved,
        transfer_ms=transfer_ms, total_ms=total_ms, cost_usd=cost,
        reliability=route.reliability, meets_profile=meets, profile_notes=notes,
        tick=state.tick, sim_time_s=state.sim_time_s,
        assumptions=base_assumptions + [
            f"Fair share counts {sum(max(sharers.get(l, 0), 0) for l in route.link_ids)} "
            "other active endpoint route(s) on this path.",
            f"Profile '{profile.label}': needs {profile.required_mbps} Mbps, "
            f"≤ {profile.max_latency_ms:.0f} ms.",
        ],
    )
    session.store_message(record.model_dump(mode="json"))
    session.log_message(f"{record.id}: {body.kind} {record.source_label} → "
                        f"{record.dest_label} delivered in {total_ms:.0f} ms "
                        f"({len(hops)} hops).")
    return record


def list_messages(scenario_id: str) -> list[dict]:
    return sim_module.get_session(scenario_id).get_messages()
