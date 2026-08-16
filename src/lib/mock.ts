// Mock backend — browser-preview only (NEXT_UPDATE_PLAN Phase B1).
// This module only ships in dev/preview: api.ts dynamic-imports it when
// IS_TAURI is false, so the production Tauri bundle never contains it.
// The command set and store mirror the Rust backend (api.test.ts guards this).
import type {
  AutomationConfig,
  BundleInfo,
  BundleManifest,
  ClipItem,
  DisplayProfile,
  EngineState,
  FontSubstitution,
  LockScreenState,
  MacroRule,
  MaintenanceReport,
  MoveOp,
  Pack,
  PerfRecord,
  PerfSnapshot,
  SceneConfig,
  ScreensaverConfig,
  ScreensaverRegistry,
  SmartFolder,
  Snapshot,
  SoundSchemeInfo,
  TaskbarState,
  ThemeState,
  TranscodeConfig,
  UndoEntry,
  VideoWallpaper,
  VpnConnection,
  WallpaperHistoryEntry,
  WallpaperSlideshowConfig,
  WallpaperState,
  WidgetConfig,
  WidgetsSettings,
  AccessibilityState,
  FocusSession,
  GameProfile,
  PowerState,
  UpdateConfig,
  UpdateCheck,
  StagedUpdate,
  BiggestFile,
  BigDupeGroup,
  CleanNowItem,
  StorageConfig,
  UnusedFile,
} from "./types";
import { fmt } from "./format";

// ---------------------------------------------------------------------------
// Mock backend (browser preview mode)
// ---------------------------------------------------------------------------

const PACKS: Pack[] = [
  {
    id: "midnight-rain",
    name: "Midnight Rain",
    description: "Deep indigo nights with a calm blue accent. Dark, focused, premium.",
    mode: "dark",
    accent_hex: "#6D7CFF",
    gradient: ["#0B1026", "#2A3B7C"],
    category: "Calm",
  },
  {
    id: "sunset-boulevard",
    name: "Sunset Boulevard",
    description: "Warm oranges melting into dusk. Cozy and energetic.",
    mode: "dark",
    accent_hex: "#FF7B54",
    gradient: ["#1A0E2E", "#E4572E"],
    category: "Energetic",
  },
  {
    id: "nordic-frost",
    name: "Nordic Frost",
    description: "Icy light blues on a crisp, bright desktop. Clean and airy.",
    mode: "light",
    accent_hex: "#2E7CF6",
    gradient: ["#EAF4FF", "#A8C8F0"],
    category: "Minimal",
  },
  {
    id: "forest-calm",
    name: "Forest Calm",
    description: "Mossy greens and deep teals. Easy on the eyes, grounded.",
    mode: "dark",
    accent_hex: "#34D399",
    gradient: ["#071A12", "#14532D"],
    category: "Nature",
  },
  {
    id: "retro-wave",
    name: "Retro Wave",
    description: "Synthwave magenta and cyan, straight from 1986.",
    mode: "dark",
    accent_hex: "#FF2E88",
    gradient: ["#0D0221", "#7B2FF7"],
    category: "Retro",
  },
  {
    id: "minimal-mono",
    name: "Minimal Mono",
    description: "Greyscale restraint. Nothing distracts from your work.",
    mode: "light",
    accent_hex: "#111827",
    gradient: ["#F8FAFC", "#D1D5DB"],
    category: "Minimal",
  },
];

export const SCENES: SceneConfig[] = [
  // A6.1 — new kinds mirror the backend builtins
  { id: "midnight-rain", name: "Midnight Rain", kind: "rain", mood: "calm", speed: 0.8, density: 1.2, colors: ["#60a5fa", "#38bdf8", "#0f172a"] },
  { id: "firefly-grove", name: "Firefly Grove", kind: "fireflies", mood: "nature", speed: 0.5, density: 0.9, colors: ["#fde047", "#a3e635", "#1e293b"] },
  { id: "blizzard-drift", name: "Blizzard Drift", kind: "snowfall-wind", mood: "seasonal", speed: 1.1, density: 1.3, colors: ["#f8fafc", "#e0f2fe", "#1e3a8a"] },
  { id: "bokeh-aurora", name: "Bokeh Bloom", kind: "bokeh", mood: "space", speed: 0.4, density: 0.8, colors: ["#c084fc", "#f472b6", "#38bdf8"] },
  { id: "smoke-ember", name: "Smoke & Ember", kind: "smoke", mood: "energetic", speed: 0.9, density: 0.9, colors: ["#fb923c", "#ef4444", "#facc15"] },
  { id: "ocean-depth", name: "Ocean Depth", kind: "waves-3d", mood: "nature", speed: 0.8, density: 1.0, colors: ["#0ea5e9", "#06b6d4", "#0f172a"] },
  { id: "aurora-drift", name: "Aurora Drift", kind: "aurora", mood: "calm", speed: 0.6, density: 1.0, colors: ["#38bdf8", "#818cf8", "#c084fc"] },
  { id: "deep-tide", name: "Deep Tide", kind: "waves", mood: "calm", speed: 0.7, density: 1.0, colors: ["#0ea5e9", "#1d4ed8", "#0f172a"] },
  { id: "moonlit-dunes", name: "Moonlit Dunes", kind: "particles", mood: "calm", speed: 0.5, density: 0.7, colors: ["#fde68a", "#f8fafc", "#64748b"] },
  { id: "misty-forest", name: "Misty Forest", kind: "parallax", mood: "calm", speed: 0.5, density: 1.0, colors: ["#10b981", "#065f46", "#022c22"] },
  { id: "neon-surge", name: "Neon Surge", kind: "particles", mood: "energetic", speed: 1.6, density: 1.5, colors: ["#f0abfc", "#22d3ee", "#a78bfa"] },
  { id: "synth-grid", name: "Synth Grid", kind: "geometric", mood: "energetic", speed: 1.3, density: 1.2, colors: ["#f472b6", "#818cf8", "#0f172a"] },
  { id: "ember-storm", name: "Ember Storm", kind: "embers", mood: "energetic", speed: 1.4, density: 1.3, colors: ["#fb923c", "#ef4444", "#facc15"] },
  { id: "retro-sunset", name: "Retro Sunset", kind: "geometric", mood: "energetic", speed: 0.9, density: 1.1, colors: ["#ff2e88", "#7b2ff7", "#fbbf24"] },
  { id: "meadow-breeze", name: "Meadow Breeze", kind: "particles", mood: "nature", speed: 0.6, density: 0.8, colors: ["#a3e635", "#84cc16", "#166534"] },
  { id: "coral-reef", name: "Coral Reef", kind: "waves", mood: "nature", speed: 0.8, density: 1.1, colors: ["#2dd4bf", "#f472b6", "#0ea5e9"] },
  { id: "autumn-leaves", name: "Autumn Drift", kind: "parallax", mood: "nature", speed: 0.7, density: 1.2, colors: ["#f59e0b", "#ea580c", "#78350f"] },
  { id: "river-glow", name: "River Glow", kind: "embers", mood: "nature", speed: 0.6, density: 0.9, colors: ["#34d399", "#059669", "#1e293b"] },
  { id: "stardust", name: "Stardust", kind: "stars", mood: "space", speed: 0.5, density: 1.0, colors: ["#e2e8f0", "#818cf8", "#fbbf24"] },
  { id: "nebula-bloom", name: "Nebula Bloom", kind: "aurora", mood: "space", speed: 0.7, density: 1.2, colors: ["#c084fc", "#6366f1", "#f472b6"] },
  { id: "orbital", name: "Orbital", kind: "geometric", mood: "space", speed: 0.8, density: 0.9, colors: ["#38bdf8", "#e2e8f0", "#111827"] },
  { id: "comet-trail", name: "Comet Trail", kind: "stars", mood: "space", speed: 1.0, density: 1.1, colors: ["#f8fafc", "#60a5fa", "#f472b6"] },
  { id: "winter-snow", name: "Winter Snowfall", kind: "particles", mood: "seasonal", speed: 0.7, density: 1.4, colors: ["#f8fafc", "#bae6fd", "#0f172a"] },
  { id: "spring-blossom", name: "Spring Blossom", kind: "parallax", mood: "seasonal", speed: 0.6, density: 1.1, colors: ["#f9a8d4", "#fda4af", "#0f172a"] },
  { id: "holiday-lights", name: "Holiday Lights", kind: "stars", mood: "seasonal", speed: 0.8, density: 1.2, colors: ["#fbbf24", "#34d399", "#ef4444"] },
  { id: "cherry-fall", name: "Cherry Petals", kind: "particles", mood: "seasonal", speed: 0.7, density: 1.0, colors: ["#f9a8d4", "#f472b6", "#1e293b"] },
  // S5 — catalog expansion (26 → 48): mirrors builtin_scenes() in wallpaper_engine.rs.
  { id: "digital-rain", name: "Digital Rain", kind: "matrix", mood: "energetic", speed: 1.2, density: 1.5, colors: ["#22c55e", "#4ade80", "#052e16"] },
  { id: "cipher-fall", name: "Cipher Fall", kind: "matrix", mood: "focused", speed: 0.9, density: 1.3, colors: ["#22d3ee", "#e2e8f0", "#0f172a"] },
  { id: "amber-rain", name: "Amber Rain", kind: "rain", mood: "cozy", speed: 0.7, density: 1.0, colors: ["#f59e0b", "#fbbf24", "#1c1917"] },
  { id: "violet-rain", name: "Violet Rain", kind: "rain", mood: "calm", speed: 0.6, density: 1.1, colors: ["#a78bfa", "#c4b5fd", "#1e1b4b"] },
  { id: "ember-fireflies", name: "Ember Fireflies", kind: "fireflies", mood: "cozy", speed: 0.5, density: 0.9, colors: ["#fb923c", "#fde047", "#1c1917"] },
  { id: "glacier-drift", name: "Glacier Drift", kind: "snowfall-wind", mood: "calm", speed: 0.9, density: 1.2, colors: ["#bae6fd", "#e0f2fe", "#0c4a6e"] },
  { id: "aurora-snow", name: "Aurora Snow", kind: "snowfall-wind", mood: "playful", speed: 0.8, density: 1.1, colors: ["#c4b5fd", "#f8fafc", "#312e81"] },
  { id: "bokeh-city", name: "Bokeh City", kind: "bokeh", mood: "energetic", speed: 0.6, density: 1.1, colors: ["#f472b6", "#22d3ee", "#0f172a"] },
  { id: "incense-smoke", name: "Incense Smoke", kind: "smoke", mood: "calm", speed: 0.4, density: 0.8, colors: ["#d6d3d1", "#fbbf24", "#292524"] },
  { id: "crimson-tide", name: "Crimson Tide", kind: "waves-3d", mood: "energetic", speed: 1.1, density: 1.2, colors: ["#ef4444", "#f97316", "#450a0a"] },
  { id: "aurora-boreal", name: "Aurora Boreal", kind: "aurora", mood: "calm", speed: 0.7, density: 1.1, colors: ["#34d399", "#818cf8", "#0f172a"] },
  { id: "starlight-sea", name: "Starlight Sea", kind: "waves", mood: "calm", speed: 0.6, density: 0.9, colors: ["#1d4ed8", "#60a5fa", "#fbbf24"] },
  { id: "hologram-grid", name: "Hologram Grid", kind: "geometric", mood: "energetic", speed: 1.2, density: 1.1, colors: ["#22d3ee", "#e879f9", "#0f172a"] },
  { id: "pine-snow", name: "Pine Snow", kind: "parallax", mood: "calm", speed: 0.6, density: 1.0, colors: ["#4ade80", "#e2e8f0", "#022c22"] },
  { id: "cloud-veil", name: "Cloud Veil", kind: "parallax", mood: "calm", speed: 0.5, density: 0.9, colors: ["#cbd5e1", "#f8fafc", "#1e293b"] },
  { id: "gold-dust", name: "Gold Dust", kind: "particles", mood: "playful", speed: 0.8, density: 1.0, colors: ["#fbbf24", "#fde68a", "#1c1917"] },
  { id: "cosmic-dust", name: "Cosmic Dust", kind: "particles", mood: "calm", speed: 0.5, density: 0.9, colors: ["#e2e8f0", "#818cf8", "#fbbf24"] },
  { id: "rose-mist", name: "Rose Mist", kind: "particles", mood: "playful", speed: 0.6, density: 0.9, colors: ["#fda4af", "#f9a8d4", "#1e293b"] },
  { id: "ember-wind", name: "Ember Wind", kind: "embers", mood: "energetic", speed: 1.2, density: 1.1, colors: ["#f97316", "#ef4444", "#1c1917"] },
  { id: "forge-glow", name: "Forge Glow", kind: "embers", mood: "cozy", speed: 0.6, density: 0.8, colors: ["#fb923c", "#facc15", "#1c1917"] },
  { id: "shooting-stars", name: "Shooting Stars", kind: "stars", mood: "energetic", speed: 1.1, density: 1.2, colors: ["#f8fafc", "#60a5fa", "#7c3aed"] },
  { id: "polaris", name: "Polaris", kind: "stars", mood: "calm", speed: 0.6, density: 1.0, colors: ["#e2e8f0", "#93c5fd", "#1e1b4b"] },
];

