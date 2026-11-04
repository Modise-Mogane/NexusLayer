"use client";

export interface DockTab {
  id: string;
  label: string;
  badge?: string | number;
  content: React.ReactNode;
}

export default function BottomDock({
  tabs,
  open,
  activeTab,
  onToggle,
  onSelectTab,
}: {
  tabs: DockTab[];
  open: boolean;
  activeTab: string;
  onToggle: () => void;
  onSelectTab: (id: string) => void;
}) {
  if (tabs.length === 0) return null;
  const active = tabs.find((t) => t.id === activeTab) ?? tabs[0];
  return (
    <section aria-label="Bottom dock" className="shrink-0 border-t border-nx-line bg-nx-panel">
      <div className="flex items-center gap-1 px-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              if (!open) onToggle();
              onSelectTab(tab.id);
            }}
            aria-pressed={open && active.id === tab.id}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 font-mono text-[11px] font-medium transition-colors ${
              open && active.id === tab.id
                ? "text-nx-accent"
                : "text-nx-muted hover:text-nx-ink"
            }`}
          >
            {tab.label}
            {tab.badge != null && tab.badge !== "" && (
              <span className="rounded bg-nx-raised px-1 text-[10px] text-nx-body">{tab.badge}</span>
            )}
          </button>
        ))}
        <button
          onClick={onToggle}
          aria-expanded={open}
          title={open ? "Collapse dock" : "Expand dock"}
          className="ml-auto px-2 py-1.5 font-mono text-[11px] text-nx-muted hover:text-nx-ink"
        >
          {open ? "▾" : "▴"}
        </button>
      </div>
      {open && (
        <div className="h-44 overflow-y-auto border-t border-nx-line bg-nx-workspace px-3 py-2">
          {active.content}
        </div>
      )}
    </section>
  );
}
