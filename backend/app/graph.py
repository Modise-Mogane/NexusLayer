"""NetworkX graph engine for the NexusLayer simulation.

Builds an undirected graph from a Topology scenario. Nodes carry an
operational status plus derived network interfaces (one per incident link).
Links carry synthetic performance attributes and an operational status.

This is a graph-based, discrete-event-inspired model. It does not simulate
RF propagation in full detail, satellite orbital mechanics, or real
routing-protocol convergence. Simplified documented suitability models
live in mobility.py.
"""

import networkx as nx

from .models import Topology

STATUS_UP = "up"
STATUS_DOWN = "down"


def build_graph(topology: Topology) -> nx.Graph:
    """Build a NetworkX graph from a validated topology scenario.

    Node attributes: id, type, label, status ("up"), interfaces
    (list of {"link_id", "technology", "neighbor_id"}), world_position,
    mobility, supported_technologies, device_id.
    Edge attributes: link_id, technology, bandwidth_mbps, latency_ms,
    reliability (0..1 fraction), cost_per_gb, medium, max_range_km,
    status ("up").
    """
    graph: nx.Graph = nx.Graph()

    for node in topology.nodes:
        graph.add_node(
            node.id,
            id=node.id,
            type=node.type,
            label=node.label,
            status=STATUS_UP,
            interfaces=[],
            device_id=node.device_id,
            supported_technologies=list(node.supported_technologies),
            world_position=node.world_position.model_dump() if node.world_position else None,
            mobility=node.mobility.model_dump() if node.mobility else None,
        )

    for link in topology.links:
        if link.source not in graph or link.target not in graph:
            raise ValueError(
                f"Link {link.id} references unknown node: "
                f"{link.source} -> {link.target}"
            )
        graph.add_edge(
            link.source,
            link.target,
            link_id=link.id,
            technology=link.technology,
            bandwidth_mbps=link.bandwidth_mbps,
            latency_ms=link.latency_ms,
            reliability=link.reliability,
            cost_per_gb=link.cost_per_gb,
            medium=link.medium,
            max_range_km=link.max_range_km,
            status=STATUS_UP,
        )
        graph.nodes[link.source]["interfaces"].append(
            {
                "link_id": link.id,
                "technology": link.technology,
                "neighbor_id": link.target,
            }
        )
        graph.nodes[link.target]["interfaces"].append(
            {
                "link_id": link.id,
                "technology": link.technology,
                "neighbor_id": link.source,
            }
        )

    return graph


def link_endpoints(graph: nx.Graph) -> dict[str, tuple[str, str]]:
    """Map link_id -> (node_u, node_v) for every edge in the graph."""
    return {
        data["link_id"]: (u, v) for u, v, data in graph.edges(data=True)
    }


def find_endpoint(graph: nx.Graph, node_type: str) -> str:
    """Return the deterministically-first node id of a given type.

    Raises ValueError when no node of that type exists.
    """
    candidates = sorted(
        node_id for node_id, data in graph.nodes(data=True)
        if data.get("type") == node_type
    )
    if not candidates:
        raise ValueError(f"No node of type {node_type!r} in topology")
    return candidates[0]


def find_endpoints(graph: nx.Graph) -> tuple[str, str]:
    """Return (source, target) for routing: first mobile endpoint to internet.

    Prefers ship/vehicle/aircraft/train nodes as source; falls back to the
    first non-infrastructure node. Target is the first internet node.
    """
    mobile_types = ("ship", "car", "vehicle", "aircraft", "train", "drone", "boat")
    for node_type in mobile_types:
        candidates = sorted(
            node_id for node_id, data in graph.nodes(data=True)
            if data.get("type") == node_type
        )
        if candidates:
            return candidates[0], find_endpoint(graph, "internet")
    # Fallback: first node that is not infrastructure/internet.
    infra = {"internet", "satellite", "gateway", "base_station", "tower", "router", "switch"}
    candidates = sorted(
        node_id for node_id, data in graph.nodes(data=True)
        if data.get("type") not in infra
    )
    if candidates:
        return candidates[0], find_endpoint(graph, "internet")
    nodes = sorted(graph.nodes())
    if len(nodes) >= 2:
        return nodes[0], find_endpoint(graph, "internet")
    raise ValueError("Topology has too few nodes to route")
