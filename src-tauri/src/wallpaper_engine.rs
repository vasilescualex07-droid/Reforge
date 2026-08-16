use crate::error::AppError;
use crate::state::AppState;
use crate::storage::{load_json, save_json};
use crate::undo;
use crate::wallpaper;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::PathBuf;
use tauri::{Manager, State, WebviewUrl, WebviewWindowBuilder};
use windows::core::PCWSTR;
use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
use windows::Win32::UI::WindowsAndMessaging::{
    FindWindowExW, FindWindowW, SendMessageTimeoutW, SetParent, SetWindowPos, HWND_BOTTOM,
    SMTO_NORMAL, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER, SWP_NOSENDCHANGING, SWP_NOSIZE,
};

pub const WALLPAPER_WINDOW_LABEL: &str = "reforge-wallpaper";

// ---------------------------------------------------------------------------
// Scene definitions
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone)]
pub struct SceneConfig {
    pub id: String,
    pub name: String,
    pub kind: String, // particles | waves | geometric | parallax | aurora | stars | matrix | embers
    pub mood: String, // calm | energetic | nature | space | seasonal | fun
    pub speed: f64,   // 0.2 .. 3.0
    pub density: f64, // 0.2 .. 2.0
    pub colors: Vec<String>,
}

pub fn default_scene() -> SceneConfig {
    SceneConfig {
        id: "aurora-drift".into(),
        name: "Aurora Drift".into(),
        kind: "aurora".into(),
        mood: "calm".into(),
        speed: 1.0,
        density: 1.0,
        colors: vec!["#38bdf8".into(), "#818cf8".into(), "#c084fc".into()],
    }
}

