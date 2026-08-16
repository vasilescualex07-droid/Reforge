// Style Quiz v4 (ROADMAP A1.5). 18 questions, 4–5 options each, scored over
// the whole catalog. Answers steer real components — font, widgets, taskbar,
// RGB, transparency, cursor — not just a ranked list. Multi-dimensional
// scoring, top-3 results, and a "build my own style" generator.

import type { QuizAnswers, QuizDim, StyleDef } from "./types";
import { Q_DIMS } from "./types";
import { ALL_WALLPAPERS, CATEGORY_TAG } from "./wallpapers";

export interface QuizQuestion {
  q: string;
  options: { label: string; sub?: string; w: Partial<Record<QuizDim, number>> }[];
}

export const QUIZ: QuizQuestion[] = [
  {
    q: "Day or night — when does your PC feel most like yours?",
    options: [
      { label: "Bright daylight", sub: "Light themes, airy surfaces", w: { light: 3, minimal: 1, focused: 1 } },
      { label: "Deep night", sub: "Dark themes, glow in the dark", w: { dark: 3, cozy: 1 } },
      { label: "Golden hour", sub: "Warm, soft, slightly dim", w: { warm: 2, light: 1, cozy: 1, soft: 1 } },
      { label: "Starry night", sub: "Dark with tiny brights", w: { dark: 2, space: 1, cool: 1 } },
      { label: "Whatever the clock says", sub: "Follow system mode", w: { neutral: 2, minimal: 1 } },
    ],
  },
  {
    q: "Pick the palette that instantly calms you",
    options: [
      { label: "Ocean blues", sub: "Deep and cool", w: { cool: 3, calm: 2 } },
      { label: "Ember oranges", sub: "Warm and soft", w: { warm: 3, cozy: 1, soft: 1 } },
      { label: "Forest greens", sub: "Organic and quiet", w: { nature: 3, calm: 1 } },
      { label: "Clean grays", sub: "Near monochrome", w: { neutral: 3, mono: 2, minimal: 2, focused: 1 } },
      { label: "Electric color", sub: "Loud and alive", w: { vivid: 3, bold: 1, energetic: 1 } },
    ],
  },
  {
    q: "When you sit down to work, you want to feel…",
    options: [
      { label: "Focused and quiet", sub: "Nothing competes with you", w: { focused: 3, minimal: 2, calm: 1 } },
      { label: "Energized and alive", sub: "The desk hums along", w: { energetic: 3, gaming: 1, bold: 1 } },
      { label: "Cozy and warm", sub: "Like a soft lamp", w: { cozy: 3, warm: 1 } },
      { label: "Inspired and dreamy", sub: "A little escape", w: { space: 2, calm: 1, abstract: 1 } },
      { label: "Sharp and tactical", sub: "Mission control", w: { focused: 2, mono: 2, minimal: 1, gaming: 1 } },
    ],
  },
  {
    q: "Your desk looks like…",
    options: [
      { label: "Clean, minimal, zen", sub: "One pen, one mug", w: { minimal: 3, neutral: 1, focused: 1 } },
      { label: "Neon, RGB, alive", sub: "Every surface glows", w: { gaming: 3, vivid: 2, energetic: 1, bold: 1 } },
      { label: "Warm wood and plants", sub: "Organic materials", w: { nature: 2, cozy: 2, warm: 1 } },
      { label: "Pinned photos and memories", sub: "It tells a story", w: { cozy: 2, warm: 1, soft: 1 } },
      { label: "Cables hidden, tools out", sub: "Everything has a place", w: { focused: 2, minimal: 1, neutral: 1 } },
    ],
  },
  {
    q: "What kind of wallpaper would make you stop and stare?",
    options: [
      { label: "A living aurora", sub: "Slow, colorful, moving", w: { space: 2, cool: 1, calm: 1, motion: 2 } },
      { label: "Neon city lights", sub: "Grids and glow", w: { city: 2, gaming: 1, energetic: 1, vivid: 1 } },
      { label: "A misty forest", sub: "Still, moody, quiet", w: { nature: 3, calm: 1, soft: 1 } },
      { label: "Abstract flowing color", sub: "Pure motion art", w: { abstract: 3, energetic: 1, motion: 1 } },
      { label: "One perfect photograph", sub: "Sharp and still", w: { nature: 1, minimal: 2, focused: 1 } },
    ],
  },
  {
    q: "Choose your energy level",
    options: [
      { label: "Slow, smooth, meditative", sub: "Like a screensaver from 1998", w: { calm: 3, focused: 1, motion: 1 } },
      { label: "Brisk, creative, loud", sub: "The desk has momentum", w: { energetic: 3, bold: 1, motion: 2 } },
      { label: "Calm on the surface, sharp underneath", sub: "Still but precise", w: { focused: 2, calm: 1, minimal: 1 } },
      { label: "Completely still", sub: "Even the wallpaper holds its breath", w: { calm: 2, minimal: 2, focused: 1 } },
    ],
  },
  {
    q: "Your accent color does all the talking. Pick yours",
    options: [
      { label: "Electric indigo", sub: "Bold, unmistakable", w: { cool: 2, bold: 2, abstract: 1, gaming: 1 } },
      { label: "Warm tangerine", sub: "Friendly and bright", w: { warm: 3, cozy: 1 } },
      { label: "Deep teal", sub: "Cool and steady", w: { cool: 2, nature: 1, calm: 1 } },
      { label: "Neutral slate", sub: "Recedes, lets work lead", w: { neutral: 3, minimal: 2, mono: 1 } },
      { label: "Pastel mint", sub: "Soft, gentle, easy", w: { soft: 3, cool: 1, calm: 1, nature: 1 } },
    ],
  },
  {
    q: "Movies, games, or sky-watching?",
    options: [
      { label: "Sci-fi and space operas", sub: "Vast and cool", w: { space: 3, cool: 1 } },
      { label: "Action and racing", sub: "Loud and fast", w: { energetic: 2, gaming: 2, city: 1, bold: 1 } },
      { label: "Nature documentaries", sub: "Slow and grounded", w: { nature: 3, calm: 1 } },
      { label: "Minimalist art films", sub: "Composition over noise", w: { minimal: 2, neutral: 1, mono: 1 } },
      { label: "Cyberpunk thrillers", sub: "Neon everything", w: { city: 2, gaming: 2, vivid: 2, bold: 1 } },
    ],
  },
  {
    q: "How much should your PC move?",
    options: [
      { label: "Keep it still", sub: "I hate distractions", w: { focused: 2, calm: 1, minimal: 1 } },
      { label: "Gentle motion is nice", sub: "Subtle and slow", w: { calm: 2, nature: 1, motion: 1 } },
      { label: "Make it dance", sub: "The wallpaper is the show", w: { energetic: 3, gaming: 1, motion: 3 } },
      { label: "Live video background", sub: "Real footage, always on", w: { motion: 3, energetic: 1, gaming: 1 } },
      { label: "Motion only when I hover", sub: "Surprise on demand", w: { calm: 1, focused: 1, motion: 1, minimal: 1 } },
    ],
  },
  {
    q: "Your ideal vibe in one word",
    options: [
      { label: "Retro", sub: "Synthwave, warm, faded", w: { retro: 3, warm: 1, abstract: 1 } },
      { label: "Serene", sub: "Still water and fog", w: { calm: 3, nature: 1, minimal: 1 } },
      { label: "Bold", sub: "Confident and loud", w: { bold: 3, energetic: 2, gaming: 1, vivid: 1 } },
      { label: "Tidy", sub: "Everything in its place", w: { minimal: 3, focused: 1, neutral: 1 } },
      { label: "Dreamy", sub: "Soft edges, pastel glow", w: { soft: 3, cozy: 1, space: 1 } },
    ],
  },
  {
    q: "Pick a place to escape to",
    options: [
      { label: "A beach at dusk", sub: "Warm light, cool water", w: { warm: 2, nature: 1, calm: 1, soft: 1 } },
      { label: "A neon megacity", sub: "Bright, sleepless, alive", w: { city: 3, gaming: 1, energetic: 1, bold: 1 } },
      { label: "A quiet cabin in the woods", sub: "Fire, wood, silence", w: { cozy: 3, nature: 1, warm: 1 } },
      { label: "Deep space", sub: "Dark, vast, cool", w: { space: 3, cool: 1 } },
      { label: "A white studio", sub: "Clean light, no noise", w: { minimal: 3, light: 2, focused: 1 } },
    ],
  },
  {
    q: "How many widgets do you actually want?",
    options: [
      { label: "None — clean desktop", sub: "Widgets are noise", w: { widgets: 0, minimal: 2, focused: 1 } },
      { label: "Just a clock", sub: "One glance, that's it", w: { widgets: 1, minimal: 1 } },
      { label: "Clock and system stats", sub: "Time, CPU, RAM", w: { widgets: 2, focused: 1, gaming: 1 } },
      { label: "Give me everything", sub: "Clock, stats, to-dos", w: { widgets: 3, energetic: 1 } },
    ],
  },
  {
    q: "Pick your font personality",
    options: [
      { label: "Crisp and clean", sub: "Segoe UI, the classic", w: { minimal: 1, focused: 1 } },
      { label: "Monospace terminal", sub: "Consolas, hacker chic", w: { mono: 3, gaming: 1, focused: 1 } },
      { label: "Round and friendly", sub: "Soft curves, approachable", w: { soft: 2, playful: 2, cozy: 1 } },
      { label: "Bold and heavy", sub: "Type that thumps", w: { bold: 3, energetic: 1, gaming: 1 } },
    ],
  },
  {
    q: "What should the taskbar do?",
    options: [
      { label: "Small, tucked left", sub: "Out of the way", w: { minimal: 2, focused: 2 } },
      { label: "Centered, medium", sub: "Balanced and calm", w: { calm: 1, neutral: 1 } },
      { label: "Big and centered", sub: "Easy targets, bold presence", w: { bold: 1, energetic: 1, widgets: 1 } },
      { label: "Hide it entirely", sub: "Maximum screen space", w: { minimal: 3, focused: 2 } },
      { label: "Color-matched to wallpaper", sub: "It disappears into the art", w: { abstract: 1, gaming: 1, vivid: 1 } },
    ],
  },
  {
    q: "Pick the color treatment that feels right",
    options: [
      { label: "Vivid punch", sub: "Saturated, unmistakable", w: { vivid: 3, bold: 2, energetic: 1 } },
      { label: "Muted and earthy", sub: "Desaturated, gentle", w: { soft: 3, warm: 1, calm: 1 } },
      { label: "Pastel dream", sub: "Light, airy, delicate", w: { soft: 2, light: 1, cozy: 1 } },
      { label: "Near monochrome", sub: "One color, many grays", w: { mono: 3, minimal: 2, neutral: 1 } },
      { label: "High contrast", sub: "Blacks and whites, sharp", w: { bold: 2, mono: 1, focused: 1 } },
    ],
  },
  {
    q: "Your peripherals — what's the lighting plan?",
    options: [
      { label: "Sync to the accent", sub: "Keyboard and desk match the style", w: { gaming: 2, vivid: 2, bold: 1 } },
      { label: "Subtle glow", sub: "One soft color, low brightness", w: { cool: 1, calm: 1 } },
      { label: "Rainbow everything", sub: "It cycles, it breathes", w: { gaming: 3, energetic: 1, bold: 1 } },
      { label: "No RGB at all", sub: "Peripherals stay stock", w: { minimal: 2, focused: 1 } },
    ],
  },
  {
    q: "First coffee of the day — what's the scene?",
    options: [
      { label: "Sun coming through the window", sub: "Bright, optimistic", w: { light: 2, warm: 2, cozy: 1 } },
      { label: "Rain on the glass, dark room", sub: "Cozy and quiet", w: { dark: 2, cozy: 2, calm: 1, soft: 1 } },
      { label: "Launch the mission", sub: "Terminal, code, focus", w: { focused: 2, mono: 2, dark: 1 } },
      { label: "Fire up the rig", sub: "Games before emails", w: { gaming: 3, energetic: 2, bold: 1 } },
    ],
  },
  {
    q: "Last one — what should your PC say about you?",
    options: [
      { label: "I make beautiful things", sub: "Color, form, mood", w: { abstract: 2, energetic: 1, retro: 1, bold: 1 } },
      { label: "I get things done", sub: "Calm, sharp, efficient", w: { focused: 3, minimal: 2, neutral: 1 } },
      { label: "I'm always gaming", sub: "RGB and neon on standby", w: { gaming: 3, energetic: 1, bold: 1, vivid: 1 } },
      { label: "I notice the little things", sub: "Soft details, warm light", w: { nature: 2, cozy: 1, calm: 1, soft: 1 } },
    ],
  },
];

