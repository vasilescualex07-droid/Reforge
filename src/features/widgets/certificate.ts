// Procrastination Certificate (spec §5). Pulls REAL stats already available
// from Reforge's system hooks (session uptime, process count, idle time,
// time since last cleanup, force-quits) and renders an ornate mock-official
// "Certificate of Distinguished Procrastination" — the joke is the formality
// vs. the mundane numbers. Rendered on canvas so Save/Share is one line:
// toDataURL → fun_save_png → the user's Downloads folder.
import { fetchStatsOnce } from "./stats";
import { getState } from "./store";
import audioSrc from "./audio-gen.js?raw";
import { OVERLAY_AUDIO_BOOT, overlayShell } from "./overlays";
import { ctx } from "./runtime-api";
import { fmtAge } from "../../lib/format";
import type { StatsSnapshot } from "./types";

export function certificateHtml(s: StatsSnapshot): string {
  const store = getState();
  const lastCleanupMs = store.counts["last_cleanup_ms"] ?? 0;
  const lastCleanup = lastCleanupMs ? fmtAge(lastCleanupMs) : "longer than records exist";
  const idle = s.idle_secs > 0 ? fmtAge(Date.now() - s.idle_secs * 1000) : "0 min";
  const name = typeof ctx.config("certificate").name === "string"
    ? String(ctx.config("certificate").name)
    : "Valued Procrastinator";

  // Draw the certificate at 2x for a crisp export PNG.
  const css = `
#stage{position:fixed;inset:0;width:100%;height:100%;background:#f4f1ea;}
`;
  const body = `<canvas id="stage"></canvas><div id="status" style="position:fixed;bottom:14px;left:0;right:0;text-align:center;font-size:13px;color:#6b6258;font-family:Georgia,serif;display:none;"></div>`;
  const script = `
${audioSrc}
(function(){
  var canvas = document.getElementById("stage");
  var statusEl = document.getElementById("status");
  var dpr = window.devicePixelRatio || 1;
  var W = 620, H = 800;
  canvas.width = W * 2;
  canvas.height = H * 2;
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  var g = canvas.getContext("2d");
  g.scale(2, 2);
  var viewW = canvas.clientWidth || W;
  var scale = viewW / W;
  g.setTransform(2 * scale, 0, 0, 2 * scale, 0, 0);

  function roundRect(x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  function draw() {
    // parchment
    g.fillStyle = "#f7f3ea";
    g.fillRect(0, 0, W, H);
    // double gold border
    g.strokeStyle = "#b08d3e";
    g.lineWidth = 6;
    roundRect(14, 14, W - 28, H - 28, 8);
    g.stroke();
    g.lineWidth = 1.5;
    roundRect(26, 26, W - 52, H - 52, 6);
    g.stroke();
    // corner flourishes
    g.fillStyle = "#b08d3e";
    [[44, 44], [W - 44, 44], [44, H - 44], [W - 44, H - 44]].forEach(function (p) {
      g.beginPath();
      g.arc(p[0], p[1], 7, 0, Math.PI * 2);
      g.fill();
    });
    // header
    g.textAlign = "center";
    g.fillStyle = "#3a3428";
    g.font = "italic 15px Georgia, serif";
    g.fillText("THE REPUBLIC OF REFORGE", W / 2, 84);
    g.font = "700 34px Georgia, serif";
    g.fillStyle = "#b08d3e";
    g.fillText("Certificate of Distinguished", W / 2, 128);
    g.fillText("Procrastination", W / 2, 168);
    g.font = "italic 14px Georgia, serif";
    g.fillStyle = "#6b6258";
    g.fillText("— presented with zero ceremony —", W / 2, 196);

    // name ribbon
    g.font = "italic 26px Georgia, serif";
    g.fillStyle = "#3a3428";
    g.fillText("${esc(name)}", W / 2, 258);
    g.strokeStyle = "#c9b678";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(W / 2 - 170, 272);
    g.lineTo(W / 2 + 170, 272);
    g.stroke();

    // stats block
    g.font = "16px Georgia, serif";
    g.fillStyle = "#4a4233";
    var lines = [
      "This certificate is awarded for outstanding service to",
      "the art of not doing things, as evidenced by:",
      "",
      "Session uptime ............ ${fmtDur(s.uptime_secs)}",
      "Processes running ......... ${s.proc_count} (all of them busy, surely)",
      "Time idle right now ....... ${esc(idle)}",
      "Since last cleanup ........ ${esc(lastCleanup)}",
      "Processes force-quit ...... ${store.counts["force_quits"] ?? 0} (mercy count)",
      "Total cleanups performed .. ${store.counts["cleanups"] ?? 0}",
    ];
    lines.forEach(function (line, i) {
      g.fillText(line, W / 2, 316 + i * 26);
    });

    // seal
    var sealX = W / 2, sealY = 560;
    g.strokeStyle = "#b08d3e";
    g.lineWidth = 3;
    g.beginPath();
    g.arc(sealX, sealY, 44, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = "#c9b678";
    g.lineWidth = 1;
    g.beginPath();
    g.arc(sealX, sealY, 38, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = "#b08d3e";
    g.font = "600 30px Georgia, serif";
    g.fillText("RF", sealX, sealY + 11);

    // footer
    g.font = "italic 13px Georgia, serif";
    g.fillStyle = "#6b6258";
    g.fillText("Issued by the Bureau of Genuinely Urgent Other Things", W / 2, 660);
    g.fillText(new Date().toLocaleDateString([], { year: "numeric", month: "long", day: "numeric" }), W / 2, 690);
  }
  draw();

  var saved = false;
  function save() {
    if (saved) return;
    saved = true;
    try {
      var data = canvas.toDataURL("image/png").split(",")[1];
      __invoke("fun_save_png", { data: data, filename: "procrastination-certificate.png" })
        .then(function (path) {
          if (statusEl) {
            statusEl.style.display = "block";
            statusEl.textContent = "Saved to " + path;
          }
          setTimeout(function(){ __invoke("fun_close_overlay", { label: "fun-cert" }).catch(function(){}); }, 2600);
        })
        .catch(function () {
          saved = false;
          if (statusEl) {
            statusEl.style.display = "block";
            statusEl.style.color = "#a33";
            statusEl.textContent = "Couldn't save the PNG — try again.";
          }
        });
    } catch (e) {
      saved = false;
    }
  }
  // Save button: DOM overlay (monochrome, small)
  var btn = document.createElement("button");
  btn.textContent = "Save / Share PNG";
  btn.style.cssText = "position:fixed;bottom:26px;left:50%;transform:translateX(-50%);background:#1b1b1b;color:#fff;border:none;border-radius:6px;padding:10px 22px;font-size:14px;cursor:pointer;font-family:'Segoe UI',system-ui,sans-serif;";
  btn.addEventListener("pointerdown", function (e) { e.stopPropagation(); save(); });
  document.body.appendChild(btn);
  var c = __audio.get();
  if (c) {
    var d = __audio.dest(0.7);
    if (d) RFAudio.flourish(c, d, { gain: 0.15 });
  }
  // Esc closes
  window.addEventListener("keydown", function (e) {
    if (e.key === "Escape") __invoke("fun_close_overlay", { label: "fun-cert" }).catch(function(){});
  });
})();
`;
  return overlayShell({
    css,
    body,
    script,
    head: OVERLAY_AUDIO_BOOT,
    bg: "#f4f1ea",
  });
}

function fmtDur(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h >= 1) return `${h}h ${m}m`;
  return `${m} min`;
}

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function triggerCertificate(): Promise<void> {
  const s = await fetchStatsOnce();
  try {
    await ctx.spawnOverlay(
      "fun-cert",
      certificateHtml(s),
      {
        w: 620,
        h: 820,
        transparent: false,
        clickable: true,
      }
    );
    void ctx.bump("cert_count");
  } catch {
    ctx.toast("Couldn't print your certificate — try again.", "err");
  }
}

