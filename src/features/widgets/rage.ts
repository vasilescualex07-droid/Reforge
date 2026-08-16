// Rage Shatter (spec §5). Captures what's ACTUALLY on screen (fun_capture_screen
// → GDI BitBlt → base64 PNG), fractures that captured image into Voronoi-style
// cells (jittered grid of real pixel crops), and drops the shards with the
// shared particle engine: gravity, slight rotation, falls/fades off screen.
// ~1.5s total, then the overlay closes and the real desktop is underneath
// (nothing was ever touched — only a screenshot was manipulated).
import { call } from "../../lib/api";
import audioSrc from "./audio-gen.js?raw";
import particlesSrc from "./particles-engine.js?raw";
import { OVERLAY_AUDIO_BOOT, overlayShell } from "./overlays";
import { ctx } from "./runtime-api";

// ---- named tunables (spec §8) ----

const RAGE_COLS = 6; // fracture grid
const RAGE_ROWS = 4;
const RAGE_JITTER_PX = 18; // cell-boundary jitter → organic cracks
const RAGE_DURATION_MS = 1500;
const RAGE_SHATTER_POWER = 0.5;

export function rageHtml(captureB64: string): string {
  const css = `
#stage{position:fixed;inset:0;width:100%;height:100%;}
`;
  const body = `<canvas id="stage"></canvas>`;
  const script = `
${audioSrc}
${particlesSrc}
(function(){
  var canvas = document.getElementById("stage");
  var img = new Image();
  img.onload = function(){ setup(); };
  img.onerror = function(){ __invoke("fun_close_overlay", { label: "fun-rage" }).catch(function(){}); };
  img.src = "${captureB64}";

  function setup() {
    var back = document.createElement("canvas");
    back.width = window.innerWidth;
    back.height = window.innerHeight;
    var bctx = back.getContext("2d");
    var scale = Math.max(back.width / img.width, back.height / img.height);
    var dw = img.width * scale, dh = img.height * scale;
    bctx.drawImage(img, (back.width - dw) / 2, (back.height - dh) / 2, dw, dh);

    var eng = RFParticles.createEngine(canvas, { gravity: 760, drag: 0.30 });
    var cols = ${RAGE_COLS}, rows = ${RAGE_ROWS};
    var cw = back.width / cols, ch = back.height / rows;
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var jx = (Math.random() - 0.5) * ${RAGE_JITTER_PX};
        var jy = (Math.random() - 0.5) * ${RAGE_JITTER_PX};
        var sw = cw + (Math.random() - 0.5) * 16;
        var sh = ch + (Math.random() - 0.5) * 16;
        var sx = Math.max(0, c * cw + jx);
        var sy = Math.max(0, r * ch + jy);
        var swc = Math.min(back.width - sx, sw);
        var shc = Math.min(back.height - sy, sh);
        if (swc < 4 || shc < 4) continue;
        var spr = document.createElement("canvas");
        spr.width = Math.round(swc);
        spr.height = Math.round(shc);
        spr.getContext("2d").drawImage(back, sx, sy, swc, shc, 0, 0, swc, shc);
        eng.spawn({
          x: sx + swc / 2 + (Math.random() - 0.5) * 14,
          y: sy + shc / 2 + (Math.random() - 0.5) * 14,
          vx: (Math.random() - 0.5) * 70,
          vy: (Math.random() - 0.5) * 30,
          rot: (Math.random() - 0.5) * 0.14,
          vrot: (Math.random() - 0.5) * 2.6,
          size: Math.max(swc, shc) / 2,
          shape: "sprite",
          img: spr,
          alpha: 1,
          life: 1.35 + Math.random() * 0.35,
          maxLife: 1.7,
        });
      }
    }
    // glass shatter SFX synced to fracture start
    var c = __audio.get();
    if (c) {
      var d = __audio.dest(0.8);
      if (d) RFAudio.shatter(c, d, { gain: ${RAGE_SHATTER_POWER} });
    }
    var last = performance.now();
    function loop(ts) {
      var dt = Math.min(0.05, (ts - last) / 1000);
      last = ts;
      eng.step(dt);
      if (ts > ${RAGE_DURATION_MS} && eng.count() === 0) {
        eng.destroy();
        __invoke("fun_close_overlay", { label: "fun-rage" }).catch(function(){});
        return;
      }
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
    // hard stop — the real desktop returns no matter what
    setTimeout(function(){
      eng.destroy();
      __invoke("fun_close_overlay", { label: "fun-rage" }).catch(function(){});
    }, ${RAGE_DURATION_MS + 800});
  }
})();
`;
  return overlayShell({ css, body, script, head: OVERLAY_AUDIO_BOOT });
}

export async function triggerRage(): Promise<void> {
  let capture: string;
  try {
    capture = await call<string>("fun_capture_screen");
  } catch {
    ctx.toast("Couldn't grab the screen to shatter — try again.", "err");
    return;
  }
  try {
    await ctx.spawnOverlay("fun-rage", rageHtml(capture), {
      fullscreen: true,
      transparent: true,
      clickable: false,
    });
    void ctx.bump("rage_uses");
  } catch {
    ctx.toast("Couldn't shatter the screen — try again.", "err");
  }
}