pub fn builtin_scenes() -> Vec<SceneConfig> {
    let mut v = Vec::new();
    macro_rules! scene {
        ($id:expr, $name:expr, $kind:expr, $mood:expr, $speed:expr, $density:expr, [$($c:expr),*]) => {
            v.push(SceneConfig {
                id: $id.into(), name: $name.into(), kind: $kind.into(), mood: $mood.into(),
                speed: $speed, density: $density,
                colors: vec![$($c.into()),*],
            });
        };
    }
    // calm
    scene!(
        "aurora-drift",
        "Aurora Drift",
        "aurora",
        "calm",
        0.6,
        1.0,
        ["#38bdf8", "#818cf8", "#c084fc"]
    );
    scene!(
        "deep-tide",
        "Deep Tide",
        "waves",
        "calm",
        0.7,
        1.0,
        ["#0ea5e9", "#1d4ed8", "#0f172a"]
    );
    scene!(
        "moonlit-dunes",
        "Moonlit Dunes",
        "particles",
        "calm",
        0.5,
        0.7,
        ["#fde68a", "#f8fafc", "#64748b"]
    );
    scene!(
        "misty-forest",
        "Misty Forest",
        "parallax",
        "calm",
        0.5,
        1.0,
        ["#10b981", "#065f46", "#022c22"]
    );
    // energetic
    scene!(
        "neon-surge",
        "Neon Surge",
        "particles",
        "energetic",
        1.6,
        1.5,
        ["#f0abfc", "#22d3ee", "#a78bfa"]
    );
    scene!(
        "synth-grid",
        "Synth Grid",
        "geometric",
        "energetic",
        1.3,
        1.2,
        ["#f472b6", "#818cf8", "#0f172a"]
    );
    scene!(
        "ember-storm",
        "Ember Storm",
        "embers",
        "energetic",
        1.4,
        1.3,
        ["#fb923c", "#ef4444", "#facc15"]
    );
    scene!(
        "retro-sunset",
        "Retro Sunset",
        "geometric",
        "energetic",
        0.9,
        1.1,
        ["#ff2e88", "#7b2ff7", "#fbbf24"]
    );
    // nature
    scene!(
        "meadow-breeze",
        "Meadow Breeze",
        "particles",
        "nature",
        0.6,
        0.8,
        ["#a3e635", "#84cc16", "#166534"]
    );
    scene!(
        "coral-reef",
        "Coral Reef",
        "waves",
        "nature",
        0.8,
        1.1,
        ["#2dd4bf", "#f472b6", "#0ea5e9"]
    );
    scene!(
        "autumn-leaves",
        "Autumn Drift",
        "parallax",
        "nature",
        0.7,
        1.2,
        ["#f59e0b", "#ea580c", "#78350f"]
    );
    scene!(
        "river-glow",
        "River Glow",
        "embers",
        "nature",
        0.6,
        0.9,
        ["#34d399", "#059669", "#1e293b"]
    );
    // space
    scene!(
        "stardust",
        "Stardust",
        "stars",
        "space",
        0.5,
        1.0,
        ["#e2e8f0", "#818cf8", "#fbbf24"]
    );
    scene!(
        "nebula-bloom",
        "Nebula Bloom",
        "aurora",
        "space",
        0.7,
        1.2,
        ["#c084fc", "#6366f1", "#f472b6"]
    );
    scene!(
        "orbital",
        "Orbital",
        "geometric",
        "space",
        0.8,
        0.9,
        ["#38bdf8", "#e2e8f0", "#111827"]
    );
    scene!(
        "comet-trail",
        "Comet Trail",
        "stars",
        "space",
        1.0,
        1.1,
        ["#f8fafc", "#60a5fa", "#f472b6"]
    );
    // seasonal
    scene!(
        "winter-snow",
        "Winter Snowfall",
        "particles",
        "seasonal",
        0.7,
        1.4,
        ["#f8fafc", "#bae6fd", "#0f172a"]
    );
    scene!(
        "spring-blossom",
        "Spring Blossom",
        "parallax",
        "seasonal",
        0.6,
        1.1,
        ["#f9a8d4", "#fda4af", "#0f172a"]
    );
    scene!(
        "holiday-lights",
        "Holiday Lights",
        "stars",
        "seasonal",
        0.8,
        1.2,
        ["#fbbf24", "#34d399", "#ef4444"]
    );
    scene!(
        "cherry-fall",
        "Cherry Petals",
        "particles",
        "seasonal",
        0.7,
        1.0,
        ["#f9a8d4", "#f472b6", "#1e293b"]
    );
    // A6.1 — new kinds: rain, fireflies, snowfall-wind, bokeh, smoke, waves-3d
    scene!(
        "midnight-rain",
        "Midnight Rain",
        "rain",
        "calm",
        0.8,
        1.2,
        ["#60a5fa", "#38bdf8", "#0f172a"]
    );
    scene!(
        "firefly-grove",
        "Firefly Grove",
        "fireflies",
        "nature",
        0.5,
        0.9,
        ["#fde047", "#a3e635", "#1e293b"]
    );
    scene!(
        "blizzard-drift",
        "Blizzard Drift",
        "snowfall-wind",
        "seasonal",
        1.1,
        1.3,
        ["#f8fafc", "#e0f2fe", "#1e3a8a"]
    );
    scene!(
        "bokeh-aurora",
        "Bokeh Bloom",
        "bokeh",
        "space",
        0.4,
        0.8,
        ["#c084fc", "#f472b6", "#38bdf8"]
    );
    scene!(
        "smoke-ember",
        "Smoke & Ember",
        "smoke",
        "energetic",
        0.9,
        0.9,
        ["#fb923c", "#ef4444", "#facc15"]
    );
    scene!(
        "ocean-depth",
        "Ocean Depth",
        "waves-3d",
        "nature",
        0.8,
        1.0,
        ["#0ea5e9", "#06b6d4", "#0f172a"]
    );
    // S5 — catalog expansion: 26 → 48. Includes the matrix kind (previously
    // supported by the renderer but never used) plus fresh color stories across
    // the existing kinds. Mock SCENES + KNOWN_SCENE_IDS mirror these exactly.
    scene!(
        "digital-rain",
        "Digital Rain",
        "matrix",
        "energetic",
        1.2,
        1.5,
        ["#22c55e", "#4ade80", "#052e16"]
    );
    scene!(
        "cipher-fall",
        "Cipher Fall",
        "matrix",
        "focused",
        0.9,
        1.3,
        ["#22d3ee", "#e2e8f0", "#0f172a"]
    );
    scene!(
        "amber-rain",
        "Amber Rain",
        "rain",
        "cozy",
        0.7,
        1.0,
        ["#f59e0b", "#fbbf24", "#1c1917"]
    );
    scene!(
        "violet-rain",
        "Violet Rain",
        "rain",
        "calm",
        0.6,
        1.1,
        ["#a78bfa", "#c4b5fd", "#1e1b4b"]
    );
    scene!(
        "ember-fireflies",
        "Ember Fireflies",
        "fireflies",
        "cozy",
        0.5,
        0.9,
        ["#fb923c", "#fde047", "#1c1917"]
    );
    scene!(
        "glacier-drift",
        "Glacier Drift",
        "snowfall-wind",
        "calm",
        0.9,
        1.2,
        ["#bae6fd", "#e0f2fe", "#0c4a6e"]
    );
    scene!(
        "aurora-snow",
        "Aurora Snow",
        "snowfall-wind",
        "playful",
        0.8,
        1.1,
        ["#c4b5fd", "#f8fafc", "#312e81"]
    );
    scene!(
        "bokeh-city",
        "Bokeh City",
        "bokeh",
        "energetic",
        0.6,
        1.1,
        ["#f472b6", "#22d3ee", "#0f172a"]
    );
    scene!(
        "incense-smoke",
        "Incense Smoke",
        "smoke",
        "calm",
        0.4,
        0.8,
        ["#d6d3d1", "#fbbf24", "#292524"]
    );
    scene!(
        "crimson-tide",
        "Crimson Tide",
        "waves-3d",
        "energetic",
        1.1,
        1.2,
        ["#ef4444", "#f97316", "#450a0a"]
    );
    scene!(
        "aurora-boreal",
        "Aurora Boreal",
        "aurora",
        "calm",
        0.7,
        1.1,
        ["#34d399", "#818cf8", "#0f172a"]
    );
    scene!(
        "starlight-sea",
        "Starlight Sea",
        "waves",
        "calm",
        0.6,
        0.9,
        ["#1d4ed8", "#60a5fa", "#fbbf24"]
    );
    scene!(
        "hologram-grid",
        "Hologram Grid",
        "geometric",
        "energetic",
        1.2,
        1.1,
        ["#22d3ee", "#e879f9", "#0f172a"]
    );
    scene!(
        "pine-snow",
        "Pine Snow",
        "parallax",
        "calm",
        0.6,
        1.0,
        ["#4ade80", "#e2e8f0", "#022c22"]
    );
    scene!(
        "cloud-veil",
        "Cloud Veil",
        "parallax",
        "calm",
        0.5,
        0.9,
        ["#cbd5e1", "#f8fafc", "#1e293b"]
    );
    scene!(
        "gold-dust",
        "Gold Dust",
        "particles",
        "playful",
        0.8,
        1.0,
        ["#fbbf24", "#fde68a", "#1c1917"]
    );
    scene!(
        "cosmic-dust",
        "Cosmic Dust",
        "particles",
        "calm",
        0.5,
        0.9,
        ["#e2e8f0", "#818cf8", "#fbbf24"]
    );
    scene!(
        "rose-mist",
        "Rose Mist",
        "particles",
        "playful",
        0.6,
        0.9,
        ["#fda4af", "#f9a8d4", "#1e293b"]
    );
    scene!(
        "ember-wind",
        "Ember Wind",
        "embers",
        "energetic",
        1.2,
        1.1,
        ["#f97316", "#ef4444", "#1c1917"]
    );
    scene!(
        "forge-glow",
        "Forge Glow",
        "embers",
        "cozy",
        0.6,
        0.8,
        ["#fb923c", "#facc15", "#1c1917"]
    );
    scene!(
        "shooting-stars",
        "Shooting Stars",
        "stars",
        "energetic",
        1.1,
        1.2,
        ["#f8fafc", "#60a5fa", "#7c3aed"]
    );
    scene!(
        "polaris",
        "Polaris",
        "stars",
        "calm",
        0.6,
        1.0,
        ["#e2e8f0", "#93c5fd", "#1e1b4b"]
    );
    v
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

fn engine_path(state: &AppState) -> PathBuf {
    state.data_dir.join("wallpaper_engine.json")
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct EngineState {
    pub active: bool,
    pub frozen: bool,
    pub scene: Option<SceneConfig>,
    pub media: Option<VideoWallpaper>,
    pub static_wallpaper: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct VideoWallpaper {
    pub path: String,
    pub kind: String, // "video" | "gif"
    pub width: u32,
    pub height: u32,
    pub name: String,
}

pub(crate) fn load_engine(state: &AppState) -> EngineState {
    load_json(&engine_path(state), EngineState::default())
}

pub(crate) fn save_engine(state: &AppState, e: &EngineState) -> Result<(), AppError> {
    save_json(&engine_path(state), e)
}

// ---------------------------------------------------------------------------
// Scene HTML
// ---------------------------------------------------------------------------

pub fn scene_html(scene: &SceneConfig) -> String {
    // A6.2 — deterministic seed: the scene id hashes to a fixed rng seed, so a
    // saved scene always renders identically across sessions.
    let seed = scene
        .id
        .bytes()
        .fold(2166136261u32, |h, b| (h ^ b as u32).wrapping_mul(16777619));
    let cfg = json!({
        "kind": scene.kind,
        "speed": scene.speed,
        "density": scene.density,
        "colors": scene.colors,
        "seed": seed,
    });
    // Script-context hardening (S3.6): serde_json doesn't escape < >, so a
    // hostile custom scene (kind/colors are free-form from the frontend) could
    // close the inline <script> block. \u003C/\u003E are valid JSON escapes.
    let cfg_json = serde_json::to_string(&cfg)
        .unwrap_or_else(|_| "{}".into())
        .replace('<', "\\u003C")
        .replace('>', "\\u003E");
    format!(
        r#"<!DOCTYPE html><html><head><meta charset="utf-8"><style>
html,body{{margin:0;padding:0;overflow:hidden;background:#0b1026;width:100%;height:100%}}
canvas{{display:block;width:100vw;height:100vh}}
</style></head><body>
<canvas id="c"></canvas>
<script>
const CFG = {};
const c = document.getElementById('c');
const ctx = c.getContext('2d');
let W=0,H=0,DPR=1;
let paused = false;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
window.__setPaused = (p) => {{ paused = !!p; }};
function resize(){{ DPR = Math.min(2, window.devicePixelRatio||1); W = innerWidth; H = innerHeight; c.width = W*DPR; c.height = H*DPR; ctx.setTransform(DPR,0,0,DPR,0,0); }}
addEventListener('resize', resize); resize();
const COL = CFG.colors.map(hex2rgb);
function hex2rgb(h){{ h=h.replace('#',''); if(h.length===3) h=h.split('').map(x=>x+x).join(''); return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)]; }}
function rgba(c,a){{ return `rgba(${{c[0]}},${{c[1]}},${{c[2]}},${{a}})`; }}
function rand(a,b){{ return a + Math.random()*(b-a); }}
// A6.2 — seeded deterministic rng (mulberry32). Every scene with the same id
// and params renders the same picture, every time.
const RNG = (()=>{{ let s = CFG.seed>>>0 || 1; return ()=>{{ s = (s + 0x6D2B79F5)|0; let t = Math.imul(s ^ (s>>>15), 1|s); t = (t + Math.imul(t ^ (t>>>7), 61|t)) ^ t; return ((t ^ (t>>>14))>>>0)/4294967296; }}; }})();
const rnd=(a,b)=>a+RNG()*(b-a);
const S = CFG.speed, D = CFG.density;
let t = 0;
const TAU = Math.PI*2;

// ---- particles ---- (initial layout uses the seeded rnd so every scene with
// the same id + params renders the same picture, every time)
function mkParticles(n){{ const ps=[]; for(let i=0;i<n;i++) ps.push({{x:rnd(0,W),y:rnd(0,H),r:rnd(1,3.2)*D,rx:rnd(-0.4,0.4)*S,ry:rnd(-0.5,0.15)*S,a:rnd(0.25,0.9),c:COL[i%COL.length]}}); return ps; }}
// ---- stars ----
function mkStars(n){{ const st=[]; for(let i=0;i<n;i++) st.push({{x:rnd(0,W),y:rnd(0,H),r:rnd(0.4,1.8),tw:rnd(0.5,2)*S,ph:rnd(0,TAU),vx:rnd(-0.2,0.2)*S,vy:rnd(0.05,0.35)*S,c:COL[i%COL.length]}}); return st; }}
// ---- matrix ----
function mkMatrix(n){{ const cols=[]; const cw=18; for(let x=0;x<W;x+=cw) cols.push({{x,y:rnd(-H,0),sp:rnd(0.35,1.4)*S,len:rnd(8,26)}}); return cols; }}
// ---- embers ----
function mkEmbers(n){{ const es=[]; for(let i=0;i<n;i++) es.push({{x:rnd(0,W),y:rnd(H*0.3,H),r:rnd(1,2.6)*D,vy:rnd(-0.8,-0.25)*S,vx:rnd(-0.25,0.25)*S,ph:rnd(0,TAU),c:COL[i%COL.length]}}); return es; }}
// A6.1 — new kinds
function mkRain(n){{ const rs=[]; for(let i=0;i<n;i++) rs.push({{x:rnd(0,W),y:rnd(-H,H),len:rnd(10,24)*D,sp:rnd(6,13)*S,c:COL[i%COL.length]}}); return rs; }}
function mkFireflies(n){{ const fs=[]; for(let i=0;i<n;i++) fs.push({{x:rnd(0,W),y:rnd(0,H),r:rnd(0.8,2.2)*D,ph:rnd(0,TAU),tw:rnd(0.5,1.6)*S,vx:rnd(-0.15,0.15)*S,vy:rnd(-0.1,0.1)*S,homex:rnd(0,W),homey:rnd(0,H),c:COL[i%COL.length]}}); return fs; }}
function mkSnow(n){{ const ss=[]; for(let i=0;i<n;i++) ss.push({{x:rnd(0,W),y:rnd(-H,0),r:rnd(0.8,2.6)*D,ph:rnd(0,TAU),tw:rnd(0.5,1.5)*S,vy:rnd(0.4,1.1)*S,c:COL[i%COL.length]}}); return ss; }}
function mkBokeh(n){{ const bs=[]; for(let i=0;i<n;i++) bs.push({{x:rnd(0,W),y:rnd(H*0.4,H),r:rnd(18,64)*D,vy:rnd(-0.25,-0.08)*S,vx:rnd(-0.1,0.1)*S,ph:rnd(0,TAU),a:rnd(0.05,0.14),c:COL[i%COL.length]}}); return bs; }}
function mkSmoke(n){{ const ms=[]; for(let i=0;i<n;i++) ms.push({{x:rnd(0,W),y:rnd(H*0.7,H),r:rnd(6,20)*D,vy:rnd(-0.5,-0.15)*S,vx:rnd(-0.2,0.2)*S,ph:rnd(0,TAU),life:rnd(0,1),c:COL[i%COL.length]}}); return ms; }}

let parts = mkParticles(Math.floor(90*D));
let stars = mkStars(Math.floor(220*D));
let mat = mkMatrix(0);
let embers = mkEmbers(Math.floor(70*D));
let rain = mkRain(Math.floor(110*D));
let fireflies = mkFireflies(Math.floor(26*D));
let snow = mkSnow(Math.floor(130*D));
let bokeh = mkBokeh(Math.floor(14*D));
let smoke = mkSmoke(Math.floor(18*D));

function drawParticles(){{
  ctx.clearRect(0,0,W,H);
  for(const p of parts){{
    p.x+=p.rx; p.y+=p.ry;
    if(p.y<-8){{p.y=H+8; p.x=rand(0,W);}}
    if(p.x<-8)p.x=W+8; if(p.x>W+8)p.x=-8;
    ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,TAU);
    ctx.fillStyle=rgba(p.c,p.a); ctx.fill();
  }}
}}
function drawStars(){{
  ctx.clearRect(0,0,W,H);
  for(const s of stars){{
    s.x+=s.vx; s.y+=s.vy;
    if(s.y>H+4){{s.y=-4; s.x=rand(0,W);}}
    if(s.x<-4)s.x=W+4; if(s.x>W+4)s.x=-4;
    const tw=0.5+0.5*Math.sin(t*s.tw+s.ph);
    ctx.beginPath(); ctx.arc(s.x,s.y,s.r,0,TAU);
    ctx.fillStyle=rgba(s.c,0.35+0.65*tw); ctx.fill();
  }}
}}
function drawWaves(){{
  ctx.clearRect(0,0,W,H);
  const layers=3+Math.floor(D*2);
  for(let l=0;l<layers;l++){{
    const col=COL[l%COL.length];
    const amp=H*(0.05+0.03*l), base=H*(0.45+0.22*l), f=0.0016*(l+1)*S, ph=t*(0.02+0.008*l);
    ctx.beginPath(); ctx.moveTo(0,H);
    for(let x=0;x<=W;x+=8){{
      const y=base+Math.sin(x*f+ph)*amp+Math.sin(x*f*1.7+ph*1.3)*amp*0.4;
      ctx.lineTo(x,y);
    }}
    ctx.lineTo(W,H); ctx.closePath();
    ctx.fillStyle=rgba(col,0.28/(l+1)); ctx.fill();
  }}
}}
function drawGeometric(){{
  ctx.clearRect(0,0,W,H);
  const size=Math.max(60,120*D), gap=size*0.5;
  const off=t*0.05*S;
  for(let y=-size;y<H+size;y+=size+gap){{
    for(let x=-size;x<W+size;x+=size+gap){{
      const px=x+Math.sin(t*0.02*S+y*0.01)*gap*0.5;
      const py=y+Math.cos(t*0.02*S+x*0.01)*gap*0.5;
      const rot=t*0.05*S+((x+y)*0.0004);
      ctx.save(); ctx.translate(px+off,py); ctx.rotate(rot);
      const sides=3+((Math.round((x+y)/120)%3+3)%3);
      ctx.beginPath();
      for(let i=0;i<sides;i++){{
        const a=(i/sides)*TAU;
        const px2=Math.cos(a)*size*0.28, py2=Math.sin(a)*size*0.28;
        if(i===0)ctx.moveTo(px2,py2); else ctx.lineTo(px2,py2);
      }}
      ctx.closePath();
      ctx.strokeStyle=rgba(COL[(Math.round(x/120)+Math.round(y/120))%COL.length],0.35);
      ctx.lineWidth=1.5; ctx.stroke();
      ctx.restore();
    }}
  }}
}}
function drawAurora(){{
  const grad=ctx.createLinearGradient(0,0,0,H);
  grad.addColorStop(0,'#050816'); grad.addColorStop(1,'#0b1026');
  ctx.fillStyle=grad; ctx.fillRect(0,0,W,H);
  const blobs=3+Math.floor(D*2);
  for(let b=0;b<blobs;b++){{
    const col=COL[b%COL.length];
    const bx=W*0.2+b*(W*0.3)+Math.sin(t*0.004*S+b*2.1)*W*0.25;
    const by=H*(0.25+0.2*Math.sin(t*0.003*S+b));
    const r=Math.max(W,H)*(0.22+0.1*Math.sin(t*0.002*S+b*1.3));
    const g=ctx.createRadialGradient(bx,by,0,bx,by,r);
    g.addColorStop(0,rgba(col,0.16)); g.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
  }}
  for(let i=0;i<60;i++){{
    const yy=H*(0.1+0.8*Math.random());
    ctx.fillStyle=rgba([226,232,240],0.5);
    ctx.fillRect(Math.random()*W,yy,1,1);
  }}
}}
function drawMatrix(){{
  ctx.fillStyle='rgba(4,8,20,0.22)'; ctx.fillRect(0,0,W,H);
  const chars='アイウエオカキクケコサシスセソタチツテト0123456789ABCDEF';
  for(const col of mat){{
    ctx.font='14px monospace';
    for(let i=0;i<col.len;i++){{
      const yy=col.y-i*16;
      if(yy<0||yy>H) continue;
      ctx.fillStyle=rgba(COL[i%COL.length],0.7-0.5*(i/col.len));
      ctx.fillText(chars[(Math.random()*chars.length)|0],col.x,yy);
    }}
    col.y+=col.sp;
    if(col.y>H+40){{col.y=-40; col.x=rand(0,W);}}
  }}
}}
function drawEmbers(){{
  ctx.fillStyle='#0c0a1d'; ctx.fillRect(0,0,W,H);
  for(const e of embers){{
    e.y+=e.vy; e.x+=e.vx+Math.sin(t*0.01+e.ph)*0.3;
    if(e.y<-10){{e.y=H+10; e.x=rand(0,W);}}
    const tw=0.6+0.4*Math.sin(t*0.02*S+e.ph);
    const g=ctx.createRadialGradient(e.x,e.y,0,e.x,e.y,e.r*3);
    g.addColorStop(0,rgba(e.c,0.8*tw)); g.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=g; ctx.beginPath(); ctx.arc(e.x,e.y,e.r*3,0,TAU); ctx.fill();
  }}
}}
function drawParallax(){{
  const layers=4+Math.floor(D*2);
  for(let l=0;l<layers;l++){{
    const col=COL[l%COL.length];
    const speed=(0.2+l*0.14)*S;
    const n=Math.floor(8+l*6*D);
    for(let i=0;i<n;i++){{
      const seed=(l*100+i)*13.37;
      const px=((seed*7919)%1000)/1000*W;
      const drift=((seed*104729)%2000)/1000;
      const x=px+(drift*W*0.3+Math.sin(t*speed*0.001+seed)*W*0.12)%(W*0.6);
      const size=(6+l*7)*(0.6+((seed*1543)%1000)/1000);
      ctx.beginPath(); ctx.arc(x,((seed*3571)%1000)/1000*H,size,0,TAU);
      ctx.fillStyle=rgba(col,0.16+l*0.05); ctx.fill();
    }}
  }}
}}
function drawRain(){{
  ctx.fillStyle='rgba(5,10,25,0.35)'; ctx.fillRect(0,0,W,H);
  ctx.lineCap='round';
  for(const r of rain){{
    const grad=ctx.createLinearGradient(r.x,r.y,r.x,r.y+r.len);
    grad.addColorStop(0,rgba(r.c,0.15)); grad.addColorStop(1,rgba(r.c,0.85));
    ctx.strokeStyle=grad; ctx.lineWidth=1.2;
    ctx.beginPath(); ctx.moveTo(r.x,r.y); ctx.lineTo(r.x,r.y+r.len); ctx.stroke();
    r.y+=r.sp;
    if(r.y>H+30){{r.y=-30; r.x=rnd(0,W); r.len=rnd(10,24)*D;}}
  }}
}}
function drawFireflies(){{
  ctx.fillStyle='#0a1220'; ctx.fillRect(0,0,W,H);
  for(const f of fireflies){{
    const a=0.25+0.65*(0.5+0.5*Math.sin(t*0.03*f.tw+f.ph));
    f.x+=(f.homex-f.x)*0.002*f.tw+f.vx; f.y+=(f.homey-f.y)*0.002*f.tw+f.vy;
    if(f.x<0)f.x=W; if(f.x>W)f.x=0; if(f.y<0)f.y=H; if(f.y>H)f.y=0;
    const g=ctx.createRadialGradient(f.x,f.y,0,f.x,f.y,f.r*4);
    g.addColorStop(0,rgba(f.c,a)); g.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=g; ctx.beginPath(); ctx.arc(f.x,f.y,f.r*4,0,TAU); ctx.fill();
  }}
}}
function drawSnow(){{
  ctx.clearRect(0,0,W,H);
  for(const s of snow){{
    s.x+=Math.sin(t*0.02*s.tw+s.ph)*0.6*S; s.y+=s.vy;
    if(s.y>H+6){{s.y=-6; s.x=rnd(0,W);}}
    if(s.x<-6)s.x=W+6; if(s.x>W+6)s.x=-6;
    ctx.beginPath(); ctx.arc(s.x,s.y,s.r,0,TAU);
    ctx.fillStyle=rgba(s.c,0.55+0.3*Math.sin(t*0.03*s.tw+s.ph)); ctx.fill();
  }}
}}
function drawBokeh(){{
  ctx.fillStyle='#070a18'; ctx.fillRect(0,0,W,H);
  for(const b of bokeh){{
    b.y+=b.vy; b.x+=b.vx+Math.sin(t*0.005+b.ph)*0.4;
    if(b.y<-80){{b.y=H+80; b.x=rnd(0,W);}}
    const g=ctx.createRadialGradient(b.x,b.y,0,b.x,b.y,b.r);
    g.addColorStop(0,rgba(b.c,b.a)); g.addColorStop(0.6,rgba(b.c,b.a*0.5)); g.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=g; ctx.beginPath(); ctx.arc(b.x,b.y,b.r,0,TAU); ctx.fill();
  }}
}}
function drawSmoke(){{
  ctx.fillStyle='rgba(10,8,16,0.08)'; ctx.fillRect(0,0,W,H);
  for(const m of smoke){{
    m.life+=0.004*S; m.y+=m.vy; m.x+=m.vx+Math.sin(t*0.01+m.ph)*0.3;
    const grow=1+m.life*2;
    if(m.y<-60||m.life>2){{m.y=H+rnd(0,H*0.3); m.x=rnd(0,W); m.life=0; m.r=rnd(6,20)*D;}}
    const g=ctx.createRadialGradient(m.x,m.y,0,m.x,m.y,m.r*grow);
    g.addColorStop(0,rgba(m.c,0.16*(1-m.life/2.2))); g.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=g; ctx.beginPath(); ctx.arc(m.x,m.y,m.r*grow,0,TAU); ctx.fill();
  }}
}}
function drawWaves3d(){{
  ctx.fillStyle='#04070f'; ctx.fillRect(0,0,W,H);
  const layers=5;
  for(let l=layers-1;l>=0;l--){{
    const depth=1-l/layers;
    const amp=H*(0.03+depth*0.09), base=H*(0.35+l*0.14), f=0.0018*(l+1)*S, ph=t*(0.02+0.01*l)+l*1.7;
    const col=COL[l%COL.length];
    ctx.beginPath(); ctx.moveTo(0,H);
    for(let x=-20;x<=W+20;x+=6){{
      const y=base+Math.sin(x*f+ph)*amp*(1+depth)+Math.sin(x*f*1.6+ph*1.4)*amp*0.35;
      ctx.lineTo(x,y);
    }}
    ctx.lineTo(W,H); ctx.closePath();
    ctx.fillStyle=rgba(col,0.1+depth*0.22); ctx.fill();
  }}
}}

// A6.3 — perf discipline: pause when the tab is hidden (wallpaper window is
// occluded by the desktop shell, but the webview may still tick); cap the
// frame rate to ~20fps when the document is hidden to save GPU.
let lastFrame = 0;
const FPS_CAP = 60, HIDDEN_CAP = 20;
document.addEventListener('visibilitychange', ()=>{{ paused = document.hidden; }});
document.addEventListener('webkitvisibilitychange', ()=>{{ paused = document.hidden; }});

function drawScene(){{
  t++;
  switch(CFG.kind){{
    case 'particles': drawParticles(); break;
    case 'waves': drawWaves(); break;
    case 'geometric': drawGeometric(); break;
    case 'parallax': drawParallax(); break;
    case 'aurora': drawAurora(); break;
    case 'stars': drawStars(); break;
    case 'matrix': drawMatrix(); break;
    case 'embers': drawEmbers(); break;
    case 'rain': drawRain(); break;
    case 'fireflies': drawFireflies(); break;
    case 'snowfall-wind': drawSnow(); break;
    case 'bokeh': drawBokeh(); break;
    case 'smoke': drawSmoke(); break;
    case 'waves-3d': drawWaves3d(); break;
  }}
}}
function frame(ts){{
  // S13.2 — Win11 motion spec: with prefers-reduced-motion on, the scene
  // renders exactly one static frame and the rAF loop stops (no GPU burn).
  if(REDUCED){{ drawScene(); return; }}
  if(paused){{
    // frozen/fullscreen/hidden — don't burn GPU; wake up on a slow timer so a
    // resume via __setPaused picks the loop back up within ~half a second
    setTimeout(()=>requestAnimationFrame(frame), 500);
    return;
  }}
  const cap = document.hidden ? HIDDEN_CAP : FPS_CAP;
  if(ts-lastFrame < 1000/cap){{ requestAnimationFrame(frame); return; }}
  lastFrame = ts;
  drawScene();
  requestAnimationFrame(frame);
}}
requestAnimationFrame(frame);
</script></body></html>"#,
        cfg_json
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scene_html_escapes_hostile_config() {
        let mut scene = default_scene();
        scene.kind = "</script><script>alert(1)</script>".into();
        scene.colors = vec!["#fff\"></script><script>alert(2)</script>".into()];
        let html = scene_html(&scene);
        assert!(
            !html.contains("</script><script>alert"),
            "scene config must not close the inline script block"
        );
        assert!(
            html.contains("\\u003C/script\\u003E"),
            "kind must be \\u-escaped in the embedded JSON"
        );
    }

    #[test]
    fn scene_html_embeds_config_json() {
        let html = scene_html(&default_scene());
        assert!(html.contains("\"kind\":\"aurora\""), "config JSON must be embedded");
        assert!(html.contains("<canvas id=\"c\"></canvas>"));
    }

    // ---- S13.2: reduced-motion freezes the scene ----

    #[test]
    fn scene_html_freezes_under_reduced_motion() {
        let html = scene_html(&default_scene());
        assert!(
            html.contains("const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;"),
            "the scene must read the OS reduced-motion setting"
        );
        assert!(
            html.contains("if(REDUCED){ drawScene(); return; }"),
            "reduced motion renders one static frame and stops the rAF loop"
        );
    }

    // ---- E4.7: animated transitions ----

    #[test]
    fn transition_html_has_two_stacked_canvases() {
        let to = default_scene();
        let mut from = default_scene();
        from.id = "from-scene".into();
        from.kind = "matrix".into();
        let html = scene_html_transition(&from, &to);
        assert!(html.contains("<canvas id=\"c0\">"), "old scene on c0");
        assert!(html.contains("<canvas id=\"c1\" style=\"opacity:0\">"), "new scene fades in on c1");
        assert!(html.contains("getElementById('c0')"), "old scene script targets c0");
        assert!(html.contains("getElementById('c1')"), "new scene script targets c1");
        assert!(html.contains("\"kind\":\"matrix\""), "old scene cfg embedded");
        assert!(html.contains("\"kind\":\"aurora\""), "new scene cfg embedded");
    }

    #[test]
    fn transition_respects_reduced_motion() {
        let html = scene_html_transition(&default_scene(), &default_scene());
        assert!(
            html.contains("prefers-reduced-motion: reduce"),
            "the html must check the OS reduced-motion setting"
        );
        assert!(
            html.contains("if (reduce)"),
            "reduced motion skips the 2s fade (instant swap)"
        );
        assert!(html.contains("2000ms"), "full motion crossfades over 2s");
    }

    #[test]
    fn transition_does_not_escape_hostile_configs() {
        let mut evil = default_scene();
        evil.kind = "</script><script>alert(1)</script>".into();
        let html = scene_html_transition(&evil, &default_scene());
        assert!(
            !html.contains("</script><script>alert"),
            "transition embeds both configs \\u-escaped (S3.6 hardening)"
        );
    }
}

// ---------------------------------------------------------------------------
// Custom scenes (A6.2 — scene editor v2 persistence)
// ---------------------------------------------------------------------------

fn custom_scenes_path(state: &AppState) -> PathBuf {
    state.data_dir.join("custom_scenes.json")
}

fn load_custom_scenes(state: &AppState) -> Vec<SceneConfig> {
    load_json(&custom_scenes_path(state), Vec::new())
}

fn save_custom_scenes(state: &AppState, scenes: &[SceneConfig]) -> Result<(), AppError> {
    save_json(&custom_scenes_path(state), &scenes)
}

#[tauri::command]
pub fn save_custom_scene(
    state: State<'_, AppState>,
    scene: SceneConfig,
) -> Result<Vec<SceneConfig>, AppError> {
    let mut list = load_custom_scenes(&state);
    // same id → update in place; otherwise append
    if let Some(existing) = list.iter_mut().find(|s| s.id == scene.id) {
        *existing = scene.clone();
    } else {
        list.push(scene.clone());
    }
    save_custom_scenes(&state, &list)?;
    undo::log_entry(
        &state,
        "custom_scene_saved",
        format!("Saved custom scene “{}”", scene.name),
        json!({ "scene": scene }),
        false,
    )?;
    Ok(list)
}

#[tauri::command]
pub fn delete_custom_scene(
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<SceneConfig>, AppError> {
    let mut list = load_custom_scenes(&state);
    let before = list.len();
    list.retain(|s| s.id != id);
    save_custom_scenes(&state, &list)?;
    if list.len() != before {
        undo::log_entry(
            &state,
            "custom_scene_deleted",
            format!("Deleted custom scene {}", id),
            json!({ "id": id }),
            false,
        )?;
    }
    Ok(list)
}

// ---------------------------------------------------------------------------
// Window management
// ---------------------------------------------------------------------------

/// The window the desktop paints its background on — the right parent for a
/// wallpaper window so it renders *behind* the desktop icons.
///
/// Technique: find Progman and ask the shell to materialize the icon-layer
/// WorkerW (message 0x052C — a harmless no-op when it already exists). The
/// Win8+ layout then has two WorkerW windows: one hosting `SHELLDLL_DefView`
/// (the icon layer) and an empty one directly behind it (the background
/// layer). We parent into that background WorkerW; if the shell hasn't
/// created one, we fall back to Progman, which is always behind everything.
/// Crucially we never parent into `SHELLDLL_DefView` itself: that is the
/// desktop-icon container, and a wallpaper child stacked inside it can sit
/// *above* the icon list (the original above-icons bug).
pub(crate) fn desktop_background_parent() -> Option<HWND> {
    unsafe {
        let prog: Vec<u16> = "Progman\0".encode_utf16().collect();
        let progman = FindWindowW(PCWSTR(prog.as_ptr()), None).ok()?;
        let mut result: usize = 0;
        let _ = SendMessageTimeoutW(
            progman,
            0x052C,
            WPARAM(0),
            LPARAM(0),
            SMTO_NORMAL,
            1000,
            Some(&mut result),
        );
        Some(find_background_workerw().unwrap_or(progman))
    }
}

/// Enumerate top-level `WorkerW` windows and return the empty background layer
/// that sits behind the desktop icons: after the 0x052C spawn, the WorkerW
/// that hosts `SHELLDLL_DefView` is the *icon* layer, and the WorkerW that
/// follows it in z-order is the wallpaper layer (Win8+ layout). Returns None
/// when the shell hasn't created one, so the caller can fall back to Progman.
fn find_background_workerw() -> Option<HWND> {
    unsafe {
        let cls: Vec<u16> = "WorkerW\0".encode_utf16().collect();
        let shell: Vec<u16> = "SHELLDLL_DefView\0".encode_utf16().collect();
        let mut after: Option<HWND> = None;
        loop {
            let hwnd = match FindWindowExW(None, after, PCWSTR(cls.as_ptr()), None) {
                Ok(hwnd) => hwnd,
                Err(_) => return None,
            };
            if FindWindowExW(Some(hwnd), None, PCWSTR(shell.as_ptr()), None).is_ok() {
                // icon layer located — the background WorkerW is the next one
                // in z-order (directly behind it)
                return FindWindowExW(None, Some(hwnd), PCWSTR(cls.as_ptr()), None).ok();
            }
            after = Some(hwnd);
        }
    }
}

pub(crate) fn virtual_screen() -> (i32, i32, i32, i32) {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetSystemMetrics, SM_CXSCREEN, SM_CXVIRTUALSCREEN, SM_CYSCREEN, SM_CYVIRTUALSCREEN,
        SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN,
    };
    unsafe {
        let w = GetSystemMetrics(SM_CXVIRTUALSCREEN);
        let h = GetSystemMetrics(SM_CYVIRTUALSCREEN);
        let x = GetSystemMetrics(SM_XVIRTUALSCREEN);
        let y = GetSystemMetrics(SM_YVIRTUALSCREEN);
        if w == 0 || h == 0 {
            (
                0,
                0,
                GetSystemMetrics(SM_CXSCREEN),
                GetSystemMetrics(SM_CYSCREEN),
            )
        } else {
            (x, y, w, h)
        }
    }
}

/// Build a 2s crossfade document for scene→scene switches (E4.7). The old
/// scene is re-rendered deterministically (A6.2 seeded) on canvas c0 while
/// the new one fades in on c1 — a genuine crossfade, not a fade from black.
/// `prefers-reduced-motion: reduce` skips the fade entirely.
pub fn scene_html_transition(from: &SceneConfig, to: &SceneConfig) -> String {
    fn script_body(html: &str) -> String {
        let s = html
            .find("<script>")
            .map(|i| i + "<script>".len())
            .unwrap_or(0);
        let e = html.find("</script>").unwrap_or(html.len());
        html[s..e].to_string()
    }
    let from_script = script_body(&scene_html(from))
        .replace("getElementById('c')", "getElementById('c0')");
    let to_script = script_body(&scene_html(to))
        .replace("getElementById('c')", "getElementById('c1')");
    format!(
        r#"<!DOCTYPE html><html><head><meta charset="utf-8"><style>
html,body{{margin:0;padding:0;overflow:hidden;background:#0b1026;width:100%;height:100%}}
canvas{{display:block;position:absolute;inset:0;width:100vw;height:100vh}}
</style></head><body>
<canvas id="c0"></canvas><canvas id="c1" style="opacity:0"></canvas>
<script>(function(){{ {from_script} }})();</script>
<script>(function(){{ {to_script} }})();</script>
<script>
(function(){{
  const c0 = document.getElementById('c0'), c1 = document.getElementById('c1');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) {{ c1.style.opacity = 1; c0.remove(); return; }}
  c1.style.transition = 'opacity 2000ms ease';
  requestAnimationFrame(() => requestAnimationFrame(() => {{ c1.style.opacity = 1; }}));
  setTimeout(() => c0.remove(), 2100);
}})();
</script>
</body></html>"#,
        from_script = from_script,
        to_script = to_script,
    )
}

pub(crate) fn open_window(
    app: &tauri::AppHandle,
    scene: &SceneConfig,
    transition_from: Option<&SceneConfig>,
) -> Result<(), AppError> {
    let (x, y, w, h) = virtual_screen();
    let html = match transition_from {
        Some(from) => scene_html_transition(from, scene),
        None => scene_html(scene),
    };
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Command(e.to_string()))?;
    let file = dir.join("wallpaper_scene.html");
    std::fs::write(&file, html).map_err(|e| AppError::Command(e.to_string()))?;
    let url =
        tauri::Url::from_file_path(&file).map_err(|_| "invalid wallpaper file url".to_string())?;

    // Build + parent-into-desktop through the webview gate (webview_gate.rs):
    // at boot this can run from the deferred restore while the frontend's
    // overlay spawn is mid-creation on the main thread — two WebView2
    // creations in flight deadlock. The gate serializes them.
    let app = app.clone();
    let result = crate::webview_gate::run(move || -> Result<(), AppError> {
        let win = WebviewWindowBuilder::new(&app, WALLPAPER_WINDOW_LABEL, WebviewUrl::External(url))
            .title("Reforge Wallpaper")
            .decorations(false)
            .resizable(false)
            .maximizable(false)
            .minimizable(false)
            .closable(true)
            .skip_taskbar(true)
            .shadow(false)
            .focused(false)
            .always_on_bottom(true)
            .inner_size(w as f64, h as f64)
            .position(x as f64, y as f64)
            .build()
            .map_err(|e| AppError::Command(format!("wallpaper window: {}", e)))?;

        if let Ok(hwnd) = win.hwnd() {
            // tauri's HWND comes from its own windows crate version; convert to ours
            let hwnd = windows::Win32::Foundation::HWND(hwnd.0);
            if let Some(parent) = desktop_background_parent() {
                unsafe {
                    let _ = SetParent(hwnd, Some(parent));
                    // No SWP_NOZORDER here: HWND_BOTTOM must actually take effect
                    // so the wallpaper sits under the icon layer, and we never
                    // activate it (it must not steal focus from the user's app).
                    let _ = SetWindowPos(
                        hwnd,
                        Some(HWND_BOTTOM),
                        0,
                        0,
                        0,
                        0,
                        SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_NOSENDCHANGING,
                    );
                }
            }
        }
        Ok(())
    });
    if let Some(Err(e)) = &result {
        tracing::error!("wallpaper scene window failed to open: {e}");
    }
    result.unwrap_or(Ok(())) // queued behind an in-flight creation — opens right after
}

fn close_window(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window(WALLPAPER_WINDOW_LABEL) {
        let _ = win.close();
    }
}

// ---------------------------------------------------------------------------
// Battery-saver / fullscreen monitor
// ---------------------------------------------------------------------------

fn battery_saver_on() -> bool {
    unsafe {
        use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
        let mut st: SYSTEM_POWER_STATUS = std::mem::zeroed();
        if GetSystemPowerStatus(&mut st).is_ok() {
            // BATTERY_SAVER_MODE_ON = 0x8
            st.SystemStatusFlag & 0x8 != 0
        } else {
            false
        }
    }
}

/// Shared pause signal for anything that should stop churning while the user
/// is busy: battery saver or a fullscreen app/game is focused. Used by the
/// engine monitor and the static-wallpaper slideshow (S3.11).
pub(crate) fn rotation_paused() -> bool {
    battery_saver_on() || fullscreen_app_active()
}

/// A foreground window covering the whole virtual screen is a fullscreen app or
/// game — pause the wallpaper so it doesn't burn GPU behind it. Maximized
/// windows leave the taskbar visible, so they don't match (work area < screen).
/// Also used by the widget auto-hide (S9.4): widgets duck while a fullscreen
/// app has focus.
pub(crate) fn fullscreen_app_active() -> bool {
    use windows::Win32::Foundation::RECT;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetClassNameW, GetForegroundWindow, GetWindowRect,
    };
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_invalid() {
            return false;
        }
        let mut cls = [0u16; 64];
        let n = GetClassNameW(hwnd, &mut cls);
        let class = String::from_utf16_lossy(&cls[..n.max(0) as usize]);
        // desktop / taskbar / our own shell aren't fullscreen apps
        if class == "Progman"
            || class == "WorkerW"
            || class == "Shell_TrayWnd"
            || class == "Windows.UI.Core.CoreWindow"
        {
            return false;
        }
        let (x, y, w, h) = virtual_screen();
        let mut rect: RECT = std::mem::zeroed();
        if GetWindowRect(hwnd, &mut rect).is_err() {
            return false;
        }
        let rw = rect.right - rect.left;
        let rh = rect.bottom - rect.top;
        rw >= w - 4 && rh >= h - 4 && rect.left >= x - 4 && rect.top >= y - 4
    }
}

pub fn spawn_monitor(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(std::time::Duration::from_secs(20));
            // A user freeze always wins over the automatic resume logic — otherwise
            // the 20s loop would silently unfreeze a wallpaper the user paused.
            let dir = app.path().app_data_dir().ok();
            let frozen = dir
                .as_ref()
                .map(|d| {
                    let e: EngineState = crate::storage::load_json(
                        &d.join("wallpaper_engine.json"),
                        EngineState::default(),
                    );
                    e.frozen
                })
                .unwrap_or(false);
            let paused = frozen || rotation_paused();
            let app2 = app.clone();
            let app3 = app2.clone();
            let _ = app2.run_on_main_thread(move || {
                if let Some(win) = app3.get_webview_window(WALLPAPER_WINDOW_LABEL) {
                    let _ = win.eval(format!("window.__setPaused({})", paused));
                }
            });
        }
    });
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn list_wallpaper_scenes(state: State<'_, AppState>) -> Vec<SceneConfig> {
    let mut all = builtin_scenes();
    all.extend(load_custom_scenes(&state));
    all
}

