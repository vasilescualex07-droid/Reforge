use crate::state::AppState;
use crate::storage::{load_json, save_json};
use crate::undo;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::PathBuf;
use tauri::State;
use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, REG_BINARY, REG_DWORD, REG_SZ};
use winreg::{RegKey, RegValue};

use crate::error::AppError;
const ADVANCED: &str = r"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced";
const FONT_SUBS: &str = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\FontSubstitutes";

// ---------------------------------------------------------------------------
// Explorer-Restart Orchestrator
//
// Multiple shell changes (taskbar, font) mark "pending restart" in one file.
// Restarting explorer happens exactly once, when the user confirms, and the
// pending state survives crashes/reboots so the safe-mode fallback can act.
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct PendingShell {
    pub pending_restart: bool,
    pub changes: Vec<String>,
    pub last_known_good: serde_json::Value, // hive -> path -> {name: {bytes, vtype}}
}

fn pending_path(state: &AppState) -> PathBuf {
    state.data_dir.join("pending_shell.json")
}

fn load_pending(state: &AppState) -> PendingShell {
    load_json(&pending_path(state), PendingShell::default())
}

fn save_pending(state: &AppState, p: &PendingShell) -> Result<(), AppError> {
    save_json(&pending_path(state), p)
}

/// Read a registry path's values into the portable backup format.
fn capture_values(hive: winreg::HKEY, path: &str) -> serde_json::Value {
    let mut map = serde_json::Map::new();
    if let Ok(key) = RegKey::predef(hive).open_subkey(path) {
        for (name, value) in key.enum_values().filter_map(|v| v.ok()) {
            map.insert(
                name,
                json!({
                    "bytes": value.bytes,
                    "vtype": crate::startup::vtype_name(&value.vtype),
                }),
            );
        }
    }
    serde_json::Value::Object(map)
}

fn restore_captured(
    hive: winreg::HKEY,
    path: &str,
    backup: &serde_json::Value,
) -> Result<(), AppError> {
    let (key, _) = RegKey::predef(hive)
        .create_subkey(path)
        .map_err(|e| AppError::Command(e.to_string()))?;
    if let Some(obj) = backup.as_object() {
        for (name, val) in obj {
            let bytes: Vec<u8> = val
                .get("bytes")
                .and_then(|b| b.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|n| n.as_u64().map(|n| n as u8))
                        .collect()
                })
                .unwrap_or_default();
            let rt = match val.get("vtype").and_then(|v| v.as_str()) {
                Some("REG_DWORD") => REG_DWORD,
                Some("REG_BINARY") => REG_BINARY,
                _ => REG_SZ,
            };
            key.set_raw_value(name, &RegValue { bytes, vtype: rt })
                .map_err(|e| AppError::Command(e.to_string()))?;
        }
    }
    Ok(())
}

/// Snapshot the current taskbar + font keys into last_known_good (called before
/// the first pending change so we always have a restore point).
fn ensure_last_known_good(state: &AppState) -> Result<(), AppError> {
    let mut pending = load_pending(state);
    if pending.last_known_good.is_null() {
        pending.last_known_good = json!({
            "hkcu_advanced": capture_values(HKEY_CURRENT_USER, ADVANCED),
            "hklm_fontsubs": capture_values(HKEY_LOCAL_MACHINE, FONT_SUBS),
        });
        save_pending(state, &pending)?;
    }
    Ok(())
}

pub(crate) fn mark_pending(state: &AppState, change: &str) -> Result<(), AppError> {
    ensure_last_known_good(state)?;
    let mut pending = load_pending(state);
    pending.pending_restart = true;
    if !pending.changes.contains(&change.to_string()) {
        pending.changes.push(change.to_string());
    }
    save_pending(state, &pending)
}

/// On startup: if a shell change was pending and explorer isn't healthy, restore
/// the last known good state so the user never faces a broken shell silently.
pub fn check_safe_mode_fallback(state: &AppState) -> bool {
    let pending = load_pending(state);
    if !pending.pending_restart {
        return false;
    }
    let explorer_running = crate::cmd::hidden("tasklist")
        .args(["/FI", "IMAGENAME eq explorer.exe"])
        .output()
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .to_lowercase()
                .contains("explorer.exe")
        })
        .unwrap_or(false);
    if !explorer_running {
        // explorer is down and we had pending shell changes — restore known good.
        let lkg = pending.last_known_good.clone();
        let _ = restore_captured(
            HKEY_CURRENT_USER,
            ADVANCED,
            lkg.get("hkcu_advanced").unwrap_or(&json!({})),
        );
        let _ = restore_captured(
            HKEY_LOCAL_MACHINE,
            FONT_SUBS,
            lkg.get("hklm_fontsubs").unwrap_or(&json!({})),
        );
        let cleared = PendingShell {
            pending_restart: false,
            changes: Vec::new(),
            last_known_good: serde_json::Value::Null,
        };
        let _ = save_pending(state, &cleared);
        true
    } else {
        // explorer is up — treat the pending change as applied and settle.
        let cleared = PendingShell {
            pending_restart: false,
            changes: Vec::new(),
            last_known_good: serde_json::Value::Null,
        };
        let _ = save_pending(state, &cleared);
        false
    }
}

