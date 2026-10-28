"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { fetchTopology, type TopologyLink, type TopologyNode } from "@/lib/api";
import NetworkNode from "@/components/nodes/NetworkNode";

export interface Selection {
  kind: "node" | "edge";
  node?: TopologyNode;
  edge?: TopologyLink;
}

const nodeTypes = { network: NetworkNode };

function toFlowNodes(nodes: TopologyNode[]): Node[] {
  return nodes.map((n, i) => ({
    id: n.id,
    type: "network",
    position: n.position ?? { x: (i % 3) * 260 + 40, y: Math.floor(i / 3) * 160 + 40 },
    data: { label: n.label, nodeType: n.type },
  }));
}

function edgeStyle(status: string): { stroke: string; strokeDasharray?: string } {
  if (status === "active") return { stroke: "#16a34a" };
  if (status === "standby") return { stroke: "#d97706", strokeDasharray: "6 4" };
  return { stroke: "#dc2626", strokeDasharray: "2 4" };
}

function toFlowEdges(links: TopologyLink[]): Edge[] {
  return links.map((l) => ({
    id: l.id,
    source: l.source,
    target: l.target,
    label: `${l.technology} · ${l.latency_ms} ms`,
    animated: l.status === "active",
    style: { strokeWidth: 2, ...edgeStyle(l.status) },
    labelStyle: { fontSize: 10 },
  }));
}

export default function TopologyCanvas({
  onSelect,
}: {
  onSelect: (selection: Selection | null) => void;
}) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [byId, setById] = useState<{ nodes: Map<string, TopologyNode>; edges: Map<string, TopologyLink> }>({
    nodes: new Map(),
    edges: new Map(),
  });
  const [scenarioName, setScenarioName] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const topology = await fetchTopology();
      setNodes(toFlowNodes(topology.nodes));
      setEdges(toFlowEdges(topology.links));
      setById({
        nodes: new Map(topology.nodes.map((n) => [n.id, n])),
        edges: new Map(topology.links.map((l) => [l.id, l])),
      });
      setScenarioName(topology.metadata.name);
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
        <span className="font-semibold text-slate-700">{scenarioName}</span>
        <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
          Synthetic example data
        </span>
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={(changes) => {
          setNodes((nds) => {
            const next = [...nds];
            for (const c of changes) {
              if (c.type === "position" && c.position) {
                const idx = next.findIndex((n) => n.id === c.id);
                if (idx >= 0) next[idx] = { ...next[idx], position: c.position };
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
