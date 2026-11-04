"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { NxField, NxNumberInput, NxSegmented, NxSelect } from "@/components/ui/controls";
import { fetchAgentStatus, fetchPolicies, setPolicy } from "@/lib/api";

export default function SettingsPage() {
  const [policies, setPolicies] = useState<string[]>([]);
  const [weights, setWeights] = useState<Record<string, number>>({ latency: 0.35, bandwidth: 0.25, reliability: 0.25, cost: 0.15 });
  const [policy, setPolicyName] = useState("lowest_latency");
  const [provider, setProvider] = useState<{ state: string; model: string; mode: string; note: string } | null>(null);
  const [quality, setQuality] = useState("standard");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPolicies().then((p) => { setPolicies(p.policies); setWeights(p.default_weights); }).catch(() => {});
    fetchAgentStatus().then(setProvider).catch(() => {});
    setQuality(localStorage.getItem("nx-3d-quality") || "standard");
  }, []);

  const applyPolicy = async () => {
    setError(null);
    try {
      await setPolicy(policy, policy === "balanced" ? weights : undefined);
      setMessage(`Default routing policy set to ${policy}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to set policy");
    }
  };

  const saveQuality = (q: string) => {
    setQuality(q);
    localStorage.setItem("nx-3d-quality", q);
    setMessage(`3D quality set to ${q}. Applies on next simulation load.`);
  };

  return (
    <AppShell title="Settings" subtitle="Routing, 3D performance, provider status, and data notes.">
      {message && <p className="mb-3 rounded bg-nx-accent/10 px-3 py-2 text-xs text-nx-accent">{message}</p>}
      {error && <p className="mb-3 rounded bg-nx-bad/10 px-3 py-2 text-xs text-nx-badink">{error}</p>}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <div className="rounded-md bg-nx-panel p-4 border border-nx-line">
          <h2 className="text-sm font-semibold text-nx-ink">Routing policy (default session)</h2>
          <div className="mt-2">
            <NxField label="Policy">
              <NxSelect
                value={policy}
                onChange={setPolicyName}
                options={policies.map((p) => ({ value: p, label: p }))}
              />
            </NxField>
          </div>
          {policy === "balanced" && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              {Object.entries(weights).map(([k, v]) => (
                <NxField key={k} label={k}>
                  <NxNumberInput
                    value={v}
                    onChange={(nv) => typeof nv === "number" && setWeights({ ...weights, [k]: nv })}
                    min={0}
                    max={1}
                    step={0.05}
                  />
                </NxField>
              ))}
              <p className="col-span-2 text-[10px] text-nx-muted">
                Balanced weights are normalized before use; metrics are min-max scaled across candidates so units are never mixed raw.
              </p>
            </div>
          )}
          <button onClick={() => void applyPolicy()} className="mt-3 rounded bg-nx-accent px-3 py-1.5 text-xs font-medium text-nx-workspace">
            Apply policy
          </button>
        </div>
        <div className="rounded-md bg-nx-panel p-4 border border-nx-line">
          <h2 className="text-sm font-semibold text-nx-ink">AI provider</h2>
          {!provider && <p className="mt-1 text-xs text-nx-muted">Loading…</p>}
          {provider && (
            <>
              <p className="mt-1 text-xs text-nx-body">State: <strong>{provider.state}</strong> · mode: <strong>{provider.mode}</strong></p>
              <p className="mt-1 text-[11px] text-nx-muted">{provider.note}</p>
              <p className="mt-2 text-[11px] leading-relaxed text-nx-muted">
                Credentials live backend-only (MODEL_API_KEY, META_MODEL, MODEL_BASE_URL, AI_PROVIDER, BASETEN_API_KEY, BASETEN_MODEL). They are never exposed to the browser;
                this page shows status only, never key values.
              </p>
            </>
          )}
        </div>
        <div className="rounded-md bg-nx-panel p-4 border border-nx-line">
          <h2 className="text-sm font-semibold text-nx-ink">3D graphics performance</h2>
          <div className="mt-2">
            <NxSegmented
              ariaLabel="3D quality"
              value={quality}
              onChange={saveQuality}
              options={[
                { value: "low", label: "Low", title: "Reduced water grid, no shadows" },
                { value: "standard", label: "Standard" },
                { value: "high", label: "High" },
              ]}
            />
          </div>
          <p className="mt-2 text-[11px] text-nx-muted">Low reduces scenery detail. Low and Standard disable dynamic shadows; High enables shadows and antialiasing.</p>
        </div>
        <div className="rounded-md bg-nx-panel p-4 border border-nx-line">
          <h2 className="text-sm font-semibold text-nx-ink">Design review</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-nx-muted">
            Internal showcase of the engineering control system (inputs with units, toggles,
            segmented controls, sliders, searchable selectors) and motion rules.
          </p>
          <a href="/design" className="mt-2 inline-block rounded border border-nx-line px-3 py-1.5 text-xs hover:border-nx-accent">
            Open control showcase
          </a>
        </div>
        <div className="rounded-md bg-nx-panel p-4 border border-nx-line">
          <h2 className="text-sm font-semibold text-nx-ink">Data management</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-nx-muted">
            Scenarios, custom devices, research findings, and assessments persist in local SQLite
            (backend/var/nexuslayer.db, override with NEXUS_DB_PATH). Simulation sessions are per-scenario
            in backend memory; restarting the backend clears live session state but not saved objects.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
