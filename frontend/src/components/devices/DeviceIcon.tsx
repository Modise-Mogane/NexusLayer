"use client";

/* Original NexusLayer technical symbols (stroke line-art, no external assets).
   One recognizable glyph per device family, drawn in currentColor. */

import type { JSX } from "react";

type Glyph = (key: number) => JSX.Element;

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function P({ d, k, filled }: { d: string; k: number; filled?: boolean }) {
  return <path key={k} d={d} {...STROKE} fill={filled ? "currentColor" : "none"} stroke="currentColor" />;
}

const GLYPHS: Record<string, Glyph[]> = {
  router: [
    (k) => <P key={k} k={k} d="M12 3v18M3 12h18" />,
    (k) => <P key={k} k={k} d="M12 3l-2.5 3M12 3l2.5 3M12 21l-2.5-3M12 21l2.5-3M3 12l3-2.5M3 12l3 2.5M21 12l-3-2.5M21 12l-3 2.5" />,
    (k) => <circle key={k} cx="12" cy="12" r="2.4" {...STROKE} />,
  ],
  switch: [
    (k) => <P key={k} k={k} d="M3 7h18v10H3z" />,
    (k) => <P key={k} k={k} d="M7 7v10M12 7v10M17 7v10" />,
    (k) => <P key={k} k={k} d="M1.5 12H3M21 12h1.5" />,
  ],
  firewall: [
    (k) => <P key={k} k={k} d="M3 5h18M3 10h18M3 15h18M3 20h18M7 5v5M12 10v5M17 5v5M7 15v5M17 15v5" />,
  ],
  gateway: [
    (k) => <P key={k} k={k} d="M5 20V10a7 7 0 0114 0v10" />,
    (k) => <P key={k} k={k} d="M12 3v3M9 12h6" />,
  ],
  base_station: [
    (k) => <P key={k} k={k} d="M12 21V8M8 21l4-13 4 13M7 17h10" />,
    (k) => <P key={k} k={k} d="M12 8V4M9 5l3-2 3 2" />,
    (k) => <P key={k} k={k} d="M5.5 6.5a8 8 0 000 5M18.5 6.5a8 8 0 010 5" />,
  ],
  radio_unit: [
    (k) => <P key={k} k={k} d="M7 12h10v9H7zM10 12V6m4 6V6M12 6V3" />,
    (k) => <P key={k} k={k} d="M9.5 3.5a4 4 0 015 0" />,
  ],
  microwave: [
    (k) => <P key={k} k={k} d="M4 14a8 8 0 008 8 8 8 0 008-8H4z" />,
    (k) => <P key={k} k={k} d="M12 14V6M12 6l-2 2M12 6l2 2" />,
    (k) => <P key={k} k={k} d="M18 4a7 7 0 013 3M19.5 1.5a10 10 0 014.5 4.5" />,
  ],
  satellite: [
    (k) => <P key={k} k={k} d="M10 10l4 4 3-3-4-4zM9 15l-3 3M15 9l3-3" />,
    (k) => <P key={k} k={k} d="M3 8l3 3M16 13l3 3M2 9l4-4 3 3-4 4zM15 19l4-4 3 3-4 4z" />,
    (k) => <P key={k} k={k} d="M19 4a4 4 0 012 2" />,
  ],
  satellite_terminal: [
    (k) => <P key={k} k={k} d="M4 10a9 9 0 009 9h6l-6-2a7 7 0 01-5-5z" />,
    (k) => <P key={k} k={k} d="M13 19v2M8 21h10M17 5a6 6 0 013 3" />,
  ],
  ground_station: [
    (k) => <P key={k} k={k} d="M12 13a6 6 0 006 6H6a6 6 0 006-6zM12 13V6" />,
    (k) => <P key={k} k={k} d="M12 6l-2.5 2.5M12 6l2.5 2.5M9 21h6" />,
  ],
  access_point: [
    (k) => <P key={k} k={k} d="M12 21v-6M12 15a2 2 0 100-4 2 2 0 000 4z" />,
    (k) => <P key={k} k={k} d="M8 9a6 6 0 018 0M5.5 6.5a10 10 0 0113 0" />,
  ],
  nic: [
    (k) => <P key={k} k={k} d="M4 8h16v11H4zM4 12h16M8 19v-2m4 2v-2m4 2v-2" />,
    (k) => <P key={k} k={k} d="M9 8V5m6 3V5" />,
  ],
  server: [
    (k) => <P key={k} k={k} d="M5 4h14v16H5zM5 9h14M5 15h14" />,
    (k) => <circle key={k} cx="8" cy="6.5" r="0.9" fill="currentColor" />,
    (k) => <circle key={k} cx="8" cy="12" r="0.9" fill="currentColor" />,
    (k) => <circle key={k} cx="8" cy="17.5" r="0.9" fill="currentColor" />,
  ],
  edge_compute: [
    (k) => <P key={k} k={k} d="M4 6h16v12H4zM4 10h16" />,
    (k) => <P key={k} k={k} d="M8 6V4m8 2V4M7 14h4m-4 3h7" />,
  ],
  iot_gateway: [
    (k) => <P key={k} k={k} d="M6 10h12v10H6zM12 10V4" />,
    (k) => <P key={k} k={k} d="M9.5 4.5a4 4 0 015 0M8 2.5a7 7 0 018 0" />,
  ],
  smartphone: [
    (k) => <P key={k} k={k} d="M8 2h8v20H8zM11 18.5h2" />,
  ],
  laptop: [
    (k) => <P key={k} k={k} d="M5 5h14v10H5zM2 19h20" />,
  ],
  desktop: [
    (k) => <P key={k} k={k} d="M4 4h16v11H4zM12 15v3M8 20h8" />,
  ],
  sensor: [
    (k) => <circle key={k} cx="12" cy="14" r="4" {...STROKE} />,
    (k) => <circle key={k} cx="12" cy="14" r="1.2" fill="currentColor" />,
    (k) => <P key={k} k={k} d="M5 8a10 10 0 0114 0M7.5 5.5a13 13 0 019 0" />,
  ],
  camera: [
    (k) => <P key={k} k={k} d="M3 9h18v9H3z" />,
    (k) => <circle key={k} cx="12" cy="13.5" r="3" {...STROKE} />,
    (k) => <P key={k} k={k} d="M8 9l1.5-3h5L16 9" />,
  ],
  car: [
    (k) => <P key={k} k={k} d="M3 15l2-5 4-1 3-3h4l3 3 2 6H3z" />,
    (k) => <circle key={k} cx="8" cy="17" r="1.8" {...STROKE} />,
    (k) => <circle key={k} cx="16.5" cy="17" r="1.8" {...STROKE} />,
  ],
  train: [
    (k) => <P key={k} k={k} d="M6 3h12v13H6zM6 12h12" />,
    (k) => <circle key={k} cx="9" cy="14.5" r="1" fill="currentColor" />,
    (k) => <circle key={k} cx="15" cy="14.5" r="1" fill="currentColor" />,
    (k) => <P key={k} k={k} d="M8 21l1-2m7 2l-1-2M5 19h14" />,
  ],
  ship: [
    (k) => <P key={k} k={k} d="M4 14h16l-2.5 5h-11zM12 14V6M12 6h5l-2 3" />,
    (k) => <P key={k} k={k} d="M2 21c1.5-1 3-1 4.5 0s3 1 4.5 0 3-1 4.5 0 3 1 4.5 0" />,
  ],
  aircraft: [
    (k) => <P key={k} k={k} d="M12 3v18M5 9l14 4M5 9l3-1M19 13l-3 1M9 21l3-4 3 4" />,
  ],
  drone: [
    (k) => <P key={k} k={k} d="M5 5l14 14M19 5L5 19" />,
    (k) => <circle key={k} cx="12" cy="12" r="2" {...STROKE} />,
    (k) => <P key={k} k={k} d="M3 5h4M17 5h4M3 19h4M17 19h4" />,
  ],
  research_station: [
    (k) => <P key={k} k={k} d="M4 20a8 8 0 0116 0M12 12V4M12 4h4" />,
    (k) => <P key={k} k={k} d="M9 20v-4h6v4" />,
  ],
  internet: [
    (k) => <P key={k} k={k} d="M7 19a4 4 0 01-.5-8A5.5 5.5 0 0117 8.5 4.5 4.5 0 0117.5 19z" />,
  ],
  antenna: [
    (k) => <P key={k} k={k} d="M12 21v-9M12 12a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" />,
    (k) => <P key={k} k={k} d="M8.5 8a5 5 0 017 0M6 5.5a9 9 0 0112 0" />,
  ],
  overview: [
    (k) => <P key={k} k={k} d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />,
  ],
  topology: [
    (k) => <circle key={k} cx="6" cy="6" r="2.4" {...STROKE} />,
    (k) => <circle key={k} cx="18" cy="8" r="2.4" {...STROKE} />,
    (k) => <circle key={k} cx="10" cy="18" r="2.4" {...STROKE} />,
    (k) => <P key={k} k={k} d="M8.2 6.7l7.4.7M7.3 8.2l1.9 7.4M16.2 10l-4.6 6" />,
  ],
  flask: [
    (k) => <P key={k} k={k} d="M10 3h4M10 3v6l-5.5 9.5A2 2 0 006.2 21h11.6a2 2 0 001.7-2.5L14 9V3" />,
    (k) => <P key={k} k={k} d="M7.5 15h9" />,
  ],
  cube: [
    (k) => <P key={k} k={k} d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />,
    (k) => <P key={k} k={k} d="M12 12l8-4.5M12 12L4 7.5M12 12v9" />,
  ],
  chart: [
    (k) => <P key={k} k={k} d="M4 4v16h16" />,
    (k) => <P key={k} k={k} d="M9 16v-5M13 16V8M17 16v-3" />,
  ],
  radar: [
    (k) => <circle key={k} cx="12" cy="12" r="1.6" {...STROKE} fill="currentColor" stroke="currentColor" />,
    (k) => <P key={k} k={k} d="M12 12L18 6M7.5 7.5a6.4 6.4 0 000 9M16.5 7.5a6.4 6.4 0 010 9M4.9 4.9a10 10 0 000 14.2M19.1 4.9a10 10 0 010 14.2" />,
  ],
  spark: [
    (k) => <P key={k} k={k} d="M12 3l1.8 6.2L20 11l-6.2 1.8L12 19l-1.8-6.2L4 11l6.2-1.8z" />,
  ],
  gear: [
    (k) => <circle key={k} cx="12" cy="12" r="3.2" {...STROKE} />,
    (k) => <P key={k} k={k} d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.5 5.5l2.1 2.1M16.4 16.4l2.1 2.1M18.5 5.5l-2.1 2.1M7.6 16.4l-2.1 2.1" />,
  ],
  atom: [
    (k) => <circle key={k} cx="12" cy="12" r="1.4" fill="currentColor" />,
    (k) => <P key={k} k={k} d="M12 3c5.5 0 9 4 9 9s-3.5 9-9 9-9-4-9-9 3.5-9 9-9z" />,
    (k) => <P key={k} k={k} d="M4.5 7.5c3.9-2.2 11.1-2.2 15 0s3.9 9.8 0 12-11.1 2.2-15 0-3.9-9.8 0-12z" />,
  ],
  generic: [
    (k) => <P key={k} k={k} d="M4 4h16v16H4zM4 9h16M9 9v11" />,
  ],
};

