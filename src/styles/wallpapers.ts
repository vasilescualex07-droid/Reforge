// Central wallpaper manifest (B22). Every wallpaper in the library lives here,
// and both the gallery and the Style Engine (variant styles) read from it.

export interface WallpaperEntry {
  id: string;
  name: string;
  file: string;
  category: string;
  tags: string[];
  dominantColor: string;
  type: "static" | "live";
}

const STATIC_WALLPAPERS: WallpaperEntry[] = [
  { id: "abstract-glass", name: "abstract glass", file: "/wallpapers/static/abstract-glass.jpg", category: "Abstract", tags: [], dominantColor: "#555555", type: "static" },
  { id: "abstract-light", name: "abstract light", file: "/wallpapers/static/abstract-light.jpg", category: "Abstract", tags: [], dominantColor: "#555555", type: "static" },
  { id: "abstract-marble", name: "abstract marble", file: "/wallpapers/static/abstract-marble.jpg", category: "Abstract", tags: [], dominantColor: "#555555", type: "static" },
  { id: "abstract-minimal", name: "abstract minimal", file: "/wallpapers/static/abstract-minimal.jpg", category: "Abstract", tags: [], dominantColor: "#555555", type: "static" },
  { id: "abstract-waves", name: "abstract waves", file: "/wallpapers/static/abstract-waves.jpg", category: "Abstract", tags: [], dominantColor: "#555555", type: "static" },
  { id: "alpine-ridge", name: "alpine ridge", file: "/wallpapers/static/alpine-ridge.jpg", category: "Nature", tags: [], dominantColor: "#555555", type: "static" },
  { id: "aurora-earth", name: "aurora earth", file: "/wallpapers/static/aurora-earth.jpg", category: "Space", tags: [], dominantColor: "#555555", type: "static" },
  { id: "autumn-leaves", name: "autumn leaves", file: "/wallpapers/static/autumn-leaves.jpg", category: "Seasonal", tags: [], dominantColor: "#555555", type: "static" },
  { id: "bamboo-forest", name: "bamboo forest", file: "/wallpapers/static/bamboo-forest.jpg", category: "Nature", tags: [], dominantColor: "#555555", type: "static" },
  { id: "bamboo-light", name: "bamboo light", file: "/wallpapers/static/bamboo-light.jpg", category: "Nature", tags: [], dominantColor: "#555555", type: "static" },
  { id: "beach-waves", name: "beach waves", file: "/wallpapers/static/beach-waves.jpg", category: "Nature", tags: [], dominantColor: "#555555", type: "static" },
  { id: "cherry-blossoms", name: "cherry blossoms", file: "/wallpapers/static/cherry-blossoms.jpg", category: "Seasonal", tags: [], dominantColor: "#555555", type: "static" },
  { id: "city-night", name: "city night", file: "/wallpapers/static/city-night.jpg", category: "Dark", tags: [], dominantColor: "#555555", type: "static" },
  { id: "color-wave", name: "color wave", file: "/wallpapers/static/color-wave.jpg", category: "Abstract", tags: [], dominantColor: "#555555", type: "static" },
  { id: "dark-clouds", name: "dark clouds", file: "/wallpapers/static/dark-clouds.jpg", category: "Dark", tags: [], dominantColor: "#555555", type: "static" },
  { id: "dark-mountain", name: "dark mountain", file: "/wallpapers/static/dark-mountain.jpg", category: "Dark", tags: [], dominantColor: "#555555", type: "static" },
  { id: "dark-mountains", name: "dark mountains", file: "/wallpapers/static/dark-mountains.jpg", category: "Dark", tags: [], dominantColor: "#555555", type: "static" },
  { id: "earth-from-space", name: "earth from space", file: "/wallpapers/static/earth-from-space.jpg", category: "Space", tags: [], dominantColor: "#555555", type: "static" },
  { id: "earth-night", name: "earth night", file: "/wallpapers/static/earth-night.jpg", category: "Space", tags: [], dominantColor: "#555555", type: "static" },
  { id: "foggy-valley", name: "foggy valley", file: "/wallpapers/static/foggy-valley.jpg", category: "Nature", tags: [], dominantColor: "#555555", type: "static" },
  { id: "forest-mist", name: "forest mist", file: "/wallpapers/static/forest-mist.jpg", category: "Nature", tags: [], dominantColor: "#555555", type: "static" },
  { id: "galaxy-swirl", name: "galaxy swirl", file: "/wallpapers/static/galaxy-swirl.jpg", category: "Space", tags: [], dominantColor: "#555555", type: "static" },
  { id: "golden-hour", name: "golden hour", file: "/wallpapers/static/golden-hour.jpg", category: "Seasonal", tags: [], dominantColor: "#555555", type: "static" },
  { id: "gradient-blue", name: "gradient blue", file: "/wallpapers/static/gradient-blue.jpg", category: "Abstract", tags: [], dominantColor: "#555555", type: "static" },
  { id: "gradient-neon", name: "gradient neon", file: "/wallpapers/static/gradient-neon.jpg", category: "Abstract", tags: [], dominantColor: "#555555", type: "static" },
  { id: "gradient-purple", name: "gradient purple", file: "/wallpapers/static/gradient-purple.jpg", category: "Abstract", tags: [], dominantColor: "#555555", type: "static" },
  { id: "gradient-smooth", name: "gradient smooth", file: "/wallpapers/static/gradient-smooth.jpg", category: "Abstract", tags: [], dominantColor: "#555555", type: "static" },
  { id: "gradient-warm", name: "gradient warm", file: "/wallpapers/static/gradient-warm.jpg", category: "Abstract", tags: [], dominantColor: "#555555", type: "static" },
  { id: "green-hills", name: "green hills", file: "/wallpapers/static/green-hills.jpg", category: "Nature", tags: [], dominantColor: "#555555", type: "static" },
  { id: "green-valley", name: "green valley", file: "/wallpapers/static/green-valley.jpg", category: "Nature", tags: [], dominantColor: "#555555", type: "static" },
  { id: "lake-reflection", name: "lake reflection", file: "/wallpapers/static/lake-reflection.jpg", category: "Nature", tags: [], dominantColor: "#555555", type: "static" },
  { id: "marble-dark", name: "marble dark", file: "/wallpapers/static/marble-dark.jpg", category: "Abstract", tags: [], dominantColor: "#555555", type: "static" },
  { id: "marble-white", name: "marble white", file: "/wallpapers/static/marble-white.jpg", category: "Abstract", tags: [], dominantColor: "#555555", type: "static" },
  { id: "misty-lake", name: "misty lake", file: "/wallpapers/static/misty-lake.jpg", category: "Nature", tags: [], dominantColor: "#555555", type: "static" },
  { id: "moon-craters", name: "moon craters", file: "/wallpapers/static/moon-craters.jpg", category: "Space", tags: [], dominantColor: "#555555", type: "static" },
  { id: "mountain-fog", name: "mountain fog", file: "/wallpapers/static/mountain-fog.jpg", category: "Nature", tags: [], dominantColor: "#555555", type: "static" },
  { id: "mountain-lake", name: "mountain lake", file: "/wallpapers/static/mountain-lake.jpg", category: "Nature", tags: [], dominantColor: "#555555", type: "static" },
  { id: "mountain-peaks", name: "mountain peaks", file: "/wallpapers/static/mountain-peaks.jpg", category: "Nature", tags: [], dominantColor: "#555555", type: "static" },
  { id: "nebula-deep", name: "nebula deep", file: "/wallpapers/static/nebula-deep.jpg", category: "Space", tags: [], dominantColor: "#555555", type: "static" },
  { id: "neon-city", name: "neon city", file: "/wallpapers/static/neon-city.jpg", category: "Abstract", tags: [], dominantColor: "#555555", type: "static" },
  { id: "neon-city2", name: "neon city2", file: "/wallpapers/static/neon-city2.jpg", category: "Abstract", tags: [], dominantColor: "#555555", type: "static" },
  { id: "neon-lines", name: "neon lines", file: "/wallpapers/static/neon-lines.jpg", category: "Abstract", tags: [], dominantColor: "#555555", type: "static" },
  { id: "ocean-waves", name: "ocean waves", file: "/wallpapers/static/ocean-waves.jpg", category: "Nature", tags: [], dominantColor: "#555555", type: "static" },
  { id: "orange-flowers", name: "orange flowers", file: "/wallpapers/static/orange-flowers.jpg", category: "Nature", tags: [], dominantColor: "#555555", type: "static" },
  { id: "pink-abstract", name: "pink abstract", file: "/wallpapers/static/pink-abstract.jpg", category: "Abstract", tags: [], dominantColor: "#555555", type: "static" },
  { id: "purple-nebula", name: "purple nebula", file: "/wallpapers/static/purple-nebula.jpg", category: "Space", tags: [], dominantColor: "#555555", type: "static" },
  { id: "red-abstract", name: "red abstract", file: "/wallpapers/static/red-abstract.jpg", category: "Abstract", tags: [], dominantColor: "#555555", type: "static" },
  { id: "skyline-dark", name: "skyline dark", file: "/wallpapers/static/skyline-dark.jpg", category: "Dark", tags: [], dominantColor: "#555555", type: "static" },
  { id: "snow-forest", name: "snow forest", file: "/wallpapers/static/snow-forest.jpg", category: "Seasonal", tags: [], dominantColor: "#555555", type: "static" },
  { id: "starfield", name: "starfield", file: "/wallpapers/static/starfield.jpg", category: "Space", tags: [], dominantColor: "#555555", type: "static" },
  { id: "starry-mountain", name: "starry mountain", file: "/wallpapers/static/starry-mountain.jpg", category: "Space", tags: [], dominantColor: "#555555", type: "static" },
  { id: "starry-sky", name: "starry sky", file: "/wallpapers/static/starry-sky.jpg", category: "Space", tags: [], dominantColor: "#555555", type: "static" },
  { id: "storm-clouds", name: "storm clouds", file: "/wallpapers/static/storm-clouds.jpg", category: "Nature", tags: [], dominantColor: "#555555", type: "static" },
  { id: "sunforest", name: "sunforest", file: "/wallpapers/static/sunforest.jpg", category: "Nature", tags: [], dominantColor: "#555555", type: "static" },
  { id: "sunlit-forest", name: "sunlit forest", file: "/wallpapers/static/sunlit-forest.jpg", category: "Nature", tags: [], dominantColor: "#555555", type: "static" },
  { id: "sunrise-person", name: "sunrise person", file: "/wallpapers/static/sunrise-person.jpg", category: "Seasonal", tags: [], dominantColor: "#555555", type: "static" },
  { id: "sunset-golden", name: "sunset golden", file: "/wallpapers/static/sunset-golden.jpg", category: "Nature", tags: [], dominantColor: "#555555", type: "static" },
  { id: "tropical-beach", name: "tropical beach", file: "/wallpapers/static/tropical-beach.jpg", category: "Nature", tags: [], dominantColor: "#555555", type: "static" },
  { id: "waterfall-bridge", name: "waterfall bridge", file: "/wallpapers/static/waterfall-bridge.jpg", category: "Nature", tags: [], dominantColor: "#555555", type: "static" },
  { id: "waterfall", name: "waterfall", file: "/wallpapers/static/waterfall.jpg", category: "Nature", tags: [], dominantColor: "#555555", type: "static" },
];

