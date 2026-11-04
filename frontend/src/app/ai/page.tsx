"use client";

import { useEffect, useRef, useState } from "react";
import AppShell from "@/components/AppShell";
import {
  addChatNote,
  createHardware,
  createScenario,
  deleteConversation,
  fetchAgentStatus,
  fetchConversation,
  fetchConversations,
  fetchScenarios,
  runAgent,
  streamChatMessage,
  verifyAgents,
  verifyProvider,
  type AgentResponse,
  type AgentStatus,
  type ChatMessage,
  type Conversation,
  type ScenarioSummary,
} from "@/lib/api";

const CAPABILITIES = [
  { id: "architect", hint: "Describe requirements — the agent proposes a validated topology preview you can accept and save." },
  { id: "hardware", hint: "Describe the problem; the agent proposes a validated device specification." },
  { id: "research", hint: "Paste a finding title/problem, or use the Research Lab for stored assessments." },
  { id: "connectivity", hint: "Describe the traffic need; the agent recommends policy/weights for the deterministic engine." },
  { id: "simulation", hint: "Ask about a run; paste event context or describe the transition pattern." },
];

const EXAMPLES: Record<string, string> = {
  architect: "Design a network for a ship traveling between coastal cellular coverage and an offshore satellite-only region. Prioritize reliability, but minimize unnecessary operating costs.",
  hardware: "A gateway for a remote mobile platform switching between terrestrial LTE and satellite.",
  research: "Review: a passive adapter converts LTE radio directly into satellite communication.",
  connectivity: "Bulk overnight backup from a remote site; minimize cost, latency is not critical.",
  simulation: "Explain the most recent failover and what would improve availability.",
};

const CHAT_EXAMPLES = [
  "How is the network performing so far?",
  "Why did this phone lose connectivity when the vessel moved offshore?",
  "What alternative topology could lower our operating costs?",
  "Could we create an adapter that lets a normal phone use the ship's satellite internet?",
];

function parseJsonArray(raw: string): { tool: string }[] {
  try {
    const v = JSON.parse(raw || "[]") as unknown;
    return Array.isArray(v) ? (v as { tool: string }[]) : [];
  } catch {
    return [];
  }
}

