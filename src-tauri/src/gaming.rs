use crate::state::AppState;
use crate::undo;
use serde_json::json;
use tauri::State;
use winreg::enums::HKEY_CURRENT_USER;
use winreg::RegKey;

use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::Manager;
fn gamebar_key() -> Result<RegKey, AppError> {
    RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey(r"Software\Microsoft\GameBar")
        .map_err(|e| AppError::Command(e.to_string()))
        .map(|(k, _)| k)
}

#[tauri::command]
pub fn get_game_mode() -> bool {
    gamebar_key()
        .ok()
        .and_then(|k| k.get_value::<u32, _>("AutoGameModeEnabled").ok())
        .map(|v| v == 1)
        .unwrap_or(false)
}

#[tauri::command]
pub fn set_game_mode(state: State<'_, AppState>, on: bool) -> Result<bool, AppError> {
    let before = get_game_mode();
    let key = gamebar_key()?;
    key.set_value("AutoGameModeEnabled", &(if on { 1u32 } else { 0u32 }))
        .map_err(|e| AppError::Command(e.to_string()))?;
    key.set_value("AllowAutoGameMode", &(if on { 1u32 } else { 0u32 }))
        .map_err(|e| AppError::Command(e.to_string()))?;
    undo::log_entry(
        &state,
        "game_mode",
        format!("Game Mode → {}", if on { "on" } else { "off" }),
        json!({ "before": before, "after": on }),
        true,
    )?;
    Ok(on)
}

// ---------------------------------------------------------------------------
// Per-game profiles (S10.3) — persisted in gaming_profiles.json; a profile can
// flip Game Bar mode, pause the animated wallpaper, raise process priority and
// hide icons/taskbar for the stream. A process watcher applies profiles on
// launch and once per launch.
// ---------------------------------------------------------------------------

use crate::storage::{load_json, save_json};
use uuid::Uuid;

#[derive(Serialize, Deserialize, Clone)]
pub struct GameProfile {
    pub id: String,
    pub exe: String,        // e.g. "eldenring.exe"
    pub name: String,       // display name
    pub game_mode: bool,    // Game Bar AutoGameModeEnabled
    pub scene_pause: bool,  // freeze the animated wallpaper
    pub priority: String,   // "normal" | "high"
    pub overlay: bool,      // stream-safe layout (icons hidden, taskbar autohide)
}

impl Default for GameProfile {
    fn default() -> Self {
        GameProfile {
            id: String::new(),
            exe: String::new(),
            name: String::new(),
            game_mode: true,
            scene_pause: true,
            priority: "normal".into(),
            overlay: false,
        }
    }
}

fn profiles_path(state: &AppState) -> PathBuf {
    state.data_dir.join("gaming_profiles.json")
}

fn load_profiles(state: &AppState) -> Vec<GameProfile> {
    load_json(&profiles_path(state), Vec::new())
}

#[tauri::command]
pub fn list_game_profiles(state: State<'_, AppState>) -> Vec<GameProfile> {
    load_profiles(&state)
}

#[tauri::command]
pub fn save_game_profile(
    state: State<'_, AppState>,
    profile: GameProfile,
) -> Result<GameProfile, AppError> {
    let mut list = load_profiles(&state);
    let mut p = profile;
    if p.id.is_empty() {
        p.id = Uuid::new_v4().to_string();
    }
    if p.name.is_empty() {
        p.name = p.exe.clone();
    }
    if let Some(existing) = list.iter_mut().find(|x| x.id == p.id) {
        *existing = p.clone();
    } else {
        list.push(p.clone());
    }
    save_profiles(&state, &list)?;
    Ok(p)
}

#[tauri::command]
pub fn delete_game_profile(state: State<'_, AppState>, id: String) -> Result<(), AppError> {
    let mut list = load_profiles(&state);
    list.retain(|p| p.id != id);
    save_profiles(&state, &list)
}

fn save_profiles(state: &AppState, list: &[GameProfile]) -> Result<(), AppError> {
    save_json(&profiles_path(state), &list.to_vec())
}

