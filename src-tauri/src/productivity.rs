use crate::state::AppState;
use crate::storage::{load_json, now_millis, save_json};
use crate::undo;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::PathBuf;
use tauri::{Manager, State};
use uuid::Uuid;
use windows::Win32::System::DataExchange::{CloseClipboard, GetClipboardData, OpenClipboard};
use windows::Win32::System::Memory::{GlobalLock, GlobalUnlock};
use windows::Win32::System::Ole::CF_UNICODETEXT;
use windows::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
use winreg::enums::{HKEY_CURRENT_USER, KEY_SET_VALUE};
use winreg::RegKey;

// ---------------------------------------------------------------------------
// Clipboard manager
// ---------------------------------------------------------------------------

use crate::error::AppError;
#[derive(Serialize, Deserialize, Clone)]
pub struct ClipItem {
    pub id: String,
    pub text: String,
    pub ts: u64,
    pub pinned: bool,
}

fn clips_path(state: &AppState) -> PathBuf {
    state.data_dir.join("clipboard_history.json")
}

fn load_clips(state: &AppState) -> Vec<ClipItem> {
    load_json(&clips_path(state), Vec::new())
}

fn save_clips(state: &AppState, items: &Vec<ClipItem>) -> Result<(), AppError> {
    save_json(&clips_path(state), items)
}

fn read_clipboard_text() -> Option<String> {
    unsafe {
        if OpenClipboard(None).is_err() {
            return None;
        }
        // Always close the clipboard, even on failure paths — leaving it open
        // blocks other apps from copying until this process exits.
        let result = (|| {
            let h = GetClipboardData(CF_UNICODETEXT.0 as u32).ok()?;
            if h.0.is_null() {
                return None;
            }
            let hg = windows::Win32::Foundation::HGLOBAL(h.0);
            let ptr = GlobalLock(hg);
            if ptr.is_null() {
                return None;
            }
            let p16 = ptr as *const u16;
            let mut len = 0usize;
            while *p16.add(len) != 0 {
                len += 1;
            }
            let out = String::from_utf16_lossy(std::slice::from_raw_parts(p16, len));
            let _ = GlobalUnlock(hg);
            Some(out)
        })();
        let _ = CloseClipboard();
        result
    }
}

pub fn spawn_clipboard_monitor(data_dir: PathBuf) {
    std::thread::spawn(move || {
        let path = data_dir.join("clipboard_history.json");
        let mut last: Option<String> = None;
        loop {
            std::thread::sleep(std::time::Duration::from_millis(1200));
            if let Some(text) = read_clipboard_text() {
                if text.len() < 5000 && text.len() > 1 && Some(text.clone()) != last {
                    last = Some(text.clone());
                    let mut items: Vec<ClipItem> = load_json(&path, Vec::new());
                    if let Some(existing) = items.iter().position(|i| i.text == text) {
                        items.remove(existing);
                    }
                    items.insert(
                        0,
                        ClipItem {
                            id: Uuid::new_v4().to_string(),
                            text,
                            ts: now_millis(),
                            pinned: false,
                        },
                    );
                    items.truncate(200);
                    let _ = save_json(&path, &items);
                }
            }
        }
    });
}

#[tauri::command]
pub fn get_clipboard_history(state: State<'_, AppState>) -> Vec<ClipItem> {
    load_clips(&state)
}

#[tauri::command]
pub fn clear_clipboard_history(state: State<'_, AppState>) -> Result<(), AppError> {
    save_clips(&state, &Vec::new())
}

#[tauri::command]
pub fn toggle_clipboard_pin(
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<ClipItem>, AppError> {
    let mut items = load_clips(&state);
    if let Some(item) = items.iter_mut().find(|i| i.id == id) {
        item.pinned = !item.pinned;
    }
    save_clips(&state, &items)?;
    Ok(items)
}

// ---------------------------------------------------------------------------
// Quick launcher (Start Menu apps)
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
pub struct AppEntry {
    pub name: String,
    pub path: String,
}

fn lnk_apps() -> Vec<AppEntry> {
    let appdata = std::env::var("APPDATA").unwrap_or_default();
    let mut roots = vec![PathBuf::from(&appdata).join(r"Microsoft\Windows\Start Menu\Programs")];
    let program_data = std::env::var("ProgramData").unwrap_or_else(|_| r"C:\ProgramData".into());
    roots.push(PathBuf::from(&program_data).join(r"Microsoft\Windows\Start Menu\Programs"));
    let mut apps = Vec::new();
    for root in roots {
        for entry in walkdir::WalkDir::new(&root)
            .max_depth(4)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            let p = entry.path();
            if p.extension()
                .map(|e| e.eq_ignore_ascii_case("lnk"))
                .unwrap_or(false)
            {
                let name = p
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default();
                if !name.is_empty() {
                    apps.push(AppEntry {
                        name,
                        path: p.to_string_lossy().to_string(),
                    });
                }
            }
        }
    }
    apps.sort_by_key(|a| a.name.to_lowercase());
    apps
}

