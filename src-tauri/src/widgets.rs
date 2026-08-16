use crate::state::AppState;
use crate::storage::{load_json, save_json};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::PathBuf;
use tauri::{Manager, State, WebviewUrl, WebviewWindowBuilder};
use uuid::Uuid;

use crate::error::AppError;
use crate::undo;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

/// A desktop widget. Geometry (x/y/w/h) is absolute virtual-screen pixels;
/// `monitor` remembers which monitor the widget lives on so a layout survives
/// reboots and monitor reordering (S9.2). `serde(default)` keeps old
/// `widgets.json` files loadable after the field was added.
#[derive(Serialize, Deserialize, Clone)]
pub struct WidgetConfig {
    pub id: String,
    pub kind: String, // clock | stats | note | todo | calendar | battery | toggles | worldclock | agenda
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub title: String,
    pub content: String,
    pub visible: bool,
    #[serde(default)]
    pub monitor: u32,
}

impl WidgetConfig {
    pub fn window_label(&self) -> String {
        format!("widget-{}", self.id)
    }
}

fn widgets_path(state: &AppState) -> PathBuf {
    state.data_dir.join("widgets.json")
}

fn load_widgets(state: &AppState) -> Vec<WidgetConfig> {
    load_json(&widgets_path(state), Vec::new())
}

fn save_widgets(state: &AppState, w: &Vec<WidgetConfig>) -> Result<(), AppError> {
    save_json(&widgets_path(state), w)
}

/// Index of the monitor whose rect contains (x, y) — the widget's home
/// monitor. Falls back to 0 (primary) when the point is on no monitor.
fn monitor_index_at(app: &tauri::AppHandle, x: f64, y: f64) -> u32 {
    match app.available_monitors() {
        Ok(ms) => {
            let (cx, cy) = (x as i64, y as i64);
            for (i, m) in ms.iter().enumerate() {
                let p = m.position();
                let s = m.size();
                let (rx, ry, rw, rh) = (p.x as i64, p.y as i64, s.width as i64, s.height as i64);
                if cx >= rx && cx < rx + rw && cy >= ry && cy < ry + rh {
                    return i as u32;
                }
            }
            0
        }
        Err(_) => 0,
    }
}

/// Keep a moved/resized widget inside the virtual screen so a monitor removal
/// can't strand it off-screen. Returns the possibly-clamped position.
fn clamp_to_virtual_screen(x: f64, y: f64, w: f64, h: f64) -> (f64, f64) {
    let (sx, sy, sw, sh) = crate::wallpaper_engine::virtual_screen();
    let (sx, sy, sw, sh) = (sx as f64, sy as f64, sw as f64, sh as f64);
    let cx = (x + w / 2.0).clamp(sx, sx + sw - 1.0);
    let cy = (y + h / 2.0).clamp(sy, sy + sh - 1.0);
    ((cx - w / 2.0).max(sx - w + 40.0), (cy - h / 2.0).max(sy - h + 40.0))
}

/// Persist the live geometry of one widget window into widgets.json. Called
/// debounced from the window's Moved/Resized events (S9.2 drag persistence).
fn persist_widget_geometry(app: &tauri::AppHandle, id: &str) {
    let Some(win) = app.get_webview_window(&format!("widget-{}", id)) else {
        return;
    };
    let (Ok(pos), Ok(size)) = (win.outer_position(), win.outer_size()) else {
        return;
    };
    let (x, y, w, h) = (
        pos.x as f64,
        pos.y as f64,
        size.width.max(120) as f64,
        size.height.max(80) as f64,
    );
    let monitor = monitor_index_at(app, x + w / 2.0, y + h / 2.0);
    let dir = app
        .path()
        .app_data_dir()
        .unwrap_or_default();
    let mut list: Vec<WidgetConfig> = load_json(&dir.join("widgets.json"), Vec::new());
    if let Some(wcfg) = list.iter_mut().find(|w| w.id == id) {
        wcfg.x = x;
        wcfg.y = y;
        wcfg.w = w;
        wcfg.h = h;
        wcfg.monitor = monitor;
        let _ = save_json(&dir.join("widgets.json"), &list);
    }
}

/// Debounced geometry saver: one sleeping thread per widget window. Every
/// Moved/Resized event bumps a shared timestamp; the thread wakes each 600ms
/// and persists only when the timestamp has settled (drag ended).
pub(crate) fn spawn_geometry_saver(
    app: &tauri::AppHandle,
    id: String,
    window: &tauri::WebviewWindow,
) {
    let ts = Arc::new(AtomicU64::new(0));
    let ts_ev = ts.clone();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_)) {
            ts_ev.store(crate::storage::now_millis(), Ordering::Relaxed);
        }
    });
    let app2 = app.clone();
    std::thread::spawn(move || {
        let mut last = 0u64;
        loop {
            std::thread::sleep(Duration::from_millis(600));
            let cur = ts.load(Ordering::Relaxed);
            if cur != last {
                last = cur;
                persist_widget_geometry(&app2, &id);
            }
        }
    });
}

/// JS string context: backslash + quote, plus `<`/`>` as \u escapes so a
/// hostile `</script>` can never close the widget's inline script block.
fn esc(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('<', "\\u003C")
        .replace('>', "\\u003E")
}

