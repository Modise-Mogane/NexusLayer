"""Deterministic routing engine: path discovery, eligibility, and selection.

Metrics per candidate path:
- End-to-end latency: sum of link latencies.
- Bottleneck bandwidth: minimum link bandwidth along the path.
- Path reliability: product of link reliabilities.
- Path cost: sum of link cost_per_gb (synthetic USD/GB).

INDEPENDENCE ASSUMPTION (path reliability): the product rule treats every
link failure as a statistically independent event. Correlated real-world
failure modes (a storm degrading several maritime links at once, a shared
power outage, a satellite outage affecting all its beams) are NOT modeled.
The resulting number is a synthetic, comparative score for ranking backup
routes, not a measured availability figure.

BALANCED POLICY: metrics are min-max normalized across the eligible
candidate set (each metric mapped to 0..1 within the observed range), then
combined with explicit configurable weights. Units are never mixed without
normalization. Lower score wins. Single-candidate sets score 0.0.

All decisions are deterministic: candidate paths are enumerated in sorted
order and every policy comparison has explicit tie-breaks (fewer hops,
then lexicographic node sequence), so the same failure set always yields
the same route.
"""

from dataclasses import dataclass, field

import networkx as nx

POLICY_LOWEST_LATENCY = "lowest_latency"
POLICY_HIGHEST_BANDWIDTH = "highest_bandwidth"
POLICY_HIGHEST_RELIABILITY = "highest_reliability"
POLICY_LOWEST_COST = "lowest_cost"
POLICY_BALANCED = "balanced"

POLICIES = (
    POLICY_LOWEST_LATENCY,
    POLICY_HIGHEST_BANDWIDTH,
    POLICY_HIGHEST_RELIABILITY,
    POLICY_LOWEST_COST,
    POLICY_BALANCED,
)

DEFAULT_BALANCED_WEIGHTS = {
    "latency": 0.35,
    "bandwidth": 0.25,
    "reliability": 0.25,
    "cost": 0.15,
}


@dataclass(frozen=True)
class Route:
    node_ids: tuple[str, ...]
    link_ids: tuple[str, ...]
    latency_ms: float
    bandwidth_mbps: float
    reliability: float
    cost_per_gb: float = 0.0
    score: float | None = None
    eligible: bool = True
    ineligibility_reason: str = ""


def _eligible_edges(
    graph: nx.Graph,
    failed_link_ids: frozenset[str],
    failed_node_ids: frozenset[str],
    unsuitable_link_ids: frozenset[str] = frozenset(),
) -> set[tuple[str, str]]:
    eligible = set()
    for u, v, data in graph.edges(data=True):
        if data["link_id"] in failed_link_ids:
            continue
        if data["link_id"] in unsuitable_link_ids:
            continue
        if u in failed_node_ids or v in failed_node_ids:
            continue
        if data.get("status") == "down":
            continue
        eligible.add((u, v))
    return eligible


