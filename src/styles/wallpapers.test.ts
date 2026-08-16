import { describe, expect, it } from "vitest";
import { ALL_WALLPAPERS, WALLPAPER_COUNT, domColor, getWallpaper } from "./wallpapers";

const HEX = /^#[0-9a-fA-F]{6}$/;

describe("wallpaper manifest", () => {
  it("has the expected counts", () => {
    expect(WALLPAPER_COUNT.static).toBe(60);
    expect(WALLPAPER_COUNT.live).toBe(58);
    expect(WALLPAPER_COUNT.total).toBe(118);
    expect(ALL_WALLPAPERS).toHaveLength(118);
  });

  it("has no duplicate ids (regression: abstract-waves / purple-nebula existed in both bundles)", () => {
    const ids = ALL_WALLPAPERS.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every entry has a valid hex dominant color and a file path", () => {
    for (const w of ALL_WALLPAPERS) {
      expect(w.dominantColor).toMatch(HEX);
      expect(w.file).toMatch(/^\/wallpapers\/(static|live)\//);
    }
  });

  it("domColor derives keyword hues", () => {
    expect(domColor("blue-aurora", "Cool")).toBe("#3B82C4");
    expect(domColor("ink-swirl", "Dark")).toBe("#1C1C24");
    expect(domColor("gradient-smooth", "Abstract")).toBe("#7C6CF0");
    expect(domColor("totally-unknown", "Space")).toBe("#5E5BE0");
  });

  it("getWallpaper finds entries by id", () => {
    expect(getWallpaper("blue-aurora")?.type).toBe("live");
    expect(getWallpaper("gradient-blue")?.type).toBe("static");
    expect(getWallpaper("nope")).toBeUndefined();
  });

  it("deduped live ids resolve to their files", () => {
    const dupLive = getWallpaper("abstract-waves-live");
    const dupStatic = getWallpaper("abstract-waves");
    expect(dupLive?.file).toBe("/wallpapers/live/abstract-waves.mp4");
    expect(dupStatic?.file).toBe("/wallpapers/static/abstract-waves.jpg");
    expect(dupLive?.id).not.toBe(dupStatic?.id);
  });
});
