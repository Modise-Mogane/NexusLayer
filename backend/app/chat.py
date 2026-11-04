"""Persistent conversational engineering assistant.

One orchestration layer over the five agent capabilities: each user message
is classified to a capability, read-only engineering tools gather live
context (scenario, routes, analysis, devices, knowledge base), and a reply
is composed — by the configured provider when available, otherwise by a
deterministic local composer that quotes the same tool outputs.

All conversations and tool results persist in SQLite. Replies may carry a
reviewable proposal payload (topology or device concept); nothing is saved
until the engineer explicitly approves through the normal save APIs.
"""

import json
import uuid

from . import agents, hardware, knowledge, providers, research
from . import database as db

HISTORY_LIMIT = 10
EVENT_LIMIT = 15

SYSTEM = (
    "You are NexusLayer's engineering assistant: a knowledgeable "
    "telecommunications and network-engineering colleague speaking with the "
    "operator. Conversation history and the operator's current UI selection "
    "define what 'this' and 'it' refer to — preserve that context across "
    "follow-up questions.\n"
    "INTERNAL EVIDENCE (tool outputs below) is for your reasoning only: "
    "SYNTHESIZE a natural-language answer from it. NEVER paste tool output "
    "into the reply — no JSON, no Python dictionaries, no raw API fields, "
    "no link/node ID dumps. Quote NUMBERS exactly as given (latency, "
    "bandwidth, counts); mark every number absent from the evidence as an "
    "illustrative assumption. Never invent measurements, standards, or "
    "device models. Never claim experimental validation.\n"
    "STYLE: clear explanatory paragraphs first, units attached to every "
    "engineering value, short summaries where apt, tables only for genuine "
    "comparisons. End with one useful follow-up offer (e.g. open the link "
    "inspector or a Physics Lab experiment). Cite knowledge passages as "
    "[doc title, passage #idx].\n"
    "If the operator asks a hypothetical ('what if', 'increase', 'replace'), "
    "discuss the physical implication qualitatively from the evidence and "
    "say what a Physics Lab experiment would need to quantify it — do not "
    "invent the quantified outcome.\n"
    "When the evidence includes per-endpoint tables or event lists the "
    "operator may want to inspect, put them AFTER a '## Technical evidence' "
    "heading (the UI collapses that section); the prose above it must stand "
    "alone as the complete answer."
)

_CAPABILITY_KEYWORDS = {
    "architect": ("design", "topology", "architect", "layout", "plan a network",
                  "propose a network", "improve the architecture", "alternative topology"),
    "hardware": ("device", "hardware", "gateway", "modem", "terminal", "antenna",
                 "equipment", "spec", "concept", "adapter", "invent"),
    "research": ("research", "finding", "paper", "standard", "3gpp", "rfc", "itu",
                 "claim", "hypothesis", "verify", "evidence", "protocol"),
    "connectivity": ("policy", "policies", "cost", "cheapest", "optimize", "weights",
                     "balanced", "priority", "qos", "budget"),
    "simulation": ("simulat", "handover", "failover", "route", "latency", "throughput",
                   "why did", "performing", "disconnect", "outage", "coverage",
                   "event", "analysis", "report"),
}


def classify_capability(message: str, hint: str | None = None) -> str:
    if hint in agents.CAPABILITIES:
        return hint
    lowered = message.lower()
    scores = {cap: sum(1 for kw in kws if kw in lowered)
              for cap, kws in _CAPABILITY_KEYWORDS.items()}
    best = max(scores, key=lambda c: scores[c])
    return best if scores[best] > 0 else "simulation"


def _new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


# -- persistence -----------------------------------------------------------

def list_conversations() -> list[dict]:
    conn = db.connect()
    try:
        rows = conn.execute(
            "SELECT c.*, (SELECT COUNT(*) FROM chat_messages m"
            " WHERE m.conversation_id = c.id) AS message_count"
            " FROM conversations c ORDER BY c.updated_at DESC LIMIT 50"
        ).fetchall()
        return [db.row_to_dict(r) for r in rows]
    finally:
        conn.close()


def get_conversation(cid: str) -> dict | None:
    conn = db.connect()
    try:
        row = conn.execute(
            "SELECT * FROM conversations WHERE id = ?", (cid,)
        ).fetchone()
        if row is None:
            return None
        convo = db.row_to_dict(row)
        msgs = conn.execute(
            "SELECT * FROM chat_messages WHERE conversation_id = ?"
            " ORDER BY created_at, id",
            (cid,),
        ).fetchall()
        convo["messages"] = [db.row_to_dict(m) for m in msgs]
        return convo
    finally:
        conn.close()