// ---------------------------------------------------------------------------
// Taskbar state
// ---------------------------------------------------------------------------

fn advanced_key() -> Result<RegKey, AppError> {
    RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey(ADVANCED)
        .map(|(k, _)| k)
        .map_err(|e| AppError::Command(e.to_string()))
}

fn get_dword(name: &str) -> Option<u32> {
    advanced_key()
        .and_then(|k| {
            k.get_value(name)
                .map_err(|e| AppError::Command(e.to_string()))
        })
        .ok()
}

#[derive(Serialize, Clone)]
pub struct TaskbarState {
    pub size: String,      // "small" | "medium" | "large"
    pub alignment: String, // "left" | "center"
    pub autohide: bool,
    pub color_match: bool,
}

pub fn read_taskbar_state() -> TaskbarState {
    TaskbarState {
        size: match get_dword("TaskbarSi") {
            Some(0) => "small".into(),
            Some(2) => "large".into(),
            _ => "medium".into(),
        },
        alignment: match get_dword("TaskbarAl") {
            Some(0) => "left".into(),
            _ => "center".into(),
        },
        autohide: get_dword("TaskbarAutoHide")
            .map(|v| v == 1)
            .unwrap_or(false),
        color_match: crate::theme::current_color_prevalence(),
    }
}

#[tauri::command]
pub fn shell_get_taskbar_state() -> TaskbarState {
    read_taskbar_state()
}

#[tauri::command]
pub fn shell_get_taskbar_capabilities() -> serde_json::Value {
    let caps = crate::capability::compute();
    json!({
        "reposition_supported": caps.taskbar_reposition_supported,
        "size_supported": true,
        "alignment_supported": true,
        "autohide_supported": true,
        "color_match_supported": true,
        "is_win11": caps.is_win11,
        "note": if caps.is_win11 {
            "Windows 11 removed the ability to move the taskbar to the top/side. Position controls are hidden."
        } else {
            "Taskbar repositioning works on Windows 10 via StuckRects3."
        },
    })
}

fn apply_advanced_dword(
    state: &AppState,
    name: &str,
    value: u32,
    kind: &str,
    desc: String,
) -> Result<TaskbarState, AppError> {
    let before = get_dword(name);
    advanced_key()?
        .set_value(name, &value)
        .map_err(|e| AppError::Command(e.to_string()))?;
    mark_pending(state, kind)?;
    undo::log_entry(
        state,
        kind,
        desc,
        json!({ "name": name, "before": before, "after": value }),
        true,
    )?;
    notify_shell_change();
    Ok(read_taskbar_state())
}

pub(crate) fn notify_shell_change_pub() {
    notify_shell_change();
}

fn notify_shell_change() {
    use windows::Win32::Foundation::{LPARAM, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE,
    };
    let setting: Vec<u16> = "TraySettings".encode_utf16().chain(Some(0)).collect();
    unsafe {
        let _ = SendMessageTimeoutW(
            HWND_BROADCAST,
            WM_SETTINGCHANGE,
            WPARAM(0),
            LPARAM(setting.as_ptr() as isize),
            SMTO_ABORTIFHUNG,
            1000,
            None,
        );
    }
}

#[tauri::command]
pub fn shell_set_taskbar_size(
    state: State<'_, AppState>,
    size: String,
) -> Result<TaskbarState, AppError> {
    let v = match size.as_str() {
        "small" => 0,
        "large" => 2,
        _ => 1,
    };
    apply_advanced_dword(
        &state,
        "TaskbarSi",
        v,
        "taskbar_size",
        format!("Taskbar icon size → {}", size),
    )
}

#[tauri::command]
pub fn shell_set_taskbar_alignment(
    state: State<'_, AppState>,
    align: String,
) -> Result<TaskbarState, AppError> {
    let v = match align.as_str() {
        "left" => 0,
        _ => 1,
    };
    apply_advanced_dword(
        &state,
        "TaskbarAl",
        v,
        "taskbar_alignment",
        format!("Taskbar alignment → {}", align),
    )
}

