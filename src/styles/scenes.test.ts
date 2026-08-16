import { describe, expect, it } from "vitest";
import { sceneConfigForStyle } from "./scenes";
import { HERO_STYLES } from "./catalog";
import { VARIANT_STYLES } from "./variants";
import { SCENE_STYLES, SCENE_KINDS, KNOWN_SCENE_IDS } from "./scene_styles";

const GENERIC_KINDS = ["particles", "waves", "geometric", "parallax", "aurora", "stars", "embers", "matrix"];
const KINDS = new Set<string>([...GENERIC_KINDS, ...KNOWN_SCENE_IDS]);

const ALL = [...HERO_STYLES, ...VARIANT_STYLES, ...SCENE_STYLES];

describe("scene catalog coverage (S5)", () => {
  it("every known scene has a render-kind entry (twin gate depends on it)", () => {
    for (const id of KNOWN_SCENE_IDS) {
      expect(SCENE_KINDS[id], `missing kind for scene "${id}"`).toBeTruthy();
    }
    expect(Object.keys(SCENE_KINDS).length).toBe(KNOWN_SCENE_IDS.length);
  });

  it("every scene in the catalog has at least one hand-crafted style", () => {
    const covered = new Set(SCENE_STYLES.map((s) => (s.wallpaper.type === "scene" ? s.wallpaper.sceneId : "")));
    for (const id of KNOWN_SCENE_IDS) {
      expect(covered.has(id), `scene "${id}" has no style`).toBe(true);
    }
  });
});

describe("scene synthesis", () => {
  it("every style gets a valid animated scene", () => {
    for (const s of ALL) {
      const sc = sceneConfigForStyle(s);
      expect(KINDS.has(sc.kind), `${s.id} → kind "${sc.kind}"`).toBe(true);
      expect(sc.speed, s.id).toBeGreaterThanOrEqual(0.2);
      expect(sc.speed, s.id).toBeLessThanOrEqual(3);
      expect(sc.density, s.id).toBeGreaterThanOrEqual(0.2);
      expect(sc.density, s.id).toBeLessThanOrEqual(2);
      expect(sc.colors.length, s.id).toBeGreaterThanOrEqual(1);
      expect(sc.id.endsWith("-animated"), s.id).toBe(true);
      expect(sc.name).toContain("animated");
    }
  });

  it("the scene tier keeps its scene identity in the animated twin", () => {
    for (const s of SCENE_STYLES) {
      if (s.wallpaper.type !== "scene") continue;
      expect(sceneConfigForStyle(s).kind, s.id).toBe(s.wallpaper.sceneId);
    }
  });

  it("keeps the scene identity for flagship heroes that use scenes", () => {
    const auroraDrift = HERO_STYLES.find((s) => s.wallpaper.type === "scene" && s.wallpaper.sceneId === "aurora-drift");
    expect(sceneConfigForStyle(auroraDrift!).kind).toBe("aurora-drift");
  });

  it("energetic moods animate faster than calm moods", () => {
    const calm = HERO_STYLES.find((s) => s.mood === "calm");
    const energetic = HERO_STYLES.find((s) => s.mood === "energetic");
    expect(sceneConfigForStyle(calm!).speed).toBeLessThan(sceneConfigForStyle(energetic!).speed);
  });

  it("colors come from the style's palette", () => {
    const s = HERO_STYLES[0];
    const sc = sceneConfigForStyle(s);
    const lower = sc.colors.map((c) => c.toLowerCase());
    expect(lower).toContain(s.accent_hex.toLowerCase());
    expect(lower).toContain(s.gradient[0].toLowerCase());
  });
});
