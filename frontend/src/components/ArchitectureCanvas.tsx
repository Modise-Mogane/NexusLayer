"use client";

/* Network Architecture Studio canvas.
   Correct controlled-flow pattern: ALL React Flow changes (dimensions,
   selection, position) are applied via applyNodeChanges/applyEdgeChanges.
   Dropping dimension changes leaves nodes permanently visibility:hidden. */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import StudioNode from "@/components/nodes/StudioNode";
import {
  type LinkState,
  type NodeState,
  type SimulationState,
  type Topology,
  type TopologyLink,
  type TopologyNode,
} from "@/lib/api";

export interface Selection {
  kind: "node" | "edge";
  node?: TopologyNode;
  edge?: TopologyLink;
}

const nodeTypes = { studio: StudioNode };

let counter = 0;
export const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${counter++}`;

/* Technology family → dash pattern so link categories read visually. */
function techDash(technology: string, medium?: string): string | undefined {
  const t = technology.toLowerCase();
  if (t.includes("ethernet") || t.includes("fiber") || t.includes("optical")) return undefined;
  if (t.includes("vsat") || t.includes("satellite") || t.includes("ka-band") || t.includes("feeder"))
    return "14 4 3 4";
  if (t.includes("cellular") || t.includes("lte") || t.includes("5g") || t.includes("4g")) return "10 4";
  if (t.includes("wi-fi") || t.includes("wifi") || t.includes("802.11")) return "3 3";
  if (t.includes("microwave") || t.includes("ptp") || t.includes("radio") || t.includes("lora") || t.includes("lpwan"))
    return "6 3";
  if (t.includes("experiment")) return "2 3";
  return medium === "wireless" ? "8 4" : undefined;
}

interface EdgeVisual {
  stroke: string;
  strokeWidth: number;
  strokeDasharray?: string;
  animated: boolean;
  suffix: string;
}

function edgeVisual(link: TopologyLink, state?: LinkState): EdgeVisual {
  const tech = techDash(link.technology, link.medium);
  if (state?.status === "down") {
    return { stroke: "#ae413a", strokeWidth: 2.5, strokeDasharray: "7 5", animated: false, suffix: " (down)" };
  }
  if (state && !state.suitable) {
    return { stroke: "#9b6c19", strokeWidth: 2.5, strokeDasharray: "7 5", animated: false, suffix: " (unsuitable)" };
  }
  if (state?.on_active_route) {
    return { stroke: "#087f78", strokeWidth: 3, animated: true, suffix: "" };
  }
  if (state?.on_backup_route) {
    return { stroke: "#27845c", strokeWidth: 2, strokeDasharray: tech, animated: false, suffix: "" };
  }
  if (link.status === "standby") {
    return { stroke: "#9b6c19", strokeWidth: 2, strokeDasharray: tech ?? "6 4", animated: false, suffix: "" };
  }
  return { stroke: "#5c7680", strokeWidth: 2, strokeDasharray: tech, animated: false, suffix: "" };
}

function nodeStatus(topology: Topology, sim: SimulationState | null, id: string) {
  const node = topology.nodes.find((n) => n.id === id);
  const state = sim?.nodes.find((n) => n.id === id);
  const operational = state ? state.status === "up" && state.reachable : true;
  return {
    label: node?.label ?? id,
    nodeType: node?.type ?? "generic",
    operational,
    onActiveRoute: state?.on_active_route ?? false,
    ifaceCount: state?.interfaces.length ?? node?.supported_technologies?.length ?? 0,
  };
}

function buildNodes(
  topology: Topology,
  sim: SimulationState | null,
  prev: Node[],
  center: { x: number; y: number }
): Node[] {
  const prevById = new Map(prev.map((n) => [n.id, n]));
  return topology.nodes.map((n, i) => {
    const existing = prevById.get(n.id);
    return {
      id: n.id,
      type: "studio",
      position:
        existing?.position ??
        n.position ?? { x: center.x + ((i % 4) - 1.5) * 220, y: center.y + (Math.floor(i / 4) - 0.5) * 150 },
      data: nodeStatus(topology, sim, n.id),
      ...(existing?.width ? { width: existing.width, height: existing.height } : {}),
      ...(existing?.selected ? { selected: true } : {}),
    };
  });
}

function buildEdges(topology: Topology, sim: SimulationState | null, prev: Edge[], showLabels: boolean): Edge[] {
  const prevSelected = new Map(prev.filter((e) => e.selected).map((e) => [e.id, true]));
  const linkStates = new Map<string, LinkState>((sim?.links ?? []).map((l) => [l.id, l]));
  return topology.links.map((l) => {
    const visual = edgeVisual(l, linkStates.get(l.id));
    return {
      id: l.id,
      source: l.source,
      target: l.target,
      label: showLabels ? `${l.technology} · ${l.latency_ms} ms${visual.suffix}` : undefined,
      animated: visual.animated,
      style: {
        stroke: visual.stroke,
        strokeWidth: visual.strokeWidth,
        strokeDasharray: visual.strokeDasharray,
      },
      labelStyle: { fontSize: 10, fill: "#365762" },
      labelBgStyle: { fill: "#eef4f6" },
      labelBgPadding: [4, 4] as [number, number],
      // Selected edges glow and animate so the active inspection target
      // reads instantly; selection is preserved across rebuilds.
      ...(prevSelected.get(l.id)
        ? { selected: true, animated: true, style: {
              stroke: "#087f78", strokeWidth: 3,
            } }
        : {}),
    };
  });
}

function CanvasInner({
  topology,
  sim,
  focusRequest,
  externalSelection,
  onChange,
  onSelect,
  onError,
}: {
  topology: Topology;
  sim: SimulationState | null;
  focusRequest: { id: string; nonce: number } | null;
  externalSelection: { kind: "node" | "edge"; id: string; nonce: number } | null;
  onChange: (topology: Topology, opts?: { transient?: boolean }) => void;
  onSelect: (selection: Selection | null) => void;
  onError: (message: string) => void;
}) {
  const { fitView, setCenter, zoomIn, zoomOut, screenToFlowPosition } = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [snap, setSnap] = useState(true);
  const [showLinkLabels, setShowLinkLabels] = useState(topology.links.length <= 16);
  const [rfNodes, setRfNodes] = useState<Node[]>(() =>
    buildNodes(topology, sim, [], { x: 300, y: 200 })
  );
  const [rfEdges, setRfEdges] = useState<Edge[]>(() => buildEdges(topology, sim, [], showLinkLabels));
  const topoKey = useMemo(
    () =>
      topology.nodes.map((n) => n.id).join(",") +
      "|" +
      topology.links.map((l) => `${l.id}:${l.source}>${l.target}`).join(","),
    [topology]
  );
  const prevKey = useRef(topoKey);

  /* Structural sync: scenario switch, add/remove. Preserves drag positions
     and measured dimensions for surviving ids; places newcomers at viewport
     center so added devices always appear in view. */
  useEffect(() => {
    if (prevKey.current === topoKey) return;
    prevKey.current = topoKey;
    const rect = wrapperRef.current?.getBoundingClientRect();
    const center = rect
      ? screenToFlowPosition({ x: rect.width / 2, y: rect.height / 2 })
      : { x: 300, y: 200 };
    setRfNodes((prev) => buildNodes(topology, sim, prev, center));
    setRfEdges((prev) => buildEdges(topology, sim, prev, showLinkLabels));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topoKey]);

  /* Live status patch: update data/visuals without dropping measurements. */
  useEffect(() => {
    setRfNodes((prev) =>
      prev.map((n) => ({ ...n, data: { ...n.data, ...nodeStatus(topology, sim, n.id) } }))
    );
    setRfEdges((prev) => buildEdges(topology, sim, prev, showLinkLabels));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sim, topology, showLinkLabels]);

  /* Fit once the scenario structure first arrives. */
  const fittedKey = useRef<string | null>(null);
  useEffect(() => {
    if (fittedKey.current !== topoKey && topology.nodes.length > 0) {
      fittedKey.current = topoKey;
      requestAnimationFrame(() => fitView({ padding: 0.15, maxZoom: 1.25 }));
    }
  }, [topoKey, topology.nodes.length, fitView]);

  /* Focus a node added/duplicated by the parent. */
  useEffect(() => {
    if (!focusRequest) return;
    setRfNodes((prev) =>
      prev.map((n) => (n.id === focusRequest.id ? { ...n, selected: true } : { ...n, selected: false }))
    );
    const t = setTimeout(() => {
      const el = wrapperRef.current?.querySelector(`.react-flow__node[data-id="${focusRequest.id}"]`);
      if (el) {
        const r = (el as HTMLElement).getBoundingClientRect();
        const w = wrapperRef.current!.getBoundingClientRect();
        if (r.x < w.x || r.right > w.right || r.y < w.y || r.bottom > w.bottom) {
          const pos = screenToFlowPosition({ x: w.width / 2, y: w.height / 2 });
          void pos;
          fitView({ padding: 0.2, maxZoom: 1.1 });
        }
      }
    }, 60);
    return () => clearTimeout(t);
  }, [focusRequest, fitView, screenToFlowPosition]);

  /* Reflect parent-driven selection (inspector actions, undo). */
  useEffect(() => {
    if (!externalSelection) return;
    if (externalSelection.kind === "node") {
      setRfNodes((prev) => prev.map((n) => ({ ...n, selected: n.id === externalSelection.id })));
      setRfEdges((prev) => prev.map((e) => ({ ...e, selected: false })));
    } else {
      setRfEdges((prev) => prev.map((e) => ({ ...e, selected: e.id === externalSelection.id })));
      setRfNodes((prev) => prev.map((n) => ({ ...n, selected: false })));
    }
  }, [externalSelection]);

  const byId = useMemo(
    () => ({
      nodes: new Map(topology.nodes.map((n) => [n.id, n])),
      edges: new Map(topology.links.map((l) => [l.id, l])),
    }),
    [topology]
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setRfNodes((nds) => applyNodeChanges(changes, nds));
      const sel = changes.find((c) => c.type === "select" && c.selected);
      if (sel && "id" in sel) {
        const found = byId.nodes.get(sel.id);
        onSelect(found ? { kind: "node", node: found } : null);
        setRfEdges((prev) => prev.map((e) => ({ ...e, selected: false })));
      }
    },
    [byId, onSelect]
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setRfEdges((eds) => applyEdgeChanges(changes, eds));
      const sel = changes.find((c) => c.type === "select" && (c as { selected?: boolean }).selected);
      if (sel && "id" in sel) {
        const found = byId.edges.get((sel as { id: string }).id);
        onSelect(found ? { kind: "edge", edge: found } : null);
        setRfNodes((prev) => prev.map((n) => ({ ...n, selected: false })));
      }
    },
    [byId, onSelect]
  );

  const onConnect = useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target) return;
      if (conn.source === conn.target) {
        onError("Cannot connect a device to itself.");
        return;
      }
      const duplicate = topology.links.some(
        (l) =>
          (l.source === conn.source && l.target === conn.target) ||
          (l.source === conn.target && l.target === conn.source)
      );
      if (duplicate) {
        onError("These devices are already connected.");
        return;
      }
      const src = byId.nodes.get(conn.source);
      const dst = byId.nodes.get(conn.target);
      const srcTechs = src?.supported_technologies ?? [];
      const dstTechs = dst?.supported_technologies ?? [];
      let technology = "Ethernet";
      let medium = "wired";
      if (srcTechs.length > 0 && dstTechs.length > 0) {
        const shared = srcTechs.find((t) =>
          dstTechs.some((d) => d.toLowerCase() === t.toLowerCase())
        );
        if (!shared) {
          onError(
            `Incompatible interfaces: ${src?.label ?? conn.source} offers ${srcTechs.join(", ") || "none"}, ` +
              `${dst?.label ?? conn.target} offers ${dstTechs.join(", ") || "none"}.`
          );
          return;
        }
        technology = shared;
        medium = /cellular|lte|5g|wifi|wi-fi|vsat|satellite|radio|microwave|lora/i.test(shared)
          ? "wireless"
          : "wired";
      } else if (srcTechs.length > 0) {
        technology = srcTechs[0];
      } else if (dstTechs.length > 0) {
        technology = dstTechs[0];
      }
      const link: TopologyLink = {
        id: uid("link"),
        source: conn.source,
        target: conn.target,
        label: "New link",
        latency_ms: 20,
        bandwidth_mbps: 100,
        reliability: 0.99,
        cost_per_gb: 0.1,
        status: "active",
        technology,
        medium,
      };
      onChange({ ...topology, links: [...topology.links, link] });
    },
    [topology, byId, onChange, onError]
  );

  return (
    <div ref={wrapperRef} className="relative h-full w-full bg-[#eef4f6]">
      {topology.nodes.length === 0 && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-[#eef4f6]/85">
          <p className="text-sm font-medium text-[#173b4a]">Empty architecture</p>
          <p className="max-w-xs text-center text-xs text-[#5c7680]">
            Add your first device from the panel on the left, then drag between
            handles to connect devices.
          </p>
        </div>
      )}
      <div className="absolute left-3 top-3 z-10 flex gap-1.5">
        <button
          onClick={() => fitView({ padding: 0.15, maxZoom: 1.25 })}
          title="Fit to network (F)"
          className="rounded border border-[#bed0d9] bg-[#ffffff] px-2 py-1 font-mono text-[11px] text-[#365762] hover:border-[#087f78]"
        >
          Fit
        </button>
        <button
          onClick={() => {
            const r = wrapperRef.current?.getBoundingClientRect();
            if (r) setCenter(r.width / 2, r.height / 2, { zoom: 1, duration: 200 });
          }}
          title="Center canvas"
          className="rounded border border-[#bed0d9] bg-[#ffffff] px-2 py-1 font-mono text-[11px] text-[#365762] hover:border-[#087f78]"
        >
          Center
        </button>
        <button
          onClick={() => setSnap((s) => !s)}
          title="Toggle snap-to-grid"
          className={`rounded border px-2 py-1 font-mono text-[11px] hover:border-[#087f78] ${
            snap ? "border-[#087f78]/60 bg-[#ffffff] text-[#087f78]" : "border-[#bed0d9] bg-[#ffffff] text-[#5c7680]"
          }`}
        >
          Snap
        </button>
        <button
          onClick={() => {
            // Expand the current 2D arrangement without changing world coordinates.
            if (!rfNodes.length) return;
            const minX = Math.min(...rfNodes.map((node) => node.position.x));
            const minY = Math.min(...rfNodes.map((node) => node.position.y));
            const positions = new Map(rfNodes.map((node) => [node.id, {
              x: minX + (node.position.x - minX) * 1.7,
              y: minY + (node.position.y - minY) * 1.7,
            }]));
            setRfNodes((nodes) => nodes.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position })));
            onChange({ ...topology, nodes: topology.nodes.map((node) => ({
              ...node, position: positions.get(node.id) ?? node.position,
            })) });
            window.setTimeout(() => fitView({ padding: 0.12, maxZoom: 1.25, duration: 250 }), 50);
          }}
          title="Spread the current 2D layout; 3D positions are unchanged"
          className="rounded border border-[#bed0d9] bg-[#ffffff] px-2 py-1 font-mono text-[11px] text-[#365762] hover:border-[#087f78]"
        >
          Space layout
        </button>
        <button
          onClick={() => setShowLinkLabels((visible) => !visible)}
          aria-pressed={showLinkLabels}
          title="Show or hide link technology and latency labels"
          className={`rounded border px-2 py-1 font-mono text-[11px] hover:border-[#087f78] ${
            showLinkLabels ? "border-[#087f78]/60 bg-[#ffffff] text-[#087f78]" : "border-[#bed0d9] bg-[#ffffff] text-[#365762]"
          }`}
        >
          Link labels {showLinkLabels ? "on" : "off"}
        </button>
      </div>
      <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex gap-3 rounded border border-[#bed0d9] bg-[#ffffff]/95 px-2.5 py-1.5 font-mono text-[10px] text-[#5c7680]">
        <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4 bg-[#087f78]" /> Active</span>
        <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4 bg-[#27845c]" /> Backup</span>
        <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4 bg-[#9b6c19]" /> Standby</span>
        <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4 bg-[#ae413a]" /> Failed</span>
      </div>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={(_, node) => {
          onChange(
            {
              ...topology,
              nodes: topology.nodes.map((n) =>
                n.id === node.id ? { ...n, position: { x: node.position.x, y: node.position.y } } : n
              ),
            },
            { transient: true }
          );
        }}
        onNodesDelete={(deleted) => {
          const ids = new Set(deleted.map((n) => n.id));
          onChange({
            ...topology,
            nodes: topology.nodes.filter((n) => !ids.has(n.id)),
            links: topology.links.filter((l) => !ids.has(l.source) && !ids.has(l.target)),
          });
          onSelect(null);
        }}
        onEdgesDelete={(deleted) => {
          const ids = new Set(deleted.map((e) => e.id));
          onChange({ ...topology, links: topology.links.filter((l) => !ids.has(l.id)) });
          onSelect(null);
        }}
        onConnect={onConnect}
        onNodeClick={(_, node) => {
          const found = byId.nodes.get(node.id);
          onSelect(found ? { kind: "node", node: found } : null);
        }}
        onEdgeClick={(_, edge) => {
          const found = byId.edges.get(edge.id);
          onSelect(found ? { kind: "edge", edge: found } : null);
        }}
        onPaneClick={() => onSelect(null)}
        onMoveEnd={() => {}}
        snapToGrid={snap}
        snapGrid={[16, 16]}
        multiSelectionKeyCode="Shift"
        deleteKeyCode={["Backspace", "Delete"]}
        connectionMode={ConnectionMode.Loose}
        fitView
        fitViewOptions={{ padding: 0.15, maxZoom: 1.25 }}
        minZoom={0.2}
        maxZoom={2}
        proOptions={{ hideAttribution: false }}
        colorMode="light"
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} color="#bed0d9" bgColor="#eef4f6" />
        <Controls position="bottom-right" />
        <MiniMap
          position="bottom-left"
          pannable
          zoomable
          style={{ background: "#ffffff", border: "1px solid #bed0d9" }}
          maskColor="rgba(59,95,111,0.14)"
          nodeColor={(n) => {
            const d = n.data as { operational?: boolean; onActiveRoute?: boolean } | undefined;
            if (!d?.operational) return "#ae413a";
            if (d?.onActiveRoute) return "#087f78";
            return "#9bb0b9";
          }}
        />
      </ReactFlow>
    </div>
  );
}

export default function ArchitectureCanvas(props: {
  topology: Topology;
  sim: SimulationState | null;
  focusRequest: { id: string; nonce: number } | null;
  externalSelection: { kind: "node" | "edge"; id: string; nonce: number } | null;
  onChange: (topology: Topology, opts?: { transient?: boolean }) => void;
  onSelect: (selection: Selection | null) => void;
  onError: (message: string) => void;
}) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
