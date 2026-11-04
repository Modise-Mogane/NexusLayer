"""After-action report: engineering summary of a simulation run.

Built from recorded route history, handover history, events, and the
topology device bindings. All figures are synthetic planning estimates.
"""

from . import hardware


def build_report(session) -> dict:
    analysis = session.get_analysis()
    labels = dict(session._labels)
    endpoints = list(session._endpoints)
    history = analysis["route_history"]
    handovers = analysis["handover_history"]

    ep_summary = []
    for ep in endpoints:
        entries = [h for h in history if h.get("endpoint_id") == ep]
        lat = [h["latency_ms"] for h in entries if h.get("latency_ms") is not None]
        bw = [h["bandwidth_mbps"] for h in entries if h.get("bandwidth_mbps") is not None]
        ep_hand = [h for h in handovers if h.get("endpoint_id") == ep]
        disc = sum(1 for h in entries if h.get("connectivity") == "disconnected")
        ep_summary.append({
            "endpoint_id": ep,
            "label": labels.get(ep, ep),
            "route_changes": len(entries),
            "handovers": len(ep_hand),
            "disconnected_periods": disc,
            "min_latency_ms": min(lat) if lat else None,
            "max_latency_ms": max(lat) if lat else None,
            "min_bandwidth_mbps": min(bw) if bw else None,
            "technologies_used": sorted({
                session._links_by_id[lid].technology
                for h in entries for lid in h.get("link_ids", [])
                if lid in session._links_by_id
            }),
        })

    cost_links = []
    total_cost_rate = 0.0
    for link in session._topology.links:
        if link.cost_per_gb:
            cost_links.append({
                "link_id": link.id, "label": link.label,
                "technology": link.technology, "cost_per_gb_usd": link.cost_per_gb,
            })
            total_cost_rate += link.cost_per_gb
    devices = []
    for node in session._topology.nodes:
        if not node.device_id:
            continue
        spec = hardware.get_device(node.device_id)
        devices.append({
            "node_id": node.id, "label": node.label,
            "device_id": node.device_id,
            "name": spec.name if spec else node.device_id,
            "capex_usd_approx": spec.cost_usd_approx if spec else None,
            "opex_usd_per_month": spec.opex_usd_per_month if spec else None,
        })
    capex = sum(d["capex_usd_approx"] or 0 for d in devices)
    opex = sum(d["opex_usd_per_month"] or 0 for d in devices)

    recommendations = _recommendations(session, analysis, ep_summary)

    return {
        "scenario_id": session._scenario_id,
        "policy": session._routing_policy,
        "sim_time_s": session._sim_time_s,
        "tick": session._tick,
        "availability": analysis["availability"],
        "per_endpoint": analysis["per_endpoint"],
        "endpoints": ep_summary,
        "handovers": handovers,
        "disconnection_periods": analysis["disconnection_periods"],
        "event_counts": analysis["event_counts"],
        "costs": {
            "currency": "USD",
            "assumption": "illustrative planning values, not commercial tariffs",
            "priced_links": cost_links,
            "devices": devices,
            "capex_usd_approx": capex,
            "opex_usd_per_month": opex,
        },
        "recommendations": recommendations,
        "assumptions": analysis["assumptions"],
        "confidence": "low: synthetic models and illustrative parameters; "
                      "validate with measurements before engineering decisions",
    }


def _recommendations(session, analysis, ep_summary) -> list[dict]:
    recs = []
    for ep in ep_summary:
        if ep["disconnected_periods"]:
            recs.append({
                "endpoint_id": ep["endpoint_id"],
                "finding": f"{ep['label']} lost connectivity "
                           f"{ep['disconnected_periods']} time(s)",
                "suggestion": "Add overlapping coverage (second cell, satellite "
                              "backup, or relay) along the outage segment.",
            })
        if ep["handovers"] >= 4:
            recs.append({
                "endpoint_id": ep["endpoint_id"],
                "finding": f"{ep['label']} switched routes {ep['handovers']} times",
                "suggestion": "Consider longer dwell time or higher hysteresis to "
                              "reduce flapping, or improve the preferred link margin.",
            })
        techs = ep["technologies_used"]
        if techs and all("satellite" in t.lower() or "vsat" in t.lower()
                         or "feeder" in t.lower() for t in techs):
            recs.append({
                "endpoint_id": ep["endpoint_id"],
                "finding": f"{ep['label']} relied solely on satellite links",
                "suggestion": "Satellite-only service is costly and high-latency; "
                              "evaluate terrestrial options where the route permits.",
            })
    state = session.get_state()
    for e in state.endpoint_routes:
        if not e.traffic_suitable and e.route is not None:
            recs.append({
                "endpoint_id": e.endpoint_id,
                "finding": f"{e.endpoint_label} application profile '{e.traffic}' "
                           f"not satisfied: {'; '.join(e.traffic_notes)}",
                "suggestion": "Choose a lower-demand traffic profile or upgrade "
                              "the bottleneck link on its route.",
            })
    if not recs:
        recs.append({
            "endpoint_id": "",
            "finding": "No outages, flapping, or unsatisfied profiles recorded",
            "suggestion": "Run longer scenarios or fail links to probe resilience.",
        })
    return recs
