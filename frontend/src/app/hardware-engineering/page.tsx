"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { NxField, NxNumberInput, NxTextInput, NxTextarea } from "@/components/ui/controls";
import { checkDevice, fetchHardware, runAgent, saveDevice, type DeviceSpec } from "@/lib/api";

const BLANK: DeviceSpec = {
  device_id: "custom-device-01",
  name: "Custom Device",
  category: "gateway",
  family: "networking",
  model_identifier: "CUSTOM-1",
  description: "",
  interfaces: [{ name: "eth0", technology: "Ethernet", max_throughput_mbps: 1000 }],
  protocols: ["IPv4"],
  frequency_bands: [],
  throughput_mbps: 1000,
  limitations: [],
};

export default function HardwareEngineeringPage() {
  const [spec, setSpec] = useState<DeviceSpec>(BLANK);
  const [ifaceText, setIfaceText] = useState("eth0: Ethernet @ 1000 Mbps");
  const [library, setLibrary] = useState<DeviceSpec[]>([]);
  const [result, setResult] = useState<{ verdict: string; issues: { message: string }[]; warnings: { message: string }[]; note: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aiPrompt, setAiPrompt] = useState("A gateway for a remote mobile platform switching between terrestrial LTE and satellite.");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchHardware().then(setLibrary).catch(() => {});
  }, []);

  const set = (patch: Partial<DeviceSpec>) => setSpec((s) => ({ ...s, ...patch }));

  const parseInterfaces = (text: string) => {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    return lines.map((line, i) => {
      const m = line.match(/^([^:]+):\s*([^@]+?)(?:\s*@\s*([\d.]+)\s*mbps)?$/i);
      if (!m) return { name: `if${i}`, technology: line };
      return {
        name: m[1].trim(),
        technology: m[2].trim(),
        max_throughput_mbps: m[3] ? Number(m[3]) : undefined,
      };
    });
  };

  const startFrom = (deviceId: string) => {
    const found = library.find((d) => d.device_id === deviceId);
    if (!found) return;
    const copy = { ...found, device_id: `${found.device_id}-custom`, name: `${found.name} (custom)`, origin: "custom" };
    setSpec(copy);
    setIfaceText(copy.interfaces.map((i) => `${i.name}: ${i.technology}${i.max_throughput_mbps ? ` @ ${i.max_throughput_mbps} Mbps` : ""}`).join("\n"));
    setMessage(`Started from ${found.name}. Edit and run the feasibility check.`);
  };

  const doCheck = async () => {
    setError(null);
    try {
      const full = { ...spec, interfaces: parseInterfaces(ifaceText) };
      setSpec(full);
      setResult(await checkDevice(full));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Check failed");
    }
  };

  const doSave = async () => {
    setError(null);
    try {
      const full = { ...spec, interfaces: parseInterfaces(ifaceText), origin: "custom" };
      const saved = await saveDevice(full);
      setSpec(saved);
      setLibrary(await fetchHardware());
      setMessage(`Saved ${saved.device_id} to the reusable catalog.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    }
  };

  const doAiConcept = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await runAgent("hardware", aiPrompt);
      const concept = (res.result.ai?.concept ?? res.result.local.concept) as DeviceSpec | null;
      if (concept) {
        setSpec({ ...concept, origin: "ai_proposal" });
        setIfaceText(concept.interfaces.map((i) => `${i.name}: ${i.technology}${i.max_throughput_mbps ? ` @ ${i.max_throughput_mbps} Mbps` : ""}`).join("\n"));
        setMessage(`Proposal loaded (${res.provenance}, ai: ${res.ai_status}). Validate before saving.`);
      } else {
        setMessage("No concrete concept returned; refine the description.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Agent failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell title="Hardware Engineering" subtitle="Specification-level design, feasibility checks, and catalog promotion.">
      {message && <p className="nx-note-ok mb-3">{message}</p>}
      {error && <p className="nx-note-bad mb-3">{error}</p>}
      <div className="flex flex-col gap-8 lg:flex-row">
        <div className="min-w-0 flex-1">
          <div className="mb-4 flex gap-2">
            <select onChange={(e) => e.target.value && startFrom(e.target.value)} defaultValue="" aria-label="Start from existing device" className="min-w-0 flex-1 rounded-md border border-nx-line bg-nx-raised px-2 py-1.5 text-xs">
              <option value="">Start from existing device…</option>
              {library.map((d) => (
                <option key={d.device_id} value={d.device_id}>
                  {d.name}
                </option>
              ))}
            </select>
            <button onClick={() => { setSpec(BLANK); setIfaceText("eth0: Ethernet @ 1000 Mbps"); }} className="nx-btn-ghost">
              Blank spec
            </button>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <NxField label="Device ID">
              <NxTextInput value={spec.device_id} onChange={(v) => set({ device_id: v })} placeholder="device_id" />
            </NxField>
            <NxField label="Name">
              <NxTextInput value={spec.name} onChange={(v) => set({ name: v })} placeholder="Name" />
            </NxField>
            <NxField label="Category">
              <NxTextInput value={spec.category} onChange={(v) => set({ category: v })} placeholder="category" />
            </NxField>
            <NxField label="Model identifier">
              <NxTextInput value={spec.model_identifier} onChange={(v) => set({ model_identifier: v })} placeholder="model identifier" />
            </NxField>
            <NxField label="Throughput">
              <NxNumberInput value={spec.throughput_mbps ?? ""} onChange={(nv) => set({ throughput_mbps: nv === "" ? undefined : nv })} unit="Mbps" min={0} />
            </NxField>
            <NxField label="Power">
              <NxNumberInput value={spec.power_watts ?? ""} onChange={(nv) => set({ power_watts: nv === "" ? undefined : nv })} unit="W" min={0} />
            </NxField>
            <NxField label="Transmit power">
              <NxNumberInput value={spec.tx_power_dbm ?? ""} onChange={(nv) => set({ tx_power_dbm: nv === "" ? undefined : nv })} unit="dBm" step={0.1} />
            </NxField>
            <NxField label="Receiver sensitivity">
              <NxNumberInput value={spec.rx_sensitivity_dbm ?? ""} onChange={(nv) => set({ rx_sensitivity_dbm: nv === "" ? undefined : nv })} unit="dBm" step={0.1} />
            </NxField>
            <NxField label="Approximate cost">
              <NxNumberInput value={spec.cost_usd_approx ?? ""} onChange={(nv) => set({ cost_usd_approx: nv === "" ? undefined : nv })} unit="USD" min={0} />
            </NxField>
            <NxField label="Range">
              <NxNumberInput value={spec.range_km ?? ""} onChange={(nv) => set({ range_km: nv === "" ? undefined : nv })} unit="km" min={0} step={0.1} />
            </NxField>
          </div>
          <NxField label="Purpose and expected functionality">
            <NxTextarea rows={2} value={spec.description ?? ""} onChange={(v) => set({ description: v })} placeholder="Purpose and expected functionality" />
          </NxField>
          <NxField label="Interfaces (one per line: name: Technology @ Mbps)">
            <NxTextarea rows={4} value={ifaceText} onChange={setIfaceText} />
          </NxField>
          <div className="mt-3 flex gap-2">
            <button onClick={() => void doCheck()} className="nx-btn-primary">
              Run feasibility check
            </button>
            <button onClick={() => void doSave()} className="nx-btn-ghost">
              Save to catalog
            </button>
          </div>
          {result && (
            <div className="mt-3 rounded bg-nx-workspace p-3 text-xs border border-nx-line">
              <p className="font-semibold">Verdict: {result.verdict}</p>
              {result.issues.map((i, n) => (
                <p key={n} className="text-nx-badink">Issue: {i.message}</p>
              ))}
              {result.warnings.map((w, n) => (
                <p key={n} className="text-nx-warn">Warning: {w.message}</p>
              ))}
              <p className="mt-1 text-[11px] text-nx-muted">{result.note}</p>
            </div>
          )}
        </div>
        <aside className="w-full shrink-0 lg:w-80">
          <h2 className="text-sm font-semibold tracking-tight text-nx-ink">AI-assisted concept</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-nx-muted">Describe the problem; the agent proposes a specification-level concept for review.</p>
          <div className="mt-2">
            <NxField label="Engineering problem">
              <NxTextarea rows={4} value={aiPrompt} onChange={setAiPrompt} />
            </NxField>
          </div>
          <button onClick={() => void doAiConcept()} disabled={busy} className="nx-btn-primary mt-2 w-full">
            {busy ? "Working…" : "Propose concept"}
          </button>
          <p className="mt-2 text-[10px] leading-relaxed text-nx-muted">
            AI output is an unvalidated proposal. Language-model inference cannot verify working physical hardware.
          </p>
        </aside>
      </div>
    </AppShell>
  );
}