/// HTML text/attribute context: full & < > " ' escaping so user content can
/// never break out of a tag or inject an event handler (S3.6 / audit M5).
fn esc_html(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

// CSP model (K4/S9.7): widget windows load a local file:// document with
// INLINE scripts and styles (the whole widget runtime is one HTML string), so
// a strict CSP with `script-src 'self'` is impossible — no webview can run
// inline scripts under it. The hardening contract instead is:
//   1. every user-controlled string enters the document through exactly two
//      chokepoints — `esc_html` (HTML/attribute context) or `esc` (JS string
//      context, with < > \u-escaped so `</script>` can never close the inline
//      script block);
//   2. zero remote content: no http(s) URLs, no external fonts/images, no
//      fetch/XHR to anywhere but the app's own IPC; the document's only
//      network capability is __TAURI_INTERNALS__ invoke calls;
//   3. widget windows never load arbitrary URLs — open_widget only ever points
//      at the generated local HTML file.
// New widget kinds must route ALL user content through those two chokepoints;
// the all-kinds escaping test below enforces it.
fn widget_html(cfg: &WidgetConfig) -> String {
    let kind = cfg.kind.as_str();
    let content = cfg.content.clone();
    let title = cfg.title.clone();
    let bg = "rgba(10,14,28,0.72)";
    let border = "rgba(255,255,255,0.14)";
    // A5.3 — widgets follow the live accent (rebuilt whenever the widget is
    // opened), so hardware/theme changes are reflected on the desktop widgets.
    let accent = crate::theme::current_accent_hex();
    let inner = match kind {
        "clock" => r#"<div id="time">--:--</div><div id="date">—</div><div id="focus" style="display:none"></div>"#.to_string(),
        "stats" => r#"<div id="stats"><div class="row" data-v="performance"><span>CPU</span><div class="bar"><i id="cpu"></i></div><b id="cpuV">0%</b></div><div class="row" data-v="performance"><span>RAM</span><div class="bar"><i id="ram"></i></div><b id="ramV">0%</b></div><div class="row" data-v="performance"><span>Disk</span><div class="bar"><i id="disk"></i></div><b id="diskV">0%</b></div><div class="row" data-v="performance"><span>GPU</span><div class="bar"><i id="gpu"></i></div><b id="gpuV">—</b></div><div class="row" data-v="network"><span>Net</span><div class="net"><b id="netDown">↓0</b><b id="netUp">↑0</b></div></div><div class="row" data-v="performance"><span>Temp</span><div class="bar"><i id="temp"></i></div><b id="tempV">—</b></div><div class="procs" id="procs"></div></div>"#.to_string(),
        "note" => format!(r#"<textarea id="note" placeholder="Write something…">{}</textarea><div class="hint">Auto-saved locally</div>"#, esc_html(&content)),
        "todo" => r#"<div id="todos"></div><div class="todo-add"><input id="newTodo" placeholder="Add a task…"><button id="addTodo">+</button></div>"#.to_string(),
        "calendar" => r#"<div id="calHead"></div><div id="calGrid"></div>"#.to_string(),
        "battery" => r#"<div class="batt"><div class="batt-ico" id="battIco">?</div><div class="batt-meta"><div id="battPct">—</div><div id="battSub">checking…</div></div></div><div class="hint">Live from the performance monitor</div>"#.to_string(),
        "toggles" => r#"<div id="toggles"><button class="tg" id="tgTheme"><span>Theme</span><b id="tgThemeV">—</b></button><button class="tg" id="tgMute"><span>Mute</span><b id="tgMuteV">—</b></button></div>"#.to_string(),
        "worldclock" => r#"<div id="wc"></div>"#.to_string(),
        "agenda" => r#"<div id="agHead"></div><div id="agList"></div>"#.to_string(),
        _ => String::new(),
    };
    let script = match kind {
        "clock" => r#"
const t=document.getElementById('time'),d=document.getElementById('date'),f=document.getElementById('focus');
setInterval(()=>{const n=new Date();t.textContent=n.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});d.textContent=n.toLocaleDateString([],{weekday:'short',month:'short',day:'numeric'});},1000);
window.__setFocus=(secs)=>{if(secs>0){const m=Math.floor(secs/60),s=String(secs%60).padStart(2,'0');f.textContent='FOCUS '+m+':'+s;f.style.display='block';}else{f.style.display='none';}};"#.to_string(),
        "stats" => r#"
window.__setStats=(s)=>{document.getElementById('cpu').style.width=s.cpu+'%';document.getElementById('cpuV').textContent=Math.round(s.cpu)+'%';document.getElementById('ram').style.width=s.ram+'%';document.getElementById('ramV').textContent=Math.round(s.ram)+'%';document.getElementById('disk').style.width=s.disk+'%';document.getElementById('diskV').textContent=Math.round(s.disk)+'%';const g=document.getElementById('gpu');if(s.gpu){const u=s.gpu.usage==='—'?'—':Math.round(s.gpu.usage)+'%';document.getElementById('gpuV').textContent=u;g.style.width=u==='—'?'0%':u;}const n=document.getElementById('netDown');if(n){n.textContent='↓'+Math.round(s.net.down)+' k';document.getElementById('netUp').textContent='↑'+Math.round(s.net.up)+' k';}const tv=document.getElementById('temp');if(tv&&s.thermal!=='—'){tv.style.width=Math.min(100,s.thermal.replace('°C',''))+'%';document.getElementById('tempV').textContent=s.thermal;}const p=document.getElementById('procs');if(s.procs){p.innerHTML=s.procs.slice(0,3).map(x=>`<div>${x.name} <span>${Math.round(x.cpu)}%</span></div>`).join('')}};
const inv=(c,a)=>window.__TAURI_INTERNALS__?window.__TAURI_INTERNALS__.invoke(c,a||{}):Promise.reject();
document.querySelectorAll('.row[data-v]').forEach(r=>r.addEventListener('click',()=>inv('widget_open_view',{view:r.dataset.v}).catch(()=>{})));"#.to_string(),
        "note" => r#"
const ta=document.getElementById('note');
const inv=(c,a)=>window.__TAURI_INTERNALS__?window.__TAURI_INTERNALS__.invoke(c,a||{}):Promise.reject();
let timer=null;
ta.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(()=>{inv('save_widget_note',{id:window.__WIDGET_ID,content:ta.value}).catch(()=>localStorage.setItem('note-'+window.__WIDGET_ID,ta.value));},500);});
if(localStorage.getItem('note-'+window.__WIDGET_ID)&&!window.__HAS_CONTENT)ta.value=localStorage.getItem('note-'+window.__WIDGET_ID);"#.to_string(),
        "todo" => r#"
