"use client";

/* Reliable speech-output controller for the global assistant.
   Replaces one-shot synth.speak() calls, which truncated long replies
   (1200-char slice + single utterance) and were cancelled by unrelated
   listen restarts. This controller owns an explicit playback state machine:

     idle -> speaking -> idle        (queue drains naturally)
     speaking -> paused -> speaking  (explicit pause/resume)
     * -> idle                       (explicit cancel: user stop, barge-in,
                                      new response, live-off, unmount)

   Text is segmented at sentence boundaries into individually queued
   utterances whose references are retained (Chrome drops onend callbacks
   for garbage-collected utterances). Streaming replies feed pushText() as
   deltas arrive; finishStream() flushes the final partial sentence, and
   completion is reported only when the queue drains AND the stream ended —
   text generation finishing never marks speech complete by itself. */

export type SpeechPhase = "idle" | "speaking" | "paused" | "error";

export type CancelReason =
  | "user-stop"
  | "barge-in"
  | "new-response"
  | "live-off"
  | "voice-off"
  | "unmount";

export interface SpeechEvents {
  onPhase?: (phase: SpeechPhase) => void;
  /** Every segment handed to the synthesizer, in order (observability/tests). */
  onSegment?: (segment: string, index: number) => void;
  /** Final completion: { spoken, reason }. reason is "drained" on success. */
  onDone?: (info: { spoken: number; reason: string }) => void;
  onError?: (why: string) => void;
}

const ABBREV = /\b(?:e\.g|i\.e|vs|mr|mrs|ms|dr|no|fig|approx|est)\.$/i;

