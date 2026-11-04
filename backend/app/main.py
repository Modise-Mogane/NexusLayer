"""NexusLayer Simulation API - FastAPI application."""

import os
import logging

from contextlib import asynccontextmanager

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import agents, chat, compatibility, coverage, hardware, jobs, knowledge, messaging, phy, physics_lab, providers, region, research, routing, scenarios, sources, validation
from .database import init_db
from .hardware import DeviceSpec
from .models import (
    EventsResponse,
    LinkActionRequest,
    LinkSecurityConfig,
    NodePortConfig,
    PolicyRequest,
    SimulationState,
    StepRequest,
    Topology,
    TopologyLink,
    TopologyNode,
    WorldPosition,
)
from .scenarios import ScenarioDetail, ScenarioSummary
from .simulation import UnknownLinkError, drop_session, get_session
from .topology import load_topology

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.ready = False
    app.state.degraded = []
    try:
        init_db()
        scenarios.ensure_maritime_seed()
        scenarios.ensure_vehicle_seed()
        scenarios.ensure_world_seed()
    except Exception:
        logger.exception("Required initialization failed")
        raise
    for name, initialize in (("sources", sources.ensure_registry),
                             ("coverage", coverage.ensure_regions),
                             ("jobs", jobs.ensure_default_jobs),
                             ("scheduler", jobs.start_scheduler)):
        try:
            initialize()
        except Exception:
            logger.exception("Optional initialization failed: %s", name)
            app.state.degraded.append(name)
    app.state.ready = True
    try:
        yield
    finally:
        app.state.ready = False
        jobs.stop_scheduler()


app = FastAPI(title="NexusLayer Simulation API", lifespan=lifespan)

cors_origins = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/ready")
def readiness():
    if not getattr(app.state, "ready", False):
        raise HTTPException(status_code=503, detail="Application is not ready")
    return {"status": "degraded" if app.state.degraded else "ready", "degraded": app.state.degraded}


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "NexusLayer Simulation API"}


@app.get("/api/topology", response_model=Topology)
def get_topology() -> Topology:
    try:
        return load_topology()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=500, detail="Default scenario file not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=500, detail=f"Invalid scenario file: {exc}") from exc


def _session(scenario_id: str | None):
    try:
        return get_session(scenario_id or "maritime_failover")
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/api/simulation/state", response_model=SimulationState)
def simulation_state(scenario_id: str | None = None) -> SimulationState:
    return _session(scenario_id).get_state()


@app.post("/api/simulation/start", response_model=SimulationState)
def simulation_start(scenario_id: str | None = None) -> SimulationState:
    session = _session(scenario_id)
    session.start()
    return session.get_state()


@app.post("/api/simulation/pause", response_model=SimulationState)
def simulation_pause(scenario_id: str | None = None) -> SimulationState:
    session = _session(scenario_id)
    session.pause()
    return session.get_state()


@app.post("/api/simulation/reset", response_model=SimulationState)
def simulation_reset(scenario_id: str | None = None) -> SimulationState:
    session = _session(scenario_id)
    session.reset()
    return session.get_state()


@app.post("/api/simulation/fail-link", response_model=SimulationState)
def simulation_fail_link(body: LinkActionRequest, scenario_id: str | None = None) -> SimulationState:
    session = _session(scenario_id)
    try:
        session.fail_link(body.link_id)
    except UnknownLinkError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return session.get_state()


@app.post("/api/simulation/restore-link", response_model=SimulationState)
def simulation_restore_link(body: LinkActionRequest, scenario_id: str | None = None) -> SimulationState:
    session = _session(scenario_id)
    try:
        session.restore_link(body.link_id)
    except UnknownLinkError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return session.get_state()


@app.post("/api/simulation/step", response_model=SimulationState)
def simulation_step(body: StepRequest, scenario_id: str | None = None) -> SimulationState:
    session = _session(scenario_id)
    session.step(ticks=body.ticks, dt_seconds=body.dt_seconds)
    return session.get_state()


