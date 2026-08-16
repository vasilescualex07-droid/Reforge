// Scene style tier (A1.3). Every scene in the engine's catalog gets a
// first-class style — a full look whose wallpaper *is* the animated scene.
// Accents and gradients come from each scene's own color story, and the
// sceneTweak carries the scene's deliberate speed/density so the animated
// twin synthesis (scenes.ts) keeps the identity instead of guessing.

import type { StyleDef } from "./types";

interface SceneSpec {
  id: string;
  name: string;
  tagline: string;
  description: string;
  category: string;
  mood: StyleDef["mood"];
  mode: "dark" | "light";
  accent_hex: string;
  gradient: [string, string];
  sceneId: string;
  speed: number;
  density: number;
  taskbar?: NonNullable<StyleDef["taskbar"]>;
  rgb?: "accent-sync" | "off";
  widgets: string[];
  tags: string[];
  quiz: StyleDef["quiz"];
}

const SPECS: SceneSpec[] = [
  {
    id: "aurora-hush", name: "Aurora Hush", tagline: "A slow aurora, an indigo room",
    description: "The Aurora Drift scene as a full look — indigo accent, translucent taskbar, stats widgets. Quiet enough to think in.",
    category: "Calm", mood: "calm", mode: "dark", accent_hex: "#818CF8",
    gradient: ["#0B1026", "#2A3B7C"], sceneId: "aurora-drift", speed: 0.6, density: 1.0,
    taskbar: { size: "medium", alignment: "center", color_match: true }, widgets: ["clock", "stats"],
    tags: ["scene", "aurora", "calm", "dark"], quiz: { dark: 3, cool: 2, calm: 3, motion: 2 },
  },
  {
    id: "deep-tide", name: "Deep Tide", tagline: "Waves in cobalt, no shore in sight",
    description: "The Deep Tide scene with a cobalt accent and color-matched taskbar. Ocean-blue calm that keeps working.",
    category: "Nature", mood: "calm", mode: "dark", accent_hex: "#0EA5E9",
    gradient: ["#08131F", "#123A5A"], sceneId: "deep-tide", speed: 0.7, density: 1.0,
    taskbar: { size: "medium", alignment: "center", color_match: true }, widgets: ["clock", "calendar"],
    tags: ["scene", "waves", "calm", "ocean"], quiz: { nature: 2, cool: 3, calm: 3, motion: 2 },
  },
  {
    id: "moonlit-dunes", name: "Moonlit Dunes", tagline: "Sand that glows at midnight",
    description: "The Moonlit Dunes particles scene with a pale-gold accent. Soft, slow, and a little surreal.",
    category: "Calm", mood: "calm", mode: "dark", accent_hex: "#E8C468",
    gradient: ["#0D0B16", "#2E2A3E"], sceneId: "moonlit-dunes", speed: 0.5, density: 0.7,
    taskbar: { size: "medium", alignment: "center" }, widgets: ["clock"],
    tags: ["scene", "particles", "calm", "dark"], quiz: { dark: 2, warm: 2, calm: 3, motion: 1 },
  },
  {
    id: "misty-forest", name: "Misty Forest", tagline: "Parallax pines in green fog",
    description: "The Misty Forest parallax scene with a deep-emerald accent. Layers of quiet, moving slowly.",
    category: "Nature", mood: "calm", mode: "dark", accent_hex: "#10B981",
    gradient: ["#04120A", "#0E3B22"], sceneId: "misty-forest", speed: 0.5, density: 1.0,
    taskbar: { size: "small", alignment: "left" }, widgets: ["clock", "calendar"],
    tags: ["scene", "parallax", "calm", "forest"], quiz: { nature: 3, dark: 2, calm: 3, motion: 1 },
  },
  {
    id: "neon-surge", name: "Neon Surge", tagline: "Particles on espresso, loud and fast",
    description: "The Neon Surge scene with a cyan accent, bold chrome, RGB accent-sync. The desk hums along.",
    category: "Gaming", mood: "energetic", mode: "dark", accent_hex: "#22D3EE",
    gradient: ["#0A0A1A", "#1E3A6E"], sceneId: "neon-surge", speed: 1.6, density: 1.5,
    taskbar: { size: "large", alignment: "left", color_match: true }, widgets: ["clock", "stats", "todo"], rgb: "accent-sync",
    tags: ["scene", "particles", "energetic", "gaming"], quiz: { dark: 2, gaming: 3, energetic: 3, vivid: 2, motion: 3 },
  },
  {
    id: "synth-grid", name: "Synth Grid", tagline: "A geometric grid in neon ink",
    description: "The Synth Grid scene with an indigo accent and bold taskbar. Retro-futurist, straight ahead.",
    category: "Retro", mood: "energetic", mode: "dark", accent_hex: "#818CF8",
    gradient: ["#0D0221", "#312E81"], sceneId: "synth-grid", speed: 1.3, density: 1.2,
    taskbar: { size: "large", alignment: "left", color_match: true }, widgets: ["clock", "stats"],
    tags: ["scene", "geometric", "retro", "energetic"], quiz: { dark: 2, retro: 3, energetic: 2, vivid: 2, motion: 2 },
  },
  {
    id: "ember-storm", name: "Ember Storm", tagline: "Sparks that refuse to land",
    description: "The Ember Storm scene with a warm ember accent and centered taskbar. Fire, channeled.",
    category: "Energetic", mood: "energetic", mode: "dark", accent_hex: "#FB923C",
    gradient: ["#160B05", "#4A1D08"], sceneId: "ember-storm", speed: 1.4, density: 1.3,
    taskbar: { size: "medium", alignment: "center" }, widgets: ["clock", "todo"],
    tags: ["scene", "embers", "energetic", "warm"], quiz: { warm: 3, energetic: 3, dark: 2, motion: 3 },
  },
  {
    id: "retro-sunset", name: "Retro Sunset", tagline: "A grid on fire at 19:00",
    description: "The Retro Sunset scene with a magenta accent and bold left taskbar. Dusk, but make it synthwave.",
    category: "Retro", mood: "energetic", mode: "dark", accent_hex: "#FF2E88",
    gradient: ["#1A0E2E", "#7B2FF7"], sceneId: "retro-sunset", speed: 0.9, density: 1.1,
    taskbar: { size: "large", alignment: "left" }, widgets: ["clock", "todo"],
    tags: ["scene", "retro", "sunset", "energetic"], quiz: { dark: 2, retro: 3, warm: 2, energetic: 2, motion: 2 },
  },
  {
    id: "meadow-breeze", name: "Meadow Breeze", tagline: "Green pollen on a still day",
    description: "The Meadow Breeze scene with a fresh-lime accent. Nature that moves like a soft exhale.",
    category: "Nature", mood: "calm", mode: "dark", accent_hex: "#A3E635",
    gradient: ["#0A1408", "#2A3D12"], sceneId: "meadow-breeze", speed: 0.6, density: 0.8,
    taskbar: { size: "medium", alignment: "center" }, widgets: ["clock", "calendar"],
    tags: ["scene", "particles", "nature", "calm"], quiz: { nature: 3, calm: 3, dark: 1, motion: 1 },
  },
  {
    id: "coral-reef", name: "Coral Reef", tagline: "Currents in coral and turquoise",
    description: "The Coral Reef scene with a lagoon accent and translucent taskbar. An aquarium for your monitor.",
    category: "Nature", mood: "calm", mode: "dark", accent_hex: "#2DD4BF",
    gradient: ["#041412", "#0C403A"], sceneId: "coral-reef", speed: 0.8, density: 1.1,
    taskbar: { size: "medium", alignment: "center", color_match: true }, widgets: ["clock", "calendar"],
    tags: ["scene", "waves", "nature", "calm"], quiz: { nature: 3, cool: 2, calm: 3, motion: 2 },
  },
  {
    id: "autumn-drift", name: "Autumn Drift", tagline: "Leaves falling in slow amber",
    description: "The Autumn Drift parallax scene with a burnt-orange accent. The season, gently looping.",
    category: "Seasonal", mood: "cozy", mode: "dark", accent_hex: "#F59E0B",
    gradient: ["#160D04", "#4A2A08"], sceneId: "autumn-leaves", speed: 0.7, density: 1.2,
    taskbar: { size: "medium", alignment: "center" }, widgets: ["clock", "note"],
    tags: ["scene", "parallax", "autumn", "cozy"], quiz: { warm: 3, cozy: 3, dark: 2, motion: 2 },
  },
  {
    id: "river-glow", name: "River Glow", tagline: "Emerald fire on moving water",
    description: "The River Glow scene with a green accent and centered taskbar. Glow that follows the current.",
    category: "Nature", mood: "calm", mode: "dark", accent_hex: "#34D399",
    gradient: ["#04150C", "#0E3B22"], sceneId: "river-glow", speed: 0.6, density: 0.9,
    taskbar: { size: "medium", alignment: "center" }, widgets: ["clock", "calendar"],
    tags: ["scene", "embers", "river", "calm"], quiz: { nature: 3, calm: 3, cool: 1, motion: 2 },
  },
  {
    id: "stardust", name: "Stardust", tagline: "A slow fall of distant light",
    description: "The Stardust scene with an indigo accent and color-matched taskbar. Space, minus the vertigo.",
    category: "Space", mood: "calm", mode: "dark", accent_hex: "#818CF8",
    gradient: ["#030512", "#111B45"], sceneId: "stardust", speed: 0.5, density: 1.0,
    taskbar: { size: "medium", alignment: "center", color_match: true }, widgets: ["clock", "stats"],
    tags: ["scene", "stars", "space", "calm"], quiz: { space: 3, dark: 2, calm: 3, motion: 2 },
  },
  {
    id: "nebula-bloom", name: "Nebula Bloom", tagline: "A nebula that breathes color",
    description: "The Nebula Bloom scene with a violet accent on near-black. Deep space, on a gentle loop.",
    category: "Space", mood: "calm", mode: "dark", accent_hex: "#C084FC",
    gradient: ["#0C0716", "#2E1B56"], sceneId: "nebula-bloom", speed: 0.7, density: 1.2,
    taskbar: { size: "medium", alignment: "center" }, widgets: ["clock", "stats"],
    tags: ["scene", "aurora", "nebula", "calm"], quiz: { space: 3, dark: 2, cool: 2, calm: 2, motion: 2 },
  },
  {
    id: "orbital", name: "Orbital", tagline: "Geometry in low orbit",
    description: "The Orbital scene with a sky accent and slim taskbar. Clean lines, precise motion.",
    category: "Space", mood: "focused", mode: "dark", accent_hex: "#38BDF8",
    gradient: ["#050A14", "#16264A"], sceneId: "orbital", speed: 0.8, density: 0.9,
    taskbar: { size: "small", alignment: "left" }, widgets: ["clock", "stats"],
    tags: ["scene", "geometric", "space", "focused"], quiz: { space: 3, focused: 3, dark: 2, motion: 1 },
  },
  {
    id: "comet-trail", name: "Comet Trail", tagline: "Stars that streak and vanish",
    description: "The Comet Trail scene with a blue accent and bold taskbar. Fast, bright, gone.",
    category: "Space", mood: "energetic", mode: "dark", accent_hex: "#60A5FA",
    gradient: ["#050815", "#16264A"], sceneId: "comet-trail", speed: 1.0, density: 1.1,
    taskbar: { size: "large", alignment: "left" }, widgets: ["clock", "stats"],
    tags: ["scene", "stars", "space", "energetic"], quiz: { space: 3, energetic: 3, dark: 2, motion: 3 },
  },
  {
    id: "frost-fall", name: "Frost Fall", tagline: "Falling snow, frost-blue light",
    description: "The Winter Snowfall scene in crisp light mode with an ice accent. Silent, cold, clean.",
    category: "Seasonal", mood: "calm", mode: "light", accent_hex: "#3B82C4",
    gradient: ["#F2F7FC", "#BCD4E8"], sceneId: "winter-snow", speed: 0.7, density: 1.4,
    taskbar: { size: "small", alignment: "left" }, widgets: ["clock"],
    tags: ["scene", "snow", "seasonal", "light"], quiz: { light: 3, cool: 2, calm: 2, motion: 2 },
  },
  {
    id: "spring-blossom", name: "Spring Blossom", tagline: "Petals on a bright morning",
    description: "The Spring Blossom parallax scene in light mode with a blush accent. Soft, fresh, unbothered.",
    category: "Seasonal", mood: "playful", mode: "light", accent_hex: "#F9A8D4",
    gradient: ["#FDF5F8", "#F0C2D4"], sceneId: "spring-blossom", speed: 0.6, density: 1.1,
    taskbar: { size: "medium", alignment: "center" }, widgets: ["clock", "calendar"],
    tags: ["scene", "blossom", "seasonal", "playful"], quiz: { light: 2, warm: 2, playful: 3, soft: 2, motion: 2 },
  },
  {
    id: "holiday-lights", name: "Holiday Lights", tagline: "A tree that never comes down",
    description: "The Holiday Lights scene with a warm-gold accent and centered taskbar. Festive, year-round, on purpose.",
    category: "Seasonal", mood: "energetic", mode: "dark", accent_hex: "#FBBF24",
    gradient: ["#140D04", "#3A2A0E"], sceneId: "holiday-lights", speed: 0.8, density: 1.2,
    taskbar: { size: "medium", alignment: "center" }, widgets: ["clock", "todo"],
    tags: ["scene", "lights", "seasonal", "energetic"], quiz: { warm: 3, energetic: 2, playful: 2, dark: 2, motion: 2 },
  },
  {
    id: "cherry-petals", name: "Cherry Petals", tagline: "Blossoms falling in soft pink",
    description: "The Cherry Petals scene with a rose accent on dark. Spring, after hours.",
    category: "Seasonal", mood: "playful", mode: "dark", accent_hex: "#F9A8D4",
    gradient: ["#14080E", "#3A1626"], sceneId: "cherry-fall", speed: 0.7, density: 1.0,
    taskbar: { size: "medium", alignment: "center" }, widgets: ["clock", "calendar"],
    tags: ["scene", "petals", "seasonal", "playful"], quiz: { dark: 2, warm: 2, playful: 3, soft: 2, motion: 2 },
  },
  {
    id: "neon-riptide", name: "Neon Riptide", tagline: "The same waves, turned up",
    description: "The Deep Tide scene at speed with a cobalt accent and bold chrome. Ocean, but wired.",
    category: "Gaming", mood: "energetic", mode: "dark", accent_hex: "#1D4ED8",
    gradient: ["#060A18", "#123A6E"], sceneId: "deep-tide", speed: 1.2, density: 1.4,
    taskbar: { size: "large", alignment: "left", color_match: true }, widgets: ["clock", "stats", "todo"],
    tags: ["scene", "waves", "energetic", "gaming"], quiz: { dark: 2, cool: 3, energetic: 3, gaming: 2, motion: 3 },
  },
  {
    id: "ember-hearth", name: "Ember Hearth", tagline: "Sparks, slowed to a fireplace",
    description: "The Ember Storm scene slowed down with a gold accent. A hearth you can rest next to.",
    category: "Cozy", mood: "cozy", mode: "dark", accent_hex: "#FACC15",
    gradient: ["#120B04", "#3A2A0E"], sceneId: "ember-storm", speed: 0.6, density: 0.8,
    taskbar: { size: "medium", alignment: "center" }, widgets: ["clock", "note"],
    tags: ["scene", "embers", "cozy", "warm"], quiz: { warm: 3, cozy: 3, dark: 2, motion: 1 },
  },
  {
    id: "nova-night", name: "Nova Night", tagline: "Gold dust in a cold sky",
    description: "The Stardust scene with a gold accent and translucent taskbar. Warm sparks, deep space.",
    category: "Space", mood: "calm", mode: "dark", accent_hex: "#FBBF24",
    gradient: ["#0D0B16", "#2E2A3E"], sceneId: "stardust", speed: 0.5, density: 0.9,
    taskbar: { size: "medium", alignment: "center" }, widgets: ["clock", "stats"],
    tags: ["scene", "stars", "space", "calm"], quiz: { space: 3, warm: 2, calm: 2, dark: 2, motion: 2 },
  },
  {
    id: "crystal-grid", name: "Crystal Grid", tagline: "Quiet geometry in slate",
    description: "The Orbital scene at rest with a slate accent and slim taskbar. Precision without the pulse.",
    category: "Minimal", mood: "focused", mode: "dark", accent_hex: "#94A3B8",
    gradient: ["#0B0F16", "#2A3440"], sceneId: "orbital", speed: 0.5, density: 0.6,
    taskbar: { size: "small", alignment: "left" }, widgets: ["clock"],
    tags: ["scene", "geometric", "minimal", "focused"], quiz: { neutral: 3, minimal: 3, focused: 3, mono: 1, motion: 1 },
  },
  // ---- S5: the A6.1 scenes get first-class styles ---------------------------
  {
    id: "midnight-downpour", name: "Midnight Downpour", tagline: "Indigo rain on a dark street",
    description: "The Midnight Rain scene with a soft-blue accent and color-matched taskbar. Rain you can think under.",
    category: "Calm", mood: "calm", mode: "dark", accent_hex: "#60A5FA",
    gradient: ["#0A1128", "#1E3A5F"], sceneId: "midnight-rain", speed: 0.8, density: 1.2,
    taskbar: { size: "medium", alignment: "center", color_match: true }, widgets: ["clock", "stats"],
    tags: ["scene", "rain", "calm", "dark"], quiz: { dark: 3, cool: 3, calm: 3, motion: 2 },
  },
  {
    id: "firefly-grove", name: "Firefly Grove", tagline: "Gold sparks in a green night",
    description: "The Firefly Grove scene with a warm-gold accent and a note widget. Small lights, slow evening.",
    category: "Nature", mood: "cozy", mode: "dark", accent_hex: "#FDE047",
    gradient: ["#0B1206", "#2A3D12"], sceneId: "firefly-grove", speed: 0.5, density: 0.9,
    taskbar: { size: "medium", alignment: "center" }, widgets: ["clock", "note"],
    tags: ["scene", "fireflies", "nature", "cozy"], quiz: { nature: 3, warm: 2, cozy: 3, motion: 1 },
  },
  {
    id: "blizzard-drift", name: "Blizzard Drift", tagline: "White wind, kept outside",
    description: "The Blizzard Drift scene with an ice-blue accent and slim taskbar. A storm on the wall, quiet at the desk.",
    category: "Seasonal", mood: "calm", mode: "dark", accent_hex: "#BAE6FD",
    gradient: ["#0C1A33", "#1E3A8A"], sceneId: "blizzard-drift", speed: 1.1, density: 1.3,
    taskbar: { size: "small", alignment: "left" }, widgets: ["clock"],
    tags: ["scene", "snow", "seasonal", "calm"], quiz: { cool: 3, calm: 2, light: 1, motion: 2 },
  },
  {
    id: "bokeh-aurora", name: "Bokeh Aurora", tagline: "Soft orbs in deep space",
    description: "The Bokeh Bloom scene with a violet accent and translucent taskbar. Dreamy, slow, off-world.",
    category: "Space", mood: "calm", mode: "dark", accent_hex: "#C084FC",
    gradient: ["#0D0B1A", "#2E1B4B"], sceneId: "bokeh-aurora", speed: 0.4, density: 0.8,
    taskbar: { size: "medium", alignment: "center", color_match: true }, widgets: ["clock", "stats"],
    tags: ["scene", "bokeh", "space", "calm"], quiz: { space: 3, dark: 2, soft: 3, calm: 2, motion: 1 },
  },
  {
    id: "smoke-ember", name: "Smoke & Ember", tagline: "Warm smoke over a low fire",
    description: "The Smoke & Ember scene with a warm ember accent and centered taskbar. A lounge for your monitor.",
    category: "Cozy", mood: "cozy", mode: "dark", accent_hex: "#FB923C",
    gradient: ["#160B05", "#3A1D08"], sceneId: "smoke-ember", speed: 0.9, density: 0.9,
    taskbar: { size: "medium", alignment: "center" }, widgets: ["clock", "note"],
    tags: ["scene", "smoke", "cozy", "warm"], quiz: { warm: 3, cozy: 3, dark: 2, motion: 1 },
  },
  {
    id: "ocean-depth", name: "Ocean Depth", tagline: "Currents in cobalt, far below",
    description: "The Ocean Depth scene with a sky accent and color-matched taskbar. Deep water, steady rhythm.",
    category: "Nature", mood: "calm", mode: "dark", accent_hex: "#0EA5E9",
    gradient: ["#04121F", "#0C3A5A"], sceneId: "ocean-depth", speed: 0.8, density: 1.0,
    taskbar: { size: "medium", alignment: "center", color_match: true }, widgets: ["clock", "calendar"],
    tags: ["scene", "waves", "ocean", "calm"], quiz: { nature: 3, cool: 3, calm: 3, motion: 2 },
  },
  // ---- S5: new catalog scenes (26 → 48) ------------------------------------
  {
    id: "digital-rain", name: "Digital Rain", tagline: "Green code, falling forever",
    description: "The Digital Rain matrix scene with a terminal-green accent, bold chrome, and RGB accent-sync. The classic, running live.",
    category: "Gaming", mood: "energetic", mode: "dark", accent_hex: "#22C55E",
    gradient: ["#03150A", "#0A3D1F"], sceneId: "digital-rain", speed: 1.2, density: 1.5,
    taskbar: { size: "large", alignment: "left", color_match: true }, widgets: ["clock", "stats", "todo"], rgb: "accent-sync",
    tags: ["scene", "matrix", "gaming", "energetic"], quiz: { dark: 2, gaming: 3, energetic: 3, bold: 2, motion: 3 },
  },
  {
    id: "cipher-fall", name: "Cipher Fall", tagline: "Cyan glyphs, one job at a time",
    description: "The Cipher Fall matrix scene in cool cyan with a slim taskbar. Code rain, hushed into a focus tool.",
    category: "Minimal", mood: "focused", mode: "dark", accent_hex: "#22D3EE",
    gradient: ["#040D14", "#123A4A"], sceneId: "cipher-fall", speed: 0.9, density: 1.3,
    taskbar: { size: "small", alignment: "left" }, widgets: ["clock"],
    tags: ["scene", "matrix", "minimal", "focused"], quiz: { cool: 3, minimal: 3, focused: 3, motion: 2 },
  },
  {
    id: "amber-rain", name: "Amber Rain", tagline: "Warm drops on a gold window",
    description: "The Amber Rain scene with a honey accent and centered taskbar. Rain that reads as cozy instead of grey.",
    category: "Cozy", mood: "cozy", mode: "dark", accent_hex: "#F59E0B",
    gradient: ["#1A1004", "#4A2A08"], sceneId: "amber-rain", speed: 0.7, density: 1.0,
    taskbar: { size: "medium", alignment: "center" }, widgets: ["clock", "note"],
    tags: ["scene", "rain", "cozy", "warm"], quiz: { warm: 3, cozy: 3, dark: 2, motion: 2 },
  },
  {
    id: "violet-rain", name: "Violet Rain", tagline: "Lilac drizzle, after midnight",
    description: "The Violet Rain scene with a lavender accent and color-matched taskbar. Soft rain for a quiet desk.",
    category: "Calm", mood: "calm", mode: "dark", accent_hex: "#A78BFA",
    gradient: ["#0E0B1E", "#2E2850"], sceneId: "violet-rain", speed: 0.6, density: 1.1,
    taskbar: { size: "medium", alignment: "center", color_match: true }, widgets: ["clock", "stats"],
    tags: ["scene", "rain", "calm", "dark"], quiz: { dark: 2, cool: 2, soft: 3, calm: 3, motion: 1 },
  },
  {
    id: "ember-fireflies", name: "Ember Fireflies", tagline: "Sparks that drift like embers",
    description: "The Ember Fireflies scene with a warm amber accent and centered taskbar. Fire, softened to a glow.",
    category: "Cozy", mood: "cozy", mode: "dark", accent_hex: "#FB923C",
    gradient: ["#160B05", "#3A1D08"], sceneId: "ember-fireflies", speed: 0.5, density: 0.9,
    taskbar: { size: "medium", alignment: "center" }, widgets: ["clock", "note"],
    tags: ["scene", "fireflies", "cozy", "warm"], quiz: { warm: 3, cozy: 3, dark: 2, motion: 1 },
  },
  {
    id: "glacier-drift", name: "Glacier Drift", tagline: "Ice wind, slowed to a lullaby",
    description: "The Glacier Drift scene with an ice accent and slim taskbar. Cold outside, calm at the desk.",
    category: "Seasonal", mood: "calm", mode: "dark", accent_hex: "#7DD3FC",
    gradient: ["#081420", "#123A5A"], sceneId: "glacier-drift", speed: 0.9, density: 1.2,
    taskbar: { size: "small", alignment: "left" }, widgets: ["clock"],
    tags: ["scene", "snow", "seasonal", "calm"], quiz: { cool: 3, calm: 3, light: 1, motion: 2 },
  },
  {
    id: "aurora-snow", name: "Aurora Snow", tagline: "Lilac snow under green lights",
    description: "The Aurora Snow scene with a periwinkle accent and centered taskbar. Winter, but make it dreamy.",
    category: "Seasonal", mood: "playful", mode: "dark", accent_hex: "#C4B5FD",
    gradient: ["#0E0B1E", "#312E81"], sceneId: "aurora-snow", speed: 0.8, density: 1.1,
    taskbar: { size: "medium", alignment: "center" }, widgets: ["clock", "calendar"],
    tags: ["scene", "snow", "seasonal", "playful"], quiz: { cool: 2, soft: 3, playful: 3, motion: 2 },
  },
  {
    id: "bokeh-city", name: "Bokeh City", tagline: "A skyline made of soft light",
    description: "The Bokeh City scene with a magenta accent and bold chrome. City lights, defocused into color.",
    category: "Energetic", mood: "energetic", mode: "dark", accent_hex: "#F472B6",
    gradient: ["#140A18", "#3A1B3A"], sceneId: "bokeh-city", speed: 0.6, density: 1.1,
    taskbar: { size: "large", alignment: "left" }, widgets: ["clock", "stats"],
    tags: ["scene", "bokeh", "city", "energetic"], quiz: { city: 3, energetic: 3, dark: 2, vivid: 2, motion: 2 },
  },
  {
    id: "incense-smoke", name: "Incense Smoke", tagline: "Warm grey, curling upward",
    description: "The Incense Smoke scene with a gold-grey accent and centered taskbar. A slow exhale for the desk.",
    category: "Calm", mood: "calm", mode: "dark", accent_hex: "#D9A441",
    gradient: ["#120E08", "#3A2E18"], sceneId: "incense-smoke", speed: 0.4, density: 0.8,
    taskbar: { size: "medium", alignment: "center" }, widgets: ["clock"],
    tags: ["scene", "smoke", "calm", "warm"], quiz: { warm: 2, neutral: 2, calm: 3, soft: 3, motion: 1 },
  },
  {
    id: "crimson-tide", name: "Crimson Tide", tagline: "Red water, turned all the way up",
    description: "The Crimson Tide scene with a red accent, bold chrome, and RGB accent-sync. The ocean, but wired.",
    category: "Energetic", mood: "energetic", mode: "dark", accent_hex: "#EF4444",
    gradient: ["#1A0606", "#4A1414"], sceneId: "crimson-tide", speed: 1.1, density: 1.2,
    taskbar: { size: "large", alignment: "left", color_match: true }, widgets: ["clock", "stats", "todo"], rgb: "accent-sync",
    tags: ["scene", "waves", "energetic", "gaming"], quiz: { dark: 2, warm: 3, energetic: 3, bold: 2, motion: 3 },
  },
  {
    id: "aurora-boreal", name: "Aurora Boreal", tagline: "Green fire in a violet sky",
    description: "The Aurora Boreal scene with an emerald accent and color-matched taskbar. The northern lights, on loop.",
    category: "Nature", mood: "calm", mode: "dark", accent_hex: "#34D399",
    gradient: ["#04120C", "#123A2A"], sceneId: "aurora-boreal", speed: 0.7, density: 1.1,
    taskbar: { size: "medium", alignment: "center", color_match: true }, widgets: ["clock", "stats"],
    tags: ["scene", "aurora", "nature", "calm"], quiz: { nature: 3, cool: 2, calm: 3, motion: 2 },
  },
  {
    id: "starlight-sea", name: "Starlight Sea", tagline: "Cobalt water under gold stars",
    description: "The Starlight Sea scene with a sky accent and centered taskbar. Two kinds of calm at once.",
    category: "Calm", mood: "calm", mode: "dark", accent_hex: "#60A5FA",
    gradient: ["#050A18", "#122A4A"], sceneId: "starlight-sea", speed: 0.6, density: 0.9,
    taskbar: { size: "medium", alignment: "center" }, widgets: ["clock", "stats"],
    tags: ["scene", "waves", "stars", "calm"], quiz: { nature: 2, space: 2, calm: 3, cool: 2, motion: 1 },
  },
  {
    id: "hologram-grid", name: "Hologram Grid", tagline: "Magenta geometry, off the shelf",
    description: "The Hologram Grid scene with a magenta accent, bold chrome, and RGB accent-sync. Futurist furniture, live.",
    category: "Gaming", mood: "energetic", mode: "dark", accent_hex: "#E879F9",
    gradient: ["#0D0318", "#2E1250"], sceneId: "hologram-grid", speed: 1.2, density: 1.1,
    taskbar: { size: "large", alignment: "left", color_match: true }, widgets: ["clock", "stats", "todo"], rgb: "accent-sync",
    tags: ["scene", "geometric", "gaming", "energetic"], quiz: { dark: 2, gaming: 3, energetic: 3, vivid: 2, motion: 3 },
  },
  {
    id: "pine-snow", name: "Pine Snow", tagline: "Green boughs, white drift",
    description: "The Pine Snow scene with a fresh-green accent and slim taskbar. Winter forest, kept tidy.",
    category: "Nature", mood: "calm", mode: "dark", accent_hex: "#4ADE80",
    gradient: ["#04120A", "#0E3B22"], sceneId: "pine-snow", speed: 0.6, density: 1.0,
    taskbar: { size: "small", alignment: "left" }, widgets: ["clock", "calendar"],
    tags: ["scene", "snow", "forest", "calm"], quiz: { nature: 3, calm: 3, dark: 2, motion: 1 },
  },
  {
    id: "cloud-veil", name: "Cloud Veil", tagline: "Grey layers, moving slow",
    description: "The Cloud Veil scene with a slate accent and slim taskbar. Weather you can keep on your wall.",
    category: "Minimal", mood: "calm", mode: "dark", accent_hex: "#94A3B8",
    gradient: ["#0B0F16", "#2A3440"], sceneId: "cloud-veil", speed: 0.5, density: 0.9,
    taskbar: { size: "small", alignment: "left" }, widgets: ["clock"],
    tags: ["scene", "clouds", "minimal", "calm"], quiz: { neutral: 3, minimal: 3, calm: 2, mono: 1, motion: 1 },
  },
  {
    id: "gold-dust", name: "Gold Dust", tagline: "Motes of gold, mid-air",
    description: "The Gold Dust scene with a warm-gold accent and centered taskbar. Sunlight, rendered as particles.",
    category: "Playful", mood: "playful", mode: "dark", accent_hex: "#FBBF24",
    gradient: ["#1A1204", "#4A2E0A"], sceneId: "gold-dust", speed: 0.8, density: 1.0,
    taskbar: { size: "medium", alignment: "center" }, widgets: ["clock", "calendar"],
    tags: ["scene", "particles", "playful", "warm"], quiz: { warm: 3, playful: 3, dark: 2, motion: 2 },
  },
  {
    id: "cosmic-dust", name: "Cosmic Dust", tagline: "Silver specks in deep indigo",
    description: "The Cosmic Dust scene with an indigo accent and translucent taskbar. A galaxy, reduced to motes.",
    category: "Space", mood: "calm", mode: "dark", accent_hex: "#818CF8",
    gradient: ["#06060F", "#1E1B3A"], sceneId: "cosmic-dust", speed: 0.5, density: 0.9,
    taskbar: { size: "medium", alignment: "center" }, widgets: ["clock", "stats"],
    tags: ["scene", "particles", "space", "calm"], quiz: { space: 3, dark: 2, calm: 3, motion: 1 },
  },
  {
    id: "rose-mist", name: "Rose Mist", tagline: "Pink fog, softly falling",
    description: "The Rose Mist scene with a blush accent and centered taskbar. Gentle color, no sharp edges.",
    category: "Playful", mood: "playful", mode: "dark", accent_hex: "#FDA4AF",
    gradient: ["#140810", "#3A1626"], sceneId: "rose-mist", speed: 0.6, density: 0.9,
    taskbar: { size: "medium", alignment: "center" }, widgets: ["clock", "calendar"],
    tags: ["scene", "particles", "playful", "soft"], quiz: { soft: 3, playful: 3, dark: 2, motion: 1 },
  },
  {
    id: "ember-wind", name: "Ember Wind", tagline: "Sparks on a gale",
    description: "The Ember Wind scene with an orange accent and bold left taskbar. Fire, unstayed.",
    category: "Energetic", mood: "energetic", mode: "dark", accent_hex: "#F97316",
    gradient: ["#160B05", "#3A1D08"], sceneId: "ember-wind", speed: 1.2, density: 1.1,
    taskbar: { size: "large", alignment: "left" }, widgets: ["clock", "todo"],
    tags: ["scene", "embers", "energetic", "warm"], quiz: { warm: 3, energetic: 3, dark: 2, motion: 3 },
  },
  {
    id: "forge-glow", name: "Forge Glow", tagline: "A hearth that never goes out",
    description: "The Forge Glow scene with a warm amber accent and centered taskbar. Fireplace energy, forever on.",
    category: "Cozy", mood: "cozy", mode: "dark", accent_hex: "#FB923C",
    gradient: ["#160B05", "#3A1D08"], sceneId: "forge-glow", speed: 0.6, density: 0.8,
    taskbar: { size: "medium", alignment: "center" }, widgets: ["clock", "note"],
    tags: ["scene", "embers", "cozy", "warm"], quiz: { warm: 3, cozy: 3, dark: 2, motion: 1 },
  },
  {
    id: "shooting-stars", name: "Shooting Stars", tagline: "Bright streaks, gone too soon",
    description: "The Shooting Stars scene with a sky-blue accent and bold taskbar. Fast, bright, and always moving.",
    category: "Space", mood: "energetic", mode: "dark", accent_hex: "#60A5FA",
    gradient: ["#050815", "#16264A"], sceneId: "shooting-stars", speed: 1.1, density: 1.2,
    taskbar: { size: "large", alignment: "left" }, widgets: ["clock", "stats"],
    tags: ["scene", "stars", "space", "energetic"], quiz: { space: 3, energetic: 3, dark: 2, motion: 3 },
  },
  {
    id: "polaris", name: "Polaris", tagline: "One steady star, and a few friends",
    description: "The Polaris scene with a pale-blue accent and slim taskbar. Fixed, calm, dependable.",
    category: "Space", mood: "calm", mode: "dark", accent_hex: "#93C5FD",
    gradient: ["#050A18", "#1E2A4A"], sceneId: "polaris", speed: 0.6, density: 1.0,
    taskbar: { size: "small", alignment: "left" }, widgets: ["clock"],
    tags: ["scene", "stars", "space", "calm"], quiz: { space: 3, calm: 3, cool: 2, motion: 1 },
  },
  // ---- S5: light-mode remixes of bright scenes (frost-fall pattern) ---------
  {
    id: "glacier-morning", name: "Glacier Morning", tagline: "Ice wind in bright daylight",
    description: "The Glacier Drift scene in crisp light mode with a frost-blue accent. Winter, without the dark.",
    category: "Seasonal", mood: "calm", mode: "light", accent_hex: "#38BDF8",
    gradient: ["#F2F9FE", "#C7E4F5"], sceneId: "glacier-drift", speed: 0.9, density: 1.2,
    taskbar: { size: "small", alignment: "left" }, widgets: ["clock"],
    tags: ["scene", "snow", "seasonal", "light"], quiz: { light: 3, cool: 3, calm: 2, motion: 2 },
  },
  {
    id: "cloud-morning", name: "Cloud Morning", tagline: "High ceilings, low clouds",
    description: "The Cloud Veil scene in light mode with a slate accent. Bright, airy, done early.",
    category: "Minimal", mood: "focused", mode: "light", accent_hex: "#64748B",
    gradient: ["#F8FAFC", "#E2E8F0"], sceneId: "cloud-veil", speed: 0.5, density: 0.9,
    taskbar: { size: "small", alignment: "left" }, widgets: ["clock"],
    tags: ["scene", "clouds", "minimal", "light"], quiz: { light: 3, neutral: 3, minimal: 3, focused: 2, motion: 1 },
  },
  {
    id: "snow-aurora", name: "Snow Aurora", tagline: "Lilac snow in the morning",
    description: "The Aurora Snow scene in light mode with a periwinkle accent. The same dream, brighter.",
    category: "Seasonal", mood: "playful", mode: "light", accent_hex: "#A78BFA",
    gradient: ["#F6F4FD", "#DDD3F5"], sceneId: "aurora-snow", speed: 0.8, density: 1.1,
    taskbar: { size: "medium", alignment: "center" }, widgets: ["clock", "calendar"],
    tags: ["scene", "snow", "seasonal", "light"], quiz: { light: 2, soft: 3, playful: 3, motion: 2 },
  },
];