/* Map topology node types + hardware categories onto glyph families. */
const ALIASES: Record<string, string> = {
  tower: "base_station",
  ship_terminal: "ship",
  car_gateway: "car",
  vehicle: "car",
  train_gateway: "train",
  aircraft_terminal: "aircraft",
  drone_modem: "drone",
  vsat: "satellite_terminal",
  modem: "nic",
  hub: "switch",
  bridge: "switch",
  repeater: "switch",
  load_balancer: "server",
  transceiver: "nic",
  media_converter: "switch",
  boat: "ship",
  offshore: "research_station",
  wifi: "access_point",
  ap: "access_point",
  phone: "smartphone",
  tablet: "smartphone",
  computer: "desktop",
  cloud: "internet",
  net: "internet",
  iot: "sensor",
  camera_ip: "camera",
};

export function glyphFamily(kind: string): string {
  const k = (kind || "").toLowerCase();
  if (GLYPHS[k]) return k;
  if (ALIASES[k] && GLYPHS[ALIASES[k]]) return ALIASES[k];
  return "generic";
}

export default function DeviceIcon({
  kind,
  size = 22,
  className,
}: {
  kind: string;
  size?: number;
  className?: string;
}) {
  const family = glyphFamily(kind);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      role="img"
      aria-label={`${family} icon`}
    >
      {GLYPHS[family].map((g, i) => g(i))}
    </svg>
  );
}
