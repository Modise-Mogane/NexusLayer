"use client";

/* Browser speech input for the global assistant (Stage C1).
   Speech-to-text via the Web Speech API where the browser provides it;
   speech output lives in lib/speech.ts (queued playback controller).
   Everything is feature-detected; when a capability is missing the UI must
   say so and fall back to text. Raw audio is never stored — only
   transcripts the operator sends become chat messages. */

export interface VoiceSupport {
  stt: boolean;
  tts: boolean;
  sttDetail: string;
}

interface RecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: RecognitionEventLike) => void) | null;
  onerror: ((e: { error: string; message?: string }) => void) | null;
  onend: (() => void) | null;
}

interface RecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}

type RecognitionCtor = new () => RecognitionInstance;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition as RecognitionCtor | undefined) ??
    (w.webkitSpeechRecognition as RecognitionCtor | undefined) ?? null;
}

export function voiceSupport(): VoiceSupport {
  if (typeof window === "undefined") return { stt: false, tts: false, sttDetail: "server render" };
  const stt = recognitionCtor() !== null;
  const synth = (window as unknown as Record<string, unknown>).speechSynthesis;
  const tts = !!synth && typeof synth === "object";
  let sttDetail = "Web Speech API available";
  if (!stt) {
    const ua = navigator.userAgent;
    sttDetail = /Chrome|Chromium|Edge|Safari/.test(ua)
      ? "Speech recognition is blocked or unavailable in this browser profile (headless/permission)."
      : "Speech recognition is not supported by this browser. Text input works everywhere.";
  }
  return { stt, tts, sttDetail };
}

export function createListener(handlers: {
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (code: string) => void;
  onEnd: () => void;
}): { start: () => void; stop: () => void; supported: boolean } {
  const Ctor = recognitionCtor();
  if (!Ctor) return { start: () => {}, stop: () => {}, supported: false };
  const rec = new Ctor();
  rec.continuous = false;
  rec.interimResults = true;
  rec.lang = navigator.language || "en-US";
  rec.onresult = (e: RecognitionEventLike) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) handlers.onFinal(r[0].transcript);
      else interim += r[0].transcript;
    }
    if (interim) handlers.onInterim(interim);
  };
  rec.onerror = (e) => handlers.onError(e.error || "unknown");
  rec.onend = () => handlers.onEnd();
  return {
    start: () => {
      try {
        rec.start();
      } catch {
        handlers.onError("start-failed");
      }
    },
    stop: () => {
      try {
        rec.stop();
      } catch {
        /* already stopped */
      }
    },
    supported: true,
  };
}

/** Remove an optional leading wake phrase ("hey nexus, ..." / "nexus, ..."). */
export function stripWakeWord(transcript: string, name: string): { text: string; woken: boolean } {
  const escaped = name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&") || "nexus";
  const re = new RegExp(`^\\s*(?:hey[\\s,]+)?${escaped}[\\s,]+`, "i");
  const stripped = transcript.replace(re, "").trim();
  return { text: stripped || transcript.trim(), woken: stripped !== transcript.trim() };
}
