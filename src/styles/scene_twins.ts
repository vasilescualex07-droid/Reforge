// Scene twin engine (S5). Every scene style gets deliberate twin looks — the
// same animated scene, a different design — generated only when the axis is
// honest for that scene (same philosophy as variants.ts: never forced):
//
//   vivid    — saturated accent, color-matched chrome, fuller widgets, faster.
//              Gate: the accent can carry a saturation boost (loud enough) or
//              the scene is already energetic/playful.
//   hushed   — muted accent, small taskbar, few widgets, slower.
//              Gate: the accent can survive being hushed (not fully saturated)
//              or the scene is a low-energy mood.
//   focused  — the precision twin: slowed, deeper accent, slim chrome.
//              Gate: the scene's render kind reads as precision work
//              (matrix / geometric / particles / parallax).
//   hearth   — the cozy twin: slowed to a glow, warmer accent, note widget.
//              Gate: the scene's render kind is inherently warm
//              (embers / fireflies / smoke).
//
// The accent always comes from the flagship's own palette (which the flagship
// derived from the scene's colors), so twins stay in the scene's hue family.

import type { StyleDef } from "./types";
import { SCENE_STYLES, SCENE_KINDS } from "./scene_styles";
import { shade, boostSaturation, mute, toHsl } from "./variants";

export type SceneAxis = "vivid" | "hushed" | "focused" | "hearth";

const AXIS_LABEL: Record<SceneAxis, string> = {
  vivid: "Vivid",
  hushed: "Hushed",
  focused: "Focused",
  hearth: "Hearth",
};

/** Scene kinds that honestly read as precision work → the focused twin. */
const FOCUSED_KINDS = new Set(["matrix", "geometric", "particles", "parallax"]);
/** Scene kinds that are inherently warm → the hearth twin. */
const HEARTH_KINDS = new Set(["embers", "fireflies", "smoke"]);

/** Which twin axes are honest for this scene style — never forced. */
export function axesForScene(s: StyleDef): SceneAxis[] {
  const kind = s.wallpaper.type === "scene" ? (SCENE_KINDS[s.wallpaper.sceneId] ?? "") : "";
  const [, sat] = toHsl(s.accent_hex);
  const energetic = s.mood === "energetic" || s.mood === "playful";
  const lowEnergy = s.mood === "calm" || s.mood === "focused" || s.mood === "cozy";
  const out: SceneAxis[] = [];
  if (sat >= 0.45 || energetic) out.push("vivid");
  // Never emit a hushed twin for a style that is already a hushed design
  // (light mode + small taskbar + near-gray accent) — that would be a
  // recolor, not a real twin.
  const alreadyHushed = s.mode === "light" && s.taskbar?.size === "small" && sat < 0.3;
  if ((sat < 0.7 || lowEnergy) && !alreadyHushed) out.push("hushed");
  if (FOCUSED_KINDS.has(kind) && s.mood !== "focused") out.push("focused");
  if (HEARTH_KINDS.has(kind) && s.mood !== "cozy") out.push("hearth");
  return out;
}

/** A saturation boost is meaningless on a colorless accent — shift luminance
 *  instead (mirrors variants.ts so the vivid twin stays a real design). */
function vividAccent(base: string): string {
  const boosted = boostSaturation(base);
  if (boosted !== base) return boosted;
  const [, , lum] = toHsl(base);
  if (lum > 0.85) return shade(base, -45);
  if (lum < 0.15) return shade(base, 45);
  return shade(base, -25);
}

