"""Agent orchestration layer: five logical capabilities, one service.

Each capability computes a deterministic local result first. When a provider
is configured (and use_ai is true), the agent additionally requests a
structured model proposal, validates it against Pydantic schemas plus the
domain rules (topology validation, compatibility, feasibility), and returns
both. AI outputs are reviewable proposals: agents NEVER mutate saved objects
directly — the UI previews proposals and the human saves through the normal
API. When AI is unavailable or a proposal fails validation, the deterministic
result stands and ai_status names the exact limitation.
"""

import json

from pydantic import BaseModel, Field

from . import compatibility, hardware, providers, research, routing, validation
from .hardware import DeviceSpec
from .models import Topology

CAPABILITIES = (
    "architect",
    "hardware",
    "research",
    "connectivity",
    "simulation",
)


class AgentRequest(BaseModel):
    capability: str
    prompt: str = Field(min_length=1, max_length=4000)
    context: dict = Field(default_factory=dict)
    use_ai: bool = True


class AgentResponse(BaseModel):
    capability: str
    provenance: str
    model: str = ""
    ai_status: str = "not_attempted"
    result: dict = Field(default_factory=dict)
    advisory_note: str = ""


SYSTEM = (
    "You are a senior network engineering assistant inside NexusLayer. "
    "Answer only with the requested raw JSON object. Never invent device models, "
    "measured values, or standards; mark every number as an illustrative assumption. "
    "Never claim experimental validation."
)


def _catalog_summary(max_devices: int = 30) -> list[dict]:
    out = []
    for d in hardware.list_devices()[:max_devices]:
        out.append({
            "device_id": d.device_id,
            "name": d.name,
            "category": d.category,
            "interfaces": [i.technology for i in d.interfaces],
            "throughput_mbps": d.throughput_mbps,
            "range_km": d.range_km,
            "cost_usd_approx": d.cost_usd_approx,
        })
    return out


def _architect_local(prompt: str, context: dict) -> dict:
    topology = None
    if context.get("topology"):
        try:
            topology = Topology.model_validate(context["topology"])
        except Exception:
            topology = None
    recommendations: list[str] = []
    weaknesses: list[str] = []
    if topology is None:
        recommendations.append("Provide a topology to receive specific design feedback.")
    else:
        wireless = [l for l in topology.links if l.medium == "wireless"]
        if wireless and not any(l.max_range_km for l in wireless):
            weaknesses.append("Wireless links without max_range_km cannot be suitability-checked during movement.")
        techs = {l.technology for l in topology.links}
        if len(techs) >= 2 and not any(n.type in ("gateway", "router") for n in topology.nodes):
            recommendations.append("Heterogeneous technologies detected: add a gateway/router for protocol termination.")
        endpoints = [n for n in topology.nodes if n.type in ("ship", "car", "aircraft", "train")]
        for ep in endpoints:
            incident = [l for l in topology.links if l.source == ep.id or l.target == ep.id]
            if len(incident) < 2:
                weaknesses.append(f"Endpoint {ep.label} has a single access link (no backup path).")
        if not weaknesses:
            recommendations.append("Topology has redundant access links; consider cost/reliability tradeoffs next.")
    lowered = prompt.lower()
    if "maritime" in lowered or "ship" in lowered:
        recommendations.append("For maritime: pair coastal LTE (low latency near shore) with VSAT backup (wide coverage).")
    if "cost" in lowered:
        recommendations.append("Use the lowest_cost or balanced policy to compare synthetic USD/GB tradeoffs.")
    return {
        "weaknesses": weaknesses,
        "recommendations": recommendations,
        "proposal": "No automatic topology changes applied; use Architecture Studio to edit.",
    }


