"use client";

/* Original NexusLayer technical illustrations for the hardware catalog.
   Schematic blueprint-style line art drawn in code — no external assets.
   License: CC0-1.0 (public domain dedication), attribution not required. */

import DeviceIcon, { glyphFamily } from "@/components/devices/DeviceIcon";

export const ART_LICENSE = {
  origin: "Original NexusLayer technical illustration",
  license: "CC0-1.0",
  note: "Drawn in code for NexusLayer; free to reuse. Conceptual AI devices are labeled as concepts, not products.",
};

const LINE = "#31596a";
const FAINT = "#a3b9c1";
const ACCENT = "#087c70";

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 200 140" className="h-full w-full" role="img" aria-label="Device technical illustration">
      {/* construction frame */}
      <rect x="6" y="6" width="188" height="128" fill="none" stroke={FAINT} strokeWidth="1" strokeDasharray="5 4" />
      <path d="M6 22V6h16M178 6h16v16M194 118v16h-16M22 134H6v-16" fill="none" stroke={FAINT} strokeWidth="1.5" />
      <g stroke={LINE} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </g>
    </svg>
  );
}

function SatelliteArt() {
  return (
    <Frame>
      <ellipse cx="100" cy="70" rx="88" ry="46" stroke={FAINT} strokeDasharray="4 5" />
      <rect x="86" y="56" width="28" height="28" />
      <rect x="92" y="62" width="16" height="8" stroke={ACCENT} />
      <g>
        <rect x="30" y="60" width="52" height="20" />
        <path d="M43 60v20M56 60v20M69 60v20M30 70h52" strokeWidth="1" />
        <rect x="118" y="60" width="52" height="20" />
        <path d="M131 60v20M144 60v20M157 60v20M118 70h52" strokeWidth="1" />
      </g>
      <path d="M94 84l-6 14h24l-6-14" />
      <path d="M100 56V40" />
      <path d="M88 34a17 17 0 0124 0M81 27a27 27 0 0138 0" stroke={ACCENT} strokeWidth="1.5" />
    </Frame>
  );
}

function TowerArt() {
  return (
    <Frame>
      <path d="M40 124h120" stroke={FAINT} />
      <path d="M88 124l8-84 8 84M92 100h16M94 80h12M95 62h10" />
      <rect x="78" y="44" width="10" height="18" />
      <rect x="96" y="36" width="10" height="18" />
      <rect x="114" y="44" width="10" height="18" />
      <path d="M100 40V26" stroke={ACCENT} />
      <circle cx="100" cy="23" r="2.5" fill={ACCENT} stroke="none" />
      <path d="M60 60a46 46 0 016-14M140 60a46 46 0 00-6-14" stroke={ACCENT} strokeWidth="1.5" />
      <rect x="126" y="104" width="34" height="20" />
      <path d="M126 112h34" strokeWidth="1" />
      <circle cx="132" cy="108" r="1.5" fill={ACCENT} stroke="none" />
    </Frame>
  );
}

function RouterArt() {
  return (
    <Frame>
      <rect x="24" y="52" width="152" height="44" />
      <path d="M24 66h152" strokeWidth="1" />
      {Array.from({ length: 6 }).map((_, i) => (
        <rect key={i} x={34 + i * 14} y={72} width={10} height={12} />
      ))}
      <rect x={34 + 6 * 14} y={72} width={22} height={12} stroke={ACCENT} />
      <rect x={34 + 8 * 14 + 2} y={72} width={22} height={12} stroke={ACCENT} />
      <circle cx="40" cy="59" r="2" fill={ACCENT} stroke="none" />
      <circle cx="50" cy="59" r="2" fill={ACCENT} stroke="none" />
      <circle cx="60" cy="59" r="2" strokeWidth="1.5" />
      <path d="M60 52V30M140 52V30" />
      <path d="M54 26l6-6 6 6M134 26l6-6 6 6" />
      <path d="M100 112v10M92 122h16" stroke={FAINT} />
    </Frame>
  );
}

function SwitchArt() {
  return (
    <Frame>
      <rect x="20" y="48" width="160" height="52" />
      {Array.from({ length: 12 }).map((_, i) => (
        <g key={i}>
          <rect x={30 + i * 11} y={58} width={8} height={8} />
          <rect x={30 + i * 11} y={70} width={8} height={8} />
        </g>
      ))}
      <rect x={30 + 12 * 11 + 4} y={58} width={10} height={20} stroke={ACCENT} />
      <path d="M20 88h160" strokeWidth="1" />
      <path d="M30 94h20M56 94h8M70 94h40M116 94h8M130 94h20" stroke={ACCENT} strokeWidth="2" />
      <path d="M36 112v8M164 112v8" stroke={FAINT} />
    </Frame>
  );
}