@app.post("/api/simulation/policy", response_model=SimulationState)
def simulation_policy(body: PolicyRequest, scenario_id: str | None = None) -> SimulationState:
    if body.policy not in routing.POLICIES:
        raise HTTPException(status_code=400, detail=f"Unknown policy {body.policy!r}")
    session = _session(scenario_id)
    session.set_policy(body.policy, body.weights)
    return session.get_state()


class CourseRequest(BaseModel):
    node_id: str = Field(min_length=1)
    velocity_x_kmh: float = 0.0
    velocity_y_kmh: float = 0.0


@app.post("/api/simulation/course", response_model=SimulationState)
def simulation_course(body: CourseRequest, scenario_id: str | None = None) -> SimulationState:
    session = _session(scenario_id)
    try:
        session.set_course(body.node_id, body.velocity_x_kmh, body.velocity_y_kmh)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return session.get_state()


class LinkParamsRequest(BaseModel):
    link_id: str = Field(min_length=1)
    cost_per_gb: float | None = None
    latency_ms: float | None = None
    bandwidth_mbps: float | None = None
    reliability: float | None = None
    max_range_km: float | None = None
    clear_max_range: bool = False
    rf: dict | None = None
    clear_rf: bool = False


@app.post("/api/simulation/link-params", response_model=SimulationState)
def simulation_link_params(body: LinkParamsRequest, scenario_id: str | None = None) -> SimulationState:
    session = _session(scenario_id)
    updates: dict = {}
    for field in ("cost_per_gb", "latency_ms", "bandwidth_mbps", "reliability"):
        value = getattr(body, field)
        if value is not None:
            updates[field] = value
    if body.max_range_km is not None:
        updates["max_range_km"] = body.max_range_km
    elif body.clear_max_range:
        updates["max_range_km"] = None
    if body.rf is not None:
        updates["rf"] = body.rf
    elif body.clear_rf:
        updates["rf"] = None
    try:
        session.update_link_params(body.link_id, updates)
    except UnknownLinkError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return session.get_state()


class NodePositionRequest(BaseModel):
    node_id: str = Field(min_length=1)
    x_km: float
    y_km: float
    altitude_m: float | None = None


@app.post("/api/simulation/node-position", response_model=SimulationState)
def simulation_node_position(body: NodePositionRequest, scenario_id: str | None = None) -> SimulationState:
    session = _session(scenario_id)
    try:
        session.set_node_position(body.node_id, body.x_km, body.y_km, body.altitude_m)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return session.get_state()


class TrafficRequest(BaseModel):
    node_id: str = Field(min_length=1)
    profile: str = Field(min_length=1)


@app.post("/api/simulation/traffic", response_model=SimulationState)
def simulation_traffic(body: TrafficRequest, scenario_id: str | None = None) -> SimulationState:
    session = _session(scenario_id)
    try:
        session.set_endpoint_traffic(body.node_id, body.profile)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return session.get_state()


@app.get("/api/simulation/traffic-profiles")
def traffic_profiles() -> dict:
    from .traffic import TRAFFIC_PROFILES

    return {
        "default": "browsing",
        "profiles": [
            {
                "id": p.id, "label": p.label, "required_mbps": p.required_mbps,
                "max_latency_ms": p.max_latency_ms, "description": p.description,
            }
            for p in TRAFFIC_PROFILES.values()
        ],
    }


@app.get("/api/rf/presets")
def rf_presets() -> dict:
    from . import rf as rf_models

    return {
        "presets": {
            name: {
                "frequency_mhz": p.frequency_mhz,
                "tx_power_dbm": p.tx_power_dbm,
                "tx_gain_dbi": p.tx_gain_dbi,
                "rx_gain_dbi": p.rx_gain_dbi,
                "rx_sensitivity_dbm": p.rx_sensitivity_dbm,
                "extra_loss_db": p.extra_loss_db,
                "required_margin_db": p.required_margin_db,
                "hysteresis_db": p.hysteresis_db,
                "label": p.label,
            }
            for name, p in rf_models.TECH_PRESETS.items()
        },
        "formulas": [
            "FSPL(dB) = 20*log10(d_km) + 20*log10(f_MHz) + 32.44",
            "RX(dBm) = TX + Gtx + Grx - FSPL - extra_losses",
            "margin = RX - sensitivity; suitable when margin >= required_margin",
            "re-qualify after outage needs margin >= required + hysteresis",
        ],
        "note": "Simplified illustrative planning model; not high-fidelity simulation.",
    }


