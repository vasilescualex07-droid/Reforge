// Style Studio remix mode (NEXT_UPDATE_PLAN F-C): independent pickers for
// wallpaper / accent / mode with a live preview, saved through the backend's
// apply_style (which logs one undo entry). Pure reducer + mapping so the
// save-as-style logic is unit-tested without React (styleRemix.test.ts).

export type RemixMode = "dark" | "light";
export type RemixWallpaperType = "static" | "live" | "scene";

export interface RemixState {
  wallpaper: string | null; // public asset path for static/live, null for scene
  wallpaperType: RemixWallpaperType;
  sceneId: string | null;
  accentHex: string;
  mode: RemixMode;
}

export type RemixAction =
  | { type: "setWallpaper"; source: string; live: boolean }
  | { type: "setScene"; sceneId: string }
  | { type: "clearWallpaper" }
  | { type: "setAccent"; hex: string }
  | { type: "setMode"; mode: RemixMode };

export function remixReducer(state: RemixState, action: RemixAction): RemixState {
  switch (action.type) {
    case "setWallpaper":
      return {
        ...state,
        wallpaper: action.source,
        wallpaperType: action.live ? "live" : "static",
        sceneId: null,
      };
    case "setScene":
      return { ...state, wallpaper: null, wallpaperType: "scene", sceneId: action.sceneId };
    case "clearWallpaper":
      return { ...state, wallpaper: null, wallpaperType: "static", sceneId: null };
    case "setAccent":
      return { ...state, accentHex: action.hex };
    case "setMode":
      return { ...state, mode: action.mode };
  }
}

/** Minimal structural type for scene configs — structurally identical to the
 *  SceneConfig in lib/types.ts (kept here so the reducer test needs no UI
 *  imports). */
export interface RemixScene {
  id: string;
  name: string;
  kind: string;
  mood: string;
  speed: number;
  density: number;
  colors: string[];
}

/** The payload sent to the backend's apply_style (StyleApply shape). */
export interface RemixStylePayload {
  id: string;
  name: string;
  mode?: RemixMode;
  accent_hex?: string;
  wallpaper?: string;
  wallpaper_type?: RemixWallpaperType;
  scene?: RemixScene;
}

/** Turn a remix state into a StyleApply payload (F-C). Scenes resolve against
 *  the scene list so the payload carries a full config; an unknown scene id
 *  degrades to accent+mode only rather than failing the save. */
export function remixToStyle(
  state: RemixState,
  name: string,
  scenes: RemixScene[],
): RemixStylePayload {
  const payload: RemixStylePayload = {
    id: `remix-${Date.now()}`,
    name,
    mode: state.mode,
    accent_hex: state.accentHex,
  };
  if (state.wallpaperType === "scene") {
    const scene = scenes.find((s) => s.id === state.sceneId);
    if (scene) {
      payload.wallpaper_type = "scene";
      payload.scene = scene;
    }
  } else if (state.wallpaper) {
    payload.wallpaper = state.wallpaper;
    payload.wallpaper_type = state.wallpaperType;
  }
  return payload;
}

// ---- color helpers (shared with Makeover's Theme Studio harmonics) ---------
// These are the canonical implementations: Makeover.tsx imports them from here
// (its local copies were removed) so the harmonics UI and the remix picker can
// never drift apart. s/l are 0-100 like the original. */

export function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [h * 360, s * 100, l * 100];
}

export function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** Lightness shift by amt percentage points (-100..100). */
export function shade(hex: string, amt: number): string {
  const [h, s, l] = hexToHsl(hex);
  return hslToHex(h, s, Math.max(0, Math.min(100, l + amt)));
}

export function complement(hex: string): string {
  const [h, s, l] = hexToHsl(hex);
  return hslToHex((h + 180) % 360, s, l);
}

export function analogous(hex: string, deg: number): string {
  const [h, s, l] = hexToHsl(hex);
  return hslToHex((h + deg + 360) % 360, s, l);
}

export function triadic(hex: string, deg: number): string {
  const [h, s, l] = hexToHsl(hex);
  return hslToHex((h + deg) % 360, s, l);
}