/// Raise (or restore) a running process's priority class. HIGH_PRIORITY_CLASS
/// = 0x80, NORMAL_PRIORITY_CLASS = 0x20. PID lookup via sysinfo (ToolHelp would
/// need a new windows-crate feature).
fn set_process_priority(exe: &str, high: bool) -> Result<(), AppError> {
    use windows::Win32::System::Threading::{OpenProcess, SetPriorityClass, PROCESS_SET_INFORMATION};
    let mut sys = sysinfo::System::new_all();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
    let target = exe.to_lowercase();
    let mut found = false;
    for (pid, p) in sys.processes() {
        if p.name().to_string_lossy().to_lowercase() == target {
            found = true;
            unsafe {
                if let Ok(handle) = OpenProcess(PROCESS_SET_INFORMATION, false, pid.as_u32()) {
                    let cls = if high {
                        windows::Win32::System::Threading::HIGH_PRIORITY_CLASS
                    } else {
                        windows::Win32::System::Threading::NORMAL_PRIORITY_CLASS
                    };
                    let _ = SetPriorityClass(handle, cls);
                }
            }
        }
    }
    if found {
        Ok(())
    } else {
        Err(AppError::Command(format!(
            "{} is not running — priority unchanged",
            exe
        )))
    }
}

/// Apply a profile's optimizations (S10.3). Logs one undoable entry capturing
/// the before state so History can undo the whole apply. Process priority is
/// ephemeral (the process may exit) — the revert restores everything else and
/// resets priority when the process is still running.
fn apply_profile_internal(
    app: &tauri::AppHandle,
    state: &AppState,
    profile: &GameProfile,
) -> Result<String, AppError> {
    let before_game_mode = get_game_mode();
    let before_layout = read_layout();
    let before_frozen = crate::wallpaper_engine::load_engine(state).frozen;

    if profile.game_mode {
        gamebar_key()?.set_value("AutoGameModeEnabled", &1u32)?;
        gamebar_key()?.set_value("AllowAutoGameMode", &1u32)?;
    }
    if profile.scene_pause {
        let mut eng = crate::wallpaper_engine::load_engine(state);
        eng.frozen = true;
        crate::wallpaper_engine::save_engine(state, &eng)?;
        if let Some(win) = app.get_webview_window(crate::wallpaper_engine::WALLPAPER_WINDOW_LABEL) {
            let _ = win.eval("window.__setPaused && window.__setPaused(true)");
        }
    }
    if profile.overlay {
        let key = explorer_key()?;
        key.set_value("HideIcons", &1u32)?;
        key.set_value("TaskbarAutoHide", &1u32)?;
        refresh_shell();
    }
    let mut priority_note = "".to_string();
    if profile.priority == "high" {
        match set_process_priority(&profile.exe, true) {
            Ok(()) => priority_note = " · priority raised".into(),
            Err(_) => priority_note = " · process not running — priority on next launch".into(),
        }
    }

    undo::log_entry(
        state,
        "game_profile",
        format!("Applied {} profile", profile.name),
        json!({
            "name": profile.name,
            "before": {
                "game_mode": before_game_mode,
                "frozen": before_frozen,
                "icons_hidden": before_layout.icons_hidden,
                "taskbar_autohide": before_layout.taskbar_autohide,
            },
        }),
        true,
    )?;
    Ok(format!("{} profile applied{}", profile.name, priority_note))
}

#[tauri::command]
pub fn apply_game_profile(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    profile: GameProfile,
) -> Result<String, AppError> {
    apply_profile_internal(&app, &state, &profile)
}

/// Undo support: restore the pre-apply state (game mode, scene freeze, layout).
pub(crate) fn restore_profile_before(
    state: &AppState,
    before: &serde_json::Value,
) -> Result<(), AppError> {
    let gm = before.get("game_mode").and_then(|v| v.as_bool()).unwrap_or(false);
    gamebar_key()?.set_value("AutoGameModeEnabled", &(if gm { 1u32 } else { 0u32 }))?;
    gamebar_key()?.set_value("AllowAutoGameMode", &(if gm { 1u32 } else { 0u32 }))?;
    let frozen = before.get("frozen").and_then(|v| v.as_bool()).unwrap_or(false);
    let mut eng = crate::wallpaper_engine::load_engine(state);
    eng.frozen = frozen;
    crate::wallpaper_engine::save_engine(state, &eng)?;
    let key = explorer_key()?;
    let icons = before.get("icons_hidden").and_then(|v| v.as_bool()).unwrap_or(false);
    let autohide = before.get("taskbar_autohide").and_then(|v| v.as_bool()).unwrap_or(false);
    key.set_value("HideIcons", &(if icons { 1u32 } else { 0u32 }))?;
    key.set_value("TaskbarAutoHide", &(if autohide { 1u32 } else { 0u32 }))?;
    refresh_shell();
    Ok(())
}