const LIVE_WALLPAPERS: WallpaperEntry[] = [
  { id: "abstract-gradient", name: "abstract gradient", file: "/wallpapers/live/abstract-gradient.mp4", category: "Abstract", tags: [], dominantColor: "#555555", type: "live" },
  { id: "abstract-lines", name: "abstract lines", file: "/wallpapers/live/abstract-lines.mp4", category: "Abstract", tags: [], dominantColor: "#555555", type: "live" },
  { id: "abstract-loop", name: "abstract loop", file: "/wallpapers/live/abstract-loop.mp4", category: "Abstract", tags: [], dominantColor: "#555555", type: "live" },
  { id: "abstract-mesh", name: "abstract mesh", file: "/wallpapers/live/abstract-mesh.mp4", category: "Abstract", tags: [], dominantColor: "#555555", type: "live" },
  { id: "abstract-particles", name: "abstract particles", file: "/wallpapers/live/abstract-particles.mp4", category: "Minimal", tags: [], dominantColor: "#555555", type: "live" },
  { id: "abstract-shapes", name: "abstract shapes", file: "/wallpapers/live/abstract-shapes.mp4", category: "Abstract", tags: [], dominantColor: "#555555", type: "live" },
  { id: "abstract-waves", name: "abstract waves", file: "/wallpapers/live/abstract-waves.mp4", category: "Abstract", tags: [], dominantColor: "#555555", type: "live" },
  { id: "amber-ember", name: "amber ember", file: "/wallpapers/live/amber-ember.mp4", category: "Warm", tags: [], dominantColor: "#555555", type: "live" },
  { id: "blue-aurora", name: "blue aurora", file: "/wallpapers/live/blue-aurora.mp4", category: "Cool", tags: [], dominantColor: "#555555", type: "live" },
  { id: "blue-particles", name: "blue particles", file: "/wallpapers/live/blue-particles.mp4", category: "Minimal", tags: [], dominantColor: "#555555", type: "live" },
  { id: "color-burst", name: "color burst", file: "/wallpapers/live/color-burst.mp4", category: "Abstract", tags: [], dominantColor: "#555555", type: "live" },
  { id: "color-drip", name: "color drip", file: "/wallpapers/live/color-drip.mp4", category: "Abstract", tags: [], dominantColor: "#555555", type: "live" },
  { id: "color-explosion", name: "color explosion", file: "/wallpapers/live/color-explosion.mp4", category: "Abstract", tags: [], dominantColor: "#555555", type: "live" },
  { id: "color-waves", name: "color waves", file: "/wallpapers/live/color-waves.mp4", category: "Abstract", tags: [], dominantColor: "#555555", type: "live" },
  { id: "colorful-smoke", name: "colorful smoke", file: "/wallpapers/live/colorful-smoke.mp4", category: "Dark", tags: [], dominantColor: "#555555", type: "live" },
  { id: "colorful-smoke2", name: "colorful smoke2", file: "/wallpapers/live/colorful-smoke2.mp4", category: "Dark", tags: [], dominantColor: "#555555", type: "live" },
  { id: "copper-glow", name: "copper glow", file: "/wallpapers/live/copper-glow.mp4", category: "Warm", tags: [], dominantColor: "#555555", type: "live" },
  { id: "coral-flow", name: "coral flow", file: "/wallpapers/live/coral-flow.mp4", category: "Warm", tags: [], dominantColor: "#555555", type: "live" },
  { id: "crystal-light", name: "crystal light", file: "/wallpapers/live/crystal-light.mp4", category: "Minimal", tags: [], dominantColor: "#555555", type: "live" },
  { id: "cyan-flow", name: "cyan flow", file: "/wallpapers/live/cyan-flow.mp4", category: "Cool", tags: [], dominantColor: "#555555", type: "live" },
  { id: "digital-flow", name: "digital flow", file: "/wallpapers/live/digital-flow.mp4", category: "Abstract", tags: [], dominantColor: "#555555", type: "live" },
  { id: "digital-rain", name: "digital rain", file: "/wallpapers/live/digital-rain.mp4", category: "Abstract", tags: [], dominantColor: "#555555", type: "live" },
  { id: "emerald-depth", name: "emerald depth", file: "/wallpapers/live/emerald-depth.mp4", category: "Nature", tags: [], dominantColor: "#555555", type: "live" },
  { id: "fluid-color", name: "fluid color", file: "/wallpapers/live/fluid-color.mp4", category: "Dark", tags: [], dominantColor: "#555555", type: "live" },
  { id: "geometric", name: "geometric", file: "/wallpapers/live/geometric.mp4", category: "Abstract", tags: [], dominantColor: "#555555", type: "live" },
  { id: "gold-particles", name: "gold particles", file: "/wallpapers/live/gold-particles.mp4", category: "Minimal", tags: [], dominantColor: "#555555", type: "live" },
  { id: "golden-dust", name: "golden dust", file: "/wallpapers/live/golden-dust.mp4", category: "Minimal", tags: [], dominantColor: "#555555", type: "live" },
  { id: "green-plasma", name: "green plasma", file: "/wallpapers/live/green-plasma.mp4", category: "Nature", tags: [], dominantColor: "#555555", type: "live" },
  { id: "ink-drop", name: "ink drop", file: "/wallpapers/live/ink-drop.mp4", category: "Dark", tags: [], dominantColor: "#555555", type: "live" },
  { id: "ink-swirl", name: "ink swirl", file: "/wallpapers/live/ink-swirl.mp4", category: "Dark", tags: [], dominantColor: "#555555", type: "live" },
  { id: "ivory-mist", name: "ivory mist", file: "/wallpapers/live/ivory-mist.mp4", category: "Abstract", tags: [], dominantColor: "#555555", type: "live" },
  { id: "jade-swirl", name: "jade swirl", file: "/wallpapers/live/jade-swirl.mp4", category: "Nature", tags: [], dominantColor: "#555555", type: "live" },
  { id: "light-bokeh", name: "light bokeh", file: "/wallpapers/live/light-bokeh.mp4", category: "Minimal", tags: [], dominantColor: "#555555", type: "live" },
  { id: "light-particles", name: "light particles", file: "/wallpapers/live/light-particles.mp4", category: "Minimal", tags: [], dominantColor: "#555555", type: "live" },
  { id: "light-rays", name: "light rays", file: "/wallpapers/live/light-rays.mp4", category: "Minimal", tags: [], dominantColor: "#555555", type: "live" },
  { id: "liquid-color", name: "liquid color", file: "/wallpapers/live/liquid-color.mp4", category: "Dark", tags: [], dominantColor: "#555555", type: "live" },
  { id: "magenta-pulse", name: "magenta pulse", file: "/wallpapers/live/magenta-pulse.mp4", category: "Vibrant", tags: [], dominantColor: "#555555", type: "live" },
  { id: "neon-grid", name: "neon grid", file: "/wallpapers/live/neon-grid.mp4", category: "Vibrant", tags: [], dominantColor: "#555555", type: "live" },
  { id: "neon-light", name: "neon light", file: "/wallpapers/live/neon-light.mp4", category: "Minimal", tags: [], dominantColor: "#555555", type: "live" },
  { id: "neon-rings", name: "neon rings", file: "/wallpapers/live/neon-rings.mp4", category: "Vibrant", tags: [], dominantColor: "#555555", type: "live" },
  { id: "neon-tunnel", name: "neon tunnel", file: "/wallpapers/live/neon-tunnel.mp4", category: "Vibrant", tags: [], dominantColor: "#555555", type: "live" },
  { id: "obsidian-wave", name: "obsidian wave", file: "/wallpapers/live/obsidian-wave.mp4", category: "Abstract", tags: [], dominantColor: "#555555", type: "live" },
  { id: "orange-glow", name: "orange glow", file: "/wallpapers/live/orange-glow.mp4", category: "Warm", tags: [], dominantColor: "#555555", type: "live" },
  { id: "pink-rain", name: "pink rain", file: "/wallpapers/live/pink-rain.mp4", category: "Dark", tags: [], dominantColor: "#555555", type: "live" },
  { id: "plasma-flow", name: "plasma flow", file: "/wallpapers/live/plasma-flow.mp4", category: "Nature", tags: [], dominantColor: "#555555", type: "live" },
  { id: "purple-nebula", name: "purple nebula", file: "/wallpapers/live/purple-nebula.mp4", category: "Vibrant", tags: [], dominantColor: "#555555", type: "live" },
  { id: "purple-smoke", name: "purple smoke", file: "/wallpapers/live/purple-smoke.mp4", category: "Dark", tags: [], dominantColor: "#555555", type: "live" },
  { id: "red-plasma", name: "red plasma", file: "/wallpapers/live/red-plasma.mp4", category: "Nature", tags: [], dominantColor: "#555555", type: "live" },
  { id: "sapphire-drift", name: "sapphire drift", file: "/wallpapers/live/sapphire-drift.mp4", category: "Cool", tags: [], dominantColor: "#555555", type: "live" },
  { id: "silver-sparkle", name: "silver sparkle", file: "/wallpapers/live/silver-sparkle.mp4", category: "Abstract", tags: [], dominantColor: "#555555", type: "live" },
  { id: "smoke-colors", name: "smoke colors", file: "/wallpapers/live/smoke-colors.mp4", category: "Dark", tags: [], dominantColor: "#555555", type: "live" },
  { id: "smoke-dark", name: "smoke dark", file: "/wallpapers/live/smoke-dark.mp4", category: "Dark", tags: [], dominantColor: "#555555", type: "live" },
  { id: "smoke-light", name: "smoke light", file: "/wallpapers/live/smoke-light.mp4", category: "Dark", tags: [], dominantColor: "#555555", type: "live" },
  { id: "smoke-wisps", name: "smoke wisps", file: "/wallpapers/live/smoke-wisps.mp4", category: "Dark", tags: [], dominantColor: "#555555", type: "live" },
  { id: "teal-wave", name: "teal wave", file: "/wallpapers/live/teal-wave.mp4", category: "Cool", tags: [], dominantColor: "#555555", type: "live" },
  { id: "violet-bloom", name: "violet bloom", file: "/wallpapers/live/violet-bloom.mp4", category: "Vibrant", tags: [], dominantColor: "#555555", type: "live" },
  { id: "water-ripple", name: "water ripple", file: "/wallpapers/live/water-ripple.mp4", category: "Abstract", tags: [], dominantColor: "#555555", type: "live" },
  { id: "yellow-energy", name: "yellow energy", file: "/wallpapers/live/yellow-energy.mp4", category: "Abstract", tags: [], dominantColor: "#555555", type: "live" },
];

