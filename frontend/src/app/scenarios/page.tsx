"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import {
  deleteScenario,
  duplicateScenario,
  fetchScenarios,
  fetchTemplates,
  scenarioFromTemplate,
  type ScenarioSummary,
} from "@/lib/api";

export default function ScenariosPage() {
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([]);
  const [templates, setTemplates] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => setScenarios(await fetchScenarios());

  useEffect(() => {
    refresh().catch((e) => setError(e instanceof Error ? e.message : "Failed to load scenarios"));
    fetchTemplates().then((t) => setTemplates(t.templates)).catch(() => {});
  }, []);

  const create = async (kind: string) => {
    setError(null);
    try {
      const created = await scenarioFromTemplate(kind);
      await refresh();
      setMessage(`Created ${created.name} (${created.id}).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Creation failed");
    }
  };

  const duplicate = async (id: string) => {
    try {
      await duplicateScenario(id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Duplicate failed");
    }
  };

  const remove = async (id: string) => {
    if (!confirm(`Delete scenario ${id}?`)) return;
    try {
      await deleteScenario(id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  };

  return (
    <AppShell title="Scenarios" subtitle="Saved network scenarios, environment templates, and simulation entry points.">
      {message && <p className="mb-3 rounded bg-nx-accent/10 px-3 py-2 text-xs text-nx-accent">{message}</p>}
      {error && <p className="mb-3 rounded bg-nx-bad/10 px-3 py-2 text-xs text-nx-badink">{error}</p>}
      <div className="mb-4 rounded-md bg-nx-panel p-4 border border-nx-line">
        <h2 className="text-sm font-semibold text-nx-ink">Create from template</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          {templates.map((t) => (
            <button key={t} onClick={() => void create(t)} className="rounded border border-nx-line bg-nx-panel px-2.5 py-1.5 text-xs hover:bg-nx-raised">
              {t}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
        {scenarios.map((s) => (
          <div key={s.id} className="rounded-md bg-nx-panel p-4 border border-nx-line">
            <h2 className="text-sm font-semibold text-nx-ink">{s.name}</h2>
            <p className="text-[11px] text-nx-muted">
              {s.id} · {s.environment} · v{s.version} · {s.node_count} nodes · {s.link_count} links
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Link href={`/architecture?scenario=${encodeURIComponent(s.id)}`} className="rounded bg-nx-accent px-2.5 py-1 text-xs font-medium text-nx-workspace">
                Edit
              </Link>
              <Link href={`/simulation?scenario=${encodeURIComponent(s.id)}`} className="rounded bg-nx-accent px-2.5 py-1 text-xs font-medium text-nx-workspace">
                Simulate in 3D
              </Link>
              <Link href={`/analysis?scenario=${encodeURIComponent(s.id)}`} className="rounded border border-nx-line px-2.5 py-1 text-xs">
                Analyze
              </Link>
              <button onClick={() => void duplicate(s.id)} className="rounded border border-nx-line px-2.5 py-1 text-xs">
                Duplicate
              </button>
              {s.id !== "maritime_failover" && (
                <button onClick={() => void remove(s.id)} className="rounded border border-nx-bad/50 px-2.5 py-1 text-xs text-nx-badink">
                  Delete
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