function DishArt() {
  return (
    <Frame>
      <path d="M40 124h120" stroke={FAINT} />
      <path d="M60 60a52 52 0 0052 52l14-14a32 32 0 01-32-32z" />
      <path d="M112 112L138 86" />
      <circle cx="140" cy="84" r="4" />
      <path d="M146 78a20 20 0 019-9M152 70a30 30 0 0113-13" stroke={ACCENT} strokeWidth="1.5" />
      <path d="M104 112v12M92 124h24" />
      <rect x="96" y="100" width="16" height="12" />
      <path d="M60 60a52 52 0 0152-52" stroke={FAINT} strokeDasharray="4 4" />
    </Frame>
  );
}

function PhoneArt() {
  return (
    <Frame>
      <rect x="78" y="16" width="44" height="108" rx="8" />
      <rect x="86" y="28" width="28" height="72" strokeWidth="1" />
      <path d="M92 88v-8m7 8v-14m7 14v-20m7 20v-26" stroke={ACCENT} strokeWidth="2.5" />
      <path d="M92 112h16" strokeWidth="1" />
      <circle cx="100" cy="117" r="1.5" fill={LINE} stroke="none" />
      <path d="M122 40h4M122 52h4M74 52h4" />
      <path d="M140 40a24 24 0 0110 10M148 32a36 36 0 0115 15" stroke={ACCENT} strokeWidth="1.5" />
    </Frame>
  );
}

function AircraftArt() {
  return (
    <Frame>
      <path d="M30 100a90 60 0 01140-20" stroke={FAINT} strokeDasharray="5 5" />
      <path d="M100 22c3 8 4 20 4 34l44 14-4 8-40-8c-1 12-2 22-4 28-2-6-3-16-4-28l-40 8-4-8 44-14c0-14 1-26 4-34z" />
      <ellipse cx="100" cy="52" rx="5" ry="10" stroke={ACCENT} />
      <path d="M78 108l-8 12M122 108l8 12M70 122h60" strokeWidth="1.5" />
    </Frame>
  );
}

function ShipArt() {
  return (
    <Frame>
      <path d="M30 92h140l-16 22H46z" />
      <rect x="60" y="72" width="40" height="20" />
      <path d="M108 92V60M108 60h22l-8 10" />
      <rect x="126" y="76" width="18" height="16" />
      <circle cx="100" cy="52" r="3" stroke={ACCENT} />
      <path d="M100 52V40M92 44l16-4" stroke={ACCENT} strokeWidth="1.5" />
      <path d="M20 122c6-4 12-4 18 0s12 4 18 0 12-4 18 0 12 4 18 0 12-4 18 0 12 4 18 0 12-4 18 0 12 4 18 0" strokeWidth="1.5" />
    </Frame>
  );
}

function LaptopArt() {
  return (
    <Frame>
      <rect x="52" y="34" width="96" height="62" />
      <path d="M64 82l14-22 12 12 10-18 16 28" stroke={ACCENT} strokeWidth="2" />
      <path d="M40 108h120l-10-12H50z" />
      <path d="M92 108v4h16v-4" strokeWidth="1" />
      <circle cx="100" cy="40" r="1.5" fill={LINE} stroke="none" />
      <path d="M160 50h10M160 62h10" strokeWidth="1" />
    </Frame>
  );
}

function DesktopArt() {
  return (
    <Frame>
      <rect x="46" y="28" width="80" height="58" />
      <path d="M58 74l10-16 9 9 8-14 12 21" stroke={ACCENT} strokeWidth="2" />
      <path d="M86 86v10M70 100h32" />
      <rect x="134" y="44" width="26" height="56" />
      <path d="M134 56h26" strokeWidth="1" />
      <circle cx="140" cy="50" r="1.5" fill={ACCENT} stroke="none" />
      <rect x="140" y="90" width="14" height="4" strokeWidth="1" />
    </Frame>
  );
}

