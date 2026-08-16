// Desktop Pet Companion (spec §6). The one genuinely persistent widget — a
// lightweight canvas sprite/state-machine (idle / walk / react) that wanders
// a bounded area near the bottom of the screen. No heavy render loop: a small
// 180×180 canvas at ~30fps, sparse chirps so it never becomes background
// noise. Cross-widget reactions (stretch, spec §6): the runtime re-spawns it
// with a `reaction` — cowers during Rage Shatter / Glitch Jumpscare,
// celebrates during Confetti Cannon — then it returns to normal.
import audioSrc from "./audio-gen.js?raw";
import { OVERLAY_AUDIO_BOOT, overlayShell } from "./overlays";
import { ctx } from "./runtime-api";

// ---- named tunables (spec §8) ----
const PET_W = 180;
const PET_H = 180;
const PET_FPS = 30;
const PET_WALK_PAUSE_MS = 2200; // rest between walks
const PET_CHIRP_EVERY_MS = 30000; // sparse ambient chirps

export type PetReaction = "cower" | "celebrate" | null;

export function petHtml(reaction: PetReaction = null): string {
  const css = `
#stage{position:fixed;inset:0;width:100%;height:100%;}
`;
  const body = `<canvas id="stage"></canvas>`;
  const script = `
${audioSrc}
window.__PET_REACTION = ${reaction === "cower" ? '"cower"' : reaction === "celebrate" ? '"celebrate"' : "null"};
(function(){
  var canvas = document.getElementById("stage");
  var g = canvas.getContext("2d");
  function resize(){
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener("resize", resize);

  var pet = {
    x: canvas.width / 2,
    y: canvas.height - 40,
    w: 52, h: 58,
    vx: 0,
    dir: 1,
    state: "idle", // idle | walk | react
    stateT: 0,
    bobT: Math.random() * 100,
    eye: "normal", // normal | wide | happy | scared
    untilWalk: ${PET_WALK_PAUSE_MS},
    chirpAt: Date.now() + ${PET_CHIRP_EVERY_MS},
    reactUntil: 0,
    skitterT: 0,
  };
  if (window.__PET_REACTION === "cower") { pet.state = "react"; pet.eye = "scared"; pet.reactUntil = performance.now() + 2600; }
  if (window.__PET_REACTION === "celebrate") { pet.state = "react"; pet.eye = "happy"; pet.reactUntil = performance.now() + 2600; }

  // bounded wandering zone (bottom strip, keep the pet inside the window)
  var minX = 24, maxX = canvas.width - 24;

  function draw() {
    g.clearRect(0, 0, canvas.width, canvas.height);
    var x = pet.x, y = pet.y;
    var bob = Math.sin(pet.bobT / 300) * 1.6 * (pet.state === "walk" ? 2.4 : 1);
    var squash = pet.state === "walk" ? 1 + Math.abs(Math.sin(pet.bobT / 150)) * 0.08 : 1;
    // body
    g.fillStyle = "#8b93a7";
    g.beginPath();
    g.ellipse(x, y - 16 * squash, pet.w / 2, pet.h / 2 * squash, 0, 0, Math.PI * 2);
    g.fill();
    // belly
    g.fillStyle = "#c9d1e0";
    g.beginPath();
    g.ellipse(x, y - 12 * squash, pet.w * 0.32, pet.h * 0.3 * squash, 0, 0, Math.PI * 2);
    g.fill();
    // feet
    g.strokeStyle = "#5d6474";
    g.lineWidth = 4;
    g.lineCap = "round";
    if (pet.state === "walk") {
      var s = Math.sin(pet.bobT / 130) * 5;
      g.beginPath(); g.moveTo(x - 12, y + 4); g.lineTo(x - 12 - s, y + 9); g.stroke();
      g.beginPath(); g.moveTo(x + 12, y + 4); g.lineTo(x + 12 + s, y + 9); g.stroke();
    } else {
      g.beginPath(); g.moveTo(x - 12, y + 4); g.lineTo(x - 12, y + 9); g.stroke();
      g.beginPath(); g.moveTo(x + 12, y + 4); g.lineTo(x + 12, y + 9); g.stroke();
    }
    // ears
    g.fillStyle = "#6b7280";
    g.beginPath(); g.moveTo(x - 16, y - 30); g.lineTo(x - 22, y - 46); g.lineTo(x - 8, y - 34); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(x + 16, y - 30); g.lineTo(x + 22, y - 46); g.lineTo(x + 8, y - 34); g.closePath(); g.fill();
    // eyes
    g.fillStyle = "#1b1f2a";
    var ex = pet.dir * 5;
    var eyeY = y - 24 + bob;
    var r = pet.eye === "wide" ? 4.5 : 3.4;
    g.beginPath(); g.arc(x - 10 + ex, eyeY, r, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(x + 10 + ex, eyeY, r, 0, Math.PI * 2); g.fill();
    if (pet.eye === "happy") {
      // closed happy eyes (arcs)
      g.strokeStyle = "#1b1f2a"; g.lineWidth = 2;
      g.beginPath(); g.arc(x - 10 + ex, eyeY + 1, 4, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
      g.beginPath(); g.arc(x + 10 + ex, eyeY + 1, 4, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
    }
    // mouth
    g.strokeStyle = "#1b1f2a"; g.lineWidth = 1.6;
    g.beginPath();
    if (pet.eye === "happy") { g.moveTo(x - 6, y - 12); g.lineTo(x, y - 8); g.lineTo(x + 6, y - 12); }
    else if (pet.eye === "scared") { g.beginPath(); g.ellipse(x, y - 10, 4, 6, 0, 0, Math.PI * 2); g.stroke(); }
    else { g.moveTo(x - 6, y - 10); g.lineTo(x + 6, y - 10); }
    g.stroke();
    // tail
    g.strokeStyle = "#6b7280"; g.lineWidth = 4;
    var wag = Math.sin(pet.bobT / 220) * 6 * (pet.eye === "happy" ? 2 : 1);
    g.beginPath(); g.moveTo(x - pet.dir * 20, y - 18); g.quadraticCurveTo(x - pet.dir * 34, y - 24 - wag, x - pet.dir * 30, y - 34 - wag); g.stroke();
  }

  function update(dt, now) {
    pet.bobT += dt * 1000;
    pet.stateT += dt * 1000;
    if (pet.state === "react") {
      pet.vx *= 0.9;
      if (pet.skitterT > 0) {
        pet.skitterT -= dt * 1000;
        pet.x += pet.dir * 130 * dt;
      }
      if (now >= pet.reactUntil) {
        pet.state = "idle";
        pet.eye = "normal";
      }
    } else if (pet.state === "walk") {
      pet.x += pet.vx * dt;
      if (pet.x <= minX) { pet.x = minX; pet.vx = Math.abs(pet.vx); pet.dir = 1; }
      if (pet.x >= maxX) { pet.x = maxX; pet.vx = -Math.abs(pet.vx); pet.dir = -1; }
      if (pet.stateT > 1200) {
        pet.state = "idle";
        pet.untilWalk = Date.now() + ${PET_WALK_PAUSE_MS};
      }
    } else {
      // idle — occasionally decide to walk somewhere
      if (Date.now() >= pet.untilWalk) {
        pet.state = "walk";
        pet.stateT = 0;
        pet.dir = Math.random() < 0.5 ? 1 : -1;
        pet.vx = pet.dir * (26 + Math.random() * 34);
        var c = __audio.get();
        if (c && Date.now() > pet.chirpAt) {
          pet.chirpAt = Date.now() + ${PET_CHIRP_EVERY_MS};
          var d = __audio.dest(0.4);
          if (d) RFAudio.chirp(c, d, { gain: 0.05, f: 700 + Math.random() * 400 });
        }
      }
    }
  }

  function react(kind) {
    if (kind === "cower") {
      pet.state = "react"; pet.eye = "scared"; pet.reactUntil = performance.now() + 2600;
      pet.skitterT = 700; pet.dir = pet.dir * -1;
    } else if (kind === "celebrate") {
      pet.state = "react"; pet.eye = "happy"; pet.reactUntil = performance.now() + 2600;
      pet.skitterT = 900;
    }
  }
  window.__PET_REACT = react;

  // clicks on the pet → skitter/cute animation
  window.addEventListener("pointerdown", function (e) {
    var dx = e.clientX - pet.x, dy = e.clientY - pet.y;
    if (dx * dx + dy * dy < 80 * 80) {
      pet.state = "react";
      pet.eye = "wide";
      pet.reactUntil = performance.now() + 900;
      pet.skitterT = 420;
      pet.dir = dx >= 0 ? 1 : -1;
      var c = __audio.get();
      if (c) { var d = __audio.dest(0.4); if (d) RFAudio.chirp(c, d, { gain: 0.06, f: 1100 }); }
    }
  });

  var last = performance.now();
  function loop(ts) {
    var dt = Math.min(0.1, (ts - last) / 1000);
    last = ts;
    update(dt, ts);
    draw();
    setTimeout(function () { requestAnimationFrame(loop); }, 1000 / ${PET_FPS});
  }
  requestAnimationFrame(loop);
})();
`;
  return overlayShell({
    css,
    body,
    script,
    head: OVERLAY_AUDIO_BOOT,
  });
}

function spawnPet(reaction: PetReaction = null): void {
  const html = petHtml(reaction);
  ctx
    .spawnOverlay("fun-pet", html, {
      corner: "bottom-left",
      w: PET_W,
      h: PET_H,
      transparent: true,
      clickable: true,
    })
    .catch(() => ctx.toast("Couldn't summon your pet — try again.", "err"));
}

export function startPet(): () => void {
  spawnPet(null);
  void ctx.bump("pet_sessions");
  return () => {
    void ctx.closeOverlay("fun-pet");
  };
}

/** Cross-widget reaction: cower / celebrate, then back to normal. */
export function petReact(kind: "cower" | "celebrate"): void {
  void ctx.closeOverlay("fun-pet");
  spawnPet(kind);
  setTimeout(() => {
    // replace the reacting pet with the normal one (idempotent — the runtime
    // only calls this while the pet is still enabled)
    void ctx.closeOverlay("fun-pet");
    spawnPet(null);
  }, 3200);
}