def create_conversation(title: str, scenario_id: str = "",
                        capability: str = "simulation") -> dict:
    cid = _new_id("chat")
    conn = db.connect()
    try:
        ts = db.now_iso()
        conn.execute(
            "INSERT INTO conversations (id, title, scenario_id, capability,"
            " provider, model, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, '', '', ?, ?)",
            (cid, title[:80] or "Untitled", scenario_id, capability, ts, ts),
        )
        conn.commit()
    finally:
        conn.close()
    convo = get_conversation(cid)
    assert convo is not None
    return convo


def _append_message(cid: str, role: str, content: str, tool_calls: list | None = None,
                    citations: list | None = None, proposal: dict | None = None,
                    provenance: str = "") -> dict:
    mid = _new_id("msg")
    conn = db.connect()
    try:
        ts = db.now_iso()
        conn.execute(
            "INSERT INTO chat_messages (id, conversation_id, role, content,"
            " tool_calls_json, citations_json, proposal_json, provenance, created_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (mid, cid, role, content, json.dumps(tool_calls or []),
             json.dumps(citations or []), json.dumps(proposal) if proposal else "",
             provenance, ts),
        )
        conn.execute(
            "UPDATE conversations SET updated_at = ? WHERE id = ?", (ts, cid)
        )
        conn.commit()
    finally:
        conn.close()
    return {"id": mid, "role": role, "content": content}


def record_note(cid: str, text: str) -> dict:
    return _append_message(cid, "system", text, provenance="system_note")


