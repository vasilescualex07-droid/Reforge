// Variant engine v2 (A1.1). One wallpaper, three deliberately different looks
// — `natural` (palette-faithful default), `vivid` (saturation-boosted twin,
// only when the palette is saturated or the category is high-energy) and
// `minimal` (quiet twin, muted accent — only when the palette can support a
// reduced look). Each axis is a rule-designed *config*, never a recolor: the
// diversity gate in variants.test.ts proves twins differ on ≥2 surfaces.
//
// The accent always comes from the wallpaper's real extracted palette; the
// axis only shapes the rest of the chrome.

import type { StyleDef, VariantAxis } from "./types";
import {
  ALL_WALLPAPERS,
  CATEGORY_ENERGY,
  CATEGORY_TAG,
  niceName,
  type WallpaperEntry,
} from "./wallpapers";
import { paletteFor, modeForLuminance, type ResolvedPalette } from "./palettes";

export function shade(hex: string, amt: number): string {
  const h = hex.replace("#", "");
  if (h.length !== 6) return hex;
  const n = (i: number) => Math.min(255, Math.max(0, parseInt(h.slice(i, i + 2), 16) + amt));
  return `#${[n(0), n(2), n(4)].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

/** Contrast-shift an accent for its mode so it stays legible on every surface. */
export function contrastAccent(hex: string, mode: "dark" | "light", saturated: boolean): string {
  const lum = (parseInt(hex.slice(1, 3), 16) * 0.299 + parseInt(hex.slice(3, 5), 16) * 0.587 + parseInt(hex.slice(5, 7), 16) * 0.114) / 255;
  if (mode === "dark" && lum < 0.18) return shade(hex, saturated ? 55 : 80);
  if (mode === "light" && lum > 0.82) return shade(hex, saturated ? -55 : -80);
  if (mode === "dark") return shade(hex, 12);
  return shade(hex, -12);
}

/** Convert #rrggbb → [h (0-360), s (0-1), l (0-1)]. */
export function toHsl(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  if (h.length !== 6) return [0, 0, 0.5];
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let hh: number;
  if (max === r) hh = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) hh = ((b - r) / d + 2) * 60;
  else hh = ((r - g) / d + 4) * 60;
  return [hh, s, l];
}

export function fromHsl(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const ch = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${ch(r)}${ch(g)}${ch(b)}`;
}

/** Push saturation up toward vivid — same hue family, louder. */
export function boostSaturation(hex: string): string {
  const [h, s, l] = toHsl(hex);
  return fromHsl(h, Math.min(0.85, Math.max(s, s + 0.35)), l);
}

/** Which extracted palette color the accent is derived from. For near-black
 *  frames (mostly-solid videos, night shots) the *secondary* carries the real
 *  hue; a pure black dominant would otherwise lift to a colorless gray. */
export function accentSource(pal: ResolvedPalette): string {
  const [, s] = toHsl(pal.secondary);
  if (pal.luminance < 0.14 && s >= 0.15) return pal.secondary;
  return pal.dominant;
}

/** Pull a hex toward neutral gray — the minimal twin's muted accent. */
export function mute(hex: string, amt = 0.5): string {
  const [h, , l] = toHsl(hex);
  return fromHsl(h, 0.06 + (1 - amt) * 0.2, l);
}

interface DesignRule {
  mode: "dark" | "light";
  mood: StyleDef["mood"];
  taskbar: NonNullable<StyleDef["taskbar"]>;
  cursor: "aero" | "black";
  lock_screen: "spotlight" | "image";
  widgets: string[];
  transparency: boolean;
}

