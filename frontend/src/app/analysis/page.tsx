"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import AppShell from "@/components/AppShell";
import { fetchAnalysis, fetchScenarios, type AnalysisResult, type ScenarioSummary } from "@/lib/api";

function AnalysisPageInner() {
  const searchParams = useSearchParams();
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([]);
  const [scenarioId, setScenarioId] = useState("maritime_failover");
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (sid: string) => {
    try {
      setAnalysis(await fetchAnalysis(sid === "maritime_failover" ? undefined : sid));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load analysis");
    }
  }, []);

  useEffect(() => {
    fetchScenarios().then(setScenarios).catch(() => {});
    const sid = searchParams.get("scenario") || "maritime_failover";
    setScenarioId(sid);
    void load(sid);
  }, [searchParams, load]);

  return (
    <AppShell title="Analysis" subtitle="Route history, handovers, availability, and the assumptions behind every number.">
      {error && <p className="mb-3 rounded bg-nx-bad/10 px-3 py-2 text-xs text-nx-badink">{error}</p>}
      <div className="mb-3 flex items-center gap-2">
        <select value={scenarioId} onChange={(e) => { setScenarioId(e.target.value); void load(e.target.value); }} className="rounded border border-nx-line bg-nx-panel px-2.5 py-1.5 text-xs">
          {scenarios.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <button onClick={() => void load(scenarioId)} className="rounded border border-nx-line bg-nx-panel px-2.5 py-1.5 text-xs">
          Refresh
        </button>
        {analysis && (
          <span className="text-xs text-nx-muted">
            Policy {analysis.policy} · tick {analysis.tick} · availability {(analysis.availability * 100).toFixed(1)}%
          </span>
        )}
        <span className="rounded bg-nx-warn/15 px-2 py-1 text-[10px] font-medium text-nx-warn">Synthetic estimates, not measurements</span>
      </div>
      {!analysis && <p className="text-xs text-nx-muted">Loading…</p>}
      {analysis && (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {analysis.per_endpoint && Object.keys(analysis.per_endpoint).length > 1 && (
            <div className="rounded-md bg-nx-panel p-4 border border-nx-line xl:col-span-2">
              <h2 className="text-sm font-semibold text-nx-ink">Endpoints</h2>
              <div className="mt-2 grid grid-cols-1 gap-1.5 md:grid-cols-2 xl:grid-cols-4">
                {Object.entries(analysis.per_endpoint).map(([id, pe]) => (
                  <div key={id} className="rounded bg-nx-workspace p-2 text-[11px] border border-nx-line">
                    <p className="font-medium">{pe.label}</p>
                    <p className="text-nx-muted">
                      availability {(pe.availability * 100).toFixed(1)}% · {pe.handovers} handovers · {pe.route_changes} route records
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="rounded-md bg-nx-panel p-4 border border-nx-line">
            <h2 className="text-sm font-semibold text-nx-ink">Handover history ({analysis.handover_history.length})</h2>
            {analysis.handover_history.length === 0 && (
              <p className="mt-1 text-xs leading-relaxed text-nx-muted">
                No handovers recorded yet. <a href="/simulation" className="text-nx-accent underline">Run the simulation</a> and
                sail the vessel offshore — each switch is recorded here with its reason.
              </p>
            )}
            <div className="mt-2 max-h-64 space-y-1.5 overflow-y-auto">
              {analysis.handover_history.map((h, i) => (
                <div key={i} className="rounded bg-nx-workspace p-2 text-[11px] border border-nx-line">
                  <p className="font-medium">
                    tick {String(h.tick)} · t={Number(h.sim_time_s).toFixed(0)}s
                    {h.endpoint_id != null && ` · ${String(h.endpoint_id)}`}
                  </p>
                  <p className="text-nx-muted">{String(h.reason)}</p>
                  <p className="font-mono text-[10px] text-nx-muted">
                    {(h.from_link_ids as string[]).join(" → ") || "none"} → {(h.to_link_ids as string[]).join(" → ") || "none"}
                  </p>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-md bg-nx-panel p-4 border border-nx-line">
            <h2 className="text-sm font-semibold text-nx-ink">Route history ({analysis.route_history.length})</h2>
            <div className="mt-2 max-h-64 space-y-1.5 overflow-y-auto">
              {analysis.route_history.map((r, i) => (
                <div key={i} className="rounded bg-nx-workspace p-2 text-[11px] border border-nx-line">
                  <p className="font-medium">
                    tick {String(r.tick)} · {String(r.connectivity)} · {String(r.trigger)}
                    {r.endpoint_id != null && ` · ${String(r.endpoint_id)}`}
                  </p>
                  <p className="text-nx-muted">{(r.node_ids as string[]).join(" → ") || "—"}</p>
                  {r.latency_ms != null && (
                    <p className="text-nx-muted">
                      {String(r.latency_ms)} ms · {String(r.bandwidth_mbps)} Mbps
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-md bg-nx-panel p-4 border border-nx-line">
            <h2 className="text-sm font-semibold text-nx-ink">Latency over time</h2>
            {analysis.latency_series.length === 0 && (
              <p className="mt-1 text-xs leading-relaxed text-nx-muted">
                No samples yet. <a href="/simulation" className="text-nx-accent underline">Step or run the simulation</a> to
                record latency over time.
              </p>
            )}
            {analysis.latency_series.length > 0 && (
              <div className="mt-2 flex h-32 items-end gap-1">
                {analysis.latency_series.slice(-60).map((s, i) => {
                  const max = Math.max(...analysis.latency_series.map((x) => x.latency_ms ?? 0), 1);
                  const h = s.latency_ms == null ? 2 : Math.max(3, (s.latency_ms / max) * 120);
                  return (
                    <div
                      key={i}
                      title={s.latency_ms == null ? "disconnected" : `${s.latency_ms} ms`}
                      className={`w-2 ${s.latency_ms == null ? "bg-red-400" : "bg-nx-accent"}`}
                      style={{ height: h }}
                    />
                  );
                })}
              </div>
            )}
            <h2 className="mt-4 text-sm font-semibold text-nx-ink">Events</h2>
            <p className="mt-1 text-[11px] text-nx-muted">
              {Object.entries(analysis.event_counts).map(([k, v]) => `${k}: ${v}`).join(" · ") || "none"}
            </p>
            <p className="mt-1 text-[11px] text-nx-muted">
              Disconnection periods: {analysis.disconnection_periods.length}
            </p>
          </div>
          <div className="rounded-md bg-nx-panel p-4 border border-nx-line">
            <h2 className="text-sm font-semibold text-nx-ink">Assumptions</h2>
            {analysis.assumptions.map((a, i) => (
              <p key={i} className="mt-1 text-[11px] leading-relaxed text-nx-muted">• {a}</p>
            ))}
          </div>
        </div>
      )}
    </AppShell>
  );
}

export default function AnalysisPage() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center text-sm text-nx-muted">Loading…</div>}>
      <AnalysisPageInner />
    </Suspense>
  );
}
