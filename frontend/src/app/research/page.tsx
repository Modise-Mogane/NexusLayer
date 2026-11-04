"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { NxField, NxSelect, NxTextInput, NxTextarea } from "@/components/ui/controls";
import {
  assessFinding,
  assessFindingAI,
  fetchAssessments,
  fetchFindings,
  reviewFinding,
  submitFinding,
  type Assessment,
  type ResearchFinding,
} from "@/lib/api";

const EMPTY = {
  title: "",
  category: "hypothesis",
  problem: "",
  assumptions: "",
  measurements: "",
  references: "",
  use_cases: "",
  impact: "",
  confidence: "low",
  limitations: "",
};

export default function ResearchPage() {
  const [findings, setFindings] = useState<ResearchFinding[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [selected, setSelected] = useState<ResearchFinding | null>(null);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const list = await fetchFindings();
    setFindings(list);
    return list;
  };

  useEffect(() => {
    refresh().catch(() => {});
  }, []);

  const open = async (f: ResearchFinding) => {
    setSelected(f);
    try {
      setAssessments(await fetchAssessments(f.id));
    } catch {
      setAssessments([]);
    }
  };

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const created = await submitFinding(form);
      await refresh();
      await open(created);
      setForm(EMPTY);
      setMessage(`Submitted ${created.id}. Request an assessment to evaluate the claims.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submission failed");
    } finally {
      setBusy(false);
    }
  };

  const assess = async () => {
    if (!selected) return;
    setError(null);
    setBusy(true);
    try {
      await assessFinding(selected.id);
      setAssessments(await fetchAssessments(selected.id));
      const list = await refresh();
      const updated = list.find((f) => f.id === selected.id);
      if (updated) setSelected(updated);
      setMessage("Assessment stored. Human review is required before any claim is accepted.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Assessment failed");
    } finally {
      setBusy(false);
    }
  };

  const assessAI = async () => {
    if (!selected) return;
    setError(null);
    setBusy(true);
    try {
      await assessFindingAI(selected.id);
      setAssessments(await fetchAssessments(selected.id));
      const list = await refresh();
      const updated = list.find((f) => f.id === selected.id);
      if (updated) setSelected(updated);
      setMessage("AI second opinion stored and labeled. Human review is still required.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI assessment failed (provider may be unavailable)");
    } finally {
      setBusy(false);
    }
  };

  const review = async (status: string) => {
    if (!selected) return;
    try {
      const updated = await reviewFinding(selected.id, status);
      setSelected(updated);
      await refresh();
      setMessage(`Finding marked ${status}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Review failed");
    }
  };

  return (
    <AppShell title="Research Lab" subtitle="Submit findings, receive stored assessments, and record human verdicts.">
      <p className="mb-3 text-xs leading-relaxed text-nx-body">
        Supporting documents live in{" "}
        <a href="/knowledge" className="text-nx-accent underline">Knowledge Sources</a>
        {" "}— upload PDF/DOCX/Markdown/text/CSV, then cite passages in the references field.
        Submissions stay user claims until a human verdict says otherwise.
      </p>
      {message && <p className="nx-note-ok mb-3">{message}</p>}
      {error && <p className="nx-note-bad mb-3">{error}</p>}
      <div className="flex flex-col gap-8 lg:flex-row">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold tracking-tight text-nx-ink">Submit a finding</h2>
          <div className="mt-3">
            <NxField label="Research title" hint={form.title.length >= 4 ? undefined : "At least 4 characters."}>
              <NxTextInput value={form.title} onChange={(v) => setForm({ ...form, title: v })} placeholder="Research title" />
            </NxField>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <NxField label="Category">
              <NxSelect
                value={form.category}
                onChange={(v) => setForm({ ...form, category: v })}
                options={["propagation", "protocols", "hardware", "routing", "measurement", "hypothesis", "other"].map((c) => ({ value: c, label: c }))}
              />
            </NxField>
            <NxField label="Confidence">
              <NxSelect
                value={form.confidence}
                onChange={(v) => setForm({ ...form, confidence: v })}
                options={["low", "medium", "high"].map((c) => ({ value: c, label: `confidence: ${c}` }))}
              />
            </NxField>
          </div>
          <NxField label="Problem or proposed discovery" hint="State the claims the assessment should verify.">
            <NxTextarea rows={3} value={form.problem} onChange={(v) => setForm({ ...form, problem: v })} placeholder="Problem or proposed discovery (claims to verify)" />
          </NxField>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <NxField label="Technical assumptions">
              <NxTextarea rows={2} value={form.assumptions} onChange={(v) => setForm({ ...form, assumptions: v })} placeholder="Technical assumptions" />
            </NxField>
            <NxField label="Measurements and test results">
              <NxTextarea rows={2} value={form.measurements} onChange={(v) => setForm({ ...form, measurements: v })} placeholder="Measurements and test results" />
            </NxField>
            <NxField label="References and documents">
              <NxTextarea rows={2} value={form.references} onChange={(v) => setForm({ ...form, references: v })} placeholder="References and documents" />
            </NxField>
            <NxField label="Known limitations">
              <NxTextarea rows={2} value={form.limitations} onChange={(v) => setForm({ ...form, limitations: v })} placeholder="Known limitations" />
            </NxField>
            <NxField label="Proposed use cases">
              <NxTextarea rows={2} value={form.use_cases} onChange={(v) => setForm({ ...form, use_cases: v })} placeholder="Proposed use cases" />
            </NxField>
            <NxField label="Potential impact">
              <NxTextarea rows={2} value={form.impact} onChange={(v) => setForm({ ...form, impact: v })} placeholder="Potential impact" />
            </NxField>
          </div>
          <button onClick={() => void submit()} disabled={busy || form.title.length < 4} className="nx-btn-primary mt-3">
            Submit finding
          </button>
          <h2 className="mb-1 mt-8 text-sm font-semibold tracking-tight text-nx-ink">
            Submitted findings <span className="font-mono text-xs text-nx-muted">({findings.length})</span>
          </h2>
          <div className="divide-y divide-nx-line border-y border-nx-line">
            {findings.map((f) => (
              <button
                key={f.id}
                onClick={() => void open(f)}
                aria-pressed={selected?.id === f.id}
                className={`flex w-full items-baseline gap-2 px-2 py-2.5 text-left transition-colors duration-150 hover:bg-nx-raised ${
                  selected?.id === f.id ? "bg-nx-raised" : ""
                }`}
              >
                <span className={`text-xs font-semibold ${selected?.id === f.id ? "text-nx-accent" : "text-nx-ink"}`}>{f.title}</span>
                <span className="shrink-0 rounded-full bg-nx-workspace px-1.5 py-0.5 font-mono text-[10px] text-nx-body">{f.status}</span>
                <span className="ml-auto shrink-0 font-mono text-[10px] text-nx-muted">{f.category} · {f.id}</span>
              </button>
            ))}
            {findings.length === 0 && (
              <p className="px-2 py-3 text-xs text-nx-muted">No findings yet — the first submission opens above.</p>
            )}
          </div>
        </div>
        <div className="w-full rounded-md bg-nx-panel p-4 border border-nx-line lg:w-96">
          <h2 className="text-sm font-semibold text-nx-ink">Assessment</h2>
          {!selected && <p className="mt-1 text-xs text-nx-muted">Select a finding.</p>}
          {selected && (
            <>
              <p className="mt-1 text-xs font-medium text-nx-ink">{selected.title}</p>
              <p className="text-[11px] text-nx-muted">Status: {selected.status} · by {selected.id}</p>
              <button onClick={() => void assess()} disabled={busy} className="mt-2 w-full rounded bg-nx-accent px-3 py-1.5 text-xs font-medium text-nx-workspace disabled:opacity-40">
                {busy ? "Working…" : "Request assessment"}
              </button>
              <button
                onClick={() => void assessAI()}
                disabled={busy}
                title="Model second opinion (requires configured provider)"
                className="mt-2 w-full rounded border border-nx-line px-3 py-1.5 text-xs hover:bg-nx-raised disabled:opacity-40"
              >
                {busy ? "Working…" : "Request AI second opinion"}
              </button>
              {assessments.map((a) => (
                <div key={a.id} className="mt-3 rounded bg-nx-workspace p-3 text-xs border border-nx-line">
                  <p className="font-semibold">Verdict: {a.verdict} <span className="font-normal text-nx-muted">({a.created_by})</span></p>
                  <p className="mt-1">{a.summary}</p>
                  {a.contradictions.length > 0 && (
                    <>
                      <p className="mt-2 font-semibold text-nx-badink">Contradictions</p>
                      {a.contradictions.map((c, i) => <p key={i} className="text-nx-badink">• {c}</p>)}
                    </>
                  )}
                  {a.missing.length > 0 && (
                    <>
                      <p className="mt-2 font-semibold">Missing</p>
                      {a.missing.map((m, i) => <p key={i}>• {m}</p>)}
                    </>
                  )}
                  <p className="mt-2 font-semibold">Recommended experiments</p>
                  {a.experiments.map((e, i) => <p key={i}>• {e}</p>)}
                  {a.compatible_devices.length > 0 && (
                    <p className="mt-1 text-[11px] text-nx-muted">Devices: {a.compatible_devices.join(", ")}</p>
                  )}
                </div>
              ))}
              <div className="mt-3 flex gap-2">
                {(["approved", "revised", "rejected"] as const).map((s) => (
                  <button key={s} onClick={() => void review(s)} className="flex-1 rounded border border-nx-line px-2 py-1.5 text-xs hover:bg-nx-raised">
                    {s}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[10px] leading-relaxed text-nx-muted">
                Findings never become accepted facts automatically. Established knowledge, user claims, AI hypotheses, and simulation predictions stay labeled.
              </p>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
