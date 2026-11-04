"use client";

/* Level-1 conceptual visualizations for the Physics Lab (Stage C3).
   Animated SVG aids, explicitly labeled conceptual — the authoritative
   numbers always come from the Level-2 calculators beside them. */

import type { LabResult } from "@/lib/api";

const W = 640;
const H = 300;
const LINE = "#c9d1d9";
const FAINT = "#3a4048";
const ACCENT = "#2dd4bf";
const WARN = "#e0a458";

function Stage({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={label}>
        {children}
      </svg>
      <p className="mt-1 font-mono text-[10px]" style={{ color: "#8b949e" }}>L1 · conceptual animation — illustrative, not a field solution</p>
    </div>
  );
}

function Label({ x, y, children, anchor = "middle" }: { x: number; y: number; children: React.ReactNode; anchor?: "middle" | "start" | "end" }) {
  return (
    <text x={x} y={y} textAnchor={anchor} fill={LINE} fontSize="13" fontFamily="IBM Plex Sans, sans-serif">
      {children}
    </text>
  );
}

function CopperVisual({ params }: { params: Record<string, number | string | boolean> }) {
  const len = Number(params.length_m ?? 100);
  const bits = Math.min(10, Math.max(2, Math.round(len / 25)));
  return (
    <Stage label="Copper cable with traveling voltage pulses">
      <rect x="30" y="120" width="150" height="60" fill="none" stroke={FAINT} />
      <rect x="460" y="120" width="150" height="60" fill="none" stroke={FAINT} />
      <Label x={105} y={142}>TX driver</Label>
      <Label x={535} y={142}>RX slicer</Label>
      <Label x={105} y={162}>(voltage steps)</Label>
      <Label x={535} y={162}>(attenuated)</Label>
      <line x1="180" y1="140" x2="460" y2="140" stroke={LINE} strokeWidth="3" />
      <line x1="180" y1="160" x2="460" y2="160" stroke={LINE} strokeWidth="3" />
      <line x1="180" y1="140" x2="460" y2="140" stroke={ACCENT} strokeWidth="3" className="nx-flow" />
      {Array.from({ length: bits }).map((_, i) => (
        <circle key={i} cx={205 + i * (230 / Math.max(bits - 1, 1))} cy={150} r="3" fill={i % 3 === 2 ? WARN : ACCENT} opacity="0.85" />
      ))}
      <Label x={320} y={110}>{len} m · energy flows as guided EM waves</Label>
      <Label x={320} y={205}>electrons drift slowly — the wave does the traveling</Label>
    </Stage>
  );
}

function OpticalVisual({ params }: { params: Record<string, number | string | boolean> }) {
  const laser = (params.source ?? "laser") === "laser";
  const wl = Number(params.wavelength_nm ?? 1310);
  return (
    <Stage label="Bandgap recombination and source spectrum">
      <Label x={160} y={36}>Conduction band</Label>
      <rect x="60" y="46" width="200" height="26" fill="none" stroke={LINE} strokeWidth="1.5" />
      <rect x="60" y="150" width="200" height="26" fill="none" stroke={LINE} strokeWidth="1.5" />
      <Label x={160} y={192}>Valence band</Label>
      <line x1="160" y1="72" x2="160" y2="150" stroke={ACCENT} strokeWidth="2" className="nx-flow" />
      <circle cx="160" cy="111" r="6" fill={ACCENT} />
      <Label x={160} y={130}>e–h recombine → photon</Label>
      <Label x={480} y={36}>{laser ? "Laser: narrow line" : "LED: broad spectrum"}</Label>
      <line x1="380" y1="150" x2="580" y2="150" stroke={FAINT} />
      {laser ? (
        <rect x="470" y="70" width="20" height="80" fill={ACCENT} opacity="0.8" />
      ) : (
        <path d="M390 150 Q430 60 480 60 Q530 60 570 150 Z" fill={ACCENT} opacity="0.45" />
      )}
      <Label x={480} y={170}>λ = {wl} nm</Label>
      <Label x={480} y={192}>{laser ? "fast modulation ✓" : "slow, wide — not for long haul"}</Label>
    </Stage>
  );
}