#[tauri::command]
pub fn get_app_list() -> Vec<AppEntry> {
    lnk_apps()
}

#[tauri::command]
pub fn launch_app(path: String) -> Result<(), AppError> {
    crate::cmd::hidden("explorer.exe")
        .arg(&path)
        .spawn()
        .map_err(|e| AppError::Command(e.to_string()))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Macros (when app X starts → apply look Y)
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone)]
pub struct MacroRule {
    pub id: String,
    pub name: String,
    pub when_app: String,  // exe name, lowercase
    pub look_name: String, // display name of the look
    pub accent: String,
    pub mode: String,      // dark | light
    pub wallpaper: String, // path or empty
    pub enabled: bool,
}

fn macros_path(state: &AppState) -> PathBuf {
    state.data_dir.join("macros.json")
}

fn load_macros(state: &AppState) -> Vec<MacroRule> {
    load_json(&macros_path(state), Vec::new())
}

#[tauri::command]
pub fn list_macros(state: State<'_, AppState>) -> Vec<MacroRule> {
    load_macros(&state)
}

#[tauri::command]
pub fn create_macro(
    state: State<'_, AppState>,
    name: String,
    when_app: String,
    look_name: String,
    accent: String,
    mode: String,
    wallpaper: String,
) -> Result<MacroRule, AppError> {
    let mut list = load_macros(&state);
    let rule = MacroRule {
        id: Uuid::new_v4().to_string(),
        name,
        when_app: when_app.to_lowercase(),
        look_name,
        accent,
        mode,
        wallpaper,
        enabled: true,
    };
    list.push(rule.clone());
    save_json(&macros_path(&state), &list)?;
    undo::log_entry(
        &state,
        "macro",
        format!(
            "Macro created: when {} starts → apply {}",
            rule.when_app, rule.look_name
        ),
        json!({ "macro": rule }),
        false,
    )?;
    Ok(rule)
}

#[tauri::command]
pub fn remove_macro(state: State<'_, AppState>, id: String) -> Result<(), AppError> {
    let mut list = load_macros(&state);
    list.retain(|m| m.id != id);
    save_json(&macros_path(&state), &list)
}

#[tauri::command]
pub fn toggle_macro(
    state: State<'_, AppState>,
    id: String,
    enabled: bool,
) -> Result<Vec<MacroRule>, AppError> {
    let mut list = load_macros(&state);
    if let Some(m) = list.iter_mut().find(|m| m.id == id) {
        m.enabled = enabled;
    }
    save_json(&macros_path(&state), &list)?;
    Ok(list)
}

pub fn spawn_macro_monitor(data_dir: PathBuf) {
    std::thread::spawn(move || {
        let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
        loop {
            std::thread::sleep(std::time::Duration::from_secs(6));
            let rules: Vec<MacroRule> = load_json(&data_dir.join("macros.json"), Vec::new());
            if rules.is_empty() {
                continue;
            }
            let rule_count = rules.len();
            // current process names
            let out = crate::cmd::hidden("tasklist")
                .args(["/fo", "csv", "/nh"])
                .output()
                .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
                .unwrap_or_default();
            let mut running = std::collections::HashSet::new();
            for line in out.lines() {
                let name = line
                    .split(',')
                    .next()
                    .map(|s| s.trim_matches('"').to_lowercase())
                    .unwrap_or_default();
                if !name.is_empty() {
                    running.insert(name);
                }
            }
            let state = AppState {
                data_dir: data_dir.clone(),
            };
            for rule in &rules {
                if !rule.enabled {
                    continue;
                }
                let key = rule.id.clone();
                if running.contains(&rule.when_app) && !seen.contains(&key) {
                    // fire the macro once per app appearance
                    let _ = crate::theme::apply_accent_hex_raw(&rule.accent);
                    let _ = crate::theme::apply_mode_raw(&rule.mode);
                    if !rule.wallpaper.is_empty() {
                        let _ = crate::wallpaper::apply_wallpaper_raw(&rule.wallpaper);
                    }
                    let _ = undo::log_entry(
                        &state,
                        "macro_fired",
                        format!(
                            "Macro fired: {} is running → applied {}",
                            rule.when_app, rule.look_name
                        ),
                        json!({ "when_app": rule.when_app, "look": rule.look_name }),
                        false,
                    );
                    seen.insert(key);
                }
            }
            // reset seen for rules whose app is no longer running
            let seen_keys: Vec<String> = seen.iter().cloned().collect();
            for key in seen_keys {
                let app_missing = rules
                    .iter()
                    .find(|r| r.id == key)
                    .map(|r| !running.contains(&r.when_app))
                    .unwrap_or(true);
                if app_missing {
                    seen.remove(&key);
                }
            }
            let _ = rule_count;
        }
    });
}