const RULES: Record<string, DesignRule> = {
  Minimal: { mode: "light", mood: "focused", taskbar: { size: "small", alignment: "left" }, cursor: "aero", lock_screen: "spotlight", widgets: ["clock"], transparency: true },
  Nature: { mode: "dark", mood: "calm", taskbar: { size: "medium", alignment: "center" }, cursor: "aero", lock_screen: "spotlight", widgets: ["clock", "calendar"], transparency: true },
  Space: { mode: "dark", mood: "calm", taskbar: { size: "medium", alignment: "center", color_match: true }, cursor: "aero", lock_screen: "spotlight", widgets: ["clock", "stats"], transparency: true },
  Abstract: { mode: "dark", mood: "focused", taskbar: { size: "medium", alignment: "center" }, cursor: "aero", lock_screen: "spotlight", widgets: ["clock"], transparency: true },
  Dark: { mode: "dark", mood: "focused", taskbar: { size: "medium", alignment: "left" }, cursor: "aero", lock_screen: "spotlight", widgets: ["clock", "stats"], transparency: false },
  Vibrant: { mode: "dark", mood: "energetic", taskbar: { size: "large", alignment: "left", color_match: true }, cursor: "aero", lock_screen: "spotlight", widgets: ["clock", "stats", "todo"], transparency: true },
  Warm: { mode: "dark", mood: "cozy", taskbar: { size: "medium", alignment: "center" }, cursor: "aero", lock_screen: "image", widgets: ["clock", "note"], transparency: true },
  Cool: { mode: "dark", mood: "calm", taskbar: { size: "medium", alignment: "center", color_match: true }, cursor: "aero", lock_screen: "spotlight", widgets: ["clock", "stats"], transparency: true },
  Seasonal: { mode: "dark", mood: "cozy", taskbar: { size: "medium", alignment: "center" }, cursor: "aero", lock_screen: "image", widgets: ["clock", "calendar"], transparency: true },
};

const AXIS_LABEL: Record<VariantAxis, string> = {
  natural: "",
  vivid: "· Vivid",
  minimal: "· Minimal",
};

/** Which axes are honest for this wallpaper — never forced. */
export function axesFor(w: WallpaperEntry, pal: ResolvedPalette): VariantAxis[] {
  const energy = CATEGORY_ENERGY[w.category] ?? 0.5;
  const axes: VariantAxis[] = ["natural"];
  // Vivid only when the palette is loud enough to carry it.
  if (pal.saturated || energy >= 0.5) axes.push("vivid");
  // Minimal only when the palette can survive being hushed.
  if (!pal.saturated || energy <= 0.6) axes.push("minimal");
  return axes;
}

function bumpSize(size: NonNullable<StyleDef["taskbar"]>["size"]): NonNullable<StyleDef["taskbar"]>["size"] {
  if (size === "small") return "medium";
  if (size === "medium") return "large";
  return "large";
}