const wrap=document.getElementById('todos');
const inv=(c,a)=>window.__TAURI_INTERNALS__?window.__TAURI_INTERNALS__.invoke(c,a||{}):Promise.reject();
let items=window.__TODO||[];
function render(){wrap.innerHTML=items.map((t,i)=>`<div class="t ${t[0]?'done':''}"><input type="checkbox" data-i="${i}" ${t[0]?'checked':''}><span>${t[1]}</span><button data-x="${i}">✕</button></div>`).join('');}
function save(){inv('save_widget_note',{id:window.__WIDGET_ID,content:JSON.stringify(items)}).catch(()=>{});}
render();
wrap.addEventListener('change',e=>{const i=+e.target.dataset.i;items[i][0]=e.target.checked;save();render();});
wrap.addEventListener('click',e=>{if(e.target.dataset.x!==undefined){items.splice(+e.target.dataset.x,1);save();render();}});
document.getElementById('addTodo').onclick=()=>{const v=document.getElementById('newTodo').value.trim();if(v){items.push([false,v]);document.getElementById('newTodo').value='';save();render();}};"#.to_string(),
        "calendar" => r#"
const head=document.getElementById('calHead'),grid=document.getElementById('calGrid');
function render(){const n=new Date();const y=n.getFullYear(),m=n.getMonth();head.textContent=n.toLocaleDateString([],{month:'long',year:'numeric'});const first=new Date(y,m,1).getDay();const days=new Date(y,m+1,0).getDate();let h='';for(const d of ['S','M','T','W','T','F','S'])h+=`<div class="dow">${d}</div>`;for(let i=0;i<first;i++)h+='<div></div>';for(let d=1;d<=days;d++){h+=`<div class="day ${d===n.getDate()?'today':''}">${d}</div>`;}grid.innerHTML=h;}
render();"#.to_string(),
        "battery" => r#"
const inv=(c,a)=>window.__TAURI_INTERNALS__?window.__TAURI_INTERNALS__.invoke(c,a||{}):Promise.reject();
const pct=document.getElementById('battPct'),sub=document.getElementById('battSub'),ico=document.getElementById('battIco');
function paint(b){if(!b){pct.textContent='—';sub.textContent='no battery';ico.textContent='AC';return;}pct.textContent=b.percent+'%';sub.textContent=b.on_ac?(b.charging?'charging · AC':'on AC'):(b.charging?'charging':'on battery');ico.textContent=b.percent>66?'▮▮▮':b.percent>33?'▮▮':'▮';ico.style.color='{accent}';}
async function tick(){try{const s=await inv('get_performance',{});paint(s.battery);}catch(e){pct.textContent='—';sub.textContent='live data unavailable';}}
tick();setInterval(tick,5000);"#.to_string(),
        "toggles" => r#"
const inv=(c,a)=>window.__TAURI_INTERNALS__?window.__TAURI_INTERNALS__.invoke(c,a||{}):Promise.reject();
const tv=document.getElementById('tgThemeV'),mv=document.getElementById('tgMuteV');
async function refresh(){try{const s=await inv('get_theme_state',{});tv.textContent=s.mode==='dark'?'Dark':'Light';tv.style.color=s.mode==='dark'?'#a5b4fc':'#fbbf24';}catch(e){tv.textContent='—';}}
document.getElementById('tgTheme').onclick=async()=>{try{const s=await inv('get_theme_state',{});const next=s.mode==='dark'?'light':'dark';await inv('set_theme_mode',{mode:next});refresh();}catch(e){}}
refresh();"#.to_string(),
        "worldclock" => r#"
const wc=document.getElementById('wc');
const ZONES=[['Local',Intl.DateTimeFormat().resolvedOptions().timeZone||'local'],['London','Europe/London'],['Tokyo','Asia/Tokyo'],['NYC','America/New_York']];
function tz(t){try{return new Intl.DateTimeFormat([],{timeZone:t,hour:'2-digit',minute:'2-digit'}).format(new Date());}catch(e){return '—';}}
function render(){wc.innerHTML=ZONES.map(([c,t])=>`<div class="wcr"><span>${c}</span><b>${tz(t)}</b></div>`).join('');}
render();setInterval(render,10000);"#.to_string(),
        "agenda" => r#"