def _architect_ai(prompt: str, context: dict) -> tuple[dict | None, str]:
    catalog = _catalog_summary()
    schema_hint = {
        "nodes": [{"id": "ship-1", "type": "ship", "label": "Vessel",
                   "device_id": "gen-ship-comms-01",
                   "supported_technologies": ["Cellular (LTE)", "VSAT (GEO)"],
                   "world_position": {"x_km": 5, "y_km": 0, "altitude_m": 0}}],
        "links": [{"id": "link-1", "source": "ship-1", "target": "base-1",
                   "technology": "Cellular (LTE)", "medium": "wireless",
                   "latency_ms": 35, "bandwidth_mbps": 50, "reliability": 0.92,
                   "cost_per_gb": 0.5, "max_range_km": 25, "status": "active"}],
        "explanation": "why this design fits the requirements",
        "limitations": ["declared limits of the proposal"],
        "devices_used": ["gen-ship-comms-01"],
    }
    out = providers.chat_json([
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": (
            f"Network requirement: {prompt}\n\n"
            f"Available device catalog (use device_id values verbatim):\n{json.dumps(catalog)}\n\n"
            "Propose a topology as JSON with exactly these keys: nodes, links, "
            "explanation, limitations, devices_used. Node types: ship, car, aircraft, "
            "train, base_station, satellite, gateway, router, switch, internet, sensor, "
            "server. Every mobile endpoint needs two access technologies where the "
            "requirement implies failover. Use only catalog device_id values or null. "
            f"Shape example: {json.dumps(schema_hint)}"
        )},
    ],
        max_tokens=8000)
    if not out.get("ok"):
        return None, f"provider_error: {out.get('error')}"
    data = out.get("data") or {}
    try:
        topo = Topology.model_validate({
            "metadata": {"name": "AI proposal", "description": prompt[:300],
                         "synthetic": True, "version": 1,
                         "environment": context.get("environment", "generic")},
            "nodes": data.get("nodes", []),
            "links": data.get("links", []),
        })
    except Exception as exc:
        return None, f"proposal_schema_invalid: {str(exc)[:300]}"
    validation_result = validation.validate_topology(topo)
    if not validation_result["valid"]:
        return None, "proposal_topology_invalid: " + "; ".join(
            i["message"] for i in validation_result["issues"] if i["severity"] == "error"
        )[:400]
    return {
        "proposal_topology": topo.model_dump(mode="json"),
        "validation": validation_result,
        "explanation": str(data.get("explanation", ""))[:2000],
        "limitations": [str(x)[:300] for x in (data.get("limitations") or [])][:8],
        "devices_used": [str(x) for x in (data.get("devices_used") or [])][:12],
    }, "ok"


def _hardware_local(prompt: str, context: dict) -> dict:
    lowered = prompt.lower()
    matches = hardware.list_devices(search=prompt if len(prompt) < 40 else None)
    recommended = [d.device_id for d in matches[:5]]
    concept = None
    if ("lte" in lowered and "satellite" in lowered) or "gateway" in lowered:
        concept = DeviceSpec(
            device_id="ai-concept-lte-sat-gw-01",
            name="AI Concept: LTE/Satellite Mobile Gateway (proposal)",
            category="gateway",
            family="networking",
            model_identifier="AI-CONCEPT-1",
            description="Proposed dual-uplink gateway: LTE modem + satellite terminal with routing and failover control. UNVALIDATED PROPOSAL.",
            interfaces=[
                {"name": "cellular", "technology": "Cellular (LTE)", "max_throughput_mbps": 150},
                {"name": "sat", "technology": "VSAT (GEO)", "max_throughput_mbps": 50},
                {"name": "lan", "technology": "Ethernet", "max_throughput_mbps": 1000},
            ],
            protocols=["IPv4", "IPv6", "IPsec"],
            origin="ai_proposal",
        ).model_dump(mode="json")
        feasibility = hardware.feasibility_check(DeviceSpec.model_validate(concept))
    else:
        feasibility = {"verdict": "needs_review", "issues": [], "warnings": [], "note": "No concrete concept generated; describe interfaces to get a proposal."}
    return {
        "recommended_devices": recommended,
        "concept": concept,
        "feasibility": feasibility,
        "note": "Concepts are unvalidated proposals until reviewed in Hardware Engineering.",
    }