def delete_conversation(cid: str) -> bool:
    conn = db.connect()
    try:
        conn.execute("DELETE FROM chat_messages WHERE conversation_id = ?", (cid,))
        cur = conn.execute("DELETE FROM conversations WHERE id = ?", (cid,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


# -- read-only engineering tools -------------------------------------------

def tool_scenario_snapshot(scenario_id: str) -> dict:
    from . import scenarios as scenario_store

    detail = scenario_store.get_scenario(scenario_id)
    if detail is None:
        return {"error": f"unknown scenario {scenario_id!r}"}
    topo = detail.topology
    return {
        "id": scenario_id, "name": detail.name, "environment": detail.environment,
        "nodes": [{"id": n.id, "type": n.type, "label": n.label} for n in topo.nodes],
        "links": [{"id": l.id, "source": l.source, "target": l.target,
                   "technology": l.technology, "latency_ms": l.latency_ms,
                   "bandwidth_mbps": l.bandwidth_mbps} for l in topo.links],
    }


def tool_endpoint_status(scenario_id: str) -> dict:
    from . import simulation as sim_module

    try:
        session = sim_module.get_session(scenario_id)
    except (KeyError, ValueError) as exc:
        return {"error": str(exc)}
    state = session.get_state()
    return {
        "policy": state.routing_policy,
        "overall": state.connectivity,
        "tick": state.tick,
        "sim_time_s": state.sim_time_s,
        "endpoints": [
            {
                "id": e.endpoint_id, "label": e.endpoint_label,
                "connectivity": e.connectivity,
                "path": e.route.node_labels if e.route else [],
                "latency_ms": e.route.latency_ms if e.route else None,
                "bandwidth_mbps": e.route.bandwidth_mbps if e.route else None,
                "achieved_mbps": e.achieved_mbps,
                "traffic": e.traffic, "traffic_suitable": e.traffic_suitable,
                "traffic_notes": e.traffic_notes,
            }
            for e in state.endpoint_routes
        ],
    }


def tool_run_summary(scenario_id: str) -> dict:
    from . import simulation as sim_module

    try:
        session = sim_module.get_session(scenario_id)
    except (KeyError, ValueError) as exc:
        return {"error": str(exc)}
    analysis = session.get_analysis()
    events = [
        {"tick": e.tick, "type": e.type, "message": e.message}
        for e in session.get_events()[-EVENT_LIMIT:]
    ]
    return {
        "policy": analysis["policy"],
        "availability": analysis["availability"],
        "per_endpoint": analysis.get("per_endpoint", {}),
        "handover_count": len(analysis["handover_history"]),
        "recent_events": events,
    }


def tool_selection_detail(kind: str, ref: str, scenario_id: str) -> dict:
    """Resolve the operator's current UI selection (node or link) to facts."""
    from . import phy as phy_module
    from . import scenarios as scenario_store
    from . import simulation as sim_module

    if kind not in ("node", "link"):
        return {"error": f"unsupported selection kind {kind!r}"}
    detail = scenario_store.get_scenario(scenario_id) if scenario_id else None
    if detail is None:
        return {"error": f"unknown scenario {scenario_id!r}"}
    topo = detail.topology
    if kind == "node":
        node = next((n for n in topo.nodes if n.id == ref), None)
        if node is None:
            return {"error": f"unknown node {ref!r}"}
        out: dict = {
            "kind": "node", "id": node.id, "label": node.label, "type": node.type,
            "device_id": node.device_id,
            "technologies": list(node.supported_technologies or []),
        }
        try:
            state = sim_module.get_session(scenario_id).get_state()
            live = next((n for n in state.nodes if n.id == ref), None)
            if live is not None:
                out["live"] = {"on_active_route": live.on_active_route,
                               "reachable": live.reachable}
            for e in state.endpoint_routes:
                if e.endpoint_id == ref:
                    out["endpoint"] = {
                        "connectivity": e.connectivity,
                        "latency_ms": e.route.latency_ms if e.route else None,
                        "path": e.route.node_labels if e.route else [],
                    }
        except (KeyError, ValueError):
            out["live"] = None
        return out
    link = next((l for l in topo.links if l.id == ref), None)
    if link is None:
        return {"error": f"unknown link {ref!r}"}
    try:
        live_state = sim_module.get_session(scenario_id).get_state()
        live_link = next((l for l in live_state.links if l.id == ref), None)
        live = live_link.model_dump(mode="json") if live_link else None
    except (KeyError, ValueError):
        live = None
    try:
        expl = phy_module.explain_link(topo, ref, live)
    except (KeyError, ValueError) as exc:
        expl = {"error": str(exc)}
    return {"kind": "link", "id": ref, "explanation": expl}


def tool_device_lookup(query: str) -> dict:
    exact = hardware.get_device(query)
    if exact is not None:
        return {"devices": [exact.model_dump(mode="json")]}
    matches = hardware.list_devices(search=query)[:5]
    return {"devices": [m.model_dump(mode="json") for m in matches]}


def tool_knowledge_search(query: str) -> dict:
    return {"passages": knowledge.search(query, limit=5)}


def tool_finding_summary(finding_id: str) -> dict:
    finding = research.get_finding(finding_id)
    if finding is None:
        return {"error": f"unknown finding {finding_id!r}"}
    assessments = research.list_assessments(finding_id)
    return {
        "id": finding.id, "title": finding.title, "status": finding.status,
        "verdicts": [(a.created_by, a.verdict) for a in assessments],
    }


TOOLS = {
    "scenario_snapshot": tool_scenario_snapshot,
    "endpoint_status": tool_endpoint_status,
    "run_summary": tool_run_summary,
    "device_lookup": tool_device_lookup,
    "knowledge_search": tool_knowledge_search,
    "finding_summary": tool_finding_summary,
    "selection_detail": tool_selection_detail,
}

_CAPABILITY_TOOLS = {
    "architect": ("scenario_snapshot", "device_lookup", "knowledge_search"),
    "hardware": ("device_lookup", "knowledge_search"),
    "research": ("finding_summary", "knowledge_search"),
    "connectivity": ("endpoint_status", "run_summary"),
    "simulation": ("endpoint_status", "run_summary", "scenario_snapshot"),
}


# Allowlisted UI-selection keys accepted from the global assistant. Anything
# else is dropped so arbitrary frontend state never reaches the prompt.
_CONTEXT_KEYS = ("route", "node_id", "node_label", "link_id", "link_label",
                 "region_id", "entity_id", "entity_label", "experiment_id")


def sanitize_context(context: dict | None) -> dict:
    if not isinstance(context, dict):
        return {}
    out = {}
    for key in _CONTEXT_KEYS:
        value = context.get(key)
        if isinstance(value, str) and value.strip():
            out[key] = value.strip()[:160]
    return out


def gather_context(capability: str, message: str, scenario_id: str,
                   selection: dict | None = None) -> tuple[list[dict], list[dict]]:
    """Run the capability's tools; returns (tool_calls, citations)."""
    calls: list[dict] = []
    citations: list[dict] = []
    if selection and scenario_id:
        kind = "link" if selection.get("link_id") else "node" if selection.get("node_id") else ""
        ref = selection.get("link_id") or selection.get("node_id") or ""
        if kind and ref:
            try:
                result = tool_selection_detail(kind, str(ref), scenario_id)
            except Exception as exc:
                result = {"error": f"{type(exc).__name__}"}
            calls.append({"tool": "selection_detail", "result": result})
    for tool_name in _CAPABILITY_TOOLS.get(capability, ()):
        try:
            if tool_name in ("scenario_snapshot", "endpoint_status", "run_summary"):
                if not scenario_id:
                    continue
                result = TOOLS[tool_name](scenario_id)
            elif tool_name == "device_lookup":
                result = TOOLS[tool_name](message[:120])
            elif tool_name == "finding_summary":
                continue  # only on explicit finding reference
            else:
                result = TOOLS[tool_name](message[:200])
        except Exception as exc:
            result = {"error": f"{type(exc).__name__}"}
        calls.append({"tool": tool_name, "result": result})
        if tool_name == "knowledge_search":
            for p in (result.get("passages") or [])[:5]:
                citations.append({
                    "doc_id": p.get("doc_id"), "chunk_id": p.get("chunk_id"),
                    "title": p.get("title"), "heading": p.get("heading"),
                    "page": p.get("page"), "snippet": p.get("snippet"),
                })
    return calls, citations


# -- deterministic reply composer ------------------------------------------

def _fmt_path(ep: dict) -> str:
    if not ep.get("path"):
        return "no route (disconnected)"
    return " → ".join(ep["path"])


_HYPOTHETICAL = ("what if", "what happens if", "increase", "decrease",
                 "higher", "lower", "replace", "instead of", "change the")


def _narrate_link(link_id: str, expl: dict, message: str) -> list[str]:
    """Natural-language explanation of the selected link (never a data dump)."""
    if expl.get("error") or not expl.get("source"):
        return [f"I couldn't resolve link {link_id!r} in this scenario. "
                "Select a connection in Architecture or Simulation first."]
    src = expl.get("source") or {}
    dst = expl.get("target") or {}
    tech = expl.get("technology") or "unknown technology"
    medium = expl.get("medium") or ""
    cfg = expl.get("configured") or {}
    out = [f"{src.get('label', '?')} communicates with {dst.get('label', '?')} "
           f"using {tech}" + (f" ({medium})" if medium else "") + "."]
    mech = (expl.get("medium_explainer") or {}).get("mechanism") or []
    if mech:
        out.append(str(mech[0]).strip())
    facts: list[str] = []
    if cfg.get("latency_ms") is not None:
        facts.append(f"{cfg['latency_ms']} ms of configured latency")
    if cfg.get("bandwidth_mbps") is not None:
        facts.append(f"{cfg['bandwidth_mbps']} Mbps bottleneck bandwidth")
    dist = expl.get("distance_km")
    if isinstance(dist, (int, float)):
        facts.append(f"about {dist:.1f} km apart ({expl.get('distance_how', 'spacing')})")
    freq = expl.get("frequency_mhz")
    if freq:
        facts.append(f"near {freq:g} MHz")
    if facts:
        out.append("In the current configuration this connection provides "
                   + "; ".join(facts) + ". These are planning estimates, "
                   "not measurements.")
    else:
        out.append("No latency or bandwidth figures are configured for this "
                   "connection yet.")
    for calc in expl.get("calculations") or []:
        if calc.get("id") == "link_budget" and calc.get("status") == "calculated":
            vals = {o["label"]: o for o in calc.get("outputs", [])}
            rx = vals.get("Received power", {}).get("value")
            margin = vals.get("Link margin", {}).get("value")
            ok = vals.get("Suitable", {}).get("value")
            if rx is not None and margin is not None:
                out.append(f"The radio link budget estimates {rx} dBm received "
                           f"with {margin} dB of margin — the link is "
                           f"{'suitable' if ok else 'currently unsuitable'}.")
            break
    lowered = message.lower()
    if any(h in lowered for h in _HYPOTHETICAL):
        out.append(_what_if_note(expl, lowered))
    out.append("Open the link inspector for the full budget, or the Physics Lab "
               "to experiment with this medium.")
    return [" ".join(out[:2]), "", *out[2:]] if len(out) > 2 else out


def _what_if_note(expl: dict, lowered: str) -> str:
    family = expl.get("family") or ""
    freq = expl.get("frequency_mhz")
    if "frequenc" in lowered and family in ("wifi", "cellular", "lpwan",
                                            "bluetooth", "microwave",
                                            "satellite"):
        base = ("Raising the carrier frequency shortens the wavelength and, "
                "all else equal, increases free-space path loss roughly with "
                "the square of the frequency — so the received power and "
                "margin would fall unless antennas, power, or distance change.")
        if freq:
            base += (f" The current carrier is near {freq:g} MHz; a Physics Lab "
                     "radio experiment with the link's TX power and antenna "
                     "gains can quantify the new budget.")
        return base + (" Higher bands often bring wider channels, but that "
                       "trade-off is not modeled here.")
    if family == "fiber" and ("copper" in lowered or "replace" in lowered or
                              "instead" in lowered):
        return ("Replacing fiber with copper trades optical capacity and reach "
                "for cheaper terminations: copper reach is length-limited "
                "(~100 m for twisted pair) and attenuation rises with data "
                "rate. The Physics Lab copper experiment can compare budgets.")
    return ("I can discuss that change qualitatively, but the deterministic "
            "composer won't invent the quantified outcome — open the Physics "
            "Lab with this link's parameters to test it.")


def compose_local_reply(capability: str, message: str, scenario_id: str,
                        tool_calls: list[dict], citations: list[dict],
                        selection: dict | None = None) -> str:
    by_tool = {c["tool"]: c["result"] for c in tool_calls}
    lines: list[str] = []
    sel = by_tool.get("selection_detail") or {}
    if not sel.get("error") and sel.get("kind") == "node":
        ep = sel.get("endpoint") or {}
        live = sel.get("live") or {}
        lines.append(f"Referring to **{sel.get('label')}** ({sel.get('type')}, "
                     f"{sel.get('id')}).")
        if ep:
            path = " → ".join(ep.get("path") or []) or "no route (disconnected)"
            lines.append(f"Endpoint status: **{ep.get('connectivity')}**; path: {path}.")
        elif live:
            lines.append(f"Node reachable: {live.get('reachable')}; "
                         f"on active route: {live.get('on_active_route')}.")
        lines.append("")
    elif not sel.get("error") and sel.get("kind") == "link":
        expl = sel.get("explanation") or {}
        lines.extend(_narrate_link(sel.get("id", ""), expl, message))
        lines.append("")
    if capability == "simulation":
        eps = (by_tool.get("endpoint_status") or {}).get("endpoints", [])
        run = by_tool.get("run_summary") or {}
        if not eps:
            lines.append("No simulation session is loaded for that scenario yet. "
                         "Open it in 3D Simulation first.")
        else:
            connected = [e for e in eps if e["connectivity"] == "connected"]
            degraded = [e for e in eps if e["connectivity"] == "degraded"]
            down = [e for e in eps if e["connectivity"] not in ("connected", "degraded")]
            unmet = [e for e in eps if not e["traffic_suitable"]]
            lines.append("## Network assessment")
            if not down and not degraded:
                lines.append(f"Overall status: **healthy** — all {len(eps)} endpoints connected.")
            else:
                parts = []
                if down:
                    parts.append(f"{len(down)} disconnected ({', '.join(e['label'] for e in down)})")
                if degraded:
                    parts.append(f"{len(degraded)} degraded ({', '.join(e['label'] for e in degraded)})")
                lines.append(f"Overall status: **attention needed** — {'; '.join(parts)}; "
                             f"{len(connected)} connected.")
            lines.append(f"Policy **{run.get('policy', '?')}** · availability "
                         f"{(run.get('availability', 0) or 0) * 100:.1f}% · "
                         f"{run.get('handover_count', 0)} handovers.")
            latencies = [(e["label"], e["latency_ms"]) for e in eps if e.get("latency_ms") is not None]
            if latencies:
                worst = max(latencies, key=lambda t: t[1])
                lines.append(f"Highest latency: **{worst[0]}** at {worst[1]:.0f} ms.")
            if unmet:
                lines.append("Application needs unmet: "
                             + "; ".join(f"**{e['label']}** ({e['traffic']})" for e in unmet)
                             + ".")
            else:
                lines.append("All endpoints meet their application profiles.")
            if down:
                lines.append("Possible improvement: investigate backhaul options for the "
                             "disconnected endpoints (see Coverage Research).")
            elif degraded:
                lines.append("Possible improvement: compare routing policies or add capacity "
                             "on the degraded paths.")
            lines.append("")
            lines.append("## Technical evidence")
            for ep in eps:
                status = ep["connectivity"]
                lat = f"{ep['latency_ms']:.0f} ms" if ep.get("latency_ms") is not None else "—"
                ach = f"{ep['achieved_mbps']:.1f} Mbps" if ep.get("achieved_mbps") is not None else "—"
                lines.append(f"- **{ep['label']}**: {status}, {lat}, ~{ach} fair share "
                             f"({ep['traffic']}).")
                if not ep["traffic_suitable"] and ep.get("traffic_notes"):
                    lines.append(f"  App needs unmet: {'; '.join(ep['traffic_notes'])}.")
                lines.append(f"  Path: {_fmt_path(ep)}")
            recent = (run.get("recent_events") or [])[-5:]
            if recent:
                lines.append("Recent events:")
                for e in recent:
                    lines.append(f"- tick {e['tick']} · {e['type']}: {e['message']}")
    elif capability == "connectivity":
        eps = (by_tool.get("endpoint_status") or {}).get("endpoints", [])
        lines.append("Current eligibility per endpoint (deterministic engine output):")
        for ep in eps:
            lines.append(f"- **{ep['label']}**: {_fmt_path(ep)} "
                         f"({ep.get('latency_ms', '—')} ms).")
        lines.append("Change policy in 3D Simulation to re-rank; the engine recomputes "
                     "eligibility before ranking.")
    elif capability == "hardware":
        devices = (by_tool.get("device_lookup") or {}).get("devices", [])
        if devices:
            lines.append("Closest catalog matches:")
            for d in devices[:5]:
                lines.append(f"- **{d['name']}** ({d['device_id']}): "
                             f"{', '.join(i['technology'] for i in d.get('interfaces', []))}; "
                             f"~${d.get('cost_usd_approx', '?')}.")
        else:
            lines.append("No catalog device matches that description; describe interfaces "
                         "and I can draft a specification-level concept.")
    elif capability == "architect":
        snap = by_tool.get("scenario_snapshot") or {}
        if snap.get("error"):
            lines.append("Provide a scenario for topology-specific feedback.")
        else:
            lines.append(f"Scenario **{snap.get('name')}**: {len(snap.get('nodes', []))} nodes, "
                         f"{len(snap.get('links', []))} links.")
            techs = {l["technology"] for l in snap.get("links", [])}
            lines.append(f"Technologies in use: {', '.join(sorted(techs)) or 'none'}.")
    else:  # research
        lines.append("I can review a submitted finding or search the knowledge base. "
                     "Reference a finding id or ask about a standard.")
    if citations:
        lines.append("Knowledge passages consulted:")
        for c in citations[:5]:
            lines.append(f"- [{c['title']}, passage #{c.get('idx', c.get('chunk_id'))}] "
                         f"{(c.get('snippet') or '')[:160]}")
    lines.append("")
    lines.append("_Deterministic local reply (no provider configured). All figures are "
                 "synthetic planning estimates unless labeled measured._")
    return "\n".join(lines)


# -- main entry points -----------------------------------------------------

def _history(cid: str) -> list[dict]:
    convo = get_conversation(cid)
    if not convo:
        return []
    out = []
    for m in convo["messages"][-HISTORY_LIMIT:]:
        if m["role"] in ("user", "assistant"):
            out.append({"role": m["role"], "content": m["content"][:2000]})
    return out


def _proposal_for(capability: str, message: str, scenario_id: str,
                  use_ai: bool = True) -> dict | None:
    """Build a reviewable proposal payload via the agent layer (local or AI)."""
    if capability == "architect" and any(
            w in message.lower() for w in ("design", "propose", "create", "topology", "architect")):
        from . import scenarios as scenario_store

        context: dict = {"environment": "generic"}
        if scenario_id:
            detail = scenario_store.get_scenario(scenario_id)
            if detail is not None:
                context["topology"] = detail.topology.model_dump(mode="json")
        resp = agents.run_agent(agents.AgentRequest(
            capability="architect", prompt=message[:2000], context=context, use_ai=use_ai))
        ai = (resp.result or {}).get("ai")
        if ai and ai.get("proposal_topology"):
            return {"kind": "topology", "data": ai["proposal_topology"],
                    "explanation": ai.get("explanation", ""),
                    "limitations": ai.get("limitations", []),
                    "provenance": resp.provenance}
        return None
    if capability == "hardware" and any(
            w in message.lower() for w in ("design", "propose", "create", "concept", "build")):
        resp = agents.run_agent(agents.AgentRequest(
            capability="hardware", prompt=message[:2000], context={}, use_ai=use_ai))
        ai = (resp.result or {}).get("ai")
        local = (resp.result or {}).get("local") or {}
        concept = (ai or {}).get("concept") or local.get("concept")
        if concept:
            return {"kind": "device", "data": concept,
                    "feasibility": (ai or local).get("feasibility", {}),
                    "provenance": resp.provenance,
                    "note": "UNVALIDATED PROPOSAL until reviewed."}
    return None


def prepare_reply(conversation_id: str | None, message: str, scenario_id: str = "",
                  capability_hint: str | None = None,
                  provider: str | None = None, use_ai: bool = True,
                  context: dict | None = None) -> dict:
    """Classify, gather tools, persist the user message; returns reply context."""
    capability = classify_capability(message, capability_hint)
    selection = sanitize_context(context)
    if conversation_id:
        convo = get_conversation(conversation_id)
        if convo is None:
            raise KeyError(f"Unknown conversation {conversation_id!r}")
        cid = conversation_id
    else:
        title = (message.strip().split("\n")[0])[:60] or "Untitled"
        cid = create_conversation(title, scenario_id, capability)["id"]
    _append_message(cid, "user", message)
    tool_calls, citations = gather_context(capability, message, scenario_id, selection)
    proposal = _proposal_for(capability, message, scenario_id, use_ai)
    status = providers.provider_status()
    active = provider or status.get("provider") or "meta"
    state = (status.get("providers") or {}).get(active, {}).get("state", "unavailable")
    if use_ai is False:
        state = "unavailable"
    return {
        "conversation_id": cid, "capability": capability,
        "tool_calls": tool_calls, "citations": citations, "proposal": proposal,
        "provider": active, "model": status.get("model", ""),
        "provider_state": state, "selection": selection,
    }


_DUMP_MARKERS = ("endpoint_status", "scenario_snapshot", "run_summary",
                 "selection_detail", "'latency_ms'", '"latency_ms"',
                 "'bandwidth_mbps'", '"bandwidth_mbps"', "'node_ids'",
                 '"node_ids"', "achieved_mbps")


def is_raw_dump(text: str) -> bool:
    """Heuristic backstop: True when a reply pasted tool output verbatim.

    The system prompt forbids this; the guard catches a misbehaving model so
    the operator never sees a raw dictionary as the conversational answer.
    """
    stripped = (text or "").strip()
    if not stripped:
        return False
    if stripped[0] in "{[":
        try:
            parsed = json.loads(stripped)
        except (ValueError, TypeError):
            parsed = None
        if isinstance(parsed, (dict, list)):
            return True
    hits = sum(1 for m in _DUMP_MARKERS if m in stripped)
    return hits >= 2


def _selection_line(selection: dict) -> str:
    if not selection:
        return "none"
    bits = []
    for key in ("route", "node_label", "node_id", "link_label", "link_id",
                "region_id", "entity_label", "entity_id", "experiment_id"):
        if selection.get(key):
            bits.append(f"{key}={selection[key]}")
    return "; ".join(bits) or "none"


def ai_messages(ctx: dict, message: str) -> list[dict]:
    tools_brief = json.dumps(
        [{k: c[k] for k in ("tool",)} | {"result": str(c["result"])[:3000]}
         for c in ctx["tool_calls"]], indent=1)
    return [
        {"role": "system", "content": SYSTEM},
        *[{"role": h["role"], "content": h["content"]}
          for h in _history(ctx["conversation_id"])[:-1]],
        {"role": "user", "content": (
            f"Scenario: {ctx.get('scenario_id', '') or 'none selected'}\n"
            f"Capability: {ctx['capability']}\n"
            f"Operator UI selection: {_selection_line(ctx.get('selection') or {})}\n"
            f"INTERNAL EVIDENCE — reason from these, never paste them:\n{tools_brief}\n\n"
            f"Operator message: {message}\n"
            f"Reply in natural language per the system instructions."
        )},
    ]


def respond(conversation_id: str | None, message: str, scenario_id: str = "",
            capability_hint: str | None = None,
            provider: str | None = None, use_ai: bool = True,
            context: dict | None = None) -> dict:
    """Full non-streaming reply; persists both messages and returns the reply."""
    if not message.strip():
        raise ValueError("Message is empty")
    ctx = prepare_reply(conversation_id, message, scenario_id, capability_hint,
                        provider, use_ai, context)
    ctx["scenario_id"] = scenario_id
    if ctx["provider_state"] == "configured":
        out = providers.chat(ai_messages(ctx, message), provider=ctx["provider"])
        if out.get("ok") and not is_raw_dump(str(out.get("text", ""))):
            text = str(out["text"])
            provenance = f"ai:{ctx['provider']}:{out.get('model', '')}"
        elif out.get("ok"):
            text = (compose_local_reply(ctx["capability"], message, scenario_id,
                                        ctx["tool_calls"], ctx["citations"],
                                        ctx.get("selection"))
                    + "\n\n_The provider returned raw tool data instead of an "
                    "explanation; substituted the deterministic summary._")
            provenance = "local_deterministic"
        else:
            text = (compose_local_reply(ctx["capability"], message, scenario_id,
                                        ctx["tool_calls"], ctx["citations"],
                                        ctx.get("selection"))
                    + f"\n\n_Provider error ({out.get('error')}); fell back to local logic._")
            provenance = "local_deterministic"
    else:
        text = compose_local_reply(ctx["capability"], message, scenario_id,
                                   ctx["tool_calls"], ctx["citations"],
                                   ctx.get("selection"))
        provenance = "local_deterministic"
    msg = _append_message(ctx["conversation_id"], "assistant", text,
                          ctx["tool_calls"], ctx["citations"], ctx["proposal"], provenance)
    return {
        "conversation_id": ctx["conversation_id"], "capability": ctx["capability"],
        "reply": text, "message_id": msg["id"], "tool_calls": ctx["tool_calls"],
        "citations": ctx["citations"], "proposal": ctx["proposal"],
        "provenance": provenance, "provider": ctx["provider"],
    }


def respond_stream(ctx: dict, message: str, scenario_id: str):
    """Yield SSE-ready dicts for a prepared reply; persists the assistant message."""
    ctx["scenario_id"] = scenario_id
    yield {"event": "meta", "data": {
        "conversation_id": ctx["conversation_id"], "capability": ctx["capability"],
        "tool_calls": ctx["tool_calls"], "citations": ctx["citations"],
        "proposal": ctx["proposal"], "provider": ctx["provider"]}}
    full: list[str] = []
    provenance = "local_deterministic"
    finish_reason = ""
    if ctx["provider_state"] == "configured":
        failures = 0
        for chunk in providers.chat_stream(ai_messages(ctx, message), provider=ctx["provider"]):
            if "delta" in chunk:
                # Provider output is untrusted until the complete reply is checked.
                full.append(chunk["delta"])
            elif "error" in chunk:
                failures += 1
            elif chunk.get("done"):
                finish_reason = str(chunk.get("finish_reason", "") or "")
        if full:
            provenance = f"ai:{ctx['provider']}:{ctx.get('model', '')}"
            tail_note = ""
            if finish_reason == "length":
                tail_note = ("\n\n_Response cut off at the provider's length limit — "
                             "ask me to continue._")
            elif failures:
                tail_note = ("\n\n_Note: the provider stream reported an error; "
                             "this reply may be incomplete._")
            if tail_note:
                full.append(tail_note)
        else:
            fallback = (compose_local_reply(ctx["capability"], message, scenario_id,
                                            ctx["tool_calls"], ctx["citations"],
                                            ctx.get("selection"))
                        + "\n\n_Streaming failed; fell back to local logic._")
            full.append(fallback)
            yield {"event": "delta", "data": {"text": fallback}}
    else:
        text = compose_local_reply(ctx["capability"], message, scenario_id,
                                   ctx["tool_calls"], ctx["citations"],
                                   ctx.get("selection"))
        full.append(text)
        # Deliver deterministic replies in a few chunks so the UI streams.
        step = max(len(text) // 6, 1)
        for i in range(0, len(text), step):
            yield {"event": "delta", "data": {"text": text[i:i + step]}}
    reply = "".join(full)
    corrected: str | None = None
    if provenance != "local_deterministic" and is_raw_dump(reply):
        corrected = (compose_local_reply(ctx["capability"], message, scenario_id,
                                         ctx["tool_calls"], ctx["citations"],
                                         ctx.get("selection"))
                     + "\n\n_The provider returned raw tool data instead of an "
                     "explanation; substituted the deterministic summary._")
        reply = corrected
        provenance = "local_deterministic"
    if ctx["provider_state"] == "configured" and full and (provenance != "local_deterministic" or corrected is not None):
        yield {"event": "delta", "data": {"text": reply}}
    msg = _append_message(ctx["conversation_id"], "assistant", reply,
                          ctx["tool_calls"], ctx["citations"], ctx["proposal"], provenance)
    done_data: dict = {"message_id": msg["id"], "provenance": provenance}
    if finish_reason:
        done_data["finish_reason"] = finish_reason
    if corrected is not None:
        done_data["corrected_text"] = corrected
    yield {"event": "done", "data": done_data}
