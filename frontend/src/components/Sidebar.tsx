"use client";

const NAV_ITEMS = [
  { id: "topology", label: "Topology", active: true },
  { id: "scenarios", label: "Scenarios", active: false },
  { id: "simulation", label: "Simulation", active: false },
  { id: "analysis", label: "Analysis", active: false },
  { id: "settings", label: "Settings", active: false },
];

export default function Sidebar() {
  return (
    <nav className="flex w-44 shrink-0 flex-col gap-1 border-r border-slate-200 bg-white p-3">
      {NAV_ITEMS.map((item) => (
        <button
          key={item.id}
          disabled={!item.active}
          title={item.active ? undefined : "Not implemented yet"}
          className={`rounded-md px-3 py-2 text-left text-xs font-medium ${
            item.active
              ? "bg-slate-900 text-white"
              : "cursor-not-allowed text-slate-400"
          }`}
        >
          {item.label}
        </button>
      ))}
      <p className="mt-auto px-1 pt-4 text-[10px] leading-relaxed text-slate-500">
        Only Topology is available in this MVP.
      </p>
    </nav>
  );
}
