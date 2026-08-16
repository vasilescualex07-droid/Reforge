// Boss Key (spec §5). One global hotkey (tauri-plugin-global-shortcut — fires
// even when Reforge isn't focused) instantly covers the screen with a
// fullscreen topmost window containing a pre-built boring fake spreadsheet:
// generic grid, plausible meaningless data. We never minimize or touch other
// real windows — the cover just sits on top, and the same hotkey toggles it
// back off, restoring the real desktop exactly as it was. No audio — silence
// is the point.
import { overlayShell } from "./overlays";
import { ctx } from "./runtime-api";

// ---- named tunables (spec §8) ----

const BOSS_ROWS = 22;
const BOSS_COLS = 7;

// Deterministic-but-plausible gibberish: quarterly numbers that go nowhere.
function fakeCell(r: number, c: number): string {
  if (r === 0) {
    const heads = ["Region", "Q1", "Q2", "Q3", "Q4", "YoY", "Notes"];
    return heads[c] ?? "";
  }
  if (c === 0) {
    const regions = ["North", "South", "East", "West", "Central", "Pacific"];
    return regions[r % regions.length];
  }
  if (c === BOSS_COLS - 1) {
    const notes = ["—", "reviewing", "hold", "sync", "EOD", "n/a", "follow up"];
    return notes[(r * 7 + c) % notes.length];
  }
  if (c === BOSS_COLS - 2) {
    return `${(92 + ((r * 13 + c) % 30))}.${(r * 3 + c) % 10}%`;
  }
  return `${1 + ((r * 37 + c * 11) % 9)}${(r * 7 + c) % 10},${(r * 5 + c * 3) % 100}`.padStart(
    4,
    "0"
  );
}

function buildGrid(): string {
  let rows = "";
  for (let r = 0; r < BOSS_ROWS; r++) {
    let cells = "";
    for (let c = 0; c < BOSS_COLS; c++) {
      const cls = r === 0 ? "head" : c === 0 ? "label" : "";
      cells += `<td class="${cls}">${fakeCell(r, c)}</td>`;
    }
    rows += `<tr>${cells}</tr>`;
  }
  return rows;
}

export function bossHtml(): string {
  const css = `
body{background:#f3f2f1;color:#1b1b1b;font-family:'Segoe UI',system-ui,sans-serif;}
.app{display:flex;flex-direction:column;height:100%;}
.menubar{display:flex;align-items:center;gap:14px;background:#faf9f8;border-bottom:1px solid #e1dfdd;padding:6px 14px;font-size:12px;color:#323130;}
.menubar b{color:#000;}
.tabbar{display:flex;align-items:center;gap:6px;background:#faf9f8;padding:6px 14px 0;border-bottom:1px solid #e1dfdd;font-size:12px;}
.tab{background:#fff;border:1px solid #e1dfdd;border-bottom:none;padding:5px 16px;border-radius:3px 3px 0 0;color:#323130;}
.gridwrap{flex:1;overflow:hidden;margin:14px;background:#fff;border:1px solid #e1dfdd;border-radius:3px;}
table{border-collapse:collapse;width:100%;font-size:12px;}
td{border:1px solid #e8e6e4;padding:4px 10px;text-align:right;white-space:nowrap;color:#323130;}
td.label{text-align:left;color:#201f1e;font-weight:500;}
td.head{background:#f0f0ee;font-weight:600;text-align:left;color:#201f1e;}
.statusbar{display:flex;align-items:center;gap:18px;background:#faf9f8;border-top:1px solid #e1dfdd;padding:4px 14px;font-size:11px;color:#605e5c;}
`;
  const body = `
<div class="app">
  <div class="menubar"><b>Untitled - Spreadsheet</b><span>File</span><span>Edit</span><span>View</span><span>Insert</span><span>Format</span><span>Data</span></div>
  <div class="tabbar"><span class="tab">Q4 Overview</span><span style="padding:5px 10px;color:#a19f9d;">+</span></div>
  <div class="gridwrap"><table>${buildGrid()}</table></div>
  <div class="statusbar"><span>Sheet1</span><span>${BOSS_ROWS - 1} rows × ${BOSS_COLS - 2} cols</span><span id="clock">—</span></div>
</div>
`;
  const script = `
(function(){
  var clock = document.getElementById("clock");
  function tick(){
    if (clock) clock.textContent = new Date().toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
  }
  tick();
  setInterval(tick, 30000);
  // Esc also hides it — never trap the user in a fake spreadsheet
  window.addEventListener("keydown", function(e){
    if (e.key === "Escape") __invoke("fun_close_overlay", { label: "fun-boss" }).catch(function(){});
  });
})();
`;
  return overlayShell({
    css,
    body,
    script,
    bg: "#f3f2f1",
  });
}

/** Toggle: open → close, closed → open (same hotkey toggles, spec §5). */
let bossOpen = false;
export function isBossOpen(): boolean {
  return bossOpen;
}
export function setBossOpen(v: boolean): void {
  bossOpen = v;
}

export function triggerBoss(): void {
  if (bossOpen) {
    bossOpen = false;
    void ctx.closeOverlay("fun-boss");
    return;
  }
  ctx
    .spawnOverlay("fun-boss", bossHtml(), {
      fullscreen: true,
      transparent: false,
      clickable: true,
      focus: true,
    })
    .then(() => {
      bossOpen = true;
      return ctx.bump("boss_uses");
    })
    .catch(() => ctx.toast("Couldn't open the boss cover — try again.", "err"));
}