export const SCENE_STYLES: StyleDef[] = SPECS.map((s) => ({
  id: s.id,
  name: s.name,
  tagline: s.tagline,
  description: s.description,
  category: s.category,
  mood: s.mood,
  mode: s.mode,
  accent_hex: s.accent_hex,
  gradient: s.gradient,
  wallpaper: { type: "scene", sceneId: s.sceneId },
  sceneTweak: { speed: s.speed, density: s.density },
  transparency: true,
  taskbar: s.taskbar,
  cursor: "aero",
  lock_screen: { mode: "spotlight" },
  rgb: s.rgb,
  widgets: s.widgets,
  tags: s.tags,
  quiz: s.quiz,
  tier: "scene",
}));

export const SCENE_BY_ID = new Map(SCENE_STYLES.map((s) => [s.id, s]));

/** The render kind of every scene — mirrors the engine's SceneConfig.kind.
 *  The scene-twin generator uses it for honest axis gates (a matrix scene can
 *  be a focus twin; an embers scene can be a hearth twin). */
export const SCENE_KINDS: Record<string, string> = {
  "aurora-drift": "aurora", "deep-tide": "waves", "moonlit-dunes": "particles", "misty-forest": "parallax",
  "neon-surge": "particles", "synth-grid": "geometric", "ember-storm": "embers", "retro-sunset": "geometric",
  "meadow-breeze": "particles", "coral-reef": "waves", "autumn-leaves": "parallax", "river-glow": "embers",
  "stardust": "stars", "nebula-bloom": "aurora", "orbital": "geometric", "comet-trail": "stars",
  "winter-snow": "particles", "spring-blossom": "parallax", "holiday-lights": "stars", "cherry-fall": "particles",
  "midnight-rain": "rain", "firefly-grove": "fireflies", "blizzard-drift": "snowfall-wind", "bokeh-aurora": "bokeh",
  "smoke-ember": "smoke", "ocean-depth": "waves-3d",
  "digital-rain": "matrix", "cipher-fall": "matrix", "amber-rain": "rain", "violet-rain": "rain",
  "ember-fireflies": "fireflies", "glacier-drift": "snowfall-wind", "aurora-snow": "snowfall-wind", "bokeh-city": "bokeh",
  "incense-smoke": "smoke", "crimson-tide": "waves-3d", "aurora-boreal": "aurora", "starlight-sea": "waves",
  "hologram-grid": "geometric", "pine-snow": "parallax", "cloud-veil": "parallax", "gold-dust": "particles",
  "cosmic-dust": "particles", "rose-mist": "particles", "ember-wind": "embers", "forge-glow": "embers",
  "shooting-stars": "stars", "polaris": "stars",
};