/// Watches for profiled games launching and applies their profile once per
/// launch (S10.3 "optimize on launch"). Wakes every 5s; no profiles = idle.
pub fn spawn_game_watcher(app: tauri::AppHandle, state: AppState) {
    std::thread::spawn(move || {
        let mut applied: std::collections::HashSet<String> = std::collections::HashSet::new();
        let mut sys = sysinfo::System::new_all();
        loop {
            std::thread::sleep(std::time::Duration::from_secs(5));
            let profiles = load_profiles(&state);
            if profiles.is_empty() {
                applied.clear();
                continue;
            }
            sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
            let running: std::collections::HashSet<String> = sys
                .processes()
                .values()
                .map(|p| p.name().to_string_lossy().to_lowercase())
                .collect();
            let mut now_running: std::collections::HashSet<String> = std::collections::HashSet::new();
            for p in &profiles {
                let exe = p.exe.to_lowercase();
                if running.contains(&exe) {
                    now_running.insert(exe.clone());
                    if !applied.contains(&exe) {
                        applied.insert(exe.clone());
                        let app2 = app.clone();
                        let app3 = app.clone();
                        let st2 = AppState {
                            data_dir: state.data_dir.clone(),
                        };
                        let prof = p.clone();
                        let _ = app2.run_on_main_thread(move || {
                            let _ = apply_profile_internal(&app3, &st2, &prof);
                        });
                    }
                }
            }
            // forget profiles whose game has exited, so the next launch re-applies
            applied.retain(|e| now_running.contains(e));
        }
    });
}

// ---------------------------------------------------------------------------
// Stream-safe desktop layout
// ---------------------------------------------------------------------------

#[derive(serde::Serialize, Clone)]
pub struct StreamLayoutState {
    pub icons_hidden: bool,
    pub taskbar_autohide: bool,
}

fn explorer_key() -> Result<RegKey, AppError> {
    RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey(r"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced")
        .map_err(|e| AppError::Command(e.to_string()))
        .map(|(k, _)| k)
}

fn read_layout() -> StreamLayoutState {
    let k = explorer_key().ok();
    StreamLayoutState {
        icons_hidden: k
            .as_ref()
            .and_then(|key| key.get_value::<u32, _>("HideIcons").ok())
            .map(|v| v == 1)
            .unwrap_or(false),
        taskbar_autohide: k
            .as_ref()
            .and_then(|key| key.get_value::<u32, _>("TaskbarAutoHide").ok())
            .map(|v| v == 1)
            .unwrap_or(false),
    }
}

fn refresh_shell() {
    crate::cmd::hidden("powershell.exe")
        .args(["-NoProfile", "-Command", "(New-Object -ComObject Shell.Application).Windows() | ForEach-Object { $_.Refresh() }; Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue"])
        .spawn()
        .ok();
}

#[tauri::command]
pub fn get_stream_layout() -> StreamLayoutState {
    read_layout()
}

#[tauri::command]
pub fn set_stream_layout(
    state: State<'_, AppState>,
    on: bool,
) -> Result<StreamLayoutState, AppError> {
    let before = read_layout();
    let key = explorer_key()?;
    key.set_value("HideIcons", &(if on { 1u32 } else { 0u32 }))
        .map_err(|e| AppError::Command(e.to_string()))?;
    key.set_value("TaskbarAutoHide", &(if on { 1u32 } else { 0u32 }))
        .map_err(|e| AppError::Command(e.to_string()))?;
    if on != before.icons_hidden || on != before.taskbar_autohide {
        refresh_shell();
    }
    undo::log_entry(
        &state,
        "stream_layout",
        format!(
            "Stream-safe layout → {}",
            if on {
                "on (icons hidden, taskbar auto-hides)"
            } else {
                "off (icons + taskbar restored)"
            }
        ),
        json!({ "before": before, "after": on }),
        true,
    )?;
    Ok(read_layout())
}
