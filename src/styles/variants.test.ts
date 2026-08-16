import { describe, expect, it } from "vitest";
import { VARIANT_STYLES, axesFor, accentSource, contrastAccent, styleFromWallpaper } from "./variants";
import { ALL_WALLPAPERS, CATEGORY_ENERGY, CATEGORY_MODE } from "./wallpapers";
import { paletteFor, modeForLuminance } from "./palettes";

// HSL helpers for the hue-family gate (accents must stay in the wallpaper's
// palette family — the no-slop grounding rule for engine-derived colors).
function hueOf(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return h;
}
function satOf(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  const l = (max + min) / 2;
  return l > 0.5 ? d / (2 - max - min) : d / (max + min);
}
function lumOf(hex: string): number {
  return (parseInt(hex.slice(1, 3), 16) * 0.299 + parseInt(hex.slice(3, 5), 16) * 0.587 + parseInt(hex.slice(5, 7), 16) * 0.114) / 255;
}
function hueDist(a: number, b: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, 360 - d);
}

describe("variant engine v2 (A1.1)", () => {
  it("generates one natural variant per wallpaper plus applicable axes", () => {
    const expected = ALL_WALLPAPERS.reduce((n, w) => n + axesFor(w, paletteFor(w.id)).length, 0);
    expect(VARIANT_STYLES).toHaveLength(expected);
    expect(VARIANT_STYLES.length).toBeGreaterThan(240);
    expect(VARIANT_STYLES.length).toBeLessThanOrEqual(ALL_WALLPAPERS.length * 3);
    expect(VARIANT_STYLES.every((s) => s.generated)).toBe(true);
    expect(VARIANT_STYLES.every((s) => s.tier === "library")).toBe(true);
  });

  it("every wallpaper has a natural variant and ids are unique", () => {
    const ids = VARIANT_STYLES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const w of ALL_WALLPAPERS) {
      expect(ids, w.id).toContain(`wp-${w.id}-natural`);
    }
  });

  it("vivid is only emitted when the palette is loud enough", () => {
    for (const w of ALL_WALLPAPERS) {
      const pal = paletteFor(w.id);
      const hasVivid = VARIANT_STYLES.some((s) => s.id === `wp-${w.id}-vivid`);
      const shouldHave = pal.saturated || (CATEGORY_ENERGY[w.category] ?? 0.5) >= 0.5;
      expect(hasVivid, `${w.id} vivid=${hasVivid} should=${shouldHave}`).toBe(shouldHave);
    }
  });

  it("every variant carries its source wallpaper name and a valid ref", () => {
    for (const s of VARIANT_STYLES) {
      expect(s.wallpaperName?.length, s.id).toBeGreaterThan(0);
      const w = s.wallpaper;
      const resolved = w.type !== "scene" && ALL_WALLPAPERS.some((x) => x.id === w.id);
      expect(resolved, s.id).toBe(true);
    }
  });

  it("natural variants follow real extracted luminance", () => {
    for (const w of ALL_WALLPAPERS) {
      const natural = styleFromWallpaper(w, "natural");
      const expected = modeForLuminance(w.id, CATEGORY_MODE[w.category] ?? "dark");
      expect(natural.mode, `${natural.id} (${w.id})`).toBe(expected);
    }
  });

  it("natural accents are exactly the contrast-shifted extracted palette color", () => {
    for (const w of ALL_WALLPAPERS) {
      const s = styleFromWallpaper(w, "natural");
      const pal = paletteFor(w.id);
      const expected = contrastAccent(accentSource(pal), s.mode, pal.saturated);
      expect(s.accent_hex, s.id).toBe(expected);
    }
  });

  it("every variant has a sceneTweak so it gets an animated twin", () => {
    for (const s of VARIANT_STYLES) {
      expect(s.sceneTweak?.speed, s.id).toBeGreaterThan(0);
      expect(s.sceneTweak?.density, s.id).toBeGreaterThan(0);
    }
  });

  it("quiz weights are sane for every variant", () => {
    for (const s of VARIANT_STYLES) {
      const vals = Object.values(s.quiz);
      expect(vals.length, s.id).toBeGreaterThan(0);
      expect(Math.max(...vals), s.id).toBeLessThanOrEqual(3);
    }
  });

  // ---- A1.1 diversity gate: twins differ on ≥2 surfaces, never a recolor ----
  it("multi-axis wallpapers get genuinely different configs (diversity gate)", () => {
    for (const w of ALL_WALLPAPERS) {
      const twins = VARIANT_STYLES.filter((s) => s.wallpaper.type === w.type && s.wallpaper.id === w.id);
      if (twins.length < 2) continue;
      for (let i = 0; i < twins.length; i++) {
        for (let j = i + 1; j < twins.length; j++) {
          const a = twins[i];
          const b = twins[j];
          const diffCount = [
            a.accent_hex !== b.accent_hex,
            a.mode !== b.mode,
            JSON.stringify(a.taskbar) !== JSON.stringify(b.taskbar),
            JSON.stringify(a.widgets) !== JSON.stringify(b.widgets),
            a.transparency !== b.transparency,
            JSON.stringify(a.gradient) !== JSON.stringify(b.gradient),
          ].filter(Boolean).length;
          expect(diffCount, `${a.id} vs ${b.id}`).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });

  // ---- A1.4 palette grounding: engine-derived accents stay in hue family ----
  // Every axis transforms the *same* base color hue-preservingly (shade, sat-
  // boost, mute, deepen all keep the hue), so the accent must sit in the hue
  // family of the exact source color the engine derived it from.
  it("every variant accent stays in its source color's hue family", () => {
    for (const s of VARIANT_STYLES) {
      if (s.wallpaper.type === "scene") continue;
      const pal = paletteFor(s.wallpaper.id);
      const src = accentSource(pal);
      // A neutral source (gray lift of a black/white dominant) carries no hue
      // and cannot drift — it is palette-grounded by construction.
      if (satOf(src) < 0.12 || lumOf(src) <= 0.04 || lumOf(src) >= 0.96) continue;
      const ok = hueDist(hueOf(s.accent_hex), hueOf(src)) <= 35;
      expect(ok, `${s.id} accent ${s.accent_hex} drifted from source ${src}`).toBe(true);
    }
  });
});
