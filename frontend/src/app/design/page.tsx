"use client";

/* Internal engineering-control showcase (Stage C1). Not in primary nav;
   linked from Settings for design review. Every control below is live. */

import { useState } from "react";
import AppShell from "@/components/AppShell";
import {
  NxField,
  NxNumberInput,
  NxSearchSelect,
  NxSelect,
  NxSegmented,
  NxSlider,
  NxTextInput,
  NxToggle,
} from "@/components/ui/controls";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="nx-panel p-4">
      <h2 className="nx-label mb-3">{title}</h2>
      <div className="grid gap-4 md:grid-cols-2">{children}</div>
    </section>
  );
}

const TECHS = [
  { value: "lte", label: "LTE", hint: "Terrestrial cellular" },
  { value: "nr", label: "5G NR", hint: "Terrestrial cellular" },
  { value: "wifi", label: "Wi-Fi 6", hint: "Local access" },
  { value: "vsat", label: "VSAT (GEO)", hint: "Satellite backhaul" },
  { value: "fiber", label: "Fiber", hint: "Guided optical" },
];

export default function DesignShowcasePage() {
  const [name, setName] = useState("South City Cell");
  const [tx, setTx] = useState<number | "">(30);
  const [freq, setFreq] = useState<number | "">(1800);
  const [sens, setSens] = useState<number | "">(-100);
  const [tech, setTech] = useState("lte");
  const [policy, setPolicy] = useState("lowest_latency");
  const [enabled, setEnabled] = useState(true);
  const [monitor, setMonitor] = useState(false);
  const [gain, setGain] = useState(14);
  const [device, setDevice] = useState("vsat");

  return (
    <AppShell title="Control showcase" subtitle="Internal design review — every control is live">
      <div className="mx-auto flex max-w-4xl flex-col gap-4">
        <p className="text-xs text-nx-muted">
          Engineering form system: units attached to inputs, inline validation, read-only vs editable
          states, keyboard-accessible toggles and segmented controls.
        </p>
        <Section title="Text + numeric inputs with units">
          <NxField label="Site name" hint="Free text, required by the planner.">
            <NxTextInput value={name} onChange={setName} placeholder="e.g. South City Cell" />
          </NxField>
          <NxField label="Transmit power" error={tx === "" ? "Transmit power is required." : null}>
            <NxNumberInput value={tx} onChange={setTx} unit="dBm" min={-30} max={60} step={0.5} />
          </NxField>
          <NxField label="Carrier frequency">
            <NxNumberInput value={freq} onChange={setFreq} unit="MHz" min={100} max={100000} hint="100 – 100 000 MHz." />
          </NxField>
          <NxField label="Receiver sensitivity">
            <NxNumberInput value={sens} onChange={setSens} unit="dBm" min={-140} max={-30} step={1} />
          </NxField>
        </Section>
        <Section title="Selection">
          <NxField label="Technology (select)">
            <NxSelect
              value={tech}
              onChange={setTech}
              options={[
                { value: "lte", label: "LTE" },
                { value: "nr", label: "5G NR" },
                { value: "wifi", label: "Wi-Fi 6" },
                { value: "vsat", label: "VSAT (GEO)" },
              ]}
            />
          </NxField>
          <NxField label="Device (searchable)">
            <NxSearchSelect value={device} onChange={setDevice} options={TECHS} ariaLabel="Device technology" />
          </NxField>
          <NxField label="Routing policy (segmented)">
            <NxSegmented
              ariaLabel="Routing policy"
              value={policy}
              onChange={setPolicy}
              options={[
                { value: "lowest_latency", label: "Latency" },
                { value: "lowest_cost", label: "Cost" },
                { value: "balanced", label: "Balanced" },
              ]}
            />
          </NxField>
          <div className="flex flex-col gap-3">
            <span className="flex items-center gap-2 text-xs text-nx-body">
              <NxToggle checked={enabled} onChange={setEnabled} label="Radio enabled" />
              Radio enabled
            </span>
            <span className="flex items-center gap-2 text-xs text-nx-body">
              <NxToggle checked={monitor} onChange={setMonitor} label="Continuous monitoring" />
              Continuous monitoring
            </span>
          </div>
        </Section>
        <Section title="Slider with editable value">
          <NxField label="Antenna gain">
            <NxSlider value={gain} onChange={setGain} min={0} max={40} step={1} unit="dBi" ariaLabel="Antenna gain" />
          </NxField>
          <NxField label="Read-only link budget result">
            <NxTextInput value={`EIRP ${(Number(tx) || 0) + gain} dBm (illustrative)`} readOnly unit="calc" />
          </NxField>
        </Section>
      </div>
    </AppShell>
  );
}