export function mergeAnswers(answers: QuizAnswers, q: QuizQuestion, optIdx: number): QuizAnswers {
  const next = { ...answers };
  for (const [dim, w] of Object.entries(q.options[optIdx].w)) {
    next[dim as QuizDim] = (next[dim as QuizDim] ?? 0) + (w ?? 0);
  }
  return next;
}

/** Dot-product ranking of every style against the answers. */
export function scoreStyle(style: StyleDef, answers: QuizAnswers): number {
  let score = 0;
  for (const d of Q_DIMS) {
    score += (answers[d] ?? 0) * (style.quiz[d] ?? 0);
  }
  return score;
}

export function rankStyles(styles: StyleDef[], answers: QuizAnswers): StyleDef[] {
  return [...styles].sort((a, b) => scoreStyle(b, answers) - scoreStyle(a, answers));
}

// ---------------------------------------------------------------------------
// "Build my own style" — synthesize a style from the answers (C1.16, A1.5).
// Answers change components, not just rankings: font, widgets, taskbar,
// transparency, cursor, RGB intent and lock screen all respond to the quiz.
// ---------------------------------------------------------------------------

const HUE_ACCENTS: Record<string, string> = {
  warm: "#D9822B",
  cool: "#0C8599",
  neutral: "#4A5568",
};