@app.get("/api/simulation/events", response_model=EventsResponse)
def simulation_events(scenario_id: str | None = None) -> EventsResponse:
    return EventsResponse(events=_session(scenario_id).get_events())


@app.get("/api/simulation/report")
def simulation_report(scenario_id: str | None = None) -> dict:
    from .report import build_report

    return build_report(_session(scenario_id))


@app.get("/api/simulation/analysis")
def simulation_analysis(scenario_id: str | None = None) -> dict:
    return _session(scenario_id).get_analysis()


@app.get("/api/policies")
def list_policies() -> dict:
    return {"policies": list(routing.POLICIES), "default_weights": routing.DEFAULT_BALANCED_WEIGHTS}


# -- scenarios -----------------------------------------------------------


class ScenarioSaveRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    environment: str = "generic"
    topology: Topology
    expected_version: int | None = Field(default=None, ge=1)


class ScenarioDuplicateRequest(BaseModel):
    name: str | None = None


@app.get("/api/world")
def world_meta() -> dict:
    """Unified persistent world: frame, units, and satellite honesty note."""
    return {"meta": region.WORLD_META}


@app.get("/api/world/regions")
def world_regions() -> dict:
    """Named regions of the persistent demonstration world."""
    return {"regions": region.list_regions()}


@app.get("/api/world/focus")
def world_focus(scenario_id: str | None = None) -> dict:
    """Camera focus + activity description for a scenario on the shared world."""
    return region.focus_for_scenario(scenario_id or "")


@app.get("/api/scenarios", response_model=list[ScenarioSummary])
def list_scenarios() -> list[ScenarioSummary]:
    scenarios.ensure_maritime_seed()
    scenarios.ensure_vehicle_seed()
    scenarios.ensure_world_seed()
    return scenarios.list_scenarios()


@app.post("/api/scenarios", response_model=ScenarioDetail)
def create_scenario(body: ScenarioSaveRequest) -> ScenarioDetail:
    try:
        return scenarios.save_scenario(body.name, body.environment, body.topology)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/scenarios/templates")
def scenario_templates() -> dict:
    return {"templates": ["maritime", "urban_vehicle", "aviation", "railway", "rural", "hybrid", "shared_world"]}


@app.get("/api/scenarios/{sid}", response_model=ScenarioDetail)
def get_scenario(sid: str) -> ScenarioDetail:
    detail = scenarios.get_scenario(sid)
    if detail is None:
        if sid == "maritime_failover":
            detail = scenarios.ensure_maritime_seed()
        if detail is None:
            raise HTTPException(status_code=404, detail=f"Unknown scenario {sid!r}")
    return detail


@app.put("/api/scenarios/{sid}", response_model=ScenarioDetail)
def update_scenario(sid: str, body: ScenarioSaveRequest) -> ScenarioDetail:
    try:
        detail = scenarios.save_scenario(body.name, body.environment, body.topology, sid=sid, expected_version=body.expected_version)
    except scenarios.ScenarioConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    drop_session(sid)
    return detail


class NodePatchRequest(BaseModel):
    label: str | None = None
    type: str | None = None
    device_id: str | None = None
    supported_technologies: list[str] | None = None
    properties: dict | None = None
    ports: list[NodePortConfig] | None = None
    world_position: WorldPosition | None = None


class LinkPatchRequest(BaseModel):
    label: str | None = None
    latency_ms: float | None = None
    bandwidth_mbps: float | None = None
    reliability: float | None = None
    cost_per_gb: float | None = None
    status: str | None = None
    technology: str | None = None
    medium: str | None = None
    max_range_km: float | None = None
    source_port: str | None = None
    target_port: str | None = None
    protocols: list[str] | None = None
    security: LinkSecurityConfig | None = None
    experimental: bool | None = None