export function sceneTwinFrom(s: StyleDef, axis: SceneAxis): StyleDef {
  const kind = s.wallpaper.type === "scene" ? (SCENE_KINDS[s.wallpaper.sceneId] ?? "scene") : "scene";
  const base = s.accent_hex;
  const speed0 = s.sceneTweak?.speed ?? 0.7;
  const density0 = s.sceneTweak?.density ?? 0.9;
  const align = s.taskbar?.alignment ?? "center";
  const lock = s.lock_screen ?? { mode: "spotlight" as const };

  let accent = base;
  let mood = s.mood;
  let mode = s.mode;
  let taskbar = s.taskbar ?? { size: "medium" as const, alignment: align };
  let widgets = s.widgets;
  let transparency = s.transparency;
  let speed = speed0;
  let density = density0;
  let gradient: [string, string] = s.gradient;
  let lock_screen = lock;
  let tagline = "";
  let description = "";
  const tags = [...s.tags, "generated"];
  const quiz = { ...s.quiz };

  switch (axis) {
    case "vivid": {
      accent = vividAccent(base);
      taskbar = { size: "large", alignment: align, color_match: true };
      widgets = ["clock", "stats", "todo"];
      transparency = true;
      speed = Math.min(1.6, speed0 * 1.25);
      density = Math.min(2, density0 * 1.15);
      gradient = [shade(accent, -60), accent];
      quiz.vivid = 2;
      tagline = "The vivid twin — saturated accent, color-matched chrome";
      description = `The loud twin of “${s.name}” — a saturation-boosted accent, color-matched taskbar, and a fuller widget set over the same ${kind} scene.`;
      tags.push("vivid");
      break;
    }
    case "hushed": {
      accent = mute(base);
      taskbar = { size: "small", alignment: "left" };
      widgets = ["clock"];
      transparency = mode === "dark" ? false : true;
      speed = speed0 * 0.75;
      density = Math.max(0.4, density0 * 0.85);
      gradient = [shade(accent, -45), shade(accent, 45)];
      quiz.minimal = 2;
      tagline = "The quiet twin — muted accent, small taskbar";
      description = `The quiet twin of “${s.name}” — a muted accent, slim left-aligned taskbar, and nothing else competing over the same ${kind} scene.`;
      tags.push("minimal", "hushed");
      break;
    }
    case "focused": {
      accent = shade(base, -18);
      taskbar = { size: "small", alignment: "left" };
      widgets = ["clock", "stats"];
      transparency = false;
      speed = speed0 * 0.7;
      density = Math.max(0.4, density0 * 0.85);
      mood = "focused";
      gradient = [shade(accent, -50), shade(accent, -5)];
      quiz.focused = 2;
      quiz.motion = 1;
      tagline = "The precision twin — slowed, slim, focused";
      description = `The precision twin of “${s.name}” — the same ${kind} scene slowed down, with a deeper accent and slim chrome for heads-down work.`;
      tags.push("focused", "minimal");
      break;
    }
    case "hearth": {
      accent = shade(base, 18);
      taskbar = { size: "medium", alignment: "center" };
      widgets = ["clock", "note"];
      transparency = true;
      speed = speed0 * 0.8;
      density = Math.max(0.4, density0 * 0.9);
      mood = "cozy";
      lock_screen = { mode: "image" };
      gradient = [shade(accent, -55), shade(accent, -10)];
      quiz.cozy = 2;
      quiz.warm = 2;
      tagline = "The hearth twin — slowed to a warm glow";
      description = `The hearth twin of “${s.name}” — the same ${kind} scene slowed to a glow, with a warmer accent and a note widget.`;
      tags.push("cozy", "warm");
      break;
    }
  }

  return {
    id: `sc-${s.id}-${axis}`,
    name: `${s.name} · ${AXIS_LABEL[axis]}`,
    tagline,
    description,
    category: s.category,
    mood,
    mode,
    accent_hex: accent,
    gradient,
    wallpaper: s.wallpaper,
    sceneTweak: { speed, density },
    transparency,
    taskbar,
    cursor: "aero",
    lock_screen,
    widgets,
    tags,
    quiz,
    generated: true,
    tier: "scene",
  };
}

export const SCENE_TWINS: StyleDef[] = SCENE_STYLES.flatMap((s) =>
  axesForScene(s).map((axis) => sceneTwinFrom(s, axis))
);
export const SCENE_TWIN_BY_ID = new Map(SCENE_TWINS.map((s) => [s.id, s]));
