"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const GROUPS: { label: string; items: { href: string; label: string }[] }[] = [
  {
    label: "Workspace",
    items: [
      { href: "/", label: "Overview" },
      { href: "/architecture", label: "Network Architecture" },
      { href: "/scenarios", label: "Scenarios" },
      { href: "/simulation", label: "3D Simulation" },
      { href: "/analysis", label: "Analysis" },
    ],
  },
  {
    label: "Engineering",
    items: [
      { href: "/hardware", label: "Hardware Library" },
      { href: "/hardware-engineering", label: "Hardware Engineering" },
      { href: "/research", label: "Research Lab" },
      { href: "/knowledge", label: "Knowledge Sources" },
      { href: "/coverage", label: "Coverage Research" },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/ai", label: "AI Engineering" },
      { href: "/settings", label: "Settings" },
    ],
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  return (
    <nav className="flex w-44 shrink-0 flex-col gap-3 overflow-y-auto border-r border-nx-line bg-nx-panel p-3">
      <Link href="/" className="flex items-center gap-2 px-1 pt-1">
        <span className="flex h-7 w-7 items-center justify-center rounded bg-nx-accent font-mono text-[11px] font-bold text-nx-workspace">
          NX
        </span>
        <span className="text-sm font-semibold tracking-tight text-nx-ink">NexusLayer</span>
      </Link>
      {GROUPS.map((group) => (
        <div key={group.label}>
          <p className="nx-label px-2 pb-1">{group.label}</p>
          <div className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`relative rounded px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    active ? "bg-nx-raised text-nx-ink" : "text-nx-muted hover:bg-nx-raised hover:text-nx-ink"
                  }`}
                >
                  {active && (
                    <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded bg-nx-accent" aria-hidden />
                  )}
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
      <p className="mt-auto px-2 pt-4 font-mono text-[10px] leading-relaxed text-nx-muted">
        Synthetic example data unless labeled measured.
      </p>
    </nav>
  );
}