def _patch_topology_node(topology: Topology, nid: str, patch: NodePatchRequest) -> Topology:
    node = next((n for n in topology.nodes if n.id == nid), None)
    if node is None:
        raise KeyError(f"Unknown node {nid!r}")
    data = node.model_dump()
    updates = patch.model_dump(exclude_unset=True)
    if "ports" in updates and updates["ports"] is not None:
        names = [p["name"] for p in updates["ports"]]
        if len(names) != len(set(names)):
            raise ValueError("Port names must be unique within a node")
    data.update({k: v for k, v in updates.items()})
    TopologyNode.model_validate(data)
    nodes = [TopologyNode.model_validate(data) if n.id == nid else n for n in topology.nodes]
    return Topology(metadata=topology.metadata, nodes=nodes, links=topology.links)


def _patch_topology_link(topology: Topology, lid: str, patch: LinkPatchRequest) -> Topology:
    link = next((l for l in topology.links if l.id == lid), None)
    if link is None:
        raise KeyError(f"Unknown link {lid!r}")
    data = link.model_dump()
    data.update({k: v for k, v in patch.model_dump(exclude_unset=True).items()})
    TopologyLink.model_validate(data)
    links = [TopologyLink.model_validate(data) if l.id == lid else l for l in topology.links]
    return Topology(metadata=topology.metadata, nodes=topology.nodes, links=links)


def _save_patched(detail: ScenarioDetail, topology: Topology, sid: str) -> ScenarioDetail:
    # The maritime seed is the regression baseline: patching it forks a copy.
    if sid == "maritime_failover":
        saved = scenarios.save_scenario(f"{detail.name} (edited)", detail.environment, topology)
        drop_session(saved.id)
        return saved
    saved = scenarios.save_scenario(detail.name, detail.environment, topology, sid=sid, expected_version=detail.version)
    drop_session(sid)
    return saved


@app.patch("/api/scenarios/{sid}/nodes/{nid}", response_model=ScenarioDetail)
def patch_scenario_node(sid: str, nid: str, body: NodePatchRequest) -> ScenarioDetail:
    detail = scenarios.get_scenario(sid)
    if detail is None:
        raise HTTPException(status_code=404, detail=f"Unknown scenario {sid!r}")
    try:
        topology = _patch_topology_node(detail.topology, nid, body)
        return _save_patched(detail, topology, sid)
    except scenarios.ScenarioConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.patch("/api/scenarios/{sid}/links/{lid}", response_model=ScenarioDetail)
def patch_scenario_link(sid: str, lid: str, body: LinkPatchRequest) -> ScenarioDetail:
    detail = scenarios.get_scenario(sid)
    if detail is None:
        raise HTTPException(status_code=404, detail=f"Unknown scenario {sid!r}")
    try:
        topology = _patch_topology_link(detail.topology, lid, body)
        return _save_patched(detail, topology, sid)
    except scenarios.ScenarioConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


class PortCheckRequest(BaseModel):
    source_port: NodePortConfig | None = None
    target_port: NodePortConfig | None = None
    experimental: bool = False


@app.post("/api/compatibility/check-ports")
def check_ports(body: PortCheckRequest) -> dict:
    result = compatibility.check_port_pair(
        body.source_port.model_dump() if body.source_port else None,
        body.target_port.model_dump() if body.target_port else None,
        body.experimental,
    )
    return {"compatible": result.compatible, "reason": result.reason}


@app.get("/api/scenarios/{sid}/links/{lid}/physics")
def link_physics(sid: str, lid: str, live: bool = True) -> dict:
    detail = scenarios.get_scenario(sid)
    if detail is None:
        raise HTTPException(status_code=404, detail=f"Unknown scenario {sid!r}")
    live_state: dict | None = None
    if live:
        try:
            session = get_session(sid)
            state = session.get_state()
            match = next((l for l in state.links if l.id == lid), None)
            if match is not None:
                live_state = {
                    "status": match.status,
                    "suitable": match.suitable,
                    "suitability_reason": match.suitability_reason,
                    "signal_quality": match.signal_quality,
                    "rx_dbm": match.rx_dbm,
                    "margin_db": match.margin_db,
                    "on_active_route": match.on_active_route,
                    "on_backup_route": match.on_backup_route,
                }
        except (KeyError, ValueError):
            live_state = None
    try:
        return phy.explain_link(detail.topology, lid, live_state)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


