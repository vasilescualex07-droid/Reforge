// S6.5 — style share codes. The code must be deterministic (encode(decode(c))
// === c), cover every wallpaper/scene, reject typos via the checksum, and
// import into a valid personal-tier style that resolves and applies.
import { describe, expect, it } from "vitest";
import { ALL_STYLES } from "../styles/index";
import {
  CODE_LENGTH,
  decodeStyleCode,
  encodeStyleCode,
  refFromIndex,
  refIndex,
  shareCodeError,
} from "./shareCodes";
import { ALL_WALLPAPERS } from "../styles/wallpapers";
import { KNOWN_SCENE_IDS } from "../styles/scene_styles";

function pick(refType: "scene" | "static" | "live"): (typeof ALL_STYLES)[number] {
  const s = ALL_STYLES.find((x) =>
    refType === "scene"
      ? x.wallpaper.type === "scene"
      : x.wallpaper.type === refType,
  );
  if (!s) throw new Error(`no ${refType} style`);
  return s;
}

describe("style share codes (S6.5)", () => {
  it("encodes every style to a 10-char code (8–12 spec) and round-trips", () => {
    for (const s of ALL_STYLES) {
      const code = encodeStyleCode(s);
      expect(code, s.id).toBeTruthy();
      expect(code!.length, s.id).toBe(CODE_LENGTH);
      const back = decodeStyleCode(code!);
      expect(back, s.id).not.toBeNull();
      // Determinism: re-encoding the decoded style yields the same code.
      expect(encodeStyleCode(back!), `${s.id} round-trip`).toBe(code);
    }
  });

  it("round-trips the encoded fields exactly", () => {
    for (const s of [pick("scene"), pick("static"), pick("live")]) {
      const back = decodeStyleCode(encodeStyleCode(s)!);
      expect(back!.accent_hex.toLowerCase(), s.id).toBe(s.accent_hex.toLowerCase());
      expect(back!.mode, s.id).toBe(s.mode);
      expect(back!.transparency, s.id).toBe(s.transparency);
      expect(back!.axis, s.id).toBe(s.axis ?? "natural");
      expect(refIndex(back!.wallpaper), s.id).toBe(refIndex(s.wallpaper));
    }
  });

  it("covers the whole index space (all wallpapers + all scenes)", () => {
    for (let i = 0; i < ALL_WALLPAPERS.length; i++) {
      const ref = refFromIndex(i)!;
      expect(refIndex(ref)).toBe(i);
    }
    for (let i = 0; i < KNOWN_SCENE_IDS.length; i++) {
      const ref = refFromIndex(ALL_WALLPAPERS.length + i)!;
      expect(refIndex(ref)).toBe(ALL_WALLPAPERS.length + i);
    }
  });

  it("rejects typos, wrong lengths, and bad characters", () => {
    const good = encodeStyleCode(pick("static"))!;
    // Flip one char in the payload → checksum mismatch.
    const flipped = good.slice(0, 2) + (good[2] === "0" ? "1" : "0") + good.slice(3);
    expect(decodeStyleCode(flipped)).toBeNull();
    expect(decodeStyleCode(good.slice(0, 8))).toBeNull();
    expect(decodeStyleCode(good.slice(0, 9) + good[0])).toBeNull(); // bad checksum
    expect(decodeStyleCode(good.replace(/[0-9A-Z]/, "I"))).toBeNull(); // I not in alphabet
    expect(shareCodeError("")).toContain("Paste");
    expect(shareCodeError("abc")).toContain("10 characters");
    expect(shareCodeError(good)).toBeNull();
  });

  it("imports to a valid personal-tier style that resolves", () => {
    const s = pick("scene");
    const back = decodeStyleCode(encodeStyleCode(s)!)!;
    expect(back.tier).toBe("personal");
    expect(back.id).toMatch(/^share-/);
    const w = back.wallpaper;
    if (w.type === "scene") {
      expect(KNOWN_SCENE_IDS).toContain(w.sceneId);
    } else {
      expect(ALL_WALLPAPERS.some((x) => x.id === w.id)).toBe(true);
    }
    const st = pick("static");
    const backSt = decodeStyleCode(encodeStyleCode(st)!)!;
    const ws = backSt.wallpaper;
    if (ws.type !== "scene") {
      expect(ALL_WALLPAPERS.some((x) => x.id === ws.id)).toBe(true);
    }
  });
});
