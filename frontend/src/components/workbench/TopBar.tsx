"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { API_BASE, fetchHealth } from "@/lib/api";
import { useAssistant } from "@/components/assistant/AssistantProvider";

function LiveAssistantControl() {
  const a = useAssistant();
  const state = !a.live ? "off" : a.listening ? "listening" : a.speaking ? "speaking" : a.streaming ? "thinking" : "live";
  const title = !a.live
    ? `Enable Live Assistant (${a.assistantName}) — microphone only opens after you enable it`
    : `Live Assistant ON — ${state}. Click to disable and close the microphone.`;
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <button
        onClick={() => a.setLive(!a.live)}
        aria-pressed={a.live}
        title={title}
        className={`flex items-center gap-1.5 rounded border px-2 py-1 text-[11px] font-medium transition-colors duration-150 ${
          a.live
            ? "border-nx-accent/60 bg-nx-accent/10 text-nx-accent"
            : "border-nx-line text-nx-muted hover:border-nx-accent hover:text-nx-body"
        }`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${a.live ? "bg-nx-accent nx-live-dot" : "bg-nx-muted"}`} aria-hidden />
        Live Assistant
        <span className="font-mono text-[10px] opacity-80">{a.live ? "ON" : "OFF"}</span>
      </button>
      {a.live && (a.listening || a.speaking) && (
        <span className="flex h-4 items-center gap-[2px]" aria-label={state} role="status">
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              aria-hidden
              className="nx-wave-bar inline-block h-4 w-[3px] rounded bg-nx-accent"
              style={{ animationDelay: `${i * 0.15}s` }}
            />
          ))}
        </span>
      )}
      <button
        onClick={() => a.setDrawerOpen(!a.drawerOpen)}
        aria-expanded={a.drawerOpen}
        aria-label="Open assistant conversation"
        title="Open assistant conversation (keeps running while you work)"
        className="rounded border border-nx-line px-2 py-1 text-[11px] text-nx-muted hover:border-nx-accent hover:text-nx-body"
      >
        <span aria-hidden>💬</span>
      </button>
    </span>
  );
}

export default function TopBar({
  project,
  actions,
}: {
  project?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const [backend, setBackend] = useState<"checking" | "online" | "offline">("checking");

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const health = await fetchHealth();
        if (!cancelled) setBackend(health.status === "ok" ? "online" : "offline");
      } catch {
        if (!cancelled) setBackend("offline");
      }
    };
    void check();
    const timer = setInterval(check, 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const dot = backend === "online" ? "bg-nx-ok" : backend === "offline" ? "bg-nx-bad" : "bg-nx-warn";

  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-nx-line bg-nx-raised px-3">
      <Link href="/" className="flex shrink-0 items-center gap-2" title="NexusLayer home">
        <span className="flex h-6 w-6 items-center justify-center rounded bg-nx-accent font-mono text-[10px] font-bold text-nx-workspace">
          NX
        </span>
        <span className="hidden text-[13px] font-semibold tracking-tight text-nx-ink sm:inline">NexusLayer</span>
      </Link>
      <span className="h-5 w-px shrink-0 bg-nx-line" aria-hidden />
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">{project}</div>
      {actions && <div className="flex min-w-0 shrink items-center gap-1.5 overflow-x-auto [&>*]:shrink-0">{actions}</div>}
      <LiveAssistantControl />
      <span className="h-5 w-px shrink-0 bg-nx-line" aria-hidden />
      <span
        className="flex shrink-0 items-center gap-1.5 font-mono text-[10px] text-nx-muted"
        title={backend === "offline" ? `Backend unreachable at ${API_BASE}` : "Backend connected"}
      >
        <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden />
        <span className="hidden md:inline">{backend === "online" ? "API" : backend === "offline" ? "API down" : "…"}</span>
      </span>
    </header>
  );
}
