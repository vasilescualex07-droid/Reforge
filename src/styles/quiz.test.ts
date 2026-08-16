import { describe, expect, it } from "vitest";
import { QUIZ, buildMyStyle, mergeAnswers, rankStyles, scoreStyle } from "./quiz";
import { EMPTY_ANSWERS, Q_DIMS, type QuizAnswers } from "./types";
import { HERO_STYLES } from "./catalog";
import { VARIANT_STYLES } from "./variants";

describe("quiz v4", () => {
  it("has 18 questions, each with 4-5 options and valid dim weights", () => {
    expect(QUIZ).toHaveLength(18);
    for (const q of QUIZ) {
      expect(q.options.length, q.q).toBeGreaterThanOrEqual(4);
      expect(q.options.length, q.q).toBeLessThanOrEqual(5);
      for (const opt of q.options) {
        expect(opt.label.length).toBeGreaterThanOrEqual(4);
        for (const dim of Object.keys(opt.w)) {
          expect(Q_DIMS, `bogus dim "${dim}" in "${opt.label}"`).toContain(dim);
        }
      }
    }
  });

  it("covers the new component-level dimensions across the quiz", () => {
    const used = new Set<string>();
    for (const q of QUIZ) for (const opt of q.options) for (const dim of Object.keys(opt.w)) used.add(dim);
    for (const dim of ["bold", "soft", "mono", "vivid", "motion", "widgets"]) {
      expect(used.has(dim), `quiz never asks about "${dim}"`).toBe(true);
    }
  });

  it("mergeAnswers accumulates weights", () => {
    const a = mergeAnswers(EMPTY_ANSWERS, QUIZ[0], 0);
    const b = mergeAnswers(a, QUIZ[1], 1);
    const dim = Object.keys(QUIZ[0].options[0].w)[0] as keyof QuizAnswers;
    const dim2 = Object.keys(QUIZ[1].options[1].w)[0] as keyof QuizAnswers;
    expect(b[dim]).toBeGreaterThan(0);
    expect(b[dim2]).toBeGreaterThan(0);
    expect(Object.values(b).some((v) => v > 0)).toBe(true);
  });

  it("rankStyles is deterministic and ordered by score", () => {
    const answers = mergeAnswers(mergeAnswers(EMPTY_ANSWERS, QUIZ[0], 0), QUIZ[1], 0);
    const all = [...HERO_STYLES, ...VARIANT_STYLES];
    const ranked = rankStyles(all, answers);
    expect(ranked).toHaveLength(all.length);
    for (let i = 1; i < ranked.length; i++) {
      expect(scoreStyle(ranked[i - 1], answers)).toBeGreaterThanOrEqual(scoreStyle(ranked[i], answers));
    }
    const again = rankStyles(all, answers).map((s) => s.id);
    expect(again).toEqual(ranked.map((s) => s.id));
  });

  it("buildMyStyle produces a valid style for a light+cool profile", () => {
    const a = { ...EMPTY_ANSWERS, light: 5, cool: 5, calm: 4, minimal: 3 };
    const s = buildMyStyle(a);
    expect(s.mode).toBe("light");
    expect(s.generated).toBe(true);
    expect(s.wallpaperName).toBeDefined();
    expect(s.accent_hex).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it("buildMyStyle produces a dark+warm profile", () => {
    const a = { ...EMPTY_ANSWERS, dark: 6, warm: 5, cozy: 4 };
    const s = buildMyStyle(a);
    expect(s.mode).toBe("dark");
    expect(s.accent_hex.startsWith("#")).toBe(true);
  });

  it("mono answers switch the whole-UI font to Consolas", () => {
    const a = { ...EMPTY_ANSWERS, mono: 5, focused: 3, gaming: 2 };
    const s = buildMyStyle(a);
    expect(s.font).toBe("Consolas");
    expect(s.cursor).toBe("black");
  });

  it("widget answers change the widget set and taskbar", () => {
    const none = buildMyStyle({ ...EMPTY_ANSWERS, widgets: 0, minimal: 3 });
    expect(none.widgets).toHaveLength(0);
    const all = buildMyStyle({ ...EMPTY_ANSWERS, widgets: 3, energetic: 4 });
    expect(all.widgets).toHaveLength(3);
    expect(all.taskbar?.size).toBe("large");
  });

  it("gaming+vivid answers request accent-sync RGB", () => {
    const s = buildMyStyle({ ...EMPTY_ANSWERS, gaming: 3, vivid: 3, dark: 2 });
    expect(s.rgb).toBe("accent-sync");
    const calm = buildMyStyle({ ...EMPTY_ANSWERS, calm: 4, nature: 3 });
    expect(calm.rgb).toBeUndefined();
  });

  it("soft answers pull the accent toward neutral", () => {
    const soft = buildMyStyle({ ...EMPTY_ANSWERS, warm: 4, soft: 3, cozy: 2 });
    const vivid = buildMyStyle({ ...EMPTY_ANSWERS, warm: 4, vivid: 3 });
    expect(soft.accent_hex).not.toBe(vivid.accent_hex);
  });

  it("buildMyStyle always returns a resolvable wallpaper or scene", () => {
    const a = { ...EMPTY_ANSWERS, energetic: 4, gaming: 3, motion: 5 };
    const s = buildMyStyle(a);
    if (s.wallpaper.type === "scene") {
      expect(s.wallpaper.sceneId.length).toBeGreaterThan(0);
    } else {
      expect(s.wallpaper.id.length).toBeGreaterThan(0);
    }
  });
});
