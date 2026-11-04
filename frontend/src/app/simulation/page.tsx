"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import WorkbenchShell from "@/components/workbench/WorkbenchShell";
import WorldScene, { MOBILE_TYPES, type MessageFlow, type ViewRequest } from "@/components/sim3d/WorldScene";
import FpsMeter from "@/components/sim3d/FpsMeter";
import { BUILDINGS } from "@/components/sim3d/environments";
import { OVERLAY_MODES, REGION_NAV, type OverlayMode } from "@/components/sim3d/coordinates";
import LinkInspector from "@/components/workbench/LinkInspector";
import DeviceArt from "@/components/devices/DeviceArt";
import DeviceIcon from "@/components/devices/DeviceIcon";
import { NxField, NxNumberInput, NxSelect } from "@/components/ui/controls";
import { useAssistant, useAssistantContext } from "@/components/assistant/AssistantProvider";
import {
  fetchMessages,
  fetchPolicies,
  fetchReport,
  fetchRfPresets,
  fetchScenario,
  fetchScenarios,
  fetchSimulationEvents,
  fetchSimulationState,
  fetchTrafficProfiles,
  fetchWorldFocus,
  fetchWorldMeta,
  fetchWorldRegions,
  patchScenarioLink,
  patchScenarioNode,
  pauseSimulation,
  resetSimulation,
  sendMessage,
  setCourse,
  setNodePosition,
  setPolicy,
  setTraffic,
  startSimulation,
  stepSimulation,
  updateLinkParams,
  type MessageRecord,
  type RfConfig,
  type ScenarioFocus,
  type ScenarioSummary,
  type SimulationEvent,
  type SimulationReport,
  type SimulationState,
  type Topology,
  type TrafficProfile,
  type WorldMeta,
  type WorldRegion,
} from "@/lib/api";

const SPEEDS = [
  { id: "1x", label: "1× (1 min/s)", dt: 60 },
  { id: "5x", label: "5× (5 min/s)", dt: 300 },
  { id: "20x", label: "20× (20 min/s)", dt: 1200 },
];

