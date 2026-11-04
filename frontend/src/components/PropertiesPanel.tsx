"use client";

import type { Selection } from "@/components/TopologyCanvas";
import type { SimulationState } from "@/lib/api";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-2 border-b border-slate-100 py-1.5 last:border-0">
      <span className="text-[11px] text-slate-500">{label}</span>
      <span className="text-right text-[11px] font-medium text-slate-900">{value}</span>
    </div>
  );
}

export default function PropertiesPanel({
  selection,
  sim,
}: {
  selection: Selection | null;
  sim: SimulationState | null;
}) {
  const linkState =
    selection?.kind === "edge" && selection.edge
      ? sim?.links.find((l) => l.id === selection.edge!.id)
      : undefined;
  const nodeState =
    selection?.kind === "node" && selection.node
      ? sim?.nodes.find((n) => n.id === selection.node!.id)
      : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-slate-200 px-4 py-2.5">
        <h2 className="text-xs font-semibold text-slate-900">Properties</h2>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {!selection && (
          <p className="text-xs leading-relaxed text-slate-500">
            Select a node or a link in the topology workspace to inspect its
            details.
          </p>
        )}
        {selection?.kind === "node" && selection.node && (
          <div>
            <h3 className="text-sm font-semibold text-slate-900">{selection.node.label}</h3>
            <p className="mb-2 text-[11px] uppercase tracking-wide text-slate-500">
              {selection.node.type.replace("_", " ")}
            </p>
            <Row label="ID" value={selection.node.id} />
            {nodeState && (
              <>
                <Row label="Operational" value={nodeState.status} />
                <Row label="Reachable" value={nodeState.reachable ? "yes" : "no"} />
                <Row label="On active route" value={nodeState.on_active_route ? "yes" : "no"} />
              </>
            )}
            {Object.entries(selection.node.properties ?? {}).map(([k, v]) => (
              <Row key={k} label={k} value={String(v)} />
            ))}
            {nodeState && nodeState.interfaces.length > 0 && (
              <div className="mt-2">
                <p className="mb-1 text-[11px] font-medium text-slate-700">Interfaces</p>
                {nodeState.interfaces.map((iface) => (
                  <Row
                    key={iface.link_id}
                    label={iface.technology}
                    value={`→ ${iface.neighbor_id}`}
                  />
                ))}
              </div>
            )}
          </div>
        )}
        {selection?.kind === "edge" && selection.edge && (
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              {selection.edge.label ?? `${selection.edge.source} → ${selection.edge.target}`}
            </h3>
            <p className="mb-2 text-[11px] uppercase tracking-wide text-slate-500">Link</p>
            <Row label="Technology" value={selection.edge.technology} />
            <Row label="Scenario status" value={selection.edge.status} />
            {linkState && (
              <>
                <Row label="Operational" value={linkState.status} />
                <Row
                  label="On active route"
                  value={linkState.on_active_route ? "yes" : "no"}
                />
              </>
            )}
            <Row label="Latency" value={`${selection.edge.latency_ms} ms`} />
            <Row label="Bandwidth" value={`${selection.edge.bandwidth_mbps} Mbps`} />
            <Row label="Reliability" value={String(selection.edge.reliability)} />
            <p className="mt-3 text-[10px] leading-relaxed text-slate-500">
              Synthetic example values, not measured performance.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
