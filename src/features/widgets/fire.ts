// CPU Fire Alarm (spec §6). Sustained CPU above a threshold (default 85%) for
// a minimum duration (default 5s) — a momentary spike never fires it. The
// payoff is a small corner overlay: animated cartoon flame + rising smoke,
// a pulsing red screen-edge vignette while sustained, and a cartoon siren
// loop that fades out once usage drops back under the threshold.
import audioSrc from "./audio-gen.js?raw";
import { OVERLAY_AUDIO_BOOT, overlayShell } from "./overlays";
import { subscribeStats } from "./stats";
import { ctx } from "./runtime-api";
import { cfg } from "./runtime-api";
import { FIRE_THRESHOLD, FIRE_DURATION_S } from "./constants";

// ---- named tunables (spec §8) ----


export const FIRE_COOLDOWN_S = 20; // min gap between alarm episodes

export function fireHtml(): string {
  const css = `
#stage{position:fixed;inset:0;width:100%;height:100%;}
.flame{position:absolute;bottom:8px;left:50%;transform:translateX(-50%);width:120px;height:150px;}
.msg{position:absolute;top:6px;left:0;right:0;text-align:center;font-size:12px;font-weight:600;color:#fbbf24;letter-spacing:.4px;}
.sub{position:absolute;top:24px;left:0;right:0;text-align:center;font-size:11px;color:#94a3b8;}
`;
  const body = `
<div class="msg">CPU FIRE ALARM</div>
<div class="sub">your processor is having a moment</div>
<canvas id="stage"></canvas>
`;
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
  window.addEventListener("resize", resize);

  // flame particles: rise, flicker, fade — smoke drifts up and widens
  var parts = [];
  function spawnFlame(){
    var cx = canvas.width / 2, base = canvas.height - 10;
    parts.push({
      x: cx + (Math.random() - 0.5) * 26,
      y: base + Math.random() * 10,
      vx: (Math.random() - 0.5) * 26,
      vy: -(70 + Math.random() * 90),
      life: 0.6 + Math.random() * 0.5,
      max: 1.1,
      r: 7 + Math.random() * 12,
      kind: "flame",
    });
  }
  function spawnSmoke(){
    var cx = canvas.width / 2;
    parts.push({
      x: cx + (Math.random() - 0.5) * 40,
      y: canvas.height - 14,
      vx: (Math.random() - 0.5) * 22,
      vy: -(34 + Math.random() * 26),
      life: 1.6 + Math.random() * 0.9,
      max: 2.5,
      r: 8 + Math.random() * 10,
      kind: "smoke",
    });
  }
  var last = performance.now();
  var acc = 0;
  function loop(ts){
    var dt = Math.min(0.05, (ts - last) / 1000);
    last = ts;
    acc += dt;
    if (acc > 0.03) { acc = 0; spawnFlame(); }
    if (Math.random() < 0.25) spawnSmoke();
    g.clearRect(0, 0, canvas.width, canvas.height);
    for (var i = parts.length - 1; i >= 0; i--) {
      var p = parts[i];
      p.life -= dt;
      if (p.life <= 0) { parts.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === "smoke") p.r += dt * 6;
      var t = Math.max(0, Math.min(1, p.life / p.max));
      if (p.kind === "flame") {
        var grad = g.createRadialGradient(p.x, p.y, 1, p.x, p.y, p.r * (0.6 + t * 0.4));
        grad.addColorStop(0, "rgba(255,190,60," + (0.9 * t) + ")");
        grad.addColorStop(0.5, "rgba(255,110,30," + (0.85 * t) + ")");
        grad.addColorStop(1, "rgba(220,40,10,0)");
        g.fillStyle = grad;
        g.beginPath();
        g.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        g.fill();
      } else {
        g.fillStyle = "rgba(148,163,184," + (0.28 * t) + ")";
        g.beginPath();
        g.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        g.fill();
      }
    }
    // pulsing red screen-edge vignette while the alarm is live
    var pulse = 0.5 + 0.5 * Math.sin(ts / 180);
    var vg = g.createRadialGradient(
      canvas.width / 2, canvas.height / 2, Math.min(canvas.width, canvas.height) * 0.42,
      canvas.width / 2, canvas.height / 2, Math.max(canvas.width, canvas.height) * 0.72
    );
    vg.addColorStop(0, "rgba(220,30,10,0)");
    vg.addColorStop(1, "rgba(220,30,10," + (0.42 * pulse).toFixed(3) + ")");
    g.fillStyle = vg;
    g.fillRect(0, 0, canvas.width, canvas.height);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // cartoon siren loop while visible; window teardown stops it with the page
  var c = __audio.get();
  var siren = null;
  if (c) {
    var d = __audio.dest(0.5);
    if (d) { siren = RFAudio.siren(c, d, { gain: 0.05, speed: 0.8 }); }
  }
  // fade + close when the backend closes us (CPU dropped / widget off)
  window.__stopSiren = function () {
    if (siren) { try { siren.stop(400); } catch (e) {} siren = null; }
  };
})();
`;
  return overlayShell({
    css,
    body,
    script,
    head: OVERLAY_AUDIO_BOOT,
  });
}

// ---- ambient wiring: sustained-threshold state machine --------------------
let open = false;
let samples: number[] = [];
let episodeStartAt = 0;
let lastEpisodeEnd = 0;

function openAlarm(now: number): void {
  if (open) return;
  open = true;
  ctx
    .spawnOverlay("fun-fire", fireHtml(), {
      corner: "bottom-right",
      w: 340,
      h: 240,
      transparent: true,
      clickable: false,
    })
    .then(() => ctx.bump("fire_fired"))
    .catch(() => ctx.toast("Couldn't raise the fire alarm — try again.", "err"));
  episodeStartAt = now;
}

function closeAlarm(now: number): void {
  if (!open) return;
  open = false;
  lastEpisodeEnd = now;
  void ctx.closeOverlay("fun-fire");
}

export function startFire(): () => void {
  samples = [];
  const unsub = subscribeStats((s) => {
    const threshold = Number(cfg("fire", "threshold", FIRE_THRESHOLD)) || FIRE_THRESHOLD;
    const durationMs = (Number(cfg("fire", "duration", FIRE_DURATION_S)) || FIRE_DURATION_S) * 1000;
    const cooldownMs = (Number(cfg("fire", "cooldown", FIRE_COOLDOWN_S)) || FIRE_COOLDOWN_S) * 1000;
    const now = Date.now();
    if (s.cpu >= threshold) {
      samples.push(s.cpu);
      // keep only a window that spans the required duration
      while (samples.length * 1000 > durationMs + 3000) samples.shift();
      if (!open && now - lastEpisodeEnd >= cooldownMs) {
        const sustained = samples.length * 1000 >= durationMs;
        if (sustained) openAlarm(now);
      }
    } else {
      samples = [];
      if (open && now - episodeStartAt > 1000) closeAlarm(now);
    }
  });
  return () => {
    unsub();
    samples = [];
    if (open) closeAlarm(Date.now());
  };
}
