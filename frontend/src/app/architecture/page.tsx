"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import WorkbenchShell from "@/components/workbench/WorkbenchShell";
import ArchitectureCanvas, { uid, type Selection } from "@/components/ArchitectureCanvas";
import DeviceArt from "@/components/devices/DeviceArt";
import { useAssistant, useAssistantContext } from "@/components/assistant/AssistantProvider";
import LinkInspector, { type LinkPatch } from "@/components/workbench/LinkInspector";
import NodePortsEditor, { type NodePatch } from "@/components/workbench/NodePortsEditor";
import {
  createScenario,
  duplicateScenario,
  fetchHardware,
  fetchScenario,
  fetchScenarios,
  fetchSimulationEvents,
  fetchSimulationState,
  fetchTopology,
  patchScenarioLink,
  patchScenarioNode,
  updateScenario,
  validateArchitecture,
  type DeviceSpec,
  type ScenarioDetail,
  type ScenarioSummary,
  type SimulationEvent,
  type SimulationState,
  type Topology,
  type TopologyNode,
  type ValidationResult,
} from "@/lib/api";

const NODE_TYPES = ["ship", "car", "aircraft", "train", "base_station", "satellite", "gateway", "router", "switch", "internet", "sensor", "server"];
const HISTORY_LIMIT = 50;