def find_paths(
    graph: nx.Graph,
    source: str,
    target: str,
    failed_link_ids: frozenset[str] = frozenset(),
    failed_node_ids: frozenset[str] = frozenset(),
    unsuitable_link_ids: frozenset[str] = frozenset(),
) -> list[Route]:
    """Return all viable routes from source to target, in sorted order.

    Failed, unsuitable, and down links/nodes are excluded. Each route
    carries its end-to-end metrics. Returns an empty list when no viable
    route exists.
    """
    if source in failed_node_ids or target in failed_node_ids:
        return []

    eligible = _eligible_edges(graph, failed_link_ids, failed_node_ids, unsuitable_link_ids)
    subgraph = nx.Graph()
    subgraph.add_nodes_from(graph.nodes(data=True))
    for u, v in eligible:
        subgraph.add_edge(u, v, **graph.edges[u, v])

    link_by_pair = {
        (u, v): data["link_id"] for u, v, data in graph.edges(data=True)
    }
    link_by_pair.update(
        {(v, u): link_id for (u, v), link_id in list(link_by_pair.items())}
    )

    routes: list[Route] = []
    try:
        raw_paths = nx.all_simple_paths(subgraph, source, target)
        for path in sorted(raw_paths):
            link_ids = tuple(
                link_by_pair[(path[i], path[i + 1])] for i in range(len(path) - 1)
            )
            latencies = [graph.edges[u, v]["latency_ms"] for u, v in zip(path, path[1:])]
            bandwidths = [graph.edges[u, v]["bandwidth_mbps"] for u, v in zip(path, path[1:])]
            reliabilities = [graph.edges[u, v]["reliability"] for u, v in zip(path, path[1:])]
            costs = [graph.edges[u, v].get("cost_per_gb", 0.0) for u, v in zip(path, path[1:])]
            product = 1.0
            for r in reliabilities:
                product *= r
            routes.append(
                Route(
                    node_ids=tuple(path),
                    link_ids=link_ids,
                    latency_ms=float(sum(latencies)),
                    bandwidth_mbps=float(min(bandwidths)),
                    reliability=float(product),
                    cost_per_gb=float(sum(costs)),
                )
            )
    except nx.NetworkXNoPath:
        return []

    return routes


def _normalize(values: list[float], invert: bool) -> list[float]:
    """Min-max normalize to 0..1 (best -> 0). Constant range maps to 0."""
    if not values:
        return []
    lo, hi = min(values), max(values)
    if hi == lo:
        return [0.0 for _ in values]
    if invert:
        return [(hi - v) / (hi - lo) for v in values]
    return [(v - lo) / (hi - lo) for v in values]


def score_balanced(
    routes: list[Route], weights: dict[str, float] | None = None
) -> list[Route]:
    """Attach normalized weighted scores (lower is better) to each route."""
    w = dict(DEFAULT_BALANCED_WEIGHTS)
    if weights:
        for key in w:
            if key in weights:
                w[key] = float(weights[key])
    total = sum(w.values()) or 1.0
    w = {k: v / total for k, v in w.items()}

    lat = _normalize([r.latency_ms for r in routes], invert=False)
    # Higher bandwidth/reliability is better -> invert so best maps to 0.
    bw = _normalize([r.bandwidth_mbps for r in routes], invert=True)
    rel = _normalize([r.reliability for r in routes], invert=True)
    cost = _normalize([r.cost_per_gb for r in routes], invert=False)

    scored = []
    for i, route in enumerate(routes):
        score = (
            w["latency"] * lat[i]
            + w["bandwidth"] * bw[i]
            + w["reliability"] * rel[i]
            + w["cost"] * cost[i]
        )
        scored.append(
            Route(
                node_ids=route.node_ids,
                link_ids=route.link_ids,
                latency_ms=route.latency_ms,
                bandwidth_mbps=route.bandwidth_mbps,
                reliability=route.reliability,
                cost_per_gb=route.cost_per_gb,
                score=score,
            )
        )
    return scored


def select_route(
    routes: list[Route],
    policy: str = POLICY_LOWEST_LATENCY,
    weights: dict[str, float] | None = None,
) -> Route | None:
    """Select the preferred route under a named policy (deterministic).

    Policies: "lowest_latency" (default), "highest_bandwidth",
    "highest_reliability", "lowest_cost", "balanced". Ties break toward
    fewer hops, then toward the lexicographically smallest node sequence.
    Returns None when empty.
    """
    if policy not in POLICIES:
        raise ValueError(f"Unknown routing policy: {policy!r}. Expected one of {list(POLICIES)}")
    if not routes:
        return None

    candidates = score_balanced(routes, weights) if policy == POLICY_BALANCED else routes

    def key(route: Route) -> tuple:
        hops = len(route.node_ids)
        if policy == POLICY_LOWEST_LATENCY:
            return (route.latency_ms, hops, route.node_ids)
        if policy == POLICY_HIGHEST_BANDWIDTH:
            return (-route.bandwidth_mbps, hops, route.node_ids)
        if policy == POLICY_LOWEST_COST:
            return (route.cost_per_gb, hops, route.node_ids)
        if policy == POLICY_BALANCED:
            return (route.score if route.score is not None else 0.0, hops, route.node_ids)
        return (-route.reliability, hops, route.node_ids)

    return min(candidates, key=key)