# -- physics lab (Level-2 engineering calculations) ------------------------------

@app.post("/api/physics/copper", response_model=physics_lab.LabResult)
def physics_copper(body: physics_lab.CopperParams) -> physics_lab.LabResult:
    return physics_lab.copper_link(body)


@app.post("/api/physics/optical", response_model=physics_lab.LabResult)
def physics_optical(body: physics_lab.OpticalParams) -> physics_lab.LabResult:
    return physics_lab.optical_source(body)


@app.post("/api/physics/fiber", response_model=physics_lab.LabResult)
def physics_fiber(body: physics_lab.FiberParams) -> physics_lab.LabResult:
    return physics_lab.fiber_link(body)


@app.post("/api/physics/radio", response_model=physics_lab.LabResult)
def physics_radio(body: physics_lab.RadioParams) -> physics_lab.LabResult:
    return physics_lab.radio_link(body)


@app.post("/api/physics/satellite", response_model=physics_lab.LabResult)
def physics_satellite(body: physics_lab.SatelliteParams) -> physics_lab.LabResult:
    return physics_lab.satellite_link(body)


@app.post("/api/physics/quantum/teleport", response_model=physics_lab.LabResult)
def physics_teleport(body: physics_lab.TeleportParams) -> physics_lab.LabResult:
    return physics_lab.quantum_teleport(body)


@app.post("/api/physics/quantum/bb84", response_model=physics_lab.LabResult)
def physics_bb84(body: physics_lab.Bb84Params) -> physics_lab.LabResult:
    return physics_lab.bb84_demo(body)


# -- inter-device messaging ------------------------------------------------------

@app.post("/api/messages/send", response_model=messaging.MessageRecord)
def send_message(body: messaging.MessageSendRequest) -> messaging.MessageRecord:
    try:
        return messaging.send_message(body)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/messages")