#[tauri::command]
pub fn shell_set_taskbar_autohide(
    state: State<'_, AppState>,
    on: bool,
) -> Result<TaskbarState, AppError> {
    let before = get_dword("TaskbarAutoHide")
        .map(|v| v == 1)
        .unwrap_or(false);
    advanced_key()?
        .set_value("TaskbarAutoHide", &(if on { 1u32 } else { 0u32 }))
        .map_err(|e| AppError::Command(e.to_string()))?;
    // instant live feedback via the appbar API
    unsafe {
        use windows::Win32::UI::Shell::{
            SHAppBarMessage, ABE_BOTTOM, ABM_GETTASKBARPOS, ABM_SETSTATE, APPBARDATA,
        };
        let mut abd: APPBARDATA = std::mem::zeroed();
        abd.cbSize = std::mem::size_of::<APPBARDATA>() as u32;
        SHAppBarMessage(ABM_GETTASKBARPOS, &mut abd);
        let edge = abd.uEdge;
        let _ = edge;
        let mut set: APPBARDATA = std::mem::zeroed();
        set.cbSize = std::mem::size_of::<APPBARDATA>() as u32;
        set.uEdge = ABE_BOTTOM;
        set.lParam = windows::Win32::Foundation::LPARAM(on as isize);
        SHAppBarMessage(ABM_SETSTATE, &mut set);
    }
    mark_pending(&state, "taskbar_autohide")?;
    undo::log_entry(
        &state,
        "taskbar_autohide",
        format!("Taskbar auto-hide {}", if on { "on" } else { "off" }),
        json!({ "before": before, "after": on }),
        true,
    )?;
    notify_shell_change();
    Ok(read_taskbar_state())
}

#[tauri::command]
pub fn shell_set_taskbar_color_match(
    state: State<'_, AppState>,
    on: bool,
) -> Result<TaskbarState, AppError> {
    // pulls from the same Theme Studio accent pipeline — no reimplemented color extraction
    let before = crate::theme::current_color_prevalence();
    if on {
        let hex = crate::theme::current_accent_hex();
        crate::theme::apply_accent_hex_raw(&hex)?; // sets AccentColor + ColorPrevalence=1
    } else {
        let key = crate::theme::personalize_key_pub()?;
        key.set_value("ColorPrevalence", &0u32)
            .map_err(|e| AppError::Command(e.to_string()))?;
    }
    undo::log_entry(
        &state,
        "taskbar_color_match",
        format!("Taskbar color-match {}", if on { "on" } else { "off" }),
        json!({ "before": before, "after": on }),
        true,
    )?;
    Ok(read_taskbar_state())
}

// Raw setter for marketplace / automation (no undo log entry).
pub fn set_taskbar_value_raw(name: &str, value: u32) -> Result<(), AppError> {
    let (key, _) = RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey(ADVANCED)
        .map_err(|e| AppError::Command(e.to_string()))?;
    key.set_value(name, &value)
        .map_err(|e| AppError::Command(e.to_string()))
}

#[tauri::command]
pub fn shell_set_taskbar_position(
    state: State<'_, AppState>,
    side: String,
) -> Result<String, AppError> {
    let caps = crate::capability::compute();
    if !caps.taskbar_reposition_supported {
        return Err(AppError::Command(
            "Windows 11 removed taskbar repositioning. This control is hidden on this OS build."
                .into(),
        ));
    }
    // Windows 10 StuckRects3 path — well-documented community layout.
    let settings = RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey(r"Software\Microsoft\Windows\CurrentVersion\Explorer\StuckRects3")
        .map_err(|e| AppError::Command(e.to_string()))?
        .0;
    let before = settings
        .get_raw_value("Settings")
        .map(|v| v.bytes.clone())
        .ok();
    let (w, h) = {
        use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CXSCREEN, SM_CYSCREEN};
        unsafe { (GetSystemMetrics(SM_CXSCREEN), GetSystemMetrics(SM_CYSCREEN)) }
    };
    let mut buf = vec![0u8; 40];
    buf[0..4].copy_from_slice(&0x2Cu32.to_le_bytes());
    buf[4..8].copy_from_slice(&0i32.to_le_bytes());
    buf[8..12].copy_from_slice(&0i32.to_le_bytes());
    buf[12..16].copy_from_slice(&w.to_le_bytes());
    buf[16..20].copy_from_slice(&h.to_le_bytes());
    let dock = match side.as_str() {
        "top" => 1u32,
        "left" => 2,
        "right" => 3,
        _ => 0,
    };
    buf[20..24].copy_from_slice(&dock.to_le_bytes());
    settings
        .set_raw_value(
            "Settings",
            &RegValue {
                bytes: buf,
                vtype: REG_BINARY,
            },
        )
        .map_err(|e| AppError::Command(e.to_string()))?;
    mark_pending(&state, "taskbar_position")?;
    undo::log_entry(
        &state,
        "taskbar_position",
        format!("Taskbar moved to {}", side),
        json!({ "side": side, "before_bytes": before }),
        true,
    )?;
    Ok(format!(
        "Taskbar moved to {} (applies after the shell refresh)",
        side
    ))
}