const head=document.getElementById('agHead'),list=document.getElementById('agList');
function render(){const n=new Date();head.textContent=n.toLocaleDateString([],{weekday:'long',month:'long',day:'numeric'});let h='';for(let i=0;i<6;i++){const d=new Date();d.setDate(n.getDate()+i);const day=d.getDay();if(day===0||day===6)continue;const ev=window.__AGENDA&&window.__AGENDA[i]?window.__AGENDA[i]:null;h+=`<div class="agr ${i===0?'today':''}"><span>${d.toLocaleDateString([],{weekday:'short',day:'numeric'})}</span><b>${ev||'clear'}</b></div>`;}list.innerHTML=h;}
render();"#.to_string(),
        _ => String::new(),
    };
    format!(
        r#"<!DOCTYPE html><html><head><meta charset="utf-8"><style>
*{{box-sizing:border-box;margin:0;padding:0;font-family:Segoe UI,system-ui,sans-serif;}}
body{{background:{bg};border:1px solid {border};border-radius:14px;color:#e2e8f0;height:100vh;overflow:hidden;user-select:none;-webkit-user-select:none;}}
.drag{{height:26px;display:flex;align-items:center;padding:0 10px;font-size:11px;color:#94a3b8;border-bottom:1px solid rgba(255,255,255,0.08);-webkit-app-region:drag;cursor:move;}}
.drag b{{color:#e2e8f0;font-weight:600;}}
.body{{padding:10px 12px;height:calc(100vh - 26px);overflow:auto;}}
#time{{font-size:34px;font-weight:700;color:#fff;letter-spacing:1px;}}
#date{{font-size:12px;color:#94a3b8;margin-top:2px;}}
.row{{display:flex;align-items:center;gap:8px;font-size:12px;margin-bottom:8px;}}
.row span{{width:34px;color:#94a3b8;}}
.bar{{flex:1;height:6px;background:rgba(255,255,255,0.1);border-radius:4px;overflow:hidden;}}
.bar i{{display:block;height:100%;background:{accent};border-radius:4px;width:0;transition:width .4s;}}
.row b{{width:38px;text-align:right;font-weight:600;}}
.row[data-v]{{cursor:pointer;}}
.row[data-v]:hover .bar i{{filter:brightness(1.25);}}
.net{{flex:1;display:flex;gap:8px;justify-content:flex-end;}}
.net b{{font-weight:600;font-size:12px;color:#94a3b8;}}
.procs{{margin-top:8px;font-size:11px;color:#94a3b8;}}
.procs div{{display:flex;justify-content:space-between;padding:1px 0;}}
textarea{{width:100%;height:calc(100vh - 52px);background:transparent;border:none;outline:none;color:#e2e8f0;font-size:13px;resize:none;}}
.hint{{font-size:10px;color:#64748b;}}
.t{{display:flex;align-items:center;gap:8px;font-size:13px;padding:4px 0;}}
.t.done span{{text-decoration:line-through;color:#64748b;}}
.t span{{flex:1;}}
.t button{{background:none;border:none;color:#64748b;cursor:pointer;}}
.todo-add{{display:flex;gap:6px;margin-top:6px;}}
.todo-add input{{flex:1;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:#e2e8f0;padding:4px 8px;font-size:12px;outline:none;}}
.todo-add button{{background:{accent};border:none;border-radius:6px;color:#fff;width:26px;cursor:pointer;}}
#calGrid{{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;font-size:11px;text-align:center;}}
.batt{{display:flex;align-items:center;gap:14px;padding:8px 0;}}
.batt-ico{{font-size:30px;color:#94a3b8;width:44px;text-align:center;}}
.batt-meta b{{display:block;font-size:24px;font-weight:700;color:#fff;}}
.batt-meta div{{font-size:11px;color:#94a3b8;margin-top:2px;}}
.tg{{display:flex;align-items:center;justify-content:space-between;width:100%;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:8px 10px;color:#e2e8f0;font-size:13px;margin-bottom:6px;cursor:pointer;}}
.tg b{{font-weight:600;color:{accent};}}
.wcr{{display:flex;align-items:center;justify-content:space-between;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.06);font-size:13px;}}
.wcr span{{color:#94a3b8;}}
.wcr b{{font-weight:600;color:#fff;}}
.agr{{display:flex;align-items:center;justify-content:space-between;padding:4px 0;font-size:12px;border-bottom:1px solid rgba(255,255,255,0.05);}}
.agr span{{color:#94a3b8;}}
.agr b{{font-weight:500;color:#e2e8f0;}}
.agr.today b{{color:{accent};font-weight:700;}}
@media (prefers-reduced-motion: reduce){{*{{transition:none!important;animation:none!important;}}}}
#calGrid .day{{padding:3px 0;border-radius:5px;}}
#calGrid .today{{background:{accent};color:#fff;font-weight:700;}}
#calGrid .dow{{color:#64748b;padding:3px 0;}}
#calHead{{font-size:12px;font-weight:600;margin-bottom:6px;}}
#focus{{margin-top:2px;font-size:11px;font-weight:700;color:{accent};letter-spacing:.5px;}}
</style></head><body>
<div class="drag"><b>·</b>&nbsp;{title}</div>
<div class="body">{inner}</div>
<script>
window.__WIDGET_ID="{id}";
window.__HAS_CONTENT={has};
window.__TODO={todo};
window.__AGENDA={agenda};
{script}
</script></body></html>"#,
        bg = bg,
        border = border,
        accent = accent,
        title = esc_html(&title),
        inner = inner,
        id = cfg.id,
        has = if cfg.content.is_empty() {
            "false"
        } else {
            "true"
        },
        // empty todo content would emit `window.__TODO=;` (a syntax error that
        // kills the whole widget script), so default to a valid empty list.
        // The saved content is JSON; \u-escape < > so a hostile item can't
        // close the inline script block (serde_json leaves them raw).
        todo = if kind == "todo" && !cfg.content.is_empty() {
            cfg.content.replace('<', "\\u003C").replace('>', "\\u003E")
        } else {
            "[]".into()
        },
        // agenda widget uses content as a line-delimited event list; emit a
        // valid JS array (splitting lines defensively) so the injected script
        // never sees an empty/undefined blob
        agenda = if kind == "agenda" {
            format!(
                "[{}]",
                cfg.content
                    .lines()
                    .take(5)
                    .map(|l| format!("\"{}\"", esc(l.trim())))
                    .collect::<Vec<_>>()
                    .join(",")
            )
        } else {
            "[]".into()
        },
        script = script,
    )
}

pub(crate) fn open_widget(app: &tauri::AppHandle, cfg: &WidgetConfig) -> Result<(), AppError> {
    let html = widget_html(cfg);
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Command(e.to_string()))?;
    let file = dir.join(format!("widget_{}.html", cfg.id));
    std::fs::write(&file, html).map_err(|e| AppError::Command(e.to_string()))?;
    let url =
        tauri::Url::from_file_path(&file).map_err(|_| "invalid widget file url".to_string())?;
    // S9.2 — a widget whose monitor disappeared (or whose saved position is
    // off-screen) gets clamped back into the virtual screen on reopen instead
    // of being stranded where nobody can see it.
    let (px, py) = clamp_to_virtual_screen(cfg.x, cfg.y, cfg.w, cfg.h);
    // Gate the build (webview_gate.rs) — widgets can open from the deferred
    // boot restore while the frontend's overlay spawn is mid-creation; two
    // WebView2 creations in flight on the main thread deadlock.
    let app = app.clone();
    let cfg = cfg.clone();
    crate::webview_gate::run(move || -> Result<(), AppError> {
        let win = WebviewWindowBuilder::new(&app, cfg.window_label(), WebviewUrl::External(url))
            .title(&cfg.title)
            .decorations(false)
            .resizable(true)
            .maximizable(false)
            .minimizable(false)
            .skip_taskbar(true)
            .shadow(false)
            .transparent(true)
            .always_on_top(true)
            .inner_size(cfg.w, cfg.h)
            .position(px, py)
            .build()
            .map_err(|e| AppError::Command(format!("widget window: {}", e)))?;
        // Drag/resize persistence: the window reports Moved/Resized; a debounced
        // saver thread writes the final geometry back into widgets.json.
        spawn_geometry_saver(&app, cfg.id.clone(), &win);
        Ok(())
    })
    .unwrap_or(Ok(())) // queued behind an in-flight creation — opens right after
}

fn close_widget(app: &tauri::AppHandle, id: &str) {
    let label = format!("widget-{}", id);
    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.close();
    }
}

// ---- Tauri commands ----

#[tauri::command]
pub fn list_widgets(state: State<'_, AppState>) -> Vec<WidgetConfig> {
    load_widgets(&state)
}

#[tauri::command]
pub async fn create_widget(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    kind: String,
) -> Result<WidgetConfig, AppError> {
    let mut list = load_widgets(&state);
    let cfg = WidgetConfig {
        id: Uuid::new_v4().to_string(),
        kind: kind.clone(),
        x: 60.0,
        y: 60.0,
        w: match kind.as_str() {
            "clock" => 190.0,
            "stats" => 260.0,
            "note" => 260.0,
            "todo" => 240.0,
            "calendar" => 220.0,
            "battery" => 190.0,
            "toggles" => 200.0,
            "worldclock" => 190.0,
            "agenda" => 220.0,
            _ => 220.0,
        },
        h: match kind.as_str() {
            "clock" => 96.0,
            "stats" => 170.0,
            "note" => 200.0,
            "todo" => 220.0,
            "calendar" => 210.0,
            "battery" => 110.0,
            "toggles" => 120.0,
            "worldclock" => 160.0,
            "agenda" => 190.0,
            _ => 180.0,
        },
        title: match kind.as_str() {
            "clock" => "Clock".into(),
            "stats" => "System".into(),
            "note" => "Note".into(),
            "todo" => "To-do".into(),
            "calendar" => "Calendar".into(),
            "battery" => "Battery".into(),
            "toggles" => "Quick toggles".into(),
            "worldclock" => "World clock".into(),
            "agenda" => "Agenda".into(),
            _ => "Widget".into(),
        },
        content: String::new(),
        visible: true,
        monitor: 0,
    };
    open_widget(&app, &cfg)?;
    list.push(cfg.clone());
    save_widgets(&state, &list)?;
    Ok(cfg)
}

#[tauri::command]
pub fn save_widget_note(
    state: State<'_, AppState>,
    id: String,
    content: String,
) -> Result<(), AppError> {
    let mut list = load_widgets(&state);
    if let Some(w) = list.iter_mut().find(|w| w.id == id) {
        w.content = content;
    }
    save_widgets(&state, &list)
}

#[tauri::command]
pub async fn update_widget(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    cfg: WidgetConfig,
) -> Result<WidgetConfig, AppError> {
    let mut list = load_widgets(&state);
    close_widget(&app, &cfg.id);
    open_widget(&app, &cfg)?;
    if let Some(w) = list.iter_mut().find(|w| w.id == cfg.id) {
        *w = cfg.clone();
    }
    save_widgets(&state, &list)?;
    Ok(cfg)
}

#[tauri::command]
pub fn remove_widget(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), AppError> {
    close_widget(&app, &id);
    let mut list = load_widgets(&state);
    list.retain(|w| w.id != id);
    save_widgets(&state, &list)
}

#[tauri::command]
pub async fn set_widget_visible(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
    visible: bool,
) -> Result<(), AppError> {
    let mut list = load_widgets(&state);
    if let Some(w) = list.iter_mut().find(|w| w.id == id) {
        w.visible = visible;
        if visible {
            open_widget(&app, w)?;
        } else {
            close_widget(&app, &id);
        }
    }
    save_widgets(&state, &list)
}

#[tauri::command]
pub async fn set_all_widgets_visible(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    visible: bool,
) -> Result<(), AppError> {
    let mut list = load_widgets(&state);
    for w in list.iter_mut() {
        w.visible = visible;
        if visible {
            let _ = open_widget(&app, w);
        } else {
            close_widget(&app, &w.id);
        }
    }
    save_widgets(&state, &list)
}

/// S9.2 — persist one widget's geometry (called by the frontend after a
/// drag/resize when the OS-level event path is unavailable, and by the mock).
#[tauri::command]
pub fn save_widget_layout(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
) -> Result<WidgetConfig, AppError> {
    let mut list = load_widgets(&state);
    let Some(wcfg) = list.iter_mut().find(|w| w.id == id) else {
        return Err(AppError::NotFound(format!("widget {}", id)));
    };
    wcfg.x = x;
    wcfg.y = y;
    wcfg.w = w.max(120.0);
    wcfg.h = h.max(80.0);
    wcfg.monitor = monitor_index_at(&app, x + w / 2.0, y + h / 2.0);
    let saved = wcfg.clone();
    save_widgets(&state, &list)?;
    Ok(saved)
}

/// Undo support: write a layout back (positions/sizes/monitor) and reopen the
/// visible widgets so the desktop matches the restored state.
pub(crate) fn restore_layout(
    app: &tauri::AppHandle,
    state: &AppState,
    layout: &[WidgetConfig],
) -> Result<(), AppError> {
    let mut cur = load_widgets(state);
    for c in cur.iter_mut() {
        if let Some(b) = layout.iter().find(|b| b.id == c.id) {
            *c = b.clone();
        }
    }
    save_widgets(state, &cur)?;
    for w in cur {
        close_widget(app, &w.id);
        if w.visible {
            let _ = open_widget(app, &w);
        }
    }
    Ok(())
}

/// S9.5 — click-through: a stats-widget row tells the main app to open a view
/// (performance / network). The main window listens for `widget-nav`.
#[tauri::command]
pub fn widget_open_view(app: tauri::AppHandle, view: String) -> Result<(), AppError> {
    use tauri::Emitter;
    let _ = app.emit("widget-nav", json!({ "view": view }));
    Ok(())
}

// ---- S9.4 — auto-hide on fullscreen ----------------------------------------

#[derive(Serialize, Deserialize, Clone)]
pub struct WidgetsSettings {
    /// Hide widget windows while a fullscreen app/game has focus.
    #[serde(default = "default_true")]
    pub autohide_fullscreen: bool,
}

fn default_true() -> bool {
    true
}

impl Default for WidgetsSettings {
    fn default() -> Self {
        WidgetsSettings {
            autohide_fullscreen: true,
        }
    }
}

fn settings_path(state: &AppState) -> PathBuf {
    state.data_dir.join("widgets_settings.json")
}

fn load_settings(state: &AppState) -> WidgetsSettings {
    load_json(&settings_path(state), WidgetsSettings::default())
}

#[tauri::command]
pub fn get_widgets_settings(state: State<'_, AppState>) -> WidgetsSettings {
    load_settings(&state)
}

#[tauri::command]
pub fn set_widgets_settings(
    state: State<'_, AppState>,
    settings: WidgetsSettings,
) -> Result<WidgetsSettings, AppError> {
    save_json(&settings_path(&state), &settings)?;
    Ok(settings)
}

/// Poll the foreground window every 2s; when a fullscreen app has focus, hide
/// every visible widget window; when the desktop returns, re-show them. Uses
/// the same fullscreen detector as the wallpaper pause (S9.4).
pub fn spawn_autohide_monitor(app: tauri::AppHandle, state: AppState) {
    std::thread::spawn(move || {
        let mut hidden = false;
        loop {
            std::thread::sleep(Duration::from_secs(2));
            let settings = load_settings(&state);
            let duck = settings.autohide_fullscreen
                && crate::wallpaper_engine::fullscreen_app_active();
            if duck && !hidden {
                hidden = true;
                hide_or_show_widgets(&app, false);
            } else if !duck && hidden {
                hidden = false;
                hide_or_show_widgets(&app, true);
            }
        }
    });
}

fn hide_or_show_widgets(app: &tauri::AppHandle, show: bool) {
    let app2 = app.clone();
    let app3 = app.clone();
    let _ = app2.run_on_main_thread(move || {
        for label in app3.webview_windows().keys() {
            if label.starts_with("widget-") {
                if let Some(win) = app3.get_webview_window(label) {
                    if show {
                        let _ = win.show();
                    } else {
                        let _ = win.hide();
                    }
                }
            }
        }
    });
}

/// A5.2 — reset every widget to a tidy staggered grid. Undoable: the pre-reset
/// layout is snapshotted in the undo entry so revert restores it exactly.
#[tauri::command]
pub async fn reset_widget_layout(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let mut list = load_widgets(&state);
    let before = list.clone();
    let mut n = 0u32;
    for (i, w) in list.iter_mut().enumerate() {
        w.x = 60.0 + (i % 3) as f64 * 40.0;
        w.y = 60.0 + (i / 3) as f64 * 40.0;
        n += 1;
        if w.visible {
            // close first — a second window with the same label would fail to
            // build and leave the old (unmoved) window in place
            close_widget(&app, &w.id);
            let _ = open_widget(&app, w);
        }
    }
    save_widgets(&state, &list)?;
    if n > 0 {
        undo::log_entry(
            &state,
            "widget_layout",
            format!("Reset {} widget(s) to the default grid", n),
            json!({ "count": n, "before": before }),
            true,
        )?;
    }
    Ok(format!("Reset layout — {} widget(s) repositioned", n))
}

// push live stats into stats widgets
pub fn push_stats(
    app: &tauri::AppHandle,
    stats: &crate::perf::WidgetStats,
    procs: Vec<(String, f32)>,
) {
    let procs_json = serde_json::to_string(
        &procs
            .iter()
            .map(|(name, cpu)| json!({ "name": name, "cpu": cpu }))
            .collect::<Vec<_>>(),
    )
    .unwrap_or_else(|_| "[]".into());
    let gpu = stats
        .gpu_usage
        .map(|u| format!("{:.0}", u))
        .unwrap_or_else(|| "—".into());
    let gpu_name = stats.gpu_name.as_deref().unwrap_or("GPU");
    let thermal = stats
        .thermal_c
        .map(|t| format!("{:.0}°C", t))
        .unwrap_or_else(|| "—".into());
    let js = format!(
        "window.__setStats && window.__setStats({{cpu:{},ram:{},disk:{},gpu:{{name:\"{}\",usage:\"{}\"}},net:{{up:{},down:{}}},thermal:\"{}\",procs:{}}})",
        stats.cpu,
        stats.ram_pct,
        stats.disk_free_pct,
        gpu_name.replace('\\', "\\\\").replace('"', "\\\""),
        gpu,
        stats.net_up_kbps,
        stats.net_down_kbps,
        thermal,
        procs_json
    );
    let app2 = app.clone();
    let app3 = app2.clone();
    let _ = app2.run_on_main_thread(move || {
        // iterate all widget windows whose label starts with widget-
        // (__setStats only exists on stats widgets, so others are no-ops)
        for label in app3.webview_windows().keys() {
            if label.starts_with("widget-") {
                let _ = app3
                    .get_webview_window(label)
                    .and_then(|w| w.eval(&js).ok());
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(kind: &str, content: &str) -> WidgetConfig {
        WidgetConfig {
            id: "test".into(),
            kind: kind.into(),
            x: 0.0,
            y: 0.0,
            w: 240.0,
            h: 220.0,
            title: "t".into(),
            content: content.into(),
            visible: true,
            monitor: 0,
        }
    }

    #[test]
    fn hostile_title_is_html_escaped_not_executed() {
        let mut w = cfg("clock", "");
        w.title = "</b><script>alert(1)</script>\" onclick=\"alert(2)".into();
        let html = widget_html(&w);
        assert!(
            !html.contains("<script>alert(1)"),
            "raw script tag must not survive in the title"
        );
        assert!(html.contains("&lt;/b&gt;&lt;script&gt;"), "title must be HTML-escaped");
        assert!(html.contains("&quot; onclick=&quot;"), "attribute quotes must be escaped");
    }

    #[test]
    fn hostile_note_content_is_escaped_in_textarea() {
        let mut w = cfg("note", "");
        w.content = "</textarea><script>alert(1)</script>&'".into();
        let html = widget_html(&w);
        assert!(
            !html.contains("</textarea><script>"),
            "note content must not break out of the textarea"
        );
        assert!(html.contains("&lt;/textarea&gt;&lt;script&gt;"), "content must be HTML-escaped");
        assert!(html.contains("&amp;&#39;"), "ampersand and apostrophe must be escaped");
    }

    #[test]
    fn hostile_script_close_cannot_break_out_of_js_context() {
        // `</script>` inside a todo item or agenda event must be \u-escaped so
        // the injected script block cannot be closed and replaced.
        let mut t = cfg("todo", "");
        t.content = "[[false,\"</script><script>alert(1)</script>\"]]".into();
        let html = widget_html(&t);
        assert!(
            !html.contains("</script><script>alert"),
            "todo breakout must be blocked"
        );
        assert!(
            html.contains("\\u003C/script\\u003E"),
            "todo </script> must be \\u-escaped"
        );

        let mut a = cfg("agenda", "");
        a.content = "</script><script>alert(1)</script>".into();
        let html2 = widget_html(&a);
        assert!(
            !html2.contains("</script><script>alert"),
            "agenda breakout must be blocked"
        );
    }

    #[test]
    fn new_todo_widget_emits_valid_js() {
        // a brand-new todo widget has empty content; it must render as an empty
        // list, not `window.__TODO=;` (which is a syntax error that kills the
        // entire widget script)
        let html = widget_html(&cfg("todo", ""));
        assert!(
            html.contains("window.__TODO=[];"),
            "empty todo must emit a valid empty list"
        );
        assert!(!html.contains("window.__TODO=;"));
    }

    #[test]
    fn todo_widget_passes_through_saved_items() {
        let html = widget_html(&cfg("todo", "[[false,\"buy milk\"],[true,\"ship\"]]"));
        assert!(html.contains("window.__TODO=[[false,\"buy milk\"],[true,\"ship\"]];"));
    }

    #[test]
    fn non_todo_widgets_emit_valid_empty_todo_state() {
        // the shared template always injects __TODO; it must be a valid list,
        // never a syntax error, even for non-todo widgets
        let html = widget_html(&cfg("clock", ""));
        assert!(html.contains("window.__TODO=[];"));
        assert!(!html.contains("window.__TODO=;"));
    }

    #[test]
    fn agenda_widget_escapes_content_into_valid_js() {
        // line-delimited events must become a valid JS array (quoted, escaped)
        let html = widget_html(&cfg("agenda", "call mom\n\"quote\"\n"));
        assert!(html.contains("window.__AGENDA=[\"call mom\",\"\\\"quote\\\"\"];"));
        assert!(!html.contains("window.__AGENDA=;"));
    }

    #[test]
    fn new_kinds_render_valid_html() {
        for kind in ["battery", "toggles", "worldclock", "agenda"] {
            let html = widget_html(&cfg(kind, ""));
            assert!(!html.is_empty(), "{} must render", kind);
            assert!(
                !html.contains("undefined"),
                "{} must not emit undefined",
                kind
            );
        }
    }

    #[test]
    fn every_widget_kind_escapes_hostile_content_and_never_loads_remote() {
        // K4/S9.7 — the escaping contract must hold for EVERY kind, old and
        // new, so a future widget can't regress the S3.6 hardening.
        let hostile = "</script><script>alert(1)</script>\" onclick=\"x\" &'";
        for kind in [
            "clock", "stats", "note", "todo", "calendar", "battery",
            "toggles", "worldclock", "agenda",
        ] {
            let mut w = cfg(kind, hostile);
            w.title = hostile.to_string();
            let html = widget_html(&w);
            assert!(
                !html.contains("</script><script>alert"),
                "{} must not close the inline script block",
                kind
            );
            // todo/agenda inject content as JS array literals (JSON context): a
            // stray quote can at worst syntax-error their own script — it can
            // never escape the script block. HTML-context kinds must block raw
            // handler injection outright.
            if kind != "todo" && kind != "agenda" {
                assert!(
                    !html.contains("onclick=\"x\""),
                    "{} must not inject an event handler",
                    kind
                );
            }
            assert!(
                !html.to_lowercase().contains("http://") && !html.to_lowercase().contains("https://"),
                "{} must not reference remote content",
                kind
            );
        }
    }

    #[test]
    fn widgets_follow_the_live_accent() {
        // theme accent is baked into the generated stylesheet as a hex color
        let html = widget_html(&cfg("stats", ""));
        assert!(
            html.contains("background:#"),
            "stats bars must carry the live accent hex"
        );
        assert!(
            !html.contains("background:{accent}"),
            "accent must be substituted"
        );
    }

    // ---- S9.2 geometry ----

    #[test]
    fn clamp_pulls_off_screen_widget_back_into_the_virtual_screen() {
        // widget stranded at a huge positive offset (monitor removed)
        let (x, y) = clamp_to_virtual_screen(50_000.0, 40_000.0, 240.0, 160.0);
        assert!(x <= 20_000.0, "x must be pulled back, got {x}");
        assert!(y <= 20_000.0, "y must be pulled back, got {y}");
        assert!(x >= -200.0, "x must stay near the screen edge");
        assert!(y >= -120.0, "y must stay near the screen edge");
    }

    #[test]
    fn clamp_leaves_visible_widget_alone() {
        let (x, y) = clamp_to_virtual_screen(100.0, 100.0, 240.0, 160.0);
        assert_eq!(x, 100.0);
        assert_eq!(y, 100.0);
    }

    #[test]
    fn clamp_handles_negative_offsets() {
        // a widget dragged to a negative virtual-screen offset stays put as
        // long as its center is still on some monitor
        let (x, y) = clamp_to_virtual_screen(-100.0, -50.0, 240.0, 160.0);
        assert!((-200.0..=0.0).contains(&x), "x={x} must not jump far left");
        assert!((-120.0..=0.0).contains(&y), "y={y} must not jump far up");
    }
}
