// Shared style-application path (S10.4): Makeover and Gaming both push a
// StyleDef through the same backend command, so the swap-on-game-entry uses
// exactly the same machinery — and the same composite undo entry — as the
// studio. A style apply is always reversible from History.
// S11.3 — `buildStyleApplyPayload` is exported so the style scheduler can
// persist the exact payload for a wall-clock apply.
import { call, callWithTimeout } from "./api";
import type { SceneConfig, StyleApplyPayload } from "./types";
import { getWallpaper, sceneConfigForStyle, type StyleDef } from "../styles";

const APPLY_TIMEOUT_MS = 180_000;

export interface StyleApplyResult {
  ok: boolean;
  name: string;
  notes?: string[];
}

/** Build the `apply_style` payload for a StyleDef — shared by the studio, the
 *  game-mode swap, and the style scheduler. Scene styles resolve their scene
 *  from the backend list (or the animated twin when `opts.animated`). */
export async function buildStyleApplyPayload(
  s: StyleDef,
  opts?: { animated?: boolean },
): Promise<StyleApplyPayload> {
  const w = s.wallpaper;
  let scene: SceneConfig | null = null;
  if (opts?.animated) {
    scene = sceneConfigForStyle(s);
  } else if (w.type === "scene") {
    const all = await call<SceneConfig[]>("list_wallpaper_scenes").catch(() => null);
    scene = all?.find((x) => x.id === w.sceneId) ?? null;
  }
  const wallpaper = w.type !== "scene" ? getWallpaper(w.id)?.file : undefined;
  return {
    id: s.id,
    name: s.name,
    mode: s.mode,
    accent_hex: s.accent_hex,
    transparency: s.transparency,
    wallpaper,
    wallpaper_type: w.type,
    scene: scene ? { ...scene, ...(s.sceneTweak ?? {}) } : undefined,
    font: s.font,
    sound_scheme: s.sound_scheme?.guid,
    rgb: s.rgb,
  };
}

export async function applyStyleDef(
  s: StyleDef,
  opts?: { animated?: boolean },
): Promise<StyleApplyResult> {
  const style = await buildStyleApplyPayload(s, opts);
  return callWithTimeout<StyleApplyResult>("apply_style", { style }, APPLY_TIMEOUT_MS);
}
