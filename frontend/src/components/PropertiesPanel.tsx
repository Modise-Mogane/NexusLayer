"use client";

import type { Selection } from "@/components/TopologyCanvas";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-2 border-b border-slate-100 py-1.5 last:border-0">
      <span className="text-[11px] text-slate-500">{label}</span>
      <span className="text-right text-[11px] font-medium text-slate-900">{value}</span>
    </div>
  );
}

export default function PropertiesPanel({ selection }: { selection: Selection | null }) {
  return (
    <aside className="flex w-64 shrink-0 flex-col border-l border-slate-200 bg-white">
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
            {Object.entries(selection.node.properties ?? {}).map(([k, v]) => (
              <Row key={k} label={k} value={String(v)} />
            ))}
          </div>
        )}
        {selection?.kind === "edge" && selection.edge && (
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              {selection.edge.label ?? `${selection.edge.source} → ${selection.edge.target}`}
            </h3>
            <p className="mb-2 text-[11px] uppercase tracking-wide text-slate-500">Link</p>
            <Row label="Technology" value={selection.edge.technology} />
            <Row label="Status" value={selection.edge.status} />
            <Row label="Latency" value={`${selection.edge.latency_ms} ms`} />
            <Row label="Bandwidth" value={`${selection.edge.bandwidth_mbps} Mbps`} />
            <Row label="Reliability" value={String(selection.edge.reliability)} />
            <p className="mt-3 text-[10px] leading-relaxed text-slate-500">
              Synthetic example values, not measured performance.
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}
