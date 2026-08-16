use crate::error::AppError;
use crate::state::AppState;
use crate::storage::{load_json, save_json};
use crate::wallpaper_engine::{default_scene, scene_html, SceneConfig};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{Manager, State, WebviewUrl, WebviewWindowBuilder};

// ---------------------------------------------------------------------------
// Scene → screensaver (E4.6). The app registers itself as the Windows
// screensaver: HKCU\Control Panel\Desktop\SCRNSAVE.EXE points at this exe,
// ScreenSaveActive=1 and ScreenSaveTimeOut=seconds. On idle, Windows launches
// the exe with /s — we detect that and open the scene fullscreen; any input
// (mousemove/click/key) closes the window and the process exits.
// ---------------------------------------------------------------------------

const SCREENSAVER_LABEL: &str = "reforge-screensaver";
const DESKTOP_KEY: &str = r"Control Panel\Desktop";

#[derive(Serialize, Deserialize, Clone)]
pub struct ScreensaverConfig {
    pub enabled: bool,
    pub timeout_secs: u32,
    /// Which scene to show. None = the currently active engine scene, else default_scene().
    pub scene: Option<SceneConfig>,
}

impl Default for ScreensaverConfig {
    fn default() -> Self {
        ScreensaverConfig {
            enabled: false,
            timeout_secs: 300,
            scene: None,
        }
    }
}

fn config_path(state: &AppState) -> PathBuf {
    state.data_dir.join("screensaver.json")
}

fn load_config(state: &AppState) -> ScreensaverConfig {
    load_json(&config_path(state), ScreensaverConfig::default())
}

fn save_config(state: &AppState, c: &ScreensaverConfig) -> Result<(), AppError> {
    save_json(&config_path(state), c)
}

fn exe_path() -> Result<String, AppError> {
    std::env::current_exe()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| AppError::Command(format!("screensaver exe path: {}", e)))
}

// ---- registry ---------------------------------------------------------------

fn desktop_key() -> Result<winreg::RegKey, AppError> {
    winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER)
        .open_subkey_with_flags(
            DESKTOP_KEY,
            winreg::enums::KEY_SET_VALUE | winreg::enums::KEY_QUERY_VALUE,
        )
        .map_err(|e| AppError::Command(format!("open {}: {}", DESKTOP_KEY, e)))
}

/// Register (or unregister) this app as the OS screensaver. Writes the three
/// values Windows consults on idle: SCRNSAVE.EXE, ScreenSaveActive, and the
/// idle timeout in seconds.
fn write_registry(cfg: &ScreensaverConfig) -> Result<(), AppError> {
    let key = desktop_key()?;
    if cfg.enabled {
        key.set_value("SCRNSAVE.EXE", &exe_path()?)
            .map_err(|e| AppError::Command(format!("set SCRNSAVE.EXE: {}", e)))?;
        key.set_value("ScreenSaveActive", &"1".to_string())
            .map_err(|e| AppError::Command(format!("set ScreenSaveActive: {}", e)))?;
        key.set_value("ScreenSaveTimeOut", &cfg.timeout_secs.max(1).to_string())
            .map_err(|e| AppError::Command(format!("set ScreenSaveTimeOut: {}", e)))?;
    } else {
        let _ = key.delete_value("SCRNSAVE.EXE");
        let _ = key.set_value("ScreenSaveActive", &"0".to_string());
    }
    Ok(())
}

fn read_registry() -> (bool, u32) {
    let Ok(key) = desktop_key() else {
        return (false, 300);
    };
    let active: String = key.get_value("ScreenSaveActive").unwrap_or_default();
    let timeout: String = key.get_value("ScreenSaveTimeOut").unwrap_or_default();
    (
        active == "1",
        timeout.parse::<u32>().unwrap_or(300).max(1),
    )
}

// ---- html -------------------------------------------------------------------

/// scene_html + the screensaver contract: a fullscreen canvas, a subtle
/// "move the mouse to exit" hint, and input listeners that close the window.
/// Windows screensavers must end on ANY input (mousemove, click, key).
fn screensaver_html(scene: &SceneConfig) -> String {
    let base = scene_html(scene);
    let hint = r#"
<div style="position:fixed;left:50%;bottom:36px;transform:translateX(-50%);
  color:rgba(226,232,240,0.55);font:13px/1 'Segoe UI',system-ui,sans-serif;
  background:rgba(2,6,23,0.45);padding:8px 18px;border-radius:20px;
  pointer-events:none;user-select:none;letter-spacing:.2px">
  Move the mouse or press any key to exit
</div>
<script>
function exitScr(){{ const i=window.__TAURI_INTERNALS__; if(i){{ i.invoke('dismiss_screensaver',{{}}).catch(()=>window.close()); }} else {{ window.close(); }} }}
['mousemove','mousedown','keydown','wheel','touchstart'].forEach(ev=>window.addEventListener(ev,exitScr,{{passive:true}}));
</script>"#;
    base.replace("</body></html>", &format!("{}</body></html>", hint))
}

// ---- tauri commands ----------------------------------------------------------

#[tauri::command]
pub fn get_screensaver_config(state: State<'_, AppState>) -> ScreensaverConfig {
    load_config(&state)
}

#[tauri::command]
pub fn set_screensaver_config(
    state: State<'_, AppState>,
    config: ScreensaverConfig,
) -> Result<ScreensaverConfig, AppError> {
    save_config(&state, &config)?;
    write_registry(&config)?;
    Ok(config)
}

