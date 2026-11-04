"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import {
  deleteKnowledgeDoc,
  fetchKnowledge,
  fetchKnowledgeDoc,
  fetchSources,
  ingestSource,
  searchKnowledge,
  setSourceEnabled,
  uploadKnowledge,
  type KnowledgeDocument,
  type KnowledgePassage,
  type KnowledgeSource,
} from "@/lib/api";

const CATEGORIES = [
  "internet_protocols",
  "cellular",
  "wireless_optical",
  "rf_propagation",
  "satellite",
  "simulation",
  "measurement",
  "coverage",
];

function SourceRow({ source, onChange }: { source: KnowledgeSource; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const ingest = async () => {
    setBusy(true);
    setResult(null);
    try {
      const res = await ingestSource(source.id);
      setResult(res.status === "ok" ? `Indexed ${res.chunks} passages.` : `Not indexed: ${res.reason ?? res.status}`);
      onChange();
    } catch (e) {
      setResult(e instanceof Error ? e.message : "Ingest failed");
    } finally {
      setBusy(false);
    }
  };

  const toggle = async () => {
    try {
      await setSourceEnabled(source.id, !source.enabled);
      onChange();
    } catch {
      /* surfaced on reload */
    }
  };

  return (
    <div className="rounded border border-nx-line bg-nx-workspace p-2 text-[11px]">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <strong className="text-nx-body">{source.name}</strong>
        <span className="text-nx-muted">{source.organization}</span>
        <a href={source.url} target="_blank" rel="noreferrer" className="text-nx-accent underline">
          origin
        </a>
        <span className={`ml-auto rounded px-1.5 py-0.5 font-medium ${source.status === "ok" ? "bg-nx-ok/15 text-nx-ok" : source.status === "failed" ? "bg-nx-bad/10 text-nx-badink" : "bg-nx-workspace text-nx-muted border border-nx-line"}`}>
          {source.status}{source.doc_count > 0 ? ` · ${source.doc_count} docs` : ""}
        </span>
      </div>
      <p className="mt-1 text-nx-muted">
        {source.category} · {source.data_type} · access: {source.access} · license: {source.license} · trust: {source.trust} · refresh: {source.refresh_policy}
        {source.last_checked ? ` · checked ${source.last_checked.slice(0, 16).replace("T", " ")}` : " · never checked"}
      </p>
      {source.last_error && <p className="mt-0.5 text-nx-badink">Last error: {source.last_error}</p>}
      {result && <p className="mt-0.5 text-nx-body">{result}</p>}
      <div className="mt-1.5 flex gap-2">
        <button onClick={() => void ingest()} disabled={busy || !source.enabled} className="rounded border border-nx-line px-2 py-1 text-[11px] disabled:opacity-40">
          {busy ? "Fetching…" : "Retrieve & index"}
        </button>
        <button onClick={() => void toggle()} className="rounded border border-nx-line px-2 py-1 text-[11px]">
          {source.enabled ? "Disable" : "Enable"}
        </button>
      </div>
    </div>
  );
}

export default function KnowledgePage() {
  const [tab, setTab] = useState<"sources" | "documents" | "search">("sources");
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [category, setCategory] = useState("");
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [selected, setSelected] = useState<KnowledgeDocument | null>(null);
  const [query, setQuery] = useState("");
  const [passages, setPassages] = useState<KnowledgePassage[]>([]);
  const [uploadTitle, setUploadTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reloadSources = async () => {
    try {
      setSources((await fetchSources()).sources);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load sources");
    }
  };

  const reloadDocuments = async () => {
    try {
      setDocuments((await fetchKnowledge()).documents);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load documents");
    }
  };

  useEffect(() => {
    void reloadSources();
    void reloadDocuments();
  }, []);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await uploadKnowledge(file, uploadTitle || undefined);
      setMessage(`Stored and indexed: ${res.title} (${res.chunks} passages).`);
      setUploadTitle("");
      await reloadDocuments();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  const search = async () => {
    if (!query.trim()) return;
    try {
      setPassages((await searchKnowledge(query)).passages);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
    }
  };

  const openDoc = async (id: string) => {
    try {
      setSelected(await fetchKnowledgeDoc(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to open document");
    }
  };

  const remove = async (id: string) => {
    try {
      await deleteKnowledgeDoc(id);
      setSelected(null);
      await reloadDocuments();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const indexed = sources.filter((s) => s.status === "ok").length;
  const failed = sources.filter((s) => s.status === "failed").length;
  const visible = category ? sources.filter((s) => s.category === category) : sources;

  return (
    <AppShell title="Knowledge Sources" subtitle="Allowlisted references, uploaded documents, and citation-aware search.">
      {error && <p className="mb-3 rounded bg-nx-bad/10 px-3 py-2 text-xs text-nx-badink">{error}</p>}
      {message && <p className="mb-3 rounded bg-nx-accent/10 px-3 py-2 text-xs text-nx-accent">{message}</p>}
      <div className="mb-3 flex gap-2">
        {(["sources", "documents", "search"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded px-3 py-1.5 text-xs font-medium capitalize ${tab === t ? "bg-nx-accent text-nx-workspace" : "border border-nx-line text-nx-body"}`}
          >
            {t === "sources" ? `Sources (${sources.length})` : t === "documents" ? `Documents (${documents.length})` : "Search"}
          </button>
        ))}
        {tab === "sources" && (
          <span className="ml-auto self-center text-[11px] text-nx-muted">
            {indexed} indexed · {failed} failed · {sources.length - indexed - failed} pending
          </span>
        )}
      </div>

      {tab === "sources" && (
        <div>
          <div className="mb-2 flex items-center gap-2">
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded border border-nx-line bg-nx-panel px-2 py-1 text-xs">
              <option value="">All categories</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <span className="text-[11px] text-nx-muted">
              Retrieval respects robots.txt, blocks private networks, and stores source URLs with every passage.
            </span>
          </div>
          <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
            {visible.map((s) => (
              <SourceRow key={s.id} source={s} onChange={() => void reloadSources()} />
            ))}
          </div>
        </div>
      )}

      {tab === "documents" && (
        <div className="flex flex-col gap-3 lg:flex-row">
          <div className="w-full shrink-0 space-y-2 lg:w-96">
            <div className="rounded-md border border-nx-line bg-nx-panel p-3">
              <h2 className="text-xs font-semibold text-nx-ink">Upload document</h2>
              <p className="mt-1 text-[11px] text-nx-muted">PDF, DOCX, Markdown, TXT, CSV · max 10 MB · stored locally, chunked, full-text indexed.</p>
              <input
                value={uploadTitle}
                onChange={(e) => setUploadTitle(e.target.value)}
                placeholder="Title (optional)"
                className="nx-field mt-2"
              />
              <input
                type="file"
                accept=".pdf,.docx,.md,.markdown,.txt,.csv"
                disabled={busy}
                onChange={(e) => {
                  void upload(e.target.files?.[0]);
                  e.target.value = "";
                }}
                className="mt-2 w-full text-[11px] text-nx-body"
              />
              {busy && <p className="mt-1 text-[11px] text-nx-muted">Uploading and indexing…</p>}
            </div>
            {documents.length === 0 && <p className="text-xs text-nx-muted">No documents yet. Upload one or retrieve a source.</p>}
            {documents.map((d) => (
              <button
                key={d.id}
                onClick={() => void openDoc(d.id)}
                className={`w-full rounded border p-2 text-left text-[11px] ${selected?.id === d.id ? "border-nx-accent" : "border-nx-line"} bg-nx-panel`}
              >
                <span className="block font-medium text-nx-body">{d.title}</span>
                <span className="block text-nx-muted">
                  {d.source_type}{d.source_ref ? ` · ${d.source_ref.slice(0, 60)}` : ""}{d.filename ? ` · ${d.filename}` : ""} · {d.status}
                </span>
              </button>
            ))}
          </div>
          <div className="min-w-0 flex-1 rounded-md border border-nx-line bg-nx-panel p-4">
            {!selected && <p className="text-xs text-nx-muted">Select a document to inspect its indexed passages.</p>}
            {selected && (
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold text-nx-ink">{selected.title}</h2>
                    <p className="mt-0.5 text-[11px] text-nx-muted">
                      {selected.source_type} · {selected.status}
                      {selected.source_ref ? ` · ref: ${selected.source_ref}` : ""}
                      {selected.filename ? ` · file: ${selected.filename}` : ""}
                    </p>
                  </div>
                  <button onClick={() => void remove(selected.id)} className="shrink-0 rounded border border-nx-line px-2 py-1 text-[11px] text-nx-badink">
                    Delete
                  </button>
                </div>
                <div className="mt-3 space-y-1.5">
                  {(selected.passages ?? []).map((p) => (
                    <div key={p.idx} className="rounded border border-nx-line bg-nx-workspace p-2 text-[11px]">
                      <p className="font-medium text-nx-body">
                        Passage #{p.idx}{p.heading ? ` · ${p.heading}` : ""}{p.page ? ` · page ${p.page}` : ""}
                      </p>
                      <p className="mt-0.5 text-nx-muted">{p.excerpt}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "search" && (
        <div>
          <div className="flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void search();
              }}
              placeholder="Search indexed passages — e.g. VSAT rain fade, BGP best path, handover hysteresis…"
              className="nx-field"
            />
            <button onClick={() => void search()} className="shrink-0 rounded bg-nx-accent px-3 py-1.5 text-xs font-medium text-nx-workspace">
              Search
            </button>
          </div>
          <div className="mt-3 space-y-1.5">
            {passages.map((p) => (
              <button key={p.chunk_id} onClick={() => void openDoc(p.doc_id)} className="block w-full rounded border border-nx-line bg-nx-panel p-2 text-left text-[11px]">
                <span className="block font-medium text-nx-body">
                  [{p.title}{p.heading ? ` · ${p.heading}` : ""}{p.page ? ` · p.${p.page}` : ""}] — passage #{p.idx}
                </span>
                <span className="mt-0.5 block text-nx-muted">{p.snippet.replace(/\[|\]/g, "")}</span>
              </button>
            ))}
            {passages.length === 0 && <p className="text-xs text-nx-muted">No results yet — run a search.</p>}
          </div>
          {selected && (
            <div className="mt-3 rounded-md border border-nx-line bg-nx-panel p-3 text-[11px]">
              <p className="font-semibold text-nx-ink">{selected.title}</p>
              <p className="mt-1 text-nx-muted">
                {(selected.passages ?? []).length} passages · {selected.source_type}
                {selected.source_ref ? ` · ${selected.source_ref}` : ""}
              </p>
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}
