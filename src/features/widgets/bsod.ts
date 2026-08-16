// Fake BSOD prank (spec §5). A blue-screen-styled prank in the general spirit
// of a classic Windows stop-error — original made-up error text/codes and an
// in-house sad-face icon. Deliberately NOT a pixel-accurate reproduction of
// Microsoft's current BSOD (no copied UI assets, no QR, obvious parody).
// Fullscreen topmost, blocks click-through while shown, dismisses on any
// key/click only after a ~1.8s minimum display time so the gag lands, and a
// hard 20s cap so it can never become a stuck screen.
import audioSrc from "./audio-gen.js?raw";
import { OVERLAY_AUDIO_BOOT, overlayShell } from "./overlays";
import { ctx } from "./runtime-api";

// ---- named tunables (spec §8) ----

const BSOD_MIN_DISPLAY_MS = 1800;
const BSOD_MAX_DISPLAY_MS = 20000;

export function bsodHtml(): string {
  const css = `
body{background:#0a4fd4;color:#ffffff;font-family:'Segoe UI',Consolas,monospace,system-ui,sans-serif;display:flex;align-items:flex-start;justify-content:center;}
.wrap{max-width:760px;margin-top:14vh;padding:0 24px;}
.sad{font-size:92px;line-height:1;font-weight:600;margin-bottom:18px;color:#ffffff;}
h1{font-size:20px;font-weight:600;margin-bottom:22px;color:#ffffff;}
.msg{font-size:15px;line-height:1.7;color:#ffffff;opacity:0.95;}
.msg p{margin-bottom:14px;}
.codes{margin-top:26px;font-size:13px;line-height:1.8;color:#dbe7ff;opacity:0.9;font-family:Consolas,monospace;}
.progress{margin-top:30px;display:flex;align-items:center;gap:10px;font-size:13px;color:#dbe7ff;}
.bar{width:220px;height:6px;background:rgba(255,255,255,0.25);border-radius:3px;overflow:hidden;}
.bar i{display:block;height:100%;width:0;background:#ffffff;transition:width .4s linear;}
.hint{margin-top:26px;font-size:12px;color:#bcd3ff;opacity:0.85;font-family:Consolas,monospace;}
`;
  const body = `
<div class="wrap">
  <div class="sad">:(</div>
  <h1>Your PC ran into a problem and needs to pretend it didn't happen.</h1>
  <div class="msg">
    <p>We're just collecting some of the drama for a bit, then you can get back to what you were doing. This is a prank. Nothing is actually wrong.</p>
    <p>If this is the first time you've seen this screen, stop laughing. If you see it again, maybe someone left Reforge's Widgets section open.</p>
  </div>
  <div class="codes">
    <div>Stop code: REFORGE_UNEXPECTED_FUN_0x0B5E0D</div>
    <div>What failed: productivity.exe (suspected)</div>
  </div>
  <div class="progress">
    <span>Collecting drama</span>
    <div class="bar"><i id="bar"></i></div>
    <span id="pct">0%</span>
  </div>
  <div class="hint">Press any key or click to dismiss this screen (after a dramatic pause)</div>
</div>
`;
  const script = `
${audioSrc}
(function(){
  var born = __now();
  var closed = false;
  var bar = document.getElementById("bar");
  var pct = document.getElementById("pct");
  function closeIt() {
    if (closed) return;
    closed = true;
    __invoke("fun_close_overlay", { label: "fun-bsod" }).catch(function(){});
  }
  // progress bar crawls to ~42% over the min display time (it never finishes)
  var t0 = __now();
  function tick() {
    var t = Math.min(1, (__now() - t0) / ${BSOD_MIN_DISPLAY_MS});
    var p = Math.round(t * 42);
    if (bar) bar.style.width = p + "%";
    if (pct) pct.textContent = p + "%";
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  function maybeDismiss() {
    if (__now() - born >= ${BSOD_MIN_DISPLAY_MS}) closeIt();
  }
  window.addEventListener("pointerdown", maybeDismiss);
  window.addEventListener("keydown", maybeDismiss);
  // optional harsh error-tone sting on appear
  var c = __audio.get();
  if (c) {
    var d = __audio.dest(0.7);
    if (d) RFAudio.sting(c, d, { gain: 0.22 });
  }
  // never a stuck screen, even for the prankee
  setTimeout(closeIt, ${BSOD_MAX_DISPLAY_MS});
})();
`;
  return overlayShell({
    css,
    body,
    script,
    head: OVERLAY_AUDIO_BOOT,
    bg: "#0a4fd4",
  });
}

export function triggerBsod(): void {
  ctx
    .spawnOverlay("fun-bsod", bsodHtml(), {
      fullscreen: true,
      transparent: false,
      clickable: true,
      focus: true, // the prank needs the key/click that dismisses it
    })
    .then(() => ctx.bump("bsod_uses"))
    .catch(() => ctx.toast("Couldn't summon the blue screen — try again.", "err"));
}