/** Clean markdown/noise so a segment sounds natural when spoken. */
export function speakableSegment(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/[_*`]/g, "")
    .replace(/→/g, " to ")
    .replace(/·/g, ",")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Split text into speakable sentence-boundary segments. */
export function segmentSpeech(text: string): string[] {
  const clean = text.replace(/\n{2,}/g, "\n").trim();
  if (!clean) return [];
  const parts = clean.split(/(?<=[.!?])\s+|\n+/);
  const merged: string[] = [];
  for (const part of parts) {
    const prev = merged[merged.length - 1];
    if (prev && ABBREV.test(prev) && part) {
      merged[merged.length - 1] = `${prev} ${part}`;
    } else if (part.trim()) {
      merged.push(part.trim());
    }
  }
  // Keep utterances short enough for browser synthesizers: split very long
  // segments at clause boundaries (commas/semicolons/colons).
  const out: string[] = [];
  for (const seg of merged) {
    if (seg.length <= 280) {
      out.push(seg);
      continue;
    }
    const clauses = seg.split(/(?<=[:;,])\s+/);
    let acc = "";
    for (const clause of clauses) {
      if ((acc + " " + clause).trim().length > 280 && acc) {
        out.push(acc.trim());
        acc = clause;
      } else {
        acc = `${acc} ${clause}`.trim();
      }
    }
    if (acc.trim()) out.push(acc.trim());
  }
  return out.map(speakableSegment).filter(Boolean);
}

interface QueuedUtterance {
  text: string;
  utter: SpeechSynthesisUtterance;
}

function getSynth(): SpeechSynthesis | null {
  if (typeof window === "undefined") return null;
  const synth = (window as unknown as Record<string, unknown>).speechSynthesis;
  return synth && typeof synth === "object" ? (synth as SpeechSynthesis) : null;
}

export function ttsSupported(): boolean {
  return getSynth() !== null;
}

export class SpeechController {
  private events: SpeechEvents;
  private phase: SpeechPhase = "idle";
  private queue: QueuedUtterance[] = [];
  private active: QueuedUtterance | null = null;
  private streamOpen = false;
  private streamBuffer = "";
  private segmentIndex = 0;
  private lastFullText = "";
  private resumeTimer: number | null = null;
  private voicesReady = false;
  readonly log: { t: number; event: string }[] = [];

  constructor(events: SpeechEvents = {}) {
    this.events = events;
    const synth = getSynth();
    if (synth) {
      const mark = () => {
        try {
          if (synth.getVoices().length > 0) this.voicesReady = true;
        } catch {
          /* unavailable */
        }
      };
      mark();
      try {
        synth.onvoiceschanged = mark;
      } catch {
        /* read-only in some profiles */
      }
    }
  }

  getPhase(): SpeechPhase {
    return this.phase;
  }

  getLastText(): string {
    return this.lastFullText;
  }

  private trace(event: string) {
    this.log.push({ t: Date.now(), event });
    if (this.log.length > 200) this.log.splice(0, this.log.length - 200);
  }

  private setPhase(phase: SpeechPhase) {
    if (this.phase === phase) return;
    this.phase = phase;
    this.trace(`phase:${phase}`);
    this.mirror();
    this.events.onPhase?.(phase);
  }

  /** Test/debug mirror: current phase, segments handed to the synth in
   *  order, and the recent event trace. Read-only from outside. */
  private mirror(): void {
    try {
      (window as unknown as Record<string, unknown>).__nxSpeech = {
        phase: this.phase,
        segments: this.log
          .filter((e) => e.event.startsWith("enqueued:"))
          .map((e) => e.event),
        segmentCount: this.segmentIndex,
        queue: this.queue.length + (this.active ? 1 : 0),
        events: this.log.slice(-40).map((e) => e.event),
      };
    } catch {
      /* non-browser or frozen */
    }
  }

  private pickVoice(synth: SpeechSynthesis): SpeechSynthesisVoice | null {
    const voices = synth.getVoices();
    if (!voices.length) return null;
    return (
      voices.find((v) => v.default && v.lang.startsWith("en")) ??
      voices.find((v) => v.lang.startsWith("en")) ??
      voices[0]
    );
  }

  /** Speak one complete reply immediately (cancels nothing implicitly —
   *  callers cancel deliberately first when replacing speech). */
  speakFull(text: string): boolean {
    if (!ttsSupported()) {
      this.events.onError?.("tts-unsupported");
      return false;
    }
    const segments = segmentSpeech(text);
    if (!segments.length) return false;
    this.lastFullText = text;
    this.streamOpen = false;
    this.streamBuffer = "";
    this.enqueue(segments);
    return true;
  }

  /** Begin a streaming reply: deltas arrive via pushText, then finishStream. */
  beginStream(): void {
    this.streamOpen = true;
    this.streamBuffer = "";
  }

  pushText(delta: string): void {
    if (!this.streamOpen) return;
    this.streamBuffer += delta;
    // Flush complete sentences; keep the trailing partial in the buffer.
    const sentences = segmentSpeech(this.streamBuffer);
    const trailingPartial =
      /[A-Za-z0-9)"'\]]\s*$/.test(this.streamBuffer) &&
      !/[.!?]\s*$/.test(this.streamBuffer.trimEnd());
    const ready = trailingPartial ? sentences.slice(0, -1) : sentences;
    if (!ready.length) return;
    // Drop the flushed prefix from the buffer (segments are cleaned, so
    // re-derive by length on the raw buffer conservatively: keep the last
    // raw sentence fragment).
    const rawParts = this.streamBuffer.split(/(?<=[.!?])\s+|\n+/);
    this.streamBuffer = trailingPartial ? (rawParts[rawParts.length - 1] ?? "") : "";
    if (ttsSupported() && ready.length) {
      this.lastFullText += (this.lastFullText ? " " : "") + ready.join(" ");
      this.enqueue(ready);
    }
  }

  finishStream(): void {
    this.streamOpen = false;
    const tail = segmentSpeech(this.streamBuffer);
    this.streamBuffer = "";
    if (tail.length && ttsSupported()) {
      this.lastFullText += (this.lastFullText ? " " : "") + tail.join(" ");
      this.enqueue(tail);
    }
    this.trace(`stream-finished:queued=${this.queue.length + (this.active ? 1 : 0)}`);
    this.maybeDone();
  }

  repeat(): boolean {
    if (!this.lastFullText || !ttsSupported()) return false;
    this.cancel("user-stop");
    return this.speakFull(this.lastFullText);
  }

  pause(): void {
    const synth = getSynth();
    if (!synth || this.phase !== "speaking") return;
    try {
      synth.pause();
      this.setPhase("paused");
    } catch {
      /* unsupported */
    }
  }

  resume(): void {
    const synth = getSynth();
    if (!synth || this.phase !== "paused") return;
    try {
      synth.resume();
      this.setPhase("speaking");
    } catch {
      /* unsupported */
    }
  }

  cancel(reason: CancelReason): void {
    this.trace(`cancel:${reason}`);
    this.queue = [];
    this.active = null;
    this.streamOpen = false;
    this.streamBuffer = "";
    this.stopResumeTimer();
    try {
      getSynth()?.cancel();
    } catch {
      /* noop */
    }
    this.setPhase("idle");
    this.mirror();
    this.events.onDone?.({ spoken: this.segmentIndex, reason: `cancelled:${reason}` });
  }

  private enqueue(segments: string[]): void {
    const synth = getSynth();
    if (!synth) return;
    for (const text of segments) {
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = 1.05;
      const voice = this.pickVoice(synth);
      if (voice) utter.voice = voice;
      const item: QueuedUtterance = { text, utter };
      utter.onstart = () => {
        if (this.active === item) {
          this.setPhase("speaking");
          this.startResumeTimer();
        }
      };
      utter.onend = () => this.advance(item, "end");
      utter.onerror = () => this.advance(item, "utter-error");
      this.queue.push(item);
      this.events.onSegment?.(text, this.segmentIndex++);
    }
    this.trace(`enqueued:${segments.length}`);
    this.mirror();
    this.pump();
  }

  private pump(): void {
    if (this.active || !this.queue.length || !ttsSupported()) {
      this.maybeDone();
      return;
    }
    const synth = getSynth();
    if (!synth) {
      this.queue = [];
      this.maybeDone();
      return;
    }
    const item = this.queue[0];
    this.active = item;
    this.setPhase("speaking");
    try {
      synth.speak(item.utter);
    } catch {
      this.advance(item, "speak-threw");
    }
  }

  private advance(item: QueuedUtterance, how: string): void {
    if (this.active === item) this.active = null;
    const idx = this.queue.indexOf(item);
    if (idx >= 0) this.queue.splice(idx, 1);
    this.trace(`advanced:${how}:remaining=${this.queue.length}`);
    if (this.queue.length) {
      this.pump();
    } else {
      this.stopResumeTimer();
      this.maybeDone();
    }
  }

  private maybeDone(): void {
    if (this.active || this.queue.length || this.streamOpen) return;
    if (this.phase === "speaking" || this.phase === "paused") {
      try {
        getSynth()?.resume();
      } catch {
        /* noop */
      }
      this.setPhase("idle");
      this.events.onDone?.({ spoken: this.segmentIndex, reason: "drained" });
    }
  }

  /** Chrome pauses long synth sessions (~15 s) without firing onend; a
   *  periodic resume keeps playback alive. Cleared when the queue drains. */
  private startResumeTimer(): void {
    if (this.resumeTimer !== null) return;
    this.resumeTimer = window.setInterval(() => {
      try {
        if (this.phase === "speaking") getSynth()?.resume();
      } catch {
        /* noop */
      }
    }, 10000);
  }

  private stopResumeTimer(): void {
    if (this.resumeTimer !== null) {
      window.clearInterval(this.resumeTimer);
      this.resumeTimer = null;
    }
  }
}

/** Singleton: the provider is shell-mounted, so one controller serves all routes. */
let shared: SpeechController | null = null;

export function speechController(events?: SpeechEvents): SpeechController {
  if (!shared) shared = new SpeechController(events);
  else if (events) {
    // Rebind events (StrictMode remounts); playback state is preserved.
    (shared as unknown as { events: SpeechEvents }).events = {
      ...(shared as unknown as { events: SpeechEvents }).events,
      ...events,
    };
  }
  return shared;
}
