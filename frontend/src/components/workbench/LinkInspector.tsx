"use client";

import { useEffect, useState } from "react";
import {
  fetchLinkPhysics,
  type LinkPhysics,
  type LinkPhysicsCalc,
  type LinkSecurityConfig,
  type ScenarioDetail,
  type TopologyLink,
} from "@/lib/api";

export type LinkPatch = {
  label?: string | null; status?: string; source_port?: string | null; target_port?: string | null;
  protocols?: string[]; security?: LinkSecurityConfig | null; experimental?: boolean;
};

const TABS = ["Overview", "Medium", "Calculations", "Protocols", "Security", "Costs", "Refs"] as const;
type Tab = (typeof TABS)[number];

const field =
  "w-full rounded border border-nx-line bg-nx-panel px-1.5 py-1 text-[11px] text-nx-body focus:border-nx-accent focus:outline-none";

function CalcCard({ calc }: { calc: LinkPhysicsCalc }) {
  if (calc.status === "not_calculated") {
    return (
      <div className="rounded border border-nx-line bg-nx-panel px-2 py-1.5">
        <p className="text-[11px] font-semibold text-nx-ink">{calc.title}</p>
        <p className="mt-0.5 text-[11px] font-medium text-nx-warn">Not calculated</p>
        {calc.formula && <p className="mt-0.5 font-mono text-[10px] text-nx-muted">{calc.formula}</p>}
        {(calc.missing ?? []).length > 0 && (
          <ul className="mt-1 list-disc pl-4 text-[10px] text-nx-muted">
            {(calc.missing ?? []).map((m) => (
              <li key={m}>Missing: {m}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  return (
    <div className="rounded border border-nx-line bg-nx-panel px-2 py-1.5">
      <p className="text-[11px] font-semibold text-nx-ink">{calc.title}</p>
      {calc.formula && <p className="mt-0.5 font-mono text-[10px] text-nx-muted">{calc.formula}</p>}
      <dl className="mt-1 space-y-0.5 font-mono text-[10px]">
        {(calc.inputs ?? []).map((i) => (
          <div key={i.label} className="flex justify-between gap-2">
            <dt className="text-nx-muted">{i.label}</dt>
            <dd className="text-nx-body">
              {String(i.value)}
              {i.unit ? ` ${i.unit}` : ""}
              {i.how ? <span className="text-nx-muted"> ({i.how})</span> : null}
            </dd>
          </div>
        ))}
        {(calc.outputs ?? []).map((o) => (
          <div key={o.label} className="flex justify-between gap-2 border-t border-nx-line pt-0.5">
            <dt className="text-nx-accent">{o.label}</dt>
            <dd className="font-semibold text-nx-ink">
              {String(o.value)}
              {o.unit ? ` ${o.unit}` : ""}
            </dd>
          </div>
        ))}
      </dl>
      {(calc.assumptions ?? []).length > 0 && (
        <ul className="mt-1 list-disc pl-4 text-[10px] text-nx-muted">
          {(calc.assumptions ?? []).map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SecurityEditor({
  initial,
  saving,
  error,
  onSave,
}: {
  initial: LinkSecurityConfig | null;
  saving: boolean;
  error: string | null;
  onSave: (sec: LinkSecurityConfig) => void;
}) {
  const [form, setForm] = useState<LinkSecurityConfig>(
    initial ?? { protocol: "none", scope: "link", enabled: false, confidentiality: false, integrity: false },
  );
  useEffect(() => {
    if (initial) setForm(initial);
  }, [initial?.protocol, initial?.scope, initial?.enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof LinkSecurityConfig, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-2 text-[11px] text-nx-body">
        <input type="checkbox" checked={form.enabled ?? false} onChange={(e) => set("enabled", e.target.checked)} />
        Security enabled in simulation
      </label>
      <label className="block text-[11px] text-nx-body">
        <span className="nx-label">Protocol</span>
        <select value={form.protocol} onChange={(e) => set("protocol", e.target.value)} className={field}>
          {["none", "WPA2", "WPA3", "LTE-AKA", "5G-AKA", "IPsec", "TLS 1.3", "MACsec", "DVB-RCS2", "Other"].map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </label>
      {(form.enabled ?? false) && form.protocol === "none" && (
        <p className="text-[10px] text-nx-warn">Enabled but no protocol selected — the hop is modeled as unprotected.</p>
      )}
      <label className="block text-[11px] text-nx-body">
        <span className="nx-label">Scope</span>
        <select value={form.scope ?? "link"} onChange={(e) => set("scope", e.target.value)} className={field}>
          {["link", "network", "transport", "application"].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </label>
      <label className="block text-[11px] text-nx-body">
        <span className="nx-label">Authentication</span>
        <input value={form.auth_method ?? ""} onChange={(e) => set("auth_method", e.target.value || null)} className={field} placeholder="e.g. PSK, EAP-TLS, SIM" />
      </label>
      <label className="block text-[11px] text-nx-body">
        <span className="nx-label">Cipher family</span>
        <input value={form.cipher_family ?? ""} onChange={(e) => set("cipher_family", e.target.value || null)} className={field} placeholder="e.g. AES-GCM" />
      </label>
      <div className="flex gap-3 text-[11px] text-nx-body">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={form.confidentiality ?? false} onChange={(e) => set("confidentiality", e.target.checked)} />
          Confidentiality
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={form.integrity ?? false} onChange={(e) => set("integrity", e.target.checked)} />
          Integrity
        </label>
      </div>
      <label className="block text-[11px] text-nx-body">
        <span className="nx-label">Notes</span>
        <input value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} className={field} placeholder="Modeled metadata only — no real crypto" />
      </label>
      {error && <p className="text-[10px] text-nx-badink">{error}</p>}
      <button onClick={() => onSave(form)} disabled={saving} className="nx-btn-primary w-full">
        {saving ? "Saving…" : "Save security"}
      </button>
    </div>
  );
}

export default function LinkInspector({
  scenarioId,
  edge,
  onPatch,
}: {
  scenarioId: string;
  edge: TopologyLink;
  onPatch: (patch: LinkPatch) => Promise<ScenarioDetail>;
}) {
  const [tab, setTab] = useState<Tab>("Overview");
  const [physics, setPhysics] = useState<LinkPhysics | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [protoDraft, setProtoDraft] = useState("");

  useEffect(() => {
    let cancelled = false;
    setPhysics(null);
    setLoadError(null);
    fetchLinkPhysics(scenarioId, edge.id)
      .then((p) => {
        if (!cancelled) setPhysics(p);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Failed to load link physics");
      });
    return () => {
      cancelled = true;
    };
  }, [scenarioId, edge.id]);

  const save = async (patch: LinkPatch) => {
    setSaving(true);
    setSaveError(null);
    try {
      const detail = await onPatch(patch);
      const p = await fetchLinkPhysics(detail.id, edge.id);
      setPhysics(p);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const protocols = edge.protocols ?? [];
  const addProtocol = () => {
    const v = protoDraft.trim();
    if (!v || protocols.includes(v)) return;
    setProtoDraft("");
    void save({ protocols: [...protocols, v] });
  };

  return (
    <div className="mt-1">
      <p className="text-xs font-semibold text-nx-ink">{edge.label ?? edge.id}</p>
      <p className="font-mono text-[10px] text-nx-muted">
        {edge.source} → {edge.target}
      </p>
      <a
        href={`/physics?scenario=${encodeURIComponent(scenarioId)}&link=${encodeURIComponent(edge.id)}`}
        className="mt-1.5 inline-block rounded border border-nx-line px-2 py-0.5 text-[10px] hover:border-nx-accent"
      >
        Explore Physics →
      </a>
      <div className="mt-2 flex flex-wrap gap-1 border-b border-nx-line pb-1">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            aria-pressed={tab === t}
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
              tab === t ? "bg-nx-raised text-nx-ink" : "text-nx-muted hover:text-nx-body"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="pt-2">
        {loadError && <p className="text-[11px] text-nx-badink">{loadError}</p>}
        {!physics && !loadError && <p className="text-[11px] text-nx-muted">Loading link analysis…</p>}
        {tab === "Overview" && physics && (
          <div className="space-y-1 text-[11px] text-nx-body">
            <p>Technology: <span className="font-mono">{physics.technology}</span> ({physics.medium})</p>
            <p className="font-mono">
              {physics.configured.latency_ms} ms · {physics.configured.bandwidth_mbps} Mbps · rel {physics.configured.reliability}
            </p>
            <p className="text-[10px] text-nx-muted">{physics.configured.note}</p>
            <p>
              Distance:{" "}
              {physics.distance_km != null ? (
                <span className="font-mono">{physics.distance_km} km</span>
              ) : (
                <span className="text-nx-warn">Not calculated</span>
              )}{" "}
              <span className="text-[10px] text-nx-muted">({physics.distance_how})</span>
            </p>
            {physics.frequency_mhz != null && (
              <p className="font-mono">
                {physics.frequency_mhz} MHz
                {physics.wavelength_m != null ? ` · λ ${physics.wavelength_m} m` : ""}
              </p>
            )}
            {physics.live && (
              <div className="rounded border border-nx-line bg-nx-panel px-2 py-1.5">
                <p className="nx-label">Live simulation</p>
                <p className="font-mono text-[10px]">
                  {physics.live.status} · suitable: {String(physics.live.suitable)}
                  {physics.live.signal_quality ? ` · ${physics.live.signal_quality}` : ""}
                </p>
                {physics.live.suitability_reason && (
                  <p className="text-[10px] text-nx-muted">{physics.live.suitability_reason}</p>
                )}
                {(physics.live.on_active_route || physics.live.on_backup_route) && (
                  <p className="text-[10px] text-nx-accent">
                    {physics.live.on_active_route ? "On active route" : "On backup route"}
                  </p>
                )}
              </div>
            )}
            <label className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                checked={edge.experimental ?? false}
                onChange={(e) => void save({ experimental: e.target.checked })}
              />
              Experimental (bypass compatibility checks)
            </label>
            {saveError && <p className="text-[10px] text-nx-badink">{saveError}</p>}
          </div>
        )}

        {tab === "Medium" && physics && (
          <div className="space-y-1.5 text-[11px] text-nx-body">
            <p className="text-[11px] font-semibold text-nx-ink">{physics.medium_explainer.title}</p>
            {physics.medium_explainer.mechanism.map((p, i) => (
              <p key={i} className="leading-relaxed">{p}</p>
            ))}
            <ul className="list-disc pl-4 text-[10px] text-nx-muted">
              {physics.medium_explainer.key_points.map((k) => (
                <li key={k}>{k}</li>
              ))}
            </ul>
          </div>
        )}

        {tab === "Calculations" && physics && (
          <div className="space-y-1.5">
            {physics.calculations.map((c) => (
              <CalcCard key={c.id} calc={c} />
            ))}
            <p className="text-[10px] text-nx-muted">{physics.provenance}</p>
          </div>
        )}

        {tab === "Protocols" && (
          <div className="space-y-1.5 text-[11px] text-nx-body">
            {protocols.length === 0 && <p className="text-nx-muted">No protocols declared.</p>}
            {protocols.map((p) => (
              <div key={p} className="flex items-center gap-2 rounded border border-nx-line bg-nx-panel px-2 py-1">
                <span className="font-mono">{p}</span>
                <button
                  onClick={() => void save({ protocols: protocols.filter((x) => x !== p) })}
                  className="ml-auto text-nx-muted hover:text-nx-badink"
                  aria-label={`Remove ${p}`}
                >
                  ×
                </button>
              </div>
            ))}
            <div className="flex gap-1.5">
              <input
                value={protoDraft}
                onChange={(e) => setProtoDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addProtocol();
                }}
                placeholder="e.g. TCP, UDP, GTP-U, QUIC"
                className={field}
                aria-label="Add protocol"
              />
              <button onClick={addProtocol} disabled={saving} className="nx-btn-primary shrink-0">
                Add
              </button>
            </div>
            {saveError && <p className="text-[10px] text-nx-badink">{saveError}</p>}
            <p className="text-[10px] text-nx-muted">
              Free-form protocol names (e.g. IPv4, TCP, GTP-U); checked for presence, not semantics.
            </p>
          </div>
        )}

        {tab === "Security" && physics && (
          <div className="space-y-1.5 text-[11px] text-nx-body">
            {physics.security?.scope_warning && (
              <p className="rounded border border-nx-warn/40 bg-nx-panel px-2 py-1 text-[10px] text-nx-warn">
                {physics.security.scope_warning}
              </p>
            )}
            <SecurityEditor
              initial={physics.security}
              saving={saving}
              error={saveError}
              onSave={(sec) => void save({ security: sec })}
            />
            <div className="pt-1">
              <p className="nx-label">References</p>
              <ul className="list-disc pl-4 text-[10px] text-nx-muted">
                {physics.security_references.map((r) => (
                  <li key={r.label}>
                    {r.label} — {r.note}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {tab === "Costs" && physics && (
          <div className="space-y-1 text-[11px] text-nx-body">
            <p className="font-mono">${physics.costs.cost_per_gb_usd}/GB (illustrative tariff)</p>
            {physics.costs.devices.map((d) => (
              <p key={d.node_id} className="font-mono text-[10px]">
                {d.name}: capex {d.capex_usd_approx != null ? `$${d.capex_usd_approx}` : "—"}
                {d.opex_usd_per_month != null ? ` · $${d.opex_usd_per_month}/mo` : ""}
              </p>
            ))}
            {physics.costs.devices.length === 0 && (
              <p className="text-nx-muted">No catalog devices attached to these endpoints.</p>
            )}
          </div>
        )}

        {tab === "Refs" && physics && (
          <ul className="list-disc pl-4 text-[11px] text-nx-body">
            {physics.references.map((r) => (
              <li key={r.label}>{r.label}</li>
            ))}
            {physics.references.length === 0 && <li className="text-nx-muted">No references registered.</li>}
          </ul>
        )}
      </div>
    </div>
  );
}
