// Whip Cracker — Widget Hub entry (spec §4). The whip-chain physics, grab
// hit-zone, crack detection, impact VFX/SFX and motivational voice lines are
// ported VERBATIM from the standalone Whip Cracker project: `whip/whip-sim.js`
// is the unmodified simulation, `whip/whip-app.js` the re-wired app (close →
// fun_close_overlay, cracks → backend counters), `whip/whip-styles.css` the
// material. The only product change: it's one toggle in the hub instead of a
// separate desktop shortcut — enabled → the whip appears at its rest-pose
// anchor in a corner overlay; disabled → the window is torn down.
import simSrc from "./whip/whip-sim.js?raw";
import appSrc from "./whip/whip-app.js?raw";
import stylesCss from "./whip/whip-styles.css?raw";
import { ctx } from "./runtime-api";

export const WHIP_PROFILES = [
  { value: "bullwhip", label: "Classic Bullwhip" },
  { value: "snakewhip", label: "Snakewhip" },
  { value: "stockwhip", label: "Stockwhip" },
];

export const WHIP_THEMES = [
  { value: "midnight", label: "Midnight" },
  { value: "ember", label: "Ember" },
  { value: "frost", label: "Frost" },
  { value: "toxic", label: "Toxic" },
];

function whipHtml(profile: string, theme: string): string {
  const escProfile = profile.replace(/[^a-z]/gi, "");
  const escTheme = theme.replace(/[^a-z]/gi, "");
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
*{box-sizing:border-box;margin:0;padding:0;}
html,body{width:100%;height:100%;overflow:hidden;background:transparent;font-family:'Segoe UI',system-ui,sans-serif;}
canvas{position:fixed;inset:0;width:100%;height:100%;cursor:default;}
${stylesCss}
</style></head><body>
<canvas id="stage"></canvas>
<div id="pill" role="toolbar" aria-label="Whip Cracker controls">
  <div class="pill-title">
    <span class="pill-dot"></span>
    <span>Whip Cracker</span>
    <button id="pill-close" type="button" class="pill-close" aria-label="Close Whip Cracker" title="Close">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
    </button>
  </div>
  <div class="pill-row">
    <span class="pill-label">Cracks</span>
    <span id="crack-count" class="pill-value">0</span>
  </div>
  <div class="pill-row pill-row-select">
    <label class="pill-label" for="profile-select">Whip</label>
    <select id="profile-select" class="pill-select" title="Whip profile">
      <option value="bullwhip">Classic Bullwhip</option>
      <option value="snakewhip">Snakewhip</option>
      <option value="stockwhip">Stockwhip</option>
    </select>
  </div>
  <div class="pill-row pill-row-select">
    <label class="pill-label" for="theme-select">Theme</label>
    <select id="theme-select" class="pill-select" title="Material theme">
      <option value="midnight">Midnight</option>
      <option value="ember">Ember</option>
      <option value="frost">Frost</option>
      <option value="toxic">Toxic</option>
    </select>
  </div>
  <div class="pill-row pill-actions">
    <button id="sound-toggle" type="button" aria-pressed="false">Sound: On</button>
    <button id="clear-btn" type="button" aria-pressed="false" title="Clear session counter (F11)">Reset?</button>
  </div>
  <div id="pill-status" class="pill-status" role="status" aria-live="polite"></div>
  <div id="pill-session" class="pill-session"></div>
  <div id="pill-lifetime" class="pill-lifetime"></div>
  <div class="pill-hint">Grab the handle (or hold Space), then swing to crack</div>
</div>
<script>
"use strict";
var __invoke = (function(){
  if (typeof window.__TAURI_INTERNALS__ !== "undefined" && window.__TAURI_INTERNALS__.invoke) {
    return function(cmd, args){ return window.__TAURI_INTERNALS__.invoke(cmd, args||{}); };
  }
  return function(){ return Promise.reject(new Error("no backend")); };
})();
window.__WHIP_PROFILE = "${escProfile}";
window.__WHIP_THEME = "${escTheme}";
${simSrc}
${appSrc}
</script></body></html>`;
}

export function startWhip(): void {
  const c = ctx.config("whip");
  const profile = typeof c.profile === "string" ? c.profile : "bullwhip";
  const theme = typeof c.theme === "string" ? c.theme : "midnight";
  ctx
    .spawnOverlay("fun-whip", whipHtml(profile, theme), {
      corner: "bottom-right",
      w: 720,
      h: 600,
      transparent: true,
      clickable: true,
    })
    .catch(() => ctx.toast("Couldn't open the whip — try again.", "err"));
}

export function stopWhip(): void {
  void ctx.closeOverlay("fun-whip");
}
