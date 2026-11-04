"use client";

import { useState } from "react";
import {
  type NodePortConfig,
  type ScenarioDetail,
  type TopologyNode,
} from "@/lib/api";

export type NodePatch = { label?: string; device_id?: string | null; ports?: NodePortConfig[] };

const PORT_KINDS = ["ethernet", "fiber", "wifi", "cellular", "satellite", "serial", "power", "microwave", "bluetooth", "lpwan"];

const field =
  "w-full rounded border border-nx-line bg-nx-panel px-1.5 py-1 text-[11px] text-nx-body focus:border-nx-accent focus:outline-none";

function NumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null | undefined;
  onChange: (v: number | null) => void;
}) {
  return (
    <label className="block text-[10px] text-nx-muted">
      {label}
      <input
        type="number"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className={`${field} font-mono`}
      />
    </label>
  );
}

function PortRow({
  port,
  onChange,
  onRemove,
}: {
  port: NodePortConfig;
  onChange: (p: NodePortConfig) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const set = (k: keyof NodePortConfig, v: unknown) => onChange({ ...port, [k]: v });
  const wireless = ["wifi", "cellular", "satellite", "microwave", "bluetooth", "lpwan"].includes(port.kind);
  const wired = port.kind === "ethernet" || port.kind === "fiber";
  return (
    <div className="rounded border border-nx-line bg-nx-panel px-2 py-1">
      <div className="flex items-center gap-2">
        <button onClick={() => setOpen(!open)} aria-expanded={open} className="text-nx-muted">
          {open ? "▾" : "▸"}
        </button>
        <span className={`h-1.5 w-1.5 rounded-full ${port.enabled === false ? "bg-nx-muted" : "bg-nx-ok"}`} />
        <span className="font-mono text-[11px] text-nx-ink">{port.name}</span>
        <span className="font-mono text-[10px] text-nx-muted">{port.kind}</span>
        <button onClick={onRemove} aria-label={`Remove ${port.name}`} className="ml-auto text-nx-muted hover:text-nx-badink">
          ×
        </button>
      </div>
      {open && (
        <div className="mt-1.5 grid grid-cols-2 gap-1.5 pb-1">
          <label className="flex items-center gap-1.5 text-[10px] text-nx-body">
            <input type="checkbox" checked={port.enabled !== false} onChange={(e) => set("enabled", e.target.checked)} />
            Enabled
          </label>
          {port.kind === "power" && (
            <p className="text-[10px] text-nx-warn">Power ports cannot carry a data link.</p>
          )}
          {wired && (
            <>
              <NumField label="Speed (Mbps)" value={port.speed_mbps} onChange={(v) => set("speed_mbps", v)} />
              <NumField label="MTU" value={port.mtu} onChange={(v) => set("mtu", v)} />
              {port.kind === "ethernet" && (
                <NumField label="VLAN" value={port.vlan} onChange={(v) => set("vlan", v)} />
              )}
              {port.kind === "fiber" && (
                <NumField label="Wavelength (nm)" value={port.wavelength_nm} onChange={(v) => set("wavelength_nm", v)} />
              )}
            </>
          )}
          {wireless && (
            <>
              <NumField label="Freq (MHz)" value={port.frequency_mhz} onChange={(v) => set("frequency_mhz", v)} />
              <NumField label="TX power (dBm)" value={port.tx_power_dbm} onChange={(v) => set("tx_power_dbm", v)} />
              <NumField label="Antenna gain (dBi)" value={port.antenna_gain_dbi} onChange={(v) => set("antenna_gain_dbi", v)} />
              {port.kind === "wifi" && (
                <label className="block text-[10px] text-nx-muted">
                  Channel
                  <input value={port.channel ?? ""} onChange={(e) => set("channel", e.target.value || null)} className={field} />
                </label>
              )}
              {port.kind === "cellular" && (
                <label className="col-span-2 block text-[10px] text-nx-muted">
                  Bands (comma-separated)
                  <input
                    value={(port.bands ?? []).join(", ")}
                    onChange={(e) =>
                      set(
                        "bands",
                        e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                      )
                    }
                    className={field}
                    placeholder="B3, B20, n78"
                  />
                </label>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function NodePortsEditor({
  node,
  onPatch,
}: {
  node: TopologyNode;
  onPatch: (patch: NodePatch) => Promise<ScenarioDetail>;
}) {
  const [ports, setPorts] = useState<NodePortConfig[]>(node.ports ?? []);
  const [draftName, setDraftName] = useState("");
  const [draftKind, setDraftKind] = useState("ethernet");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resync when a different node (or freshly saved node) arrives.
  const [seenId, setSeenId] = useState(node.id);
  if (node.id !== seenId) {
    setSeenId(node.id);
    setPorts(node.ports ?? []);
    setError(null);
  }

  const dirty = JSON.stringify(ports) !== JSON.stringify(node.ports ?? []);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const detail = await onPatch({ ports });
      // Resync to the server-canonical form (defaults filled in) so dirty clears.
      const fresh = detail.topology.nodes.find((n) => n.id === node.id);
      setPorts(fresh?.ports ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const addPort = () => {
    const name = draftName.trim() || `${draftKind}-${ports.length + 1}`;
    if (ports.some((p) => p.name === name)) {
      setError(`A port named ${name} already exists.`);
      return;
    }
    setPorts([...ports, { name, kind: draftKind, enabled: true }]);
    setDraftName("");
  };

  return (
    <div className="mt-2 border-t border-nx-line pt-2">
      <p className="nx-label">Interfaces / ports ({ports.length})</p>
      <div className="mt-1 space-y-1">
        {ports.length === 0 && <p className="text-[10px] text-nx-muted">No interfaces. Add one to model ports.</p>}
        {ports.map((p, i) => (
          <PortRow
            key={`${p.name}-${i}`}
            port={p}
            onChange={(next) => setPorts(ports.map((x, j) => (j === i ? next : x)))}
            onRemove={() => setPorts(ports.filter((_, j) => j !== i))}
          />
        ))}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        <input
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          placeholder="Port name"
          className={field}
          aria-label="New port name"
        />
        <select value={draftKind} onChange={(e) => setDraftKind(e.target.value)} className={field} aria-label="New port kind">
          {PORT_KINDS.map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
        <button onClick={addPort} className="nx-btn-primary shrink-0">
          Add
        </button>
      </div>
      {error && <p className="mt-1 text-[10px] text-nx-badink">{error}</p>}
      <button onClick={save} disabled={saving || !dirty} className="nx-btn-primary mt-1.5 w-full disabled:opacity-40">
        {saving ? "Saving…" : dirty ? "Save interfaces" : "Saved"}
      </button>
    </div>
  );
}