function ArchitecturePageInner() {
  const searchParams = useSearchParams();
  const [topology, setTopology] = useState<Topology | null>(null);
  const [sim, setSim] = useState<SimulationState | null>(null);
  const [events, setEvents] = useState<SimulationEvent[]>([]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([]);
  const [scenarioId, setScenarioId] = useState<string>("maritime_failover");
  const [scenarioVersion, setScenarioVersion] = useState<number | null>(null);
  const [scenarioName, setScenarioName] = useState("Maritime Failover");
  const [devices, setDevices] = useState<DeviceSpec[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [nodeType, setNodeType] = useState("router");
  const [libraryQuery, setLibraryQuery] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ id: string; nonce: number } | null>(null);
  const { setScenarioId: setAssistantScenario } = useAssistant();
  useAssistantContext(
    {
      node_id: selection?.kind === "node" ? selection.node?.id : undefined,
      node_label: selection?.kind === "node" ? selection.node?.label : undefined,
      link_id: selection?.kind === "edge" ? selection.edge?.id : undefined,
      link_label:
        selection?.kind === "edge" && selection.edge
          ? `${selection.edge.source} → ${selection.edge.target}`
          : undefined,
    },
    [selection]
  );
  useEffect(() => {
    setAssistantScenario(scenarioId);
  }, [scenarioId, setAssistantScenario]);
  const past = useRef<Topology[]>([]);
  const future = useRef<Topology[]>([]);
  const nonce = useRef(0);
  const [histTick, setHistTick] = useState(0);
  void histTick;

  const refreshSim = useCallback(async (sid: string | undefined) => {
    try {
      const [state, log] = await Promise.all([fetchSimulationState(sid), fetchSimulationEvents(sid)]);
      setSim(state);
      setEvents(log.events);
    } catch {
      setSim(null);
    }
  }, []);

  useEffect(() => {
    fetchScenarios().then(setScenarios).catch(() => {});
    const sid = searchParams.get("scenario") || "maritime_failover";
    const addDeviceId = searchParams.get("add");
    const selectId = searchParams.get("select");
    setScenarioId(sid);
    (async () => {
      try {
        const library = await fetchHardware().catch(() => [] as DeviceSpec[]);
        setDevices(library);
        let topo: Topology;
        if (sid === "maritime_failover") {
          try {
            const detail = await fetchScenario(sid);
            topo = detail.topology;
            setScenarioVersion(detail.version);
            setScenarioName(detail.name);
          } catch {
            topo = await fetchTopology();
          }
        } else {
          const detail = await fetchScenario(sid);
          topo = detail.topology;
          setScenarioVersion(detail.version);
          setScenarioName(detail.name);
        }
        if (addDeviceId) {
          const device = library.find((d) => d.device_id === addDeviceId);
          if (device) {
            const id = uid("node");
            const node: TopologyNode = {
              id,
              type: device.category,
              label: device.name,
              device_id: device.device_id,
              supported_technologies: device.interfaces.map((i) => i.technology),
              properties: { note: "synthetic example" },
            };
            topo = { ...topo, nodes: [...topo.nodes, node] };
            setSelection({ kind: "node", node });
            nonce.current += 1;
            setFocusRequest({ id, nonce: nonce.current });
            setMessage(`Added ${device.name} from the Hardware Library.`);
          } else {
            setError(`Device ${addDeviceId} not found in the library.`);
          }
        }
        // Deep link from the 3D world (?select=<nodeId>): select + frame it.
        if (selectId && !addDeviceId) {
          const hit = topo.nodes.find((n) => n.id === selectId);
          if (hit) {
            setSelection({ kind: "node", node: hit });
            nonce.current += 1;
            setFocusRequest({ id: hit.id, nonce: nonce.current });
            setMessage(`Opened ${hit.label} from the 3D world. Interface edits save back to the same node.`);
          } else {
            setError(`Node ${selectId} is not in this scenario.`);
          }
        }
        setTopology(topo);
        past.current = [];
        future.current = [];
        setDirty(!!addDeviceId);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load topology");
      }
      await refreshSim(sid === "maritime_failover" ? undefined : sid);
    })();
  }, [searchParams, refreshSim]);

  const commit = useCallback(
    (next: Topology, opts?: { transient?: boolean }) => {
      setTopology((prev) => {
        if (prev && !opts?.transient) {
          past.current = [...past.current.slice(-HISTORY_LIMIT + 1), prev];
          future.current = [];
        }
        return next;
      });
      setDirty(true);
      setValidation(null);
      setHistTick((t) => t + 1);
    },
    []
  );

  const undo = useCallback(() => {
    setTopology((prev) => {
      if (!prev || past.current.length === 0) return prev;
      const last = past.current[past.current.length - 1];
      past.current = past.current.slice(0, -1);
      future.current = [...future.current, prev];
      setSelection(null);
      setDirty(true);
      setHistTick((t) => t + 1);
      return last;
    });
  }, []);

  const redo = useCallback(() => {
    setTopology((prev) => {
      if (!prev || future.current.length === 0) return prev;
      const next = future.current[future.current.length - 1];
      future.current = future.current.slice(0, -1);
      past.current = [...past.current.slice(-HISTORY_LIMIT + 1), prev];
      setSelection(null);
      setDirty(true);
      setHistTick((t) => t + 1);
      return next;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  const openScenario = async (sid: string) => {
    setError(null);
    setMessage(null);
    setSelection(null);
    setScenarioId(sid);
    try {
      const detail = await fetchScenario(sid);
      setTopology(detail.topology);
      setScenarioVersion(detail.version);
      setScenarioName(detail.name);
      past.current = [];
      future.current = [];
      setDirty(false);
      await refreshSim(sid === "maritime_failover" ? undefined : sid);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to open scenario");
    }
  };

  const addDevice = () => {
    if (!topology) return;
    const device = devices.find((d) => d.device_id === deviceId);
    const id = uid("node");
    const node: TopologyNode = {
      id,
      type: device ? device.category : nodeType,
      label: device ? device.name : `New ${nodeType}`,
      // No position: the canvas places it at the visible viewport center.
      device_id: device?.device_id,
      supported_technologies: device ? device.interfaces.map((i) => i.technology) : [],
      properties: { note: "synthetic example" },
    };
    const next = { ...topology, nodes: [...topology.nodes, node] };
    commit(next);
    setSelection({ kind: "node", node });
    nonce.current += 1;
    setFocusRequest({ id, nonce: nonce.current });
    setMessage(`Added ${node.label}. Drag to position, then connect it to the topology.`);
  };

  const removeSelected = () => {
    if (!topology || !selection) return;
    if (selection.kind === "node" && selection.node) {
      const id = selection.node.id;
      commit({
        ...topology,
        nodes: topology.nodes.filter((n) => n.id !== id),
        links: topology.links.filter((l) => l.source !== id && l.target !== id),
      });
      setSelection(null);
    } else if (selection.kind === "edge" && selection.edge) {
      const id = selection.edge.id;
      commit({ ...topology, links: topology.links.filter((l) => l.id !== id) });
      setSelection(null);
    }
  };

  const duplicateSelected = () => {
    if (!topology || selection?.kind !== "node" || !selection.node) return;
    const src = selection.node;
    const id = uid("node");
    const node: TopologyNode = {
      ...src,
      id,
      label: `${src.label} (copy)`,
      position: { x: (src.position?.x ?? 100) + 60, y: (src.position?.y ?? 100) + 60 },
    };
    commit({ ...topology, nodes: [...topology.nodes, node] });
    setSelection({ kind: "node", node });
    nonce.current += 1;
    setFocusRequest({ id, nonce: nonce.current });
  };

  const doValidate = async () => {
    if (!topology) return;
    try {
      const result = await validateArchitecture(topology);
      setValidation(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Validation failed");
    }
  };

  const doSave = async () => {
    if (!topology) return;
    setError(null);
    setSaving(true);
    try {
      if (scenarioId === "maritime_failover") {
        const created = await createScenario(`${scenarioName} (edited)`, topology.metadata.environment || "maritime", topology);
        setScenarioId(created.id);
        setScenarioName(created.name);
        setScenarioVersion(created.version);
        setScenarios(await fetchScenarios());
        setMessage(`Saved as new scenario ${created.id} (maritime regression kept read-only).`);
      } else {
        if (scenarioVersion === null) throw new Error("Scenario revision unavailable; reload before saving.");
        const updated = await updateScenario(scenarioId, scenarioName, topology.metadata.environment || "generic", topology, scenarioVersion);
        setScenarioVersion(updated.version);
        setScenarioName(updated.name);
        setMessage(`Saved scenario ${updated.id} (version ${updated.version}).`);
      }
      setDirty(false);
      setSavedAt(new Date().toLocaleTimeString());
      await refreshSim(scenarioId === "maritime_failover" ? undefined : scenarioId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const saveDraftCopy = async () => {
    if (!topology) return;
    setSaving(true);
    setError(null);
    try {
      const created = await createScenario(`${scenarioName} (copy)`, topology.metadata.environment || "generic", topology);
      setScenarioId(created.id);
      setScenarioName(created.name);
      setScenarioVersion(created.version);
      setDirty(false);
      setSavedAt(new Date().toLocaleTimeString());
      setScenarios(await fetchScenarios());
      setMessage("Saved your current edits as a new scenario.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save a copy");
    } finally {
      setSaving(false);
    }
  };

  const refreshSelection = (detail: ScenarioDetail, prev: Selection | null): Selection | null => {
    if (!prev) return prev;
    if (prev.kind === "node" && prev.node) {
      const node = detail.topology.nodes.find((n) => n.id === prev.node!.id);
      return node ? { kind: "node", node } : null;
    }
    if (prev.kind === "edge" && prev.edge) {
      const edge = detail.topology.links.find((l) => l.id === prev.edge!.id);
      return edge ? { kind: "edge", edge } : null;
    }
    return prev;
  };

  const applyPatch = useCallback(
    async (kind: "node" | "link", id: string, patch: NodePatch | LinkPatch): Promise<ScenarioDetail> => {
      if (!topology) throw new Error("No topology loaded");
      let sid = scenarioId;
      if (dirty) {
        if (sid === "maritime_failover") {
          const created = await createScenario(
            `${scenarioName} (edited)`,
            topology.metadata.environment || "maritime",
            topology,
          );
          sid = created.id;
          setScenarioId(sid);
          setScenarioName(created.name);
          setScenarios(await fetchScenarios());
        } else {
          if (scenarioVersion === null) throw new Error("Scenario revision unavailable; reload before saving.");
          const updated = await updateScenario(sid, scenarioName, topology.metadata.environment || "generic", topology, scenarioVersion);
          setScenarioVersion(updated.version);
        }
        setDirty(false);
        setSavedAt(new Date().toLocaleTimeString());
      }
      const detail =
        kind === "node"
          ? await patchScenarioNode(sid, id, patch as NodePatch)
          : await patchScenarioLink(sid, id, patch as LinkPatch);
      if (detail.id !== sid) {
        setScenarioId(detail.id);
        setScenarioName(detail.name);
        setScenarios(await fetchScenarios());
        setMessage(`Saved as new scenario ${detail.id} (maritime regression kept read-only).`);
      } else {
        setMessage(`Saved ${kind} ${id} (version ${detail.version}).`);
      }
      setTopology(detail.topology);
      setScenarioVersion(detail.version);
      setSelection((prev) => refreshSelection(detail, prev));
      await refreshSim(detail.id === "maritime_failover" ? undefined : detail.id);
      return detail;
    },
    [topology, dirty, scenarioId, scenarioName, scenarioVersion, refreshSim],
  );

  const doDuplicate = async () => {
    setError(null);
    try {
      const created = await duplicateScenario(scenarioId);
      setScenarios(await fetchScenarios());
      setMessage(`Duplicated as ${created.id}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Duplicate failed");
    }
  };

  const exportJson = () => {
    if (!topology) return;
    const blob = new Blob([JSON.stringify(topology, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${scenarioId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJson = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        if (!data.nodes || !data.links || !data.metadata) throw new Error("Not a NexusLayer topology file");
        commit(data);
        setMessage(`Imported ${file.name}. Save to persist it as a scenario.`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Import failed");
      }
    };
    reader.readAsText(file);
  };

  const btn = "rounded border border-nx-line bg-nx-panel px-2 py-1 text-xs text-nx-body hover:border-nx-accent disabled:cursor-not-allowed disabled:opacity-40";
  const field = "rounded border border-nx-line bg-nx-workspace px-2 py-1 text-xs text-nx-ink";

  const libraryGroups = useMemo(() => {
    const q = libraryQuery.trim().toLowerCase();
    const filtered = q
      ? devices.filter(
          (d) =>
            d.name.toLowerCase().includes(q) ||
            d.category.toLowerCase().includes(q) ||
            d.device_id.toLowerCase().includes(q)
        )
      : devices;
    const groups = new Map<string, DeviceSpec[]>();
    for (const d of filtered) {
      const list = groups.get(d.category) ?? [];
      list.push(d);
      groups.set(d.category, list);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [devices, libraryQuery]);

  const toggleGroup = (category: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  const addDeviceById = (id: string) => {
    if (!topology) return;
    const device = devices.find((d) => d.device_id === id);
    if (!device) return;
    const nodeId = uid("node");
    const node: TopologyNode = {
      id: nodeId,
      type: device.category,
      label: device.name,
      device_id: device.device_id,
      supported_technologies: device.interfaces.map((i) => i.technology),
      properties: { note: "synthetic example" },
    };
    commit({ ...topology, nodes: [...topology.nodes, node] });
    setSelection({ kind: "node", node });
    nonce.current += 1;
    setFocusRequest({ id: nodeId, nonce: nonce.current });
    setMessage(`Added ${node.label}. Drag to position, then connect it to the topology.`);
  };

  const externalSelection = selection
    ? selection.kind === "node" && selection.node
      ? { kind: "node" as const, id: selection.node.id, nonce: 0 }
      : selection.kind === "edge" && selection.edge
        ? { kind: "edge" as const, id: selection.edge.id, nonce: 0 }
        : null
    : null;

  const saveState = dirty ? (
    <span className="text-nx-warn">● Unsaved changes</span>
  ) : savedAt ? (
    `Saved ${savedAt}`
  ) : (
    "No changes"
  );

  return (
    <WorkbenchShell
      project={
        <>
          <select
            value={scenarioId}
            onChange={(e) => void openScenario(e.target.value)}
            className={`${field} max-w-56`}
            title="Scenario"
          >
            {scenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.environment})
              </option>
            ))}
          </select>
          <input
            value={scenarioName}
            onChange={(e) => setScenarioName(e.target.value)}
            className={`${field} w-40`}
            title="Scenario name"
          />
          <span className="whitespace-nowrap font-mono text-[11px] text-nx-muted">
            {saveState}
            {" · "}
            {validation ? validation.summary : topology ? `${topology.nodes.length} nodes · ${topology.links.length} links` : "Loading…"}
          </span>
        </>
      }
      actions={
        <>
          <button onClick={() => void doSave()} disabled={saving || !topology} className="nx-btn-primary">
            {saving ? "Saving…" : "Save"}
          </button>
          <button onClick={() => void saveDraftCopy()} disabled={saving || !topology} className={btn}>Save copy</button>
          <button onClick={undo} disabled={past.current.length === 0} title="Undo (Ctrl+Z)" className={btn}>Undo</button>
          <button onClick={redo} disabled={future.current.length === 0} title="Redo (Ctrl+Y)" className={btn}>Redo</button>
          <button onClick={() => void doDuplicate()} className={btn}>Duplicate</button>
          <button onClick={() => void doValidate()} className={btn}>Validate</button>
          <button onClick={exportJson} className={btn}>Export</button>
          <label className={`${btn} cursor-pointer`}>
            Import
            <input
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importJson(f);
                e.target.value = "";
              }}
            />
          </label>
          <a href={`/simulation?scenario=${encodeURIComponent(scenarioId)}`} className="rounded bg-nx-ink px-2 py-1 text-xs font-medium text-nx-workspace hover:bg-nx-body">
            Open in 3D
          </a>
        </>
      }
      leftTitle="Device library"
      leftPanel={
        <div className="flex flex-col gap-2">
          <input
            value={libraryQuery}
            onChange={(e) => setLibraryQuery(e.target.value)}
            placeholder="Search devices…"
            className={field}
            aria-label="Search devices"
          />
          <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)} className={field} aria-label="Device">
            <option value="">Blank node…</option>
            {devices.map((d) => (
              <option key={d.device_id} value={d.device_id}>
                {d.name} ({d.category})
              </option>
            ))}
          </select>
          {!deviceId && (
            <select value={nodeType} onChange={(e) => setNodeType(e.target.value)} className={field} aria-label="Blank node type">
              {NODE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          )}
          <button onClick={addDevice} className="nx-btn-primary">
            Add to canvas
          </button>
          <p className="text-[10px] leading-relaxed text-nx-muted">
            Drag handles between nodes to create links. Shift+click selects multiple. Del removes.
          </p>
          <div className="flex gap-2">
            <button onClick={duplicateSelected} disabled={selection?.kind !== "node"} className={`${btn} flex-1`}>
              Duplicate
            </button>
            <button onClick={removeSelected} disabled={!selection} className="flex-1 rounded border border-nx-bad/50 px-2 py-1 text-xs text-nx-badink hover:border-nx-bad disabled:opacity-40">
              Remove
            </button>
          </div>
          <div className="mt-1 border-t border-nx-line pt-2">
            <p className="nx-label pb-1">Catalog · one-click add</p>
            {libraryGroups.length === 0 && (
              <p className="text-[11px] text-nx-muted">No devices match “{libraryQuery}”.</p>
            )}
            {libraryGroups.map(([category, list]) => (
              <div key={category} className="mb-1">
                <button
                  onClick={() => toggleGroup(category)}
                  aria-expanded={!collapsedGroups.has(category)}
                  className="flex w-full items-center gap-1 rounded px-1 py-1 text-left font-mono text-[11px] font-medium text-nx-body hover:bg-nx-raised"
                >
                  <span className="text-nx-muted">{collapsedGroups.has(category) ? "▸" : "▾"}</span>
                  {category}
                  <span className="ml-auto text-nx-muted">{list.length}</span>
                </button>
                {!collapsedGroups.has(category) && (
                  <div className="ml-3 flex flex-col gap-0.5 border-l border-nx-line pl-2">
                    {list.map((d) => (
                      <button
                        key={d.device_id}
                        onClick={() => addDeviceById(d.device_id)}
                        title={`${d.name} — click to add`}
                        className="rounded px-1.5 py-1 text-left text-[11px] text-nx-body hover:bg-nx-raised hover:text-nx-ink"
                      >
                        {d.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      }
      rightTitle="Inspector"
      rightPanel={
        <div>
          {!selection && <p className="mt-1 text-[11px] text-nx-muted">Select a node or link.</p>}
          {selection?.kind === "node" && selection.node && (
            <div className="nx-swap mt-1 text-[11px] text-nx-body" key={selection.node.id}>
              <div className="overflow-hidden rounded border border-nx-line bg-nx-workspace">
                <div className="h-28">
                  <DeviceArt kind={selection.node.type} label={selection.node.label} />
                </div>
              </div>
              <p className="mt-2 text-xs font-semibold text-nx-ink">{selection.node.label}</p>
              <p className="font-mono text-nx-muted">{selection.node.type} · {selection.node.id}</p>
              {selection.node.device_id && (
                <p className="mt-1">
                  Device:{" "}
                  <a
                    href={`/hardware?device=${encodeURIComponent(selection.node.device_id)}`}
                    className="text-nx-accent hover:underline"
                  >
                    {selection.node.device_id}
                  </a>
                </p>
              )}
              {(selection.node.supported_technologies ?? []).length > 0 && (
                <p className="mt-1">Interfaces: {selection.node.supported_technologies!.join(", ")}</p>
              )}
              {selection.node.world_position ? (
                <p className="mt-1 font-mono">
                  World: {selection.node.world_position.x_km.toFixed(1)}, {selection.node.world_position.y_km.toFixed(1)} km
                </p>
              ) : (
                <p className="mt-1 text-nx-warn">No world placement yet — open in 3D to place it.</p>
              )}
              <a
                href={`/simulation?scenario=${encodeURIComponent(scenarioId)}&focus=${encodeURIComponent(selection.node.id)}`}
                className="mt-2 inline-block rounded border border-nx-line px-2 py-1 text-[11px] hover:border-nx-accent"
              >
                View in 3D →
              </a>
              <NodePortsEditor
                node={selection.node}
                onPatch={(patch) => applyPatch("node", selection.node!.id, patch)}
              />
            </div>
          )}
          {selection?.kind === "edge" && selection.edge && (
            <LinkInspector
              scenarioId={scenarioId}
              edge={selection.edge}
              onPatch={(patch) => applyPatch("link", selection.edge!.id, patch)}
            />
          )}
        </div>
      }
      dockTabs={[
        {
          id: "events",
          label: "Events",
          badge: events.length,
          content: (
            <div className="space-y-0.5">
              {events.length === 0 && <p className="text-[11px] text-nx-muted">No events yet.</p>}
              {events.slice(-60).map((e) => (
                <p key={e.seq} className="font-mono text-[10px] text-nx-muted">
                  #{e.seq} <strong className="text-nx-body">{e.type}</strong> {e.message}
                </p>
              ))}
            </div>
          ),
        },
        {
          id: "route",
          label: "Route",
          content: sim?.decision ? (
            <p className="max-w-4xl text-[11px] leading-relaxed text-nx-body">{sim.decision.explanation}</p>
          ) : (
            <p className="text-[11px] text-nx-muted">No simulation state for this scenario yet.</p>
          ),
        },
        {
          id: "validation",
          label: "Validation",
          badge: validation ? (validation.issues.length === 0 ? "✓" : String(validation.issues.length)) : "",
          content: !validation ? (
            <p className="text-[11px] text-nx-muted">Run Validate to check this architecture.</p>
          ) : (
            <div>
              {validation.issues.length === 0 && <p className="text-[11px] text-nx-ok">No issues found.</p>}
              {validation.issues.map((issue, i) => (
                <p key={i} className={`mt-1 text-[11px] leading-snug ${issue.severity === "error" ? "text-nx-badink" : "text-nx-warn"}`}>
                  {issue.severity}: {issue.message}
                </p>
              ))}
              {validation.recommendations.map((r, i) => (
                <p key={`r${i}`} className="mt-1 text-[11px] leading-snug text-nx-accent">
                  Suggestion: {r}
                </p>
              ))}
            </div>
          ),
        },
      ]}
      centerScroll={false}
    >
      <div className="flex h-full flex-col">
        {message && (
          <button onClick={() => setMessage(null)} className="shrink-0 border-b border-nx-accent/30 bg-nx-accent/10 px-4 py-1.5 text-left text-xs text-nx-accent">
            {message} (click to dismiss)
          </button>
        )}
        {error && (
          <button onClick={() => setError(null)} className="shrink-0 border-b border-nx-bad/40 bg-nx-bad/10 px-4 py-1.5 text-left text-xs text-nx-badink">
            {error} (click to dismiss)
          </button>
        )}
        <div className="relative min-h-0 flex-1">
          {!topology ? (
            <div className="flex h-full items-center justify-center text-sm text-nx-muted">Loading architecture…</div>
          ) : (
            <ArchitectureCanvas
              topology={topology}
              sim={sim}
              focusRequest={focusRequest}
              externalSelection={externalSelection}
              onChange={(t, opts) => commit(t, opts)}
              onSelect={setSelection}
              onError={(m) => setError(m)}
            />
          )}
        </div>
      </div>
    </WorkbenchShell>
  );
}

export default function ArchitecturePage() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center bg-[#14171a] text-sm text-[#8b949e]">Loading…</div>}>
      <ArchitecturePageInner />
    </Suspense>
  );
}