def list_messages(scenario_id: str = "maritime_failover") -> dict:
    try:
        return {"messages": messaging.list_messages(scenario_id)}
    except (KeyError, ValueError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/scenarios/{sid}/duplicate", response_model=ScenarioDetail)
def duplicate_scenario(sid: str, body: ScenarioDuplicateRequest | None = None) -> ScenarioDetail:
    try:
        return scenarios.duplicate_scenario(sid, (body.name if body else None))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.delete("/api/scenarios/{sid}")
def delete_scenario(sid: str) -> dict:
    if sid == "maritime_failover":
        raise HTTPException(status_code=400, detail="The maritime regression scenario cannot be deleted")
    drop_session(sid)
    if not scenarios.delete_scenario(sid):
        raise HTTPException(status_code=404, detail=f"Unknown scenario {sid!r}")
    return {"deleted": sid}


@app.post("/api/scenarios/from-template/{kind}", response_model=ScenarioDetail)
def scenario_from_template(kind: str) -> ScenarioDetail:
    try:
        topo = scenarios.template_topology(kind)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return scenarios.save_scenario(topo.metadata.name, topo.metadata.environment or "generic", topo)


# -- hardware -------------------------------------------------------------


@app.get("/api/hardware", response_model=list[DeviceSpec])
def list_hardware(category: str | None = None, search: str | None = None) -> list[DeviceSpec]:
    return hardware.list_devices(category=category, search=search)


@app.get("/api/hardware/categories")
def hardware_categories() -> dict:
    cats = sorted({d.category for d in hardware.list_devices()})
    return {"categories": cats}


@app.get("/api/hardware/{device_id}", response_model=DeviceSpec)
def get_hardware(device_id: str) -> DeviceSpec:
    device = hardware.get_device(device_id)
    if device is None:
        raise HTTPException(status_code=404, detail=f"Unknown device {device_id!r}")
    return device


@app.post("/api/hardware", response_model=DeviceSpec)
def create_hardware(body: DeviceSpec) -> DeviceSpec:
    return hardware.save_device(body, origin="custom" if body.origin == "library" else body.origin)


@app.post("/api/hardware/check")
def check_hardware(body: DeviceSpec) -> dict:
    return hardware.feasibility_check(body)


# -- research --------------------------------------------------------------


@app.post("/api/research", response_model=research.ResearchFinding)
def submit_research(body: research.ResearchSubmission) -> research.ResearchFinding:
    try:
        return research.submit_finding(body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/research", response_model=list[research.ResearchFinding])
def list_research() -> list[research.ResearchFinding]:
    return research.list_findings()


@app.get("/api/research/{fid}", response_model=research.ResearchFinding)
def get_research(fid: str) -> research.ResearchFinding:
    finding = research.get_finding(fid)
    if finding is None:
        raise HTTPException(status_code=404, detail=f"Unknown finding {fid!r}")
    return finding


class ReviewRequest(BaseModel):
    status: str = Field(description="approved, rejected, or revised")


@app.post("/api/research/{fid}/assess", response_model=research.Assessment)
def assess_research(fid: str) -> research.Assessment:
    finding = research.get_finding(fid)
    if finding is None:
        raise HTTPException(status_code=404, detail=f"Unknown finding {fid!r}")
    submission = research.ResearchSubmission(**finding.model_dump())
    return research.assess_finding(fid, submission)


@app.get("/api/research/{fid}/assessments", response_model=list[research.Assessment])
def finding_assessments(fid: str) -> list[research.Assessment]:
    if research.get_finding(fid) is None:
        raise HTTPException(status_code=404, detail=f"Unknown finding {fid!r}")
    return research.list_assessments(fid)


@app.post("/api/research/{fid}/review", response_model=research.ResearchFinding)
def review_research(fid: str, body: ReviewRequest) -> research.ResearchFinding:
    try:
        finding = research.set_finding_status(fid, body.status)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if finding is None:
        raise HTTPException(status_code=404, detail=f"Unknown finding {fid!r}")
    return finding


# -- agents / AI ------------------------------------------------------------


@app.get("/api/agents/status")
def agent_status() -> dict:
    status = providers.provider_status()
    return {"capabilities": list(agents.CAPABILITIES), **status}


@app.post("/api/agents/run", response_model=agents.AgentResponse)
def run_agent(body: agents.AgentRequest) -> agents.AgentResponse:
    try:
        return agents.run_agent(body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/agents/verify")
def verify_agents() -> dict:
    """Live provider ping. Returns verification status, never credentials."""
    status = providers.provider_status()
    if status["state"] != "configured":
        return {"verified": False, "error": "provider_not_configured", **status}
    return {"provider": status, **providers.verify()}


@app.post("/api/agents/verify/{provider}")
def verify_provider(provider: str) -> dict:
    """Live ping of one named provider (meta|baseten); reports separately."""
    if provider not in ("meta", "baseten"):
        raise HTTPException(status_code=400, detail=f"Unknown provider {provider!r}")
    status = providers.provider_status()
    sub = (status.get("providers") or {}).get(provider, {})
    if sub.get("state") != "configured":
        return {"verified": False, "error": "provider_not_configured",
                "provider": provider, "model": sub.get("model", "")}
    return providers.verify(provider=provider)


@app.post("/api/research/{fid}/assess-ai", response_model=research.Assessment)
def assess_research_ai(fid: str) -> research.Assessment:
    """Model second opinion on a finding; 503 when no provider is available."""
    finding = research.get_finding(fid)
    if finding is None:
        raise HTTPException(status_code=404, detail=f"Unknown finding {fid!r}")
    response = agents.run_agent(
        agents.AgentRequest(
            capability="research",
            prompt=f"Review finding: {finding.title}",
            context={"finding": finding.model_dump(mode="json")},
            use_ai=True,
        )
    )
    ai_review = (response.result or {}).get("ai")
    if ai_review is None:
        raise HTTPException(status_code=503, detail=f"AI review unavailable: {response.ai_status}")
    return research.store_ai_assessment(fid, response.model, ai_review)


# -- conversational chat ------------------------------------------------------


class ChatSendRequest(BaseModel):
    conversation_id: str | None = None
    message: str = Field(min_length=1, max_length=4000)
    scenario_id: str = ""
    capability: str | None = None
    provider: str | None = None
    use_ai: bool = True
    # Allowlisted UI-selection keys (route/node/link/region/entity/experiment);
    # anything else is dropped by chat.sanitize_context.
    context: dict | None = None


@app.get("/api/chat")
def list_chats() -> dict:
    return {"conversations": chat.list_conversations()}


@app.get("/api/chat/{cid}")
def get_chat(cid: str) -> dict:
    convo = chat.get_conversation(cid)
    if convo is None:
        raise HTTPException(status_code=404, detail=f"Unknown conversation {cid!r}")
    return convo


@app.delete("/api/chat/{cid}")
def delete_chat(cid: str) -> dict:
    if not chat.delete_conversation(cid):
        raise HTTPException(status_code=404, detail=f"Unknown conversation {cid!r}")
    return {"deleted": cid}


@app.post("/api/chat")
def send_chat(body: ChatSendRequest) -> dict:
    if body.capability is not None and body.capability not in agents.CAPABILITIES:
        raise HTTPException(status_code=400, detail=f"Unknown capability {body.capability!r}")
    if body.provider is not None and body.provider not in ("meta", "baseten"):
        raise HTTPException(status_code=400, detail=f"Unknown provider {body.provider!r}")
    try:
        return chat.respond(body.conversation_id, body.message, body.scenario_id,
                            body.capability, body.provider, body.use_ai, body.context)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/chat/stream")
def stream_chat(body: ChatSendRequest):
    if body.capability is not None and body.capability not in agents.CAPABILITIES:
        raise HTTPException(status_code=400, detail=f"Unknown capability {body.capability!r}")
    if body.provider is not None and body.provider not in ("meta", "baseten"):
        raise HTTPException(status_code=400, detail=f"Unknown provider {body.provider!r}")
    try:
        ctx = chat.prepare_reply(body.conversation_id, body.message, body.scenario_id,
                                 body.capability, body.provider, body.use_ai, body.context)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    import json as json_module

    def event_stream():
        try:
            for chunk in chat.respond_stream(ctx, body.message, body.scenario_id):
                yield f"event: {chunk['event']}\ndata: {json_module.dumps(chunk['data'])}\n\n"
        except Exception as exc:
            yield f"event: error\ndata: {json_module.dumps({'error': type(exc).__name__})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


class ChatNoteRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


@app.post("/api/chat/{cid}/notes")
def add_chat_note(cid: str, body: ChatNoteRequest) -> dict:
    if chat.get_conversation(cid) is None:
        raise HTTPException(status_code=404, detail=f"Unknown conversation {cid!r}")
    return chat.record_note(cid, body.text)


# -- knowledge base ----------------------------------------------------------


@app.post("/api/knowledge/upload")
async def upload_document(file: UploadFile = File(...), title: str | None = None) -> dict:
    raw = await file.read(knowledge.MAX_UPLOAD_BYTES + 1)
    try:
        return knowledge.store_document(
            title or (file.filename or "upload"),
            file.filename or "upload",
            raw,
            source_type="upload",
            mime=file.content_type or "",
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/knowledge")
def list_knowledge(source_type: str | None = None) -> dict:
    return {"documents": knowledge.list_documents(source_type)}


@app.get("/api/knowledge/search")
def search_knowledge(q: str, limit: int = 6) -> dict:
    return {"query": q, "passages": knowledge.search(q, min(max(limit, 1), 20))}


@app.get("/api/knowledge/{doc_id}")
def get_knowledge_doc(doc_id: str) -> dict:
    doc = knowledge.get_document(doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail=f"Unknown document {doc_id!r}")
    return doc


@app.delete("/api/knowledge/{doc_id}")
def delete_knowledge_doc(doc_id: str) -> dict:
    if not knowledge.delete_document(doc_id):
        raise HTTPException(status_code=404, detail=f"Unknown document {doc_id!r}")
    return {"deleted": doc_id}


# -- knowledge sources -------------------------------------------------------


@app.get("/api/sources")
def list_knowledge_sources() -> dict:
    return {"sources": sources.list_sources()}


@app.get("/api/sources/{sid}")
def get_knowledge_source(sid: str) -> dict:
    src = sources.get_source(sid)
    if src is None:
        raise HTTPException(status_code=404, detail=f"Unknown source {sid!r}")
    return src


@app.post("/api/sources/{sid}/ingest")
def ingest_knowledge_source(sid: str) -> dict:
    try:
        import time

        time.sleep(sources.SYNC_DELAY_S)  # rate limit: one fetch per call + delay
        return sources.ingest_source(sid)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


class SourceEnableRequest(BaseModel):
    enabled: bool


@app.post("/api/sources/{sid}/enable")
def enable_knowledge_source(sid: str, body: SourceEnableRequest) -> dict:
    if not sources.set_source_enabled(sid, body.enabled):
        raise HTTPException(status_code=404, detail=f"Unknown source {sid!r}")
    updated = sources.get_source(sid)
    assert updated is not None
    return updated


# -- coverage research --------------------------------------------------------


@app.get("/api/coverage/regions")
def list_coverage_regions() -> dict:
    return {"regions": coverage.list_regions()}


@app.get("/api/coverage/regions/{rid}")
def get_coverage_region(rid: str) -> dict:
    region = coverage.get_region(rid)
    if region is None:
        raise HTTPException(status_code=404, detail=f"Unknown region {rid!r}")
    return region


class RegionSaveRequest(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    data: dict = Field(default_factory=dict)


@app.put("/api/coverage/regions/{rid}")
def save_coverage_region(rid: str, body: RegionSaveRequest) -> dict:
    return coverage.save_region(rid, body.name, body.data)


@app.post("/api/coverage/regions/{rid}/analyze")
def analyze_coverage_region(rid: str) -> dict:
    try:
        return coverage.analyze_region(rid)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/api/coverage/reports")
def list_coverage_reports(region_id: str | None = None) -> dict:
    return {"reports": coverage.list_reports(region_id)}


@app.post("/api/coverage/reports/{report_id}/proposals/{proposal_id}/scenario")
def coverage_proposal_scenario(report_id: str, proposal_id: str) -> dict:
    try:
        return coverage.proposal_to_scenario(report_id, proposal_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


# -- scheduled jobs -----------------------------------------------------------


@app.get("/api/jobs")
def list_scheduled_jobs() -> dict:
    return {"jobs": jobs.list_jobs()}


@app.get("/api/jobs/{jid}")
def get_scheduled_job(jid: str) -> dict:
    job = jobs.get_job(jid)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Unknown job {jid!r}")
    return job


class JobUpdateRequest(BaseModel):
    enabled: bool | None = None
    interval_seconds: int | None = None
    config: dict | None = None


@app.post("/api/jobs/{jid}")
def update_scheduled_job(jid: str, body: JobUpdateRequest) -> dict:
    try:
        job = jobs.update_job(jid, body.enabled, body.interval_seconds, body.config)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if job is None:
        raise HTTPException(status_code=404, detail=f"Unknown job {jid!r}")
    return job


@app.post("/api/jobs/{jid}/run")
def run_scheduled_job(jid: str) -> dict:
    try:
        return jobs.run_job(jid, trigger="manual")
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/jobs/{jid}/runs")
def list_job_runs(jid: str) -> dict:
    if jobs.get_job(jid) is None:
        raise HTTPException(status_code=404, detail=f"Unknown job {jid!r}")
    return {"runs": jobs.list_runs(jid)}


# -- validation --------------------------------------------------------------


@app.post("/api/architecture/validate")
def validate_architecture(body: Topology) -> dict:
    return validation.validate_topology(body)
