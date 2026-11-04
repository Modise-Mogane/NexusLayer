"use client";

/* Global assistant drawer (Stage C1). Compact presence beside the workspace:
   thread, streaming replies, evidence toggle, proposal review, voice
   controls, and the live UI-selection context. */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAssistant } from "@/components/assistant/AssistantProvider";
import { NxTextInput, NxToggle } from "@/components/ui/controls";
import { createHardware, createScenario, type ChatMessage } from "@/lib/api";

function parseJson(raw: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(raw || "null") as unknown;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function Bubble({ message }: { message: ChatMessage }) {
  const { note } = useAssistant();
  const [showEvidence, setShowEvidence] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const isUser = message.role === "user";
  const isSystem = message.role === "system";
  const idx = message.content.indexOf("## Technical evidence");
  const summary = idx >= 0 ? message.content.slice(0, idx).trimEnd() : message.content;
  const evidence = idx >= 0 ? message.content.slice(idx) : "";
  const proposal = parseJson(message.proposal_json);

  const decide = async (approve: boolean) => {
    if (!proposal) return;
    setBusy(true);
    try {
      if (approve) {
        if (proposal.kind === "topology") {
          const data = proposal.data as { metadata?: { name?: string } };
          const created = await createScenario(
            `Chat proposal: ${(data.metadata?.name ?? "network").slice(0, 60)}`,
            "generic",
            proposal.data as never
          );
          note(`Engineer APPROVED topology proposal from ${message.id}; saved as scenario ${created.id}.`);
          setDone(`Saved as scenario ${created.id}.`);
        } else if (proposal.kind === "device") {
          const created = await createHardware(proposal.data as Record<string, unknown>);
          note(`Engineer APPROVED device proposal from ${message.id}; saved as ${created.device_id}.`);
          setDone(`Saved as device ${created.device_id}.`);
        }
      } else {
        note(`Engineer REJECTED ${String(proposal.kind)} proposal from ${message.id}. Nothing was saved.`);
        setDone("Rejected. Nothing was saved.");
      }
    } catch (e) {
      setDone(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  if (isSystem) {
    return (
      <p className="rounded border border-nx-line bg-nx-workspace px-2.5 py-1.5 text-[11px] italic text-nx-muted">
        {message.content}
      </p>
    );
  }
  return (
    <div className={`nx-swap rounded-md border p-2.5 ${isUser ? "border-nx-accent/40 bg-nx-accent/5" : "border-nx-line bg-nx-panel"}`}>
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
          {showEvidence && <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-nx-muted">{evidence}</p>}
        </div>
      )}
      {!isUser && proposal && (
        <div className="mt-2 rounded border border-nx-warn/50 bg-nx-warn/5 p-2">
          <p className="text-[11px] font-semibold text-nx-warn">Proposal: {String(proposal.kind)} — review required</p>
          {typeof proposal.explanation === "string" && proposal.explanation && (
            <p className="mt-1 text-[11px] text-nx-body">{proposal.explanation.slice(0, 400)}</p>
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

const SUGGESTIONS = [
  "How is the network performing?",
  "Explain this connection.",
  "Why is this endpoint disconnected?",
  "How could we improve the rural coverage?",
];

export default function AssistantDrawer() {
  const a = useAssistant();
  const [draft, setDraft] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [nameDraft, setNameDraft] = useState(a.assistantName);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [a.thread, a.pending, a.drawerOpen]);

  useEffect(() => {
    setNameDraft(a.assistantName);
  }, [a.assistantName, showSettings]);

  if (!a.drawerOpen) return null;

  const ctxChips: [string, string | undefined][] = [
    ["route", a.context.route],
    ["node", a.context.node_label ?? a.context.node_id],
    ["link", a.context.link_label ?? a.context.link_id],
    ["region", a.context.region_id],
    ["entity", a.context.entity_label ?? a.context.entity_id],
    ["experiment", a.context.experiment_id],
  ];

  const submit = () => {
    if (!draft.trim() || a.streaming) return;
    a.send(draft);
    setDraft("");
  };

  return (
    <div
      role="complementary"
      aria-label="Live assistant"
      className="nx-drawer absolute bottom-0 right-0 top-0 z-40 flex w-[340px] max-w-[90vw] flex-col border-l border-nx-line bg-nx-panel shadow-2xl"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-nx-line px-3 py-2">
        <span className={`h-2 w-2 rounded-full ${a.live ? "bg-nx-accent nx-live-dot" : "bg-nx-muted"}`} aria-hidden />
        <p className="min-w-0 flex-1 truncate text-xs font-semibold text-nx-ink">
          {a.assistantName} · {a.live ? "Live" : "Standby"}
          {a.listening ? " · listening" : ""}
          {a.speaking ? " · speaking" : ""}
          {a.speechPaused ? " · paused" : ""}
        </p>
        <button
          onClick={() => setShowSettings((v) => !v)}
          aria-expanded={showSettings}
          aria-label="Assistant settings"
          title="Assistant settings"
          className="rounded border border-nx-line px-1.5 py-0.5 text-[11px] text-nx-muted hover:text-nx-body"
        >
          <span aria-hidden>⚙</span>
        </button>
        <button
          onClick={() => a.newConversation()}
          aria-label="New conversation"
          title="New conversation"
          className="rounded border border-nx-line px-1.5 py-0.5 text-[11px] text-nx-muted hover:text-nx-body"
        >
          <span aria-hidden>+</span>
        </button>
        <button
          onClick={() => a.setDrawerOpen(false)}
          aria-label="Minimize assistant"
          title="Minimize (conversation keeps running)"
          className="rounded border border-nx-line px-1.5 py-0.5 text-[11px] text-nx-muted hover:text-nx-body"
        >
          <span aria-hidden>×</span>
        </button>
      </div>

      {showSettings && (
        <div className="shrink-0 space-y-2 border-b border-nx-line p-3">
          <div className="flex items-center gap-2">
            <span className="w-20 shrink-0 text-[11px] text-nx-muted">Name</span>
            <NxTextInput value={nameDraft} onChange={setNameDraft} aria-label="Assistant name" />
            <button onClick={() => a.setAssistantName(nameDraft)} className="shrink-0 rounded bg-nx-accent px-2 py-1 text-[11px] font-medium text-nx-workspace">
              Set
            </button>
          </div>
          <span className="flex items-center gap-2 text-[11px] text-nx-body">
            <NxToggle checked={a.voiceOutput} onChange={a.setVoiceOutput} label="Spoken responses" />
            Spoken responses
          </span>
          <span className="flex items-center gap-2 text-[11px] text-nx-body">
            <NxToggle checked={a.useAi} onChange={a.setUseAi} label="Use AI provider" />
            Use AI provider
            <span className="text-[10px] text-nx-muted">(off = local deterministic)</span>
          </span>
          <p className="text-[10px] leading-relaxed text-nx-muted">
            Voice input: {a.sttSupported ? "supported (browser speech recognition)" : a.sttDetail} Voice
            output: {a.ttsSupported ? "supported" : "unsupported"}. Speech may be processed by your
            browser vendor; NexusLayer stores no raw audio — only transcripts you send, kept as ordinary
            chat messages.
          </p>
          {a.recent.length > 0 && (
            <div>
              <p className="nx-label mb-1">Recent</p>
              <div className="space-y-0.5">
                {a.recent.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => void a.openConversation(c.id)}
                    className={`block w-full truncate rounded px-2 py-1 text-left text-[11px] ${
                      c.id === a.conversationId ? "bg-nx-accent/15 text-nx-accent" : "text-nx-body hover:bg-nx-raised"
                    }`}
                  >
                    {c.title}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-nx-line px-3 py-1.5">
        {ctxChips.filter(([, v]) => v).map(([k, v]) => (
          <span key={k} className="rounded bg-nx-workspace px-1.5 py-0.5 font-mono text-[10px] text-nx-muted border border-nx-line">
            {k}: {v}
          </span>
        ))}
        {ctxChips.every(([, v]) => !v) && <span className="text-[10px] text-nx-muted">No selection context.</span>}
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {!a.thread && !a.streaming && (
          <>
            <p className="text-xs text-nx-muted">
              {a.live
                ? `Talk or type — I can see your current selection (${a.assistantName} stays on while you work).`
                : "Enable Live in the top bar to talk, or just type below."}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => a.send(s)}
                  className="rounded border border-nx-line bg-nx-workspace px-2 py-1 text-[11px] text-nx-body hover:border-nx-accent"
                >
                  {s}
                </button>
              ))}
            </div>
          </>
        )}
        {a.thread?.messages?.map((m) => (
          <Bubble key={m.id} message={m} />
        ))}
        {a.pending && (
          <div className="rounded-md border border-nx-line bg-nx-workspace p-2.5">
            <p className="text-[10px] font-medium uppercase tracking-wide text-nx-muted">Assistant · streaming</p>
            <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-nx-body">{a.pending}</p>
          </div>
        )}
        {a.streaming && !a.pending && (
          <p className="rounded-md border border-nx-line bg-nx-workspace px-2.5 py-2 text-xs text-nx-muted">
            <span className="nx-live-dot mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-nx-accent" aria-hidden />
            Thinking — consulting engineering tools…
          </p>
        )}
        {a.interim && (
          <p className="rounded border border-dashed border-nx-accent/50 px-2.5 py-1.5 text-xs italic text-nx-muted">
            “{a.interim}”
          </p>
        )}
        {a.error && <p className="nx-note-bad">{a.error}</p>}
        {a.voiceError && <p className="nx-note-warn">{a.voiceError}</p>}
        <div ref={bottomRef} />
      </div>

      {a.context.link_id && (
        <div className="shrink-0 border-t border-nx-line px-3 py-1.5">
          <Link
            href={`/physics?scenario=${encodeURIComponent(a.scenarioId)}&link=${encodeURIComponent(a.context.link_id)}`}
            className="text-[11px] font-medium text-nx-accent hover:underline"
          >
            Open {a.context.link_label ?? "the selected link"} in Physics Lab →
          </Link>
        </div>
      )}
      <div className="shrink-0 border-t border-nx-line p-2">
        <div className="flex gap-1.5">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={a.sttSupported ? "Type, or press the mic to talk…" : "Type your question… (voice unsupported here)"}
            aria-label="Message the assistant"
            className="nx-field"
          />
          <button
            onClick={() => a.talkOnce()}
            title={a.sttSupported ? (a.listening ? "Stop listening" : "Talk (click, speak, auto-send)") : a.sttDetail}
            aria-pressed={a.listening}
            className={`shrink-0 rounded border px-2.5 text-sm ${
              a.listening
                ? "border-nx-accent bg-nx-accent/20 text-nx-accent"
                : "border-nx-line text-nx-muted hover:border-nx-accent hover:text-nx-body"
            }`}
          >
            {a.listening ? "◉" : "◎"}
          </button>
          <button
            onClick={submit}
            disabled={a.streaming || !draft.trim()}
            className="shrink-0 rounded bg-nx-accent px-3 py-1.5 text-xs font-medium text-nx-workspace disabled:opacity-40"
          >
            {a.streaming ? "…" : "Send"}
          </button>
        </div>
        {(a.speaking || a.speechPaused) ? (
          <div className="mt-1.5 flex gap-1.5">
            <button
              onClick={() => a.stopVoice()}
              className="flex-1 rounded border border-nx-line px-2 py-1 text-[11px] text-nx-muted hover:text-nx-body"
            >
              ⏹ Stop
            </button>
            <button
              onClick={() => (a.speechPaused ? a.resumeSpeech() : a.pauseSpeech())}
              className="flex-1 rounded border border-nx-line px-2 py-1 text-[11px] text-nx-muted hover:text-nx-body"
            >
              {a.speechPaused ? "▶ Resume" : "⏸ Pause"}
            </button>
            <button
              onClick={() => a.repeatLast()}
              title="Speak the last response again"
              className="flex-1 rounded border border-nx-line px-2 py-1 text-[11px] text-nx-muted hover:text-nx-body"
            >
              ↺ Repeat
            </button>
          </div>
        ) : (
          a.thread?.messages?.some((m) => m.role === "assistant") && (
            <button
              onClick={() => a.repeatLast()}
              title="Speak the last response again"
              className="mt-1.5 w-full rounded border border-nx-line px-2 py-1 text-[11px] text-nx-muted hover:text-nx-body"
            >
              ↺ Repeat last response
            </button>
          )
        )}
      </div>
    </div>
  );
}
