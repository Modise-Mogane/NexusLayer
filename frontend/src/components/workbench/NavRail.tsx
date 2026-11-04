"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import DeviceIcon from "@/components/devices/DeviceIcon";

const ITEMS: { href: string; label: string; icon: string }[] = [
  { href: "/", label: "Overview", icon: "overview" },
  { href: "/architecture", label: "Architect", icon: "topology" },
  { href: "/hardware", label: "Hardware", icon: "server" },
  { href: "/research", label: "Research", icon: "flask" },
  { href: "/physics", label: "Physics", icon: "atom" },
  { href: "/simulation", label: "Simulate", icon: "cube" },
  { href: "/analysis", label: "Analysis", icon: "chart" },
  { href: "/coverage", label: "Coverage", icon: "radar" },
  { href: "/ai", label: "AI", icon: "spark" },
];

export default function NavRail() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      className="flex w-[68px] shrink-0 flex-col items-stretch gap-1 overflow-y-auto border-r border-nx-line bg-nx-panel py-2"
    >
      {ITEMS.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            title={item.label}
            className={`relative flex flex-col items-center gap-1 px-1 py-2.5 transition-colors ${
              active ? "bg-nx-accent/10 text-nx-accent" : "text-nx-muted hover:bg-nx-raised hover:text-nx-ink"
            }`}
          >
            {active && (
              <span className="absolute left-0 top-1/2 h-8 w-[3px] -translate-y-1/2 rounded-r bg-nx-accent" aria-hidden />
            )}
            <DeviceIcon kind={item.icon} size={20} />
            <span className="text-[10px] font-medium leading-none">{item.label}</span>
          </Link>
        );
      })}
      <div className="mt-auto flex flex-col items-center gap-1">
        <Link
          href="/settings"
          title="Settings"
          aria-current={pathname.startsWith("/settings") ? "page" : undefined}
          className={`flex flex-col items-center gap-0.5 px-1 py-2 ${
            pathname.startsWith("/settings") ? "text-nx-accent" : "text-nx-muted hover:bg-nx-raised hover:text-nx-ink"
          }`}
        >
          <DeviceIcon kind="gear" size={20} />
          <span className="text-[10px] font-medium leading-none">Settings</span>
        </Link>
      </div>
    </nav>
  );
}