#[tauri::command]
pub fn get_wallpaper_engine_state(state: State<'_, AppState>) -> EngineState {
    load_engine(&state)
}

#[tauri::command]
pub async fn set_animated_wallpaper(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    scene: SceneConfig,
) -> Result<EngineState, AppError> {
    let before = load_engine(&state);
    // remember the static wallpaper so we can restore it later
    let static_wp = if before.static_wallpaper.is_empty() {
        wallpaper::current_wallpaper()
    } else {
        before.static_wallpaper.clone()
    };
    // E4.7 — switching scene→scene crossfades (2s, reduced-motion aware) by
    // rendering the old scene deterministically on c0 while the new fades in.
    let transition_from = if before.active { before.scene.as_ref() } else { None };
    close_window(&app);
    open_window(&app, &scene, transition_from)?;
    let eng = EngineState {
        active: true,
        frozen: false,
        scene: Some(scene.clone()),
        media: None,
        static_wallpaper: static_wp.clone(),
    };
    save_engine(&state, &eng)?;
    undo::log_entry(
        &state,
        "animated_wallpaper",
        format!("Animated wallpaper → {} ({})", scene.name, scene.kind),
        json!({ "scene": scene, "before_active": before.active, "static_wallpaper": static_wp }),
        true,
    )?;
    Ok(eng)
}

