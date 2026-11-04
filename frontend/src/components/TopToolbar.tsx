"use client";

import { TERRESTRIAL_LINK_ID, type SimulationState } from "@/lib/api";

interface ToolbarProps {
  sim: SimulationState | null;
  busy: boolean;
  onStart: () => void;
  onPause: () => void;
  onReset: () => void;
  onFailTerrestrial: () => void;
  onRestoreTerrestrial: () => void;
}

const baseButton =
  "rounded-md border px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40";
const primaryButton = `${baseButton} border-slate-900 bg-slate-900 text-white hover:bg-slate-700 disabled:hover:bg-slate-900`;
const plainButton = `${baseButton} border-slate-300 bg-white text-slate-700 hover:bg-slate-50`;
const dangerButton = `${baseButton} border-red-300 bg-white text-red-700 hover:bg-red-50`;
const restoreButton = `${baseButton} border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-50`;

export default function TopToolbar({
  sim,
  busy,
  onStart,
  onPause,
  onReset,
  onFailTerrestrial,
  onRestoreTerrestrial,
}: ToolbarProps) {
  const terrestrialDown = sim?.links.some(
    (l) => l.id === TERRESTRIAL_LINK_ID && l.status === "down"
  );
  const simStatus = sim?.status ?? "…";

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-900 text-[11px] font-bold text-white">
          NX
        </span>
        <h1 className="text-sm font-semibold text-slate-900">NexusLayer</h1>
        <span className="hidden text-xs text-slate-500 sm:inline">
          Maritime connectivity MVP
        </span>
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-600">
          {simStatus}
        </span>
      </div>
      <div className="flex items-center gap-2" role="toolbar" aria-label="Simulation controls">
        <button className={primaryButton} disabled={busy || !sim} onClick={onStart}>
          Run
        </button>
        <button className={plainButton} disabled={busy || !sim} onClick={onPause}>
          Pause
        </button>
        <button className={plainButton} disabled={busy || !sim} onClick={onReset}>
          Reset
        </button>
        <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden />
        <button
          className={dangerButton}
          disabled={busy || !sim || terrestrialDown}
          onClick={onFailTerrestrial}
          title="Simulate failure of the terrestrial cellular link"
        >
          Fail terrestrial link
        </button>
        <button
          className={restoreButton}
          disabled={busy || !sim || !terrestrialDown}
          onClick={onRestoreTerrestrial}
          title="Restore the terrestrial cellular link"
        >
          Restore terrestrial
        </button>
      </div>
    </header>
  );
}
