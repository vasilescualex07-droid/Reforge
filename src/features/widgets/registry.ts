// The Widget Hub catalog (spec §1, §8). Every widget is one entry here:
// name, one-line description, kind (on-demand / ambient / persistent),
// category, config defaults + schema (for the hub's expandable mini-config),
// and the behavior functions (trigger for on-demand, start/stop for ambient
// and persistent). The runtime walks this list to start/stop listeners on
// toggle and to route hotkeys/buttons to triggers.
import type { WidgetCtx } from "./types";
// S7.8 — the effect modules are dynamic-imported on first use, so an idle
// widget engine never pays for the confetti cannon's code. Only the constants
// (tiny) stay in the bundle; the registry itself is just metadata + wiring.
import {
  BSOD_DEFAULT_HOTKEY,
  BOSS_DEFAULT_HOTKEY,
  CONFETTI_DEFAULT_HOTKEY,
  FIRE_DURATION_S,
  FIRE_THRESHOLD,
  GLITCH_DEFAULT_HOTKEY,
  RAGE_DEFAULT_HOTKEY,
  ROAST_MINUTES,
  SMASH_RATE_THRESHOLD,
} from "./constants";

type Trigger = (ctx: WidgetCtx) => void | Promise<void>;
type Start = (ctx: WidgetCtx) => (() => void) | Promise<() => void>;

/** On-demand payoff — the module loads on the first fire, then runs. */
function lazyTrigger<T>(loader: () => Promise<T>, run: (m: T) => void): Trigger {
  return () => {
    void loader().then((m) => {
      try {
        run(m);
      } catch {
        /* a failing trigger must not break hotkey dispatch */
      }
    });
  };
}

/** Ambient/persistent start — the module loads on the first enable. */
function lazyStart<T>(loader: () => Promise<T>, run: (m: T) => () => void): Start {
  return () => loader().then((m) => run(m));
}

export interface ConfigField {
  key: string;
  label: string;
  type: "number" | "text" | "select" | "toggle" | "hotkey";
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
  placeholder?: string;
  hint?: string;
}

export interface WidgetDef {
  id: string;
  name: string;
  desc: string;
  kind: "on-demand" | "ambient" | "persistent";
  category: "prank" | "celebration" | "ambient" | "utility" | "interactive";
  defaults: Record<string, unknown>;
  fields?: ConfigField[];
  /** Trigger label shown on the card for on-demand widgets. */
  triggerLabel?: string;
  /** On-demand: fire the payoff (button or global hotkey). Effect modules are
   *  dynamic-imported on first fire, so this may resolve asynchronously. */
  trigger?: (ctx: WidgetCtx) => void | Promise<void>;
  /** Ambient/persistent: start listeners/overlays → returns the stop fn. The
   *  module may load lazily, so the stop fn can arrive asynchronously. */
  start?: (ctx: WidgetCtx) => (() => void) | Promise<() => void>;
  /** Persistent overlay widgets (whip, pet) are also closed on disable via
   *  their stop fn; this flag marks them so the hub can show "active" state. */
  persistentOverlay?: boolean;
}