// ---------------------------------------------------------------------------
// Pending restart commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn shell_get_pending_state(state: State<'_, AppState>) -> serde_json::Value {
    let p = load_pending(&state);
    json!({
        "pending": p.pending_restart,
        "changes": p.changes,
        "explorer_running": crate::cmd::hidden("tasklist")
            .args(["/FI", "IMAGENAME eq explorer.exe"])
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).to_lowercase().contains("explorer.exe"))
            .unwrap_or(false),
    })
}

#[tauri::command]
pub fn shell_apply_pending_restart(state: State<'_, AppState>) -> Result<String, AppError> {
    let mut pending = load_pending(&state);
    if !pending.pending_restart {
        return Ok("No pending shell changes — nothing to restart for.".into());
    }
    let n = pending.changes.len();
    // one restart for everything queued
    let _ = crate::cmd::hidden("taskkill")
        .args(["/f", "/im", "explorer.exe"])
        .output();
    std::thread::sleep(std::time::Duration::from_millis(900));
    let _ = crate::cmd::hidden("explorer.exe").spawn();
    // settle the queue
    pending.pending_restart = false;
    pending.changes.clear();
    pending.last_known_good = serde_json::Value::Null;
    save_pending(&state, &pending)?;
    undo::log_entry(
        &state,
        "shell_restart",
        format!("Restarted explorer to apply {} shell change(s)", n),
        json!({ "count": n }),
        false,
    )?;
    Ok(format!(
        "Explorer restarted — applied {} queued change(s).",
        n
    ))
}

/// Watchdog support: cancel pending shell changes and restore last known good
/// without restarting (used by the confirm-or-revert flow when a change looks wrong).
#[tauri::command]
pub fn shell_revert_pending(state: State<'_, AppState>) -> Result<String, AppError> {
    let pending = load_pending(&state);
    if pending.last_known_good.is_null() {
        return Ok("Nothing to revert — no pending shell changes.".into());
    }
    let lkg = pending.last_known_good.clone();
    restore_captured(
        HKEY_CURRENT_USER,
        ADVANCED,
        lkg.get("hkcu_advanced").unwrap_or(&json!({})),
    )?;
    restore_captured(
        HKEY_LOCAL_MACHINE,
        FONT_SUBS,
        lkg.get("hklm_fontsubs").unwrap_or(&json!({})),
    )?;
    let cleared = PendingShell {
        pending_restart: false,
        changes: Vec::new(),
        last_known_good: serde_json::Value::Null,
    };
    save_pending(&state, &cleared)?;
    Ok("Reverted all pending shell changes to the last known good state.".into())
}

// undo support ------------------------------------------------------------------

pub fn restore_taskbar_registry(entries: &[serde_json::Value]) -> Result<(), AppError> {
    // each entry: { name, before } — restore the DWORD
    for e in entries {
        let name = e.get("name").and_then(|v| v.as_str()).unwrap_or("");
        let before = e.get("before").and_then(|v| v.as_u64());
        if name.is_empty() {
            continue;
        }
        let key = advanced_key()?;
        match before {
            Some(v) => key
                .set_value(name, &(v as u32))
                .map_err(|e| AppError::Command(e.to_string()))?,
            None => {
                let _ = key.delete_value(name);
            }
        }
    }
    Ok(())
}

pub fn restore_taskbar_position(backup: &serde_json::Value) -> Result<(), AppError> {
    let bytes: Option<Vec<u8>> = backup
        .get("before_bytes")
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|n| n.as_u64().map(|n| n as u8))
                .collect()
        });
    let key = RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey(r"Software\Microsoft\Windows\CurrentVersion\Explorer\StuckRects3")
        .map_err(|e| AppError::Command(e.to_string()))?
        .0;
    match bytes {
        Some(b) if !b.is_empty() => key
            .set_raw_value(
                "Settings",
                &RegValue {
                    bytes: b,
                    vtype: REG_BINARY,
                },
            )
            .map_err(|e| AppError::Command(e.to_string())),
        _ => {
            let _ = key.delete_value("Settings");
            Ok(())
        }
    }
}
