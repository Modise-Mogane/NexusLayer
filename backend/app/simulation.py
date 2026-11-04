"""Simulation sessions: state machine, mobility, failover, event log.

Each session owns one NetworkX graph built from a scenario topology, the
set of failed/unsuitable links, and a chronological event log. Routing is
a deterministic function of the eligible set (see routing.py): after every
failure, restoration, or movement step the session recomputes each
endpoint's active route, applies the anti-flapping gate for voluntary
changes, and records failover/failback/handover events. Connectivity loss
is reported honestly when no viable route remains.

Session status ("idle"/"running"/"paused") tracks run control. Movement
advances via step(): positions integrate under the simplified kinematic
model (mobility.py), followers copy their leader's position, wireless
suitability is reevaluated, and routes update automatically without
manual fail-link actions.

Multi-endpoint: every node whose type is in ENDPOINT_TYPES gets its own
independently routed path to the internet node. The legacy single-route
fields (active_route/connectivity/decision) mirror the primary endpoint
so older clients and the maritime regression scenario behave exactly as
before; endpoint_routes carries the full per-endpoint view.
"""

from datetime import datetime, timezone

import networkx as nx

from . import graph as graph_engine
from . import mobility, rf, routing, traffic
from .compatibility import check_link_compatible, check_path_gateways, check_port_pair
from .models import (
    EndpointRoute,
    LinkState,
    MobilitySpec,
    NodeState,
    RouteDecision,
    RouteInfo,
    SimulationEvent,
    SimulationState,
)
from .topology import load_topology

STATUS_IDLE = "idle"
STATUS_RUNNING = "running"
STATUS_PAUSED = "paused"

CONNECTIVITY_CONNECTED = "connected"
CONNECTIVITY_DEGRADED = "degraded"
CONNECTIVITY_DISCONNECTED = "disconnected"

# Node types treated as routed endpoints (each gets a path to internet).
ENDPOINT_TYPES = {
    "ship", "boat", "car", "vehicle", "aircraft", "train", "drone",
    "phone", "smartphone", "laptop", "tablet", "computer", "sensor",
    "iot", "camera", "person",
}
INFRA_TYPES = {
    "internet", "satellite", "gateway", "base_station", "tower", "router",
    "switch", "access_point", "server", "core", "ground_station",
}


class UnknownLinkError(KeyError):
    """Raised when an action references a link id absent from the scenario."""


class UnknownNodeError(KeyError):
    """Raised when an action references a node id absent from the scenario."""


