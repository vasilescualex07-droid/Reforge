import { describe, expect, it } from "vitest";
import { SCENE_STYLES, SCENE_KINDS, KNOWN_SCENE_IDS } from "./scene_styles";
import { SCENE_TWINS, axesForScene } from "./scene_twins";
import { toHsl } from "./variants";

describe("scene twin engine (S5)", () => {
  it("emits exactly the honest axes for every scene style, ids unique", () => {
    const expected = SCENE_STYLES.reduce((n, s) => n + axesForScene(s).length, 0);
    expect(SCENE_TWINS).toHaveLength(expected);
    expect(SCENE_TWINS.length).toBeGreaterThan(80);
    expect(SCENE_TWINS.length).toBeLessThanOrEqual(SCENE_STYLES.length * 4);
    const ids = SCENE_TWINS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Nearly every style has ≥1 twin — only a style already at its honest
    // optimum on every axis (hushed + focused + un-vividable) gets none.
    const covered = new Set(SCENE_TWINS.map((t) => t.id.replace(/-(vivid|hushed|focused|hearth)$/, "")));
    expect(covered.size).toBeGreaterThanOrEqual(SCENE_STYLES.length - 3);
  });

  it("twins are generated scene-tier styles with a valid scene ref", () => {
    const known = new Set<string>(KNOWN_SCENE_IDS);
    for (const t of SCENE_TWINS) {
      expect(t.generated).toBe(true);
      expect(t.tier).toBe("scene");
      expect(t.wallpaper.type).toBe("scene");
      if (t.wallpaper.type === "scene") expect(known.has(t.wallpaper.sceneId), t.id).toBe(true);
    }
  });

  it("each axis is only emitted when it is honest for that scene (never forced)", () => {
    for (const s of SCENE_STYLES) {
      const kind = s.wallpaper.type === "scene" ? (SCENE_KINDS[s.wallpaper.sceneId] ?? "") : "";
      const [, sat] = toHsl(s.accent_hex);
      const energetic = s.mood === "energetic" || s.mood === "playful";
      const lowEnergy = s.mood === "calm" || s.mood === "focused" || s.mood === "cozy";
      const focusedKinds = ["matrix", "geometric", "particles", "parallax"];
      const hearthKinds = ["embers", "fireflies", "smoke"];
      const alreadyHushed = s.mode === "light" && s.taskbar?.size === "small" && sat < 0.3;
      const has = (axis: string) => SCENE_TWINS.some((t) => t.id === `sc-${s.id}-${axis}`);
      expect(has("vivid"), `${s.id} vivid=${has("vivid")}`).toBe(sat >= 0.45 || energetic);
      expect(has("hushed"), `${s.id} hushed=${has("hushed")}`).toBe((sat < 0.7 || lowEnergy) && !alreadyHushed);
      expect(has("focused"), `${s.id} focused=${has("focused")}`).toBe(focusedKinds.includes(kind) && s.mood !== "focused");
      expect(has("hearth"), `${s.id} hearth=${has("hearth")}`).toBe(hearthKinds.includes(kind) && s.mood !== "cozy");
    }
  });

  it("every twin differs from its flagship on ≥2 surfaces (diversity gate)", () => {
    const surfaces = (s: { accent_hex: string; mode: string; taskbar?: { size?: string; alignment?: string; color_match?: boolean }; widgets?: string[]; transparency: boolean; gradient: [string, string]; mood: string }) => [
      s.accent_hex.toLowerCase(),
      s.mode,
      `${s.taskbar?.size ?? ""}|${s.taskbar?.alignment ?? ""}|${s.taskbar?.color_match ?? ""}`,
      (s.widgets ?? []).join(","),
      String(s.transparency),
      s.gradient.join(",").toLowerCase(),
      s.mood,
    ];
    for (const t of SCENE_TWINS) {
      const flagship = SCENE_STYLES.find((s) => s.id === t.id.replace(/^sc-/, "").replace(/-(vivid|hushed|focused|hearth)$/, ""));
      expect(flagship, `${t.id} has no flagship`).toBeTruthy();
      if (!flagship) continue;
      const diff = surfaces(t).filter((v, i) => v !== surfaces(flagship)[i]);
      expect(diff.length, `${t.id} vs ${flagship.id} differs on ${diff.length} surfaces`).toBeGreaterThanOrEqual(2);
    }
  });

  it("twins stay in the flagship's hue family", () => {
    const hueOf = (hex: string) => toHsl(hex)[0];
    for (const t of SCENE_TWINS) {
      const flagship = SCENE_STYLES.find((s) => s.id === t.id.replace(/^sc-/, "").replace(/-(vivid|hushed|focused|hearth)$/, ""));
      if (!flagship) continue;
      const a = hueOf(flagship.accent_hex);
      const b = hueOf(t.accent_hex);
      const d = Math.abs(a - b);
      // The hearth twin warms the accent — allow a bigger swing there; the
      // other axes must stay within the same hue neighborhood.
      const max = t.id.endsWith("-hearth") ? 45 : 30;
      expect(Math.min(d, 360 - d), `${t.id} hue ${a} → ${b}`).toBeLessThanOrEqual(max);
    }
  });
});