def _hardware_ai(prompt: str, context: dict) -> tuple[dict | None, str]:
    catalog_ids = [d.device_id for d in hardware.list_devices()]
    out = providers.chat_json([
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": (
            f"Hardware requirement: {prompt}\n\n"
            f"Known catalog device ids (for reference only): {', '.join(catalog_ids[:30])}\n\n"
            "Propose ONE device as JSON with keys: device (object with device_id starting "
            "'ai-concept-', name, category, family, model_identifier, description, "
            "interfaces [{name, technology, connector?, max_throughput_mbps?}], protocols[], "
            "frequency_bands[], throughput_mbps?, latency_ms_typical?, tx_power_dbm?, "
            "rx_sensitivity_dbm?, range_km?, antenna?, power_watts?, cost_usd_approx?, "
            "mobility?, environment?, limitations[]), assumptions[], feasibility_notes. "
            "LTE radio and satellite in one device REQUIRE gateway functionality "
            "(transceivers, protocol termination, routing) — never a passive adapter."
        )},
    ],
        max_tokens=8000)
    if not out.get("ok"):
        return None, f"provider_error: {out.get('error')}"
    data = out.get("data") or {}
    try:
        spec = DeviceSpec.model_validate({**(data.get("device") or {}), "origin": "ai_proposal"})
    except Exception as exc:
        return None, f"proposal_schema_invalid: {str(exc)[:300]}"
    feasibility = hardware.feasibility_check(spec)
    return {
        "concept": spec.model_dump(mode="json"),
        "feasibility": feasibility,
        "assumptions": [str(x)[:300] for x in (data.get("assumptions") or [])][:8],
        "feasibility_notes": str(data.get("feasibility_notes", ""))[:1000],
        "note": "UNVALIDATED PROPOSAL: specification-level only, not hardware verification.",
    }, "ok"


def _research_local(prompt: str, context: dict) -> dict:
    return {
        "guidance": "Submit the finding in the Research Lab for a stored deterministic assessment with experiments.",
        "checks": [
            "Are claims falsifiable with numeric thresholds?",
            "Are measurements separated from assumptions?",
            "Is required evidence (spectrum, link budget, testbed) identified?",
        ],
        "prompt_echo": prompt[:500],
    }


def _research_ai(prompt: str, context: dict) -> tuple[dict | None, str]:
    finding = context.get("finding") or {}
    text = "\n".join(f"{k}: {finding.get(k, '')}" for k in
                     ("title", "category", "problem", "assumptions", "measurements",
                      "references", "use_cases", "impact", "confidence", "limitations"))
    deterministic = research.scan_text(text)
    out = providers.chat_json([
        {"role": "system", "content": SYSTEM + " You review engineering claims skeptically."},
        {"role": "user", "content": (
            f"Finding under review:\n{text[:3000]}\n\n"
            f"Deterministic pre-scan flags: {json.dumps(deterministic)}\n\n"
            "Return JSON with keys: claims_analysis [{claim, status (supported|unsupported|contradicted|untestable), reason}], "
            "evidence_vs_speculation {evidence[], speculation[]}, verdict "
            "(plausible|needs_experiments|unsupported|contradicted), experiments[], "
            "caveats[]. Ground every judgment in established networking/physics; "
            "state explicitly that no experimental validation is claimed."
        )},
    ],
        max_tokens=6000)
    if not out.get("ok"):
        return None, f"provider_error: {out.get('error')}"
    data = out.get("data") or {}
    verdict = str(data.get("verdict", "needs_experiments"))
    if verdict not in research.VERDICTS:
        return None, f"proposal_schema_invalid: unknown verdict {verdict!r}"
    return {
        "claims_analysis": data.get("claims_analysis", []),
        "evidence_vs_speculation": data.get("evidence_vs_speculation", {}),
        "verdict": verdict,
        "experiments": data.get("experiments", []),
        "caveats": data.get("caveats", []),
        "deterministic_flags": deterministic,
        "disclaimer": "Model review is a second opinion, not experimental validation.",
    }, "ok"


def _connectivity_local(prompt: str, context: dict) -> dict:
    routes = context.get("routes") or []
    policy = context.get("policy", routing.POLICY_LOWEST_LATENCY)
    parsed = [
        routing.Route(
            node_ids=tuple(r.get("node_ids", ())),
            link_ids=tuple(r.get("link_ids", ())),
            latency_ms=float(r.get("latency_ms", 0.0)),
            bandwidth_mbps=float(r.get("bandwidth_mbps", 0.0)),
            reliability=float(r.get("reliability", 0.0)),
            cost_per_gb=float(r.get("cost_per_gb", 0.0)),
        )
        for r in routes
    ]
    selected = routing.select_route(parsed, policy, context.get("weights")) if parsed else None
    explanation = routing.explain_selection(parsed, selected, policy, context.get("weights")) if parsed else "No candidate routes provided."
    return {
        "policy": policy,
        "selected_link_ids": list(selected.link_ids) if selected else [],
        "explanation": explanation,
        "note": "Deterministic engine result; AI advisory (if any) is explanatory only.",
    }


