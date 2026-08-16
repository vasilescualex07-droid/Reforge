// Shared widget constants (S7.8). These defaults live here so the registry
// can reference them WITHOUT importing the effect modules — each effect module
// is dynamic-imported only when its widget is first triggered/started, keeping
// the shell bundle small.

export const BSOD_DEFAULT_HOTKEY = "ctrl+shift+8";
export const BOSS_DEFAULT_HOTKEY = "ctrl+alt+b";
export const CONFETTI_DEFAULT_HOTKEY = "ctrl+shift+0";
export const RAGE_DEFAULT_HOTKEY = "ctrl+shift+9";
export const GLITCH_DEFAULT_HOTKEY = "ctrl+shift+7";

export const FIRE_THRESHOLD = 85; // percent — sustained above this
export const FIRE_DURATION_S = 5; // sustained for this long

export const ROAST_MINUTES = 10; // idle threshold

export const SMASH_RATE_THRESHOLD = 14; // keydowns within the window