/// Registry truth — the Settings toggle shows what the OS is actually set to,
/// so a manual change in the system dialog surfaces honestly.
#[tauri::command]
pub fn get_screensaver_registry() -> serde_json::Value {
    let (active, timeout) = read_registry();
    serde_json::json!({ "active": active, "timeout_secs": timeout })
}

#[tauri::command]
pub fn dismiss_screensaver(app: tauri::AppHandle) -> Result<(), AppError> {
    if let Some(win) = app.get_webview_window(SCREENSAVER_LABEL) {
        let _ = win.close();
    }
    Ok(())
}

/// "Preview" — open the chosen scene fullscreen right now, exactly as the
/// idle trigger would. Any input closes the window.
#[tauri::command]
pub async fn preview_screensaver(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let cfg = load_config(&state);
    open_screensaver_window(&app, cfg.scene.as_ref())?;
    Ok("Screensaver preview — move the mouse or press any key to exit".into())
}

// ---- window ------------------------------------------------------------------

fn chosen_scene(cfg_scene: Option<&SceneConfig>, state: &AppState) -> SceneConfig {
    match cfg_scene {
        Some(s) => s.clone(),
        None => {
            let eng = crate::storage::load_json(
                &state.data_dir.join("wallpaper_engine.json"),
                crate::wallpaper_engine::EngineState::default(),
            );
            eng.scene.unwrap_or_else(default_scene)
        }
    }
}

fn open_screensaver_window(
    app: &tauri::AppHandle,
    cfg_scene: Option<&SceneConfig>,
) -> Result<(), AppError> {
    // An in-process AppState so /s mode (no tauri State) can pick the scene too.
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Command(e.to_string()))?;
    let state = AppState { data_dir: dir };
    let scene = chosen_scene(cfg_scene, &state);
    let html = screensaver_html(&scene);
    let file = state.data_dir.join("screensaver.html");
    std::fs::write(&file, html).map_err(|e| AppError::Command(e.to_string()))?;
    let url = tauri::Url::from_file_path(&file)
        .map_err(|_| "invalid screensaver url".to_string())?;

    let (_, _, w, h) = crate::wallpaper_engine::virtual_screen();
    // Gate the build (webview_gate.rs) — the screensaver can trigger while
    // another window creation is in flight; two WebView2 creations on the
    // main thread deadlock.
    let app_c = app.clone();
    crate::webview_gate::run(move || -> Result<(), AppError> {
        let win = WebviewWindowBuilder::new(&app_c, SCREENSAVER_LABEL, WebviewUrl::External(url))
            .title("Reforge Screensaver")
            .decorations(false)
            .resizable(false)
            .maximizable(false)
            .minimizable(false)
            .closable(true)
            .skip_taskbar(true)
            .shadow(false)
            .focused(false)
            .always_on_top(true)
            .inner_size(w as f64, h as f64)
            .position(0.0, 0.0)
            .build()
            .map_err(|e| AppError::Command(format!("screensaver window: {}", e)))?;

        // Fullscreen over everything (not just the virtual screen rect).
        let _ = win.set_fullscreen(true);
        Ok(())
    })
    .unwrap_or(Ok(()))?; // queued behind an in-flight creation — opens right after

    // Failsafe: if the page's JS can't close the window (e.g. IPC not ready),
    // close it from Rust after the configured timeout + grace — a stuck
    // screensaver is a support ticket.
    let secs = state
        .data_dir
        .join("screensaver.json");
    let secs = load_json::<ScreensaverConfig>(&secs, ScreensaverConfig::default())
        .timeout_secs
        .max(1) as u64
        + 5;
    let app2 = app.clone();
    let app3 = app2.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(secs));
        let _ = app2.run_on_main_thread(move || {
            if let Some(w) = app3.get_webview_window(SCREENSAVER_LABEL) {
                let _ = w.close();
            }
        });
    });
    Ok(())
}

/// /s mode — the OS launched us as the screensaver on idle. Open the scene
/// fullscreen; input closes the window and, with no other windows left, the
/// tauri event loop ends and the process exits.
pub fn run_screensaver_mode(app: &tauri::AppHandle) {
    let _ = open_screensaver_window(app, None);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_defaults_off() {
        let c = ScreensaverConfig::default();
        assert!(!c.enabled);
        assert_eq!(c.timeout_secs, 300);
        assert!(c.scene.is_none());
    }

    #[test]
    fn config_roundtrips_through_json() {
        let c = ScreensaverConfig {
            enabled: true,
            timeout_secs: 120,
            scene: Some(default_scene()),
        };
        let s = serde_json::to_string(&c).unwrap();
        let back: ScreensaverConfig = serde_json::from_str(&s).unwrap();
        assert!(back.enabled);
        assert_eq!(back.timeout_secs, 120);
        assert_eq!(back.scene.unwrap().id, default_scene().id);
    }

    #[test]
    fn screensaver_html_keeps_scene_and_adds_exit() {
        let html = screensaver_html(&default_scene());
        assert!(html.contains("\"kind\":\"aurora\""), "scene cfg embedded");
        assert!(html.contains("<canvas id=\"c\"></canvas>"));
        assert!(html.contains("mousemove"), "exits on mouse move");
        assert!(html.contains("keydown"), "exits on any key");
        assert!(html.contains("Move the mouse or press any key to exit"));
    }

    #[test]
    fn screensaver_html_escapes_hostile_scene() {
        let mut evil = default_scene();
        evil.kind = "</script><script>alert(1)</script>".into();
        let html = screensaver_html(&evil);
        assert!(
            !html.contains("</script><script>alert"),
            "scene config must stay \\u-escaped inside the screensaver doc"
        );
    }
}
