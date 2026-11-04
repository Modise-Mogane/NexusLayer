"use client";

/* Global live assistant (Stage C1). Mounted once at the application-shell
   level so route changes never destroy an active conversation or voice
   session. Live mode always starts OFF — the microphone is never opened
   without an explicit operator action. */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  addChatNote,
  fetchConversation,
  fetchConversations,
  streamChatMessage,
  type AssistantContext,
  type ChatMessage,
  type Conversation,
} from "@/lib/api";
import { createListener, stripWakeWord, voiceSupport } from "@/lib/voice";
import { speechController, ttsSupported, type SpeechPhase } from "@/lib/speech";

export { type AssistantContext };

export interface AssistantState {
  live: boolean;
  setLive: (on: boolean) => void;
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
  conversationId: string | null;
  thread: Conversation | null;
  openConversation: (id: string | null) => void;
  newConversation: () => void;
  recent: Conversation[];
  streaming: boolean;
  pending: string;
  error: string | null;
  send: (text: string) => void;
  note: (text: string) => void;
  scenarioId: string;
  setScenarioId: (id: string) => void;
  useAi: boolean;
  setUseAi: (on: boolean) => void;
  listening: boolean;
  interim: string;
  voiceError: string | null;
  talkOnce: () => void;
  speaking: boolean;
  speechPaused: boolean;
  /** Combined voice phase for UI/tests: error|speaking|paused|thinking|listening|idle. */
  voicePhase: "error" | "speaking" | "paused" | "thinking" | "listening" | "idle";
  stopVoice: () => void;
  repeatLast: () => void;
  pauseSpeech: () => void;
  resumeSpeech: () => void;
  voiceOutput: boolean;
  setVoiceOutput: (on: boolean) => void;
  assistantName: string;
  setAssistantName: (name: string) => void;
  sttSupported: boolean;
  ttsSupported: boolean;
  sttDetail: string;
  publishContext: (patch: AssistantContext) => void;
  context: AssistantContext;
}

const Ctx = createContext<AssistantState | null>(null);

export function useAssistant(): AssistantState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAssistant must be used inside AssistantProvider");
  return v;
}

/** Pages publish their selection; the assistant attaches it to chat turns. */
export function useAssistantContext(patch: AssistantContext, deps: unknown[] = []) {
  const { publishContext } = useAssistant();
  const key = JSON.stringify(patch);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    publishContext(patch);
  }, [key, ...deps]);
  void publishContext;
}

