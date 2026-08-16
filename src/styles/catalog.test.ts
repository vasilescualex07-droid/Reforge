import { describe, expect, it } from "vitest";
import { HERO_STYLES, STYLE_COLLECTIONS } from "./catalog";
import { ALL_STYLES } from "./index";
import { Q_DIMS } from "./types";
import { getWallpaper } from "./wallpapers";
import { paletteKeyFor } from "./palettes";
import { WALLPAPER_PALETTES } from "./palettes.generated";
import { KNOWN_SCENE_IDS } from "./scene_styles";
import { CURATED_GUIDS } from "./sound_schemes";
import type { WallpaperRef } from "./types";

const HEX = /^#[0-9a-fA-F]{6}$/;
const MOODS = ["calm", "energetic", "focused", "playful", "cozy"] as const;
const SCENE_IDS = new Set<string>(KNOWN_SCENE_IDS);

function wallpaperResolves(w: WallpaperRef): boolean {
  if (w.type === "scene") return SCENE_IDS.has(w.sceneId);
  return getWallpaper(w.id) !== undefined;
}

describe("hero catalog", () => {
  it("contains exactly 72 hand-crafted flagships (A1.2)", () => {
    expect(HERO_STYLES).toHaveLength(72);
    expect(HERO_STYLES.every((s) => !s.generated)).toBe(true);
    expect(HERO_STYLES.every((s) => s.tier === "flagship")).toBe(true);
  });

  it("has 6 era collections with at least 4 flagships each", () => {
    expect(STYLE_COLLECTIONS).toHaveLength(6);
    for (const col of STYLE_COLLECTIONS) {
      const members = HERO_STYLES.filter((s) => s.collection === col);
      expect(members.length, `collection "${col}"`).toBeGreaterThanOrEqual(4);
    }
  });

  it("includes live-wallpaper heroes that route through the video engine", () => {
    const liveHeroes = HERO_STYLES.filter((s) => s.wallpaper.type === "live");
    expect(liveHeroes.length).toBeGreaterThanOrEqual(6);
    for (const s of liveHeroes) {
      if (s.wallpaper.type !== "live") continue;
      const w = getWallpaper(s.wallpaper.id);
      expect(w?.type, `${s.id} → ${s.wallpaper.id}`).toBe("live");
    }
  });

  it("covers both modes and fills the previously-empty light-energetic cell", () => {
    expect(HERO_STYLES.some((s) => s.mode === "light" && s.mood === "energetic")).toBe(true);
    expect(HERO_STYLES.some((s) => s.mode === "dark" && s.mood === "cozy")).toBe(true);
    expect(HERO_STYLES.filter((s) => s.mode === "light").length).toBeGreaterThanOrEqual(10);
  });

  it("has unique ids", () => {
    const ids = HERO_STYLES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every wallpaper ref resolves to a real wallpaper or known scene", () => {
    for (const s of HERO_STYLES) {
      expect(wallpaperResolves(s.wallpaper), `${s.id} → ${JSON.stringify(s.wallpaper)}`).toBe(true);
    }
  });

  it("every style has valid hex accent + gradient, valid mood and mode", () => {
    for (const s of HERO_STYLES) {
      expect(s.accent_hex, s.id).toMatch(HEX);
      expect(s.gradient[0], s.id).toMatch(HEX);
      expect(s.gradient[1], s.id).toMatch(HEX);
      expect(MOODS).toContain(s.mood);
      expect(["dark", "light"]).toContain(s.mode);
    }
  });

  it("every hero wallpaper has a real extracted palette, never a keyword fallback (A1.1)", () => {
    for (const s of HERO_STYLES) {
      if (s.wallpaper.type === "scene") continue;
      const key = paletteKeyFor(s.wallpaper.id);
      expect(key, `${s.id} → ${s.wallpaper.id} has no palette key`).toBeTruthy();
      expect(WALLPAPER_PALETTES[key as string], `${s.id} → ${s.wallpaper.id} fell back to keyword heuristics`).toBeTruthy();
    }
  });

  it("accents are per-wallpaper designs, never category constants", () => {
    const byCat = new Map<string, Set<string>>();
    for (const s of HERO_STYLES) {
      if (s.wallpaper.type === "scene") continue;
      const set = byCat.get(s.category) ?? new Set<string>();
      set.add(s.accent_hex.toLowerCase());
      byCat.set(s.category, set);
    }
    for (const [cat, set] of byCat) {
      if (set.size >= 2) {
        expect(set.size, `category "${cat}" collapsed to a single accent`).toBeGreaterThan(1);
      }
    }
  });

  it("quiz weights only reference real dimensions", () => {
    for (const s of HERO_STYLES) {
      for (const dim of Object.keys(s.quiz)) {
        expect(Q_DIMS, `${s.id} has bogus dim "${dim}"`).toContain(dim);
      }
    }
  });

  it("deeper components are typed correctly when present", () => {
    for (const s of HERO_STYLES) {
      if (s.font) expect(typeof s.font).toBe("string");
      if (s.sound_scheme) expect(typeof s.sound_scheme.guid).toBe("string");
      if (s.rgb) expect(["accent-sync", "off"]).toContain(s.rgb);
      if (s.taskbar?.size) expect(["small", "medium", "large"]).toContain(s.taskbar.size);
      if (s.widgets) expect(Array.isArray(s.widgets)).toBe(true);
    }
  });

  it("every style carries a tagline and description", () => {
    for (const s of HERO_STYLES) {
      expect(s.tagline.length, s.id).toBeGreaterThan(10);
      expect(s.description.length, s.id).toBeGreaterThan(30);
    }
  });
});