function parseJson(raw: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(raw || "null") as unknown;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function MessageBubble({ message, conversationId, onNote }: { message: ChatMessage; conversationId: string; onNote: (text: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [showEvidence, setShowEvidence] = useState(false);
  const evidenceIdx = message.content.indexOf("## Technical evidence");
  const summary = evidenceIdx >= 0 ? message.content.slice(0, evidenceIdx).trimEnd() : message.content;
  const evidence = evidenceIdx >= 0 ? message.content.slice(evidenceIdx) : "";
  const citations = parseJsonArray(message.citations_json) as { title?: string; snippet?: string; doc_id?: string }[];
  const tools = parseJsonArray(message.tool_calls_json);
  const proposal = parseJson(message.proposal_json);
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  const decide = async (approve: boolean) => {
    if (!proposal) return;
    setBusy(true);
    try {
      if (approve) {
        if (proposal.kind === "topology") {
          const data = proposal.data as { metadata?: { name?: string; environment?: string }; nodes?: unknown[]; links?: unknown[] };
          const created = await createScenario(
            `Chat proposal: ${(data.metadata?.name ?? "network").slice(0, 60)}`,
            "generic",
            proposal.data as never
          );
          onNote(`Engineer APPROVED topology proposal from ${message.id}; saved as scenario ${created.id}.`);
          setDone(`Saved as scenario ${created.id}.`);
        } else if (proposal.kind === "device") {
          const created = await createHardware(proposal.data as Record<string, unknown>);
          onNote(`Engineer APPROVED device proposal from ${message.id}; saved as ${created.device_id}.`);
          setDone(`Saved as device ${created.device_id}.`);
        }
      } else {
        onNote(`Engineer REJECTED ${String(proposal.kind)} proposal from ${message.id}. Nothing was saved.`);
        setDone("Rejected. Nothing was saved.");
      }
    } catch (e) {
      setDone(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  if (isSystem) {
    return <p className="rounded bg-nx-workspace px-3 py-1.5 text-[11px] italic text-nx-muted border border-nx-line">{message.content}</p>;
  }
  return (
    <div className={`rounded-md border p-3 ${isUser ? "border-nx-accent/40 bg-nx-accent/5" : "border-nx-line bg-nx-panel"}`}>
      <p className="text-[10px] font-medium uppercase tracking-wide text-nx-muted">
        {isUser ? "You" : "Assistant"}
        {!isUser && message.provenance ? ` · ${message.provenance}` : ""}
      </p>
      <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-nx-body">{summary}</p>
      {!isUser && evidence && (
        <div className="mt-1">
          <button
            onClick={() => setShowEvidence((v) => !v)}
            aria-expanded={showEvidence}
            className="rounded border border-nx-line px-2 py-0.5 text-[10px] text-nx-muted hover:border-nx-accent hover:text-nx-body"
          >
            {showEvidence ? "Hide technical evidence" : "Show technical evidence"}
          </button>
          {showEvidence && (
            <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-nx-muted">{evidence}</p>
          )}
        </div>
      )}
      {!isUser && tools.length > 0 && (
        <p className="mt-2 text-[10px] text-nx-muted">Tools: {tools.map((t) => t.tool).join(", ")}</p>
      )}
      {!isUser && citations.length > 0 && (
        <div className="mt-2 space-y-1">
          {citations.map((c, i) => (
            <p key={i} className="rounded bg-nx-workspace px-2 py-1 text-[10px] text-nx-muted border border-nx-line">
              [{c.title}] {(c.snippet ?? "").replace(/\[|\]/g, "")}
            </p>
          ))}
        </div>
      )}
      {!isUser && proposal && (
        <div className="mt-2 rounded border border-nx-warn/50 bg-nx-warn/5 p-2">
          <p className="text-[11px] font-semibold text-nx-warn">
            Proposal: {String(proposal.kind)} — review required
            {typeof proposal.note === "string" ? ` (${proposal.note})` : ""}
          </p>
          {typeof proposal.explanation === "string" && proposal.explanation && (
            <p className="mt-1 text-[11px] text-nx-body">{proposal.explanation.slice(0, 500)}</p>
          )}
          {done ? (
            <p className="mt-1 text-[11px] text-nx-body">{done}</p>
          ) : (
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => void decide(true)}
                disabled={busy}
                className="rounded bg-nx-ok px-2.5 py-1 text-[11px] font-medium text-nx-workspace disabled:opacity-40"
              >
                Approve & save
              </button>
              <button
                onClick={() => void decide(false)}
                disabled={busy}
                className="rounded border border-nx-line px-2.5 py-1 text-[11px] disabled:opacity-40"
              >
                Reject
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ChatTab({ scenarios }: { scenarios: ScenarioSummary[] }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [thread, setThread] = useState<Conversation | null>(null);
  const [draft, setDraft] = useState("");
  const [scenarioId, setScenarioId] = useState("shared_world");
  const [capability, setCapability] = useState("");
  const [provider, setProvider] = useState("");
  const [useAi, setUseAi] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const [pending, setPending] = useState("");
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const reloadList = async () => {
    try {
      setConversations((await fetchConversations()).conversations);
    } catch {
      /* list is best-effort */
    }
  };

  const openConversation = async (id: string | null) => {
    setActiveId(id);
    setThread(null);
    if (!id) return;
    try {
      setThread(await fetchConversation(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to open conversation");
    }
  };

  useEffect(() => {
    void reloadList();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thread, pending]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || streaming) return;
    setError(null);
    setDraft("");
    setStreaming(true);
    setPending("");
    const cid = activeId;
    // Optimistic user bubble.
    setThread((prev) =>
      prev
        ? { ...prev, messages: [...(prev.messages ?? []), { id: "draft-user", role: "user", content: message, tool_calls_json: "[]", citations_json: "[]", proposal_json: "", provenance: "", created_at: "" }] }
        : prev
    );
    let full = "";
    let finalCid = cid;
    try {
      await streamChatMessage(
        {
          conversation_id: cid,
          message,
          scenario_id: scenarioId,
          capability: capability || null,
          provider: provider || null,
          use_ai: useAi,
        },
        (event, data) => {
          if (event === "meta") {
            finalCid = String(data.conversation_id ?? finalCid ?? "");
            if (!cid && finalCid) void openConversation(finalCid);
          } else if (event === "delta") {
            full += String(data.text ?? "");
            setPending(full);
          } else if (event === "done" && typeof data.corrected_text === "string" && data.corrected_text) {
            full = data.corrected_text;
            setPending(full);
          }
        }
      );
      setPending("");
      await reloadList();
      if (finalCid) await openConversation(finalCid);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chat failed");
      setPending("");
      if (finalCid) await openConversation(finalCid);
    } finally {
      setStreaming(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await deleteConversation(id);
      if (activeId === id) {
        setActiveId(null);
        setThread(null);
      }
      await reloadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const note = async (text: string) => {
    if (!activeId) return;
    try {
      await addChatNote(activeId, text);
      await openConversation(activeId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Note failed");
    }
  };

  return (
    <div className="flex min-h-[60vh] flex-col gap-3 lg:flex-row">
      <div className="w-full shrink-0 rounded-md border border-nx-line bg-nx-panel p-3 lg:w-60">
        <button
          onClick={() => void openConversation(null)}
          className="w-full rounded bg-nx-accent px-2.5 py-1.5 text-xs font-medium text-nx-workspace"
        >
          New conversation
        </button>
        <div className="mt-2 space-y-1">
          {conversations.length === 0 && <p className="text-[11px] text-nx-muted">No conversations yet.</p>}
          {conversations.map((c) => (
            <div key={c.id} className={`group flex items-center gap-1 rounded px-2 py-1.5 text-xs ${c.id === activeId ? "bg-nx-accent/15" : "hover:bg-nx-workspace"}`}>
              <button onClick={() => void openConversation(c.id)} className="min-w-0 flex-1 truncate text-left">
                <span className="block truncate font-medium text-nx-body">{c.title}</span>
                <span className="block text-[10px] text-nx-muted">
                  {c.capability} · {c.message_count ?? 0} msgs
                </span>
              </button>
              <button onClick={() => void remove(c.id)} title="Delete" className="shrink-0 rounded px-1 text-nx-muted hover:text-nx-badink">
                ×
              </button>
            </div>
          ))}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col rounded-md border border-nx-line bg-nx-workspace">
        <div className="flex flex-wrap items-center gap-2 border-b border-nx-line p-2">
          <select value={scenarioId} onChange={(e) => setScenarioId(e.target.value)} title="Scenario context" className="rounded border border-nx-line bg-nx-panel px-2 py-1 text-xs">
            <option value="">No scenario</option>
            {scenarios.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <select value={capability} onChange={(e) => setCapability(e.target.value)} title="Capability (auto when unset)" className="rounded border border-nx-line bg-nx-panel px-2 py-1 text-xs">
            <option value="">Auto capability</option>
            {CAPABILITIES.map((c) => (
              <option key={c.id} value={c.id}>{c.id}</option>
            ))}
          </select>
          <select value={provider} onChange={(e) => setProvider(e.target.value)} title="Provider (server default when unset)" className="rounded border border-nx-line bg-nx-panel px-2 py-1 text-xs">
            <option value="">Default provider</option>
            <option value="meta">Meta</option>
            <option value="baseten">Baseten</option>
          </select>
          <label className="flex items-center gap-1 text-[11px] text-nx-muted" title="Uncheck for deterministic tool-based replies without model calls">
            <input type="checkbox" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} />
            Live AI
          </label>
          {error && <span className="text-[11px] text-nx-badink">{error}</span>}
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
          {!thread && <p className="text-xs text-nx-muted">Start a new conversation or open one from the list. Replies stream in and persist with their tool calls and citations.</p>}
          {thread?.messages?.map((m) => (
            <MessageBubble key={m.id} message={m} conversationId={thread.id} onNote={(t) => void note(t)} />
          ))}
          {pending && (
            <div className="rounded-md border border-nx-line bg-nx-panel p-3">
              <p className="text-[10px] font-medium uppercase tracking-wide text-nx-muted">Assistant · streaming</p>
              <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-nx-body">{pending}</p>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
        {(!thread || (thread.messages ?? []).length === 0) && !streaming && (
          <div className="flex flex-wrap gap-1.5 px-3 pb-1">
            {CHAT_EXAMPLES.map((ex) => (
              <button key={ex} onClick={() => void send(ex)} className="rounded border border-nx-line bg-nx-panel px-2 py-1 text-[11px] text-nx-body">
                {ex}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-2 border-t border-nx-line p-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(draft);
              }
            }}
            rows={2}
            placeholder="Ask about the scenario, hardware, research, or optimization…"
            className="nx-field"
          />
          <button
            onClick={() => void send(draft)}
            disabled={streaming || !draft.trim()}
            className="shrink-0 rounded bg-nx-accent px-4 py-1.5 text-xs font-medium text-nx-workspace disabled:opacity-40"
          >
            {streaming ? "…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SingleRunTab() {
  const [capability, setCapability] = useState("architect");
  const [prompt, setPrompt] = useState(EXAMPLES.architect);
  const [useAi, setUseAi] = useState(true);
  const [response, setResponse] = useState<AgentResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      setResponse(await runAgent(capability, prompt, undefined, useAi));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Agent run failed");
    } finally {
      setBusy(false);
    }
  };

  const acceptTopology = async () => {
    const proposal = response?.result.ai?.proposal_topology as
      | { metadata?: { name?: string; environment?: string }; nodes?: unknown[]; links?: unknown[] }
      | undefined;
    if (!proposal?.nodes || !proposal?.links) return;
    try {
      const created = await createScenario(
        `AI proposal: ${(proposal.metadata?.name ?? "network").slice(0, 60)}`,
        "generic",
        proposal as never
      );
      setMessage(`Accepted and saved as scenario ${created.id}. Nothing was modified until you clicked accept.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    }
  };

  const ai = response?.result.ai;
  const proposal = ai?.proposal_topology as { nodes?: { id: string; label: string; type: string }[]; links?: { id: string; source: string; target: string; technology: string }[] } | undefined;

  return (
    <div>
      {error && <p className="mb-3 rounded bg-nx-bad/10 px-3 py-2 text-xs text-nx-badink">{error}</p>}
      {message && <p className="mb-3 rounded bg-nx-accent/10 px-3 py-2 text-xs text-nx-accent">{message}</p>}
      <div className="flex flex-col gap-3 lg:flex-row">
        <div className="flex-1 rounded-md bg-nx-panel p-4 border border-nx-line">
          <label className="text-xs font-medium text-nx-body">Capability</label>
          <select
            value={capability}
            onChange={(e) => {
              setCapability(e.target.value);
              setPrompt(EXAMPLES[e.target.value]);
              setResponse(null);
            }}
            className="nx-field mt-1"
          >
            {CAPABILITIES.map((c) => (
              <option key={c.id} value={c.id}>{c.id}</option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-nx-muted">{CAPABILITIES.find((c) => c.id === capability)?.hint}</p>
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={5} className="nx-field mt-2" />
          <label className="mt-2 flex items-center gap-1.5 text-xs text-nx-muted">
            <input type="checkbox" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} />
            Use live AI proposal (uncheck for deterministic-only)
          </label>
          <button onClick={() => void run()} disabled={busy || !prompt.trim()} className="mt-2 rounded bg-nx-accent px-3 py-1.5 text-xs font-medium text-nx-workspace disabled:opacity-40">
            {busy ? "Working (model calls can take up to a minute)…" : "Run agent"}
          </button>
        </div>
        <div className="flex-1 rounded-md bg-nx-panel p-4 border border-nx-line">
          <h2 className="text-sm font-semibold text-nx-ink">Result</h2>
          {!response && <p className="mt-1 text-xs text-nx-muted">No run yet.</p>}
          {response && (
            <div className="mt-2 text-xs text-nx-body">
              <p className="text-[11px] text-nx-muted">
                {response.capability} · {response.provenance}
                {response.model ? ` · ${response.model}` : ""} · ai: {response.ai_status}
              </p>
              {ai && (
                <div className="mt-2 rounded bg-nx-ok/10 p-3 border border-nx-ok/40">
                  <h3 className="font-semibold text-nx-ok">Model proposal (review required)</h3>
                  {typeof ai.explanation === "string" && <p className="mt-1 text-[11px]">{ai.explanation}</p>}
                  {typeof ai.rationale === "string" && <p className="mt-1 text-[11px]">{ai.rationale}</p>}
                  {typeof ai.summary === "string" && <p className="mt-1 text-[11px]">{ai.summary}</p>}
                  {Array.isArray(ai.limitations) && ai.limitations.length > 0 && (
                    <p className="mt-1 text-[11px] text-nx-warn">Limits: {(ai.limitations as string[]).join("; ")}</p>
                  )}
                  {proposal && (
                    <>
                      <p className="mt-2 text-[11px]">
                        {proposal.nodes?.length} nodes · {proposal.links?.length} links — validated against backend schemas.
                      </p>
                      <button onClick={() => void acceptTopology()} className="mt-2 rounded bg-nx-ok px-3 py-1.5 text-xs font-medium text-nx-workspace">
                        Preview accepted — save as scenario
                      </button>
                    </>
                  )}
                  {ai.concept != null && (
                    <p className="mt-1 text-[11px]">
                      Device concept {(ai.concept as { device_id?: string }).device_id} — open Hardware Engineering to inspect and save it.
                    </p>
                  )}
                </div>
              )}
              <h3 className="mt-3 font-semibold">Deterministic analysis</h3>
              <pre className="mt-1 max-h-64 overflow-auto rounded bg-nx-workspace p-3 text-[11px] leading-relaxed border border-nx-line">
                {JSON.stringify(response.result.local, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AiPage() {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [verified, setVerified] = useState<Record<string, boolean | null>>({ meta: null, baseten: null });
  const [tab, setTab] = useState<"chat" | "single">("chat");
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAgentStatus().then(setStatus).catch(() => {});
    fetchScenarios().then(setScenarios).catch(() => {});
  }, []);

  const verify = async (provider: string) => {
    try {
      const res = provider === "active" ? await verifyAgents() : await verifyProvider(provider);
      const key = provider === "active" ? (res.provider as string | undefined) ?? "meta" : provider;
      setVerified((prev) => ({ ...prev, [key]: res.verified }));
      setStatus(await fetchAgentStatus());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verification failed");
    }
  };

  return (
    <AppShell title="AI Engineering" subtitle="Conversational assistant plus single-shot capability runs. Agents propose; humans apply.">
      {status && (
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded bg-nx-panel px-3 py-2 text-xs text-nx-body border border-nx-line">
          <span>
            Active: <strong>{status.provider ?? "meta"}</strong> ({status.state}
            {status.model ? ` · ${status.model}` : ""}) — {status.note}
          </span>
          {(["meta", "baseten"] as const).map((p) => (
            <span key={p} className="flex items-center gap-1.5">
              <span className="text-nx-muted">
                {p}: <strong>{status.providers?.[p]?.state ?? "?"}</strong>
                {status.providers?.[p]?.model ? ` ${status.providers[p].model}` : ""}
              </span>
              <button onClick={() => void verify(p)} className="rounded border border-nx-line px-2 py-0.5 text-[11px]">
                Verify {p}
              </button>
              {verified[p] !== null && verified[p] !== undefined && (
                <span className={`text-[11px] font-medium ${verified[p] ? "text-nx-ok" : "text-nx-badink"}`}>
                  {verified[p] ? "verified live" : "failed"}
                </span>
              )}
            </span>
          ))}
        </div>
      )}
      {error && <p className="mb-3 rounded bg-nx-bad/10 px-3 py-2 text-xs text-nx-badink">{error}</p>}
      <div className="mb-3 flex gap-2">
        {(["chat", "single"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded px-3 py-1.5 text-xs font-medium ${tab === t ? "bg-nx-accent text-nx-workspace" : "border border-nx-line text-nx-body"}`}
          >
            {t === "chat" ? "Conversation" : "Single run"}
          </button>
        ))}
      </div>
      {tab === "chat" ? <ChatTab scenarios={scenarios} /> : <SingleRunTab />}
    </AppShell>
  );
}
