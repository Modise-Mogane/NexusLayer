"use client";

/* NexusLayer Overview: a living briefing, not a tile grid. Left: an animated
   strip of the shared world driven by live simulation counts (positions are
   illustrative; the true world lives in Simulation). Right: contextual status
   and continue-working actions. Motion is SVG/SMIL only — no WebGL — and
   renders statically under prefers-reduced-motion. */

import { useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import {
  fetchAgentStatus,
  fetchFindings,
  fetchHardware,
  fetchRegions,
  fetchScenarios,
  fetchSimulationEvents,
  fetchSimulationState,
  type ResearchFinding,
  type SimulationEvent,
  type SimulationState,
} from "@/lib/api";

const SCENARIO = "shared_world";

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/** Stylized coast strip: city, towers, ship lane, flight path, rural gap. */
function WorldStrip({
  connected,
  degraded,
  down,
  tick,
  reduced,
}: {
  connected: number;
  degraded: number;
  down: number;
  tick: number;
  reduced: boolean;
}) {
  const shipX = 90 + ((tick * 7) % 420);
  const planeX = 640 - ((tick * 11) % 560);
  const linkOn = connected > 0;
  return (
    <svg
      viewBox="0 0 720 220"
      className="h-auto w-full"
      role="img"
      aria-label="Illustrated coast strip of the shared simulation world"
    >
      <rect x="0" y="0" width="720" height="220" fill="#dce8f2" />
      <rect x="0" y="128" width="720" height="92" fill="#bfd7ea" />
      <path d="M0 128 Q 180 118 360 128 T 720 126 L720 132 L0 134 Z" fill="#a9c8e2" />
      {/* city blocks */}
      <g fill="#8fa3b8">
        <rect x="440" y="66" width="26" height="62" />
        <rect x="472" y="48" width="30" height="80" />
        <rect x="508" y="72" width="24" height="56" />
        <rect x="538" y="58" width="34" height="70" />
        <rect x="578" y="80" width="26" height="48" />
      </g>
      <g fill="#e9eef3" opacity="0.85">
        {Array.from({ length: 5 }).map((_, r) =>
          [444, 476, 512, 542, 582].map((x, i) => (
            <rect key={`${r}-${i}`} x={x} y={54 + r * 13} width="5" height="4" />
          ))
        )}
      </g>
      {/* towers */}
      <g stroke="#41566e" strokeWidth="2.5" fill="none">
        <path d="M420 128 L428 78 L436 128 M423 108 L433 108 M425 94 L431 94" />
        <path d="M120 128 L126 96 L132 128" />
      </g>
      <circle cx="428" cy="74" r="3" fill="#0b7a68" />
      {!reduced && (
        <circle cx="428" cy="74" r="3" fill="none" stroke="#0b7a68" strokeWidth="1.5" className="nx-ping" />
      )}
      <circle cx="126" cy="92" r="2.5" fill="#41566e" />
      {/* rural settlement (underserved) */}
      <g>
        <rect x="36" y="106" width="16" height="12" fill="#8a7a5c" />
        <path d="M36 106 L44 99 L52 106 Z" fill="#6e6148" />
        <rect x="60" y="108" width="14" height="10" fill="#8a7a5c" />
        <path d="M60 108 L67 102 L74 108 Z" fill="#6e6148" />
        <text x="55" y="96" textAnchor="middle" fontSize="9" fill="#6e6148" fontFamily="IBM Plex Sans, sans-serif">
          underserved
        </text>
      </g>
      {/* ship lane + vessel */}
      <line x1="60" y1="172" x2="560" y2="172" stroke="#7fa3c4" strokeWidth="1" strokeDasharray="5 5" />
      <g transform={`translate(${reduced ? 200 : shipX} 172)`}>
        <path d="M-22 0 L22 0 L15 -10 L-15 -10 Z" fill="#33404d" />
        <rect x="-8" y="-18" width="14" height="8" fill="#5d6b7a" />
        {!reduced && (
          <animateMotion dur="26s" repeatCount="indefinite" path="M0 0 L60 0 L-40 0 L0 0" />
        )}
      </g>
      {/* flight path + aircraft */}
      <path d="M120 30 Q 360 10 660 44" fill="none" stroke="#9db3c8" strokeWidth="1" strokeDasharray="4 4" />
      <g transform={`translate(${reduced ? 420 : planeX} 26)`}>
        <path
          d="M-13 1 L11 1 L13 -1 L-9 -1 Z M-3 1 L-7 6 M-3 1 L-9 -5"
          fill="#33404d"
          stroke="#33404d"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
        {!reduced && <animateMotion dur="31s" repeatCount="indefinite" path="M0 0 L-80 4 L80 -4 L0 0" />}
      </g>
      {/* live link pulses: one per status class, only when endpoints exist */}
      {linkOn && !reduced && (
        <g fill="#0b7a68">
          <circle r="3">
            <animateMotion dur="3.2s" repeatCount="indefinite" path="M428 78 Q 460 120 480 150" />
          </circle>
          <circle r="3">
            <animateMotion dur="4.1s" begin="1.2s" repeatCount="indefinite" path="M428 78 Q 380 130 300 168" />
          </circle>
        </g>
      )}
      {down > 0 && (
        <text x="55" y="146" textAnchor="middle" fontSize="9" fill="#8f2f22" fontFamily="IBM Plex Mono, monospace">
          {down} without route
        </text>
      )}
      <text x="700" y="210" textAnchor="end" fontSize="9" fill="#5d6b7a" fontFamily="IBM Plex Mono, monospace">
        {connected} connected · {degraded} degraded · tick {tick}
      </text>
    </svg>
  );
}

function Action({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="group flex items-baseline justify-between gap-3 border-b border-nx-line py-2 text-sm text-nx-ink last:border-b-0 hover:text-nx-accent"
    >
      <span>{children}</span>
      <span aria-hidden className="text-nx-muted transition-transform duration-150 group-hover:translate-x-1">
        →
      </span>
    </Link>
  );
}

export default function OverviewPage() {
  const reduced = useReducedMotion();
  const [sim, setSim] = useState<SimulationState | null>(null);
  const [events, setEvents] = useState<SimulationEvent[]>([]);
  const [counts, setCounts] = useState({ scenarios: 0, devices: 0, regions: 0 });
  const [aiMode, setAiMode] = useState("");
  const [finding, setFinding] = useState<ResearchFinding | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => {
      fetchSimulationState(SCENARIO).then((s) => alive && setSim(s)).catch(() => {});
      fetchSimulationEvents(SCENARIO)
        .then((e) => alive && setEvents(e.events.slice(-6).reverse()))
        .catch(() => {});
    };
    load();
    const timer = window.setInterval(load, 10000);
    Promise.all([
      fetchScenarios().catch(() => []),
      fetchHardware().catch(() => []),
      fetchRegions().catch(() => ({ regions: [] })),
      fetchFindings().catch(() => []),
    ]).then(([s, d, r, f]) => {
      if (!alive) return;
      setCounts({ scenarios: s.length, devices: d.length, regions: r.regions.length });
      setFinding(f.length ? f[f.length - 1] : null);
    });
    fetchAgentStatus().then((s) => alive && setAiMode(s.mode)).catch(() => {});
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  const endpoints = sim?.endpoint_routes ?? [];
  const connected = endpoints.filter((e) => e.connectivity === "connected").length;
  const degraded = endpoints.filter((e) => e.connectivity === "degraded").length;
  const down = endpoints.filter((e) => e.connectivity === "disconnected").length;

  return (
    <AppShell
      title="Overview"
      subtitle="A living briefing on the shared engineering world."
    >
      <div className="nx-view mx-auto max-w-6xl">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1.7fr_1fr]">
          <section aria-label="World now">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="nx-label">Shared engineering world</p>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight text-nx-ink">Port Meridian</h1>
                <p className="mt-1 text-xs text-nx-muted">A connected coastal region, from city to open water.</p>
              </div>
              <Link href="/simulation?scenario=shared_world" className="nx-btn-primary inline-flex items-center gap-2">
                Explore live world <span aria-hidden>→</span>
              </Link>
            </div>
            <div className="overflow-hidden rounded-md border border-nx-line">
              <WorldStrip
                connected={connected}
                degraded={degraded}
                down={down}
                tick={sim?.tick ?? 0}
                reduced={reduced}
              />
            </div>
            <p className="mt-1 font-mono text-[10px] text-nx-muted">
              Live counts from the {SCENARIO} simulation · positions illustrative — open
              Simulation for the true world.
            </p>

            <div className="mt-6 flex flex-wrap items-end gap-x-8 gap-y-2">
              <div>
                <p className="font-mono text-4xl font-semibold tracking-tight text-nx-ink">
                  {endpoints.length ? connected : "…"}
                </p>
                <p className="mt-1 max-w-xs text-xs leading-relaxed text-nx-body">
                  {endpoints.length
                    ? `connected endpoints out of ${endpoints.length} — each with an eligible route to its configured destination under the ${sim?.routing_policy ?? "?"} policy.`
                    : "Loading the shared-world simulation state."}
                </p>
              </div>
              <dl className="flex gap-6 font-mono text-[11px] text-nx-body">
                <div>
                  <dt className="text-nx-muted">degraded</dt>
                  <dd className="text-base text-nx-warn">{endpoints.length ? degraded : "…"}</dd>
                </div>
                <div>
                  <dt className="text-nx-muted">without route</dt>
                  <dd className="text-base text-nx-badink">{endpoints.length ? down : "…"}</dd>
                </div>
                <div>
                  <dt className="text-nx-muted">sim time</dt>
                  <dd className="text-base">{sim ? `${Math.round(sim.sim_time_s ?? 0)} s` : "…"}</dd>
                </div>
              </dl>
            </div>

            <h2 className="mb-2 mt-8 font-mono text-[11px] font-semibold uppercase tracking-wider text-nx-muted">
              Latest network events
            </h2>
            {events.length === 0 ? (
              <p className="text-xs text-nx-muted">
                No simulation events recorded yet — run the shared world in Simulation.
              </p>
            ) : (
              <ol className="divide-y divide-nx-line border-y border-nx-line">
                {events.map((e) => (
                  <li key={e.seq} className="flex items-baseline gap-3 py-1.5 text-xs">
                    <span className="shrink-0 font-mono text-[10px] text-nx-muted">
                      t={Math.round(e.sim_time_s ?? 0)}s
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-nx-accent">{e.type}</span>
                    <span className="text-nx-body">{e.message}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <aside aria-label="Workspace status" className="space-y-7">
            <section>
              <h2 className="mb-1 font-mono text-[11px] font-semibold uppercase tracking-wider text-nx-muted">
                Continue working
              </h2>
              <nav aria-label="Primary actions">
                <Action href="/architecture">Continue Architecture</Action>
                <Action href="/simulation?scenario=shared_world">Explore World</Action>
                <Action href="/physics">Open Physics Lab</Action>
                <Action href="/coverage">Review Coverage Gaps</Action>
              </nav>
            </section>

            <section>
              <h2 className="mb-1 font-mono text-[11px] font-semibold uppercase tracking-wider text-nx-muted">
                Workspace
              </h2>
              <dl className="space-y-1.5 text-xs text-nx-body">
                <div className="flex justify-between gap-3">
                  <dt className="text-nx-muted">Saved scenarios</dt>
                  <dd className="font-mono">{counts.scenarios}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-nx-muted">Catalog devices</dt>
                  <dd className="font-mono">{counts.devices}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-nx-muted">Coverage regions</dt>
                  <dd className="font-mono">{counts.regions}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-nx-muted">AI mode</dt>
                  <dd className="font-mono">{aiMode || "…"}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-nx-muted">World status</dt>
                  <dd className="font-mono">{sim ? sim.connectivity : "…"}</dd>
                </div>
              </dl>
            </section>

            <section>
              <h2 className="mb-1 font-mono text-[11px] font-semibold uppercase tracking-wider text-nx-muted">
                Research
              </h2>
              {finding ? (
                <Link href="/research" className="text-xs leading-relaxed text-nx-body hover:text-nx-accent">
                  Latest: <span className="font-medium text-nx-ink">{finding.title}</span>
                  <span className="font-mono text-[10px] text-nx-muted"> · {finding.status}</span>
                </Link>
              ) : (
                <p className="text-xs text-nx-muted">
                  No findings yet — the Research Lab awaits the first submission.
                </p>
              )}
            </section>

            <p className="border-l-2 border-nx-warn/60 pl-3 text-[11px] leading-relaxed text-nx-muted">
              All link values are synthetic planning estimates, not measurements —
              except where a source explicitly says measured.
            </p>
          </aside>
        </div>

        <section aria-label="Demonstration path" className="mt-10 border-t border-nx-line pt-6">
          <h2 className="text-base font-semibold tracking-tight text-nx-ink">Demonstration path</h2>
          <ol className="mt-3 grid grid-cols-1 gap-x-8 gap-y-3 md:grid-cols-2">
            {[
              ["Inspect equipment", "Base station, satellite terminal, gateway, and ship system in the Hardware Library."],
              ["Design the topology", "Open Network Architecture, modify the maritime network, save the scenario."],
              ["Sail out of coverage", "Launch it in 3D Simulation and step the vessel beyond terrestrial range."],
              ["Watch the handover", "The engine selects satellite automatically and records its reason."],
              ["Review the evidence", "Handover history in Analysis, with latency, cost, and assumptions."],
              ["Propose improvements", "Draft a device, submit a finding, extend coverage into the rural gap."],
            ].map(([title, text], i) => (
              <li key={title} className="flex gap-3 text-xs leading-relaxed">
                <span aria-hidden className="font-mono text-sm font-semibold text-nx-accent">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span>
                  <span className="font-semibold text-nx-ink">{title}. </span>
                  <span className="text-nx-body">{text}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </AppShell>
  );
}