// ---------------------------------------------------------------------------
// Focus mode (hide desktop icons + memory status)
// ---------------------------------------------------------------------------

fn hide_icons_raw(hide: bool) -> Result<(), AppError> {
    let key = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey_with_flags(
            r"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced",
            KEY_SET_VALUE,
        )
        .map_err(|e| AppError::Command(e.to_string()))?;
    key.set_value("HideIcons", &(if hide { 1u32 } else { 0u32 }))
        .map_err(|e| AppError::Command(e.to_string()))?;
    // refresh shell
    crate::cmd::hidden("powershell.exe")
        .args([
            "-NoProfile",
            "-Command",
            "(New-Object -ComObject Shell.Application).Windows() | ForEach-Object { $_.Refresh() }",
        ])
        .spawn()
        .ok();
    Ok(())
}

#[tauri::command]
pub fn set_focus_mode(state: State<'_, AppState>, on: bool) -> Result<String, AppError> {
    let before = hide_icons_state();
    hide_icons_raw(on)?;
    undo::log_entry(
        &state,
        "focus_mode",
        format!(
            "Focus mode {} — desktop icons {}",
            if on { "on" } else { "off" },
            if on { "hidden" } else { "restored" }
        ),
        json!({ "before_hide": before, "hide": on }),
        true,
    )?;
    Ok(if on {
        "Focus mode on — desktop icons hidden"
    } else {
        "Focus mode off — icons restored"
    }
    .into())
}

fn hide_icons_state() -> bool {
    RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced")
        .and_then(|k| k.get_value::<u32, _>("HideIcons"))
        .map(|v| v == 1)
        .unwrap_or(false)
}

// ---------------------------------------------------------------------------
// Focus sessions (S10.6) — a real timer (deadline persisted), real
// do-not-disturb (toast notifications off), desktop icons hidden while active,
// undoable start/stop, and a live countdown pushed into clock widgets.
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct FocusSession {
    pub active: bool,
    pub ends_at_ts: u64,
    pub minutes: u32,
    pub dnd_on: bool,
}



fn focus_path(state: &AppState) -> PathBuf {
    state.data_dir.join("focus_session.json")
}

fn notifications_key() -> Result<RegKey, AppError> {
    RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey(r"Software\Microsoft\Windows\CurrentVersion\Notifications\Settings")
        .map_err(|e| AppError::Command(format!("notifications key: {}", e)))
        .map(|(k, _)| k)
}

/// true = toasts enabled (the Windows default).
fn toasts_state() -> bool {
    notifications_key()
        .ok()
        .and_then(|k| k.get_value::<u32, _>("NOC_GLOBAL_SETTING_TOASTS_ENABLED").ok())
        .map(|v| v == 1)
        .unwrap_or(true)
}

fn set_toasts(on: bool) -> Result<(), AppError> {
    notifications_key()?
        .set_value("NOC_GLOBAL_SETTING_TOASTS_ENABLED", &(if on { 1u32 } else { 0u32 }))
        .map_err(|e| AppError::Command(format!("set toasts: {}", e)))
}

/// Undo support: revert a start/stop entry to the pre-change icon + toast state
/// and clear any active session.
pub(crate) fn restore_focus_before(
    state: &AppState,
    before_hide: bool,
    before_toasts: bool,
) -> Result<(), AppError> {
    hide_icons_raw(before_hide)?;
    set_toasts(before_toasts)?;
    save_json(&focus_path(state), &FocusSession::default())?;
    Ok(())
}