def should_switch(
    current: Route | None,
    candidate: Route | None,
    policy: str = POLICY_LOWEST_LATENCY,
    hysteresis: float = 0.10,
    dwell_ticks: int = 0,
    min_dwell_ticks: int = 0,
    weights: dict[str, float] | None = None,
) -> tuple[bool, str]:
    """Anti-flapping gate: decide whether a voluntary route change is allowed.

    Forced transitions (no current route, or no candidate) always resolve.
    Otherwise the candidate must beat the current route by the hysteresis
    margin AND the current route must have been held for min_dwell_ticks.
    Returns (allowed, reason).
    """
    if candidate is None:
        return False, "no candidate route available"
    if current is None:
        return True, "no current route; adopting candidate"
    if current.link_ids == candidate.link_ids:
        return False, "candidate equals current route"

    if dwell_ticks < min_dwell_ticks:
        return False, f"minimum dwell time not met ({dwell_ticks}/{min_dwell_ticks} ticks)"

    def improvement(cur: float, new: float, lower_better: bool) -> float:
        if cur == new:
            return 0.0
        if lower_better:
            return (cur - new) / abs(cur) if cur != 0 else (1.0 if new < cur else 0.0)
        return (new - cur) / abs(cur) if cur != 0 else (1.0 if new > cur else 0.0)

    if policy == POLICY_LOWEST_LATENCY:
        imp = improvement(current.latency_ms, candidate.latency_ms, True)
        metric = "latency"
    elif policy == POLICY_HIGHEST_BANDWIDTH:
        imp = improvement(current.bandwidth_mbps, candidate.bandwidth_mbps, False)
        metric = "bandwidth"
    elif policy == POLICY_HIGHEST_RELIABILITY:
        imp = improvement(current.reliability, candidate.reliability, False)
        metric = "reliability"
    elif policy == POLICY_LOWEST_COST:
        imp = improvement(current.cost_per_gb, candidate.cost_per_gb, True)
        metric = "cost"
    else:
        scored = score_balanced([current, candidate], weights)
        imp = improvement(scored[0].score or 0.0, scored[1].score or 0.0, True)
        metric = "balanced score"

    if imp >= hysteresis:
        return True, f"{metric} improvement {imp:.1%} exceeds hysteresis {hysteresis:.0%}"
    return False, f"{metric} improvement {imp:.1%} below hysteresis {hysteresis:.0%}"


def explain_selection(
    routes: list[Route],
    selected: Route | None,
    policy: str,
    weights: dict[str, float] | None = None,
) -> str:
    """Build a human-readable explanation of a routing decision."""
    if not routes:
        return "No eligible routes: all candidate paths are down, unsuitable, or incompatible."
    if selected is None:
        return f"No route selected under policy {policy}."
    parts = [
        f"Policy {policy} selected {' -> '.join(selected.node_ids)} "
        f"({selected.latency_ms:.0f} ms, {selected.bandwidth_mbps:.0f} Mbps, "
        f"reliability {selected.reliability:.3f}, cost ${selected.cost_per_gb:.2f}/GB) "
        f"from {len(routes)} eligible candidate(s)."
    ]
    if policy == POLICY_BALANCED:
        w = weights or DEFAULT_BALANCED_WEIGHTS
        parts.append(f"Weights (normalized): {w}.")
    others = [r for r in routes if r != selected]
    if others:
        alt = "; ".join(
            f"{' -> '.join(r.node_ids)} ({r.latency_ms:.0f} ms, {r.bandwidth_mbps:.0f} Mbps)"
            for r in others[:3]
        )
        parts.append(f"Alternatives: {alt}.")
    return " ".join(parts)
