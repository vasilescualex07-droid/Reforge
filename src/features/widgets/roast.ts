// Idle Roast (spec §6). The idle-time hook (GetLastInputInfo via the stats
// stream) past a configurable threshold (default 10 min) pops a small mascot
// near a corner with a speech-bubble one-liner. Fires ONCE per idle period,
// resets when activity resumes. The lines are playful/teasing — affectionate
// mockery, never genuinely harsh. Light comedic sting.
import audioSrc from "./audio-gen.js?raw";
import { OVERLAY_AUDIO_BOOT, overlayShell, esc } from "./overlays";
import { subscribeStats } from "./stats";
import { ctx } from "./runtime-api";
import { cfg } from "./runtime-api";
import { ROAST_MINUTES } from "./constants";

// ---- named tunables (spec §8) ----

const ROAST_DISPLAY_MS = 6500;
const ROAST_FIRE_COOLDOWN_S = 45; // min gap between roasts

const ROAST_LINES = [
  "your mouse has been suspiciously still for a while…",
  "the screen won't judge you. I will, though.",
  "is that a deadline I smell, or just dust?",
  "optimization complete: you, perfectly idle.",
  "your tasks are holding a meeting. without you.",
  "I've counted 12 windows. you're in none of them.",
  "statistically, the work is not doing itself.",
  "somewhere, a to-do list just sighed.",
];

let firedThisIdle = false;
let lastRoastAt = 0;

export function roastHtml(line: string): string {
  const css = `
.wrap{position:fixed;bottom:8px;right:8px;display:flex;align-items:flex-end;gap:10px;}
.bubble{background:rgba(15,20,34,0.92);border:1px solid rgba(255,255,255,0.14);border-radius:12px;padding:12px 14px;max-width:250px;font-size:13px;line-height:1.45;color:#e2e8f0;position:relative;box-shadow:0 8px 24px rgba(0,0,0,0.35);animation:pop .25s ease-out;}
.bubble:after{content:"";position:absolute;bottom:12px;right:-8px;border:5px solid transparent;border-left-color:rgba(15,20,34,0.92);}
.mascot{width:64px;height:64px;background:rgba(15,20,34,0.92);border:1px solid rgba(255,255,255,0.14);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:30px;animation:bob 1.6s ease-in-out infinite;box-shadow:0 8px 24px rgba(0,0,0,0.35);}
@keyframes pop{from{transform:scale(0.8);opacity:0;}to{transform:scale(1);opacity:1;}}
@keyframes bob{0%,100%{transform:translateY(0);}50%{transform:translateY(-4px);}}
`;
  const body = `
<div class="wrap">
  <div class="bubble">${esc(line)}</div>
  <div class="mascot">🧦</div>
</div>
`;
  const script = `
${audioSrc}
(function(){
  var c = __audio.get();
  if (c) { var d = __audio.dest(0.6); if (d) RFAudio.comedy(c, d, { gain: 0.14 }); }
  setTimeout(function(){ __invoke("fun_close_overlay", { label: "fun-roast" }).catch(function(){}); }, ${ROAST_DISPLAY_MS});
})();
`;
  return overlayShell({ css, body, script, head: OVERLAY_AUDIO_BOOT });
}

export function startRoast(): () => void {
  firedThisIdle = false;
  const unsub = subscribeStats((s) => {
    const minutes = Number(cfg("roast", "minutes", ROAST_MINUTES)) || ROAST_MINUTES;
    const thresholdSecs = minutes * 60;
    const now = Date.now();
    if (s.idle_secs >= thresholdSecs) {
      if (!firedThisIdle && now - lastRoastAt >= ROAST_FIRE_COOLDOWN_S * 1000) {
        firedThisIdle = true;
        lastRoastAt = now;
        const line = ROAST_LINES[Math.floor(Math.random() * ROAST_LINES.length)];
        ctx
          .spawnOverlay("fun-roast", roastHtml(line), {
            corner: "bottom-right",
            w: 360,
            h: 110,
            transparent: true,
            clickable: false,
          })
          .then(() => ctx.bump("roasts"))
          .catch(() => {});
      }
    } else if (s.idle_secs < 60) {
      // activity resumed → this idle period is over
      firedThisIdle = false;
    }
  });
  return () => {
    unsub();
    firedThisIdle = false;
    void ctx.closeOverlay("fun-roast");
  };
}
