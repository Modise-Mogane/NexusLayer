"use client";

export default function TopToolbar() {
  const buttonClass =
    "rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-400 cursor-not-allowed";
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
      </div>
      <div className="flex items-center gap-2" role="toolbar" aria-label="Simulation controls">
        <button className={buttonClass} disabled title="Simulation controls are not implemented yet">
          Run
        </button>
        <button className={buttonClass} disabled title="Simulation controls are not implemented yet">
          Pause
        </button>
        <button className={buttonClass} disabled title="Simulation controls are not implemented yet">
          Reset
        </button>
      </div>
    </header>
  );
}