/** Blend two hex colors; t=1 is fully target. */
function mix(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return `#${c.map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

/** Soft answers pull the accent toward neutral; vivid answers keep it loud. */
function tuneAccent(hex: string, answers: QuizAnswers): string {
  const softness = (answers.soft ?? 0) - (answers.vivid ?? 0);
  if (softness >= 2) return mix(hex, "#8A8A8A", 0.42);
  if ((answers.bold ?? 0) >= 3) return mix(hex, "#000000", 0.12); // deepen for presence
  return hex;
}

function pickWallpaper(answers: QuizAnswers, wantLive: boolean): (typeof ALL_WALLPAPERS)[number] | null {
  const vibe = pickTag(answers);
  const pool = ALL_WALLPAPERS.filter((w) => w.type === (wantLive ? "live" : "static"));
  const tagged = pool.filter((w) => CATEGORY_TAG[w.category] === vibe);
  const source = (tagged.length ? tagged : pool)[0];
  return source ?? null;
}

function pickTag(answers: QuizAnswers): string {
  const map: [QuizDim, string][] = [
    ["gaming", "gaming"],
    ["space", "space"],
    ["city", "city"],
    ["nature", "nature"],
    ["cozy", "cozy"],
    ["retro", "abstract"],
    ["abstract", "abstract"],
    ["minimal", "minimal"],
  ];
  let best: [string, number] = ["minimal", -1];
  for (const [dim, tag] of map) {
    const v = answers[dim] ?? 0;
    if (v > best[1]) best = [tag, v];
  }
  return best[0];
}

export function buildMyStyle(answers: QuizAnswers): StyleDef {
  const dark = (answers.dark ?? 0) > (answers.light ?? 0);
  const hue: "warm" | "cool" | "neutral" =
    (answers.warm ?? 0) > (answers.cool ?? 0) && (answers.warm ?? 0) > (answers.neutral ?? 0)
      ? "warm"
      : (answers.cool ?? 0) > (answers.warm ?? 0)
        ? "cool"
        : "neutral";
  const energy = Math.min(1, Math.max(0, (answers.energetic ?? 0) / Math.max(1, (answers.energetic ?? 0) + (answers.calm ?? 0))));
  const wantLive = (answers.motion ?? 0) > (answers.calm ?? 0);
  const wp = pickWallpaper(answers, wantLive);
  const vibe = pickTag(answers);
  const accent = tuneAccent(HUE_ACCENTS[hue], answers);
  const sceneKind = wantLive ? (vibe === "nature" ? "particles" : vibe === "space" ? "stars" : "waves") : "particles";

  // component decisions (A1.5)
  const minimalFocus = (answers.focused ?? 0) >= 3 && (answers.minimal ?? 0) >= 2;
  const wCount = Math.min(3, Math.max(0, answers.widgets ?? 0));
  const widgets = wCount === 0 ? [] : wCount === 1 ? ["clock"] : wCount === 2 ? ["clock", "stats"] : ["clock", "stats", "todo"];
  const taskbar = minimalFocus
    ? { size: "small" as const, alignment: "left" as const }
    : wCount >= 2 || energy > 0.6
      ? { size: "large" as const, alignment: "center" as const, color_match: true }
      : { size: "medium" as const, alignment: "center" as const };
  const mono = (answers.mono ?? 0) >= 3;

  return {
    id: "my-style",
    name: "Your personal style",
    tagline: "Generated from your answers",
    description: `Built from your vibe — ${hue} palette, ${dark ? "dark" : "light"} mode, ${
      wantLive ? "a living wallpaper" : "a calm static wallpaper"
    }, ${wCount === 0 ? "no widgets" : `${widgets.length} suggested widget${widgets.length > 1 ? "s" : ""}`}, ${
      mono ? "monospace type" : "the default UI font"
    }. Fine-tune anything in Makeover and it stays one-click revertible.`,
    category: "Personal",
    mood: energy > 0.6 ? "energetic" : "calm",
    mode: dark ? "dark" : "light",
    accent_hex: accent,
    gradient: dark ? [shade(accent, -60), shade(accent, 10)] : [shade(accent, 40), shade(accent, -20)],
    wallpaper: wp ? { type: wp.type, id: wp.id } : { type: "scene", sceneId: sceneKind },
    sceneTweak: { speed: 0.6 + energy * 0.9, density: 0.8 + energy * 0.6 },
    transparency: !minimalFocus,
    taskbar,
    cursor: mono ? "black" : "aero",
    lock_screen: { mode: (answers.warm ?? 0) >= 2 && (answers.cozy ?? 0) >= 2 ? "image" : "spotlight" },
    font: mono ? "Consolas" : undefined,
    rgb: (answers.gaming ?? 0) >= 2 && (answers.vivid ?? 0) >= 2 ? "accent-sync" : undefined,
    widgets,
    tags: [vibe, hue, dark ? "dark" : "light"],
    quiz: {},
    generated: true,
    wallpaperName: wp?.name,
    tier: "personal",
  };
}

function shade(hex: string, amt: number): string {
  const h = hex.replace("#", "");
  if (h.length !== 6) return hex;
  const n = (i: number) => Math.min(255, Math.max(0, parseInt(h.slice(i, i + 2), 16) + amt));
  return `#${[n(0), n(2), n(4)].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}
