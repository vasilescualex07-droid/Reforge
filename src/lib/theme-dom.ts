// Applies an accent hex + mode to the DOM theme tokens. Shared by the boot
// OS-follow path (App.tsx) and Theme Studio's manual apply (Makeover.tsx) so
// the manual toggle applies instantly in both preview and Tauri, and the
// OS poll (which re-reads the registry, now reflecting the user's choice)
// stays consistent.

export function applyThemeToDom(accentHex: string, mode: "dark" | "light"): void {
  const root = document.documentElement;
  const hex = /^#[0-9a-fA-F]{6}$/.test(accentHex) ? accentHex : "#0067c0";
  root.style.setProperty("--accent-hex", hex);
  const n = parseInt(hex.slice(1), 16);
  root.style.setProperty("--accent", `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`);
  root.dataset.theme = mode;
  root.style.colorScheme = mode;
}

/** Dispatched by Theme Studio after a successful manual theme apply. */
export const THEME_CHANGED_EVENT = "reforge:theme-changed";

export function announceThemeChanged(accent_hex: string, mode: "dark" | "light"): void {
  window.dispatchEvent(new CustomEvent(THEME_CHANGED_EVENT, { detail: { accent_hex, mode } }));
}