class SimulationSession:
    def __init__(
        self,
        routing_policy: str = routing.POLICY_LOWEST_LATENCY,
        topology=None,
        scenario_id: str = "maritime_failover",
        weights: dict[str, float] | None = None,
        hysteresis: float = 0.10,
        min_dwell_ticks: int = 2,
    ) -> None:
        if routing_policy not in routing.POLICIES:
            raise ValueError(f"Unknown routing policy: {routing_policy!r}")
        self._topology = topology if topology is not None else load_topology()
        self._scenario_id = scenario_id
        self._graph: nx.Graph = graph_engine.build_graph(self._topology)
        self._link_ids = {link.id for link in self._topology.links}
        self._links_by_id = {link.id: link for link in self._topology.links}
        self._labels = {node.id: node.label for node in self._topology.nodes}
        self._node_types = {node.id: node.type for node in self._topology.nodes}
        self._node_by_id = {node.id: node for node in self._topology.nodes}
        try:
            self._source_id, self._internet_id = graph_engine.find_endpoints(self._graph)
        except ValueError:
            self._source_id = graph_engine.find_endpoint(self._graph, "ship")
            self._internet_id = graph_engine.find_endpoint(self._graph, "internet")
        self._endpoints = self._detect_endpoints()
        self._routing_policy = routing_policy
        self._weights = dict(weights) if weights else dict(routing.DEFAULT_BALANCED_WEIGHTS)
        self._hysteresis = hysteresis
        self._min_dwell_ticks = min_dwell_ticks
        self._positions: dict[str, dict] = {}
        self._initial_mobility: dict[str, dict | None] = {}
        for node in self._topology.nodes:
            if node.world_position is not None:
                self._positions[node.id] = node.world_position.model_dump()
            self._initial_mobility[node.id] = (
                node.mobility.model_dump() if node.mobility is not None else None
            )
        self._status = STATUS_IDLE
        self._tick = 0
        self._sim_time_s = 0.0
        self._failed_links: set[str] = set()
        self._failed_nodes: set[str] = set()
        self._unsuitable_links: set[str] = set()
        self._suitability: dict[str, dict] = {}
        self._events: list[SimulationEvent] = []
        self._messages: list[dict] = []
        self._route_history: list[dict] = []
        self._handover_history: list[dict] = []
        # Per-endpoint routing state (legacy aliases mirror the primary).
        self._active_link_ids: dict[str, tuple[str, ...] | None] = {}
        self._dwell_ticks: dict[str, int] = {}
        self._initial_route_link_ids: dict[str, tuple[str, ...] | None] = {}
        self._latency_series: list[dict] = []
        self._evaluate_suitability(initial=True)
        for ep in self._endpoints:
            initial = self._compute_active_route(ep)
            self._initial_route_link_ids[ep] = tuple(initial.link_ids) if initial else None
            self._active_link_ids[ep] = tuple(initial.link_ids) if initial else None
            self._dwell_ticks[ep] = 0
            if initial is not None:
                self._route_history.append(self._history_entry(ep, initial, "initial"))
        self._record("initialized", "Simulation session initialized from scenario")

    # -- run control ----------------------------------------------------

    def start(self) -> None:
        """Transition idle/paused -> running. Idempotent when running."""
        if self._status == STATUS_RUNNING:
            return
        self._status = STATUS_RUNNING
        self._tick += 1
        self._record("started", "Simulation started")

    def pause(self) -> None:
        """Transition running -> paused. No-op unless running."""
        if self._status != STATUS_RUNNING:
            return
        self._status = STATUS_PAUSED
        self._tick += 1
        self._record("paused", "Simulation paused")

    def reset(self) -> None:
        """Restore links/nodes and recompute the initial route(s)."""
        self._failed_links = set()
        self._failed_nodes = set()
        self._unsuitable_links = set()
        self._events = []
        self._messages = []
        self._route_history = []
        self._handover_history = []
        self._latency_series = []
        self._tick = 0
        self._sim_time_s = 0.0
        self._status = STATUS_IDLE
        self._positions = {}
        for node in self._topology.nodes:
            if node.world_position is not None:
                self._positions[node.id] = node.world_position.model_dump()
            initial_mob = self._initial_mobility.get(node.id)
            node.mobility = (
                MobilitySpec.model_validate(dict(initial_mob)) if initial_mob else None
            )
        for u, v, data in self._graph.edges(data=True):
            data["status"] = graph_engine.STATUS_UP
        self._evaluate_suitability(initial=True)
        for ep in self._endpoints:
            initial = self._compute_active_route(ep)
            self._initial_route_link_ids[ep] = tuple(initial.link_ids) if initial else None
            self._active_link_ids[ep] = tuple(initial.link_ids) if initial else None
            self._dwell_ticks[ep] = 0
            if initial is not None:
                self._route_history.append(self._history_entry(ep, initial, "initial"))
        self._record("reset", "Simulation reset to initial healthy state")

    def set_course(self, node_id: str, velocity_x_kmh: float, velocity_y_kmh: float) -> None:
        """Set a node's velocity vector (operator override).

        Clears any waypoint loop so the manual course takes effect; reset
        restores the scenario's programmed routes.
        """
        found = next((n for n in self._topology.nodes if n.id == node_id), None)
        if found is None:
            raise UnknownNodeError(f"Unknown node id: {node_id!r}")
        if found.mobility is None:
            raise ValueError(f"Node {node_id!r} has no mobility spec")
        found.mobility.velocity_x_kmh = velocity_x_kmh
        found.mobility.velocity_y_kmh = velocity_y_kmh
        found.mobility.waypoints_km = []
        found.mobility.speed_kmh = 0.0
        self._tick += 1
        self._record(
            "course_changed",
            f"Node {node_id} course set to ({velocity_x_kmh}, {velocity_y_kmh}) km/h",
        )

    def update_link_params(self, link_id: str, updates: dict) -> None:
        """Update mutable link parameters and reevaluate routes."""
        self._require_link(link_id)
        link = self._links_by_id[link_id]
        before = {ep: self._current_route(ep) for ep in self._endpoints}
        allowed = {
            "latency_ms", "bandwidth_mbps", "reliability", "cost_per_gb",
            "max_range_km", "tx_power_dbm", "rx_sensitivity_dbm",
        }
        changed: dict[str, tuple] = {}
        for key, value in updates.items():
            if key in allowed and hasattr(link, key):
                old = getattr(link, key)
                try:
                    setattr(link, key, value)
                except Exception as exc:
                    raise ValueError(f"Invalid value for {key}: {value!r}") from exc
                changed[key] = (old, value)
        if "rf" in updates:
            rf_update = updates["rf"]
            if rf_update is None:
                if link.rf is not None:
                    link.rf = None
                    changed["rf"] = ("link_budget", None)
            elif isinstance(rf_update, dict):
                from .models import RfConfig

                if link.rf is None:
                    try:
                        link.rf = RfConfig(**rf_update)
                    except Exception as exc:
                        raise ValueError(f"Invalid rf config: {rf_update!r}") from exc
                    changed["rf"] = (None, "link_budget")
                else:
                    for key, value in rf_update.items():
                        if hasattr(link.rf, key):
                            old = getattr(link.rf, key)
                            try:
                                setattr(link.rf, key, value)
                            except Exception as exc:
                                raise ValueError(
                                    f"Invalid rf value for {key}: {value!r}"
                                ) from exc
                            changed[f"rf.{key}"] = (old, value)
        if not changed:
            raise ValueError("No recognized link parameters in update")
        self._tick += 1
        self._evaluate_suitability()
        for ep in self._endpoints:
            self._recompute_route(ep, trigger="params_updated", before=before[ep])
        self._record(
            "params_updated",
            f"Link {link_id} parameters updated: "
            + ", ".join(f"{k} {old!r}->{new!r}" for k, (old, new) in changed.items()),
        )

    def set_node_position(
        self,
        node_id: str,
        x_km: float | None = None,
        y_km: float | None = None,
        altitude_m: float | None = None,
    ) -> None:
        if node_id not in self._node_by_id:
            raise UnknownNodeError(f"Unknown node id: {node_id!r}")
        pos = self._positions.get(node_id)
        if pos is None:
            raise ValueError(f"Node {node_id!r} has no world position")
        before = {ep: self._current_route(ep) for ep in self._endpoints}
        if x_km is not None:
            pos["x_km"] = x_km
        if y_km is not None:
            pos["y_km"] = y_km
        if altitude_m is not None:
            pos["altitude_m"] = altitude_m
        self._tick += 1
        self._evaluate_suitability()
        for ep in self._endpoints:
            self._recompute_route(ep, trigger="node_moved", before=before[ep])
        self._record("node_moved", f"Node {node_id} repositioned by operator")

    def set_endpoint_traffic(self, node_id: str, profile: str) -> None:
        """Assign an application traffic profile to an endpoint node."""
        if node_id not in self._node_by_id:
            raise UnknownNodeError(f"Unknown node id: {node_id!r}")
        if profile not in traffic.TRAFFIC_PROFILES:
            raise ValueError(
                f"Unknown traffic profile: {profile!r} "
                f"(choices: {sorted(traffic.TRAFFIC_PROFILES)})"
            )
        self._node_by_id[node_id].properties["traffic"] = profile
        self._tick += 1
        self._record("traffic_set", f"Node {node_id} traffic profile set to {profile}")

    def set_policy(self, policy: str, weights: dict[str, float] | None = None) -> None:
        if policy not in routing.POLICIES:
            raise ValueError(f"Unknown routing policy: {policy!r}")
        before = {ep: self._current_route(ep) for ep in self._endpoints}
        self._routing_policy = policy
        if weights:
            self._weights.update(weights)
        self._tick += 1
        for ep in self._endpoints:
            self._recompute_route(ep, trigger="policy_changed", before=before[ep])
        self._record("policy_changed", f"Routing policy set to {policy}")

    def fail_link(self, link_id: str) -> None:
        self._require_link(link_id)
        if link_id in self._failed_links:
            return
        before = {ep: self._current_route(ep) for ep in self._endpoints}
        self._failed_links.add(link_id)
        self._set_edge_status(link_id, graph_engine.STATUS_DOWN)
        self._tick += 1
        for ep in self._endpoints:
            self._recompute_route(ep, trigger="link_failed", before=before[ep])
        tech = self._link_technology(link_id)
        self._record("link_failed", f"Link {link_id} ({tech}) failed by operator action")

    def restore_link(self, link_id: str) -> None:
        self._require_link(link_id)
        if link_id not in self._failed_links:
            return
        before = {ep: self._current_route(ep) for ep in self._endpoints}
        self._failed_links.discard(link_id)
        self._set_edge_status(link_id, graph_engine.STATUS_UP)
        self._tick += 1
        for ep in self._endpoints:
            self._recompute_route(ep, trigger="link_restored", before=before[ep])
        tech = self._link_technology(link_id)
        self._record("link_restored", f"Link {link_id} ({tech}) restored by operator action")

    def step(self, ticks: int = 1, dt_seconds: float = 60.0) -> None:
        """Advance mobility, reevaluate suitability, and update routes."""
        for _ in range(ticks):
            self._tick += 1
            self._sim_time_s += dt_seconds
            for ep in self._endpoints:
                self._dwell_ticks[ep] += 1
            moved: list[str] = []
            for node in self._topology.nodes:
                if node.mobility is None or node.id not in self._positions:
                    continue
                if node.mobility.follow:
                    continue  # followers copy their leader below
                old = dict(self._positions[node.id])
                new = mobility.advance_position(
                    self._positions[node.id], node.mobility.model_dump(), dt_seconds
                )
                self._positions[node.id] = new
                if abs(new["x_km"] - old["x_km"]) > 1e-9 or abs(new["y_km"] - old["y_km"]) > 1e-9:
                    moved.append(node.id)
                # Waypoint loops: on reaching the head waypoint, rotate it to
                # the back so patrols (ship/car/aircraft) cycle deterministically.
                wps = node.mobility.waypoints_km
                if wps and node.mobility.speed_kmh > 0:
                    tx, ty = float(wps[0][0]), float(wps[0][1])
                    if abs(new["x_km"] - tx) < 1e-9 and abs(new["y_km"] - ty) < 1e-9:
                        node.mobility.waypoints_km = wps[1:] + wps[:1]
            # Followers ride with their leader (two passes allow short chains).
            for _pass in range(2):
                for node in self._topology.nodes:
                    if node.mobility is None or not node.mobility.follow:
                        continue
                    leader = self._positions.get(node.mobility.follow)
                    if leader is None or node.id not in self._positions:
                        continue
                    old = self._positions[node.id]
                    if (old["x_km"], old["y_km"]) != (leader["x_km"], leader["y_km"]):
                        self._positions[node.id] = dict(leader)
                        if node.id not in moved:
                            moved.append(node.id)
            before = {ep: self._current_route(ep) for ep in self._endpoints}
            # NOTE: before-state captured prior to suitability reevaluation so
            # mobility-driven switches record failover/handover transitions.
            changed = self._evaluate_suitability()
            for link_id, became_suitable in changed:
                link = self._links_by_id[link_id]
                detail = self._suitability.get(link_id, {})
                if became_suitable:
                    self._record(
                        "suitability_changed",
                        f"Link {link_id} ({link.technology}) suitable again: {detail.get('reason', '')}",
                    )
                else:
                    self._record(
                        "suitability_changed",
                        f"Link {link_id} ({link.technology}) unsuitable: {detail.get('reason', '')}",
                    )
            for ep in self._endpoints:
                self._recompute_route(ep, trigger="mobility_step", before=before[ep])
            active = self._current_route(self._source_id)
            self._latency_series.append({
                "tick": self._tick,
                "sim_time_s": self._sim_time_s,
                "latency_ms": active.latency_ms if active else None,
                "bandwidth_mbps": active.bandwidth_mbps if active else None,
            })

    # -- state views -----------------------------------------------------

    def get_state(self) -> SimulationState:
        primary = self._source_id
        routes = self._eligible_routes(primary)
        active = self._current_route(primary)
        backups = [r for r in routes if not (active is not None and r == active)]

        active_info = self._route_info(active) if active is not None else None
        backup_infos = [self._route_info(r) for r in backups]

        # Union of active/backup usage across all endpoints drives link/node
        # highlighting; legacy single-endpoint output is unchanged.
        ep_routes: dict[str, routing.Route | None] = {
            ep: self._current_route(ep) for ep in self._endpoints
        }
        ep_backups: dict[str, list[routing.Route]] = {}
        for ep in self._endpoints:
            er = self._eligible_routes(ep)
            cur = ep_routes[ep]
            ep_backups[ep] = [r for r in er if not (cur is not None and r == cur)]
        active_link_ids = {lid for r in ep_routes.values() if r for lid in r.link_ids}
        backup_link_ids = {lid for rs in ep_backups.values() for r in rs for lid in r.link_ids}
        active_node_ids = {nid for r in ep_routes.values() if r for nid in r.node_ids}

        reachable = self._reachable_from_endpoints()
        link_bandwidth = {lid: link.bandwidth_mbps for lid, link in self._links_by_id.items()}
        sharers: dict[str, int] = {}
        for r in ep_routes.values():
            if not r:
                continue
            for lid in r.link_ids:
                sharers[lid] = sharers.get(lid, 0) + 1

        if active is None:
            connectivity = CONNECTIVITY_DISCONNECTED
        elif (
            self._initial_route_link_ids.get(primary) is not None
            and tuple(active.link_ids) == self._initial_route_link_ids[primary]
        ):
            connectivity = CONNECTIVITY_CONNECTED
        else:
            connectivity = CONNECTIVITY_DEGRADED

        links = []
        for link in sorted(self._topology.links, key=lambda l: l.id):
            detail = self._suitability.get(link.id, {})
            coverage = None
            if link.rf is not None and link.rf.model == "link_budget":
                try:
                    params = rf.params_from_dict(link.rf.model_dump(), link.technology)
                    coverage = rf.effective_range_km(params) if params else None
                except (ValueError, TypeError):
                    coverage = None
            elif link.max_range_km:
                coverage = link.max_range_km
            links.append(
                LinkState(
                    id=link.id,
                    status=(
                        graph_engine.STATUS_DOWN
                        if link.id in self._failed_links
                        else graph_engine.STATUS_UP
                    ),
                    on_active_route=link.id in active_link_ids,
                    on_backup_route=link.id in backup_link_ids,
                    suitable=link.id not in self._unsuitable_links,
                    suitability_reason=str(detail.get("reason", "")),
                    signal_quality=detail.get("quality"),
                    distance_km=detail.get("distance_km"),
                    rx_dbm=detail.get("rx_dbm"),
                    margin_db=detail.get("margin_db"),
                    suitability_model=str(detail.get("model", "range_threshold")),
                    coverage_radius_km=coverage,
                )
            )
        nodes = [
            NodeState(
                id=node.id,
                status=(
                    graph_engine.STATUS_DOWN
                    if node.id in self._failed_nodes
                    else graph_engine.STATUS_UP
                ),
                on_active_route=node.id in active_node_ids,
                reachable=node.id in reachable,
                interfaces=list(self._graph.nodes[node.id]["interfaces"]),
                world_position=self._positions.get(node.id),
                traffic=str(node.properties.get("traffic", traffic.DEFAULT_PROFILE)),
            )
            for node in sorted(self._topology.nodes, key=lambda n: n.id)
        ]

        endpoint_routes = []
        for ep in self._endpoints:
            route = ep_routes[ep]
            profile = traffic.profile_for(self._node_by_id[ep].properties)
            if route is None:
                achieved = None
            else:
                achieved = traffic.fair_share_achieved(
                    list(route.link_ids), link_bandwidth, sharers
                )
            suitable, notes = traffic.check_suitability(
                profile, route.latency_ms if route else None, achieved
            )
            endpoint_routes.append(
                EndpointRoute(
                    endpoint_id=ep,
                    endpoint_label=self._labels.get(ep, ep),
                    route=self._route_info(route) if route else None,
                    connectivity=self._endpoint_connectivity(ep, route),
                    achieved_mbps=round(achieved, 3) if achieved is not None else None,
                    traffic=profile.id,
                    traffic_suitable=suitable,
                    traffic_notes=notes,
                )
            )

        decision = RouteDecision(
            policy=self._routing_policy,
            selected_link_ids=list(active.link_ids) if active else [],
            explanation=routing.explain_selection(routes, active, self._routing_policy, self._weights),
            candidates_considered=len(routes),
            candidates_eligible=len(routes),
            weights=dict(self._weights),
        )

        return SimulationState(
            status=self._status,
            tick=self._tick,
            sim_time_s=self._sim_time_s,
            routing_policy=self._routing_policy,
            connectivity=connectivity,
            active_route=active_info,
            backup_routes=backup_infos,
            endpoint_routes=endpoint_routes,
            links=links,
            nodes=nodes,
            decision=decision,
            scenario_id=self._scenario_id,
        )

    def get_events(self) -> list[SimulationEvent]:
        return list(sorted(self._events, key=lambda e: e.seq))

    def get_analysis(self) -> dict:
        handovers = list(self._handover_history)
        connected_ticks = sum(1 for h in self._route_history if h.get("connectivity") != "disconnected")
        total = max(len(self._route_history), 1)
        disconnections: list[dict] = []
        for entry in self._route_history:
            if entry.get("connectivity") == "disconnected":
                disconnections.append(entry)
        per_endpoint: dict[str, dict] = {}
        for ep in self._endpoints:
            entries = [h for h in self._route_history if h.get("endpoint_id") == ep]
            conn = sum(1 for h in entries if h.get("connectivity") != "disconnected")
            hand = [h for h in self._handover_history if h.get("endpoint_id") == ep]
            per_endpoint[ep] = {
                "label": self._labels.get(ep, ep),
                "availability": round(conn / len(entries), 4) if entries else 1.0,
                "handovers": len(hand),
                "route_changes": len(entries),
            }
        return {
            "scenario_id": self._scenario_id,
            "policy": self._routing_policy,
            "tick": self._tick,
            "sim_time_s": self._sim_time_s,
            "endpoints": list(self._endpoints),
            "route_history": list(self._route_history),
            "handover_history": handovers,
            "latency_series": list(self._latency_series),
            "availability": round(connected_ticks / total, 4) if self._route_history else 1.0,
            "per_endpoint": per_endpoint,
            "disconnection_periods": disconnections,
            "event_counts": self._event_counts(),
            "assumptions": [
                "Synthetic scenario values; not measured performance.",
                "Reliability multiplies link scores (independence assumption).",
                "Wireless suitability uses RF link budget or range threshold + hysteresis.",
                "Satellite wide-beam abstraction: available unless explicitly failed.",
                "GNSS positioning is separate from internet data connectivity.",
                "Shared links split bandwidth equally across endpoint routes (fair-share).",
                "Cost/latency/bandwidth figures are illustrative planning estimates.",
            ],
        }

    # -- internals ---------------------------------------------------------

    def _detect_endpoints(self) -> list[str]:
        """Primary endpoint first (legacy order), then remaining endpoints sorted."""
        others = sorted(
            nid for nid, ntype in self._node_types.items()
            if nid != self._source_id
            and (ntype in ENDPOINT_TYPES or ntype not in INFRA_TYPES and self._looks_like_client(nid))
        )
        return [self._source_id] + others

    def _looks_like_client(self, node_id: str) -> bool:
        """Unknown node types count as endpoints when they are singly-homed."""
        return self._graph.degree(node_id) <= 1

    def _endpoint_prefix(self, endpoint_id: str) -> str:
        if len(self._endpoints) <= 1:
            return ""
        return f"[{self._labels.get(endpoint_id, endpoint_id)}] "

    def _endpoint_connectivity(self, endpoint_id: str, route: routing.Route | None) -> str:
        if route is None:
            return CONNECTIVITY_DISCONNECTED
        if (
            self._initial_route_link_ids.get(endpoint_id) is not None
            and tuple(route.link_ids) == self._initial_route_link_ids[endpoint_id]
        ):
            return CONNECTIVITY_CONNECTED
        return CONNECTIVITY_DEGRADED

    def _record(self, event_type: str, message: str) -> None:
        self._events.append(
            SimulationEvent(
                seq=len(self._events) + 1,
                timestamp=datetime.now(timezone.utc).isoformat(),
                sim_time_s=self._sim_time_s,
                tick=self._tick,
                type=event_type,
                message=message,
            )
        )

    def _event_counts(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        for e in self._events:
            counts[e.type] = counts.get(e.type, 0) + 1
        return counts

    def _require_link(self, link_id: str) -> None:
        if link_id not in self._link_ids:
            raise UnknownLinkError(f"Unknown link id: {link_id!r}")

    def _link_technology(self, link_id: str) -> str:
        link = self._links_by_id.get(link_id)
        return link.technology if link else "unknown"

    def _set_edge_status(self, link_id: str, status: str) -> None:
        for u, v, data in self._graph.edges(data=True):
            if data["link_id"] == link_id:
                data["status"] = status
                return

    def _eligible_routes(self, endpoint_id: str) -> list[routing.Route]:
        routes = routing.find_paths(
            self._graph, endpoint_id, self._internet_id,
            frozenset(self._failed_links), frozenset(self._failed_nodes),
            frozenset(self._unsuitable_links),
        )
        # Reject technically infeasible options before ranking.
        eligible: list[routing.Route] = []
        for route in routes:
            ok, _ = self._route_feasible(route)
            if ok:
                eligible.append(route)
        if self._routing_policy == routing.POLICY_BALANCED:
            return routing.score_balanced(eligible, self._weights)
        return eligible

    def _route_feasible(self, route: routing.Route,
                        extra_allowed: frozenset[str] = frozenset()) -> tuple[bool, str]:
        link_by_id = self._links_by_id
        techs: list[str] = []
        port_maps = {
            node.id: {port.name: port.model_dump() for port in node.ports}
            for node in self._topology.nodes
        }
        for lid in route.link_ids:
            link = link_by_id[lid]
            techs.append(link.technology)
            src = self._graph.nodes[link.source]
            dst = self._graph.nodes[link.target]
            result = check_link_compatible(
                link.technology,
                list(src.get("supported_technologies") or []),
                list(dst.get("supported_technologies") or []),
            )
            if not result.compatible:
                return False, result.reason
            if link.source_port or link.target_port:
                sport = port_maps.get(link.source, {}).get(link.source_port or "")
                tport = port_maps.get(link.target, {}).get(link.target_port or "")
                if link.source_port and sport is None:
                    return False, f"link {lid} names unknown source port {link.source_port!r}"
                if link.target_port and tport is None:
                    return False, f"link {lid} names unknown target port {link.target_port!r}"
                port_check = check_port_pair(sport, tport, link.experimental)
                if not port_check.compatible:
                    return False, f"link {lid}: {port_check.reason}"
            # Endpoints must not route through unrelated endpoints: a phone on
            # the ship must traverse the ship's gateway stack, never a car.
            for side in (link.source, link.target):
                if (
                    side in self._node_types
                    and side != route.node_ids[0]
                    and side not in extra_allowed
                    and self._node_types[side] in ENDPOINT_TYPES
                    and side in route.node_ids
                ):
                    return False, f"route transits unrelated endpoint {side}"
        gateway_check = check_path_gateways(
            list(route.node_ids), techs, self._node_types
        )
        if not gateway_check.compatible:
            return False, gateway_check.reason
        return True, "eligible"

    def _compute_active_route(self, endpoint_id: str) -> routing.Route | None:
        return routing.select_route(
            self._eligible_routes(endpoint_id), self._routing_policy, self._weights
        )

    def eligible_device_routes(self, source_id: str, dest_id: str) -> list[routing.Route]:
        """Feasible device-to-device routes (messaging may terminate at an endpoint)."""
        if source_id not in self._node_by_id:
            raise UnknownNodeError(f"Unknown node {source_id!r}")
        if dest_id not in self._node_by_id:
            raise UnknownNodeError(f"Unknown node {dest_id!r}")
        routes = routing.find_paths(
            self._graph, source_id, dest_id,
            frozenset(self._failed_links), frozenset(self._failed_nodes),
            frozenset(self._unsuitable_links),
        )
        allowed = frozenset({dest_id})
        return [r for r in routes if self._route_feasible(r, allowed)[0]]

    def resolve_device_route(self, source_id: str, dest_id: str) -> routing.Route | None:
        """Best device-to-device route under the session's current policy."""
        return routing.select_route(
            self.eligible_device_routes(source_id, dest_id),
            self._routing_policy, self._weights,
        )

    def log_message(self, summary: str) -> None:
        """Record a messaging event on the session timeline."""
        self._record("message", summary)

    def store_message(self, record: dict) -> None:
        """Keep the last 50 message records for this session."""
        self._messages.append(record)
        del self._messages[:-50]

    def get_messages(self) -> list[dict]:
        return list(self._messages)

    def _current_route(self, endpoint_id: str) -> routing.Route | None:
        routes = self._eligible_routes(endpoint_id)
        active_ids = self._active_link_ids.get(endpoint_id)
        if active_ids is None:
            return routing.select_route(routes, self._routing_policy, self._weights)
        for route in routes:
            if tuple(route.link_ids) == active_ids:
                return route
        return routing.select_route(routes, self._routing_policy, self._weights)

    def _recompute_route(
        self, endpoint_id: str, trigger: str, before: routing.Route | None = None
    ) -> None:
        if before is None:
            before = self._current_route(endpoint_id)
        routes = self._eligible_routes(endpoint_id)
        candidate = routing.select_route(routes, self._routing_policy, self._weights)
        before_ids = tuple(before.link_ids) if before else None
        prefix = self._endpoint_prefix(endpoint_id)
        # Forced transitions: current infeasible or missing.
        current_still_valid = before is not None and any(
            tuple(r.link_ids) == before_ids for r in routes
        )
        if candidate is None:
            self._active_link_ids[endpoint_id] = None
            self._route_history.append({
                "tick": self._tick, "sim_time_s": self._sim_time_s,
                "endpoint_id": endpoint_id,
                "connectivity": "disconnected", "trigger": trigger,
                "node_ids": [], "link_ids": [],
                "latency_ms": None, "bandwidth_mbps": None,
            })
            if before is not None:
                self._record(
                    "connectivity_lost",
                    f"{prefix}No viable route between {self._labels[endpoint_id]} and "
                    f"{self._labels[self._internet_id]}",
                )
            return
        if not current_still_valid:
            self._active_link_ids[endpoint_id] = tuple(candidate.link_ids)
            self._dwell_ticks[endpoint_id] = 0
            self._route_history.append(self._history_entry(endpoint_id, candidate, trigger))
            if before is None:
                self._record(
                    "connectivity_restored",
                    f"{prefix}Connectivity restored via {' -> '.join(candidate.node_ids)}",
                )
            else:
                self._record(
                    "failover",
                    f"{prefix}Failover ({trigger}): active route switched to "
                    f"{' -> '.join(candidate.node_ids)}",
                )
                self._handover_history.append({
                    "tick": self._tick, "sim_time_s": self._sim_time_s,
                    "endpoint_id": endpoint_id,
                    "from_link_ids": list(before.link_ids), "to_link_ids": list(candidate.link_ids),
                    "reason": f"previous route infeasible ({trigger}); forced switch",
                })
            return
        assert before is not None
        if tuple(candidate.link_ids) == before_ids:
            self._active_link_ids[endpoint_id] = before_ids
            return
        allowed, reason = routing.should_switch(
            before, candidate, self._routing_policy, self._hysteresis,
            self._dwell_ticks[endpoint_id], self._min_dwell_ticks, self._weights,
        )
        # Operator-driven fail/restore of the ACTIVE link already forced a
        # switch above; other operator events switch immediately for
        # backward-compatible failback behavior.
        if trigger in ("link_restored", "policy_changed"):
            allowed, reason = True, f"{trigger}: operator-driven reevaluation"
        if allowed:
            self._active_link_ids[endpoint_id] = tuple(candidate.link_ids)
            self._dwell_ticks[endpoint_id] = 0
            self._route_history.append(self._history_entry(endpoint_id, candidate, trigger))
            self._record(
                "handover" if trigger == "mobility_step" else "failback",
                f"{prefix}Route switched to {' -> '.join(candidate.node_ids)} ({reason})",
            )
            self._handover_history.append({
                "tick": self._tick, "sim_time_s": self._sim_time_s,
                "endpoint_id": endpoint_id,
                "from_link_ids": list(before.link_ids), "to_link_ids": list(candidate.link_ids),
                "reason": reason,
            })
        else:
            self._record("handover_deferred", f"{prefix}Handover deferred: {reason}")

    def _history_entry(self, endpoint_id: str, route: routing.Route, trigger: str) -> dict:
        initial_ids = self._initial_route_link_ids.get(endpoint_id)
        connected = initial_ids is not None and tuple(route.link_ids) == initial_ids
        return {
            "tick": self._tick, "sim_time_s": self._sim_time_s,
            "endpoint_id": endpoint_id,
            "connectivity": "connected" if connected else "degraded",
            "trigger": trigger,
            "node_ids": list(route.node_ids), "link_ids": list(route.link_ids),
            "latency_ms": route.latency_ms, "bandwidth_mbps": route.bandwidth_mbps,
            "reliability": route.reliability, "cost_per_gb": route.cost_per_gb,
        }

    def _evaluate_suitability(self, initial: bool = False) -> list[tuple[str, bool]]:
        """Reevaluate wireless link suitability; returns [(link_id, suitable)]."""
        changed: list[tuple[str, bool]] = []
        endpoints = graph_engine.link_endpoints(self._graph)
        for link in self._topology.links:
            pair = endpoints.get(link.id)
            prev = self._suitability.get(link.id, {}).get("suitable", True)
            distance = None
            if pair and pair[0] in self._positions and pair[1] in self._positions:
                pa, pb = self._positions[pair[0]], self._positions[pair[1]]
                if max(float(pa.get("altitude_m", 0.0)), float(pb.get("altitude_m", 0.0))) > 1000.0:
                    distance = rf.slant_range_km(pa, pb)
                else:
                    distance = mobility.distance_km(pa, pb)
            rx_dbm = margin_db = None
            model_name = "range_threshold"
            if link.rf is not None and link.rf.model == "link_budget":
                model_name = "link_budget"
                if distance is None:
                    suitable, reason, quality = True, f"{link.technology}: no geometry; assumed suitable", None
                else:
                    params = rf.params_from_dict(link.rf.model_dump(), link.technology)
                    assert params is not None
                    result = rf.evaluate(params, distance, prev)
                    suitable, reason, quality = result.suitable, result.reason, result.quality
                    rx_dbm, margin_db = result.rx_dbm, result.margin_db
            else:
                suitable, reason, quality = mobility.link_suitable(
                    link.medium, link.technology, distance, link.max_range_km, prev
                )
            self._suitability[link.id] = {
                "suitable": suitable, "reason": reason,
                "quality": quality, "distance_km": distance,
                "rx_dbm": rx_dbm, "margin_db": margin_db, "model": model_name,
            }
            was_unsuitable = link.id in self._unsuitable_links
            if suitable and was_unsuitable:
                self._unsuitable_links.discard(link.id)
                if not initial:
                    changed.append((link.id, True))
            elif not suitable and not was_unsuitable:
                self._unsuitable_links.add(link.id)
                if not initial:
                    changed.append((link.id, False))
        return changed

    def _route_info(self, route: routing.Route) -> RouteInfo:
        return RouteInfo(
            node_ids=list(route.node_ids),
            node_labels=[self._labels[nid] for nid in route.node_ids],
            link_ids=list(route.link_ids),
            latency_ms=route.latency_ms,
            bandwidth_mbps=route.bandwidth_mbps,
            reliability=route.reliability,
            cost_per_gb=route.cost_per_gb,
            score=route.score,
        )

    def _reachable_from_endpoints(self) -> set[str]:
        reachable: set[str] = set()
        blocked = set(self._failed_links) | set(self._unsuitable_links)
        for source in self._endpoints:
            if source in self._failed_nodes:
                continue
            seen = {source}
            stack = [source]
            while stack:
                current = stack.pop()
                for neighbor, data in self._graph[current].items():
                    if data["link_id"] in blocked:
                        continue
                    if neighbor in self._failed_nodes or neighbor in seen:
                        continue
                    seen.add(neighbor)
                    stack.append(neighbor)
            reachable |= seen
        return reachable


_SESSIONS: dict[str, SimulationSession] = {}


def get_session(scenario_id: str = "maritime_failover") -> SimulationSession:
    """Return the session for a scenario (default preserves MVP behavior).

    The default maritime session prefers the enriched DB seed topology
    (world positions, mobility, costs) when present, falling back to the
    bundled file so unit tests without a database keep working.
    """
    if scenario_id not in _SESSIONS:
        import os

        from . import database as db_module
        from . import scenarios as scenario_store

        policy = os.getenv("ROUTING_POLICY", routing.POLICY_LOWEST_LATENCY)
        if scenario_id == "maritime_failover":
            topology = None
            try:
                if db_module.db_path().exists():
                    detail = scenario_store.get_scenario(scenario_id)
                    if detail is not None:
                        topology = detail.topology
            except Exception:
                topology = None
            _SESSIONS[scenario_id] = SimulationSession(
                routing_policy=policy, topology=topology, scenario_id=scenario_id
            )
        else:
            detail = scenario_store.get_scenario(scenario_id)
            if detail is None:
                raise KeyError(f"Unknown scenario id: {scenario_id!r}")
            _SESSIONS[scenario_id] = SimulationSession(
                routing_policy=policy, topology=detail.topology, scenario_id=scenario_id
            )
    return _SESSIONS[scenario_id]


def drop_session(scenario_id: str) -> None:
    _SESSIONS.pop(scenario_id, None)