#[tauri::command]
pub fn stop_animated_wallpaper(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<EngineState, AppError> {
    let before = load_engine(&state);
    close_window(&app);
    if !before.static_wallpaper.is_empty() {
        let _ = wallpaper::apply_wallpaper_raw(&before.static_wallpaper);
    }
    let eng = EngineState {
        active: false,
        frozen: false,
        scene: None,
        media: None,
        static_wallpaper: String::new(),
    };
    save_engine(&state, &eng)?;
    undo::log_entry(
        &state,
        "animated_wallpaper_stop",
        "Stopped animated wallpaper (static restored)".to_string(),
        json!({ "scene": before.scene }),
        true,
    )?;
    Ok(eng)
}

#[tauri::command]
pub fn freeze_wallpaper(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    frozen: bool,
) -> Result<EngineState, AppError> {
    let mut eng = load_engine(&state);
    eng.frozen = frozen;
    save_engine(&state, &eng)?;
    if let Some(win) = app.get_webview_window(WALLPAPER_WINDOW_LABEL) {
        let _ = win.eval(format!("window.__setPaused({})", frozen));
    }
    Ok(eng)
}

// undo support: stop without logging
pub fn stop_animated(app: &tauri::AppHandle, state: &AppState) -> Result<(), AppError> {
    close_window(app);
    let eng = load_engine(state);
    if !eng.static_wallpaper.is_empty() {
        let _ = wallpaper::apply_wallpaper_raw(&eng.static_wallpaper);
    }
    let cleared = EngineState {
        active: false,
        frozen: false,
        scene: None,
        media: None,
        static_wallpaper: String::new(),
    };
    save_engine(state, &cleared)?;
    Ok(())
}

// undo support: restart a scene without logging
pub fn start_scene(app: &tauri::AppHandle, scene: &SceneConfig) -> Result<(), AppError> {
    close_window(app);
    open_window(app, scene, None)?;
    Ok(())
}

#[cfg(test)]
mod s4_tests {
    use super::*;

    /// Hand-rolled temp dir (same pattern as wallpaper.rs) so these need no dev-dependency.
    struct TestDir(PathBuf);

    impl TestDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "reforge-engine-test-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_nanos())
                    .unwrap_or(0)
            ));
            std::fs::create_dir_all(&path).unwrap();
            TestDir(path)
        }

        fn state(&self) -> AppState {
            AppState {
                data_dir: self.0.clone(),
            }
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn json(e: &EngineState) -> serde_json::Value {
        serde_json::to_value(e).unwrap()
    }

    /// S4.4 — apply_style writes exactly these EngineState shapes for the three
    /// wallpaper types (see styles.rs); prove each survives a save/load
    /// round-trip unchanged, so restore_on_startup brings back what was applied.
    #[test]
    fn engine_roundtrip_scene_shape() {
        let t = TestDir::new();
        let e = EngineState {
            active: true,
            frozen: false,
            scene: Some(default_scene()),
            media: None,
            static_wallpaper: "C:\\Users\\you\\Pictures\\fallback.jpg".into(),
        };
        save_engine(&t.state(), &e).unwrap();
        assert_eq!(json(&load_engine(&t.state())), json(&e));
    }

    #[test]
    fn engine_roundtrip_live_media_shape() {
        let t = TestDir::new();
        let e = EngineState {
            active: true,
            frozen: false,
            scene: None,
            media: Some(VideoWallpaper {
                path: "C:\\videos\\aurora.mp4".into(),
                kind: "video".into(),
                width: 1920,
                height: 1080,
                name: "aurora_loop".into(),
            }),
            static_wallpaper: "C:\\Users\\you\\Pictures\\fallback.jpg".into(),
        };
        save_engine(&t.state(), &e).unwrap();
        assert_eq!(json(&load_engine(&t.state())), json(&e));
    }

    #[test]
    fn engine_roundtrip_static_default_shape() {
        // The static path writes EngineState::default() (styles.rs) — a frozen
        // engine with the previous static wallpaper retained.
        let t = TestDir::new();
        let e = EngineState {
            active: false,
            frozen: false,
            scene: None,
            media: None,
            static_wallpaper: "C:\\Users\\you\\Pictures\\kept.jpg".into(),
        };
        save_engine(&t.state(), &e).unwrap();
        let back = load_engine(&t.state());
        assert!(!back.active);
        assert!(back.scene.is_none());
        assert!(back.media.is_none());
        assert_eq!(back.static_wallpaper, "C:\\Users\\you\\Pictures\\kept.jpg");
    }

    #[test]
    fn missing_engine_file_loads_default() {
        let t = TestDir::new();
        let e = load_engine(&t.state());
        assert!(!e.active);
        assert!(e.scene.is_none());
        assert!(e.media.is_none());
        assert!(e.static_wallpaper.is_empty());
    }

    #[test]
    fn corrupted_engine_file_falls_back_to_default() {
        let t = TestDir::new();
        std::fs::write(engine_path(&t.state()), "{ not valid json !!").unwrap();
        let e = load_engine(&t.state());
        assert!(!e.active, "corrupt file must degrade to the default, not panic");
    }
}
