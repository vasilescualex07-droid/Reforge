// Palette lookup (ROADMAP v4 A1.1). Real extracted colors for every bundled
// wallpaper, keyed the same way the extractor emits them (kind/stem), with the
// keyword heuristic as a documented fallback for anything unreadable.

import { WALLPAPER_PALETTES, type WallpaperPalette } from "./palettes.generated";
import { getWallpaper, domColor } from "./wallpapers";

/** Stable lookup key for a wallpaper id — matches the extractor's keys. */
export function paletteKeyFor(id: string): string | null {
  const w = getWallpaper(id);
  if (!w) return null;
  const stem = w.file.split("/").pop() ?? id;
  return `${w.type}/${stem.replace(/\.[a-z0-9]+$/i, "")}`;
}

export interface ResolvedPalette {
  dominant: string;
  secondary: string;
  luminance: number;
  saturated: boolean;
}

/** Real palette for a wallpaper, or a keyword-derived stand-in. */
export function paletteFor(id: string): ResolvedPalette {
  const key = paletteKeyFor(id);
  const p = key ? WALLPAPER_PALETTES[key] : undefined;
  if (p) return p;
  const w = getWallpaper(id);
  const fallback = domColor(id, w?.category ?? "Abstract");
  return { dominant: fallback, secondary: fallback, luminance: 0.5, saturated: false };
}

/** Light/dark decision from real luminance, with a per-category fallback. */
export function modeForLuminance(id: string, fallback: "dark" | "light"): "dark" | "light" {
  const p = paletteFor(id);
  if (p.luminance <= 0.42) return "dark";
  if (p.luminance >= 0.62) return "light";
  return fallback;
}

export type { WallpaperPalette };
