"use client";

import { useEffect, useState } from "react";
import { API_BASE, fetchHealth } from "@/lib/api";

type BackendState = "checking" | "online" | "offline";

export default function StatusBar() {
  const [state, setState] = useState<BackendState>("checking");
  const [service, setService] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const health = await fetchHealth();
        if (cancelled) return;
        setState(health.status === "ok" ? "online" : "offline");
        setService(health.service ?? "");
      } catch {
        if (!cancelled) {
          setState("offline");
          setService("");
        }
      }
    };
    void check();
    const timer = setInterval(check, 10000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const dot =
    state === "online" ? "bg-nx-ok" : state === "offline" ? "bg-nx-bad" : "bg-nx-warn";
  const label =
    state === "online"
      ? `Backend connected${service ? ` · ${service}` : ""}`
      : state === "offline"
        ? `Backend unreachable at ${API_BASE}`
        : "Checking backend…";

  return (
    <footer className="flex h-8 shrink-0 items-center gap-2 border-t border-nx-line bg-nx-panel px-4">
      <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden />
      <span className="font-mono text-[11px] text-nx-muted">{label}</span>
    </footer>
  );
}