const store = {
  theme: { accent_hex: "#6D7CFF", mode: "dark", transparency: true, color_prevalence: true } as ThemeState,
  engine: { active: false, frozen: false, scene: null, media: null, static_wallpaper: "" } as EngineState,
  customScenes: [] as SceneConfig[],
  widgets: [] as WidgetConfig[],
  fun: {
    enabled: [] as string[],
    configs: {} as Record<string, Record<string, unknown>>,
    achievements: [] as string[],
    counts: {} as Record<string, number>,
  },
  clips: [] as ClipItem[],
  macros: [] as MacroRule[],
  smartFolders: [] as SmartFolder[],
  displayProfiles: [] as DisplayProfile[],
  automation: {
    weekly_junk: true, monthly_dupes: false, auto_reapply_theme: true, last_weekly_run: 0, last_monthly_run: 0,
    blue_light_on: false, blue_light_intensity: 0.3,
    blue_light_schedule: false, blue_light_start: "19:00", blue_light_end: "07:00",
    style_schedule: [], created_at: 0,
  } as AutomationConfig,
  updateConfig: {
    manifest_url: "https://reforge.app/releases/latest.json",
    check_on_startup: false,
  } as UpdateConfig,
  stagedUpdate: null as StagedUpdate | null,
  /** Test hook: when set, check_for_update returns it instead of the offline error. */
  mockUpdateResult: null as UpdateCheck | null,
  perfHistory: [] as PerfRecord[],
  wallpaper: {
    current: "",
    monitor_supported: true,
    monitors: [{ id: "\\\\.\\DISPLAY1", wallpaper: "" }],
  } as WallpaperState,
  packs: PACKS,
  transcodeConfig: { preset: "balanced" } as TranscodeConfig,
  screensaver: { enabled: false, timeout_secs: 300, scene: null } as ScreensaverConfig,
  screensaverRegistry: { active: false, timeout_secs: 300 } as ScreensaverRegistry,
  screensaverPreviewedAt: 0 as number,
  widgetsSettings: { autohide_fullscreen: true } as WidgetsSettings,
  gameProfiles: [] as GameProfile[],
  power: {
    battery: { percent: 84, on_ac: true, charging: true },
    battery_health: { health_pct: 91, design_mwh: 46800, full_mwh: 42500, cycle_count: 213 },
    plans: [
      { guid: "381b4222-f694-41f0-9685-ff5bb260df2e", name: "Balanced", hint: "Best blend of performance and battery life", active: true },
      { guid: "a1841308-3541-4fab-bc81-f71556f20b4a", name: "Best power efficiency", hint: "Power saver — maximum battery life", active: false },
      { guid: "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c", name: "Best performance", hint: "High performance — maximum speed", active: false },
    ],
    screen_off_ac_min: 10,
    screen_off_dc_min: 5,
    hibernate_enabled: true,
    hibernate_supported: true,
  } as PowerState,
  focusSession: { active: false, ends_at_ts: 0, minutes: 0, dnd_on: false } as FocusSession,
  accessibility: {
    high_contrast: false,
    animations_off: false,
    cursor_size: 32,
    text_scale_pct: 100,
    color_filter: { active: false, filter_type: 0 },
  } as AccessibilityState,
  junk: [
    { id: "temp", label: "User temp files", path: "C:\\Users\\you\\AppData\\Local\\Temp", size: 1_862_000_000, file_count: 4821, admin_required: false },
    { id: "edge_cache", label: "Edge browser cache", path: "C:\\Users\\you\\AppData\\Local\\Microsoft\\Edge\\User Data\\Default\\Cache", size: 921_000_000, file_count: 1903, admin_required: false },
    { id: "chrome_cache", label: "Chrome browser cache", path: "C:\\Users\\you\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Cache", size: 1_204_000_000, file_count: 2210, admin_required: false },
    { id: "thumbnail_cache", label: "Explorer thumbnail cache", path: "C:\\Users\\you\\AppData\\Local\\Microsoft\\Windows\\Explorer", size: 412_000_000, file_count: 88, admin_required: false },
    { id: "crash_dumps", label: "Crash dumps", path: "C:\\Users\\you\\AppData\\Local\\CrashDumps", size: 3_120_000_000, file_count: 141, admin_required: false },
    { id: "npm_cache", label: "npm cache", path: "C:\\Users\\you\\AppData\\Local\\npm-cache", size: 508_000_000, file_count: 1220, admin_required: false },
    { id: "windows_temp", label: "Windows temp (admin)", path: "C:\\Windows\\Temp", size: 1_480_000_000, file_count: 630, admin_required: true },
    { id: "update_cache", label: "Windows Update cache (admin)", path: "C:\\Windows\\SoftwareDistribution\\Download", size: 2_240_000_000, file_count: 174, admin_required: true },
  ],
  startup: [
    { name: "Steam", command: "\"C:\\Program Files (x86)\\Steam\\steam.exe\" -silent", location: "HKCU Run", enabled: true, impact: 8, admin_required: false },
    { name: "Discord", command: "\"C:\\Users\\you\\AppData\\Local\\Discord\\app.exe\" --start-minimized", location: "HKCU Run", enabled: true, impact: 7, admin_required: false },
    { name: "Spotify", command: "\"C:\\Users\\you\\AppData\\Local\\Spotify\\Spotify.exe\" --autostart", location: "HKCU Run", enabled: true, impact: 4, admin_required: false },
    { name: "OneDrive", command: "\"C:\\Program Files\\Microsoft OneDrive\\OneDrive.exe\" /background", location: "HKCU Run", enabled: true, impact: 6, admin_required: false },
    { name: "NVIDIA GeForce Experience", command: "\"C:\\Program Files\\NVIDIA Corporation\\NVIDIA GeForce Experience\\NVIDIA GeForce Experience.exe\"", location: "HKLM Run", enabled: true, impact: 9, admin_required: true },
    { name: "Startup Shortcut.lnk", command: "C:\\Users\\you\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\Startup Shortcut.lnk", location: "Startup folder", enabled: true, impact: 2, admin_required: false },
  ],
  undo: [] as UndoEntry[],
  snapshots: [] as Snapshot[],
  reports: [] as MaintenanceReport[],
  bundles: [
    {
      id: "studio-blue",
      name: "Studio Blue",
      version: "1.0",
      author: "Reforge Community",
      description: "Calm indigo accent, dark mode, deep-blue gradient wallpaper and a left-aligned small taskbar.",
      component_count: 5,
      applied: false,
    },
    {
      id: "amber-retro",
      name: "Amber Retro",
      version: "2.1",
      author: "PixelPioneer",
      description: "Warm amber on near-black with a geometric animated scene and retro sound scheme.",
      component_count: 4,
      applied: false,
    },
  ] as BundleInfo[],
  manifests: new Map<string, BundleManifest>([
    ["studio-blue", {
      id: "studio-blue",
      name: "Studio Blue",
      version: "1.0",
      author: "Reforge Community",
      description: "Calm indigo accent, dark mode, deep-blue gradient wallpaper and a left-aligned small taskbar.",
      thumbnail: "",
      components: [
        { type: "accent", hex: "#6D7CFF" },
        { type: "theme_mode", mode: "dark" },
        { type: "wallpaper", asset: "wp_studio.png" },
        { type: "taskbar", size: "small", alignment: "left" },
        { type: "cursor", scheme: "aero" },
      ],
    }],
    ["amber-retro", {
      id: "amber-retro",
      name: "Amber Retro",
      version: "2.1",
      author: "PixelPioneer",
      description: "Warm amber on near-black with a geometric animated scene and retro sound scheme.",
      thumbnail: "",
      components: [
        { type: "accent", hex: "#F59E0B" },
        { type: "theme_mode", mode: "dark" },
        { type: "scene", kind: "geometric", speed: 1.3, density: 1.2, colors: ["#f472b6", "#818cf8", "#f59e0b"] },
        { type: "sound_scheme", guid: "{f2e1dd92-4b1a-4f7e-8c5c-5d6b4c3a5d4b}" },
      ],
    }],
  ]),
  vpn: [
    { name: "Work VPN", server_address: "vpn.corp.example.com", status: "disconnected", type: "PPTP" },
    { name: "Home Tunnel", server_address: "home.example.net", status: "disconnected", type: "L2TP/IPsec" },
  ] as VpnConnection[],
  wallpaperHistory: [
    { ts: Date.now() - 86400000 * 2, path: "reforge://wallpapers/midnight-rain.png", monitor_id: null },
    { ts: Date.now() - 86400000 * 5, path: "C:\\Users\\you\\Pictures\\mountain.jpg", monitor_id: null },
  ] as WallpaperHistoryEntry[],
  slideshow: { enabled: false, folder: "", interval_minutes: 10, shuffle: false, next_rotation_ts: null, last_applied: null, favorites: [], day_night_filter: false } as WallpaperSlideshowConfig,
  taskbar: { size: "medium", alignment: "center", autohide: false, color_match: false } as TaskbarState,
  // S5.4 — the real schemes every stock Win10/11 has: `.Default` (Windows
  // Default, sometimes stored under the canonical GUID) and `.None` (No Sounds).
  sounds: [
    { guid: ".Default", name: "Windows Default", current: true, builtin: true },
    { guid: ".None", name: "No Sounds", current: false, builtin: false },
    { guid: "{f2e1dd92-4b1a-4f7e-8c5c-5d6b4c3a5d4b}", name: "Windows Default", current: false, builtin: true },
  ] as SoundSchemeInfo[],
  fonts: [] as FontSubstitution[],
  lockscreen: { mode: "spotlight", image_path: null, slideshow_folder: null, slideshow_interval_secs: null, slideshow_shuffle: null, hide_apps: null } as LockScreenState,
  videoWallpapers: [
    { path: "C:\\Users\\you\\AppData\\Roaming\\com.reforge\\wallpapers\\aurora_loop.mp4", kind: "video", width: 1920, height: 1080, name: "aurora_loop" },
  ] as VideoWallpaper[],
  freedSoFar: 0,
  now: Date.now(),
  onboarding: { wizard_seen: false } as { wizard_seen: boolean },
  favorites: [] as string[],
  // S14 — storage liberation
  storageConfig: {
    unused_days: 180,
    unused_min_mb: 10,
    safe_temp: true,
    safe_update_cache: true,
    safe_recycle_bin: true,
    safe_browser_caches: true,
    safe_installers: true,
    exclusions: [] as string[],
    dry_run: true,
    auto_clean: "off",
  } as StorageConfig,
  recycleBinSize: 2_400_000_000 as number,
  unusedFiles: [] as UnusedFile[],
};

// S5.4 — the canonical "Windows Default" scheme GUID. Mirror of the Rust
// resolver (sounds.rs): machines store Windows Default under either this GUID
// or the plain name `.Default` — treat them as aliases (K7).
const DEFAULT_SCHEME_GUID = "{f2e1dd92-4b1a-4f7e-8c5c-5d6b4c3a5d4b}";

function resolveSchemeGuid(guid: string): string {
  if (guid.toLowerCase() !== DEFAULT_SCHEME_GUID.toLowerCase()) return guid;
  return store.sounds.some((x) => x.guid === guid) ? guid : ".Default";
}

// ---------------------------------------------------------------------------
// Mock store persistence (B2) — browser preview survives reloads.
// ---------------------------------------------------------------------------

const STORE_KEY = "reforge-mock-v1";

function persistStore() {
  try {
    const data: Record<string, unknown> = { ...store };
    data.manifests = Array.from(store.manifests.entries());
    localStorage.setItem(STORE_KEY, JSON.stringify(data));
  } catch {
    /* storage unavailable — preview just won't persist */
  }
}

function loadStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (Array.isArray(data.manifests)) store.manifests = new Map(data.manifests as [string, BundleManifest][]);
    for (const k of Object.keys(store)) {
      if (k === "manifests") continue;
      if (k in data) (store as Record<string, unknown>)[k] = data[k];
    }
  } catch {
    /* corrupted / version mismatch — start fresh */
  }
}

loadStore();

const perf = { cpu: 23.4, ramFree: 55.6 };

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function pushUndo(kind: string, description: string, revertible: boolean, data: Record<string, unknown>) {
  store.undo.unshift({ id: uid(), ts: Date.now(), kind, description, revertible, undone: false, data });
}

function delay(ms = 250): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// S14 — the curated safe-clean list, mirroring cleanup.rs safe_clean_items:
// config toggles pick which categories are eligible; regenerable junk is
// "permanent", old installers are "trash" (staged, undoable).
const MB = 1024 * 1024;

function safeCleanItems(): CleanNowItem[] {
  const cfg = store.storageConfig;
  const out: CleanNowItem[] = [];
  for (const j of store.junk) {
    const eligible = (() => {
      switch (j.id) {
        case "temp":
        case "windows_temp":
        case "npm_cache":
        case "crash_dumps":
          return cfg.safe_temp;
        case "update_cache":
          return cfg.safe_update_cache;
        case "edge_cache":
        case "chrome_cache":
        case "thumbnail_cache":
          return cfg.safe_browser_caches;
        default:
          return false;
      }
    })();
    if (!eligible) continue;
    out.push({ ...j, action: "permanent" });
  }
  if (cfg.safe_recycle_bin && store.recycleBinSize > 0) {
    out.push({
      id: "recycle_bin", label: "Recycle Bin", path: "Recycle Bin",
      size: store.recycleBinSize, file_count: 1, action: "permanent", admin_required: false,
    });
  }
  if (cfg.safe_installers) {
    out.push(
      { id: "installer_vlc-3.0.20.exe", label: "vlc-3.0.20.exe", path: "C:\\Users\\you\\Downloads\\vlc-3.0.20.exe", size: 84_000_000, file_count: 1, action: "trash", admin_required: false },
      { id: "installer_obs-30.0.2.exe", label: "obs-30.0.2.exe", path: "C:\\Users\\you\\Downloads\\obs-30.0.2.exe", size: 143_000_000, file_count: 1, action: "trash", admin_required: false },
    );
  }
  return out.sort((a, b) => b.size - a.size);
}

// S14 static scan fixtures (browser preview only — the real commands scan
// the live machine).
const BIGGEST_FIXTURES: BiggestFile[] = [
  { path: "C:\\Users\\you\\Videos\\edit-final.mp4", size: 3_800_000_000, modified: Date.now() / 1000 - 86400 * 3, category: "Video" },
  { path: "C:\\Users\\you\\Videos\\raw-capture.mkv", size: 2_900_000_000, modified: Date.now() / 1000 - 86400 * 21, category: "Video" },
  { path: "C:\\Users\\you\\Downloads\\linux-6.1.iso", size: 1_850_000_000, modified: Date.now() / 1000 - 86400 * 60, category: "Disk image" },
  { path: "C:\\Users\\you\\Pictures\\hdr-photo-archive.zip", size: 1_120_000_000, modified: Date.now() / 1000 - 86400 * 400, category: "Archive" },
  { path: "C:\\Users\\you\\Downloads\\setup-2024.exe", size: 610_000_000, modified: Date.now() / 1000 - 86400 * 300, category: "Installer" },
  { path: "C:\\Users\\you\\AppData\\Local\\Temp\\big-temp.bin", size: 420_000_000, modified: Date.now() / 1000 - 86400 * 2, category: "Other" },
];

