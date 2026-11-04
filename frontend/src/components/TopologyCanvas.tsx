"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import {
  fetchTopology,
  type LinkState,
  type NodeState,
  type SimulationState,
  type Topology,
  type TopologyLink,
  type TopologyNode,
} from "@/lib/api";
import NetworkNode from "@/components/nodes/NetworkNode";

export interface Selection {
  kind: "node" | "edge";
  node?: TopologyNode;
  edge?: TopologyLink;
}

const nodeTypes = { network: NetworkNode };

interface EdgeVisual {
  stroke: string;
  strokeWidth: number;
  strokeDasharray?: string;
  animated: boolean;
  suffix: string;
}

function edgeVisual(link: TopologyLink, state?: LinkState): EdgeVisual {
  if (state?.status === "down") {
    return { stroke: "#dc2626", strokeWidth: 2.5, strokeDasharray: "7 5", animated: false, suffix: " (down)" };
  }
  if (state?.on_active_route) {
    return { stroke: "#2563eb", strokeWidth: 3, animated: true, suffix: "" };
  }
  if (state?.on_backup_route) {
    return { stroke: "#16a34a", strokeWidth: 2, animated: false, suffix: "" };
  }
  if (link.status === "active") {
    return { stroke: "#94a3b8", strokeWidth: 2, animated: false, suffix: "" };
  }
  if (link.status === "standby") {
    return { stroke: "#d97706", strokeWidth: 2, strokeDasharray: "6 4", animated: false, suffix: "" };
  }
  return { stroke: "#dc2626", strokeWidth: 2, strokeDasharray: "2 4", animated: false, suffix: "" };
}

export default function TopologyCanvas({
  sim,
  onSelect,
}: {
  sim: SimulationState | null;
  onSelect: (selection: Selection | null) => void;
}) {
  const [topology, setTopology] = useState<Topology | null>(null);
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchTopology();
      setTopology(data);
      setPositions((prev) => {
        const next = { ...prev };
        data.nodes.forEach((n, i) => {
          next[n.id] ??= n.position ?? { x: (i % 3) * 260 + 40, y: Math.floor(i / 3) * 160 + 40 };
        });
        return next;
      });
      onSelect(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load topology");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const nodes: Node[] = useMemo(() => {
    if (!topology) return [];
    const nodeStates = new Map<string, NodeState>((sim?.nodes ?? []).map((n) => [n.id, n]));
    return topology.nodes.map((n) => {
      const state = nodeStates.get(n.id);
      const operational = state ? state.status === "up" && state.reachable : true;
      return {
        id: n.id,
        type: "network",
        position: positions[n.id] ?? { x: 0, y: 0 },
        data: {
          label: n.label,
          nodeType: n.type,
          operational,
          onActiveRoute: state?.on_active_route ?? false,
        },
      };
    });
  }, [topology, positions, sim]);

  const edges: Edge[] = useMemo(() => {
    if (!topology) return [];
    const linkStates = new Map<string, LinkState>((sim?.links ?? []).map((l) => [l.id, l]));
    return topology.links.map((l) => {
      const visual = edgeVisual(l, linkStates.get(l.id));
      return {
        id: l.id,
        source: l.source,
        target: l.target,
        label: `${l.technology} · ${l.latency_ms} ms${visual.suffix}`,
        animated: visual.animated,
        style: {
          stroke: visual.stroke,
          strokeWidth: visual.strokeWidth,
          strokeDasharray: visual.strokeDasharray,
        },
        labelStyle: { fontSize: 10 },
      };
    });
  }, [topology, sim]);

  const byId = useMemo(
    () => ({
      nodes: new Map((topology?.nodes ?? []).map((n) => [n.id, n])),
      edges: new Map((topology?.links ?? []).map((l) => [l.id, l])),
    }),
    [topology]
  );

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-500">
        Loading topology from backend…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm font-medium text-red-600">Could not load topology</p>
        <p className="max-w-md text-xs text-slate-500">{error}</p>
        <button
          onClick={() => void load()}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="relative h-full">
      <div className="pointer-events-none absolute left-3 top-3 z-10 rounded-md bg-white/90 px-2.5 py-1.5 text-xs shadow-sm ring-1 ring-slate-200">
        <span className="font-semibold text-slate-700">{topology?.metadata.name}</span>
        <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
          Synthetic example data
        </span>
      </div>
      <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex gap-3 rounded-md bg-white/90 px-2.5 py-1.5 text-[10px] text-slate-600 shadow-sm ring-1 ring-slate-200">
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-4 bg-blue-600" /> Active route
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-4 bg-emerald-600" /> Backup path
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-4 bg-red-600" /> Failed
        </span>
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={(changes) => {
          setPositions((prev) => {
            const next = { ...prev };
            for (const c of changes) {
              if (c.type === "position" && c.position) {
                next[c.id] = c.position;
              }
            }
            return next;
          });
        }}
        onNodeClick={(_, node) => {
          const found = byId.nodes.get(node.id);
          onSelect(found ? { kind: "node", node: found } : null);
        }}
        onEdgeClick={(_, edge) => {
          const found = byId.edges.get(edge.id);
          onSelect(found ? { kind: "edge", edge: found } : null);
        }}
        onPaneClick={() => onSelect(null)}
        fitView
        proOptions={{ hideAttribution: false }}
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  );
}