/** Every scene id the library can reference — also the engine contract.
 *  Must mirror builtin_scenes() in wallpaper_engine.rs and mock SCENES
 *  (scenes.test.ts + the on-disk gate check this set for coverage). */
export const KNOWN_SCENE_IDS = [
  "aurora-drift", "deep-tide", "moonlit-dunes", "misty-forest", "neon-surge",
  "synth-grid", "ember-storm", "retro-sunset", "meadow-breeze", "coral-reef",
  "autumn-leaves", "river-glow", "stardust", "nebula-bloom", "orbital",
  "comet-trail", "winter-snow", "spring-blossom", "holiday-lights", "cherry-fall",
  // A6.1 kinds
  "midnight-rain", "firefly-grove", "blizzard-drift", "bokeh-aurora", "smoke-ember", "ocean-depth",
  // S5 expansion (matrix + fresh color stories)
  "digital-rain", "cipher-fall", "amber-rain", "violet-rain", "ember-fireflies",
  "glacier-drift", "aurora-snow", "bokeh-city", "incense-smoke", "crimson-tide",
  "aurora-boreal", "starlight-sea", "hologram-grid", "pine-snow", "cloud-veil",
  "gold-dust", "cosmic-dust", "rose-mist", "ember-wind", "forge-glow",
  "shooting-stars", "polaris",
] as const;
