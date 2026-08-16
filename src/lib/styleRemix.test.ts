import { describe, expect, it } from "vitest";
import {
  remixReducer,
  remixToStyle,
  complement,
  analogous,
  triadic,
  shade,
  type RemixState,
} from "./styleRemix";

const base: RemixState = {
  wallpaper: null,
  wallpaperType: "static",
  sceneId: null,
  accentHex: "#6D7CFF",
  mode: "dark",
};

const SCENES = [
  { id: "orbital", name: "Orbital", kind: "aurora", mood: "calm", speed: 1, density: 1, colors: ["#123456", "#0f172a"] },
  { id: "magma", name: "Magma", kind: "ember", mood: "intense", speed: 1.2, density: 0.8, colors: ["#7c2d12", "#1c1917"] },
];

describe("remixReducer (Style Studio remix pickers)", () => {
  it("setWallpaper picks static vs live and clears the scene", () => {
    const s = remixReducer(base, { type: "setWallpaper", source: "/wallpapers/live/blue.mp4", live: true });
    expect(s.wallpaperType).toBe("live");
    expect(s.wallpaper).toBe("/wallpapers/live/blue.mp4");
    expect(s.sceneId).toBeNull();
    const s2 = remixReducer(s, { type: "setScene", sceneId: "orbital" });
    expect(s2.wallpaperType).toBe("scene");
    expect(s2.wallpaper).toBeNull();
    expect(s2.sceneId).toBe("orbital");
  });

  it("accent and mode update independently", () => {
    const s = remixReducer(remixReducer(base, { type: "setAccent", hex: "#FF2E88" }), { type: "setMode", mode: "light" });
    expect(s.accentHex).toBe("#FF2E88");
    expect(s.mode).toBe("light");
    expect(s.wallpaperType).toBe("static"); // untouched
  });

  it("clearWallpaper resets the wallpaper without touching accent/mode", () => {
    const s = remixReducer(
      { ...base, wallpaper: "/wallpapers/static/x.jpg", wallpaperType: "static", accentHex: "#111111" },
      { type: "clearWallpaper" },
    );
    expect(s.wallpaper).toBeNull();
    expect(s.wallpaperType).toBe("static");
    expect(s.accentHex).toBe("#111111");
  });
});

describe("remixToStyle (save-as-style)", () => {
  it("static wallpaper maps to wallpaper_type static with the path", () => {
    const st = remixToStyle(
      { ...base, wallpaper: "/wallpapers/static/gradient-blue.jpg", wallpaperType: "static" },
      "My style",
      SCENES,
    );
    expect(st.wallpaper_type).toBe("static");
    expect(st.wallpaper).toBe("/wallpapers/static/gradient-blue.jpg");
    expect(st.scene).toBeUndefined();
    expect(st.mode).toBe("dark");
    expect(st.accent_hex).toBe("#6D7CFF");
    expect(st.name).toBe("My style");
    expect(st.id.startsWith("remix-")).toBe(true);
  });

  it("live wallpaper maps to wallpaper_type live", () => {
    const st = remixToStyle(
      { ...base, wallpaper: "/wallpapers/live/magenta-pulse.mp4", wallpaperType: "live" },
      "Pulse",
      SCENES,
    );
    expect(st.wallpaper_type).toBe("live");
    expect(st.scene).toBeUndefined();
  });

  it("scene selection resolves the full scene config", () => {
    const st = remixToStyle({ ...base, wallpaperType: "scene", sceneId: "orbital" }, "Scene remix", SCENES);
    expect(st.wallpaper_type).toBe("scene");
    expect(st.scene?.kind).toBe("aurora");
    expect(st.scene?.colors).toEqual(["#123456", "#0f172a"]);
    expect(st.wallpaper).toBeUndefined();
  });

  it("unknown scene id degrades to accent+mode only rather than failing", () => {
    const st = remixToStyle({ ...base, wallpaperType: "scene", sceneId: "missing" }, "x", SCENES);
    expect(st.wallpaper_type).toBeUndefined();
    expect(st.scene).toBeUndefined();
    expect(st.accent_hex).toBe("#6D7CFF");
    expect(st.mode).toBe("dark");
  });
});

describe("harmonics helpers", () => {
  it("black is its own complement; primaries round-trip", () => {
    expect(complement("#000000")).toBe("#000000");
    expect(complement("#ffffff")).toBe("#ffffff");
    expect(analogous("#ff0000", 0)).toBe("#ff0000");
    expect(triadic("#ff0000", 120)).toBe(analogous("#ff0000", 120));
  });
  it("shade shifts lightness monotonically and clamps", () => {
    expect(shade("#808080", -50)).not.toBe("#808080");
    expect(shade("#000000", 100)).toBe("#ffffff");
    expect(shade("#000000", -100)).toBe("#000000");
  });
  it("hexToHsl/hslToHex round-trip a mid color", () => {
    expect(triadic("#6D7CFF", 0).toLowerCase()).toBe("#6d7cff");
  });
});