export const WIDGETS: WidgetDef[] = [
  {
    id: "whip",
    name: "Whip Cracker",
    desc: "The classic: grab the handle, swing, and crack. Verlet physics, voice lines, milestone stamps.",
    kind: "persistent",
    category: "interactive",
    defaults: { profile: "bullwhip", theme: "midnight" },
    fields: [
      {
        key: "profile",
        label: "Whip",
        type: "select",
        options: [
          { value: "bullwhip", label: "Classic Bullwhip" },
          { value: "snakewhip", label: "Snakewhip" },
          { value: "stockwhip", label: "Stockwhip" },
        ],
      },
      {
        key: "theme",
        label: "Theme",
        type: "select",
        options: [
          { value: "midnight", label: "Midnight" },
          { value: "ember", label: "Ember" },
          { value: "frost", label: "Frost" },
          { value: "toxic", label: "Toxic" },
        ],
      },
    ],
    persistentOverlay: true,
    start: lazyStart(() => import("./whip"), (m) => {
      m.startWhip();
      return () => m.stopWhip();
    }),
  },
  {
    id: "rage",
    name: "Rage Shatter",
    desc: "Shatters your actual screen into shards that fall away. Nothing is really touched.",
    kind: "on-demand",
    category: "prank",
    defaults: { hotkey: RAGE_DEFAULT_HOTKEY },
    fields: [{ key: "hotkey", label: "Hotkey", type: "hotkey" }],
    triggerLabel: "Shatter",
    trigger: lazyTrigger(() => import("./rage"), (m) => {
      void m.triggerRage();
    }),
  },
  {
    id: "confetti",
    name: "Confetti Cannon",
    desc: "A celebratory burst on demand — and it auto-fires when a cleanup or maintenance run finishes.",
    kind: "on-demand",
    category: "celebration",
    defaults: { hotkey: CONFETTI_DEFAULT_HOTKEY },
    fields: [{ key: "hotkey", label: "Hotkey", type: "hotkey" }],
    triggerLabel: "Fire confetti",
    trigger: lazyTrigger(() => import("./confetti"), (m) => m.triggerConfetti()),
  },
  {
    id: "bsod",
    name: "Fake BSOD",
    desc: "A blue screen of death parody with made-up codes. Prank someone at their desk.",
    kind: "on-demand",
    category: "prank",
    defaults: { hotkey: BSOD_DEFAULT_HOTKEY },
    fields: [{ key: "hotkey", label: "Hotkey", type: "hotkey" }],
    triggerLabel: "Summon",
    trigger: lazyTrigger(() => import("./bsod"), (m) => m.triggerBsod()),
  },
  {
    id: "boss",
    name: "Boss Key",
    desc: "One hotkey instantly covers the screen with a boring fake spreadsheet. Same hotkey toggles it off.",
    kind: "on-demand",
    category: "utility",
    defaults: { hotkey: BOSS_DEFAULT_HOTKEY },
    fields: [{ key: "hotkey", label: "Hotkey", type: "hotkey" }],
    triggerLabel: "Toggle cover",
    trigger: lazyTrigger(() => import("./boss"), (m) => m.triggerBoss()),
  },
  {
    id: "certificate",
    name: "Procrastination Certificate",
    desc: "An ornate certificate of your real session stats. Save it as a PNG to share.",
    kind: "on-demand",
    category: "utility",
    defaults: { name: "Valued Procrastinator" },
    fields: [{ key: "name", label: "Name on certificate", type: "text", placeholder: "Valued Procrastinator" }],
    triggerLabel: "Print certificate",
    trigger: lazyTrigger(() => import("./certificate"), (m) => {
      void m.triggerCertificate();
    }),
  },
  {
    id: "fire",
    name: "CPU Fire Alarm",
    desc: "A cartoon fire + siren when your CPU stays hot. Sustained over the threshold, not a spike.",
    kind: "ambient",
    category: "ambient",
    defaults: { threshold: FIRE_THRESHOLD, duration: FIRE_DURATION_S, cooldown: 20 },
    fields: [
      { key: "threshold", label: "CPU threshold (%)", type: "number", min: 50, max: 99, step: 1, hint: "Sustained CPU above this" },
      { key: "duration", label: "Sustained for (s)", type: "number", min: 1, max: 30, step: 1, hint: "How long it must stay hot" },
      { key: "cooldown", label: "Cooldown (s)", type: "number", min: 5, max: 300, step: 5 },
    ],
    start: lazyStart(() => import("./fire"), (m) => m.startFire()),
  },
  {
    id: "roast",
    name: "Idle Roast",
    desc: "A friendly mascot drops playful one-liners when you've been idle too long.",
    kind: "ambient",
    category: "ambient",
    defaults: { minutes: ROAST_MINUTES },
    fields: [{ key: "minutes", label: "Idle before roasting (min)", type: "number", min: 1, max: 120, step: 1 }],
    start: lazyStart(() => import("./roast"), (m) => m.startRoast()),
  },
  {
    id: "smash",
    name: "Keyboard Smash Detector",
    desc: "If you hammer the keys, a mock-concerned popup asks if you're okay. Measures timing only — never which keys.",
    kind: "ambient",
    category: "ambient",
    defaults: { rate: SMASH_RATE_THRESHOLD, cooldown: 8000 },
    fields: [
      { key: "rate", label: "Keydowns per 2s", type: "number", min: 4, max: 40, step: 1, hint: "Rate that counts as a smash" },
      { key: "cooldown", label: "Cooldown (ms)", type: "number", min: 2000, max: 60000, step: 1000 },
    ],
    start: lazyStart(() => import("./smash"), (m) => m.startSmash()),
  },
  {
    id: "pet",
    name: "Desktop Pet Companion",
    desc: "A little creature that wanders the corner of your screen and reacts to clicks (and to your other widgets).",
    kind: "persistent",
    category: "interactive",
    defaults: {},
    persistentOverlay: true,
    start: lazyStart(() => import("./pet"), (m) => m.startPet()),
  },
  {
    id: "glitch",
    name: "Glitch Jumpscare",
    desc: "Your real screen glitches out for a split second. Manual by default — surprise mode is off until you opt in.",
    kind: "on-demand",
    category: "prank",
    defaults: { hotkey: GLITCH_DEFAULT_HOTKEY, random_mode: false, random_minutes: 5 },
    fields: [
      { key: "hotkey", label: "Hotkey", type: "hotkey" },
      { key: "random_mode", label: "Random surprise mode", type: "toggle", hint: "Off by default — a screen glitching itself during a call is a bad time" },
      { key: "random_minutes", label: "Random every (min)", type: "number", min: 1, max: 120, step: 1 },
    ],
    triggerLabel: "Glitch",
    trigger: lazyTrigger(() => import("./glitch"), (m) => {
      void m.triggerGlitch();
    }),
    start: lazyStart(() => import("./glitch"), (m) => m.startGlitch()),
  },
  {
    id: "achievements",
    name: "Achievement Popper",
    desc: "Xbox-style toasts when you hit real milestones — uptime, cleanups, force-quits, and your widget antics.",
    kind: "ambient",
    category: "celebration",
    defaults: {},
    start: () => {
      // the periodic check lives in the runtime; this widget just needs to be
      // "on" for the engine to run. No per-widget listeners.
      return () => {};
    },
  },
];

export function getWidget(id: string): WidgetDef | undefined {
  return WIDGETS.find((w) => w.id === id);
}

/** Cross-widget pet reactions (spec §6 stretch): cower/celebrate. The pet
 *  module loads lazily like every other effect (S7.8). */
export function petReactionFor(triggerId: string, petEnabled: boolean): void {
  if (!petEnabled) return;
  if (triggerId === "rage" || triggerId === "glitch") {
    void import("./pet").then((m) => m.petReact("cower"));
  } else if (triggerId === "confetti") {
    void import("./pet").then((m) => m.petReact("celebrate"));
  }
}