const UNUSED_FIXTURES: UnusedFile[] = [
  { path: "C:\\Users\\you\\Downloads\\project-backup-2023.zip", size: 960_000_000, modified: Date.now() / 1000 - 86400 * 400, days_old: 400, category: "Archive" },
  { path: "C:\\Users\\you\\Downloads\\old-setup.exe", size: 180_000_000, modified: Date.now() / 1000 - 86400 * 250, days_old: 250, category: "Installer" },
  { path: "C:\\Users\\you\\Documents\\notes-2022.docx", size: 24_000_000, modified: Date.now() / 1000 - 86400 * 500, days_old: 500, category: "Document" },
  { path: "C:\\Users\\you\\Downloads\\recent.pdf", size: 88_000_000, modified: Date.now() / 1000 - 86400 * 10, days_old: 10, category: "Document" },
  { path: "C:\\Users\\you\\Pictures\\old-screen-recording.mp4", size: 1_400_000_000, modified: Date.now() / 1000 - 86400 * 220, days_old: 220, category: "Video" },
];

const BIG_DUPE_FIXTURES: BigDupeGroup[] = [
  { id: "dupe-videos", wasted_bytes: 2_100_000_000, file_count: 6, sample_paths: ["C:\\Users\\you\\Videos\\clip-1.mp4", "C:\\Users\\you\\Downloads\\clip-1 (copy).mp4"] },
  { id: "dupe-photos", wasted_bytes: 860_000_000, file_count: 41, sample_paths: ["C:\\Users\\you\\Pictures\\IMG_0012.jpg", "C:\\Users\\you\\Pictures\\Exports\\IMG_0012.jpg"] },
  { id: "dupe-docs", wasted_bytes: 210_000_000, file_count: 12, sample_paths: ["C:\\Users\\you\\Documents\\report-final.pdf", "C:\\Users\\you\\Downloads\\report-final (1).pdf"] },
];