function FiberVisual({ params }: { params: Record<string, number | string | boolean> }) {
  const len = Number(params.length_km ?? 20);
  return (
    <Stage label="Fiber core with guided pulses">
      <rect x="40" y="90" width="560" height="120" fill="none" stroke={FAINT} strokeWidth="2" />
      <rect x="40" y="120" width="560" height="60" fill="none" stroke={LINE} strokeWidth="1.5" />
      <Label x={320} y={80}>cladding (lower index)</Label>
      <Label x={320} y={156}>core</Label>
      <path id="nx-fiber-ray" d="M60 165 L180 135 L300 165 L420 135 L540 165" fill="none" stroke={ACCENT} strokeWidth="2" className="nx-flow" />
      {[0, 1, 2].map((i) => (
        <circle
          key={i}
          r="5"
          fill={ACCENT}
          className="nx-photon"
          style={{ offsetPath: "path('M60 165 L180 135 L300 165 L420 135 L540 165')", animationDelay: `${i * 0.8}s` }}
        />
      ))}
      <Label x={120} y={240}>TX laser {len} km</Label>
      <Label x={520} y={240}>photodiode RX</Label>
      <Label x={320} y={262}>zigzag = conceptual aid, not a mode solution</Label>
    </Stage>
  );
}

function RadioVisual({ params }: { params: Record<string, number | string | boolean> }) {
  const f = Number(params.frequency_mhz ?? 1800);
  const d = Number(params.distance_km ?? 5);
  return (
    <Stage label="Transmitter radiating wavefronts to a receiver">
      <line x1="120" y1="240" x2="120" y2="120" stroke={LINE} strokeWidth="4" />
      <line x1="90" y1="240" x2="150" y2="240" stroke={LINE} strokeWidth="4" />
      <circle cx="120" cy="110" r="6" fill={ACCENT} />
      {[0, 1, 2].map((i) => (
        <circle key={i} cx="120" cy="110" r="40" fill="none" stroke={ACCENT} strokeWidth="2" className="nx-ping" style={{ animationDelay: `${i * 0.7}s` }} />
      ))}
      <Label x={120} y={262}>TX · {f} MHz</Label>
      <path d="M470 140a50 50 0 0050 50l12-12a34 34 0 01-34-34z" fill="none" stroke={LINE} strokeWidth="3" />
      <line x1="500" y1="190" x2="500" y2="240" stroke={LINE} strokeWidth="4" />
      <Label x={506} y={262}>RX · {d} km</Label>
      <line x1="180" y1="150" x2="440" y2="150" stroke={FAINT} strokeDasharray="4 5" />
      <Label x={310} y={140}>spreading loss ∝ d² · f²</Label>
    </Stage>
  );
}

function SatelliteVisual({ params }: { params: Record<string, number | string | boolean> }) {
  const d = Number(params.distance_km ?? 36000);
  const delayMs = ((d * 1000) / 299792458) * 1000;
  return (
    <Stage label="Ground terminal to GEO satellite to gateway">
      <path d="M40 240 Q320 250 600 240" stroke={FAINT} strokeWidth="2" fill="none" />
      <Label x={120} y={228}>terminal</Label>
      <Label x={520} y={228}>gateway</Label>
      <rect x="290" y="52" width="60" height="34" fill="none" stroke={LINE} strokeWidth="2" />
      <rect x="238" y="60" width="48" height="18" fill="none" stroke={LINE} />
      <rect x="354" y="60" width="48" height="18" fill="none" stroke={LINE} />
      <Label x={320} y={40}>GEO relay (schematic)</Label>
      <line x1="140" y1="225" x2="300" y2="86" stroke={ACCENT} strokeWidth="2" className="nx-flow" />
      <line x1="340" y1="86" x2="500" y2="225" stroke={ACCENT} strokeWidth="2" className="nx-flow" />
      <Label x={320} y={200}>one-way ≈ {delayMs.toFixed(0)} ms over {d.toLocaleString()} km</Label>
      <Label x={320} y={272}>user traffic crosses twice + processing — pure geometry</Label>
    </Stage>
  );
}