def _connectivity_ai(prompt: str, context: dict) -> tuple[dict | None, str]:
    out = providers.chat_json([
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": (
            f"Connectivity requirement: {prompt}\n\n"
            "Return JSON with keys: recommended_policy (one of lowest_latency, "
            "highest_bandwidth, highest_reliability, lowest_cost, balanced), "
            "weights {latency, bandwidth, reliability, cost} (used only for balanced), "
            "rationale, tradeoffs[]. Do not select routes yourself; the deterministic "
            "engine computes eligibility and performance."
        )},
    ],
        max_tokens=4000)
    if not out.get("ok"):
        return None, f"provider_error: {out.get('error')}"
    data = out.get("data") or {}
    policy = str(data.get("recommended_policy", ""))
    if policy not in routing.POLICIES:
        return None, f"proposal_schema_invalid: unknown policy {policy!r}"
    return {
        "recommended_policy": policy,
        "weights": data.get("weights", {}),
        "rationale": str(data.get("rationale", ""))[:1500],
        "tradeoffs": data.get("tradeoffs", []),
        "note": "Recommendation only; the routing engine calculates actual routes.",
    }, "ok"


def _simulation_local(prompt: str, context: dict) -> dict:
    events = context.get("events") or []
    types: dict[str, int] = {}
    for e in events:
        t = e.get("type", "unknown")
        types[t] = types.get(t, 0) + 1
    findings: list[str] = []
    if types.get("connectivity_lost"):
        findings.append(f"Connectivity was lost {types['connectivity_lost']} time(s); check backup path coverage.")
    if types.get("failover"):
        findings.append(f"{types['failover']} failover(s) observed; review handover reasons in Analysis.")
    if not findings:
        findings.append("No failures in the provided event window.")
    return {"event_counts": types, "findings": findings}


def _simulation_ai(prompt: str, context: dict) -> tuple[dict | None, str]:
    events = (context.get("events") or [])[-40:]
    analysis = {k: context.get("analysis", {}).get(k) for k in
                ("policy", "availability", "handover_history", "event_counts")}
    out = providers.chat_json([
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": (
            f"Operator question: {prompt}\n\n"
            f"Events (most recent last): {json.dumps(events)[:4000]}\n"
            f"Run summary: {json.dumps(analysis)[:2000]}\n\n"
            "Return JSON with keys: transitions_explained [{event, explanation}], "
            "bottlenecks[], improvements[], summary. Base every claim on the "
            "provided events; do not invent measurements."
        )},
    ],
        max_tokens=6000)
    if not out.get("ok"):
        return None, f"provider_error: {out.get('error')}"
    data = out.get("data") or {}
    return {
        "transitions_explained": data.get("transitions_explained", []),
        "bottlenecks": data.get("bottlenecks", []),
        "improvements": data.get("improvements", []),
        "summary": str(data.get("summary", ""))[:1500],
    }, "ok"


LOCAL = {
    "architect": _architect_local,
    "hardware": _hardware_local,
    "research": _research_local,
    "connectivity": _connectivity_local,
    "simulation": _simulation_local,
}

AI = {
    "architect": _architect_ai,
    "hardware": _hardware_ai,
    "research": _research_ai,
    "connectivity": _connectivity_ai,
    "simulation": _simulation_ai,
}


def run_agent(request: AgentRequest) -> AgentResponse:
    if request.capability not in LOCAL:
        raise ValueError(f"Unknown capability {request.capability!r}; expected one of {list(CAPABILITIES)}")
    local_result = LOCAL[request.capability](request.prompt, request.context)
    status = providers.provider_status()
    model = status.get("model", "")
    if not request.use_ai:
        return AgentResponse(
            capability=request.capability, provenance="local_deterministic",
            model="", ai_status="not_attempted",
            result={"local": local_result, "ai": None}, advisory_note="",
        )
    if status["state"] != "configured":
        return AgentResponse(
            capability=request.capability, provenance="local_deterministic",
            model=model, ai_status=f"unavailable: {status['state']}",
            result={"local": local_result, "ai": None}, advisory_note="",
        )
    ai_result, ai_status = AI[request.capability](request.prompt, request.context)
    provenance = "ai_verified" if ai_result is not None else "local_deterministic"
    return AgentResponse(
        capability=request.capability, provenance=provenance, model=model,
        ai_status=ai_status,
        result={"local": local_result, "ai": ai_result}, advisory_note="",
    )
