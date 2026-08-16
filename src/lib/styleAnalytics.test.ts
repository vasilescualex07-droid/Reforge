// S6.7 — local style analytics. The store must rank most-used looks honestly
// (count, then recency), produce a true palette insight only with enough data,
// and survive a reload (it lives in localStorage).
import { beforeEach, describe, expect, it } from "vitest";
import type { StyleDef } from "../styles/types";
import { clearStyleAnalytics, getStyleAnalytics, recordStyleApplied } from "./styleAnalytics";

function fakeStyle(id: string, name: string, accentHex: string): StyleDef {
  return {
    id,
    name,
    tagline: "t",
    description: "d",
    category: "x",
    mood: "calm",
    mode: "dark",
    accent_hex: accentHex,
    gradient: ["#000000", accentHex],
    wallpaper: { type: "static", id: "abstract-glass" },
    transparency: true,
    widgets: [],
    tags: [],
    quiz: {},
    tier: "flagship",
  } as StyleDef;
}

describe("style analytics (S6.7)", () => {
  beforeEach(() => clearStyleAnalytics());

  it("ranks most-used looks by count, then recency", () => {
    const warm = fakeStyle("w", "Warm Look", "#F97316");
    const cool = fakeStyle("c", "Cool Look", "#38BDF8");
    recordStyleApplied(cool);
    recordStyleApplied(warm);
    recordStyleApplied(warm);
    const { mostUsed } = getStyleAnalytics();
    expect(mostUsed[0]).toMatchObject({ id: "w", name: "Warm Look", count: 2 });
    expect(mostUsed[1]).toMatchObject({ id: "c", count: 1 });
  });

  it("produces the warm-palette insight when warm dominates", () => {
    for (let i = 0; i < 4; i++) recordStyleApplied(fakeStyle(`w${i}`, "W", "#F97316"));
    recordStyleApplied(fakeStyle("c", "C", "#38BDF8"));
    const { insight } = getStyleAnalytics();
    expect(insight).toContain("warm palettes");
    expect(insight).toContain("4 of your last 5");
  });

  it("stays honest: no insight under 3 applies, no claim without dominance", () => {
    expect(getStyleAnalytics().insight).toBeNull();
    recordStyleApplied(fakeStyle("a", "A", "#F97316"));
    recordStyleApplied(fakeStyle("b", "B", "#38BDF8"));
    expect(getStyleAnalytics().insight).toBeNull();
    // Even split → the "no strong preference" line, not a false claim.
    recordStyleApplied(fakeStyle("c", "C", "#22C55E"));
    const { insight } = getStyleAnalytics();
    expect(insight).toContain("no strong palette preference");
  });

  it("persists across a simulated reload", () => {
    recordStyleApplied(fakeStyle("p", "Persisted", "#A78BFA"));
    const again = getStyleAnalytics();
    expect(again.entries[0]).toMatchObject({ id: "p" });
    expect(again.mostUsed[0]).toMatchObject({ id: "p", count: 1 });
  });
});