function CarArt() {
  return (
    <Frame>
      <path d="M40 124h120" stroke={FAINT} />
      <path d="M34 96l10-22 20-4 14-14h30l16 12 22 4 10 24z" />
      <path d="M64 70l10-14h30l14 14" strokeWidth="1" />
      <circle cx="70" cy="98" r="10" />
      <circle cx="70" cy="98" r="3" strokeWidth="1" />
      <circle cx="134" cy="98" r="10" />
      <circle cx="134" cy="98" r="3" strokeWidth="1" />
      <path d="M104 56V36" stroke={ACCENT} />
      <path d="M96 40a11 11 0 0116 0" stroke={ACCENT} strokeWidth="1.5" />
      <rect x="150" y="80" width="10" height="8" stroke={ACCENT} strokeWidth="1.5" />
    </Frame>
  );
}

function TrainArt() {
  return (
    <Frame>
      <rect x="70" y="24" width="60" height="76" />
      <path d="M70 64h60" strokeWidth="1" />
      <rect x="78" y="32" width="44" height="22" strokeWidth="1" />
      <circle cx="86" cy="76" r="3" stroke={ACCENT} />
      <circle cx="114" cy="76" r="3" stroke={ACCENT} />
      <path d="M84 100l-4 10M116 100l4 10M60 114h80" />
      <path d="M100 24V12" stroke={ACCENT} />
      <path d="M92 16a11 11 0 0116 0" stroke={ACCENT} strokeWidth="1.5" />
    </Frame>
  );
}

function AccessPointArt() {
  return (
    <Frame>
      <path d="M60 60h80v26H60z" />
      <path d="M60 73h80" strokeWidth="1" />
      <circle cx="72" cy="66" r="2" fill={ACCENT} stroke="none" />
      <circle cx="82" cy="66" r="2" fill={ACCENT} stroke="none" />
      <circle cx="92" cy="66" r="2" strokeWidth="1.5" />
      <path d="M70 60V38M130 60V38" />
      <path d="M64 32h12M124 32h12" strokeWidth="1.5" />
      <path d="M100 52a22 22 0 0116-8M100 52a22 22 0 00-16-8" stroke={ACCENT} strokeWidth="1.5" />
      <path d="M100 100v12M88 112h24" stroke={FAINT} />
      <path d="M140 100h22v12h-22" strokeWidth="1" />
    </Frame>
  );
}

function AntennaArt() {
  return (
    <Frame>
      <path d="M40 124h120" stroke={FAINT} />
      <path d="M100 124V50" />
      <path d="M100 58l-24-8M100 58l24-8M100 74l-20-6M100 74l20-6M100 90l-16-5M100 90l16-5" />
      <circle cx="100" cy="46" r="3" fill={ACCENT} stroke="none" />
      <path d="M118 30a30 30 0 0114 12M82 30a30 30 0 00-14 12" stroke={ACCENT} strokeWidth="1.5" />
      <path d="M126 20a44 44 0 0120 17M74 20a44 44 0 00-20 17" stroke={ACCENT} strokeWidth="1" />
      <path d="M88 124h24l-6-14h-12z" />
    </Frame>
  );
}

function ServerArt() {
  return (
    <Frame>
      <rect x="66" y="20" width="68" height="100" />
      {[0, 1, 2, 3].map((i) => (
        <g key={i}>
          <path d={`M66 ${48 + i * 24}h68`} strokeWidth="1" />
          <circle cx="76" cy={34 + i * 24} r="2" fill={i === 2 ? LINE : ACCENT} stroke="none" />
          <path d={`M86 ${34 + i * 24}h30`} strokeWidth="2" />
          <rect x="120" y={30 + i * 24} width="8" height="8" strokeWidth="1" />
        </g>
      ))}
      <path d="M74 120v6M126 120v6" stroke={FAINT} />
    </Frame>
  );
}

function SensorArt() {
  return (
    <Frame>
      <rect x="72" y="62" width="56" height="44" />
      <circle cx="100" cy="84" r="11" />
      <circle cx="100" cy="84" r="3.5" fill={ACCENT} stroke="none" />
      <path d="M100 62V44" />
      <path d="M88 50a17 17 0 0124 0M80 40a29 29 0 0140 0" stroke={ACCENT} strokeWidth="1.5" />
      <path d="M84 106v8M116 106v8" stroke={FAINT} />
      <path d="M78 68h8M114 100h8" strokeWidth="1" />
    </Frame>
  );
}

