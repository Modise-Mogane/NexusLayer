"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import {
  analyzeRegion,
  coverageProposalScenario,
  fetchJobRuns,
  fetchJobs,
  fetchRegions,
  runJob,
  updateJob,
  type CoverageRegion,
  type CoverageReport,
  type ScheduledJob,
} from "@/lib/api";

const GAP_STYLE: Record<string, string> = {
  no_data: "bg-nx-workspace text-nx-muted border border-nx-line",
  low_adoption: "bg-nx-warn/15 text-nx-warn",
  coverage_gap: "bg-nx-bad/10 text-nx-badink",
  adequate: "bg-nx-ok/15 text-nx-ok",
};

function RegionEvidence({ region }: { region: CoverageRegion }) {
  const d = region.data as {
    population?: number; area_km2?: number; terrain?: string; grid_power?: string;
    existing_infra?: string[]; backhaul_options?: string[];
    coverage_pct?: number | null; usage_pct?: number | null;
    evidence?: { metric: string; value: number; source: string; note: string }[];
  };
  return (
    <div className="text-[11px] text-nx-body">
      <p>
        {d.population?.toLocaleString()} people · {d.area_km2} km² · {d.terrain} · power: {d.grid_power}
      </p>
      <p className="mt-1">
        Coverage: <strong>{d.coverage_pct ?? "no data"}{d.coverage_pct != null ? "%" : ""}</strong>
        {" · "}Usage: <strong>{d.usage_pct ?? "no data"}{d.usage_pct != null ? "%" : ""}</strong>
      </p>
      <p className="mt-1 text-nx-muted">Existing: {(d.existing_infra ?? []).join("; ") || "none recorded"}</p>
      <p className="text-nx-muted">Backhaul options: {(d.backhaul_options ?? []).join("; ") || "none recorded"}</p>
      {(d.evidence ?? []).length > 0 && (
        <div className="mt-1 space-y-0.5">
          {(d.evidence ?? []).map((e, i) => (
            <p key={i} className="text-nx-muted">
              {e.metric} = {e.value} · source: {e.source} · {e.note}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export default function CoveragePage() {
  const [tab, setTab] = useState<"regions" | "jobs">("regions");
  const [regions, setRegions] = useState<CoverageRegion[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [report, setReport] = useState<CoverageReport | null>(null);
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [runs, setRuns] = useState<Record<string, { id: string; started_at: string; status: string; log: string }[]>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reloadRegions = async () => {
    try {
      const list = (await fetchRegions()).regions;
      setRegions(list);
      if (!selectedId && list.length > 0) setSelectedId(list[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load regions");
    }
  };

  const reloadJobs = async () => {
    try {
      setJobs((await fetchJobs()).jobs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load jobs");
    }
  };

  useEffect(() => {
    void reloadRegions();
    void reloadJobs();
  }, []);

  const selected = regions.find((r) => r.id === selectedId) ?? null;

  const analyze = async () => {
    if (!selectedId) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      setReport(await analyzeRegion(selectedId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setBusy(false);
    }
  };

  const toScenario = async (proposalId: string) => {
    if (!report) return;
    setBusy(true);
    try {
      const res = await coverageProposalScenario(report.id, proposalId);
      setMessage(`Saved as scenario ${res.scenario_id}. Open it in 3D Simulation to evaluate.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scenario save failed");
    } finally {
      setBusy(false);
    }
  };

  const toggleJob = async (job: ScheduledJob) => {
    try {
      await updateJob(job.id, { enabled: !job.enabled });
      await reloadJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Job update failed");
    }
  };

  const runNow = async (job: ScheduledJob) => {
    setBusy(true);
    try {
      await runJob(job.id);
      await reloadJobs();
      const list = (await fetchJobRuns(job.id)).runs;
      setRuns((prev) => ({ ...prev, [job.id]: list }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Job run failed");
    } finally {
      setBusy(false);
    }
  };

  const showRuns = async (job: ScheduledJob) => {
    try {
      const list = (await fetchJobRuns(job.id)).runs;
      setRuns((prev) => ({ ...prev, [job.id]: list }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load runs");
    }
  };

  return (
    <AppShell title="Coverage Research" subtitle="Evidence-based gap analysis, ranked proposals, and controllable recurring research.">
      {error && <p className="mb-3 rounded bg-nx-bad/10 px-3 py-2 text-xs text-nx-badink">{error}</p>}
      {message && <p className="mb-3 rounded bg-nx-accent/10 px-3 py-2 text-xs text-nx-accent">{message}</p>}
      <div className="mb-3 flex gap-2">
        {(["regions", "jobs"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded px-3 py-1.5 text-xs font-medium capitalize ${tab === t ? "bg-nx-accent text-nx-workspace" : "border border-nx-line text-nx-body"}`}
          >
            {t === "regions" ? `Regions (${regions.length})` : `Scheduled jobs (${jobs.length})`}
          </button>
        ))}
      </div>

      {tab === "regions" && (
        <div className="flex flex-col gap-3 lg:flex-row">
          <div className="w-full shrink-0 space-y-2 lg:w-96">
            {regions.map((r) => (
              <button
                key={r.id}
                onClick={() => {
                  setSelectedId(r.id);
                  setReport(null);
                }}
                className={`w-full rounded border p-3 text-left ${selectedId === r.id ? "border-nx-accent" : "border-nx-line"} bg-nx-panel`}
              >
                <span className="block text-xs font-semibold text-nx-ink">{r.name}</span>
                <span className="mt-1 block"><RegionEvidence region={r} /></span>
              </button>
            ))}
            <button onClick={() => void analyze()} disabled={busy || !selectedId} className="w-full rounded bg-nx-accent px-3 py-1.5 text-xs font-medium text-nx-workspace disabled:opacity-40">
              {busy ? "Analyzing…" : "Analyze selected region"}
            </button>
          </div>
          <div className="min-w-0 flex-1 rounded-md border border-nx-line bg-nx-panel p-4">
            {!report && <p className="text-xs text-nx-muted">Select a region and run analysis. Coverage, adoption, and missing data are classified separately.</p>}
            {report && (
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-semibold text-nx-ink">{report.region_name}</h2>
                  <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${GAP_STYLE[report.gap.class] ?? ""}`}>
                    {report.gap.class}
                  </span>
                </div>
                <p className="mt-1 text-xs text-nx-body">{report.gap.summary}</p>
                <p className="mt-0.5 text-[11px] text-nx-muted">Recommended: {report.gap.recommended_action}</p>
                <p className="mt-0.5 text-[11px] text-nx-muted">Confidence: {report.confidence}</p>
                {report.proposals.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {report.proposals.map((p, i) => (
                      <div key={p.id} className="rounded border border-nx-line bg-nx-workspace p-2.5">
                        <p className="text-xs font-semibold text-nx-ink">
                          #{i + 1} {p.title} <span className="font-normal text-nx-muted">(score {p.score})</span>
                        </p>
                        <p className="mt-1 text-[11px] text-nx-body">
                          Capex ≈ ${p.capex_usd_approx.toLocaleString()} · opex ≈ ${p.opex_usd_per_month.toLocaleString()}/mo
                          {p.coverage_gain_pp_estimate > 0 && ` · +${p.coverage_gain_pp_estimate} pp coverage (est.)`}
                          {p.cost_per_coverage_point_usd != null && ` · $${p.cost_per_coverage_point_usd.toLocaleString()}/point`}
                          {` · ~${p.latency_ms_estimate} ms · ~${p.capacity_mbps_estimate} Mbps`}
                        </p>
                        <p className="mt-0.5 text-[11px] text-nx-muted">
                          Equipment: {p.devices.map((d) => (d.found ? d.name : `${d.device_id} (not in catalog)`)).join("; ")}
                        </p>
                        <p className="mt-0.5 text-[11px] text-nx-muted">{p.feasibility_note}</p>
                        {p.issues.map((issue, j) => (
                          <p key={j} className="mt-0.5 text-[11px] text-nx-warn">⚠ {issue}</p>
                        ))}
                        <p className="mt-0.5 text-[10px] text-nx-muted">{p.assumption}</p>
                        <button
                          onClick={() => void toScenario(p.id)}
                          disabled={busy}
                          className="mt-1.5 rounded border border-nx-line px-2 py-1 text-[11px] disabled:opacity-40"
                        >
                          Save as scenario & simulate
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "jobs" && (
        <div className="space-y-2">
          <p className="text-[11px] text-nx-muted">
            Recurring research is opt-in: jobs only run on schedule while enabled. Every run is logged with status and results.
            Jobs refresh data and write reports; they never deploy infrastructure or approve findings.
          </p>
          {jobs.map((j) => (
            <div key={j.id} className="rounded border border-nx-line bg-nx-panel p-3">
              <div className="flex flex-wrap items-center gap-2">
                <strong className="text-xs text-nx-ink">{j.name}</strong>
                <span className="text-[11px] text-nx-muted">{j.kind} · every {Math.round(j.interval_seconds / 3600)} h</span>
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${j.last_status === "ok" ? "bg-nx-ok/15 text-nx-ok" : j.last_status === "failed" ? "bg-nx-bad/10 text-nx-badink" : "bg-nx-workspace text-nx-muted border border-nx-line"}`}>
                  {j.last_status}
                </span>
                <span className="ml-auto flex gap-2">
                  <button onClick={() => void runNow(j)} disabled={busy} className="rounded border border-nx-line px-2 py-1 text-[11px] disabled:opacity-40">
                    Run now
                  </button>
                  <button onClick={() => void showRuns(j)} className="rounded border border-nx-line px-2 py-1 text-[11px]">
                    Runs
                  </button>
                  <button onClick={() => void toggleJob(j)} className="rounded border border-nx-line px-2 py-1 text-[11px]">
                    {j.enabled ? "Disable schedule" : "Enable schedule"}
                  </button>
                </span>
              </div>
              <p className="mt-1 text-[11px] text-nx-muted">
                {j.enabled ? `Enabled · next run ${j.next_run ? j.next_run.slice(0, 16).replace("T", " ") : "on next scheduler pass"}` : "Disabled — runs only when triggered manually"}
                {j.last_run ? ` · last run ${j.last_run.slice(0, 16).replace("T", " ")}` : ""}
                {Object.keys(j.config).length > 0 && (
                  <>
                    {" · "}
                    {Object.entries(j.config).map(([k, v]) => `${k}=${String(v)}`).join(" · ")}
                  </>
                )}
              </p>
              {(runs[j.id] ?? []).length > 0 && (
                <div className="mt-2 space-y-1">
                  {(runs[j.id] ?? []).slice(0, 5).map((r) => (
                    <details key={r.id} className="rounded border border-nx-line bg-nx-workspace p-1.5 text-[11px]">
                      <summary className="cursor-pointer text-nx-body">
                        {r.started_at.slice(0, 16).replace("T", " ")} · {r.status}
                      </summary>
                      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-[10px] text-nx-muted">{r.log}</pre>
                    </details>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}