function SimulationPageInner() {
  const searchParams = useSearchParams();
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([]);
  const [scenarioId, setScenarioId] = useState("maritime_failover");
  const [environment, setEnvironment] = useState("maritime");
  const [topology, setTopology] = useState<Topology | null>(null);
  const [sim, setSim] = useState<SimulationState | null>(null);
  const [events, setEvents] = useState<SimulationEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(SPEEDS[1]);
  const [follow, setFollow] = useState(true);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null);
  const [selectedBuildingId, setSelectedBuildingId] = useState<string | null>(null);
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const [labelsOn, setLabelsOn] = useState(true);
  const [overlay, setOverlay] = useState<OverlayMode>("active");
  const [regions, setRegions] = useState<WorldRegion[]>([]);
  const [worldMeta, setWorldMeta] = useState<WorldMeta | null>(null);
  const [focus, setFocus] = useState<ScenarioFocus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Inter-device messaging (Stage C4).
  const [msgSource, setMsgSource] = useState("");
  const [msgDest, setMsgDest] = useState("");
  const [msgKind, setMsgKind] = useState("message");
  const [msgSizeKb, setMsgSizeKb] = useState<number | "">(5120);
  const [msgSending, setMsgSending] = useState(false);
  const [msgTrace, setMsgTrace] = useState<MessageRecord | null>(null);
  const [msgFlow, setMsgFlow] = useState<MessageFlow | null>(null);
  const [msgScale, setMsgScale] = useState(1);
  const [msgHistory, setMsgHistory] = useState<MessageRecord[]>([]);
  const [policies, setPolicies] = useState<string[]>([]);
  const [policy, setPolicyName] = useState("lowest_latency");
  const [speedKmh, setSpeedKmh] = useState(30);
  const [headingDeg, setHeadingDeg] = useState(0);
  const [linkEdit, setLinkEdit] = useState({ cost: "", tx: "", reqMargin: "", extraLoss: "", preset: "" });
  const [nodeEdit, setNodeEdit] = useState({ x: "", y: "" });
  const [rfPresets, setRfPresets] = useState<string[]>([]);
  const [trafficProfiles, setTrafficProfiles] = useState<TrafficProfile[]>([]);
  const [report, setReport] = useState<SimulationReport | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [view, setView] = useState<ViewRequest | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loopGeneration = useRef(0);
  const loopRequest = useRef<Promise<unknown> | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const { setScenarioId: setAssistantScenario } = useAssistant();

  // Global assistant sees the live selection (sanitized server-side).
  const ctxNode = topology?.nodes.find((n) => n.id === selectedNodeId) ?? null;
  const ctxLink = topology?.links.find((l) => l.id === selectedLinkId) ?? null;
  useAssistantContext(
    {
      node_id: selectedNodeId ?? undefined,
      node_label: ctxNode?.label,
      link_id: selectedLinkId ?? undefined,
      link_label: ctxLink ? `${ctxLink.source} → ${ctxLink.target}` : undefined,
      region_id: selectedRegionId ?? undefined,
      entity_id: selectedBuildingId ?? undefined,
    },
    [selectedNodeId, selectedLinkId, selectedRegionId, selectedBuildingId, topology]
  );
  useEffect(() => {
    setAssistantScenario(scenarioId);
  }, [scenarioId, setAssistantScenario]);

  const sid = useCallback((id: string) => (id === "maritime_failover" ? undefined : id), []);

  const refresh = useCallback(
    async (id: string) => {
      const [state, log] = await Promise.all([
        fetchSimulationState(sid(id)),
        fetchSimulationEvents(sid(id)),
      ]);
      setSim(state);
      setEvents(log.events);
      setPolicyName(state.routing_policy);
    },
    [sid]
  );

  const requestView = (preset: string) => {
    // A requested framing wins over follow mode, which would yank the target.
    setFollow(false);
    setView((prev) => ({ preset, nonce: (prev?.nonce ?? 0) + 1 }));
  };

  const topoVersion = useRef<number>(0);

  const loadScenario = useCallback(
    async (id: string) => {
      setError(null);
      setSelectedNodeId(null);
      setSelectedLinkId(null);
      setSelectedBuildingId(null);
      setSelectedRegionId(null);
      setPlacing(false);
      try {
        const detail = await fetchScenario(id);
        setTopology(detail.topology);
        topoVersion.current = detail.version;
        setScenarioId(id);
        setEnvironment(detail.environment);
        // The world persists; the scenario only moves the camera + activity.
        fetchWorldFocus(id)
          .then((f) => {
            setFocus(f);
            requestView(f.camera_preset);
          })
          .catch(() => {});
        const mobile = detail.topology.nodes.find((n) => MOBILE_TYPES.includes(n.type));
        const vx = mobile?.mobility?.velocity_x_kmh ?? 0;
        const vy = mobile?.mobility?.velocity_y_kmh ?? 0;
        setSpeedKmh(Math.round(Math.hypot(vx, vy)));
        setHeadingDeg(Math.round(((Math.atan2(vy, vx) * 180) / Math.PI + 360) % 360));
        setMsgTrace(null);
        setMsgFlow(null);
        setMsgHistory([]);
        fetchMessages(id).then((h) => setMsgHistory(h.messages.slice(-6).reverse())).catch(() => {});
        await refresh(id);
        return detail.topology;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load scenario");
        return null;
      }
    },
    [refresh]
  );

  useEffect(() => {
    fetchScenarios().then(setScenarios).catch(() => {});
    fetchPolicies().then((p) => setPolicies(p.policies)).catch(() => {});
    fetchRfPresets().then((p) => setRfPresets(Object.keys(p.presets))).catch(() => {});
    fetchTrafficProfiles().then((p) => setTrafficProfiles(p.profiles)).catch(() => {});
    fetchWorldRegions().then((r) => setRegions(r.regions)).catch(() => {});
    fetchWorldMeta().then((m) => setWorldMeta(m.meta)).catch(() => {});
    // Deep link from Architecture (?focus=<nodeId>): select, track, and offer
    // placement when the node has no world position yet.
    void loadScenario(searchParams.get("scenario") || "maritime_failover").then((topo) => {
      const focusId = searchParams.get("focus");
      if (!topo || !focusId) return;
      const node = topo.nodes.find((n) => n.id === focusId);
      if (!node) {
        setNotice(`Node ${focusId} is not in this scenario.`);
        return;
      }
      setSelectedNodeId(node.id);
      setFollow(true);
      if (!node.world_position && PLACEABLE_TYPES.includes(node.type) && !node.mobility?.follow) {
        setPlacing(true);
        setNotice(`${node.label} has no world placement yet — click the world to position it, then Save placement.`);
      } else {
        setNotice(`Focused ${node.label} from Architecture Studio.`);
      }
    });
    return () => {
      loopGeneration.current++;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [searchParams, loadScenario]);

  // Incremental sync: when the saved scenario changes elsewhere (another tab,
  // Architecture Studio), reload the topology in place. R3F reconciles by
  // node id, so only affected entities update — the scene is never rebuilt.
  useEffect(() => {
    const sidNow = scenarioId;
    if (!sidNow) return;
    const poll = window.setInterval(() => {
      if (document.hidden || placing) return;
      fetchScenarios()
        .then((list) => {
          const hit = list.find((s) => s.id === sidNow);
          if (hit && hit.version !== topoVersion.current) {
            fetchScenario(sidNow)
              .then((detail) => {
                topoVersion.current = detail.version;
                setTopology(detail.topology);
                setNotice(`Architecture updated (v${detail.version}) — world refreshed.`);
                void refresh(sidNow);
              })
              .catch(() => {});
          }
        })
        .catch(() => {});
    }, 12000);
    return () => window.clearInterval(poll);
  }, [scenarioId, placing, refresh]);

  useEffect(() => {
    setTopology((prev) => {
      if (!prev || !sim) return prev;
      const positions = new Map(sim.nodes.map((n) => [n.id, n.world_position]));
      let changed = false;
      const nodes = prev.nodes.map((n) => {
        const live = positions.get(n.id);
        if (live && (live.x_km !== n.world_position?.x_km || live.y_km !== n.world_position?.y_km)) {
          changed = true;
          return { ...n, world_position: live };
        }
        return n;
      });
      return changed ? { ...prev, nodes } : prev;
    });
  }, [sim]);

  const stopLoop = () => {
    loopGeneration.current++;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setRunning(false);
  };

  const startLoop = useCallback((id: string, dt: number) => {
    const generation = ++loopGeneration.current;
    if (timer.current) clearTimeout(timer.current);
    setRunning(false);
    setError(null);
    const run = async () => {
      try {
        await loopRequest.current?.catch(() => {});
        if (generation !== loopGeneration.current) return;
        const start = startSimulation(sid(id));
        loopRequest.current = start;
        await start;
        if (generation !== loopGeneration.current) return;
        setRunning(true);
        const step = async () => {
          try {
            const request = stepSimulation(1, dt, sid(id));
            loopRequest.current = request;
            const state = await request;
            if (generation !== loopGeneration.current) return;
            setSim(state);
            const log = await fetchSimulationEvents(sid(id));
            if (generation !== loopGeneration.current) return;
            setEvents(log.events);
            timer.current = setTimeout(step, 1000);
          } catch (e) {
            if (generation !== loopGeneration.current) return;
            setError(e instanceof Error ? e.message : "Step failed");
            stopLoop();
          }
        };
        timer.current = setTimeout(step, 1000);
      } catch (e) {
        if (generation !== loopGeneration.current) return;
        setError(e instanceof Error ? e.message : "Simulation start failed");
        stopLoop();
      }
    };
    void run();
  }, [sid]);

  const doPause = async () => {
    stopLoop();
    try {
      await loopRequest.current?.catch(() => {});
      await pauseSimulation(sid(scenarioId));
      await refresh(scenarioId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Pause failed");
    }
  };

  const doReset = async () => {
    stopLoop();
    try {
      await loopRequest.current?.catch(() => {});
      await resetSimulation(sid(scenarioId));
      await loadScenario(scenarioId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reset failed");
    }
  };

  const doStep = async () => {
    try {
      const state = await stepSimulation(1, speed.dt, sid(scenarioId));
      setSim(state);
      setEvents((await fetchSimulationEvents(sid(scenarioId))).events);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Step failed");
    }
  };

  const mobileNode = topology?.nodes.find((n) => MOBILE_TYPES.includes(n.type)) ?? null;

  const applyCourse = async (nodeId: string | null, vx: number, vy: number) => {
    if (!nodeId) {
      setError("No mobile node in this scenario");
      return;
    }
    try {
      await setCourse(nodeId, vx, vy, sid(scenarioId));
      await refresh(scenarioId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Course change failed");
    }
  };

  const applySpeedHeading = () => {
    const rad = (headingDeg * Math.PI) / 180;
    void applyCourse(selectedMobileNode?.id ?? null, speedKmh * Math.cos(rad), speedKmh * Math.sin(rad));
  };

  const PLACEABLE_TYPES = ["base_station", "tower", "access_point", "ground_station", "gateway"];

  const handlePlacePoint = async (xKm: number, yKm: number) => {
    if (!placeableNode) return;
    setPlacing(false);
    try {
      await setNodePosition(placeableNode.id, xKm, yKm, sid(scenarioId));
      await refresh(scenarioId);
      setNotice(
        `${placeableNode.label} moved to (${xKm.toFixed(1)}, ${yKm.toFixed(1)}) km for this run. Save placement to persist it.`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Placement failed");
    }
  };

  const savePlacement = async () => {
    if (!selectedNodeId || !selectedNodeState?.world_position) return;
    const pos = selectedNodeState.world_position;
    try {
      const detail = await patchScenarioNode(scenarioId, selectedNodeId, {
        world_position: { x_km: pos.x_km, y_km: pos.y_km, altitude_m: pos.altitude_m ?? 0 },
      });
      topoVersion.current = detail.version;
      if (detail.id !== scenarioId) {
        setScenarioId(detail.id);
        setScenarios(await fetchScenarios());
        setNotice(`Saved as new scenario ${detail.id} (maritime regression kept read-only).`);
      } else {
        setNotice(`Placement saved to scenario ${detail.id} (version ${detail.version}).`);
      }
      setTopology(detail.topology);
      await refresh(detail.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save placement failed");
    }
  };

  const patchLinkAndRefresh = async (patch: Parameters<typeof patchScenarioLink>[2]) => {
    if (!selectedLinkId) throw new Error("No link selected");
    const detail = await patchScenarioLink(scenarioId, selectedLinkId, patch);
    if (detail.id !== scenarioId) {
      setScenarioId(detail.id);
      setScenarios(await fetchScenarios());
      setNotice(`Saved as new scenario ${detail.id} (maritime regression kept read-only).`);
    }
    setTopology(detail.topology);
    await refresh(detail.id);
    return detail;
  };

  const applyPolicy = async (p: string) => {
    setPolicyName(p);
    try {
      await setPolicy(p, undefined, sid(scenarioId));
      await refresh(scenarioId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Policy change failed");
    }
  };

  const applyLinkParams = async () => {
    if (!selectedLinkId) return;
    const updates: { cost_per_gb?: number; rf?: RfConfig } = {};
    if (linkEdit.cost !== "") updates.cost_per_gb = Number(linkEdit.cost);
    const rf: RfConfig = {};
    if (linkEdit.preset) rf.preset = linkEdit.preset;
    if (linkEdit.tx !== "") rf.tx_power_dbm = Number(linkEdit.tx);
    if (linkEdit.reqMargin !== "") rf.required_margin_db = Number(linkEdit.reqMargin);
    if (linkEdit.extraLoss !== "") rf.extra_loss_db = Number(linkEdit.extraLoss);
    if (Object.keys(rf).length > 0) {
      rf.model = "link_budget";
      updates.rf = rf;
    }
    if (Object.keys(updates).length === 0) return;
    try {
      await updateLinkParams(selectedLinkId, updates, sid(scenarioId));
      await refresh(scenarioId);
      setLinkEdit({ cost: "", tx: "", reqMargin: "", extraLoss: "", preset: "" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Link update failed");
    }
  };

  const applyNodePosition = async () => {
    if (!selectedNodeId || nodeEdit.x === "" || nodeEdit.y === "") return;
    try {
      await setNodePosition(selectedNodeId, Number(nodeEdit.x), Number(nodeEdit.y), sid(scenarioId));
      await refresh(scenarioId);
      setNodeEdit({ x: "", y: "" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Node move failed");
    }
  };

  const clearSelection = () => {
    setSelectedNodeId(null);
    setSelectedLinkId(null);
    setSelectedBuildingId(null);
    setSelectedRegionId(null);
    setPlacing(false);
  };

  const pickNode = (id: string | null) => {
    clearSelection();
    setSelectedNodeId(id);
  };

  const selectedNode = topology?.nodes.find((n) => n.id === selectedNodeId) ?? null;
  const selectedMobileNode =
    selectedNode && MOBILE_TYPES.includes(selectedNode.type) ? selectedNode : null;
  const placeableNode =
    selectedNode && PLACEABLE_TYPES.includes(selectedNode.type) && !selectedNode.mobility?.follow
      ? selectedNode
      : null;
  const selectedNodeState = sim?.nodes.find((n) => n.id === selectedNodeId) ?? null;
  const selectedLink = topology?.links.find((l) => l.id === selectedLinkId) ?? null;
  const selectedBuilding = BUILDINGS.find((b) => b.id === selectedBuildingId) ?? null;
  const selectedRegion = regions.find((r) => r.id === selectedRegionId) ?? null;
  const isVehicle = environment === "urban_vehicle";
  const isShared = environment === "shared_world";
  const endpoints = sim?.endpoint_routes ?? [];
  const selectedEndpoint = endpoints.find((e) => e.endpoint_id === selectedNodeId) ?? null;
  const focusLinkIds = useMemo(
    () => (selectedEndpoint?.route ? new Set(selectedEndpoint.route.link_ids) : null),
    [selectedEndpoint]
  );

  const applyTraffic = async (nodeId: string, profile: string) => {
    try {
      const state = await setTraffic(nodeId, profile, sid(scenarioId));
      setSim(state);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Traffic change failed");
    }
  };

  const openReport = async () => {
    try {
      const rep = await fetchReport(sid(scenarioId));
      setReport(rep);
      setShowReport(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Report failed");
    }
  };

  const doSendMessage = async () => {
    if (!msgSource || !msgDest || msgSending) return;
    setMsgSending(true);
    setMsgFlow(null);
    const msid = sid(scenarioId) ?? "maritime_failover";
    try {
      const rec = await sendMessage({
        scenario_id: msid,
        source_id: msgSource,
        dest_id: msgDest,
        kind: msgKind,
        ...(msgKind === "file" && typeof msgSizeKb === "number" ? { size_kb: msgSizeKb } : {}),
      });
      setMsgTrace(rec);
      if (rec.status === "delivered" && rec.hops.length > 0) {
        // 3D pulse timing mirrors hop latencies, scaled to a watchable total.
        const total = rec.hops.reduce((s, h) => s + h.latency_ms, 0) || 1;
        const target = Math.min(8000, Math.max(2000, total));
        const k = target / total;
        setMsgScale(k);
        const nodeIds = [rec.hops[0].from_id, ...rec.hops.map((h) => h.to_id)];
        setMsgFlow({ key: rec.id, nodeIds, hopMs: rec.hops.map((h) => Math.max(h.latency_ms * k, 120)) });
      }
      const hist = await fetchMessages(msid);
      setMsgHistory(hist.messages.slice(-6).reverse());
      await refresh(scenarioId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Message failed");
    } finally {
      setMsgSending(false);
    }
  };

  const downloadReport = () => {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nexuslayer-report-${report.scenario_id}-t${report.tick}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    } else {
      void stageRef.current?.requestFullscreen?.().catch(() => {});
    }
  };

  const handoverActive =
    sim != null &&
    events.some(
      (e) =>
        ["failover", "handover", "failback"].includes(e.type) &&
        sim.tick - (e.tick ?? 0) <= 2 &&
        sim.tick - (e.tick ?? 0) >= 0
    );
  const disconnected = sim?.connectivity === "disconnected";

  const input =
    "w-full rounded border border-nx-line bg-nx-workspace px-2 py-1 text-[11px] text-nx-ink";
  const darkInput =
    "rounded border border-nx-line bg-nx-workspace px-2 py-1 text-xs text-nx-ink";
  const tbtn =
    "rounded border border-nx-line bg-nx-panel px-2.5 py-1 text-xs text-nx-body hover:border-nx-accent disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <WorkbenchShell
      project={
        <>
          <select
            value={scenarioId}
            onChange={(e) => {
              stopLoop();
              void loadScenario(e.target.value);
            }}
            className={`${darkInput} max-w-56`}
            title="Scenario"
          >
            {scenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <span className="flex items-center gap-2 whitespace-nowrap font-mono text-[11px] text-nx-muted">
            {handoverActive && !disconnected && (
              <span className="rounded bg-nx-warn px-1.5 py-0.5 font-medium text-nx-workspace">Handover in progress</span>
            )}
            {disconnected && (
              <span className="rounded bg-nx-bad px-1.5 py-0.5 font-medium text-nx-workspace">Disconnected</span>
            )}
            {sim ? `${sim.connectivity} · tick ${sim.tick} · t=${(sim.sim_time_s ?? 0).toFixed(0)}s` : "Loading…"}
          </span>
        </>
      }
      actions={
        <>
          {!running ? (
            <button
              onClick={() => startLoop(scenarioId, speed.dt)}
              disabled={!sim}
              className="nx-btn-primary"
            >
              Run
            </button>
          ) : (
            <button onClick={() => void doPause()} className="rounded bg-nx-warn px-3 py-1 text-xs font-medium text-nx-workspace">
              Pause
            </button>
          )}
          <button onClick={() => void doStep()} disabled={running || !sim} className={tbtn}>
            Step
          </button>
          <button onClick={() => void doReset()} className={tbtn}>
            Reset
          </button>
        </>
      }
      leftTitle="World objects"
      leftPanel={
        <div className="flex flex-col gap-3">
          <div>
            <h2 className="text-xs font-semibold text-nx-ink">Regions</h2>
            <p className="mt-0.5 text-[10px] leading-snug text-nx-muted">
              One persistent world — jump the camera, the landscape stays.
            </p>
            <div className="mt-1 flex flex-wrap gap-1">
              {REGION_NAV.map((r) => (
                <button
                  key={r.preset}
                  onClick={() => requestView(r.preset)}
                  className="rounded border border-nx-line px-2 py-0.5 text-[10px] text-nx-body hover:border-nx-accent"
                >
                  {r.label}
                </button>
              ))}
            </div>
            {focus && (
              <p className="mt-1 rounded bg-nx-raised px-2 py-1 text-[10px] leading-snug text-nx-muted">
                <strong className="text-nx-body">Scenario focus:</strong> {focus.activity}
              </p>
            )}
          </div>
          {endpoints.length > 1 && (
            <div>
              <h2 className="text-xs font-semibold text-nx-ink">Endpoints ({endpoints.length})</h2>
              <div className="mt-1 space-y-1">
                {endpoints.map((e) => (
                  <button
                    key={e.endpoint_id}
                    onClick={() => {
                      clearSelection();
                      setSelectedNodeId(e.endpoint_id);
                    }}
                    className={`w-full rounded px-2 py-1 text-left text-[10px] ${selectedNodeId === e.endpoint_id ? "ring-2 ring-nx-accent " : ""}${
                      e.connectivity === "disconnected"
                        ? "bg-nx-bad/15 text-nx-badink"
                        : e.connectivity === "degraded"
                          ? "bg-nx-warn/15 text-nx-warn"
                          : "bg-nx-ok/15 text-nx-ok"
                    }`}
                  >
                    <span className="font-semibold">{e.endpoint_label}</span> · {e.connectivity}
                    {e.route && ` · ${e.route.latency_ms.toFixed(0)} ms`}
                    {e.achieved_mbps != null && ` · ~${e.achieved_mbps.toFixed(1)} Mbps`}
                    {` · ${e.traffic}`}
                    {!e.traffic_suitable && e.route && " · ⚠ app needs unmet"}
                    {!e.route && " · no route"}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div>
            <h2 className="text-xs font-semibold text-nx-ink">Infrastructure</h2>
            <div className="mt-1 space-y-1">
              {(topology?.nodes ?? [])
                .filter((n) => PLACEABLE_TYPES.includes(n.type) && !n.mobility?.follow)
                .map((n) => (
                  <button
                    key={n.id}
                    onClick={() => pickNode(n.id)}
                    className={`w-full rounded px-2 py-1 text-left font-mono text-[10px] ${
                      selectedNodeId === n.id
                        ? "bg-nx-accent/15 text-nx-accent ring-1 ring-nx-accent"
                        : "bg-nx-raised text-nx-muted hover:text-nx-body"
                    }`}
                  >
                    {n.label} · {n.type}
                  </button>
                ))}
            </div>
          </div>
          <div>
            <h2 className="text-xs font-semibold text-nx-ink">Messages</h2>
            <p className="mt-0.5 text-[10px] leading-snug text-nx-muted">
              Device-to-device sessions over the live graph. The 3D pulse mirrors hop latencies.
            </p>
            <div className="mt-1.5 space-y-1.5">
              <NxField label="From">
                <NxSelect
                  value={msgSource}
                  onChange={setMsgSource}
                  ariaLabel="Message source device"
                  options={[
                    { value: "", label: "Select source…" },
                    ...endpoints.map((e) => ({ value: e.endpoint_id, label: e.endpoint_label })),
                  ]}
                />
              </NxField>
              <NxField label="To">
                <NxSelect
                  value={msgDest}
                  onChange={setMsgDest}
                  ariaLabel="Message destination device"
                  options={[
                    { value: "", label: "Select destination…" },
                    ...endpoints.map((e) => ({ value: e.endpoint_id, label: e.endpoint_label })),
                  ]}
                />
              </NxField>
              <div className="flex gap-1.5">
                <div className="flex-1">
                  <NxField label="Kind">
                    <NxSelect
                      value={msgKind}
                      onChange={setMsgKind}
                      options={[
                        { value: "message", label: "Text message" },
                        { value: "telemetry", label: "Telemetry" },
                        { value: "file", label: "File transfer" },
                        { value: "voice", label: "Voice (~1 min)" },
                        { value: "video", label: "Video (~1 min)" },
                      ]}
                    />
                  </NxField>
                </div>
                {msgKind === "file" && (
                  <div className="w-28">
                    <NxField label="Size">
                      <NxNumberInput value={msgSizeKb} onChange={(v) => setMsgSizeKb(v)} unit="KB" min={1} max={10000000} />
                    </NxField>
                  </div>
                )}
              </div>
              <button
                onClick={() => void doSendMessage()}
                disabled={!msgSource || !msgDest || msgSending}
                className="nx-btn-primary w-full disabled:opacity-40"
              >
                {msgSending ? "Sending…" : "Send message"}
              </button>
              {msgTrace && (
                <div className="nx-swap rounded border border-nx-line bg-nx-workspace p-2" key={msgTrace.id}>
                  <p className={`text-[11px] font-semibold ${msgTrace.status === "delivered" ? "text-nx-ok" : "text-nx-badink"}`}>
                    {msgTrace.id} · {msgTrace.status}
                    {msgTrace.status === "delivered" && !msgTrace.meets_profile ? " · profile unmet" : ""}
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] leading-snug text-nx-muted">
                    {msgTrace.path_labels.join(" → ") || msgTrace.reason}
                  </p>
                  {msgTrace.status === "failed" && (
                    <p className="mt-0.5 text-[10px] leading-snug text-nx-badink">{msgTrace.reason}</p>
                  )}
                  {msgTrace.hops.length > 0 && (
                    <ol className="mt-1 space-y-0.5">
                      {msgTrace.hops.map((h, i) => (
                        <li key={`${h.link_id}-${i}`} className="text-[10px] leading-snug text-nx-body">
                          <span className="font-mono text-nx-muted">{i + 1}.</span> {h.from_label} → {h.to_label}
                          <span className="text-nx-muted"> · {h.technology} · {h.latency_ms.toFixed(0)} ms</span>{" "}
                          <a
                            href={`/physics?scenario=${encodeURIComponent(scenarioId)}&link=${encodeURIComponent(h.link_id)}`}
                            className="text-nx-accent hover:underline"
                          >
                            physics
                          </a>
                        </li>
                      ))}
                    </ol>
                  )}
                  {msgTrace.total_ms != null && (
                    <p className="mt-1 font-mono text-[10px] text-nx-muted">
                      total {msgTrace.total_ms.toFixed(0)} ms · ~{(msgTrace.achieved_mbps ?? 0).toFixed(1)} Mbps
                      {msgTrace.cost_usd != null && ` · $${msgTrace.cost_usd.toFixed(4)}`}
                      {msgFlow && ` · 3D ×${msgScale >= 10 ? msgScale.toFixed(0) : msgScale.toFixed(1)} time-scaled`}
                    </p>
                  )}
                  {msgTrace.profile_notes.map((n, i) => (
                    <p key={i} className="mt-0.5 text-[10px] text-nx-warn">⚠ {n}</p>
                  ))}
                </div>
              )}
              {msgHistory.length > 0 && (
                <div className="space-y-0.5">
                  {msgHistory.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setMsgTrace(m)}
                      className="block w-full truncate rounded bg-nx-raised px-2 py-0.5 text-left font-mono text-[10px] text-nx-muted hover:text-nx-body"
                    >
                      {m.id} · {m.source_label} → {m.dest_label} · {m.status}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div>
            <h2 className="text-xs font-semibold text-nx-ink">Link states</h2>
            <div className="mt-1 space-y-1">
              {(sim?.links ?? []).map((l) => {
                const def = topology?.links.find((t) => t.id === l.id);
                const label = def ? `${def.source}→${def.target}` : l.id;
                const cls =
                  l.status === "down"
                    ? "bg-nx-bad/15 text-nx-badink"
                    : !l.suitable
                      ? "bg-nx-warn/15 text-nx-warn"
                      : l.on_active_route
                        ? "bg-nx-accent/15 text-nx-accent"
                        : l.on_backup_route
                          ? "bg-nx-ok/15 text-nx-ok"
                          : "bg-nx-raised text-nx-muted";
                return (
                  <button
                    key={l.id}
                    onClick={() => {
                      clearSelection();
                      setSelectedLinkId(l.id);
                    }}
                    className={`w-full rounded px-2 py-1 text-left font-mono text-[10px] ${cls} ${selectedLinkId === l.id ? "ring-2 ring-nx-accent" : ""}`}
                  >
                    {label} · {l.status === "down" ? "down" : !l.suitable ? "unsuitable" : l.on_active_route ? "active" : l.on_backup_route ? "backup" : "idle"}
                    {l.margin_db != null && ` · ${l.margin_db.toFixed(1)} dB`}
                    {l.distance_km != null && l.distance_km < 1000 && ` · ${l.distance_km.toFixed(1)} km`}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      }
      rightTitle="Inspector"
      rightPanel={
        <div className="flex flex-col gap-3">
          <div>
            {!selectedNode && !selectedLink && !selectedBuilding && !selectedRegion && (
              <div className="mt-1 text-[11px] text-nx-body">
                <p className="font-semibold text-nx-ink">{worldMeta?.name ?? "Shared world"}</p>
                <p className="text-nx-muted">
                  {worldMeta?.fictional ? "Illustrative fictional region" : ""} ·{" "}
                  {sim ? `t=${(sim.sim_time_s ?? 0).toFixed(0)}s · tick ${sim.tick}` : "loading…"}
                </p>
                {endpoints.length > 0 && (
                  <p className="mt-1">
                    {endpoints.filter((e) => e.connectivity === "connected").length} connected ·{" "}
                    {endpoints.filter((e) => e.connectivity === "degraded").length} degraded ·{" "}
                    {endpoints.filter((e) => !["connected", "degraded"].includes(e.connectivity)).length} disconnected{" "}
                    ({endpoints.length} endpoints)
                  </p>
                )}
                {focus && <p className="mt-1 text-nx-muted">{focus.activity}</p>}
                {(() => {
                  const important = events
                    .filter((e) => ["failover", "failback", "handover", "suitability_changed", "node_moved"].includes(e.type))
                    .slice(-3)
                    .reverse();
                  return important.length > 0 ? (
                    <div className="mt-1 space-y-0.5">
                      {important.map((e) => (
                        <p key={e.seq} className="font-mono text-[10px] text-nx-muted">
                          <strong className="text-nx-body">{e.type}</strong> {e.message}
                        </p>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-1 text-nx-muted">Click a device, link, building, or the rural tint.</p>
                  );
                })()}
              </div>
            )}
            {selectedNode && (
              <div className="nx-swap mt-1 text-[11px] text-nx-body" key={selectedNode.id}>
                <div className="overflow-hidden rounded border border-nx-line bg-nx-workspace">
                  <div className="h-28">
                    <DeviceArt kind={selectedNode.type} label={selectedNode.label} />
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <DeviceIcon kind={selectedNode.type} size={26} />
                  <div className="min-w-0">
                    <p className="font-semibold text-nx-ink">{selectedNode.label}</p>
                    <p className="font-mono text-nx-muted">{selectedNode.type} · {selectedNode.id}</p>
                  </div>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {selectedNode.device_id && (
                    <a
                      href={`/hardware?device=${encodeURIComponent(selectedNode.device_id)}`}
                      className="rounded border border-nx-line px-2 py-0.5 text-[10px] hover:border-nx-accent"
                    >
                      Library record
                    </a>
                  )}
                  <a
                    href={`/architecture?scenario=${encodeURIComponent(scenarioId)}&select=${encodeURIComponent(selectedNode.id)}`}
                    className="rounded border border-nx-line px-2 py-0.5 text-[10px] hover:border-nx-accent"
                  >
                    Open in Architecture →
                  </a>
                </div>
                {selectedNodeState?.world_position && (
                  <p className="mt-1 font-mono">
                    Position: {selectedNodeState.world_position.x_km.toFixed(2)},{" "}
                    {selectedNodeState.world_position.y_km.toFixed(2)} km
                    {(selectedNodeState.world_position.altitude_m ?? 0) > 0 &&
                      ` · alt ${(selectedNodeState.world_position.altitude_m ?? 0).toFixed(0)} m`}
                  </p>
                )}
                {selectedNode.mobility?.follow && (
                  <p className="mt-0.5">
                    Riding: <strong>{topology?.nodes.find((n) => n.id === selectedNode.mobility?.follow)?.label ?? selectedNode.mobility.follow}</strong>{" "}
                    (position copied each tick)
                  </p>
                )}
                {!selectedNode.mobility?.follow && selectedNode.mobility && (selectedNode.mobility.speed_kmh || selectedNode.mobility.velocity_x_kmh || selectedNode.mobility.velocity_y_kmh) ? (
                  <p className="mt-0.5">
                    Moving: {(selectedNode.mobility.waypoints_km?.length ?? 0) > 0
                      ? `patrol (${selectedNode.mobility.waypoints_km?.length} waypoints)`
                      : `course (${selectedNode.mobility.velocity_x_kmh ?? 0}, ${selectedNode.mobility.velocity_y_kmh ?? 0}) km/h`}
                  </p>
                ) : null}
                {!selectedNode.mobility && (
                  <p className="mt-0.5 text-nx-muted">
                    {["phone", "smartphone", "person", "laptop", "tablet", "computer"].includes(selectedNode.type)
                      ? "Stationary (no movement configured)."
                      : "Fixed infrastructure."}
                  </p>
                )}
                {(selectedNode.supported_technologies ?? []).length > 0 && (
                  <p className="mt-0.5">Interfaces: {selectedNode.supported_technologies!.join(", ")}</p>
                )}
                {selectedNodeState && <p>On active route: {selectedNodeState.on_active_route ? "yes" : "no"}</p>}
                {selectedEndpoint && (
                  <div className="mt-1 rounded bg-nx-raised p-1.5">
                    <p className="font-semibold text-nx-ink">
                      Route to internet ({selectedEndpoint.connectivity})
                    </p>
                    {selectedEndpoint.route ? (
                      <>
                        <p className="mt-0.5 leading-relaxed">
                          {selectedEndpoint.route.node_labels.join(" → ")}
                        </p>
                        <p className="mt-0.5 text-nx-muted">
                          {selectedEndpoint.route.latency_ms.toFixed(0)} ms ·{" "}
                          {selectedEndpoint.route.bandwidth_mbps} Mbps link ·{" "}
                          ~{(selectedEndpoint.achieved_mbps ?? 0).toFixed(1)} Mbps fair share
                        </p>
                        <label className="mt-1 block">
                          Traffic:{" "}
                          <select
                            value={selectedEndpoint.traffic}
                            onChange={(e) => void applyTraffic(selectedEndpoint.endpoint_id, e.target.value)}
                            className={darkInput}
                          >
                            {trafficProfiles.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        {!selectedEndpoint.traffic_suitable && (
                          <p className="mt-0.5 font-medium text-nx-warn">
                            ⚠ {selectedEndpoint.traffic_notes.join("; ")}
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="mt-0.5 font-medium text-nx-badink">No route — disconnected.</p>
                    )}
                  </div>
                )}
                {selectedEndpoint?.route?.cost_per_gb != null && (
                  <p className="mt-0.5 font-mono text-[10px] text-nx-muted">
                    Route cost: ${selectedEndpoint.route.cost_per_gb.toFixed(2)}/GB (illustrative)
                  </p>
                )}
                <a
                  href={`/architecture?scenario=${encodeURIComponent(scenarioId)}`}
                  className="mt-1 inline-block text-nx-accent hover:underline"
                >
                  Open full device properties in Architecture →
                </a>
                {selectedNode && !MOBILE_TYPES.includes(selectedNode.type) && selectedNode.type !== "internet" && selectedNode.type !== "satellite" && (
                  <div className="mt-2 flex gap-1">
                    <input value={nodeEdit.x} onChange={(e) => setNodeEdit({ ...nodeEdit, x: e.target.value })} placeholder="x km" type="number" className={input} />
                    <input value={nodeEdit.y} onChange={(e) => setNodeEdit({ ...nodeEdit, y: e.target.value })} placeholder="y km" type="number" className={input} />
                    <button onClick={() => void applyNodePosition()} title="Move for this run only" className="shrink-0 rounded bg-nx-ink px-2 py-1 text-[11px] font-medium text-nx-workspace">
                      Move
                    </button>
                  </div>
                )}
                {placeableNode && (
                  <div className="mt-1 flex gap-1">
                    <button
                      onClick={() => setPlacing((v) => !v)}
                      title="Click a point in the 3D world to position this infrastructure"
                      className={`flex-1 rounded border px-2 py-1 text-[11px] ${placing ? "border-nx-accent text-nx-accent" : "border-nx-line hover:border-nx-accent"}`}
                    >
                      {placing ? "Cancel placement" : "Place in world"}
                    </button>
                    <button
                      onClick={() => void savePlacement()}
                      title="Persist the current position to the saved scenario"
                      className="flex-1 rounded bg-nx-ink px-2 py-1 text-[11px] font-medium text-nx-workspace"
                    >
                      Save placement
                    </button>
                  </div>
                )}
                {placing && placeableNode && (
                  <p className="mt-1 font-medium text-nx-accent">
                    Click the world to position {placeableNode.label}…
                  </p>
                )}
              </div>
            )}
            {selectedLink && (
              <div className="mt-1 text-[11px] text-nx-body">
                <LinkInspector scenarioId={scenarioId} edge={selectedLink} onPatch={patchLinkAndRefresh} />
                <h3 className="mt-2 font-semibold text-nx-ink">Adjust run parameters</h3>
                <p className="text-[10px] text-nx-muted">
                  Applies to this simulation run only (saved edits live in the tabs above).
                </p>
                <div className="mt-1 grid grid-cols-2 gap-1">
                  <input value={linkEdit.cost} onChange={(e) => setLinkEdit({ ...linkEdit, cost: e.target.value })} placeholder="cost $/GB" type="number" className={input} />
                  <input value={linkEdit.tx} onChange={(e) => setLinkEdit({ ...linkEdit, tx: e.target.value })} placeholder="TX dBm" type="number" className={input} />
                  <input value={linkEdit.reqMargin} onChange={(e) => setLinkEdit({ ...linkEdit, reqMargin: e.target.value })} placeholder="req margin dB" type="number" className={input} />
                  <input value={linkEdit.extraLoss} onChange={(e) => setLinkEdit({ ...linkEdit, extraLoss: e.target.value })} placeholder="extra loss dB" type="number" className={input} />
                </div>
                <select value={linkEdit.preset} onChange={(e) => setLinkEdit({ ...linkEdit, preset: e.target.value })} className={`${input} mt-1`}>
                  <option value="">Keep RF preset…</option>
                  {rfPresets.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
                <button onClick={() => void applyLinkParams()} className="mt-1 w-full rounded bg-nx-ink px-2 py-1 text-[11px] font-medium text-nx-workspace">
                  Apply to simulation
                </button>
              </div>
            )}
            {selectedBuilding && (
              <div className="mt-1 text-[11px] text-nx-body">
                <p className="font-semibold text-nx-ink">{selectedBuilding.name}</p>
                <p className="text-nx-muted">{selectedBuilding.kind}</p>
                <p className="mt-1 leading-relaxed">{selectedBuilding.blurb}</p>
                {selectedBuilding.nodeIds.length > 0 && (
                  <div className="mt-1 space-y-1">
                    <p className="text-nx-muted">Associated devices:</p>
                    {selectedBuilding.nodeIds.map((nid) => {
                      const n = topology?.nodes.find((t) => t.id === nid);
                      if (!n) return null;
                      return (
                        <button
                          key={nid}
                          onClick={() => pickNode(nid)}
                          className="block w-full rounded bg-nx-raised px-2 py-1 text-left hover:ring-1 hover:ring-nx-accent"
                        >
                          {n.label} <span className="text-nx-muted">· {n.type}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            {selectedRegion && (
              <div className="mt-1 text-[11px] text-nx-body">
                <p className="font-semibold text-nx-ink">{selectedRegion.name}</p>
                <p className="text-nx-muted">{selectedRegion.kind} · coverage: {selectedRegion.coverage}</p>
                <p className="mt-1 leading-relaxed">{selectedRegion.blurb}</p>
                <p className="mt-1 leading-relaxed text-nx-muted">{selectedRegion.coverage_note}</p>
                {(() => {
                  const [x0, y0, x1, y1] = selectedRegion.bounds_km;
                  const places = BUILDINGS.filter(
                    (b) => b.pos[0] >= x0 && b.pos[0] <= x1 && b.pos[2] >= y0 && b.pos[2] <= y1
                  );
                  const inside = (topology?.nodes ?? []).filter((n) => {
                    const p = n.world_position;
                    return p && p.x_km >= x0 && p.x_km <= x1 && p.y_km >= y0 && p.y_km <= y1;
                  });
                  return (
                    <>
                      {places.length > 0 && (
                        <div className="mt-1 space-y-1">
                          <p className="text-nx-muted">Places:</p>
                          {places.map((b) => (
                            <button
                              key={b.id}
                              onClick={() => {
                                clearSelection();
                                setSelectedBuildingId(b.id);
                              }}
                              className="block w-full rounded bg-nx-raised px-2 py-1 text-left hover:ring-1 hover:ring-nx-accent"
                            >
                              {b.name} <span className="text-nx-muted">· {b.kind}</span>
                            </button>
                          ))}
                        </div>
                      )}
                      {inside.length > 0 && (
                        <div className="mt-1 space-y-1">
                          <p className="text-nx-muted">Infrastructure here:</p>
                          {inside.map((n) => (
                            <button
                              key={n.id}
                              onClick={() => pickNode(n.id)}
                              className="block w-full rounded bg-nx-raised px-2 py-1 text-left hover:ring-1 hover:ring-nx-accent"
                            >
                              {n.label} <span className="text-nx-muted">· {n.type}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  );
                })()}
                {selectedRegion.coverage_region_id && (
                  <a href="/coverage" className="mt-1 inline-block text-nx-accent hover:underline">
                    Open Coverage Research for proposals →
                  </a>
                )}
              </div>
            )}
          </div>
          {selectedMobileNode && (
            <div className="border-t border-nx-line pt-2">
              <h2 className="text-xs font-semibold text-nx-ink">
                Movement control ({selectedMobileNode.label})
              </h2>
              <label className="mt-1 block text-[11px] text-nx-muted">
                Speed: {speedKmh} km/h
                <input type="range" min={0} max={Math.max(120, speedKmh)} value={speedKmh} onChange={(e) => setSpeedKmh(Number(e.target.value))} className="w-full" />
              </label>
              <label className="mt-1 block text-[11px] text-nx-muted">
                Heading: {headingDeg}° (0 = +X, 90 = +Y)
                <input type="range" min={0} max={359} value={headingDeg} onChange={(e) => setHeadingDeg(Number(e.target.value))} className="w-full" />
              </label>
              <button onClick={applySpeedHeading} className="mt-1 w-full rounded border border-nx-line px-2 py-1 text-[11px] hover:border-nx-accent">
                Apply speed + heading
              </button>
            </div>
          )}
        </div>
      }
      dockTabs={[
        {
          id: "timeline",
          label: "Timeline",
          badge: events.length,
          content: (
            <div className="space-y-1">
              {events.length === 0 && <p className="text-[11px] text-nx-muted">No events yet.</p>}
              {events.map((e) => (
                <p key={e.seq} className="font-mono text-[10px] leading-snug text-nx-muted">
                  <span>#{e.seq} t={(e.sim_time_s ?? 0).toFixed(0)}s</span>{" "}
                  <strong className="text-nx-body">{e.type}</strong> {e.message}
                </p>
              ))}
            </div>
          ),
        },
        {
          id: "route",
          label: "Route",
          content: (
            <div>
              <p className="max-w-4xl text-[11px] leading-relaxed text-nx-body">
                {sim?.decision?.explanation ?? "No decision yet."}
              </p>
              {sim?.active_route && (
                <p className="mt-1 font-mono text-[11px] text-nx-muted">
                  {sim.active_route.node_labels.join(" → ")} · {sim.active_route.latency_ms} ms ·{" "}
                  {sim.active_route.bandwidth_mbps} Mbps · {(sim.active_route.reliability * 100).toFixed(1)}% ·{" "}
                  ${(sim.active_route.cost_per_gb ?? 0).toFixed(2)}/GB
                </p>
              )}
            </div>
          ),
        },
      ]}
      centerScroll={false}
    >
      <div className="flex h-full flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-nx-line bg-nx-panel px-3 py-1.5">
          <select
            aria-label="Simulation speed"
            value={speed.id}
            onChange={(e) => {
              const next = SPEEDS.find((s) => s.id === e.target.value) ?? SPEEDS[0];
              setSpeed(next);
              if (running) startLoop(scenarioId, next.dt);
            }}
            className={darkInput}
            title="Simulation speed"
          >
            {SPEEDS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <select value={policy} onChange={(e) => void applyPolicy(e.target.value)} title="Routing policy" className={darkInput}>
            {policies.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <span className="mx-1 h-5 w-px bg-nx-line" />
          <button onClick={() => { setSpeedKmh(30); setHeadingDeg(isVehicle ? 0 : 90); void applyCourse(mobileNode?.id ?? null, isVehicle ? 30 : 0, isVehicle ? 0 : 30); }} title={isVehicle ? "Drive +X at 30 km/h; overrides patrol" : "Head +Y (offshore) at 30 km/h; overrides patrol"} className={tbtn}>
            {isVehicle ? "Drive east" : "Sail out"}
          </button>
          <button onClick={() => { setSpeedKmh(30); setHeadingDeg(isVehicle ? 180 : 270); void applyCourse(mobileNode?.id ?? null, isVehicle ? -30 : 0, isVehicle ? 0 : -30); }} title={isVehicle ? "Drive −X at 30 km/h; overrides patrol" : "Head −Y (shoreward) at 30 km/h; overrides patrol"} className={tbtn}>
            {isVehicle ? "Drive west" : "Sail back"}
          </button>
          <button onClick={() => { setSpeedKmh(0); void applyCourse(mobileNode?.id ?? null, 0, 0); }} title="Hold position (overrides patrol; Reset restores)" className={tbtn}>
            {isVehicle ? "Stop" : "Hold"}
          </button>
          <label className="flex items-center gap-1 text-xs text-nx-body">
            <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
            Follow {isVehicle ? "vehicle" : isShared ? "selected" : "vessel"}
          </label>
          <label className="flex items-center gap-1 text-xs text-nx-body" title="Toggle name labels">
            <input type="checkbox" checked={labelsOn} onChange={(e) => setLabelsOn(e.target.checked)} />
            Labels
          </label>
          <span className="mx-1 h-5 w-px bg-nx-line" />
          <select
            value={overlay}
            onChange={(e) => setOverlay(e.target.value as OverlayMode)}
            title="Overlay mode: what the 3D view emphasizes"
            className={darkInput}
          >
            {OVERLAY_MODES.map((m) => (
              <option key={m.id} value={m.id} title={m.hint}>
                {m.label}
              </option>
            ))}
          </select>
          <span className="mx-1 h-5 w-px bg-nx-line" />
          {REGION_NAV.map((r) => (
            <button key={r.preset} onClick={() => requestView(r.preset)} title={`Camera: ${r.label}`} className="rounded border border-nx-line px-2 py-1 text-[11px] capitalize text-nx-body hover:border-nx-accent">
              {r.label}
            </button>
          ))}
          <button onClick={toggleFullscreen} title="Full-screen 3D view" className={tbtn}>
            Full screen
          </button>
          <button onClick={() => void openReport()} title="After-action engineering report" className={tbtn}>
            Report
          </button>
        </div>
        {error && (
          <button onClick={() => setError(null)} className="shrink-0 border-b border-nx-bad/40 bg-nx-bad/10 px-4 py-1.5 text-left text-xs text-nx-badink">
            {error} (click to dismiss)
          </button>
        )}
        {notice && (
          <button onClick={() => setNotice(null)} className="shrink-0 border-b border-nx-accent/40 bg-nx-accent/10 px-4 py-1.5 text-left text-xs text-nx-body">
            {notice} (click to dismiss)
          </button>
        )}
        {placing && (
          <p className="shrink-0 border-b border-nx-accent/40 bg-nx-accent/10 px-4 py-1.5 text-xs font-medium text-nx-accent">
            Placement mode: click anywhere in the world to position the selected infrastructure.
          </p>
        )}
        <div className="relative min-h-0 flex-1">
          <div ref={stageRef} className="absolute inset-0 bg-nx-workspace">
              {!topology ? (
                <div className="flex h-full items-center justify-center text-sm text-nx-muted">Loading 3D world…</div>
              ) : (
                <WorldScene
                  topology={topology}
                  sim={sim}
                  selectedNodeId={selectedNodeId}
                  selectedLinkId={selectedLinkId}
                  focusLinkIds={focusLinkIds}
                  messageFlow={msgFlow}
                  follow={follow}
                  view={view}
                  overlay={overlay}
                  regions={regions}
                  selectedBuildingId={selectedBuildingId}
                  placing={placing}
                  labelsOn={labelsOn}
                  onPickNode={(id) => {
                    clearSelection();
                    setSelectedNodeId(id);
                  }}
                  onPickLink={(id) => {
                    clearSelection();
                    setSelectedLinkId(id);
                  }}
                  onPickBuilding={(id) => {
                    clearSelection();
                    setSelectedBuildingId(id);
                  }}
                  onPickRegion={(id) => {
                    clearSelection();
                    setSelectedRegionId(id);
                  }}
                  onPlacePoint={(x, y) => void handlePlacePoint(x, y)}
                />
              )}
              <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-3 rounded bg-nx-panel/90 px-2.5 py-1.5 text-[10px] text-nx-body">
                <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-blue-500" />Active</span>
                <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-sky-300" />Selected route</span>
                <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-nx-ok" />Backup</span>
                <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-nx-warn" />Unsuitable</span>
                <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-nx-bad" />Down</span>
                <span className="text-nx-muted">Satellite schematic, not to scale</span>
                <FpsMeter />
              </div>
            </div>
          </div>
          {showReport && report && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-nx-workspace/80 p-6">
              <div className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-nx-panel shadow-xl">
                <div className="flex items-center justify-between border-b border-nx-line px-4 py-2">
                  <h2 className="text-sm font-semibold text-nx-ink">
                    After-action report · {report.scenario_id} · tick {report.tick} · t={report.sim_time_s.toFixed(0)}s
                  </h2>
                  <div className="flex gap-2">
                    <button onClick={downloadReport} className="rounded border border-nx-line px-2 py-1 text-xs text-nx-body">
                      Download JSON
                    </button>
                    <button onClick={() => setShowReport(false)} className="rounded bg-nx-ink px-2 py-1 text-xs font-medium text-nx-workspace">
                      Close
                    </button>
                  </div>
                </div>
                <div className="space-y-3 overflow-y-auto p-4 text-xs text-nx-body">
                  <p>
                    Policy <strong>{report.policy}</strong> · availability{" "}
                    <strong>{(report.availability * 100).toFixed(1)}%</strong> · {report.handovers.length} handovers ·{" "}
                    {report.disconnection_periods.length} disconnection periods
                  </p>
                  <div>
                    <h3 className="font-semibold text-nx-ink">Endpoints</h3>
                    <div className="mt-1 space-y-1">
                      {report.endpoints.map((e) => (
                        <p key={e.endpoint_id} className="rounded bg-nx-raised px-2 py-1">
                          <strong>{e.label}</strong> · {e.route_changes} route changes · {e.handovers} handovers ·{" "}
                          {e.disconnected_periods} outages ·{" "}
                          {e.min_latency_ms != null ? `${e.min_latency_ms.toFixed(0)}–${(e.max_latency_ms ?? 0).toFixed(0)} ms` : "no connectivity"} ·{" "}
                          {e.min_bandwidth_mbps != null ? `≥${e.min_bandwidth_mbps} Mbps` : ""} · {e.technologies_used.join(", ")}
                        </p>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h3 className="font-semibold text-nx-ink">
                      Costs ({report.costs.currency}, {report.costs.assumption})
                    </h3>
                    <p className="mt-1">
                      Equipment capex ≈ <strong>${report.costs.capex_usd_approx.toLocaleString()}</strong> · opex ≈{" "}
                      <strong>${report.costs.opex_usd_per_month.toLocaleString()}/mo</strong>
                    </p>
                    <div className="mt-1 space-y-1">
                      {report.costs.priced_links.map((l) => (
                        <p key={l.link_id} className="rounded bg-nx-raised px-2 py-1">
                          {l.label} ({l.technology}): ${l.cost_per_gb_usd.toFixed(2)}/GB
                        </p>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h3 className="font-semibold text-nx-ink">Recommendations</h3>
                    <ul className="mt-1 list-disc space-y-1 pl-5">
                      {report.recommendations.map((r, i) => (
                        <li key={i}>
                          <strong>{r.finding}.</strong> {r.suggestion}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h3 className="font-semibold text-nx-ink">Assumptions &amp; confidence</h3>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5 text-nx-muted">
                      {report.assumptions.map((a, i) => (
                        <li key={i}>{a}</li>
                      ))}
                    </ul>
                    <p className="mt-1 text-nx-muted">Confidence: {report.confidence}</p>
                  </div>
                </div>
              </div>
            </div>
          )}
      </div>
    </WorkbenchShell>
  );
}

export default function SimulationPage() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center text-sm text-nx-muted">Loading…</div>}>
      <SimulationPageInner />
    </Suspense>
  );
}