function TeleportVisual({ result }: { result: LabResult | null }) {
  const alpha = result?.outputs.find((o) => o.key === "alpha")?.value ?? "—";
  const beta = result?.outputs.find((o) => o.key === "beta")?.value ?? "—";
  return (
    <Stage label="Teleportation: Bell pair, measurement, two classical bits, correction">
      <rect x="40" y="90" width="150" height="120" fill="none" stroke={LINE} strokeWidth="1.5" />
      <Label x={115} y={112}>Alice</Label>
      <Label x={115} y={134}>holds |ψ⟩ + ½ Bell</Label>
      <Label x={115} y={156}>Bell measurement →</Label>
      <Label x={115} y={178}>2 classical bits</Label>
      <rect x="450" y="90" width="150" height="120" fill="none" stroke={LINE} strokeWidth="1.5" />
      <Label x={525} y={112}>Bob</Label>
      <Label x={525} y={134}>holds ½ Bell</Label>
      <Label x={525} y={156}>applies I/X/Z/XZ</Label>
      <Label x={525} y={178}>recovers |ψ⟩</Label>
      <path d="M190 200 Q320 250 450 200" stroke={FAINT} strokeWidth="2" strokeDasharray="5 4" fill="none" />
      <Label x={320} y={240}>shared entanglement (carries no message alone)</Label>
      <line x1="190" y1="120" x2="450" y2="120" stroke={ACCENT} strokeWidth="2" className="nx-flow" />
      <Label x={320} y={108}>2 classical bits (max light speed)</Label>
      <Label x={320} y={60}>|ψ⟩: α={String(alpha)}  β={String(beta)}</Label>
    </Stage>
  );
}

function Bb84Visual({ params, result }: { params: Record<string, number | string | boolean>; result: LabResult | null }) {
  const keyHead = String(result?.outputs.find((o) => o.key === "key_head")?.value ?? "");
  const eve = params.eve === true;
  const bits = keyHead.replace(/[^01]/g, "").slice(0, 32).split("");
  return (
    <Stage label="BB84 prepare, transmit, sift">
      <Label x={120} y={50}>Alice: random bit + random basis</Label>
      <Label x={120} y={250}>Bob: random basis → sift matches</Label>
      {Array.from({ length: 12 }).map((_, i) => (
        <g key={i}>
          <rect x={60 + i * 44} y={70} width={34} height={30} fill="none" stroke={i % 2 ? LINE : ACCENT} />
          <text x={77 + i * 44} y={90} textAnchor="middle" fill={LINE} fontSize="12" fontFamily="monospace">
            {i % 4 < 2 ? "＋" : "×"}
          </text>
          <line x1={77 + i * 44} y1={104} x2={77 + i * 44} y2={196} stroke={i % 2 ? FAINT : ACCENT} strokeWidth={i % 2 ? 1 : 2} strokeDasharray={i % 2 ? "3 4" : undefined} className={i % 2 ? undefined : "nx-flow"} />
          <rect x={60 + i * 44} y={200} width={34} height={30} fill={i % 2 ? "none" : ACCENT} opacity={i % 2 ? 1 : 0.25} stroke={i % 2 ? FAINT : ACCENT} />
        </g>
      ))}
      <Label x={320} y={128}>{eve ? "Eve intercepts → ~25% QBER on sifted key" : "ideal channel → sifted bits agree"}</Label>
      {bits.length > 0 && (
        <text x={320} y={278} textAnchor="middle" fill={WARN} fontSize="12" fontFamily="monospace">
          sifted: {bits.join("")}
        </text>
      )}
    </Stage>
  );
}

export default function ExperimentVisual({
  id,
  params,
  result,
}: {
  id: string;
  params: Record<string, number | string | boolean>;
  result: LabResult | null;
}) {
  switch (id) {
    case "copper":
      return <CopperVisual params={params} />;
    case "optical":
      return <OpticalVisual params={params} />;
    case "fiber":
      return <FiberVisual params={params} />;
    case "radio":
      return <RadioVisual params={params} />;
    case "satellite":
      return <SatelliteVisual params={params} />;
    case "teleport":
      return <TeleportVisual result={result} />;
    case "bb84":
      return <Bb84Visual params={params} result={result} />;
    default:
      return null;
  }
}
