// Scene synthesizer (B2.1). Derives an animated wallpaper scene from any
// style's palette and mood — no hand-authoring, so every one of the 158
// styles gets an animated twin.

import type { SceneConfig } from "../lib/types";
import type { StyleDef } from "./types";

// kind by mood: what should this style's animation feel like?
const KIND_BY_MOOD: Record<string, string> = {
  calm: "aurora",
  focused: "parallax",
  energetic: "geometric",
  playful: "embers",
  cozy: "particles",
};

// fallback for the few styles whose mood is unset
const MOOD_ORDER: string[] = ["calm", "focused", "energetic", "playful", "cozy"];

function kindFor(s: StyleDef): string {
  // If the style already uses a scene, keep its identity.
  if (s.wallpaper.type === "scene") return s.wallpaper.sceneId;
  return KIND_BY_MOOD[s.mood] ?? "particles";
}

function moodFor(s: StyleDef): string {
  const kind = kindFor(s);
  // scenes that exist in the engine: particles | waves | geometric | parallax | aurora | stars | matrix | embers
  if (kind === "stars") return "space";
  if (kind === "waves") return "nature";
  return s.mood;
}

function colorsFor(s: StyleDef): string[] {
  const out = [s.gradient[1], s.accent_hex, s.gradient[0]];
  // dedupe, keep 3
  const uniq: string[] = [];
  for (const c of out) {
    if (!uniq.includes(c.toLowerCase())) uniq.push(c);
    if (uniq.length === 3) break;
  }
  return uniq;
}

function speedFor(s: StyleDef): number {
  if (s.sceneTweak?.speed) return s.sceneTweak.speed;
  const t = s.sceneTweak;
  const base = s.mood === "energetic" || s.mood === "playful" ? 1.1 : 0.7;
  return t ? base * (t.speed ?? 1) : base;
}

function densityFor(s: StyleDef): number {
  if (s.sceneTweak?.density) return s.sceneTweak.density;
  const t = s.sceneTweak;
  const base = s.mood === "calm" || s.mood === "cozy" ? 0.8 : 1.1;
  return t ? base * (t.density ?? 1) : base;
}

/** Full SceneConfig a style can apply — the "animated twin". */
export function sceneConfigForStyle(s: StyleDef): SceneConfig {
  const kind = kindFor(s);
  return {
    id: `${s.id}-animated`,
    name: `${s.name} (animated)`,
    kind,
    mood: moodFor(s),
    speed: Math.min(3, Math.max(0.2, speedFor(s))),
    density: Math.min(2, Math.max(0.2, densityFor(s))),
    colors: colorsFor(s),
  };
}

export function moodOptions(): string[] {
  return MOOD_ORDER;
}