// Derive a plausible dominant color from the wallpaper id/category so every
// entry gets a real placeholder hue (C1.12) and the variant engine gets a
// per-wallpaper accent (C1.3) without image analysis.
const NAME_HUES: Record<string, string> = {
  blue: "#3B82C4", cyan: "#22B8CF", teal: "#12B5A5", turquoise: "#0FB5AE",
  green: "#34A853", emerald: "#2E9E5B", jade: "#1F9E7E", bamboo: "#74A57F",
  red: "#D64545", orange: "#E8590C", coral: "#FF6B57", copper: "#B87333", amber: "#E0A23C", gold: "#D4A017",
  pink: "#E64980", magenta: "#D6336C", violet: "#9B6CF0", purple: "#7B2FF7", lavender: "#B197FC",
  indigo: "#5B7CFA", slate: "#64748B", silver: "#A8B0B8", ivory: "#E9E2D0", marble: "#D8D5CE",
  ink: "#1C1C24", dark: "#232323", night: "#0F172A", black: "#111111", smoke: "#5A5A66",
  white: "#F1F3F5", light: "#E9ECEF", snow: "#EFF6FB", paper: "#FAFAFA",
  aurora: "#6D7CFF", nebula: "#8B5CF6", galaxy: "#5E5BE0", star: "#3E63DD", moon: "#9BA3B5",
  ocean: "#0C8599", water: "#0EA5E9", lake: "#1D6FB8", wave: "#0FB5AE", beach: "#2AB7CA",
  mountain: "#5C7A6E", valley: "#6B8E4E", hills: "#7FA650", mist: "#8AA0AD", fog: "#7E93A0",
  city: "#3A4A6B", skyline: "#475569", neon: "#22D3EE", grid: "#7C3AED", storm: "#55657A", cloud: "#B9C2CC",
  golden: "#D9822B", blossom: "#F2A9C4", flower: "#EF7FA0", autumn: "#C2571B",
  plasma: "#82C91E", liquid: "#6D28D9", fluid: "#7C6CF0", drip: "#38BDF8", burst: "#F472B6",
  rainbow: "#EF4444", explosion: "#F97316", abstract: "#7C6CF0", geometric: "#4A6CF7",
  particles: "#60A5FA", sparkle: "#F5E6A3", dust: "#E0C268", rays: "#F0D060", bokeh: "#F0A03C",
  waterfall: "#4FA8C9", bridge: "#6E8B8B", sunset: "#E4572E", person: "#E8B04B", sunrise: "#F0A03C",
};
const CATEGORY_HUE: Record<string, string> = {
  Abstract: "#7C6CF0", Dark: "#3A4A6B", Nature: "#2D6A4F", Seasonal: "#C2571B",
  Space: "#5E5BE0", Minimal: "#94A3B8", Vibrant: "#D6336C", Warm: "#E8590C", Cool: "#0C8599",
};
export function domColor(id: string, category: string): string {
  const words = id.split(/[-_\s]/);
  for (const w of words) if (NAME_HUES[w]) return NAME_HUES[w];
  const multi = words.join("");
  for (const [k, v] of Object.entries(NAME_HUES)) if (multi.includes(k)) return v;
  return CATEGORY_HUE[category] ?? "#555555";
}

