// Main-window Audio Manager (spec §3 AUDIO MANAGER).
//
// Layered Web Audio with separate gain nodes per layer (sfx / voice) and
// throttling for rapid-fire triggers (the keyboard-smash popup and roast
// stings can fire close together; a throttle map drops floods). All sounds
// come from audio-gen.js — the SAME source the overlay windows embed via
// `?raw`, loaded here by evaluating that identical string once. One set of
// sounds, one source of truth, no duplicate generators.
import audioSrc from "./audio-gen.js?raw";

type AudioApi = {
  pop(c: AudioContext, d: AudioNode, o?: { gain?: number }): void;
  whoosh(c: AudioContext, d: AudioNode, o?: { gain?: number; dur?: number }): void;
  shatter(c: AudioContext, d: AudioNode, o?: { gain?: number }): void;
  sting(c: AudioContext, d: AudioNode, o?: { gain?: number }): void;
  chime(c: AudioContext, d: AudioNode, o?: { gain?: number; notes?: number[] }): void;
  siren(
    c: AudioContext,
    d: AudioNode,
    o?: { gain?: number; speed?: number; depth?: number }
  ): { stop: (fadeMs?: number) => void };
  glitch(c: AudioContext, d: AudioNode, o?: { gain?: number; dur?: number }): void;
  flourish(c: AudioContext, d: AudioNode, o?: { gain?: number; notes?: number[] }): void;
  comedy(c: AudioContext, d: AudioNode, o?: { gain?: number; f0?: number; f1?: number }): void;
  chirp(c: AudioContext, d: AudioNode, o?: { gain?: number; f?: number }): void;
  step(c: AudioContext, d: AudioNode, o?: { gain?: number }): void;
  unlock(c: AudioContext): void;
};

let api: AudioApi | null = null;

/** Evaluate the embedded audio-gen source once; the UMD wrapper attaches
 *  itself to the window (it's the same bytes the overlays embed). */
function loadAudio(): AudioApi | null {
  if (api) return api;
  try {
    const make = new Function(audioSrc);
    make();
    api = (window as unknown as { RFAudio?: AudioApi }).RFAudio ?? null;
  } catch {
    api = null;
  }
  return api;
}

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function ensure(): { ctx: AudioContext; dest: GainNode } | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") {
    try {
      ctx.resume();
    } catch {
      /* ignore */
    }
  }
  return { ctx, dest: master! };
}

/** Throttle map: a call within `ms` of the last one is dropped. */
const throttles = new Map<string, number>();
export function withThrottle(name: string, ms: number, fn: () => void): void {
  const last = throttles.get(name) ?? -Infinity;
  const nowMs = Date.now();
  if (nowMs - last < ms) return;
  throttles.set(name, nowMs);
  fn();
}

export function unlockAudio(): void {
  ensure();
}

function play(fn: (api: AudioApi, c: AudioContext, d: GainNode) => void): void {
  const a = ensure();
  const sfx = loadAudio();
  if (!a || !sfx) return;
  try {
    fn(sfx, a.ctx, a.dest);
  } catch {
    /* a blocked or torn-down context must never throw into the widgets */
  }
}

/** Light pop — confetti auto-fire cue, toggle feedback. */
export function sfxPop(opts?: { gain?: number }): void {
  play((a, c, d) => a.pop(c, d, opts));
}

/** Cheerful unlock chime — achievement popper. */
export function sfxChime(opts?: { gain?: number; notes?: number[] }): void {
  play((a, c, d) => a.chime(c, d, opts));
}

/** Comedic two-tone sting — idle roast, keyboard smash. */
export function sfxComedy(opts?: { gain?: number }): void {
  play((a, c, d) => a.comedy(c, d, opts));
}

/** Light flourish — certificate generation. */
export function sfxFlourish(opts?: { gain?: number }): void {
  play((a, c, d) => a.flourish(c, d, opts));
}

/** Harsh error sting — BSOD (main window rarely uses this; overlays do). */
export function sfxSting(opts?: { gain?: number }): void {
  play((a, c, d) => a.sting(c, d, opts));
}
