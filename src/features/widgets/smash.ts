// Keyboard Smash Detector (spec §6). Measures the RATE of keydowns inside
// Reforge's own focused window (window keydowns only fire while focused — no
// system-wide hook, no antivirus/trust baggage). IMPORTANT CONSTRAINT: only
// timing/frequency is ever measured — `e.key`/`e.code` are never read,
// stored, or transmitted. This is not a keylogger, by construction. A small
// popup near the cursor asks "whoa there, you good?" with a light sting.
import { sfxComedy, withThrottle } from "./audio";
import { ctx } from "./runtime-api";
import { cfg } from "./runtime-api";
import { SMASH_RATE_THRESHOLD } from "./constants";

// ---- named tunables (spec §8) ----
export const SMASH_RATE_WINDOW_MS = 2000; // counting window

export const SMASH_COOLDOWN_MS = 8000; // min gap between popups

const POPUP_MS = 3800;

let popupEl: HTMLDivElement | null = null;

function removePopup(): void {
  if (popupEl && popupEl.parentNode) popupEl.parentNode.removeChild(popupEl);
  popupEl = null;
}

function showPopup(x: number, y: number): void {
  removePopup();
  const el = document.createElement("div");
  // monochrome-first, consistent with the app's visual language
  el.style.cssText =
    "position:fixed;z-index:9999;left:0;top:0;transform:translate(" +
    Math.min(x + 14, (window.innerWidth || 0) - 240) +
    "px," +
    Math.min(y + 14, (window.innerHeight || 0) - 70) +
    "px);background:var(--surface-raised,#111827);border:1px solid var(--border-default,rgba(255,255,255,0.14));border-radius:10px;padding:10px 14px;font-size:13px;color:var(--text-primary,#e2e8f0);box-shadow:0 8px 24px rgba(0,0,0,0.4);display:flex;align-items:center;gap:10px;max-width:240px;animation:rfPop .18s ease-out;";
  const style = document.createElement("style");
  style.textContent =
    "@keyframes rfPop{from{transform:translateY(6px);opacity:0;}to{transform:translateY(0);opacity:1;}}";
  document.head.appendChild(style);
  el.innerHTML = `<span style="font-size:22px;">😬</span><span>whoa there, you good? that keyboard has a family.</span>`;
  document.body.appendChild(el);
  popupEl = el;
  setTimeout(removePopup, POPUP_MS);
}

let taps: number[] = [];
let onKeyDown: ((e: KeyboardEvent) => void) | null = null;
// keyboard events carry no cursor position — track the last mouse position so
// the popup appears near where the user actually is
let mouseX = 0;
let mouseY = 0;
let onMouseMove: ((e: MouseEvent) => void) | null = null;

export function startSmash(): () => void {
  taps = [];
  mouseX = window.innerWidth / 2;
  mouseY = window.innerHeight / 2;
  onKeyDown = (e) => {
    // repeat keys are the OS auto-repeat, not a smash — skip them. We never
    // read which key was pressed (only that SOME key went down).
    if (e.repeat) return;
    const now = Date.now();
    taps.push(now);
    while (taps.length && now - taps[0] > SMASH_RATE_WINDOW_MS) taps.shift();
    if (taps.length >= SMASH_RATE_THRESHOLD) {
      const cooldown = Number(cfg("smash", "cooldown", SMASH_COOLDOWN_MS)) || SMASH_COOLDOWN_MS;
      withThrottle("smash", cooldown, () => {
        const rate = Number(cfg("smash", "rate", SMASH_RATE_THRESHOLD)) || SMASH_RATE_THRESHOLD;
        if (taps.length >= rate) {
          taps = [];
          showPopup(mouseX, mouseY);
          void ctx.bump("smash_hits");
          sfxComedy({ gain: 0.14 });
        }
      });
    }
  };
  onMouseMove = (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
  };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("mousemove", onMouseMove);
  return () => {
    if (onKeyDown) window.removeEventListener("keydown", onKeyDown);
    if (onMouseMove) window.removeEventListener("mousemove", onMouseMove);
    onKeyDown = null;
    onMouseMove = null;
    taps = [];
    removePopup();
  };
}