// ---------------------------------------------------------------------------
// A1.4 — the verification gate now covers the ENTIRE ALL_STYLES set.
// ---------------------------------------------------------------------------

describe("ALL_STYLES integrity (A1.4)", () => {
  it("spans four tiers and stays unique", () => {
    // S5 exit gate: 500+ styles — 72 flagships + honest-axis variants (forced
    // twins are never emitted) + scene styles and their honest twins.
    expect(ALL_STYLES.length).toBeGreaterThanOrEqual(500);
    const ids = ALL_STYLES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const tiers = new Set(ALL_STYLES.map((s) => s.tier));
    expect(tiers.has("flagship")).toBe(true);
    expect(tiers.has("library")).toBe(true);
    expect(tiers.has("scene")).toBe(true);
  });

  it("every wallpaper/scene ref resolves", () => {
    for (const s of ALL_STYLES) {
      expect(wallpaperResolves(s.wallpaper), `${s.id} → ${JSON.stringify(s.wallpaper)}`).toBe(true);
    }
  });

  it("every style has valid hex, mood, mode and quiz dims", () => {
    for (const s of ALL_STYLES) {
      expect(s.accent_hex, s.id).toMatch(HEX);
      expect(s.gradient[0], s.id).toMatch(HEX);
      expect(s.gradient[1], s.id).toMatch(HEX);
      expect(MOODS).toContain(s.mood);
      expect(["dark", "light"]).toContain(s.mode);
      for (const dim of Object.keys(s.quiz)) {
        expect(Q_DIMS, `${s.id} has bogus dim "${dim}"`).toContain(dim);
      }
    }
  });

  it("library variants derive accents from their wallpaper's real palette", () => {
    for (const s of ALL_STYLES) {
      if (s.tier !== "library") continue;
      const wref = s.wallpaper;
      if (wref.type === "scene") continue;
      const key = paletteKeyFor(wref.id);
      expect(key, `${s.id}`).toBeTruthy();
      expect(WALLPAPER_PALETTES[key as string], `${s.id} fell back to keyword heuristics`).toBeTruthy();
    }
  });

  it("every scene style references a scene the engine provides", () => {
    for (const s of ALL_STYLES) {
      if (s.tier !== "scene") continue;
      if (s.wallpaper.type !== "scene") continue;
      expect(SCENE_IDS.has(s.wallpaper.sceneId), `${s.id} → ${s.wallpaper.sceneId}`).toBe(true);
    }
  });

  it("every wallpaper referenced by any style exists on disk (A1.4)", () => {
    // Vite-native glob over the real public/ folder — no node types needed.
    // Keys may carry a leading "./", "/" or absolute prefix — compare from
    // "wallpapers/" onward so the check is format-agnostic.
    const onDisk = new Set<string>(
      Object.keys(import.meta.glob("/public/wallpapers/**/*.{jpg,mp4}")).map((k) =>
        k.slice(k.indexOf("wallpapers/"))
      )
    );
    const checked = new Set<string>();
    for (const s of ALL_STYLES) {
      if (s.wallpaper.type === "scene") continue;
      const w = getWallpaper(s.wallpaper.id);
      if (!w || checked.has(w.file)) continue;
      checked.add(w.file);
      expect(onDisk.has(w.file.replace(/^\//, "")), `${s.id} → ${w.file} missing on disk`).toBe(true);
    }
    // The library must cover the whole bundled set (118 wallpapers), not a subset.
    expect(checked.size, "all bundled wallpapers must resolve on disk").toBe(118);
  });
});

// ---------------------------------------------------------------------------
// S5.4 — curated sound schemes (K7).
// ---------------------------------------------------------------------------

describe("curated sound schemes (S5.4)", () => {
  it("every flagship carries a curated scheme guid", () => {
    for (const s of HERO_STYLES) {
      expect(s.sound_scheme?.guid, s.id).toBeTruthy();
      expect(CURATED_GUIDS, `${s.id} → ${s.sound_scheme?.guid}`).toContain(s.sound_scheme!.guid);
    }
  });

  it("assigns both distinct schemes somewhere (Windows Default + No Sounds)", () => {
    const guids = HERO_STYLES.map((s) => s.sound_scheme!.guid);
    expect(guids.some((g) => g === ".None"), "no hero uses No Sounds").toBe(true);
    expect(guids.some((g) => g === ".Default" || g.startsWith("{")), "no hero uses Windows Default").toBe(true);
  });

  it("focus/Nordic heroes get No Sounds; Studio heroes get the canonical GUID", () => {
    for (const s of HERO_STYLES) {
      if (s.collection === "Studio") {
        expect(s.sound_scheme!.guid, s.id).toMatch(/^{/);
      } else if (s.mood === "focused" || s.collection === "Nordic") {
        expect(s.sound_scheme!.guid, s.id).toBe(".None");
      }
    }
  });
});