/// Restore the desktop (icons + toasts) after a session ends. Logs the end so
/// History shows the full lifecycle.
pub(crate) fn finish_focus_session(state: &AppState) -> Result<(), AppError> {
    let session = load_focus_session(state);
    hide_icons_raw(false)?;
    if session.dnd_on {
        set_toasts(true)?;
    }
    let ended = FocusSession {
        active: false,
        ends_at_ts: 0,
        minutes: 0,
        dnd_on: false,
    };
    save_json(&focus_path(state), &ended)?;
    undo::log_entry(
        state,
        "focus_session",
        "Focus session ended — desktop restored".into(),
        json!({ "ended": true, "minutes": session.minutes }),
        true,
    )?;
    Ok(())
}

fn load_focus_session(state: &AppState) -> FocusSession {
    load_json(&focus_path(state), FocusSession::default())
}

/// Push the remaining seconds into clock widgets (`window.__setFocus`) so the
/// countdown is visible on the desktop itself, not just the app.
fn push_focus_tick(app: &tauri::AppHandle, remaining_secs: u64) {
    let app2 = app.clone();
    let app3 = app.clone();
    let _ = app2.run_on_main_thread(move || {
        for label in app3.webview_windows().keys() {
            if label.starts_with("widget-") {
                let _ = app3
                    .get_webview_window(label)
                    .and_then(|w| w.eval(format!("window.__setFocus && window.__setFocus({})", remaining_secs)).ok());
            }
        }
    });
}

/// Start a focus session: hide desktop icons, mute toast notifications, persist
/// the deadline, and spawn a ticker that updates clock widgets and auto-restores
/// the desktop when the timer runs out. Undoable (kind "focus_session").
#[tauri::command]
pub fn start_focus_session(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    minutes: u32,
) -> Result<FocusSession, AppError> {
    let minutes = minutes.clamp(5, 180);
    let before_hide = hide_icons_state();
    let before_toasts = toasts_state();
    hide_icons_raw(true)?;
    set_toasts(false)?;
    let ends = now_millis() + minutes as u64 * 60_000;
    let session = FocusSession {
        active: true,
        ends_at_ts: ends,
        minutes,
        dnd_on: true,
    };
    save_json(&focus_path(&state), &session)?;
    undo::log_entry(
        &state,
        "focus_session",
        format!("Focus session started — {} min", minutes),
        json!({
            "before_hide": before_hide,
            "before_toasts": before_toasts,
            "ended": false,
        }),
        true,
    )?;

    // Ticker: 5s cadence; ends the session (and restores the desktop) when the
    // deadline passes, and keeps the widget countdown live meanwhile.
    let state2 = AppState {
        data_dir: state.data_dir.clone(),
    };
    let app2 = app.clone();
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(std::time::Duration::from_secs(5));
            let s = load_focus_session(&state2);
            if !s.active {
                push_focus_tick(&app2, 0);
                return;
            }
            let remaining = s.ends_at_ts.saturating_sub(now_millis()) / 1000;
            if remaining == 0 {
                // deadline passed — restore the desktop and stop ticking
                let _ = finish_focus_session(&state2);
                push_focus_tick(&app2, 0);
                return;
            }
            push_focus_tick(&app2, remaining);
        }
    });
    Ok(session)
}

/// Stop a focus session early — restores icons + toasts, logs an undoable stop.
#[tauri::command]
pub fn stop_focus_session(state: State<'_, AppState>) -> Result<String, AppError> {
    finish_focus_session(&state)?;
    Ok("Focus session stopped — desktop restored".into())
}

#[tauri::command]
pub fn get_focus_session(state: State<'_, AppState>) -> FocusSession {
    load_focus_session(&state)
}

#[tauri::command]
pub fn get_focus_state() -> bool {
    hide_icons_state()
}

#[tauri::command]
pub fn get_ram_cleanup() -> serde_json::Value {
    unsafe {
        let mut st: MEMORYSTATUSEX = std::mem::zeroed();
        st.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
        if GlobalMemoryStatusEx(&mut st).is_ok() {
            return json!({
                "total_gb": st.ullTotalPhys as f64 / 1024.0 / 1024.0 / 1024.0,
                "avail_gb": st.ullAvailPhys as f64 / 1024.0 / 1024.0 / 1024.0,
                "load_pct": st.dwMemoryLoad,
            });
        }
    }
    json!({})
}
