"use client";

/* Communications Physics Lab (Stage C3). Left: experiment library. Center:
   interactive L1 visualization (+ fullscreen). Right: unit-aware parameters
   and L2 results. Bottom: experiment timeline. Deep-linkable from any
   network connection via ?scenario=&link=. */

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import WorkbenchShell from "@/components/workbench/WorkbenchShell";
import { EXPERIMENTS, experimentById, type ExperimentDef } from "@/components/physics/experiments";
import ExperimentVisual from "@/components/physics/visuals";
import { NxField, NxNumberInput, NxSelect, NxToggle } from "@/components/ui/controls";
import { useAssistantContext } from "@/components/assistant/AssistantProvider";
import { fetchLinkPhysics, runPhysicsLab, type LabResult } from "@/lib/api";

type Params = Record<string, number | string | boolean>;

function fmtOutput(value: number | string, unit: string): string {
  if (typeof value === "string") return unit ? `${value} ${unit}` : value;
  const abs = Math.abs(value);
  const text = value !== 0 && (abs >= 1e6 || abs < 1e-3) ? value.toExponential(2) : value.toFixed(3);
  return unit ? `${text} ${unit}` : text;
}

function fromLink(tech: string, distanceKm: number | null, frequencyMhz: number | null): { id: string; patch: Params } {
  const t = tech.toLowerCase();
  if (t.includes("fiber") || t.includes("optic")) {
    return { id: "fiber", patch: distanceKm != null ? { length_km: Math.max(distanceKm, 0.01) } : {} };
  }
  if (t.includes("sat") || t.includes("vsat") || t.includes("ka")) {
    return {
      id: "satellite",
      patch: {
        ...(distanceKm != null ? { distance_km: Math.max(distanceKm, 500) } : {}),
        ...(frequencyMhz != null ? { frequency_mhz: frequencyMhz } : {}),
      },
    };
  }
  if (t.includes("ethernet") || t.includes("copper") || t.includes("lan") || t.includes("cable")) {
    return { id: "copper", patch: distanceKm != null ? { length_m: Math.max(distanceKm * 1000, 0.1) } : {} };
  }
  return {
    id: "radio",
    patch: {
      ...(distanceKm != null ? { distance_km: Math.max(distanceKm, 0.001) } : {}),
      ...(frequencyMhz != null ? { frequency_mhz: frequencyMhz } : {}),
    },
  };
}

