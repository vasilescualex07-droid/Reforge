// Confetti Cannon (spec §5). Particle-engine confetti in a transparent
// fullscreen overlay: upward/outward launch cone, gravity + air drag +
// rotation, varied bright colors, rect + ribbon shapes, fade after a few
// seconds. Auto-fires on real Reforge completion events (cleanup finished,
// maintenance run) when enabled — the runtime listens for `fun:completion`.
import audioSrc from "./audio-gen.js?raw";
import particlesSrc from "./particles-engine.js?raw";
import { OVERLAY_AUDIO_BOOT, overlayShell } from "./overlays";
import { ctx } from "./runtime-api";

// ---- named tunables (spec §8) ----

const CONFETTI_DURATION_MS = 4500; // staggered bursts so the celebration lasts
const CONFETTI_PER_WAVE = 150;

export function confettiHtml(): string {
  const css = `
#stage{position:fixed;inset:0;width:100%;height:100%;}
`;
  const body = `<canvas id="stage"></canvas>`;
  const script = `
${audioSrc}
${particlesSrc}
(function(){
  var canvas = document.getElementById("stage");
  var eng = RFParticles.createEngine(canvas, { gravity: 420, drag: 0.32 });
  var waves = 0;
  function fire(x, y, n) {
    RFParticles.burstConfetti(eng, {
      x: x, y: y,
      count: n,
      angle0: -Math.PI / 2,
      spread: 1.9,
      speed0: 220, speed1: 640,
      life: 3.2,
    });
    waves++;
    var c = __audio.get();
    if (c && waves <= 2) {
      var d = __audio.dest(0.7);
      if (d) { RFAudio.whoosh(c, d, { gain: 0.16, dur: 0.5 }); RFAudio.pop(c, d, { gain: 0.2 }); }
    }
  }
  // launch: center-top burst + two angled side bursts
  fire(window.innerWidth / 2, window.innerHeight * 0.38, ${CONFETTI_PER_WAVE});
  setTimeout(function(){ fire(window.innerWidth * 0.28, window.innerHeight * 0.5, 90); }, 420);
  setTimeout(function(){ fire(window.innerWidth * 0.72, window.innerHeight * 0.5, 90); }, 840);
  var last = performance.now();
  function loop(ts) {
    var dt = Math.min(0.05, (ts - last) / 1000);
    last = ts;
    eng.step(dt);
    if (ts > ${CONFETTI_DURATION_MS} && eng.count() === 0) {
      eng.destroy();
      __invoke("fun_close_overlay", { label: "fun-confetti" }).catch(function(){});
      return;
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
  // hard stop — never leave a ghost window
  setTimeout(function(){
    eng.destroy();
    __invoke("fun_close_overlay", { label: "fun-confetti" }).catch(function(){});
  }, ${CONFETTI_DURATION_MS + 2500});
})();
`;
  return overlayShell({ css, body, script, head: OVERLAY_AUDIO_BOOT });
}

export function triggerConfetti(): void {
  ctx
    .spawnOverlay("fun-confetti", confettiHtml(), {
      fullscreen: true,
      transparent: true,
      clickable: false,
    })
    .then(() => ctx.bump("confetti_fired"))
    .catch(() => ctx.toast("Couldn't fire the confetti cannon — try again.", "err"));
}
