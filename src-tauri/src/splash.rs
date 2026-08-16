use crate::state::AppState;
use crate::storage::{load_json, save_json};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{Manager, State, WebviewUrl, WebviewWindowBuilder};

// ---------------------------------------------------------------------------
// Welcome-back splash — a persistent window shown at login as a safe
// substitute for boot-screen customization.
//
// Config: on/off, timeout seconds, show stats. Persisted to data_dir.
// The window is created in setup() and auto-dismissed via JS timer.
// ---------------------------------------------------------------------------

use crate::error::AppError;
const SPLASH_LABEL: &str = "reforge-splash";

#[derive(Serialize, Deserialize, Clone)]
pub struct SplashConfig {
    pub enabled: bool,
    pub timeout_secs: u32,
    pub launch_at_login: bool,
}

impl Default for SplashConfig {
    fn default() -> Self {
        SplashConfig {
            // opt-in: a window popping up over the desktop on every launch
            // read as a broken boot, so it's off until enabled in Settings
            enabled: false,
            timeout_secs: 6,
            launch_at_login: false,
        }
    }
}

fn config_path(state: &AppState) -> PathBuf {
    state.data_dir.join("splash_config.json")
}

fn load_config(state: &AppState) -> SplashConfig {
    load_json(&config_path(state), SplashConfig::default())
}

fn save_config(state: &AppState, c: &SplashConfig) -> Result<(), AppError> {
    save_json(&config_path(state), c)
}

#[tauri::command]
pub fn get_splash_config(state: State<'_, AppState>) -> SplashConfig {
    load_config(&state)
}

#[tauri::command]
pub fn set_splash_config(
    state: State<'_, AppState>,
    config: SplashConfig,
) -> Result<SplashConfig, AppError> {
    save_config(&state, &config)?;
    Ok(config)
}

#[tauri::command]
pub fn dismiss_splash(app: tauri::AppHandle) -> Result<(), AppError> {
    if let Some(win) = app.get_webview_window(SPLASH_LABEL) {
        let _ = win.close();
    }
    Ok(())
}

// ---- setup / persistence -----------------------------------------------------

pub fn spawn_splash(app: &tauri::AppHandle, state: &AppState) {
    let cfg = load_config(state);
    if !cfg.enabled {
        return;
    }
    let dir = match app.path().app_data_dir() {
        Ok(d) => d,
        Err(_) => return,
    };
    // gather a quick greeting — real local time, not a UTC+8 guess
    let lt = unsafe { windows::Win32::System::SystemInformation::GetLocalTime() };
    let hour = lt.wHour as u32;
    let greeting = match hour {
        0..=11 => "Good morning ☀️",
        12..=17 => "Good afternoon 🌤️",
        _ => "Good evening 🌙",
    };
    let html = format!(
        r#"<!DOCTYPE html><html><head><meta charset="utf-8"><style>
html,body{{margin:0;padding:0;overflow:hidden;background:transparent;font-family:Segoe UI,system-ui,sans-serif;}}
.wrap{{width:100vw;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;
background:linear-gradient(135deg,rgba(10,14,28,0.85),rgba(20,8,36,0.88));
backdrop-filter:blur(32px);-webkit-backdrop-filter:blur(32px);color:#e2e8f0;}}
h1{{font-size:48px;font-weight:300;margin:0;}}
h1 b{{font-weight:700;}}
p{{font-size:16px;color:#94a3b8;margin:8px 0 0;}}
.time{{font-size:72px;font-weight:200;margin:24px 0 4px;color:#f8fafc;}}
.date{{font-size:14px;color:#64748b;}}
.badge{{margin-top:32px;padding:8px 20px;border-radius:20px;background:rgba(129,140,248,0.15);color:#818cf8;font-size:13px;}}
.hint{{margin-top:48px;font-size:12px;color:#475569;}}
</style></head><body>
<div class="wrap">
  <h1><b>Welcome back</b> {greeting}</h1>
  <p>Your PC is ready. Reforge is standing by.</p>
  <div class="time" id="time">--:--</div>
  <div class="date" id="date">—</div>
  <div class="badge">⚡ Reforge v0.3</div>
  <div class="hint">Click anywhere to dismiss · auto-dismisses in {timeout}s</div>
</div>
<script>
const t=document.getElementById('time'),d=document.getElementById('date');
function clock(){{const n=new Date();t.textContent=n.toLocaleTimeString([],{{hour:'2-digit',minute:'2-digit'}});d.textContent=n.toLocaleDateString([],{{weekday:'long',month:'long',day:'numeric'}});}}
clock();setInterval(clock,1000);
// __TAURI_INTERNALS__ is injected into every app webview; the full
// window.__TAURI__ API only exists when withGlobalTauri is enabled.
function dismiss(){{const i=window.__TAURI_INTERNALS__;if(i){{i.invoke('dismiss_splash',{{}}).catch(()=>{{}});}}}}
document.addEventListener('click',dismiss);
window.addEventListener('load',()=>{{setTimeout(dismiss,{timeout}000);}});
</script></body></html>"#,
        greeting = greeting,
        timeout = cfg.timeout_secs,
    );
    let file = dir.join("splash.html");
    let _ = std::fs::write(&file, html);
    let url = tauri::Url::from_file_path(&file)
        // constant fallback — safe to unwrap
        .unwrap_or_else(|_| tauri::Url::parse("about:blank").unwrap());
    // Gate the build (webview_gate.rs): the splash spawns from the deferred
    // startup thread at ~1.5s, exactly when the frontend's boot-time overlay
    // spawn can be mid-creation — two WebView2 creations in flight on the
    // main thread deadlock. Queued behind the in-flight creation is fine.
    let app_c = app.clone();
    crate::webview_gate::run(move || {
        let _ = WebviewWindowBuilder::new(&app_c, SPLASH_LABEL, WebviewUrl::External(url))
            .title("Welcome back")
            .decorations(false)
            .resizable(false)
            .maximizable(false)
            .minimizable(false)
            .skip_taskbar(true)
            .shadow(false)
            .transparent(true)
            .always_on_top(true)
            .inner_size(520.0, 380.0)
            .center()
            .build();
    });

    // Failsafe: if the page's JS can't dismiss the window for any reason, close
    // it from the Rust side after the timeout + a grace period. A stuck
    // always-on-top splash is exactly the "app won't start" symptom.
    let app2 = app.clone();
    let app3 = app2.clone();
    let timeout = cfg.timeout_secs.max(1) as u64 + 3;
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(timeout));
        let _ = app2.run_on_main_thread(move || {
            if let Some(win) = app3.get_webview_window(SPLASH_LABEL) {
                let _ = win.close();
            }
        });
    });
}

// Run key registration for login launch
#[tauri::command]
pub fn set_splash_login_launch(state: State<'_, AppState>, on: bool) -> Result<bool, AppError> {
    let mut cfg = load_config(&state);
    cfg.launch_at_login = on;
    save_config(&state, &cfg)?;
    let exe = std::env::current_exe().map_err(|e| AppError::Command(e.to_string()))?;
    let name = "Reforge";
    let key = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER)
        .open_subkey_with_flags(
            r"Software\Microsoft\Windows\CurrentVersion\Run",
            winreg::enums::KEY_SET_VALUE,
        )
        .map_err(|e| AppError::Command(e.to_string()))?;
    if on {
        key.set_value(name, &exe.to_string_lossy().to_string())
            .map_err(|e| AppError::Command(e.to_string()))?;
    } else {
        let _ = key.delete_value(name);
    }
    Ok(on)
}

// undo support: no special logic needed — splash is just a window, not a system change.
