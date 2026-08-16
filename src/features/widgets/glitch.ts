// Glitch Jumpscare (spec §6). Uses the screen-capture utility as the base
// texture, applies a brief (300-500ms) RGB channel-shift + scanline
// displacement + noise effect, then snaps back to the real screen. Manual by
// default; an OPT-IN random-frequency mode (off by default) lets the user
// choose surprise triggers — a screen glitching itself during a call is a
// genuinely bad time, so the default is manual-only.
import { call } from "../../lib/api";
import audioSrc from "./audio-gen.js?raw";
import { OVERLAY_AUDIO_BOOT, overlayShell } from "./overlays";
import { ctx } from "./runtime-api";
import { cfg } from "./runtime-api";

// ---- named tunables (spec §8) ----

const GLITCH_DURATION_MS = 420;
const GLITCH_RANDOM_MINUTES = 5; // baseline for the opt-in random mode

export function glitchHtml(captureB64: string): string {
  const css = `
#stage{position:fixed;inset:0;width:100%;height:100%;}
`;
  const body = `<canvas id="stage"></canvas>`;
  const script = `
${audioSrc}
(function(){
  var canvas = document.getElementById("stage");
  var g = canvas.getContext("2d");
  function resize(){
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  var img = new Image();
  img.onload = function(){ setup(); };
  img.onerror = function(){ __invoke("fun_close_overlay", { label: "fun-glitch" }).catch(function(){}); };
  img.src = "${captureB64}";

  function drawCover() {
    var scale = Math.max(canvas.width / img.width, canvas.height / img.height);
    var dw = img.width * scale, dh = img.height * scale;
    g.drawImage(img, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
  }

  function setup() {
    var c = __audio.get();
    if (c) { var d = __audio.dest(0.7); if (d) RFAudio.glitch(c, d, { gain: 0.16, dur: 0.3 }); }
    var t0 = performance.now();
    var last = t0;
    function loop(ts) {
      var dt = Math.min(0.05, (ts - last) / 1000);
      last = ts;
      var t = ts - t0;
      if (t > ${GLITCH_DURATION_MS}) {
        // snap back clean
        g.clearRect(0, 0, canvas.width, canvas.height);
        drawCover();
        __invoke("fun_close_overlay", { label: "fun-glitch" }).catch(function(){});
        return;
      }
      var intensity = 1 - Math.abs(t / ${GLITCH_DURATION_MS} - 0.5) * 2; // 0→1→0
      g.clearRect(0, 0, canvas.width, canvas.height);
      drawCover();
      // RGB channel shift: two offset tinted copies
      g.globalAlpha = 0.35 * intensity;
      g.globalCompositeOperation = "screen";
      g.save(); g.translate(-6 * intensity, 0); drawCover(); g.restore();
      g.save(); g.translate(6 * intensity, 0); drawCover(); g.restore();
      g.globalCompositeOperation = "source-over";
      g.globalAlpha = 1;
      // horizontal slice displacement: tear random strips
      var strips = 3 + ((Math.random() * 4) | 0);
      for (var i = 0; i < strips; i++) {
        var sy = Math.random() * canvas.height;
        var sh = 4 + Math.random() * 26 * intensity;
        var dx = (Math.random() - 0.5) * 90 * intensity;
        g.drawImage(canvas, 0, sy, canvas.width, sh, dx, sy, canvas.width, sh);
      }
      // scanlines
      g.fillStyle = "rgba(0,0,0,0.16)";
      for (var y = 0; y < canvas.height; y += 4) g.fillRect(0, y, canvas.width, 1);
      // static noise blocks
      for (var k = 0; k < 18 * intensity; k++) {
        g.fillStyle = "rgba(255,255,255," + (0.04 + Math.random() * 0.1) + ")";
        g.fillRect(Math.random() * canvas.width, Math.random() * canvas.height, 30 + Math.random() * 90, 2 + Math.random() * 10);
      }
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  }
})();
`;
  return overlayShell({ css, body, script, head: OVERLAY_AUDIO_BOOT });
}

export async function triggerGlitch(): Promise<void> {
  let capture: string;
  try {
    capture = await call<string>("fun_capture_screen");
  } catch {
    ctx.toast("Couldn't grab the screen to glitch — try again.", "err");
    return;
  }
  try {
    await ctx.spawnOverlay("fun-glitch", glitchHtml(capture), {
      fullscreen: true,
      transparent: true,
      clickable: false,
    });
    void ctx.bump("glitch_uses");
  } catch {
    ctx.toast("Couldn't glitch the screen — try again.", "err");
  }
}

// ---- opt-in random mode (off by default) -----------------------------------
let randomTimer: number | null = null;
let firedRecently = 0;

export function startGlitch(): () => void {
  // random mode is a config toggle; manual triggering stays hotkey/button
  const randomOn = cfg("glitch", "random_mode", false) === true;
  if (!randomOn) return () => {};
  const minutes = Number(cfg("glitch", "random_minutes", GLITCH_RANDOM_MINUTES)) || GLITCH_RANDOM_MINUTES;
  const schedule = () => {
    const jitter = (Math.random() - 0.5) * minutes * 0.6;
    const delayMs = Math.max(30000, (minutes + jitter) * 60 * 1000);
    randomTimer = window.setTimeout(() => {
      const now = Date.now();
      if (now - firedRecently > 60000) {
        firedRecently = now;
        void triggerGlitch();
      }
      schedule();
    }, delayMs);
  };
  schedule();
  return () => {
    if (randomTimer !== null) window.clearTimeout(randomTimer);
    randomTimer = null;
    void ctx.closeOverlay("fun-glitch");
  };
}