// The static and live bundles share some filenames (abstract-waves, purple-nebula),
// so dedupe ids to keep keys and generated style ids unique.
export const ALL_WALLPAPERS: WallpaperEntry[] = (() => {
  const seen = new Set<string>();
  const out: WallpaperEntry[] = [];
  for (const w of [...STATIC_WALLPAPERS, ...LIVE_WALLPAPERS]) {
    let id = w.id;
    if (seen.has(id)) id = `${id}-${w.type === "live" ? "live" : "static"}`;
    seen.add(id);
    out.push({ ...w, id, dominantColor: domColor(id, w.category) });
  }
  return out;
})();
export const WALLPAPER_COUNT = { static: STATIC_WALLPAPERS.length, live: LIVE_WALLPAPERS.length, total: ALL_WALLPAPERS.length };

export const CATEGORIES = ["All", ...new Set(ALL_WALLPAPERS.map((w) => w.category))];

export function getWallpaper(id: string): WallpaperEntry | undefined {
  return ALL_WALLPAPERS.find((w) => w.id === id);
}

export function niceName(id: string): string {
  return id.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Heuristics the variant engine uses to turn any wallpaper into a full style.
export const CATEGORY_ACCENT: Record<string, string> = {
  Abstract: "#7C6CF0",
  Dark: "#3B5BDB",
  Nature: "#2E9E5B",
  Seasonal: "#D9822B",
  Space: "#5B5BD6",
  Minimal: "#4A5568",
  Vibrant: "#D6336C",
  Warm: "#E8590C",
  Cool: "#0C8599",
};

export const CATEGORY_MODE: Record<string, "dark" | "light"> = {
  Abstract: "dark",
  Dark: "dark",
  Nature: "dark",
  Seasonal: "dark",
  Space: "dark",
  Minimal: "light",
  Vibrant: "dark",
  Warm: "dark",
  Cool: "dark",
};

export const CATEGORY_ENERGY: Record<string, number> = {
  Abstract: 0.7,
  Dark: 0.4,
  Nature: 0.3,
  Seasonal: 0.5,
  Space: 0.4,
  Minimal: 0.2,
  Vibrant: 0.9,
  Warm: 0.7,
  Cool: 0.5,
};

export const CATEGORY_TAG: Record<string, string> = {
  Abstract: "abstract",
  Dark: "city",
  Nature: "nature",
  Seasonal: "cozy",
  Space: "space",
  Minimal: "minimal",
  Vibrant: "gaming",
  Warm: "cozy",
  Cool: "minimal",
};
