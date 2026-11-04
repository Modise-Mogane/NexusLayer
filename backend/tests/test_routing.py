"""Unit tests for deterministic routing: policies, metrics, tie-breaks."""

import pytest

from app import graph as graph_engine
from app import routing
from app.topology import load_topology


@pytest.fixture()
def scenario_graph():
    return graph_engine.build_graph(load_topology())


def _routes(graph, failed=()) -> list[routing.Route]:
    return routing.find_paths(
        graph, "ship-1", "internet-1", frozenset(failed), frozenset()
    )


def test_path_metrics_match_scenario_values(scenario_graph) -> None:
    routes = _routes(scenario_graph)
    terrestrial = next(
        r for r in routes if r.node_ids == ("ship-1", "base-station-1", "internet-1")
    )
    assert terrestrial.latency_ms == pytest.approx(45.0)
    assert terrestrial.bandwidth_mbps == pytest.approx(50.0)
    assert terrestrial.reliability == pytest.approx(0.92 * 0.995)


def test_failed_links_are_excluded(scenario_graph) -> None:
    routes = _routes(scenario_graph, failed=("link-ship-cellular",))
    assert routes
    assert all("link-ship-cellular" not in r.link_ids for r in routes)


def test_no_viable_route_returns_empty(scenario_graph) -> None:
    routes = _routes(
        scenario_graph, failed=("link-ship-cellular", "link-ship-sat")
    )
    assert routes == []
    assert routing.select_route(routes) is None


def test_lowest_latency_prefers_terrestrial(scenario_graph) -> None:
    best = routing.select_route(_routes(scenario_graph), "lowest_latency")
    assert best is not None
    assert best.node_ids == ("ship-1", "base-station-1", "internet-1")


def test_highest_reliability_prefers_satellite(scenario_graph) -> None:
    best = routing.select_route(_routes(scenario_graph), "highest_reliability")
    assert best is not None
    assert best.node_ids == (
        "ship-1",
        "satellite-1",
        "sat-gateway-1",
        "internet-1",
    )


def test_unknown_policy_rejected(scenario_graph) -> None:
    with pytest.raises(ValueError, match="Unknown routing policy"):
        routing.select_route(_routes(scenario_graph), "shortest_hops")


def test_routing_is_deterministic(scenario_graph) -> None:
    first = _routes(scenario_graph)
    second = _routes(scenario_graph)
    assert first == second
    assert routing.select_route(first) == routing.select_route(second)