function stored(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export default function AssistantProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [live, setLiveState] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [thread, setThread] = useState<Conversation | null>(null);
  const [recent, setRecent] = useState<Conversation[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [pending, setPending] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [scenarioId, setScenarioId] = useState("shared_world");
  const [useAi, setUseAiState] = useState(() => stored("nx-assistant-useai", "1") === "1");
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [speechPhase, setSpeechPhase] = useState<SpeechPhase>("idle");
  const [voiceOutput, setVoiceOutputState] = useState(() => stored("nx-assistant-voice", "1") === "1");
  const [assistantName, setAssistantNameState] = useState(() => stored("nx-assistant-name", "Nexus") || "Nexus");
  const [support] = useState(voiceSupport);
  const [context, setContext] = useState<AssistantContext>({});

  const liveRef = useRef(false);
  const streamingRef = useRef(false);
  const listenerRef = useRef<{ start: () => void; stop: () => void } | null>(null);
  const contextRef = useRef<AssistantContext>({});
  const scenarioRef = useRef(scenarioId);
  const useAiRef = useRef(useAi);
  const convoRef = useRef<string | null>(null);
  const nameRef = useRef(assistantName);
  const voiceOutRef = useRef(voiceOutput);
  const errorBackoff = useRef(0);
  const feedingSpeechRef = useRef(false);
  const speech = useRef(speechController()).current;

  scenarioRef.current = scenarioId;
  useAiRef.current = useAi;
  convoRef.current = conversationId;
  nameRef.current = assistantName;
  voiceOutRef.current = voiceOutput;

  const publishContext = useCallback((patch: AssistantContext) => {
    contextRef.current = { ...contextRef.current, ...patch };
    setContext(contextRef.current);
  }, []);

  // Route is always part of the context.
  useEffect(() => {
    contextRef.current = { ...contextRef.current, route: pathname };
    setContext(contextRef.current);
  }, [pathname]);

  const reloadRecent = useCallback(async () => {
    try {
      const list = await fetchConversations();
      setRecent(list.conversations.slice(0, 6));
    } catch {
      /* best-effort */
    }
  }, []);

  useEffect(() => {
    void reloadRecent();
  }, [reloadRecent, conversationId]);

  const openConversation = useCallback(async (id: string | null) => {
    setConversationId(id);
    setThread(null);
    setError(null);
    if (!id) return;
    try {
      setThread(await fetchConversation(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to open conversation");
    }
  }, []);

  const newConversation = useCallback(() => {
    setConversationId(null);
    setThread(null);
    setPending("");
    setError(null);
  }, []);

  const stopVoice = useCallback(() => {
    feedingSpeechRef.current = false;
    speech.cancel("user-stop");
  }, [speech]);

  const repeatLast = useCallback(() => {
    if (!voiceOutRef.current || !ttsSupported()) return;
    speech.repeat();
  }, [speech]);

  const pauseSpeech = useCallback(() => {
    speech.pause();
  }, [speech]);

  const resumeSpeech = useCallback(() => {
    speech.resume();
  }, [speech]);

  const send = useCallback(
    (raw: string) => {
      const message = raw.trim();
      if (!message || streamingRef.current) return;
      setError(null);
      setVoiceError(null);
      streamingRef.current = true;
      setStreaming(true);
      setPending("");
      // Deliberate interruption: a new request replaces in-flight speech.
      feedingSpeechRef.current = false;
      speech.cancel(speech.getPhase() === "idle" ? "new-response" : "barge-in");
      // Stream deltas straight into the speech queue while Live; completion
      // is reported when the queue drains AND the stream ends.
      const willSpeak = liveRef.current && voiceOutRef.current && ttsSupported();
      feedingSpeechRef.current = willSpeak;
      if (willSpeak) speech.beginStream();
      // Optimistic user bubble, even for a brand-new conversation.
      const optimistic: ChatMessage = {
        id: `draft-${Date.now()}`, role: "user", content: message,
        tool_calls_json: "[]", citations_json: "[]", proposal_json: "",
        provenance: "", created_at: "",
      };
      setThread((prev) =>
        prev
          ? { ...prev, messages: [...(prev.messages ?? []), optimistic] }
          : ({
              id: "draft", title: "New conversation", scenario_id: scenarioRef.current,
              capability: "", provider: "", model: "", created_at: "", updated_at: "",
              messages: [optimistic],
            } as Conversation)
      );
      const cid = convoRef.current;
      const ctx = { ...contextRef.current };
      let full = "";
      let finalCid = cid;
      const finish = async () => {
        streamingRef.current = false;
        setStreaming(false);
        if (feedingSpeechRef.current) {
          feedingSpeechRef.current = false;
          speech.finishStream(); // flushes the final partial sentence
        }
        setPending("");
        await reloadRecent();
        if (finalCid) {
          setConversationId(finalCid);
          try {
            setThread(await fetchConversation(finalCid));
          } catch {
            /* thread refresh is best-effort */
          }
        }
      };
      void (async () => {
        try {
          await streamChatMessage(
            {
              conversation_id: cid,
              message,
              scenario_id: scenarioRef.current,
              use_ai: useAiRef.current,
              context: ctx,
            },
            (event, data) => {
              if (event === "meta") {
                finalCid = String(data.conversation_id ?? finalCid ?? "");
              } else if (event === "delta") {
                const text = String(data.text ?? "");
                full += text;
                setPending(full);
                if (feedingSpeechRef.current && text) speech.pushText(text);
              } else if (event === "done" && typeof data.corrected_text === "string" && data.corrected_text) {
                // Server replaced a raw tool-data dump with the deterministic
                // summary; speak and display the replacement, not the dump.
                full = data.corrected_text;
                setPending(full);
                if (feedingSpeechRef.current) {
                  speech.cancel("new-response");
                  speech.beginStream();
                  speech.pushText(full);
                }
              }
            }
          );
        } catch (e) {
          setError(e instanceof Error ? e.message : "Assistant request failed");
          if (finalCid) {
            try {
              setThread(await fetchConversation(finalCid));
            } catch {
              /* noop */
            }
          }
        } finally {
          void finish();
        }
      })();
    },
    [reloadRecent, speech]
  );

  const note = useCallback(
    async (text: string) => {
      const cid = convoRef.current;
      if (!cid) return;
      try {
        await addChatNote(cid, text);
        setThread(await fetchConversation(cid));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Note failed");
      }
    },
    []
  );

  const stopListening = useCallback(() => {
    try {
      listenerRef.current?.stop();
    } catch {
      /* noop */
    }
    listenerRef.current = null;
    setListening(false);
    setInterim("");
  }, []);

  const startListening = useCallback(() => {
    if (!support.stt || listenerRef.current) return;
    setVoiceError(null);
    // NOTE: never cancel speech here — recognition auto-restarts after every
    // utterance, and cancelling on restart cut spoken replies short. Speech
    // is suspended via stopListening() while the assistant talks (see the
    // speech-phase binding below); only an actual user transcript (onFinal →
    // send) or an explicit control cancels playback.
    const listener = createListener({
      onInterim: (text) => setInterim(text),
      onFinal: (text) => {
        setInterim("");
        const { text: cleaned } = stripWakeWord(text, nameRef.current);
        if (cleaned) send(cleaned);
      },
      onError: (code) => {
        if (code === "not-allowed" || code === "service-not-allowed") {
          setVoiceError("Microphone blocked. Allow microphone access, then re-enable Live.");
          errorBackoff.current = 99; // do not auto-restart
          setLiveState(false);
          liveRef.current = false;
          stopListening();
        } else if (code !== "aborted" && code !== "no-speech") {
          setVoiceError(`Voice input issue (${code}). Text still works.`);
        }
      },
      onEnd: () => {
        // Single-shot recognition ends after each utterance; in Live mode we
        // restart so the session stays open until the operator stops it —
        // but never while the assistant is speaking (the mic would hear its
        // own replies; resume is handled on speech completion instead).
        listenerRef.current = null;
        setListening(false);
        setInterim("");
        if (liveRef.current && errorBackoff.current < 3 && speech.getPhase() === "idle") {
          errorBackoff.current += 1;
          window.setTimeout(() => {
            if (liveRef.current && speech.getPhase() === "idle") {
              errorBackoff.current = 0;
              startListening();
            }
          }, 250);
        }
      },
    });
    if (!listener.supported) {
      setVoiceError(support.sttDetail);
      return;
    }
    listenerRef.current = listener;
    setListening(true);
    listener.start();
  }, [send, speech, stopListening, support.stt, support.sttDetail]);

  const setLive = useCallback(
    (on: boolean) => {
      errorBackoff.current = 0;
      if (!on) {
        liveRef.current = false;
        setLiveState(false);
        stopListening();
        feedingSpeechRef.current = false;
        speech.cancel("live-off");
        return;
      }
      if (!support.stt) {
        // Live conversation still works as streaming text; say so honestly.
        setVoiceError(support.sttDetail);
      }
      liveRef.current = true;
      setLiveState(true);
      setDrawerOpen(true);
      if (support.stt) startListening();
    },
    [speech, startListening, stopListening, support.stt, support.sttDetail]
  );

  const talkOnce = useCallback(() => {
    if (!support.stt) {
      setVoiceError(support.sttDetail);
      return;
    }
    if (listenerRef.current) {
      stopListening();
      return;
    }
    // Pressing talk while the assistant speaks is a deliberate barge-in:
    // stop playback first so the mic hears the operator, not the reply.
    if (speech.getPhase() !== "idle") {
      feedingSpeechRef.current = false;
      speech.cancel("barge-in");
    }
    startListening();
  }, [speech, startListening, stopListening, support.stt, support.sttDetail]);

  const setVoiceOutput = useCallback((on: boolean) => {
    setVoiceOutputState(on);
    try {
      localStorage.setItem("nx-assistant-voice", on ? "1" : "0");
    } catch {
      /* noop */
    }
    if (!on) {
      feedingSpeechRef.current = false;
      speech.cancel("voice-off");
    }
  }, [speech]);

  const setUseAi = useCallback((on: boolean) => {
    setUseAiState(on);
    try {
      localStorage.setItem("nx-assistant-useai", on ? "1" : "0");
    } catch {
      /* noop */
    }
  }, []);

  const setAssistantName = useCallback((name: string) => {
    const clean = name.trim().slice(0, 24) || "Nexus";
    setAssistantNameState(clean);
    try {
      localStorage.setItem("nx-assistant-name", clean);
    } catch {
      /* noop */
    }
  }, []);

  // Bind the speech controller: mirror its phase into state, suspend the
  // microphone while the assistant talks (so it never transcribes itself),
  // and resume Live listening when playback drains.
  useEffect(() => {
    speechController({
      onPhase: (phase) => {
        setSpeechPhase(phase);
        if (phase === "speaking") {
          try {
            listenerRef.current?.stop();
          } catch {
            /* noop */
          }
          listenerRef.current = null;
          setListening(false);
          setInterim("");
        } else if (phase === "idle") {
          if (liveRef.current && !listenerRef.current && errorBackoff.current < 99) {
            errorBackoff.current = 0;
            startListening();
          }
        }
      },
      onError: (why) => setVoiceError(`Voice output issue (${why}). Text still works.`),
    });
  }, [speech, startListening]);

  // Full cleanup on unmount: microphone and speech must never outlive the app.
  useEffect(() => {
    return () => {
      try {
        listenerRef.current?.stop();
      } catch {
        /* noop */
      }
      speech.cancel("unmount");
    };
  }, [speech]);

  const speaking = speechPhase === "speaking";
  const speechPaused = speechPhase === "paused";
  const voicePhase: AssistantState["voicePhase"] = voiceError
    ? "error"
    : speechPhase === "speaking"
      ? "speaking"
      : speechPhase === "paused"
        ? "paused"
        : streaming
          ? "thinking"
          : listening
            ? "listening"
            : "idle";

  const value = useMemo<AssistantState>(
    () => ({
      live, setLive, drawerOpen, setDrawerOpen,
      conversationId, thread, openConversation, newConversation, recent,
      streaming, pending, error, send, note,
      scenarioId, setScenarioId, useAi, setUseAi,
      listening, interim, voiceError, talkOnce,
      speaking, speechPaused, voicePhase, stopVoice, repeatLast,
      pauseSpeech, resumeSpeech, voiceOutput, setVoiceOutput,
      assistantName, setAssistantName,
      sttSupported: support.stt, ttsSupported: support.tts, sttDetail: support.sttDetail,
      publishContext, context,
    }),
    [
      live, setLive, drawerOpen, conversationId, thread, openConversation,
      newConversation, recent, streaming, pending, error, send, note,
      scenarioId, useAi, setUseAi, listening, interim, voiceError, talkOnce,
      speaking, speechPaused, voicePhase,
      stopVoice, repeatLast, pauseSpeech, resumeSpeech,
      voiceOutput, setVoiceOutput, assistantName, setAssistantName,
      support, publishContext, context,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
