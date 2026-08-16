// Style Engine types (C1.1). A style configures the whole system, not just a color.

export type WallpaperRef =
  | { type: "static"; id: string }
  | { type: "live"; id: string }
  | { type: "scene"; sceneId: string };

export interface SceneTweak {
  speed?: number;
  density?: number;
  colors?: string[];
}

export interface StyleDef {
  id: string;
  name: string;
  tagline: string;
  description: string;
  category: string;
  mood: "calm" | "energetic" | "focused" | "playful" | "cozy";
  mode: "dark" | "light";
  accent_hex: string;
  gradient: [string, string];
  wallpaper: WallpaperRef;
  sceneTweak?: SceneTweak;
  transparency: boolean;
  taskbar?: { size?: "small" | "medium" | "large"; alignment?: "center" | "left"; autohide?: boolean; color_match?: boolean };
  cursor?: "aero" | "black" | "default";
  lock_screen?: { mode: "spotlight" | "image" | "slideshow" };
  /** Whole-UI font substitution (a Windows font family name). */
  font?: string;
  /** Sound scheme guid — applied only when a real scheme exists. */
  sound_scheme?: { guid: string; name?: string };
  /** Peripheral RGB intent — capability-gated on OpenRGB. */
  rgb?: "accent-sync" | "off";
  widgets?: string[];
  tags: string[];
  /** Quiz-dimension weights used to rank this style against answers. */
  quiz: Partial<Record<QuizDim, number>>;
  /** True when generated from a wallpaper by the variant engine. */
  generated?: boolean;
  /** Source wallpaper name when generated. */
  wallpaperName?: string;
  /** Variant-axis design family (library tier only). */
  axis?: "natural" | "vivid" | "minimal";
  /** Where the style lives in the library — drives studio filters. */
  tier: "flagship" | "library" | "scene" | "personal";
  /** Curated era/collection the flagship belongs to (e.g. "Neon '80s"). */
  collection?: string;
}

export const VARIANT_AXES = ["natural", "vivid", "minimal"] as const;
export type VariantAxis = (typeof VARIANT_AXES)[number];

export const Q_DIMS = [
  "dark", "light",
  "warm", "cool", "neutral",
  "calm", "energetic", "focused", "playful",
  "nature", "city", "space", "minimal", "retro", "abstract", "gaming", "cozy",
  // v4 quiz expansion (A1.5): component-level signal
  "bold", "soft", "mono", "vivid", "motion", "widgets",
] as const;
export type QuizDim = (typeof Q_DIMS)[number];

export type QuizAnswers = Record<QuizDim, number>;

export const EMPTY_ANSWERS: QuizAnswers = Object.fromEntries(Q_DIMS.map((d) => [d, 0])) as QuizAnswers;

/** What a style actually changes — used by the detail modal. */
export function styleComponents(s: StyleDef): string[] {
  const parts = [
    `${s.mode === "dark" ? "Dark" : "Light"} mode`,
    `Accent ${s.accent_hex}`,
  ];
  if (s.wallpaper.type === "scene") parts.push("Animated wallpaper scene");
  else parts.push(s.wallpaper.type === "live" ? "Live wallpaper" : "Static wallpaper");
  if (s.taskbar) parts.push(`Taskbar (${s.taskbar.size ?? "medium"}${s.taskbar.alignment ? ", " + s.taskbar.alignment : ""})`);
  if (s.cursor) parts.push("Cursor scheme");
  if (s.lock_screen) parts.push("Lock screen");
  if (s.font) parts.push(`Font: ${s.font}`);
  if (!s.transparency) parts.push("Opaque taskbar");
  if (s.widgets?.length) parts.push(`${s.widgets.length} suggested widget${s.widgets.length > 1 ? "s" : ""}`);
  return parts;
}