async function mockCallInner<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  await delay(200);
  const s = store;
  switch (cmd) {
    case "get_theme_state":
      return { ...s.theme } as T;
    case "set_accent_color": {
      const before = s.theme.accent_hex;
      s.theme = { ...s.theme, accent_hex: args.hex as string, color_prevalence: true };
      pushUndo("accent", `Accent color → ${args.hex}`, true, { before, after: args.hex });
      return { ...s.theme } as T;
    }
    case "set_theme_mode": {
      const before = s.theme.mode;
      s.theme = { ...s.theme, mode: args.mode as "dark" | "light" };
      pushUndo("mode", `Theme mode → ${args.mode}`, true, { before, after: args.mode });
      return { ...s.theme } as T;
    }
    case "set_transparency": {
      const before = s.theme.transparency;
      s.theme = { ...s.theme, transparency: args.on as boolean };
      pushUndo("transparency", `Taskbar transparency ${args.on ? "on" : "off"}`, true, { before, after: args.on });
      return { ...s.theme } as T;
    }
    case "get_wallpapers":
      return { ...s.wallpaper, monitors: s.wallpaper.monitors.map((m) => ({ ...m })) } as T;
    case "set_wallpaper": {
      const before = s.wallpaper.current;
      s.wallpaper = { ...s.wallpaper, current: args.path as string };
      pushUndo("wallpaper", `Wallpaper → ${args.path}`, true, { before, after: args.path });
      return { ...s.wallpaper } as T;
    }
    case "set_monitor_wallpaper": {
      const before = s.wallpaper.current;
      s.wallpaper = {
        ...s.wallpaper,
        current: args.path as string,
        monitors: s.wallpaper.monitors.map((m) => (m.id === args.monitor_id ? { ...m, wallpaper: args.path as string } : m)),
      };
      pushUndo("wallpaper", `Wallpaper → ${args.path} (per-monitor)`, true, { before, after: args.path });
      return { ...s.wallpaper } as T;
    }
    case "list_packs":
      return s.packs.map((p) => ({ ...p })) as T;
    case "apply_pack": {
      const pack = s.packs.find((p) => p.id === args.id);
      if (!pack) throw new Error("Unknown pack");
      pushUndo("accent", `[${pack.name}] Accent → ${pack.accent_hex}`, true, { before: s.theme.accent_hex, after: pack.accent_hex });
      pushUndo("mode", `[${pack.name}] Mode → ${pack.mode}`, true, { before: s.theme.mode, after: pack.mode });
      const beforeWp = s.wallpaper.current;
      s.wallpaper = { ...s.wallpaper, current: `reforge://wallpapers/${pack.id}.png` };
      pushUndo("wallpaper", `[${pack.name}] Wallpaper applied`, true, { before: beforeWp, after: s.wallpaper.current });
      s.theme = { ...s.theme, accent_hex: pack.accent_hex, mode: pack.mode as "dark" | "light", color_prevalence: true };
      return { ...pack } as T;
    }
    case "scan_junk":
      return { items: s.junk.map((j) => ({ ...j })), total_bytes: s.junk.reduce((a, j) => a + j.size, 0), scanned_at: Date.now() } as T;
    case "clean_junk": {
      const ids = new Set(args.ids as string[]);
      let freed = 0;
      let deleted = 0;
      const skipped: string[] = [];
      s.junk = s.junk.filter((j) => {
        if (!ids.has(j.id)) return true;
        if (j.admin_required) {
          skipped.push(j.label);
          return true;
        }
        freed += j.size;
        deleted += j.file_count;
        return false;
      });
      s.freedSoFar += freed;
      pushUndo("junk_clean", `Cleaned ${fmt(freed)} of junk (${deleted} files)`, false, { freed, deleted });
      return { freed_bytes: freed, deleted_count: deleted, failed: [], skipped_admin: skipped } as T;
    }
    // ---- S14 storage liberation ----
    case "scan_storage_radar":
      return [
        {
          label: "C:", mount: "C:\\", total: 512_000_000_000, free: 96_400_000_000, used: 415_600_000_000,
          top_level: [
            { name: "Windows", path: "C:\\Windows", size: 38_200_000_000, file_count: 112_000 },
            { name: "Users", path: "C:\\Users", size: 210_500_000_000, file_count: 480_000 },
            { name: "Program Files", path: "C:\\Program Files", size: 62_800_000_000, file_count: 92_000 },
            { name: "ProgramData", path: "C:\\ProgramData", size: 24_900_000_000, file_count: 61_000 },
          ],
        },
        {
          label: "D:", mount: "D:\\", total: 1_000_000_000_000, free: 812_000_000_000, used: 188_000_000_000,
          top_level: [
            { name: "Games", path: "D:\\Games", size: 140_000_000_000, file_count: 220_000 },
            { name: "Media", path: "D:\\Media", size: 31_000_000_000, file_count: 8_400 },
          ],
        },
      ] as T;
    case "scan_biggest_files": {
      const dir = String(args.dir ?? "");
      const topN = (args.top_n as number) ?? 10;
      const minMb = (args.min_mb as number) ?? 50;
      const files = BIGGEST_FIXTURES.filter((f) => f.path.startsWith(dir) && f.size >= minMb * MB)
        .sort((a, b) => b.size - a.size)
        .slice(0, topN);
      return files.map((f) => ({ ...f })) as T;
    }
    case "get_storage_config":
      return { ...s.storageConfig } as T;
    case "set_storage_config": {
      s.storageConfig = { ...(args.cfg as StorageConfig) };
      return { ...s.storageConfig } as T;
    }
    case "preview_clean_now":
      return safeCleanItems() as T;
    case "clean_now": {
      const ids = new Set(args.ids as string[]);
      const items = safeCleanItems().filter((i) => ids.has(i.id));
      const dry = s.storageConfig.dry_run;
      let freed = 0;
      let deleted = 0;
      const failed: string[] = [];
      const skipped_admin: string[] = [];
      const categories: { label: string; freed: number }[] = [];
      for (const it of items) {
        if (dry) {
          freed += it.size;
          continue;
        }
        if (it.id === "recycle_bin") {
          s.recycleBinSize = 0;
          freed += it.size;
          deleted += 1;
        } else if (it.admin_required) {
          skipped_admin.push(it.label);
          continue;
        } else {
          freed += it.size;
          deleted += it.file_count;
          s.junk = s.junk.filter((j) => j.id !== it.id);
        }
        const cat = categories.find((c) => c.label === it.label);
        if (cat) cat.freed += it.size;
        else categories.push({ label: it.label, freed: it.size });
      }
      if (!dry) {
        pushUndo("storage_clean", `Safe clean freed ${fmt(freed)} (${deleted} items)`, false, {
          freed, deleted, dry_run: false, at: Date.now(), categories, skipped: [...failed, ...skipped_admin],
        });
        s.freedSoFar += freed;
      }
      return { freed_bytes: freed, deleted_count: deleted, failed, skipped_admin } as T;
    }
    case "scan_unused": {
      const dir = String(args.dir ?? "");
      const days = (args.older_than_days as number) ?? 180;
      const minMb = (args.min_mb as number) ?? 10;
      const files = UNUSED_FIXTURES.filter((f) => f.path.startsWith(dir) && f.days_old >= days && f.size >= minMb * MB);
      s.unusedFiles = files.map((f) => ({ ...f }));
      return s.unusedFiles.map((f) => ({ ...f })) as T;
    }
    case "delete_unused": {
      const paths = new Set(args.paths as string[]);
      let freed = 0;
      s.unusedFiles = s.unusedFiles.filter((u) => {
        if (!paths.has(u.path)) return true;
        freed += u.size;
        return false;
      });
      if (freed > 0) {
        pushUndo("storage_clean", `Moved ${paths.size} unused file(s) to the staging trash — freed ${fmt(freed)}`, true, {
          freed, deleted: paths.size, dry_run: false, at: Date.now(), categories: [], skipped: [],
        });
        s.freedSoFar += freed;
      }
      return freed as T;
    }
    case "recycle_bin_state":
      return { size: s.recycleBinSize, empty: s.recycleBinSize === 0 } as T;
    case "empty_recycle_bin": {
      const size = s.recycleBinSize;
      s.recycleBinSize = 0;
      pushUndo("storage_clean", `Emptied the Recycle Bin (freed ${fmt(size)})`, false, { freed: size, at: Date.now() });
      s.freedSoFar += size;
      return `Recycle Bin emptied — freed ${fmt(size)}` as T;
    }
    case "windows_old_info":
      return {
        exists: true,
        size: 31_500_000_000,
        note: "Files from your previous Windows install. Removing it is permanent and can't be undone — keep it until you're sure nothing you need is inside.",
      } as T;
    case "swap_file_sizes":
      return [
        { name: "hiberfil.sys", path: "C:\\hiberfil.sys", size: 9_800_000_000, note: "Used by Hibernate / Fast Startup. Managed by Windows — disable hibernation in Power settings to remove it." },
        { name: "pagefile.sys", path: "C:\\pagefile.sys", size: 8_200_000_000, note: "The virtual-memory page file. Managed by Windows — disable it only via Advanced system settings." },
      ] as T;
    case "big_dupe_groups": {
      const minMb = (args.min_mb as number) ?? 500;
      return BIG_DUPE_FIXTURES.filter((g) => g.wasted_bytes >= minMb * MB).map((g) => ({ ...g })) as T;
    }
    // S14 test hook (mock-only — never in Rust, so arg-parity ignores it)
    case "mock_reset_storage": {
      s.storageConfig = {
        unused_days: 180, unused_min_mb: 10, safe_temp: true, safe_update_cache: true, safe_recycle_bin: true,
        safe_browser_caches: true, safe_installers: true, exclusions: [], dry_run: true, auto_clean: "off",
      } as StorageConfig;
      s.recycleBinSize = 2_400_000_000;
      s.unusedFiles = [];
      return null as T;
    }
    case "list_startup":
      return s.startup.map((e) => ({ ...e })) as T;
    case "toggle_startup": {
      const name = args.name as string;
      const enable = args.enable as boolean;
      const entry = s.startup.find((e) => e.name === name);
      if (entry) {
        entry.enabled = enable;
        pushUndo(
          enable ? "startup_enable" : "startup_disable",
          `${enable ? "Enabled" : "Disabled"} startup entry: ${name}`,
          true,
          { name, location: entry.location }
        );
      }
      return s.startup.map((e) => ({ ...e })) as T;
    }
    case "get_system_info":
      return {
        cpu_name: "AMD Ryzen 7 5800X 8-Core Processor",
        cpu_count: 16,
        cpu_usage_pct: 23.4,
        ram_total: 32 * 1024 ** 3,
        ram_used: 14.2 * 1024 ** 3,
        ram_free_pct: 55.6,
        os: "Microsoft Windows 11 Pro",
        host: "DESKTOP-REFORGE",
        disks: [
          { name: "C:", mount: "C:\\", total: 223 * 1024 ** 3, free: 11 * 1024 ** 3, free_pct: 4.9 },
          { name: "D:", mount: "D:\\", total: 448 * 1024 ** 3, free: 109 * 1024 ** 3, free_pct: 24.3 },
        ],
        top_processes: [
          { name: "chrome.exe", mem_mb: 2841, cpu_pct: 6.2 },
          { name: "Discord.exe", mem_mb: 731, cpu_pct: 1.1 },
          { name: "Spotify.exe", mem_mb: 402, cpu_pct: 0.8 },
          { name: "explorer.exe", mem_mb: 289, cpu_pct: 2.3 },
        ],
      } as T;
    case "get_health_score": {
      const disk = 4.9;
      const ram = 55.6;
      const startup = s.startup.filter((e) => e.enabled).length;
      const diskPts = Math.min(40, Math.max(0, Math.round(((disk - 15) / 40) * 40)));
      const ramPts = Math.min(15, Math.max(0, Math.round(((ram - 15) / 35) * 15)));
      const startupPts = Math.max(0, 20 - startup * 2);
      const cleanupPts = 0;
      const score = Math.min(100, diskPts + ramPts + startupPts + cleanupPts);
      return {
        score,
        disk_free_pct: disk,
        ram_free_pct: ram,
        startup_count: startup,
        last_cleanup_ts: s.undo.find((e) => e.kind === "junk_clean")?.ts ?? null,
        breakdown: [
          { label: "Disk space", points: diskPts, max: 40 },
          { label: "Startup clutter", points: startupPts, max: 20 },
          { label: "Memory pressure", points: ramPts, max: 15 },
          { label: "Recent cleanup", points: cleanupPts, max: 25 },
        ],
      } as T;
    }
    case "extract_palette":
      return ["#4A6CF7", "#0B1026", "#2A3B7C", "#9BB1FF"] as T;
    case "get_undo_log":
      return s.undo.map((e) => ({ ...e })) as T;
    case "get_performance": {
      perf.cpu = clamp(perf.cpu + (Math.random() - 0.5) * 14, 3, 96);
      perf.ramFree = clamp(perf.ramFree + (Math.random() - 0.5) * 6, 20, 88);
      return {
        ts: Date.now(),
        cpu_usage_pct: perf.cpu,
        ram_total: 32 * 1024 ** 3,
        ram_used: ((100 - perf.ramFree) / 100) * 32 * 1024 ** 3,
        ram_free_pct: perf.ramFree,
        process_count: 221,
        uptime_secs: 3 * 86400 + 4 * 3600,
        boot_time_ts: Date.now() / 1000 - (3 * 86400 + 4 * 3600),
        battery: { on_ac: true, percent: 92, charging: true },
        disks: [
          { name: "C:", mount: "C:\\", total: 223 * 1024 ** 3, free: 11 * 1024 ** 3, free_pct: 4.9 },
          { name: "D:", mount: "D:\\", total: 448 * 1024 ** 3, free: 109 * 1024 ** 3, free_pct: 24.3 },
        ],
        top_processes: [
          { name: "chrome.exe", mem_mb: 2841, cpu_pct: 6.2 },
          { name: "Discord.exe", mem_mb: 731, cpu_pct: 1.1 },
          { name: "Spotify.exe", mem_mb: 402, cpu_pct: 0.8 },
          { name: "explorer.exe", mem_mb: 289, cpu_pct: 2.3 },
          { name: "reforge.exe", mem_mb: 96, cpu_pct: 0.4 },
        ],
      } as T;
    }
    case "get_user_folders":
      return [
        { label: "Home", path: "C:\\Users\\you", exists: true },
        { label: "Desktop", path: "C:\\Users\\you\\Desktop", exists: true },
        { label: "Documents", path: "C:\\Users\\you\\Documents", exists: true },
        { label: "Downloads", path: "C:\\Users\\you\\Downloads", exists: true },
        { label: "Pictures", path: "C:\\Users\\you\\Pictures", exists: true },
        { label: "OneDrive", path: "C:\\Users\\you\\OneDrive", exists: true },
      ] as T;
    case "scan_duplicates":
      return {
        scanned_bytes: 48 * 1024 ** 3,
        total_wasted: 3.4 * 1024 ** 3,
        groups: [
          { id: "dup-1", name: "IMG_2041.JPG", size: 4.2 * 1024 ** 2, files: [
            { path: `${args.dir}\\IMG_2041.JPG`, modified: Date.now() / 1000 - 3600 },
            { path: `${args.dir}\\Photos\\IMG_2041.JPG`, modified: Date.now() / 1000 - 86400 },
            { path: `${args.dir}\\New folder\\IMG_2041 (2).JPG`, modified: Date.now() / 1000 - 172800 },
          ]},
          { id: "dup-2", name: "project_final.zip", size: 812 * 1024 ** 2, files: [
            { path: `${args.dir}\\project_final.zip`, modified: Date.now() / 1000 - 7200 },
            { path: `${args.dir}\\Downloads\\project_final (1).zip`, modified: Date.now() / 1000 - 36000 },
          ]},
          { id: "dup-3", name: "setup_v2.exe", size: 248 * 1024 ** 2, files: [
            { path: `${args.dir}\\setup_v2.exe`, modified: Date.now() / 1000 - 500 },
            { path: `${args.dir}\\Old builds\\setup_v2.exe`, modified: Date.now() / 1000 - 900000 },
          ]},
        ],
      } as T;
    case "remove_duplicates": {
      const n = (args.paths as string[]).length;
      pushUndo("duplicates_removed", `Moved ${n} duplicate files to staging trash`, true, {
        moved: (args.paths as string[]).map((p) => ({ from: p, to: `${p}.reforge-trash` })),
      });
      return `Moved ${n} files to staging trash (reversible)` as T;
    }
    case "empty_trash":
      pushUndo("trash_emptied", "Permanently deleted staged duplicates", false, { freed: 3.4 * 1024 ** 3 });
      return "Emptied staging trash — freed 3.4 GB" as T;
    case "trash_size":
      return 3.4 * 1024 ** 3 as T;
    case "scan_storage":
      return [
        { name: "Downloads", path: `${args.dir}\\Downloads`, size: 18.2 * 1024 ** 3, file_count: 4120 },
        { name: "Documents", path: `${args.dir}\\Documents`, size: 12.6 * 1024 ** 3, file_count: 2880 },
        { name: "Videos", path: `${args.dir}\\Videos`, size: 41.3 * 1024 ** 3, file_count: 210 },
        { name: "Pictures", path: `${args.dir}\\Pictures`, size: 9.8 * 1024 ** 3, file_count: 1150 },
        { name: "Desktop", path: `${args.dir}\\Desktop`, size: 4.1 * 1024 ** 3, file_count: 342 },
        { name: "Music", path: `${args.dir}\\Music`, size: 6.7 * 1024 ** 3, file_count: 890 },
      ] as T;
    case "preview_sort":
      return [
        { from: `${args.dir}\\report.pdf`, to: `${args.dir}\\Documents\\report.pdf` },
        { from: `${args.dir}\\photo.jpg`, to: `${args.dir}\\Images\\photo.jpg` },
        { from: `${args.dir}\\clip.mp4`, to: `${args.dir}\\Videos\\clip.mp4` },
        { from: `${args.dir}\\archive.zip`, to: `${args.dir}\\Archives\\archive.zip` },
        { from: `${args.dir}\\song.mp3`, to: `${args.dir}\\Audio\\song.mp3` },
        { from: `${args.dir}\\notes.txt`, to: `${args.dir}\\Documents\\notes.txt` },
      ] as T;
    case "apply_sort": {
      const plan = (await mockCall<MoveOp[]>("preview_sort", args));
      pushUndo("sort", `Auto-sorted ${plan.length} files by ${args.mode}`, true, { moves: plan });
      return `Sorted ${plan.length} files into folders by ${args.mode}` as T;
    }
    case "list_cursor_schemes":
      return [
        { id: "aero", name: "Windows Aero", description: "The modern Windows 10/11 cursors with the blue glow." },
        { id: "black", name: "Windows Black", description: "High-contrast black cursors — great on bright screens." },
        { id: "default", name: "System default", description: "Reset everything to whatever Windows is using by default." },
      ] as T;
    case "get_cursor_state":
      return {
        scheme_source: s.theme.mode === "dark" ? "Reforge:aero" : "(default)",
        cursors: [
          { name: "Arrow", path: "C:\\Windows\\Cursors\\aero_arrow.cur" },
          { name: "Wait", path: "C:\\Windows\\Cursors\\aero_busy.ani" },
          { name: "Hand", path: "C:\\Windows\\Cursors\\aero_link.cur" },
        ],
      } as T;
    case "apply_cursor_scheme": {
      const scheme = (args.id as string);
      pushUndo("cursors", `Applied cursor scheme: ${scheme}`, true, { before: {}, after: scheme });
      return { scheme_source: `Reforge:${scheme}`, cursors: [] } as T;
    }
    case "get_security_audit":
      return [
        { id: "ad_id", title: "Advertising ID", status: "warn", detail: "Windows can use an advertising ID to show tailored ads.", action_hint: "Disable in Settings → Privacy → General." },
        { id: "telemetry", title: "Diagnostic data", status: "info", detail: "Diagnostic data level not restricted by policy.", action_hint: "Set to 'Required' in Privacy → Diagnostics if you prefer." },
        { id: "startup_risk", title: "Startup bloat", status: "warn", detail: "2 of 6 startup entries look heavy (score ≥ 7).", action_hint: "Review in Tune-up → Startup manager." },
        { id: "wifi", title: "Saved Wi-Fi networks", status: "info", detail: "4 saved networks: Home5G, CoffeeShop, Gym, HotelWiFi", action_hint: "Forget old networks in Windows Settings." },
        { id: "firewall", title: "Windows Firewall", status: "ok", detail: "Domain · Private · Public profiles all ON", action_hint: "Nothing to do." },
        { id: "bloat", title: "Pre-installed bloatware", status: "warn", detail: "Found 2 apps that are commonly unwanted: Xbox (0 MB), Bing News (0 MB)", action_hint: "Uninstall via Settings → Apps." },
        { id: "usb_history", title: "Removable-device history", status: "info", detail: "Windows remembers USB drives you've plugged in.", action_hint: "Clear via Settings → Privacy → Clear activity history." },
      ] as T;
    case "run_maintenance": {
      const rep: MaintenanceReport = {
        ts: Date.now(),
        junk_bytes: 11.2 * 1024 ** 3,
        junk_items: 8,
        duplicate_bytes: 3.4 * 1024 ** 3,
        duplicate_files: 3,
        startup_heavy: 2,
        storage_top: [],
        notes: [
          "Found 11.2 GB of junk across 8 areas (nothing deleted — clean from Tune-up).",
          "Duplicate sweep found 3.4 GB wasted across 3 groups (Desktop/Downloads/Documents).",
          "2 heavy startup entries (impact ≥ 7) — review in Tune-up → Startup.",
        ],
      };
      s.reports.unshift(rep);
      return rep as T;
    }
    case "list_reports":
      return s.reports.map((r) => ({ ...r })) as T;
    case "archive_report": {
      s.reports = s.reports.filter((r) => r.ts !== (args.ts as number));
      return "Report archived" as T;
    }
    case "export_profile":
      return {
        app: "reforge",
        format: 1,
        generated_at: Date.now(),
        theme: { accent_hex: s.theme.accent_hex, mode: s.theme.mode, transparency: s.theme.transparency },
        wallpaper: s.wallpaper.current,
        undo_count: s.undo.length,
      } as T;
    case "import_profile":
      pushUndo("accent", "[import] Profile applied", true, { before: s.theme.accent_hex, after: s.theme.accent_hex });
      return "Imported profile — applied: accent, mode" as T;
    case "revert_entry": {
      const e = s.undo.find((u) => u.id === args.id);
      if (!e) throw new Error("entry not found");
      if (e.kind === "accent") s.theme = { ...s.theme, accent_hex: (e.data.before as string) ?? "#000000" };
      if (e.kind === "mode") s.theme = { ...s.theme, mode: (e.data.before as "dark" | "light") ?? "dark" };
      if (e.kind === "transparency") s.theme = { ...s.theme, transparency: e.data.before as boolean };
      if (e.kind === "wallpaper") s.wallpaper = { ...s.wallpaper, current: (e.data.before as string) ?? "" };
      if (e.kind === "startup_disable") {
        const en = s.startup.find((x) => x.name === e.data.name);
        if (en) en.enabled = true;
      }
      if (e.kind === "blue_light") {
        // Mirrors undo.rs "blue_light": restore the prior on/off state; when
        // turning back on, the native side applies the default intensity ramp.
        const before = e.data.before as boolean;
        s.automation = { ...s.automation, blue_light_on: before, blue_light_intensity: before ? 0.3 : s.automation.blue_light_intensity };
      }
      if (e.kind === "animated_wallpaper") {
        // revert = stop the animation and restore the previous static wallpaper
        s.engine = { active: false, frozen: false, scene: null, media: null, static_wallpaper: (e.data.static_wallpaper as string) ?? "" };
      }
      if (e.kind === "animated_wallpaper_stop") {
        // revert = restart the scene that was stopped
        const scene = e.data.scene as SceneConfig | null;
        if (scene) s.engine = { ...s.engine, active: true, frozen: false, scene: { ...scene } };
      }
      if (e.kind === "style_applied") {
        const b = e.data.before as { accent?: string; mode?: string; transparency?: boolean; wallpaper?: string; engine?: EngineState; sound_scheme?: string; font?: { original?: string; before?: string } };
        if (b.accent) s.theme = { ...s.theme, accent_hex: b.accent };
        if (b.mode) s.theme = { ...s.theme, mode: b.mode as "dark" | "light" };
        if (typeof b.transparency === "boolean") s.theme = { ...s.theme, transparency: b.transparency };
        if (b.wallpaper !== undefined) s.wallpaper = { ...s.wallpaper, current: b.wallpaper };
        if (b.engine) s.engine = { active: b.engine.active, frozen: b.engine.frozen, scene: b.engine.scene, media: b.engine.media, static_wallpaper: b.engine.static_wallpaper };
        if (typeof b.sound_scheme === "string" && b.sound_scheme) s.sounds = s.sounds.map((x) => ({ ...x, current: x.guid === b.sound_scheme }));
        if (b.font?.original) {
          s.fonts = [...s.fonts.filter((f) => f.original !== b.font!.original), { original: b.font!.original, substituted: b.font!.before ?? "" }];
        }
      }
      e.undone = true;
      return `Reverted: ${e.description}` as T;
    }
    case "snapshot_now": {
      const snap: Snapshot = { id: uid(), ts: Date.now(), state: { theme: { ...s.theme } } };
      s.snapshots.unshift(snap);
      pushUndo("snapshot", "Snapshot created (pre-makeover state)", false, { snapshot_id: snap.id });
      return snap as T;
    }
    case "list_snapshots":
      return s.snapshots.map((x) => ({ ...x })) as T;
    case "restore_snapshot":
      return "Restored snapshot" as T;
    case "factory_fresh":
      s.theme = { accent_hex: "#6D7CFF", mode: "dark", transparency: true, color_prevalence: true };
      s.wallpaper.current = "";
      return "Restored your pre-makeover state" as T;

    // ---- animated wallpaper engine ----
    case "list_wallpaper_scenes":
      return [...SCENES, ...s.customScenes].map((x) => ({ ...x })) as T;
    case "save_custom_scene": {
      const sc = args.scene as SceneConfig;
      const existing = s.customScenes.findIndex((x) => x.id === sc.id);
      if (existing >= 0) s.customScenes[existing] = { ...sc };
      else s.customScenes.push({ ...sc });
      pushUndo("custom_scene_saved", `Saved custom scene “${sc.name}”`, false, { scene: sc });
      return s.customScenes.map((x) => ({ ...x })) as T;
    }
    case "delete_custom_scene": {
      const id = args.id as string;
      s.customScenes = s.customScenes.filter((x) => x.id !== id);
      pushUndo("custom_scene_deleted", `Deleted custom scene ${id}`, false, { id });
      return s.customScenes.map((x) => ({ ...x })) as T;
    }
    case "get_wallpaper_engine_state":
      return { ...s.engine, scene: s.engine.scene ? { ...s.engine.scene } : null } as T;
    case "set_animated_wallpaper": {
      const scene = args.scene as SceneConfig;
      s.engine = { ...s.engine, active: true, frozen: false, scene: { ...scene }, static_wallpaper: s.engine.static_wallpaper || s.wallpaper.current };
      pushUndo("animated_wallpaper", `Animated wallpaper → ${scene.name} (${scene.kind})`, true, { scene, before_active: false, static_wallpaper: s.engine.static_wallpaper });
      return { ...s.engine, scene: { ...scene } } as T;
    }
    case "stop_animated_wallpaper": {
      // Capture the scene BEFORE clearing the engine — the undo entry must
      // know what was playing so revert can restart it (B1.9 mock parity).
      const stopped = { scene: s.engine.scene, static_wallpaper: s.engine.static_wallpaper };
      s.engine = { active: false, frozen: false, scene: null, media: null, static_wallpaper: "" };
      pushUndo("animated_wallpaper_stop", "Stopped animated wallpaper (static restored)", true, stopped);
      return { ...s.engine } as T;
    }
    case "freeze_wallpaper": {
      s.engine = { ...s.engine, frozen: args.frozen as boolean };
      return { ...s.engine } as T;
    }

    // ---- widgets ----
    case "list_widgets":
      return s.widgets.map((w) => ({ ...w })) as T;
    case "create_widget": {
      const w: WidgetConfig = {
        id: uid(),
        kind: args.kind as string,
        x: 60, y: 60,
        w: args.kind === "stats" ? 260 : args.kind === "clock" ? 190 : 240,
        h: args.kind === "clock" ? 96 : args.kind === "stats" ? 170 : 210,
        title: (args.kind as string).charAt(0).toUpperCase() + (args.kind as string).slice(1),
        content: "",
        visible: true,
        monitor: 0,
      };
      s.widgets.push(w);
      return { ...w } as T;
    }
    case "save_widget_layout": {
      const w = s.widgets.find((x) => x.id === args.id);
      if (w) {
        w.x = args.x as number;
        w.y = args.y as number;
        w.w = Math.max(120, args.w as number);
        w.h = Math.max(80, args.h as number);
        return { ...w } as T;
      }
      return null as T;
    }
    case "get_widgets_settings":
      return { ...s.widgetsSettings } as T;
    case "set_widgets_settings": {
      s.widgetsSettings = { ...s.widgetsSettings, ...(args.settings as Partial<WidgetsSettings>) };
      return { ...s.widgetsSettings } as T;
    }
    case "get_widget_stats":
      return {
        cpu: 23, ram_pct: 47, disk_free_pct: 31,
        gpu_name: "NVIDIA GeForce RTX 3060", gpu_usage: null,
        net_up_kbps: 128, net_down_kbps: 1240,
        thermal_c: 62,
      } as T;
    case "widget_open_view": {
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("reforge:widget-nav", { detail: { view: args.view } }));
      }
      return null as T;
    }
    case "reset_widget_layout":
      s.widgets.forEach((w, i) => {
        w.x = 60 + (i % 3) * 40;
        w.y = 60 + Math.floor(i / 3) * 40;
      });
      return `Reset layout — ${s.widgets.length} widget(s) repositioned` as T;
    case "save_widget_note": {
      const w = s.widgets.find((x) => x.id === args.id);
      if (w) w.content = args.content as string;
      return null as T;
    }
    case "update_widget":
    case "set_widget_visible": {
      const w = s.widgets.find((x) => x.id === args.id);
      if (w) w.visible = args.visible as boolean;
      return null as T;
    }
    case "set_all_widgets_visible": {
      s.widgets.forEach((w) => (w.visible = args.visible as boolean));
      return null as T;
    }
    case "remove_widget": {
      s.widgets = s.widgets.filter((w) => w.id !== args.id);
      return null as T;
    }

    // ---- tune-up extras ----
    case "list_bloatware":
      return [
        { name: "Candy Crush Saga", publisher: "King", uninstall_string: "", hive: "HKCU", subkey: "", size_mb: 480 },
        { name: "Xbox Console Companion", publisher: "Microsoft", uninstall_string: "", hive: "HKLM", subkey: "", size_mb: 190 },
        { name: "Bing News", publisher: "Microsoft", uninstall_string: "", hive: "HKLM", subkey: "", size_mb: 74 },
        { name: "Clipchamp", publisher: "Microsoft", uninstall_string: "", hive: "HKCU", subkey: "", size_mb: 320 },
      ] as T;
    case "uninstall_bloatware":
      pushUndo("uninstall", `Launched uninstaller for ${args.name}`, false, { name: args.name });
      return `Launched uninstaller for ${args.name}` as T;
    case "get_memory_hogs":
      return [
        { name: "chrome.exe", pid: 4821, mem_mb: 2841, cpu_pct: 6.2 },
        { name: "Discord.exe", pid: 9034, mem_mb: 731, cpu_pct: 1.1 },
        { name: "Spotify.exe", pid: 3301, mem_mb: 402, cpu_pct: 0.8 },
        { name: "node.exe", pid: 2180, mem_mb: 366, cpu_pct: 2.4 },
        { name: "Code.exe", pid: 6410, mem_mb: 288, cpu_pct: 1.9 },
      ] as T;
    case "end_process":
      pushUndo("process_ended", `Ended process ${args.name} (PID ${args.pid})`, false, { name: args.name, pid: args.pid });
      return `Ended ${args.name}` as T;
    case "scan_orphaned_entries":
      return [
        { name: "Old Trial Software", hive: "HKLM", subkey: "...\\Uninstall\\{abc}", install_location: "C:\\Program Files\\OldTrial", reason: "InstallLocation missing: C:\\Program Files\\OldTrial" },
        { name: "Abandoned Tool 2019", hive: "HKCU", subkey: "...\\Uninstall\\abandoned", install_location: "", reason: "Uninstaller missing: C:\\OldTools\\uninstall.exe" },
      ] as T;
    case "remove_orphaned_entry":
      pushUndo("registry_cleanup", `Removed orphaned registry entry: ${args.name}`, true, { hive: args.hive, parent: "...", leaf: "...", backup: {} });
      return `Removed orphaned entry: ${args.name}` as T;
    case "list_power_plans":
      return [
        { name: "Balanced", guid: "381b4222-f694-41f0-9685-ff5bb260df2e", active: true },
        { name: "High performance", guid: "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c", active: false },
        { name: "Power saver", guid: "a1841308-3541-4fab-bc81-f71556f20b4a", active: false },
      ] as T;
    case "set_active_power_plan":
      pushUndo("power_plan", `Active power plan → ${args.name}`, true, { before_guid: "381b4222-f694-41f0-9685-ff5bb260df2e", before_name: "Balanced", after_guid: args.guid, after_name: args.name });
      return (await mockCall("list_power_plans")) as T;
    case "audit_scheduled_tasks":
      return [
        { name: "OneDriveStandaloneUpdateTask", status: "Ready", trigger: "Daily", author: "Microsoft", risky: false },
        { name: "\u03b1updater.exe", status: "Ready", trigger: "At logon", author: "", risky: true },
        { name: "MicrosoftEdgeUpdateTask", status: "Ready", trigger: "At logon", author: "Microsoft", risky: false },
        { name: "crypto-miner-helper", status: "Ready", trigger: "At startup", author: "unknown", risky: true },
        { name: "NVIDIA GeForce Experience", status: "Ready", trigger: "At logon", author: "NVIDIA", risky: false },
      ] as T;
    case "get_boot_stats":
      return { last_boot_ms: 14800, trend_ms: 16400, samples: 12, available: true } as T;
    case "audit_browser_extensions":
      return [
        { browser: "Chrome", name: "uBlock Origin", version: "1.52.0", enabled: true, source: "web store" },
        { browser: "Chrome", name: "Untitled Extension", version: "0.1", enabled: false, source: "unknown" },
        { browser: "Edge", name: "Dark Reader", version: "4.9.62", enabled: true, source: "web store" },
        { browser: "Firefox", name: "Privacy Badger", version: "?", enabled: true, source: "unknown" },
      ] as T;
    case "audit_file_associations":
      return [
        { ext: ".html", prog_id: "ChromeHTML", handler: "user choice" },
        { ext: ".pdf", prog_id: "ChromePDF", handler: "user choice" },
        { ext: ".txt", prog_id: "txtfile", handler: "system default" },
        { ext: ".mp3", prog_id: "AppXq0fevzme2pys62n3e0fbqaeppe9c3kr", handler: "system default" },
      ] as T;
    case "reset_file_association":
      pushUndo("file_association", `Reset file association for ${args.ext}`, true, { ext: args.ext, backup: {} });
      return `${args.ext} will now open with the system default.` as T;
    case "list_drivers":
      return [
        { name: "oem10.inf", provider: "Realtek Semiconductor Corp.", version: "10.0.19041.1", date: "2/14/2023" },
        { name: "oem22.inf", provider: "NVIDIA", version: "31.0.15.5123", date: "6/1/2024" },
        { name: "oem41.inf", provider: "Intel", version: "12.0.0.2", date: "9/9/2022" },
      ] as T;

    // ---- files / organize extras ----
    case "list_smart_folders":
      return s.smartFolders.map((f) => ({ ...f })) as T;
    case "create_smart_folder": {
      const sf: SmartFolder = { id: uid(), name: args.name as string, root: args.root as string, extensions: (args.extensions as string[]) || [], min_age_days: (args.min_age_days as number) ?? null, created_at: Date.now() };
      s.smartFolders.push(sf);
      return { ...sf } as T;
    }
    case "remove_smart_folder": {
      s.smartFolders = s.smartFolders.filter((f) => f.id !== args.id);
      return null as T;
    }
    case "run_smart_folder": {
      // K8 parity: Rust takes `id` (not `dir`) — mirror the real signature
      const id = args.id as string;
      return [
        { path: `C:\\Users\\you\\smart-${id}\\project_notes.md`, size: 4200, modified: Date.now() / 1000 - 3600 },
        { path: `C:\\Users\\you\\smart-${id}\\drafts\\idea.md`, size: 1800, modified: Date.now() / 1000 - 86400 * 3 },
        { path: `C:\\Users\\you\\smart-${id}\\Documents\\todo.md`, size: 950, modified: Date.now() / 1000 - 86400 * 12 },
      ] as T;
    }
    case "plan_archive":
      return [
        { rel: "old_report_2020.pdf", original: `${args.dir}\\old_report_2020.pdf` },
        { rel: "backup_v3.zip", original: `${args.dir}\\backup_v3.zip` },
      ] as T;
    case "apply_archive": {
      const plan = (await mockCall<{ rel: string; original: string }[]>("plan_archive", args));
      pushUndo("archive", `Archived ${plan.length} old files`, true, { zip: `${args.dir}\\_Reforge_Archive.zip`, moves: plan, dir: args.dir });
      s.freedSoFar += 214000000;
      return `Archived ${plan.length} files` as T;
    }
    case "preview_rename":
      return [
        { from: `${args.dir}\\photo1.jpg`, to: `${args.dir}\\${args.prefix}_001.jpg` },
        { from: `${args.dir}\\photo2.jpg`, to: `${args.dir}\\${args.prefix}_002.jpg` },
        { from: `${args.dir}\\photo3.jpg`, to: `${args.dir}\\${args.prefix}_003.jpg` },
      ] as T;
    case "apply_rename": {
      const ops = (await mockCall<{ from: string; to: string }[]>("preview_rename", args));
      pushUndo("rename", `Renamed ${ops.length} files`, true, { ops });
      return `Renamed ${ops.length} files` as T;
    }
    case "organize_screenshots": {
      pushUndo("sort", `Organized 4 screenshots into dated folders`, true, { moves: [] });
      return "Organized 4 screenshots into YYYY/MM folders" as T;
    }
    case "list_stale_downloads":
      return [
        { path: `${args.dir}\\installer_2023.exe`, size: 224000000, modified: Date.now() / 1000 - 86400 * 200, age_days: 200 },
        { path: `${args.dir}\\setup_old.msi`, size: 88000000, modified: Date.now() / 1000 - 86400 * 150, age_days: 150 },
        { path: `${args.dir}\\driver_pack.zip`, size: 310000000, modified: Date.now() / 1000 - 86400 * 95, age_days: 95 },
      ] as T;
    case "delete_stale_downloads": {
      const paths = args.paths as string[];
      pushUndo("downloads_expired", `Sent ${paths.length} stale downloads to Recycle Bin`, false, { paths, freed: 622000000 });
      s.freedSoFar += 622000000;
      return `Sent ${paths.length} files to the Recycle Bin` as T;
    }
    case "flag_stale_apps":
      return [
        { name: "Old Video Editor", exe: "C:\\Program Files\\OldVideo\\oldvideo.exe", last_modified: Date.now() / 1000 - 86400 * 400, age_days: 400 },
        { name: "Trial CAD 2021", exe: "C:\\Program Files\\TrialCAD\\trialcad.exe", last_modified: Date.now() / 1000 - 86400 * 300, age_days: 300 },
      ] as T;
    case "scan_cloud_duplicates":
      return [
        { name: "family_photo_2021.jpg", size: 4200000, paths: ["C:\\Users\\you\\OneDrive\\Pictures\\family_photo_2021.jpg", "C:\\Users\\you\\Dropbox\\Pictures\\family_photo_2021.jpg"] },
        { name: "resume_final.pdf", size: 240000, paths: ["C:\\Users\\you\\OneDrive\\resume_final.pdf", "C:\\Users\\you\\Google Drive\\resume_final.pdf"] },
      ] as T;

    // ---- security extras ----
    case "get_permissions":
      return [
        { id: "Microphone", label: "Microphone", allowed: true, apps: [{ name: "Discord", allowed: true }, { name: "Zoom", allowed: true }, { name: "Unknown app", allowed: false }] },
        { id: "Camera", label: "Camera", allowed: false, apps: [{ name: "Teams", allowed: true }, { name: "Camera", allowed: false }] },
        { id: "Location", label: "Location", allowed: true, apps: [{ name: "Maps", allowed: true }] },
      ] as T;
    case "set_permission": {
      pushUndo("permission", `${args.id} access → ${args.allowed ? "Allow" : "Deny"}`, true, { id: args.id, before: !args.allowed, after: args.allowed });
      return { id: args.id, label: args.id, allowed: args.allowed, apps: [] } as T;
    }
    case "get_browser_privacy":
      return [
        { id: "chrome-metrics", browser: "Chrome", label: "Usage metrics reporting", enabled: true, description: "Sends usage stats and crash reports." },
        { id: "chrome-3pck", browser: "Chrome", label: "Block third-party cookies", enabled: false, description: "Prevents cross-site tracking." },
        { id: "edge-metrics", browser: "Edge", label: "Usage metrics reporting", enabled: true, description: "Sends usage stats and crash reports." },
        { id: "edge-suggest", browser: "Edge", label: "Search suggestions", enabled: true, description: "Sends keystrokes for suggestions." },
      ] as T;
    case "set_browser_policy": {
      pushUndo("browser_policy", `${args.browser} ${args.policy} → ${args.enabled ? "on" : "off"}`, true, { browser: args.browser, policy: args.policy, before: args.enabled ? 1 : 0 });
      return (await mockCall("get_browser_privacy")) as T;
    }
    case "get_usb_history":
      return [
        { name: "USB Mass Storage Device", vid: "0781", pid: "5581", first_seen: null },
        { name: "SanDisk Ultra USB Device", vid: "0781", pid: "5583", first_seen: null },
      ] as T;

    // ---- productivity ----
    case "get_clipboard_history":
      return s.clips.map((c) => ({ ...c })) as T;
    case "clear_clipboard_history": {
      s.clips = [];
      return null as T;
    }
    case "toggle_clipboard_pin": {
      const c = s.clips.find((x) => x.id === args.id);
      if (c) c.pinned = !c.pinned;
      return s.clips.map((x) => ({ ...x })) as T;
    }
    case "get_app_list":
      return [
        { name: "Discord", path: "C:\\Users\\you\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Discord.lnk" },
        { name: "Spotify", path: "...\\Spotify.lnk" },
        { name: "Visual Studio Code", path: "...\\Visual Studio Code.lnk" },
        { name: "Steam", path: "...\\Steam.lnk" },
        { name: "Brave", path: "...\\Brave.lnk" },
      ] as T;
    case "launch_app":
      return null as T;
    case "list_macros":
      return s.macros.map((m) => ({ ...m })) as T;
    case "create_macro": {
      const m: MacroRule = { id: uid(), name: args.name as string, when_app: (args.when_app as string).toLowerCase(), look_name: args.look_name as string, accent: args.accent as string, mode: args.mode as string, wallpaper: (args.wallpaper as string) || "", enabled: true };
      s.macros.push(m);
      pushUndo("macro", `Macro created: when ${m.when_app} starts → apply ${m.look_name}`, false, { macro: m });
      return { ...m } as T;
    }
    case "remove_macro": {
      s.macros = s.macros.filter((m) => m.id !== args.id);
      return null as T;
    }
    case "toggle_macro": {
      const m = s.macros.find((x) => x.id === args.id);
      if (m) m.enabled = args.enabled as boolean;
      return s.macros.map((x) => ({ ...x })) as T;
    }
    case "set_focus_mode": {
      pushUndo("focus_mode", `Focus mode ${args.on ? "on" : "off"}`, true, { before_hide: !args.on, hide: args.on });
      return (args.on ? "Focus mode on — desktop icons hidden" : "Focus mode off — icons restored") as T;
    }
    case "get_focus_state":
      return false as T;
    case "get_ram_cleanup":
      return { total_gb: 32, avail_gb: 17.8, load_pct: 44 } as T;

    // ---- network ----
    case "get_bandwidth_hogs":
      return [
        { name: "Steam.exe", pid: 9201, connections: 14 },
        { name: "chrome.exe", pid: 4821, connections: 41 },
        { name: "Discord.exe", pid: 9034, connections: 9 },
        { name: "Spotify.exe", pid: 3301, connections: 6 },
      ] as T;
    case "list_wifi_profiles":
      return [
        { name: "Home5G", backed_up: false },
        { name: "CoffeeShop WiFi", backed_up: false },
        { name: "Hotel-Guest", backed_up: false },
      ] as T;
    case "forget_wifi_profile": {
      pushUndo("wifi_forgot", `Forgot saved Wi-Fi network: ${args.name}`, true, { name: args.name, backup: "C:\\...\\wifi_backups\\profile.xml" });
      return `Forgot ${args.name}` as T;
    }
    case "reset_network": {
      pushUndo("network_reset", "Network reset — 4 of 5 steps succeeded", false, {});
      return {
        steps: [
          { name: "Flush DNS cache", ok: true, detail: "OK" },
          { name: "Release IP", ok: true, detail: "OK" },
          { name: "Renew IP", ok: true, detail: "OK" },
          { name: "Reset Winsock catalog", ok: true, detail: "OK" },
          { name: "Reset TCP/IP stack", ok: false, detail: "access denied (needs admin)" },
        ],
        backup: { backup_dir: "C:\\Users\\you\\AppData\\Roaming\\com.reforge\\network_backups\\123", files: ["ipconfig_all.txt", "netsh_ip_config.txt", "route_print.txt"] },
      } as T;
    }

    // ---- gaming ----
    case "get_game_mode":
      return true as T;
    case "set_game_mode": {
      pushUndo("game_mode", `Game Mode → ${args.on ? "on" : "off"}`, true, { before: !args.on, after: args.on });
      return args.on as T;
    }
    case "list_game_profiles":
      return s.gameProfiles.map((p) => ({ ...p })) as T;
    case "save_game_profile": {
      const p = args.profile as GameProfile;
      const existing = s.gameProfiles.find((x) => x.id === p.id);
      if (existing) Object.assign(existing, p);
      else s.gameProfiles.push({ ...p, id: p.id || uid() });
      return { ...p, id: p.id || s.gameProfiles[s.gameProfiles.length - 1].id } as T;
    }
    case "delete_game_profile": {
      s.gameProfiles = s.gameProfiles.filter((x) => x.id !== args.id);
      return null as T;
    }
    case "apply_game_profile": {
      pushUndo("game_profile", `Applied ${(args.profile as GameProfile).name} profile`, true, { before: { game_mode: true, frozen: false, icons_hidden: false, taskbar_autohide: false } });
      return `${(args.profile as GameProfile).name} profile applied` as T;
    }

    // ---- power (S10.1) ----
    case "get_power_state":
      return { ...s.power, plans: s.power.plans.map((p) => ({ ...p })), battery: s.power.battery ? { ...s.power.battery } : null, battery_health: s.power.battery_health ? { ...s.power.battery_health } : null } as T;
    case "set_power_plan": {
      const before = s.power.plans.find((p) => p.active)?.guid ?? "";
      pushUndo("power", "Power plan changed", true, { before: { plan_guid: before, screen_off_ac_min: s.power.screen_off_ac_min, screen_off_dc_min: s.power.screen_off_dc_min, hibernate_enabled: s.power.hibernate_enabled } });
      s.power.plans.forEach((p) => (p.active = p.guid === args.guid));
      return `Power plan changed` as T;
    }
    case "set_screen_off_timeout": {
      pushUndo("power", "Screen-off timeout changed", true, { before: { plan_guid: "", screen_off_ac_min: s.power.screen_off_ac_min, screen_off_dc_min: s.power.screen_off_dc_min, hibernate_enabled: s.power.hibernate_enabled } });
      s.power.screen_off_ac_min = args.ac_min as number;
      s.power.screen_off_dc_min = args.dc_min as number;
      return `Screen off updated` as T;
    }
    case "set_hibernate": {
      pushUndo("power", `Hibernate → ${args.enabled ? "on" : "off"}`, true, { before: { plan_guid: "", screen_off_ac_min: s.power.screen_off_ac_min, screen_off_dc_min: s.power.screen_off_dc_min, hibernate_enabled: s.power.hibernate_enabled } });
      s.power.hibernate_enabled = args.enabled as boolean;
      return `Hibernate ${args.enabled ? "enabled" : "disabled"}` as T;
    }

    // ---- focus sessions (S10.6) ----
    case "get_focus_session":
      return { ...s.focusSession } as T;
    case "start_focus_session": {
      const minutes = Math.max(5, args.minutes as number);
      s.focusSession = { active: true, ends_at_ts: Date.now() + minutes * 60_000, minutes, dnd_on: true };
      pushUndo("focus_session", `Focus session started — ${minutes} min`, true, { before_hide: false, before_toasts: true, ended: false });
      return { ...s.focusSession } as T;
    }
    case "stop_focus_session": {
      pushUndo("focus_session", "Focus session ended — desktop restored", true, { ended: true, minutes: s.focusSession.minutes });
      s.focusSession = { active: false, ends_at_ts: 0, minutes: 0, dnd_on: false };
      return `Focus session stopped — desktop restored` as T;
    }

    // ---- accessibility (S10.7) ----
    case "get_accessibility_state":
      return { ...s.accessibility, color_filter: { ...s.accessibility.color_filter } } as T;
    case "set_accessibility_state": {
      const a = s.accessibility;
      if (args.high_contrast !== undefined) a.high_contrast = args.high_contrast as boolean;
      if (args.animations_off !== undefined) a.animations_off = args.animations_off as boolean;
      if (args.cursor_size !== undefined) a.cursor_size = args.cursor_size as number;
      if (args.text_scale_pct !== undefined) a.text_scale_pct = args.text_scale_pct as number;
      if (args.color_filter !== undefined) a.color_filter = { ...(args.color_filter as object) } as AccessibilityState["color_filter"];
      pushUndo("accessibility", "Accessibility settings changed", true, { before: { high_contrast: false, animations_off: false, cursor_size: 32, text_scale_pct: 100, color_filter: { active: false, filter_type: 0 } } });
      return { ...a, color_filter: { ...a.color_filter } } as T;
    }
    case "get_stream_layout":
      return { icons_hidden: false, taskbar_autohide: false } as T;
    case "set_stream_layout": {
      pushUndo("stream_layout", `Stream-safe layout → ${args.on ? "on" : "off"}`, true, { before: { icons_hidden: false, taskbar_autohide: false }, after: args.on });
      return { icons_hidden: args.on, taskbar_autohide: args.on } as T;
    }

    // ---- displays ----
    case "get_display_info":
      return [
        { id: "\\\\.\\DISPLAY1", name: "\\\\.\\DISPLAY1", resolution: "2560x1440", refresh: 144, primary: true },
        { id: "\\\\.\\DISPLAY2", name: "\\\\.\\DISPLAY2", resolution: "1920x1080", refresh: 60, primary: false },
      ] as T;
    case "list_display_profiles":
      return s.displayProfiles.map((p) => ({ ...p })) as T;
    case "save_display_profile": {
      const p: DisplayProfile = { id: uid(), name: args.name as string, created_at: Date.now(), monitors: [{ id: "\\\\.\\DISPLAY1", wallpaper: "" }] };
      s.displayProfiles.push(p);
      return { ...p } as T;
    }
    case "apply_display_profile": {
      pushUndo("display_profile", `Applied display profile`, true, {});
      return "Applied profile" as T;
    }
    case "delete_display_profile": {
      s.displayProfiles = s.displayProfiles.filter((p) => p.id !== args.id);
      return null as T;
    }

    // ---- onboarding ----
    case "get_onboarding_state":
      return { ...s.onboarding } as T;
    case "set_onboarding_state":
      s.onboarding = { ...(args.onb as { wizard_seen: boolean }) };
      return null as T;

    // ---- style favorites (A2.1) ----
    case "get_favorites":
      return [...s.favorites] as T;
    case "set_favorite": {
      const id = String(args.id ?? "");
      const fav = Boolean(args.fav);
      const present = s.favorites.includes(id);
      if (fav && !present) s.favorites.push(id);
      else if (!fav) s.favorites = s.favorites.filter((x) => x !== id);
      return [...s.favorites] as T;
    }

    // ---- automation / perf / dashboard ----
    case "get_automation_config":
      return { ...s.automation } as T;
    case "set_automation_config": {
      s.automation = { ...(args.cfg as AutomationConfig) };
      return { ...s.automation } as T;
    }
    case "run_due_maintenance":
      return {
        ran_junk: true, junk_freed: 1.2 * 1024 ** 3, ran_dupes: false, dupe_wasted: 0, reapplied_theme: true,
        notes: ["Weekly junk clean freed 1.2 GB", "Re-applied saved accent color"],
      } as T;
    case "set_blue_light": {
      s.automation = { ...s.automation, blue_light_on: args.on as boolean, blue_light_intensity: args.intensity as number };
      pushUndo("blue_light", `Blue light filter → ${args.on ? "on" : "off"}`, true, { before: !args.on, after: args.on });
      return args.on as T;
    }
    case "get_dashboard_metrics": {
      const sFreed = s.freedSoFar + 3.4 * 1024 ** 3;
      const feats = [];
      if (s.engine.active) feats.push("Animated wallpaper");
      if (s.widgets.length) feats.push(`${s.widgets.length} desktop widget(s)`);
      if (s.macros.length) feats.push(`${s.macros.length} automation macro(s)`);
      if (s.automation.blue_light_on) feats.push("Blue light filter");
      feats.push("Custom accent #6D7CFF");
      return {
        personalization_score: Math.min(100, 40 + feats.length * 10),
        storage_freed: sFreed,
        files_organized: 14,
        time_saved_secs: 14 * 4 + Math.floor(sFreed / (1024 * 1024)) * 3,
        active_features: feats,
      } as T;
    }
    case "get_perf_history": {
      const now = Date.now();
      s.perfHistory = Array.from({ length: 30 }, (_, i) => ({
        ts: now - (29 - i) * 86400000,
        cpu_avg: 22 + Math.sin(i / 3) * 12 + Math.random() * 4,
        cpu_max: 38 + Math.sin(i / 2.4) * 18,
        ram_free_pct: 54 + Math.cos(i / 4) * 8,
      }));
      return s.perfHistory.map((r) => ({ ...r })) as T;
    }
    case "get_resource_leaderboard": {
      const snap = await mockCall<PerfSnapshot>("get_performance");
      return snap.top_processes.map((p: { name: string; mem_mb: number; cpu_pct: number }) => ({ name: p.name, mem_mb: p.mem_mb * 4, cpu_pct: p.cpu_pct })) as T;
    }
    case "get_battery_health":
      return { available: true, design_mwh: 48000, full_mwh: 43100, health_pct: 90, cycle_count: 312 } as T;

    // ---- marketplace ----
    case "marketplace_list_bundles":
      return s.bundles.map((b) => ({ ...b })) as T;
    case "marketplace_import": {
      const name = String(args.source ?? "").split(/[\\/]/).pop() || "imported-pack";
      const id = "pack-" + uid();
      const b: BundleInfo = { id, name: name.replace(/\.reforgepack$/i, ""), version: "1.0", author: "Imported", description: "Imported from disk — components listed in Preview.", component_count: 3, applied: false };
      s.bundles.push(b);
      s.manifests.set(id, { id, name: b.name, version: "1.0", author: "Imported", description: b.description, thumbnail: "", components: [{ type: "accent", hex: "#6D7CFF" }, { type: "theme_mode", mode: "dark" }, { type: "wallpaper", asset: "wp.png" }] });
      return { ...b } as T;
    }
    case "marketplace_export_look": {
      const id = "look-" + uid();
      const b: BundleInfo = { id, name: (args.name as string) || "My Look", version: "1.0", author: "Reforge User", description: "A snapshot of your current look captured in one click.", component_count: 4, applied: false };
      s.bundles.push(b);
      s.manifests.set(id, { id, name: b.name, version: "1.0", author: "Reforge User", description: b.description, thumbnail: "", components: [{ type: "accent", hex: s.theme.accent_hex }, { type: "theme_mode", mode: s.theme.mode }, { type: "wallpaper", asset: "wp.png" }, { type: "taskbar", size: "medium" }] });
      return { ...b } as T;
    }
    case "marketplace_export_to_path":
      return `Exported to ${args.out_path}` as T;
    case "marketplace_apply_bundle": {
      const b = s.bundles.find((x) => x.id === args.bundle_id);
      if (!b) throw new Error("Pack not found");
      b.applied = true;
      const m = s.manifests.get(b.id);
      if (m) {
        const accent = m.components.find((c) => c.type === "accent");
        if (accent?.hex) s.theme = { ...s.theme, accent_hex: accent.hex, color_prevalence: true };
        const mode = m.components.find((c) => c.type === "theme_mode");
        if (mode?.mode) s.theme = { ...s.theme, mode: mode.mode as "dark" | "light" };
      }
      pushUndo("marketplace_apply", `Applied pack: ${b.name}`, true, { bundle_id: b.id });
      return `Applied pack '${b.name}' (${b.component_count} components). Revert from History.` as T;
    }
    case "marketplace_get_manifest": {
      const m = s.manifests.get(args.bundle_id as string);
      if (!m) throw new Error("Pack manifest not found");
      return JSON.parse(JSON.stringify(m)) as T;
    }
    case "marketplace_delete_bundle": {
      s.bundles = s.bundles.filter((b) => b.id !== args.bundle_id);
      s.manifests.delete(args.bundle_id as string);
      return null as T;
    }

    // ---- network / VPN ----
    case "list_vpn_connections":
      return s.vpn.map((v) => ({ ...v })) as T;
    case "vpn_connect": {
      const v = s.vpn.find((x) => x.name === args.name);
      if (v) {
        pushUndo("vpn_connect", `Connected VPN: ${v.name}`, false, { name: v.name });
        v.status = "connected";
      }
      return s.vpn.map((v) => ({ ...v })) as T;
    }
    case "vpn_disconnect": {
      const v = s.vpn.find((x) => x.name === args.name);
      if (v) {
        pushUndo("vpn_disconnect", `Disconnected VPN: ${v.name}`, false, { name: v.name });
        v.status = "disconnected";
      }
      return s.vpn.map((v) => ({ ...v })) as T;
    }


    // ---- video wallpaper ----
    case "list_video_wallpapers":
      return s.videoWallpapers.map((v) => ({ ...v })) as T;
    case "set_video_wallpaper": {
      const v: VideoWallpaper = { path: String(args.source ?? ""), kind: "video", width: 1920, height: 1080, name: String(args.source ?? "").split(/[\\/]/).pop() || "media" };
      s.engine = { ...s.engine, active: true, frozen: false, scene: null, media: v, static_wallpaper: s.engine.static_wallpaper || s.wallpaper.current };
      pushUndo("video_wallpaper", `Video wallpaper → ${v.name}`, true, { video: v });
      return { ...s.engine, media: { ...v } } as T;
    }
    case "stop_video_wallpaper": {
      s.engine = { ...s.engine, active: false, frozen: false, scene: null, media: null, static_wallpaper: "" };
      pushUndo("video_wallpaper_stop", "Stopped video wallpaper (static restored)", true, { video: null });
      return { ...s.engine, media: null } as T;
    }
    case "media_get_transcode_status":
      return { available: true, version: "ffmpeg version 6.1 (preview)", path: "resources/bin/ffmpeg.exe", max_import_bytes: 500 * 1024 * 1024, note: `Videos are normalized on import — preset: ${s.transcodeConfig.preset}.` } as T;
    case "get_transcode_config":
      return { ...s.transcodeConfig } as T;
    case "set_transcode_config": {
      const cfg = args.config as TranscodeConfig;
      s.transcodeConfig = { ...cfg };
      return { ...s.transcodeConfig } as T;
    }

    // ---- screensaver (E4.6) ----
    case "get_screensaver_config":
      return { ...s.screensaver, scene: s.screensaver.scene ? { ...s.screensaver.scene } : null } as T;
    case "set_screensaver_config": {
      const cfg = args.config as ScreensaverConfig;
      s.screensaver = {
        enabled: !!cfg.enabled,
        timeout_secs: Math.max(1, cfg.timeout_secs),
        scene: cfg.scene ? { ...cfg.scene } : null,
      };
      s.screensaverRegistry = { active: s.screensaver.enabled, timeout_secs: s.screensaver.timeout_secs };
      return { ...s.screensaver, scene: s.screensaver.scene ? { ...s.screensaver.scene } : null } as T;
    }
    case "get_screensaver_registry":
      return { ...s.screensaverRegistry } as T;
    case "preview_screensaver": {
      s.screensaverPreviewedAt = Date.now();
      return "Screensaver preview — move the mouse or press any key to exit" as T;
    }
    case "dismiss_screensaver":
      return null as T;

    // ---- taskbar (shell) ----
    case "shell_get_taskbar_state":
      return { ...s.taskbar } as T;
    case "shell_set_taskbar_size": {
      const before = s.taskbar.size;
      s.taskbar = { ...s.taskbar, size: args.size as string };
      pushUndo("taskbar_size", `Taskbar icon size → ${args.size}`, true, { before, after: args.size });
      return { ...s.taskbar } as T;
    }
    case "shell_set_taskbar_alignment": {
      const before = s.taskbar.alignment;
      s.taskbar = { ...s.taskbar, alignment: args.align as string };
      pushUndo("taskbar_alignment", `Taskbar alignment → ${args.align}`, true, { before, after: args.align });
      return { ...s.taskbar } as T;
    }
    case "shell_set_taskbar_autohide": {
      const before = s.taskbar.autohide;
      s.taskbar = { ...s.taskbar, autohide: args.on as boolean };
      pushUndo("taskbar_autohide", `Taskbar auto-hide ${args.on ? "on" : "off"}`, true, { before, after: args.on });
      return { ...s.taskbar } as T;
    }
    case "shell_set_taskbar_color_match": {
      const before = s.taskbar.color_match;
      s.taskbar = { ...s.taskbar, color_match: args.on as boolean };
      pushUndo("taskbar_color_match", `Taskbar color-match ${args.on ? "on" : "off"}`, true, { before, after: args.on });
      return { ...s.taskbar } as T;
    }
    case "shell_set_taskbar_position": {
      pushUndo("taskbar_position", `Taskbar moved to ${args.side}`, true, { side: args.side, before_bytes: null });
      return `Taskbar moved to ${args.side} (applies after the shell refresh)` as T;
    }
    case "shell_get_pending_state":
      return { pending: false, changes: [], explorer_running: true } as T;
    case "shell_apply_pending_restart":
      return "Explorer restarted — applied queued change(s)." as T;
    case "shell_revert_pending":
      return "Reverted all pending shell changes to the last known good state." as T;

    // ---- sounds ----
    case "list_sound_schemes":
      return s.sounds.map((x) => ({ ...x })) as T;
    case "get_current_scheme": {
      const cur = s.sounds.find((x) => x.current) ?? s.sounds[0];
      return { ...cur, current: true } as T;
    }
    case "apply_sound_scheme": {
      const target = resolveSchemeGuid(args.guid as string);
      const before = s.sounds.find((x) => x.current)?.guid ?? "";
      s.sounds = s.sounds.map((x) => ({ ...x, current: x.guid === target }));
      const name = s.sounds.find((x) => x.guid === target)?.name ?? target as string;
      pushUndo("sound_scheme", `Sound scheme → ${name}`, true, { before, after: args.guid });
      return `Sound scheme changed to ${name}.` as T;
    }
    case "list_sound_events":
      return [
        { event: "SystemNotification", label: "Notification", current: "", default: "", has_sound: false },
        { event: "DeviceConnect", label: "Device connect", current: "", default: "", has_sound: false },
        { event: "SystemAsterisk", label: "Asterisk", current: "", default: "", has_sound: false },
      ] as T;
    case "set_sound_event": {
      pushUndo("sound_event", `Sound for ${args.event} → ${args.path ? args.path : "(none)"}`, true, { event: args.event, before: "", after: args.path });
      return { event: args.event, label: args.event, current: args.path as string, default: "", has_sound: !!(args.path as string) } as T;
    }
    case "preview_sound":
      return "Playing…" as T;
    case "stop_preview":
      return null as T;
    case "import_sound_asset":
      return "Imported sound → app data (WAV)" as T;
    case "save_current_scheme": {
      const guid = "{" + uid() + "}";
      s.sounds = s.sounds.map((x) => ({ ...x, current: false })).concat([{ guid, name: args.name as string, current: true, builtin: false }]);
      pushUndo("sound_scheme", `Saved sound scheme '${args.name}' and switched to it`, true, { before: "", after: guid });
      return `Scheme '${args.name}' saved and is now active.` as T;
    }

    // ---- fonts ----
    case "list_installed_fonts":
      return [
        { name: "Segoe UI", filename: "segoeui.ttf", source: "system", substituted_to: null },
        { name: "Segoe UI Variable", filename: "SegUIVar.ttf", source: "system", substituted_to: null },
        { name: "Arial", filename: "arial.ttf", source: "system", substituted_to: null },
      ] as T;
    case "list_font_substitutions":
      return s.fonts.map((f) => ({ ...f })) as T;
    case "set_font_substitution": {
      const before = s.fonts.find((f) => f.original === args.original)?.substituted ?? "";
      s.fonts = s.fonts.filter((f) => f.original !== args.original);
      if (args.substitute) s.fonts.push({ original: args.original as string, substituted: args.substitute as string });
      pushUndo("font_substitution", `Font substitution: ${args.original} → ${args.substitute || "(default)"}`, true, { original: args.original, before, after: args.substitute });
      return s.fonts.map((f) => ({ ...f })) as T;
    }
    case "install_user_font":
      pushUndo("font_install", `Installed user font: ${String(args.path).split(/[\\/]/).pop()}`, true, { name: String(args.path).split(/[\\/]/).pop() });
      return [
        { name: "Segoe UI", filename: "segoeui.ttf", source: "system", substituted_to: null },
        { name: "My Font", filename: "my-font.ttf", source: "user", substituted_to: null },
      ] as T;
    case "remove_user_font":
      pushUndo("font_uninstall", `Removed user font: ${args.name}`, true, { name: args.name });
      return [
        { name: "Segoe UI", filename: "segoeui.ttf", source: "system", substituted_to: null },
      ] as T;

    // ---- lock screen ----
    case "get_lock_screen_state":
      return { ...s.lockscreen } as T;
    case "set_lock_screen_image":
      s.lockscreen = { ...s.lockscreen, mode: "image", image_path: String(args.source ?? ""), slideshow_folder: null };
      pushUndo("lock_screen", "Set lock screen image", true, { mode: "image" });
      return { ...s.lockscreen } as T;
    case "set_lock_screen_slideshow":
      s.lockscreen = { ...s.lockscreen, mode: "slideshow", slideshow_folder: args.folder as string, slideshow_interval_secs: (args.interval_minutes as number) * 60, slideshow_shuffle: args.shuffle as boolean, image_path: null };
      pushUndo("lock_screen", "Set lock screen slideshow", true, { mode: "slideshow" });
      return { ...s.lockscreen } as T;
    case "set_lock_screen_spotlight":
      s.lockscreen = { ...s.lockscreen, mode: "spotlight", image_path: null, slideshow_folder: null };
      pushUndo("lock_screen", "Enabled lock screen spotlight", true, { mode: "spotlight" });
      return { ...s.lockscreen } as T;
    case "set_lock_screen_hide_apps":
      s.lockscreen = { ...s.lockscreen, hide_apps: args.hide as boolean };
      pushUndo("lock_screen", `Lock screen detailed status ${args.hide ? "hidden" : "shown"}`, true, { hide_apps: args.hide });
      return { ...s.lockscreen } as T;

    // ---- capability / transcode status ----
    case "get_capability_matrix":
      return {
        os_name: "Microsoft Windows 11 Pro",
        build: 26200,
        version_band: "win11_24h2",
        is_win11: true,
        admin: true,
        secure_boot: true,
        taskbar_reposition_supported: false,
        font_substitution_supported: true,
        lockscreen_policy_supported: true,
        boot_customization_supported: false,
        rgb_supported: false,
        video_wallpaper_supported: true,
        ffmpeg_available: true,
        elevation_required_reason: null,
      } as T;

    // ---- static wallpaper: slideshow + history ----
    case "get_wallpaper_slideshow":
      return { ...s.slideshow } as T;
    case "set_wallpaper_slideshow": {
      s.slideshow = { ...(args.cfg as WallpaperSlideshowConfig) };
      if (s.slideshow.enabled) s.slideshow.next_rotation_ts = Date.now() + s.slideshow.interval_minutes * 60000;
      else s.slideshow.next_rotation_ts = null;
      pushUndo("wallpaper_slideshow", `Wallpaper rotation ${s.slideshow.enabled ? `on (every ${s.slideshow.interval_minutes} min)` : "off"}`, true, { enabled: s.slideshow.enabled });
      return { ...s.slideshow } as T;
    }
    case "skip_slideshow": {
      // Preview: no real folder — advance to a plausible next image so the
      // command round-trips honestly.
      const cfg = s.slideshow;
      if (!cfg.enabled || !cfg.folder.trim()) {
        throw new Error("Slideshow is not enabled — nothing to skip");
      }
      const name = `next-${(cfg.last_applied ?? "a").split(/[\\/]/).pop()}`;
      s.slideshow = {
        ...cfg,
        last_applied: `${cfg.folder}\\${name}.jpg`,
        next_rotation_ts: Date.now() + cfg.interval_minutes * 60_000,
      };
      return `Skipped to ${s.slideshow.last_applied}` as T;
    }
    case "get_wallpaper_history":
      return s.wallpaperHistory.map((h) => ({ ...h })) as T;

    // ---- Style Engine (C1.4): atomic, single undo entry, composite revert ----
    case "apply_style": {
      const st = args.style as {
        id: string;
        name: string;
        mode?: "dark" | "light";
        accent_hex?: string;
        transparency?: boolean;
        wallpaper?: string;
        wallpaper_type?: "static" | "live" | "scene";
        scene?: SceneConfig;
        font?: string;
        sound_scheme?: string;
        rgb?: "accent-sync" | "off";
      };
      const before = {
        accent: s.theme.accent_hex,
        mode: s.theme.mode,
        transparency: s.theme.transparency,
        wallpaper: s.wallpaper.current,
        engine: { active: s.engine.active, frozen: s.engine.frozen, scene: s.engine.scene, media: s.engine.media, static_wallpaper: s.engine.static_wallpaper },
        sound_scheme: s.sounds.find((x) => x.current)?.guid ?? "",
        font: { original: "Segoe UI Variable", before: s.fonts.find((f) => f.original === "Segoe UI Variable")?.substituted ?? "" },
        rgb: [],
      };
      const notes: string[] = [];
      // deeper components first (A1.6) — mirrors the Rust atomic order
      if (st.font) {
        const beforeFont = s.fonts.find((f) => f.original === "Segoe UI Variable")?.substituted ?? "";
        s.fonts = [...s.fonts.filter((f) => f.original !== "Segoe UI Variable"), { original: "Segoe UI Variable", substituted: st.font }];
        pushUndo("font_substitution", `Font substitution: Segoe UI Variable → ${st.font}`, true, { original: "Segoe UI Variable", before: beforeFont });
      }
      if (st.sound_scheme) {
        const target = resolveSchemeGuid(st.sound_scheme);
        const beforeScheme = s.sounds.find((x) => x.current)?.guid ?? "";
        s.sounds = s.sounds.map((x) => ({ ...x, current: x.guid === target }));
        pushUndo("sound_scheme", `Sound scheme → ${target}`, true, { before: beforeScheme, after: target });
      }
      if (st.rgb) {
        notes.push("RGB not applied — no OpenRGB devices in preview");
      }
      if (st.mode) s.theme = { ...s.theme, mode: st.mode };
      if (st.accent_hex) s.theme = { ...s.theme, accent_hex: st.accent_hex, color_prevalence: true };
      if (typeof st.transparency === "boolean") s.theme = { ...s.theme, transparency: st.transparency };
      const wtype = st.wallpaper_type ?? "static";
      if (wtype === "scene" && st.scene) {
        s.engine = { active: true, frozen: false, scene: { ...st.scene }, media: null, static_wallpaper: s.engine.static_wallpaper || s.wallpaper.current };
      } else if (wtype === "live" && st.wallpaper) {
        // live wallpapers are video — engine.media, not a static image
        s.engine = {
          active: true,
          frozen: false,
          scene: null,
          media: { path: st.wallpaper, kind: "video", width: 1920, height: 1080, name: st.wallpaper.split("/").pop() ?? "media" },
          static_wallpaper: s.engine.static_wallpaper || s.wallpaper.current,
        };
      } else if (st.wallpaper) {
        s.wallpaper = { ...s.wallpaper, current: st.wallpaper };
        s.engine = { active: false, frozen: false, scene: null, media: null, static_wallpaper: "" };
      }
      pushUndo("style_applied", `Applied style: ${st.name}`, true, { before, style_id: st.id });
      return { ok: true, name: st.name, notes } as T;
    }
    case "get_applied_style": {
      const last = s.undo.find((u) => u.kind === "style_applied" && !u.undone);
      return ((last?.data.style_id as string) ?? null) as T;
    }

    // ---- Windows Security Center mocks (B1) — preview parity with native ----
    case "security_get_health_status":
      return {
        overall_status: "healthy",
        antivirus: [{ name: "Microsoft Defender Antivirus", enabled: true, up_to_date: true }],
        firewall: [{ name: "Windows Defender Firewall", enabled: true }],
        third_party_active: false,
        tamper_protection_on: true,
        defender_detail: {
          real_time_protection_on: true,
          signature_age_days: 1,
          definitions_up_to_date: true,
          tamper_protection: true,
        },
      } as T;
    case "security_get_scan_history":
      return [
        { ts: Date.now() - 3600000, scan_type: "quick", result: "completed", threats_found: 0 },
        { ts: Date.now() - 86400000, scan_type: "full", result: "completed", threats_found: 0 },
        { ts: Date.now() - 86400000 * 6, scan_type: "quick", result: "completed", threats_found: 2 },
      ] as T;
    case "security_list_threats":
      return [] as T;
    case "security_audit_autorun_threat_surface":
      return [
        { name: "OneDriveStandaloneUpdateTask", location: "Task Scheduler", command: "OneDriveSetup.exe", flags: ["Microsoft-signed"], is_signed: true },
        { name: "crypto-miner-helper", location: "HKCU\\Run", command: "%AppData%\\crypto-helper\\miner.exe", flags: ["unsigned", "suspicious name"], is_signed: false },
      ] as T;
    case "security_get_cfa_status":
      return { mode: "disabled" } as T;
    case "security_list_asr_rules":
      return [
        { id: "asr-1", name: "Block executable content from email", action: "audit" },
        { id: "asr-2", name: "Block Office apps from creating child processes", action: "disabled" },
        { id: "asr-3", name: "Block credential stealing from Windows subsystem", action: "enabled" },
      ] as T;
    case "security_trigger_scan":
      return `Quick scan started (${args.scan_type ?? "quick"}) — results appear in the Security Center.` as T;
    case "security_update_definitions":
      return "Definition update triggered — Defender is up to date." as T;
    case "security_restore_threat":
      return `Restored threat ${args.threat_id} from quarantine.` as T;
    case "security_remove_threat":
      return `Removed threat ${args.threat_id} permanently.` as T;
    case "security_set_cfa_mode":
      return { mode: args.mode as string } as T;
    case "security_set_asr_rule_action":
      return null as T;
    // ---- RGB (E7.9): mock parity with rgb.rs so preview matches desktop ----
    case "rgb_detect":
      return { available: false, devices: [], note: "No RGB devices in browser preview — run the desktop app to detect OpenRGB devices." } as T;
    case "rgb_set_static":
      return `Set RGB device ${args.device_index ?? 0} to ${args.hex}` as T;
    case "rgb_restore_current_mode":
      return `Restored RGB device ${args.device_index ?? 0} to its current mode` as T;
    // ---- Widgets hub (fun module) — mock parity with fun/*.rs ----
    case "fun_get_state":
      return {
        enabled: [...s.fun.enabled],
        configs: JSON.parse(JSON.stringify(s.fun.configs)),
        achievements: [...s.fun.achievements],
        counts: { ...s.fun.counts },
      } as T;
    case "fun_set_enabled": {
      const id = args.id as string;
      const on = args.on as boolean;
      if (on && !s.fun.enabled.includes(id)) s.fun.enabled.push(id);
      if (!on) s.fun.enabled = s.fun.enabled.filter((e) => e !== id);
      return {
        enabled: [...s.fun.enabled],
        configs: JSON.parse(JSON.stringify(s.fun.configs)),
        achievements: [...s.fun.achievements],
        counts: { ...s.fun.counts },
      } as T;
    }
    case "fun_set_config": {
      const id = args.id as string;
      const patch = (args.patch ?? {}) as Record<string, unknown>;
      s.fun.configs[id] = { ...(s.fun.configs[id] ?? {}), ...patch };
      return {
        enabled: [...s.fun.enabled],
        configs: JSON.parse(JSON.stringify(s.fun.configs)),
        achievements: [...s.fun.achievements],
        counts: { ...s.fun.counts },
      } as T;
    }
    case "fun_bump_count": {
      const key = args.key as string;
      const n = (args.n as number) ?? 1;
      s.fun.counts[key] = (s.fun.counts[key] ?? 0) + n;
      return s.fun.counts[key] as T;
    }
    case "fun_unlock_achievement": {
      const id = args.id as string;
      if (s.fun.achievements.includes(id)) return false as T;
      s.fun.achievements.push(id);
      return true as T;
    }
    case "fun_get_stats":
      return {
        cpu: 12 + Math.random() * 30,
        ram_pct: 46 + Math.random() * 12,
        mem_used: 8_200_000_000,
        mem_total: 16_000_000_000,
        disk_pct: 61,
        proc_count: 148,
        uptime_secs: 3 * 3600 + 1200,
        idle_secs: 90,
        top_procs: [
          { name: "reforge.exe", cpu: 4.2 },
          { name: "explorer.exe", cpu: 2.1 },
          { name: "steam.exe", cpu: 1.4 },
        ],
      } as T;
    case "fun_capture_screen":
      // 1×1 transparent PNG (browser preview has no screen to capture)
      return "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==" as T;
    case "fun_save_png":
      return `${args.filename ?? "image.png"} (saved — browser preview has no real Downloads folder)` as T;
    case "fun_spawn_overlay":
    case "fun_close_overlay":
      return null as T;
    // ---- auto-updater (S12.1) ----
    case "get_update_config": {
      // Normalize with defaults so a config persisted before check_on_startup
      // existed never surfaces `undefined` to the UI.
      const dflt = { manifest_url: "https://reforge.app/releases/latest.json", check_on_startup: false };
      return { ...dflt, ...s.updateConfig } as T;
    }
    case "set_update_config": {
      const dflt = { manifest_url: "https://reforge.app/releases/latest.json", check_on_startup: false };
      s.updateConfig = { ...dflt, ...(args.cfg as UpdateConfig) };
      return { ...s.updateConfig } as T;
    }
    case "check_for_update": {
      // Browser preview has no network — mirror the honest "error" branch so
      // the UI exercises the real offline path, and let tests inject a
      // manifest via set_update_config + a stub flag (see api.test.ts).
      if (s.mockUpdateResult) return { ...s.mockUpdateResult } as T;
      return {
        state: "error",
        current: "0.1.0",
        latest: null,
        url: null,
        sha256: null,
        notes: [],
        message: "could not reach the update server (preview mode has no network)",
      } as T;
    }
    case "download_update": {
      if (!s.mockUpdateResult || s.mockUpdateResult.state !== "update-available") {
        throw new Error("no update available to download");
      }
      const staged: StagedUpdate = {
        version: args.version as string,
        path: `%APPDATA%\\com.reforge.app\\updates\\reforge-${args.version}.exe`,
        bytes: 318 * 1024 * 1024,
        downloaded_at: Date.now(),
      };
      s.stagedUpdate = staged;
      return staged as T;
    }
    case "apply_staged_update": {
      if (!s.stagedUpdate) throw new Error("No staged update found — download one first");
      return `Update ${s.stagedUpdate.version} is staged and verified at ${s.stagedUpdate.path} — production installs it silently on the next launch via the NSIS installer.` as T;
    }
    case "fun_hotkey_state":
      return {} as T;
    // ---- test hook (mock-only — never in Rust, so arg-parity ignores it) ----
    case "mock_set_update_result": {
      s.mockUpdateResult = (args.result ?? null) as UpdateCheck | null;
      s.stagedUpdate = null; // reset the stage too, so tests start clean
      return null as T;
    }
    default:
      throw new Error(`no mock for command: ${cmd}`);
  }
}

// Persist preview state after mock calls — debounced so rapid slider drags
// don't hammer localStorage on every tick (C2.4), flushed on unload.
let persistTimer: number | undefined;
function schedulePersist() {
  if (persistTimer !== undefined) window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => persistStore(), 200);
}
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    if (persistTimer !== undefined) {
      window.clearTimeout(persistTimer);
      persistStore();
    }
  });
}

/** Mock dispatcher (renamed from mockCall in api.ts). Schedules persistence
 *  after every successful call so preview survives reloads. */
export async function mockCall<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const r = await mockCallInner<T>(cmd, args);
  schedulePersist();
  return r;
}
