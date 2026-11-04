"use client";

import type { SimulationState } from "@/lib/api";

const CONNECTIVITY_STYLES: Record<string, string> = {
  connected: "bg-emerald-100 text-emerald-800",
  degraded: "bg-amber-100 text-amber-800",
  disconnected: "bg-red-100 text-red-800",
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-2 border-b border-slate-100 py-1.5 last:border-0">
      <span className="text-[11px] text-slate-500">{label}</span>
      <span className="text-right text-[11px] font-medium text-slate-900">{value}</span>
    </div>
  );
}

export default function MetricsPanel({ sim }: { sim: SimulationState | null }) {
  return (
    <section className="border-b border-slate-200 px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold text-slate-900">Route metrics</h2>
        {sim && (
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${CONNECTIVITY_STYLES[sim.connectivity]}`}
          >
            {sim.connectivity}
          </span>
        )}
      </div>
      {!sim && <p className="text-xs text-slate-500">Waiting for simulation state…</p>}
      {sim && !sim.active_route && (
        <p className="text-xs font-medium text-red-600">
          No viable route between ship and internet.
        </p>
      )}
      {sim?.active_route && (
        <div>
          <p className="mb-1 text-[11px] leading-relaxed text-slate-700">
            {sim.active_route.node_labels.join(" → ")}
          </p>
          <Row label="Latency (end-to-end)" value={`${sim.active_route.latency_ms} ms`} />
          <Row label="Bandwidth (bottleneck)" value={`${sim.active_route.bandwidth_mbps} Mbps`} />
          <Row
            label="Reliability (est.)"
            value={`${(sim.active_route.reliability * 100).toFixed(1)}%`}
          />
          <Row label="Backup paths" value={String(sim.backup_routes.length)} />
          <Row label="Routing policy" value={sim.routing_policy.replace("_", " ")} />
        </div>
      )}
    </section>
  );
}
