"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import AppShell from "@/components/AppShell";
import DeviceArt, { ART_LICENSE } from "@/components/devices/DeviceArt";
import DeviceIcon from "@/components/devices/DeviceIcon";
import { fetchHardware, fetchHardwareCategories, type DeviceSpec } from "@/lib/api";

function Spec({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-nx-line/60 py-1">
      <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-nx-muted">{k}</span>
      <span className="text-right text-[11px] text-nx-body">{v}</span>
    </div>
  );
}

export default function HardwarePage() {
  return (
    <Suspense fallback={<AppShell title="Hardware Library"><p className="text-xs text-nx-muted">Loading…</p></AppShell>}>
      <HardwarePageInner />
    </Suspense>
  );
}

function HardwarePageInner() {
  const searchParams = useSearchParams();
  const [devices, setDevices] = useState<DeviceSpec[]>([]);
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<DeviceSpec | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Deep link from inspectors (?device=<device_id>) selects the canonical record.
  const wanted = searchParams.get("device") ?? "";

  useEffect(() => {
    if (!wanted) return;
    fetchHardware({ search: wanted })
      .then((list) => {
        const hit = list.find((d) => d.device_id === wanted) ?? list[0] ?? null;
        if (hit) {
          setCategory("");
          setSearch("");
          setSelected(hit);
        }
      })
      .catch(() => {});
  }, [wanted]);

  useEffect(() => {
    fetchHardwareCategories().then((c) => setCategories(c.categories)).catch(() => {});
  }, []);

  useEffect(() => {
    let current = true;
    setLoading(true);
    const timer = setTimeout(() => {
      fetchHardware({ category: category || undefined, search: search || undefined })
        .then((list) => {
          if (!current) return;
          setDevices(list);
          setError(null);
          if (selected && !list.some((d) => d.device_id === selected.device_id)) setSelected(null);
        })
        .catch((e) => { if (current) setError(e instanceof Error ? e.message : "Failed to load devices"); })
        .finally(() => { if (current) setLoading(false); });
    }, 200);
    return () => { current = false; clearTimeout(timer); };
  }, [category, search]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AppShell
      title="Hardware Library"
      subtitle="Representative illustrative equipment. Artwork is original NexusLayer illustration (CC0); specs are examples, not manufacturer datasheets."
    >
      {error && <p className="nx-note-bad mb-3">{error}</p>}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search devices, technologies…"
          className="nx-field max-w-64"
        />
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="nx-field max-w-48">
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <span className="font-mono text-[11px] text-nx-muted">{devices.length} device(s)</span>
      </div>
      <div className="flex items-start gap-3">
        <div className="grid flex-1 grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
          {devices.map((d) => (
            <button
              key={d.device_id}
              onClick={() => setSelected(d)}
              className={`nx-panel overflow-hidden text-left transition-colors hover:border-nx-accent/60 ${
                selected?.device_id === d.device_id ? "!border-nx-accent" : ""
              }`}
            >
              <div className="h-36 border-b border-nx-line bg-nx-workspace p-2">
                <DeviceArt kind={d.category} label={d.name} />
              </div>
              <div className="p-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="truncate text-[13px] font-semibold tracking-tight text-nx-ink">{d.name}</h2>
                  {d.origin !== "library" && (
                    <span className="shrink-0 rounded bg-nx-warn/15 px-1.5 py-0.5 font-mono text-[10px] font-medium text-nx-warn">
                      {d.origin}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide text-nx-muted">
                  <DeviceIcon kind={d.category} size={13} />
                  {d.category} · {d.model_identifier}
                </p>
                <p className="mt-1.5 truncate text-[11px] text-nx-body">
                  {d.interfaces.map((i) => i.technology).join(" · ") || "No interfaces"}
                </p>
                <p className="mt-0.5 font-mono text-[11px] text-nx-muted">
                  {d.throughput_mbps != null ? `${d.throughput_mbps} Mbps` : "—"}
                  {d.cost_usd_approx != null ? ` · ≈$${d.cost_usd_approx}` : ""}
                  {d.range_km != null ? ` · ${d.range_km} km` : ""}
                </p>
              </div>
            </button>
          ))}
          {loading && devices.length === 0 && <p className="text-xs text-nx-muted" role="status">Loading equipment…</p>}
          {!loading && devices.length === 0 && !error && (
            <p className="text-xs text-nx-muted">No devices match this filter.</p>
          )}
        </div>
        <aside className="nx-panel sticky top-0 hidden max-h-[calc(100vh-140px)] w-[340px] shrink-0 overflow-y-auto p-4 xl:block">
          {!selected && <p className="text-xs text-nx-muted">Select a device to inspect its specification.</p>}
          {selected && (
            <div>
              <div className="h-44 rounded border border-nx-line bg-nx-workspace p-2">
                <DeviceArt kind={selected.category} label={selected.name} />
              </div>
              <h2 className="mt-3 text-sm font-semibold tracking-tight text-nx-ink">{selected.name}</h2>
              <p className="font-mono text-[10px] text-nx-muted">{selected.device_id} · {selected.model_identifier}</p>
              {selected.origin !== "library" && (
                <p className="nx-note-warn mt-2">
                  {selected.origin === "ai_proposal"
                    ? "Conceptual illustration for an unvalidated AI proposal — not a real product."
                    : "Custom specification — illustrative values."}
                </p>
              )}
              {selected.description && <p className="mt-2 text-[11px] leading-relaxed text-nx-body">{selected.description}</p>}
              <h3 className="nx-label mt-3">Interfaces</h3>
              {selected.interfaces.map((i) => (
                <Spec
                  key={i.name}
                  k={i.name}
                  v={`${i.technology}${i.max_throughput_mbps != null ? ` · ${i.max_throughput_mbps} Mbps` : ""}${i.connector ? ` · ${i.connector}` : ""}`}
                />
              ))}
              <h3 className="nx-label mt-3">Characteristics</h3>
              <Spec k="Throughput" v={selected.throughput_mbps != null ? `${selected.throughput_mbps} Mbps` : "—"} />
              <Spec k="Latency" v={selected.latency_ms_typical != null ? `${selected.latency_ms_typical} ms` : "—"} />
              <Spec k="TX / RX" v={`${selected.tx_power_dbm ?? "—"} dBm / ${selected.rx_sensitivity_dbm ?? "—"} dBm`} />
              <Spec k="Range" v={selected.range_km != null ? `${selected.range_km} km` : "—"} />
              <Spec k="Antenna" v={selected.antenna ?? "—"} />
              <Spec k="Power" v={selected.power_watts != null ? `${selected.power_watts} W` : "—"} />
              <Spec k="Cost / OPEX" v={`≈$${selected.cost_usd_approx ?? "—"} / $${selected.opex_usd_per_month ?? "—"}/mo`} />
              <Spec k="Mobility" v={`${selected.mobility} · ${selected.environment}`} />
              {selected.protocols.length > 0 && <Spec k="Protocols" v={selected.protocols.join(", ")} />}
              {selected.frequency_bands.length > 0 && <Spec k="Bands" v={selected.frequency_bands.join(", ")} />}
              {selected.limitations.length > 0 && (
                <>
                  <h3 className="nx-label mt-3">Limitations</h3>
                  {selected.limitations.map((l, i) => (
                    <p key={i} className="text-[11px] leading-relaxed text-nx-body">• {l}</p>
                  ))}
                </>
              )}
              <p className="mt-3 rounded bg-nx-workspace px-2 py-1.5 font-mono text-[10px] leading-relaxed text-nx-muted">
                Evidence: {selected.evidence?.source} · confidence {selected.evidence?.confidence}. {selected.evidence?.note}
                <br />Artwork: {ART_LICENSE.origin} ({ART_LICENSE.license}).
              </p>
              <Link
                href={`/architecture?add=${encodeURIComponent(selected.device_id)}`}
                className="nx-btn-primary mt-3 block text-center"
              >
                Add to architecture
              </Link>
            </div>
          )}
        </aside>
      </div>
    </AppShell>
  );
}
