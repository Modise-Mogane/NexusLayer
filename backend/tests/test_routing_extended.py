"""Tests for extended routing: cost, balanced, hysteresis, compatibility."""

import pytest

from app import compatibility, graph as graph_engine
from app import routing
from app.topology import load_topology


@pytest.fixture()
def scenario_graph():
    return graph_engine.build_graph(load_topology())


def _routes(graph, failed=()):
    return routing.find_paths(graph, "ship-1", "internet-1", frozenset(failed), frozenset())


def test_cost_metric_defaults_to_zero_on_legacy_scenario(scenario_graph):
    routes = _routes(scenario_graph)
    assert routes
    assert all(r.cost_per_gb == pytest.approx(0.0) for r in routes)


def test_lowest_cost_policy_selects_deterministically(scenario_graph):
    routes = _routes(scenario_graph)
    best = routing.select_route(routes, "lowest_cost")
    assert best is not None
    # All zero cost -> tie-break prefers fewer hops (terrestrial, 3 nodes).
    assert best.node_ids == ("ship-1", "base-station-1", "internet-1")


def test_balanced_policy_scores_and_selects(scenario_graph):
    routes = _routes(scenario_graph)
    scored = routing.score_balanced(routes)
    assert all(r.score is not None for r in scored)
    assert all(0.0 <= r.score <= 1.0 for r in scored)
    best = routing.select_route(routes, "balanced")
    assert best is not None
    assert best.score is not None


def test_balanced_weights_change_ranking():
    a = routing.Route(("a", "b"), ("l1",), latency_ms=10, bandwidth_mbps=10, reliability=0.9, cost_per_gb=10)
    b = routing.Route(("a", "c", "b"), ("l2", "l3"), latency_ms=100, bandwidth_mbps=100, reliability=0.99, cost_per_gb=1)
    latency_pick = routing.select_route([a, b], "balanced", {"latency": 1, "bandwidth": 0, "reliability": 0, "cost": 0})
    assert latency_pick is not None and latency_pick.link_ids == ("l1",)
    cost_pick = routing.select_route([a, b], "balanced", {"latency": 0, "bandwidth": 0, "reliability": 0, "cost": 1})
    assert cost_pick is not None and cost_pick.link_ids == ("l2", "l3")


def test_hysteresis_blocks_marginal_switch_and_allows_clear_win():
    current = routing.Route(("a", "b"), ("l1",), latency_ms=100, bandwidth_mbps=50, reliability=0.9)
    marginal = routing.Route(("a", "c"), ("l2",), latency_ms=95, bandwidth_mbps=50, reliability=0.9)
    allowed, reason = routing.should_switch(current, marginal, "lowest_latency", hysteresis=0.10)
    assert allowed is False
    assert "hysteresis" in reason
    clear = routing.Route(("a", "d"), ("l3",), latency_ms=50, bandwidth_mbps=50, reliability=0.9)
    allowed, _ = routing.should_switch(current, clear, "lowest_latency", hysteresis=0.10)
    assert allowed is True


def test_dwell_time_blocks_voluntary_switch():
    current = routing.Route(("a", "b"), ("l1",), latency_ms=100, bandwidth_mbps=50, reliability=0.9)
    better = routing.Route(("a", "d"), ("l3",), latency_ms=50, bandwidth_mbps=50, reliability=0.9)
    allowed, reason = routing.should_switch(current, better, "lowest_latency", dwell_ticks=0, min_dwell_ticks=3)
    assert allowed is False
    assert "dwell" in reason


def test_compatibility_allows_unrestricted_legacy_links():
    result = compatibility.check_link_compatible("Cellular (LTE)", [], [])
    assert result.compatible


def test_compatibility_rejects_unsupported_technology():
    result = compatibility.check_link_compatible("Cellular (LTE)", ["Ethernet"], ["Cellular (LTE)"])
    assert not result.compatible
    assert "source" in result.reason


def test_compatibility_flags_chained_radio_without_gateway():
    result = compatibility.check_path_gateways(
        ["a", "b", "c", "d"],
        ["Cellular (LTE)", "VSAT (GEO)", "Fiber"],
        {"a": "ship", "b": "switch", "c": "switch", "d": "internet"},
    )
    assert not result.compatible
    assert "gateway" in result.reason.lower()


def test_compatibility_allows_multihomed_endpoint():
    result = compatibility.check_path_gateways(
        ["ship-1", "satellite-1", "sat-gateway-1", "internet-1"],
        ["VSAT (GEO)", "Ka-band feeder", "Fiber"],
        {"ship-1": "ship", "satellite-1": "satellite", "sat-gateway-1": "gateway", "internet-1": "internet"},
    )
    assert result.compatible