export function styleFromWallpaper(w: WallpaperEntry, axis: VariantAxis = "natural"): StyleDef {
  const rule = RULES[w.category] ?? RULES.Abstract;
  const energy = CATEGORY_ENERGY[w.category] ?? 0.5;
  const pal = paletteFor(w.id);
  const mode = modeForLuminance(w.id, rule.mode);
  const baseAccent = contrastAccent(accentSource(pal), mode, pal.saturated);
  const tag = CATEGORY_TAG[w.category] ?? "minimal";
  const vivid = axis === "vivid";
  const minimal = axis === "minimal";
  // The minimal twin keeps the same luminance-honest mode as natural; its
  // personality comes from the muted accent, small taskbar and opaque chrome.
  const axisMode = mode;

  // ---- axis decisions ----
  // A saturation boost is meaningless on a colorless accent (pure white/
  // gray) — shift luminance instead so the vivid twin is still a real design.
  // Direction follows the accent's own brightness, not the app mode.
  const boosted = boostSaturation(baseAccent);
  const [, , lum] = toHsl(baseAccent);
  const accent = vivid
    ? boosted === baseAccent
      ? lum > 0.85 ? shade(baseAccent, -45) : lum < 0.15 ? shade(baseAccent, 45) : shade(baseAccent, -25)
      : boosted
    : minimal ? mute(baseAccent) : baseAccent;

  const mood: StyleDef["mood"] =
    energy > 0.6 ? "energetic" : energy < 0.35 ? (rule.mood === "focused" ? "focused" : "calm") : rule.mood;

  const taskbar: NonNullable<StyleDef["taskbar"]> = vivid
    ? { size: bumpSize(rule.taskbar.size), alignment: rule.taskbar.alignment, color_match: true }
    : minimal
      ? { size: "small", alignment: "left" }
      : rule.taskbar;
  const widgets = vivid ? ["clock", "stats", "todo"] : minimal ? ["clock"] : rule.widgets;
  const transparency = minimal ? axisMode === "dark" ? false : true : rule.transparency;
  const gradient: [string, string] = vivid
    ? [shade(accent, -60), accent]
    : minimal
      ? [shade(accent, -45), shade(accent, 45)]
      : axisMode === "light"
        ? [shade(accent, 95), shade(accent, -30)]
        : [shade(accent, -70), shade(accent, -10)];
  const speed = vivid ? Math.min(1.6, 1.2 * (energy > 0.6 ? 1.2 : 1)) : minimal ? 0.55 : energy > 0.6 ? 1.2 : energy < 0.35 ? 0.6 : 0.9;
  const density = vivid ? 1.2 : minimal ? 0.7 : 0.9;

  const quiz: StyleDef["quiz"] = {
    [tag]: 3,
    [axisMode]: 2,
  };
  if (vivid) quiz.vivid = 2;
  if (minimal) quiz.minimal = 2;
  if (energy > 0.6) quiz.energetic = 2;
  else if (energy < 0.35) quiz.calm = 2;
  else quiz.focused = 1;
  // A saturated palette advertises vividness — but not for the hushed twin.
  if (pal.saturated && !minimal) quiz.vivid = Math.max(quiz.vivid ?? 0, 1);
  if (["Warm", "Seasonal", "Vibrant"].includes(w.category)) quiz.warm = 1;
  if (["Cool", "Space", "Minimal", "Dark"].includes(w.category)) quiz.cool = 1;

  const axisName = AXIS_LABEL[axis].trim();
  const axisTag = axis === "natural" ? "natural" : axis;
  return {
    id: `wp-${w.id}-${axis}`,
    name: axisName ? `${niceName(w.id)} · ${axisName}` : niceName(w.id),
    tagline:
      axis === "vivid"
        ? "The vivid twin — saturated accent, color-matched chrome"
        : axis === "minimal"
          ? "The quiet twin — muted accent, small taskbar"
          : `${w.category} palette, from the wallpaper itself`,
    description:
      axis === "vivid"
        ? `The loud twin of “${w.name}” — a saturation-boosted ${pal.dominant} accent, color-matched chrome, and a fuller widget set. For when the wallpaper deserves to shout.`
        : axis === "minimal"
          ? `The quiet twin of “${w.name}” — a muted ${pal.dominant} accent, small left-aligned taskbar, and nothing else competing. One click applies the whole look; one click reverts it.`
          : `Built from “${w.name}” — a ${pal.saturated ? "vivid" : "muted"} ${pal.dominant} accent on ${mode === "dark" ? "a dark" : "a light"} desktop, ${w.type === "live" ? "with the live video as the background" : "with the photo as the background"}. One click applies the whole look; one click reverts it.`,
    category: w.category,
    mood,
    mode: axisMode,
    accent_hex: accent,
    gradient,
    wallpaper: { type: w.type, id: w.id },
    sceneTweak: { speed, density },
    transparency,
    taskbar,
    cursor: rule.cursor,
    lock_screen: { mode: rule.lock_screen },
    widgets,
    tags: [tag, w.category.toLowerCase(), axisMode, axisTag, "generated"],
    quiz,
    generated: true,
    wallpaperName: w.name,
    axis,
    tier: "library",
  };
}

export const VARIANT_STYLES: StyleDef[] = ALL_WALLPAPERS.flatMap((w) => {
  const pal = paletteFor(w.id);
  return axesFor(w, pal).map((axis) => styleFromWallpaper(w, axis));
});
export const VARIANT_BY_ID = new Map(VARIANT_STYLES.map((s) => [s.id, s]));

/** The default (natural) variant id for a wallpaper — gallery → style lookup. */
export function naturalVariantId(w: WallpaperEntry): string {
  return `wp-${w.id}-natural`;
}
