"use client";

import { useEffect, useRef } from "react";
import type { SimulationEvent } from "@/lib/api";

const TYPE_STYLES: Record<string, string> = {
  link_failed: "bg-red-100 text-red-800",
  connectivity_lost: "bg-red-100 text-red-800",
  failover: "bg-amber-100 text-amber-800",
  link_restored: "bg-emerald-100 text-emerald-800",
  failback: "bg-emerald-100 text-emerald-800",
  connectivity_restored: "bg-emerald-100 text-emerald-800",
};

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleTimeString();
}

export default function EventLog({ events }: { events: SimulationEvent[] }) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  return (
    <section className="flex h-32 shrink-0 flex-col border-t border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-4 py-1.5">
        <h2 className="text-xs font-semibold text-slate-900">Event log</h2>
      </div>
      <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-1.5">
        {events.length === 0 && (
          <p className="text-[11px] text-slate-500">No events yet.</p>
        )}
        {events.map((e) => (
          <div key={e.seq} className="flex items-center gap-2 py-0.5">
            <span className="w-8 shrink-0 text-[10px] tabular-nums text-slate-400">
              #{e.seq}
            </span>
            <span className="w-20 shrink-0 text-[10px] tabular-nums text-slate-400">
              {formatTime(e.timestamp)}
            </span>
            <span
              className={`shrink-0 rounded px-1.5 py-px text-[10px] font-medium ${
                TYPE_STYLES[e.type] ?? "bg-slate-100 text-slate-600"
              }`}
            >
              {e.type.replace("_", " ")}
            </span>
            <span className="truncate text-[11px] text-slate-700">{e.message}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
