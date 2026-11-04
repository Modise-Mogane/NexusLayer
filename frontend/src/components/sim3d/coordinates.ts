"use client";

/* Unified world coordinates (mirrors backend/app/region.py).
   Canonical sim units: km for x/y, meters for altitude. Scene mapping:
   (x_km, y_km) -> (x, z=y); ground objects sit at y=0; aircraft altitude is
   compressed to min(alt_m/1000, 14); the GEO satellite is a labeled
   schematic at SAT_UNITS, never at true distance. Link budgets always use
   real slant-range geometry, never rendered positions. */

export const KM = 1; // 1 scene unit = 1 km
export const SAT_UNITS = 42; // stylized, NOT to scale
export const AIRCRAFT_ALT_CAP = 14;

export type OverlayMode =
  | "clean"
  | "active"
  | "selected"
  | "coverage"
  | "health"
  | "topology"
  | "traffic";

export const OVERLAY_MODES: { id: OverlayMode; label: string; hint: string }[] = [
  { id: "clean", label: "Clean", hint: "World only, major labels" },
  { id: "active", label: "Active", hint: "Active routes highlighted" },
  { id: "selected", label: "Selected", hint: "Focused route, rest faint" },
  { id: "coverage", label: "Coverage", hint: "RF suitability + gaps" },
  { id: "health", label: "Health", hint: "Every link colored by state" },
  { id: "topology", label: "Topology", hint: "All links, uniform faint lines" },
  { id: "traffic", label: "Traffic", hint: "Flows sized by achieved rate" },
];

/** Baked fallback if /api/world/regions is unreachable; backend is canonical. */
export const FALLBACK_CAMERAS: Record<string, { pos: [number, number, number]; tgt: [number, number, number] }> = {
  overview: { pos: [60, 54, 76], tgt: [0, 0, -4] },
  top: { pos: [0, 150, 12.1], tgt: [0, 0, 12] },
  city: { pos: [-5, 32, -40], tgt: [-5, 0, -8] },
  suburb: { pos: [19, 28, 26], tgt: [19, 0, -8] },
  rural: { pos: [-40, 26, 14], tgt: [-40, 0, -20] },
  harbor: { pos: [14, 22, 30], tgt: [-2, 0, 2] },
  coast: { pos: [14, 22, 30], tgt: [-2, 0, 2] },
  airport: { pos: [43, 26, 30], tgt: [43, 0, -1] },
  corridor: { pos: [30, 16, -24], tgt: [0, 0, -6] },
  offshore: { pos: [30, 34, 72], tgt: [0, 0, 40] },
};

export const REGION_NAV: { preset: string; label: string }[] = [
  { preset: "overview", label: "Overview" },
  { preset: "city", label: "City" },
  { preset: "harbor", label: "Harbor" },
  { preset: "airport", label: "Airport" },
  { preset: "rural", label: "Rural" },
  { preset: "corridor", label: "Corridor" },
  { preset: "offshore", label: "Offshore" },
  { preset: "top", label: "Top" },
];

/** Short display names keep overview labels readable; full names on select. */
export function shortLabel(label: string): string {
  return label
    .replace(" (representative)", "")
    .replace("Coastal Base Station", "City Cell")
    .replace("South City Cell", "South Cell")
    .replace("East Base Station", "East Cell")
    .replace("West Base Station", "West Cell")
    .replace("Satellite Gateway", "Teleport")
    .replace("GEO Satellite (rep.)", "GEO relay")
    .replace("Ship VSAT Terminal", "Ship VSAT")
    .replace("Ship LTE Modem", "Ship LTE")
    .replace("Aircraft SATCOM", "Plane SATCOM")
    .replace("Saltmeadow Phone A", "Rural Phone A")
    .replace("Saltmeadow Phone B", "Rural Phone B")
    .replace("School Hotspot", "Rural Hotspot")
    .replace("Terminal Wi-Fi", "Airport Wi-Fi")
    .replace("Core / Backhaul", "Core")
    .replace("Connected Car", "Car")
    .replace("Passenger Phone", "Car Phone")
    .replace("Cabin Phone", "Cabin Phone")
    .replace("Vessel MV Nexus", "Vessel");
}