function InternetArt() {
  return (
    <Frame>
      <path d="M62 100a22 22 0 014-43 28 28 0 0154-6 20 20 0 0118 19 18 18 0 01-8 30z" />
      <circle cx="86" cy="82" r="2.5" fill={ACCENT} stroke="none" />
      <circle cx="102" cy="88" r="2.5" fill={ACCENT} stroke="none" />
      <circle cx="118" cy="80" r="2.5" fill={ACCENT} stroke="none" />
      <path d="M86 82l16 6 16-8" stroke={ACCENT} strokeWidth="1.5" />
      <path d="M100 100v14M92 114h16" stroke={FAINT} />
    </Frame>
  );
}

function PersonArt() {
  return (
    <Frame>
      <circle cx="100" cy="42" r="12" />
      <path d="M78 124v-34a22 22 0 0144 0v34" />
      <rect x="116" y="82" width="14" height="24" />
      <path d="M119 102h8" strokeWidth="1" />
      <path d="M140 70a20 20 0 0112 8M146 62a30 30 0 0117 12" stroke={ACCENT} strokeWidth="1.5" />
      <path d="M70 124h60" stroke={FAINT} />
    </Frame>
  );
}

function CameraArt() {
  return (
    <Frame>
      <rect x="52" y="52" width="96" height="48" />
      <circle cx="100" cy="76" r="16" />
      <circle cx="100" cy="76" r="7" stroke={ACCENT} />
      <circle cx="100" cy="76" r="2.5" fill={ACCENT} stroke="none" />
      <path d="M70 52l8-14h44l8 14" />
      <circle cx="60" cy="60" r="1.5" fill={ACCENT} stroke="none" />
      <path d="M100 100v12M88 112h24" stroke={FAINT} />
    </Frame>
  );
}

const ART: Record<string, () => React.ReactNode> = {
  satellite: SatelliteArt,
  base_station: TowerArt,
  tower: TowerArt,
  radio_unit: TowerArt,
  router: RouterArt,
  gateway: RouterArt,
  firewall: RouterArt,
  switch: SwitchArt,
  satellite_terminal: DishArt,
  ground_station: DishArt,
  vsat: DishArt,
  microwave: DishArt,
  smartphone: PhoneArt,
  phone: PhoneArt,
  tablet: PhoneArt,
  aircraft: AircraftArt,
  aircraft_terminal: AircraftArt,
  drone: AircraftArt,
  drone_modem: AircraftArt,
  ship: ShipArt,
  ship_terminal: ShipArt,
  boat: ShipArt,
  offshore: ShipArt,
  laptop: LaptopArt,
  desktop: DesktopArt,
  computer: DesktopArt,
  car: CarArt,
  vehicle: CarArt,
  car_gateway: CarArt,
  train: TrainArt,
  train_gateway: TrainArt,
  access_point: AccessPointArt,
  wifi: AccessPointArt,
  ap: AccessPointArt,
  antenna: AntennaArt,
  radio: AntennaArt,
  server: ServerArt,
  edge_compute: ServerArt,
  load_balancer: ServerArt,
  core: ServerArt,
  sensor: SensorArt,
  iot: SensorArt,
  iot_gateway: SensorArt,
  camera: CameraArt,
  camera_ip: CameraArt,
  internet: InternetArt,
  cloud: InternetArt,
  net: InternetArt,
  person: PersonArt,
  pedestrian: PersonArt,
  walker: PersonArt,
  user_equipment: PersonArt,
};

export default function DeviceArt({ kind, label }: { kind: string; label?: string }) {
  const key = (kind || "").toLowerCase();
  const Bespoke = ART[key];
  if (Bespoke) return <>{Bespoke()}</>;
  /* Framed glyph fallback for families without bespoke art. */
  return (
    <svg viewBox="0 0 200 140" className="h-full w-full" role="img" aria-label={`${label ?? key} illustration`}>
      <rect x="6" y="6" width="188" height="128" fill="none" stroke={FAINT} strokeWidth="1" strokeDasharray="5 4" />
      <path d="M6 22V6h16M178 6h16v16M194 118v16h-16M22 134H6v-16" fill="none" stroke={FAINT} strokeWidth="1.5" />
      <circle cx="100" cy="70" r="42" fill="none" stroke={FAINT} strokeWidth="1" strokeDasharray="4 4" />
      <g transform="translate(68,38) scale(2.67)" color={LINE}>
        <DeviceIcon kind={glyphFamily(key)} size={24} />
      </g>
      <circle cx="100" cy="70" r="3" fill={ACCENT} />
    </svg>
  );
}