function PhysicsPageInner() {
  const searchParams = useSearchParams();
  const [expId, setExpId] = useState("radio");
  const [params, setParams] = useState<Params>({});
  const [result, setResult] = useState<LabResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkNote, setLinkNote] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const deb = useRef<ReturnType<typeof setTimeout> | null>(null);
  const calculationGeneration = useRef(0);

  const exp: ExperimentDef = useMemo(() => experimentById(expId), [expId]);
  useAssistantContext({ experiment_id: expId }, [expId]);

  // (Re)initialize params when switching experiments; then run once.
  useEffect(() => {
    setParams({ ...exp.defaults });
    setResult(null);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expId]);

  // Deep link from a network connection: prefill from its actual parameters.
  useEffect(() => {
    const sid = searchParams.get("scenario");
    const lid = searchParams.get("link");
    if (!sid || !lid) return;
    fetchLinkPhysics(sid, lid)
      .then((p) => {
        const mapped = fromLink(p.technology, p.distance_km, p.frequency_mhz);
        const target = experimentById(mapped.id);
        setExpId(target.id);
        setParams({ ...target.defaults, ...mapped.patch });
        setLinkNote(
          `Prefilled from ${p.label} (${p.technology}${p.distance_km != null ? `, ${p.distance_km.toFixed(2)} km` : ""}) in scenario ${sid}.`
        );
      })
      .catch(() => setError(`Could not load link ${lid} from scenario ${sid}.`));
  }, [searchParams]);

  useEffect(() => {
    if (Object.keys(params).length === 0) return;
    if (deb.current) clearTimeout(deb.current);
    const generation = ++calculationGeneration.current;
    setRunning(true);
    setResult(null);
    setError(null);
    deb.current = setTimeout(() => {
      runPhysicsLab(exp.endpoint, params)
        .then((r) => {
          if (generation !== calculationGeneration.current) return;
          setResult(r);
          setError(null);
        })
        .catch((e) => {
          if (generation === calculationGeneration.current) setError(e instanceof Error ? e.message : "Calculation failed");
        })
        .finally(() => { if (generation === calculationGeneration.current) setRunning(false); });
    }, 250);
    return () => {
      calculationGeneration.current++;
      if (deb.current) clearTimeout(deb.current);
    };
  }, [exp.endpoint, params]);

  const setParam = (key: string, v: number | string | boolean) =>
    setParams((prev) => ({ ...prev, [key]: v }));

  const visual = (
    <div className="nx-darkstage rounded-md p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold" style={{ color: "#e8e6e1" }}>{exp.title}</p>
        <button
          onClick={() => setFullscreen((v) => !v)}
          className="rounded border px-2 py-0.5 text-[11px] hover:text-white"
          style={{ borderColor: "#2e343b", color: "#8b949e" }}
        >
          {fullscreen ? "Exit full screen" : "Full screen"}
        </button>
      </div>
      <p className="mb-2 text-[11px] leading-relaxed" style={{ color: "#8b949e" }}>{exp.concept}</p>
      <ExperimentVisual id={exp.id} params={params} result={result} />
    </div>
  );

  return (
    <WorkbenchShell
      project={
        <div className="min-w-0">
          <span className="truncate text-[13px] font-semibold tracking-tight text-nx-ink">Physics Lab</span>
          <span className="ml-2 hidden truncate text-xs text-nx-muted lg:inline">
            L1 concepts + L2 calculations — educational scope, honest limits
          </span>
        </div>
      }
      leftTitle="Experiments"
      leftPanel={
        <div className="space-y-3">
          {(["Guided", "Wireless", "Quantum"] as const).map((g) => (
            <div key={g}>
              <p className="nx-label mb-1">{g}</p>
              <div className="space-y-1">
                {EXPERIMENTS.filter((e) => e.group === g).map((e) => (
                  <button
                    key={e.id}
                    onClick={() => {
                      setExpId(e.id);
                      setLinkNote(null);
                    }}
                    aria-pressed={e.id === expId}
                    className={`block w-full rounded border px-2 py-1.5 text-left transition-colors duration-150 ${
                      e.id === expId
                        ? "border-nx-accent/60 bg-nx-accent/10"
                        : "border-nx-line hover:border-nx-muted"
                    }`}
                  >
                    <span className="block text-xs font-medium text-nx-ink">{e.title}</span>
                    <span className="mt-0.5 block text-[10px] leading-snug text-nx-muted">{e.blurb}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          <p className="text-[10px] leading-relaxed text-nx-muted">
            Open any link inspector → “Explore Physics” to prefill an experiment from live parameters.
          </p>
        </div>
      }
      rightTitle="Parameters & results"
      rightPanel={
        <div className="space-y-3">
          {linkNote && <p className="nx-note-info">{linkNote}</p>}
          {error && <p className="nx-note-bad">{error}</p>}
          <div className="space-y-2.5">
            {exp.fields.map((f) =>
              f.kind === "number" ? (
                <NxField key={f.key} label={f.label}>
                  <NxNumberInput
                    value={typeof params[f.key] === "number" ? (params[f.key] as number) : ""}
                    onChange={(v) => typeof v === "number" && setParam(f.key, v)}
                    unit={f.unit}
                    min={f.min}
                    max={f.max}
                    step={f.step}
                  />
                </NxField>
              ) : f.kind === "select" ? (
                <NxField key={f.key} label={f.label}>
                  <NxSelect
                    value={String(params[f.key] ?? f.options[0].value)}
                    onChange={(v) => setParam(f.key, v)}
                    options={f.options}
                  />
                </NxField>
              ) : (
                <span key={f.key} className="flex items-center gap-2 text-xs text-nx-body">
                  <NxToggle checked={params[f.key] === true} onChange={(v) => setParam(f.key, v)} label={f.label} />
                  {f.label}
                </span>
              )
            )}
          </div>
          <div className="rounded border border-nx-line bg-nx-workspace p-2.5">
            <p className="nx-label mb-1.5">
              Results · <span className="text-nx-accent">{result?.fidelity ?? "…"}</span>
              {running ? " · calculating…" : ""}
            </p>
            {!result && <p className="text-[11px] text-nx-muted">Adjust a parameter to calculate.</p>}
            {result && (
              <div className="space-y-1">
                {result.outputs.map((o) => (
                  <div key={o.key} className="flex items-baseline justify-between gap-2 border-b border-nx-line/60 py-0.5 last:border-0">
                    <span className="text-[11px] text-nx-muted">{o.label}</span>
                    <span className="text-right font-mono text-[11px] text-nx-ink">{fmtOutput(o.value, o.unit)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          {result && (
            <>
              <div>
                <p className="nx-label mb-1">Equations</p>
                <div className="space-y-1.5">
                  {result.equations.map((e) => (
                    <div key={e.name} className="rounded border border-nx-line bg-nx-workspace p-2">
                      <p className="text-[11px] font-medium text-nx-body">{e.name}</p>
                      <p className="font-mono text-[11px] text-nx-accent">{e.formula}</p>
                      <p className="mt-0.5 font-mono text-[10px] text-nx-muted">{e.substitution}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="nx-label mb-1">Assumptions & limits</p>
                <ul className="list-disc space-y-0.5 pl-4 text-[11px] leading-snug text-nx-muted">
                  {result.assumptions.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              </div>
              {result.notes.length > 0 && (
                <div>
                  <p className="nx-label mb-1">Observations</p>
                  <ul className="list-disc space-y-0.5 pl-4 text-[11px] leading-snug text-nx-body">
                    {result.notes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div>
                <p className="nx-label mb-1">References</p>
                {result.refs.map((r, i) => (
                  <p key={i} className="text-[11px] text-nx-muted">
                    {r.label}
                    {r.detail ? ` — ${r.detail}` : ""}
                  </p>
                ))}
              </div>
            </>
          )}
        </div>
      }
      dockTabs={
        result
          ? [
              {
                id: "timeline",
                label: "Experiment timeline",
                content: (
                  <div className="flex flex-wrap items-stretch gap-1.5">
                    {result.equations.map((e, i) => (
                      <div key={e.name} className="flex items-stretch gap-1.5">
                        {i > 0 && <span aria-hidden className="self-center font-mono text-nx-muted">→</span>}
                        <div className="rounded border border-nx-line bg-nx-workspace px-2.5 py-1.5">
                          <p className="font-mono text-[10px] text-nx-muted">step {i + 1}</p>
                          <p className="text-[11px] font-medium text-nx-body">{e.name}</p>
                          <p className="font-mono text-[10px] text-nx-accent">{e.formula}</p>
                        </div>
                      </div>
                    ))}
                    <div className="flex items-stretch gap-1.5">
                      <span aria-hidden className="self-center font-mono text-nx-muted">→</span>
                      <div className="rounded border border-nx-accent/50 bg-nx-accent/5 px-2.5 py-1.5">
                        <p className="font-mono text-[10px] text-nx-muted">result</p>
                        <p className="text-[11px] font-medium text-nx-ink">
                          {result.outputs
                            .slice(0, 2)
                            .map((o) => `${o.label}: ${fmtOutput(o.value, o.unit)}`)
                            .join(" · ")}
                        </p>
                      </div>
                    </div>
                  </div>
                ),
              },
            ]
          : []
      }
    >
      <div className="p-4">{visual}</div>
      {fullscreen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-nx-workspace/95 p-6" role="dialog" aria-label={`${exp.title} fullscreen`}>
          <div className="mx-auto max-w-4xl">{visual}</div>
        </div>
      )}
    </WorkbenchShell>
  );
}

export default function PhysicsPage() {
  return (
    <Suspense fallback={<div className="p-4 text-xs text-nx-muted">Loading Physics Lab…</div>}>
      <PhysicsPageInner />
    </Suspense>
  );
}
