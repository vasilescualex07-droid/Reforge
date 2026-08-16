// Overlay client + shared HTML shell (spec §3 OVERLAY WINDOW MANAGER).
//
// The Rust backend owns the actual window (geometry from the primary monitor,
// always-on-top, transparent vs solid, click-through). The frontend owns the
// content: every overlay widget builds its HTML here (via `overlayShell`) and
// hands it to `spawnOverlay` — Rust writes it to disk and opens the window.
// Closing is a real window teardown, which is what makes "toggle off" a true
// stop of listeners/timers (resource hygiene §7).
import { call } from "../../lib/api";
import type { OverlayOpts } from "./types";

export function spawnOverlay(label: string, html: string, opts: OverlayOpts): Promise<void> {
  return call("fun_spawn_overlay", { label, html, opts }).then(() => undefined);
}

export function closeOverlay(label: string): Promise<void> {
  return call("fun_close_overlay", { label }).then(() => undefined);
}

/** Escape for HTML text/attribute context — config values flow into overlay
 *  HTML (certificate name, hotkey labels…), so nothing may break out. */
export function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The shared shell every overlay pays off in: monochrome-first chrome,
 * reduced-motion respect, and a small bridge for invoking Rust commands
 * (overlays are separate webviews; `window.__TAURI_INTERNALS__` is injected
 * into every Tauri webview). `body` and `script` are trusted app code.
 */
export function overlayShell(opts: {
  css: string;
  body: string;
  script: string;
  /** solid background for non-transparent payoffs (BSOD, boss cover, cert) */
  bg?: string;
  /** extra head content (e.g. preloads); wrapped in its own <script> so raw
   *  JS strings (OVERLAY_AUDIO_BOOT) actually execute — a bare string in
   *  <head> is inert text to the parser */
  head?: string;
}): string {
  const { css, body, script, bg, head } = opts;
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
*{box-sizing:border-box;margin:0;padding:0;font-family:Segoe UI,system-ui,-apple-system,sans-serif;}
html,body{width:100%;height:100%;overflow:hidden;${bg ? `background:${bg};` : "background:transparent;"}}
body{color:#e2e8f0;user-select:none;-webkit-user-select:none;}
${css}
@media (prefers-reduced-motion: reduce){*{animation:none!important;transition:none!important;}}
</style>
${head ? `<script>\n${head}\n</script>` : ""}
</head><body>
${body}
<script>
"use strict";
var __invoke = (function(){
  if (typeof window.__TAURI_INTERNALS__ !== "undefined" && window.__TAURI_INTERNALS__.invoke) {
    return function(cmd, args){ return window.__TAURI_INTERNALS__.invoke(cmd, args||{}); };
  }
  return function(){ return Promise.reject(new Error("no backend")); };
})();
var __now = function(){ return performance.now(); };
${script}
</script>
</body></html>`;
}

/** Overlay-side audio bootstrap: create + unlock an AudioContext. */
export const OVERLAY_AUDIO_BOOT = `
var __audio = (function(){
  var ctx = null;
  var AC = window.AudioContext || window.webkitAudioContext;
  function get(){
    if (!ctx && AC) { try { ctx = new AC(); } catch(e){ ctx = null; } }
    if (ctx && ctx.state === "suspended") { try { ctx.resume(); } catch(e){} }
    return ctx;
  }
  function dest(vol){
    var c = get(); if (!c) return null;
    var g = c.createGain();
    g.gain.value = vol || 0.8;
    g.connect(c.destination);
    return g;
  }
  function unlock(){ get(); }
  return { get: get, dest: dest, unlock: unlock };
})();
window.addEventListener("pointerdown", function(){ __audio.unlock(); });
window.addEventListener("keydown", function(){ __audio.unlock(); });
`;
