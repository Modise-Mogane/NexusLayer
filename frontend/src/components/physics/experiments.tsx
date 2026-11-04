"use client";

/* Physics Lab experiment catalog (Stage C3). Each experiment pairs a Level-1
   conceptual visualization with Level-2 deterministic calculations from
   /api/physics/*. Fidelity is always labeled; nothing here is a field
   solver or a measurement. */

export type FieldDef =
  | { kind: "number"; key: string; label: string; unit?: string; min: number; max: number; step: number }
  | { kind: "select"; key: string; label: string; options: { value: string; label: string }[] }
  | { kind: "toggle"; key: string; label: string };

export interface ExperimentDef {
  id: string;
  title: string;
  group: "Guided" | "Wireless" | "Quantum";
  endpoint: "copper" | "optical" | "fiber" | "radio" | "satellite" | "quantum/teleport" | "quantum/bb84";
  blurb: string;
  concept: string;
  fields: FieldDef[];
  defaults: Record<string, number | string | boolean>;
}

export const EXPERIMENTS: ExperimentDef[] = [
  {
    id: "copper",
    title: "Copper signaling",
    group: "Guided",
    endpoint: "copper",
    blurb: "Voltage waves on conductors: loss, delay, bits in flight.",
    concept:
      "Data travels as guided electromagnetic waves; voltage swings encode bits while conduction electrons drift far more slowly. Loss grows with length and rate.",
    fields: [
      { kind: "number", key: "length_m", label: "Cable length", unit: "m", min: 0.1, max: 10000, step: 1 },
      { kind: "number", key: "attenuation_db_per_100m", label: "Attenuation", unit: "dB/100m", min: 0.1, max: 200, step: 0.5 },
      { kind: "number", key: "data_rate_mbps", label: "Line rate", unit: "Mbps", min: 0.001, max: 1000000, step: 1 },
      { kind: "number", key: "velocity_factor", label: "Velocity factor", unit: "×c", min: 0.1, max: 1, step: 0.01 },
    ],
    defaults: { length_m: 100, attenuation_db_per_100m: 22, data_rate_mbps: 1000, velocity_factor: 0.66 },
  },
  {
    id: "optical",
    title: "LED & laser sources",
    group: "Guided",
    endpoint: "optical",
    blurb: "Photon energy vs wavelength; LED breadth vs laser line.",
    concept:
      "Photons come from electron–hole recombination across a semiconductor bandgap. LEDs emit spontaneously over a broad spectrum; lasers emit stimulated, narrow-line light that modulates far faster.",
    fields: [
      { kind: "number", key: "wavelength_nm", label: "Wavelength", unit: "nm", min: 300, max: 2000, step: 5 },
      {
        kind: "select", key: "source", label: "Source", options: [
          { value: "laser", label: "Laser (narrow line)" },
          { value: "led", label: "LED (broad spectrum)" },
        ],
      },
    ],
    defaults: { wavelength_nm: 1310, source: "laser" },
  },
  {
    id: "fiber",
    title: "Fiber link",
    group: "Guided",
    endpoint: "fiber",
    blurb: "Optical budget, delay, and an honest copper comparison.",
    concept:
      "Modulated light is guided by the core–cladding index step. Fiber wins long links on loss per km; the bouncing-ray picture is a conceptual aid, not a mode solution.",
    fields: [
      { kind: "number", key: "length_km", label: "Length", unit: "km", min: 0.01, max: 500, step: 0.5 },
      { kind: "number", key: "attenuation_db_per_km", label: "Fiber loss", unit: "dB/km", min: 0.01, max: 10, step: 0.01 },
      { kind: "number", key: "tx_power_dbm", label: "Launch power", unit: "dBm", min: -30, max: 30, step: 0.5 },
      { kind: "number", key: "extra_loss_db", label: "Splices/connectors", unit: "dB", min: 0, max: 60, step: 0.5 },
      { kind: "number", key: "wavelength_nm", label: "Wavelength", unit: "nm", min: 800, max: 1700, step: 10 },
      { kind: "number", key: "copper_db_per_100m", label: "Copper ref loss", unit: "dB/100m", min: 0.1, max: 200, step: 0.5 },
    ],
    defaults: { length_km: 20, attenuation_db_per_km: 0.35, tx_power_dbm: 0, extra_loss_db: 2, wavelength_nm: 1550, copper_db_per_100m: 22 },
  },
  {
    id: "radio",
    title: "Radio link",
    group: "Wireless",
    endpoint: "radio",
    blurb: "Friis budget: frequency, distance, gains, margin.",
    concept:
      "A carrier wave radiates from the transmit antenna; free-space spreading dominates the loss. Same equations as the simulation RF engine — try Wi-Fi, LTE, or microwave presets by editing the fields.",
    fields: [
      { kind: "number", key: "frequency_mhz", label: "Frequency", unit: "MHz", min: 1, max: 300000, step: 10 },
      { kind: "number", key: "distance_km", label: "Distance", unit: "km", min: 0.001, max: 100000, step: 0.1 },
      { kind: "number", key: "tx_power_dbm", label: "Transmit power", unit: "dBm", min: -50, max: 100, step: 0.5 },
      { kind: "number", key: "tx_gain_dbi", label: "TX antenna gain", unit: "dBi", min: -10, max: 80, step: 0.5 },
      { kind: "number", key: "rx_gain_dbi", label: "RX antenna gain", unit: "dBi", min: -10, max: 80, step: 0.5 },
      { kind: "number", key: "rx_sensitivity_dbm", label: "RX sensitivity", unit: "dBm", min: -200, max: 0, step: 1 },
      { kind: "number", key: "extra_loss_db", label: "Extra losses", unit: "dB", min: 0, max: 200, step: 0.5 },
      { kind: "number", key: "required_margin_db", label: "Required margin", unit: "dB", min: 0, max: 60, step: 0.5 },
    ],
    defaults: { frequency_mhz: 1800, distance_km: 5, tx_power_dbm: 23, tx_gain_dbi: 2, rx_gain_dbi: 18, rx_sensitivity_dbm: -104, extra_loss_db: 15, required_margin_db: 6 },
  },
  {
    id: "satellite",
    title: "Satellite link",
    group: "Wireless",
    endpoint: "satellite",
    blurb: "GEO geometry: why delay dominates the budget.",
    concept:
      "The terminal's uplink climbs ~36,000 km to GEO and back down to the gateway. Path loss is huge but antennas compensate; the quarter-second round trip is pure geometry and cannot be negotiated away.",
    fields: [
      { kind: "number", key: "frequency_mhz", label: "Frequency", unit: "MHz", min: 100, max: 100000, step: 100 },
      { kind: "number", key: "distance_km", label: "Slant range", unit: "km", min: 500, max: 100000, step: 100 },
      { kind: "number", key: "tx_power_dbm", label: "Transmit power", unit: "dBm", min: -50, max: 100, step: 0.5 },
      { kind: "number", key: "tx_gain_dbi", label: "TX antenna gain", unit: "dBi", min: 0, max: 80, step: 0.5 },
      { kind: "number", key: "rx_gain_dbi", label: "RX antenna gain", unit: "dBi", min: 0, max: 80, step: 0.5 },
      { kind: "number", key: "rx_sensitivity_dbm", label: "RX sensitivity", unit: "dBm", min: -200, max: 0, step: 1 },
      { kind: "number", key: "extra_loss_db", label: "Extra losses", unit: "dB", min: 0, max: 200, step: 0.5 },
      { kind: "number", key: "required_margin_db", label: "Required margin", unit: "dB", min: 0, max: 60, step: 0.5 },
    ],
    defaults: { frequency_mhz: 20000, distance_km: 36000, tx_power_dbm: 43, tx_gain_dbi: 45, rx_gain_dbi: 50, rx_sensitivity_dbm: -120, extra_loss_db: 6, required_margin_db: 3 },
  },
  {
    id: "teleport",
    title: "Quantum teleportation",
    group: "Quantum",
    endpoint: "quantum/teleport",
    blurb: "Bell pair + 2 classical bits = state transfer. No FTL.",
    concept:
      "Alice's measurement destroys |ψ⟩ and yields 2 classical bits; Bob's correction reconstructs it on his half of the Bell pair. Without those bits — which travel at most at light speed — Bob holds noise. Entanglement alone signals nothing.",
    fields: [
      { kind: "number", key: "theta_deg", label: "Bloch θ", unit: "deg", min: 0, max: 180, step: 1 },
      { kind: "number", key: "phi_deg", label: "Bloch φ", unit: "deg", min: 0, max: 360, step: 1 },
    ],
    defaults: { theta_deg: 60, phi_deg: 30 },
  },
  {
    id: "bb84",
    title: "BB84 key distribution",
    group: "Quantum",
    endpoint: "quantum/bb84",
    blurb: "Seeded QKD demo: sifting, QBER, Eve detection.",
    concept:
      "Alice prepares random bits in random bases; Bob measures in random bases; they keep matching bases. An intercept-resend Eve introduces ~25% error on the sifted key — eavesdropping is detectable, not preventable. Deterministic for a fixed seed.",
    fields: [
      { kind: "number", key: "num_bits", label: "Raw bits", unit: "bits", min: 16, max: 1024, step: 16 },
      { kind: "number", key: "seed", label: "Seed", min: 0, max: 1000000000, step: 1 },
      { kind: "toggle", key: "eve", label: "Eavesdropper (intercept-resend)" },
    ],
    defaults: { num_bits: 64, seed: 7, eve: false },
  },
];

export function experimentById(id: string): ExperimentDef {
  return EXPERIMENTS.find((e) => e.id === id) ?? EXPERIMENTS[0];
}
