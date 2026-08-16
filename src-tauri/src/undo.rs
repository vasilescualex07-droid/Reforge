use crate::state::AppState;
use crate::storage::{load_json, now_millis, save_json};
use crate::{cursors, duplicates, organize, startup, theme, wallpaper};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::PathBuf;
use tauri::State;
use uuid::Uuid;
use winreg::enums::{
    HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, REG_BINARY, REG_DWORD, REG_EXPAND_SZ, REG_MULTI_SZ,
    REG_QWORD, REG_SZ,
};
use winreg::{RegKey, RegValue};

use crate::error::AppError;
fn restore_registry_values(
    hive: &str,
    path: &str,
    backup: &serde_json::Value,
) -> Result<(), AppError> {
    let reg_hive = if hive == "HKLM" {
        HKEY_LOCAL_MACHINE
    } else {
        HKEY_CURRENT_USER
    };
    let (key, _) = RegKey::predef(reg_hive)
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
            let vtype = val
                .get("vtype")
                .and_then(|v| v.as_str())
                .unwrap_or("REG_SZ");
            let rt = match vtype {
                "REG_DWORD" => REG_DWORD,
                "REG_QWORD" => REG_QWORD,
                "REG_EXPAND_SZ" => REG_EXPAND_SZ,
                "REG_MULTI_SZ" => REG_MULTI_SZ,
                "REG_BINARY" => REG_BINARY,
                _ => REG_SZ,
            };
            key.set_raw_value(name, &RegValue { bytes, vtype: rt })
                .map_err(|e| AppError::Command(e.to_string()))?;
        }
    }
    Ok(())
}

#[derive(Serialize, Deserialize, Clone)]
pub struct UndoEntry {
    pub id: String,
    pub ts: u64,
    pub kind: String,
    pub description: String,
    pub revertible: bool,
    pub undone: bool,
    pub data: serde_json::Value,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Snapshot {
    pub id: String,
    pub ts: u64,
    pub state: serde_json::Value,
}

fn undo_path(state: &AppState) -> PathBuf {
    state.data_dir.join("undo_log.json")
}

fn load_undo(state: &AppState) -> Vec<UndoEntry> {
    load_json(&undo_path(state), Vec::new())
}

fn save_undo(state: &AppState, entries: &Vec<UndoEntry>) -> Result<(), AppError> {
    save_json(&undo_path(state), entries)
}

pub fn get_last_style_id(state: &AppState) -> Option<String> {
    load_undo(state)
        .into_iter()
        .rev()
        .find(|e| e.kind == "style_applied" && !e.undone)
        .and_then(|e| {
            e.data
                .get("style_id")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        })
}

pub fn log_entry(
    state: &AppState,
    kind: &str,
    description: String,
    data: serde_json::Value,
    revertible: bool,
) -> Result<(), AppError> {
    let mut entries = load_undo(state);
    entries.push(UndoEntry {
        id: Uuid::new_v4().to_string(),
        ts: now_millis(),
        kind: kind.to_string(),
        description,
        revertible,
        undone: false,
        data,
    });
    // Cap the log so undo.json doesn't grow unbounded with every action.
    if entries.len() > 200 {
        entries.drain(0..entries.len() - 200);
    }
    save_undo(state, &entries)
}

// ---- snapshot capture / restore ----

pub fn capture_state() -> serde_json::Value {
    json!({
        "accent": theme::current_accent_hex(),
        "mode": theme::current_mode(),
        "transparency": theme::current_transparency(),
        "wallpaper": wallpaper::current_wallpaper(),
        "hkcu_run": startup::capture_hkcu_run(),
    })
}

fn apply_state_to_system(state: &AppState, snap_state: &serde_json::Value) -> Result<(), AppError> {
    if let Some(hex) = snap_state.get("accent").and_then(|v| v.as_str()) {
        let before = theme::current_accent_hex();
        theme::apply_accent_hex_raw(hex)?;
        log_entry(
            state,
            "accent",
            format!("Restored accent {}", hex),
            json!({ "before": before, "after": hex }),
            true,
        )?;
    }
    if let Some(mode) = snap_state.get("mode").and_then(|v| v.as_str()) {
        let before = theme::current_mode();
        theme::apply_mode_raw(mode)?;
        log_entry(
            state,
            "mode",
            format!("Restored mode {}", mode),
            json!({ "before": before, "after": mode }),
            true,
        )?;
    }
    if let Some(on) = snap_state.get("transparency").and_then(|v| v.as_bool()) {
        let before = theme::current_transparency();
        theme::apply_transparency_raw(on)?;
        log_entry(
            state,
            "transparency",
            format!("Restored transparency {}", on),
            json!({ "before": before, "after": on }),
            true,
        )?;
    }
    if let Some(wp) = snap_state.get("wallpaper").and_then(|v| v.as_str()) {
        let before = wallpaper::current_wallpaper();
        wallpaper::apply_wallpaper_raw(wp)?;
        log_entry(
            state,
            "wallpaper",
            "Restored wallpaper".to_string(),
            json!({ "before": before, "after": wp }),
            true,
        )?;
    }
    if let Some(run) = snap_state.get("hkcu_run").and_then(|v| v.as_object()) {
        for (name, val) in run {
            let bytes: Vec<u8> = val
                .get("bytes")
                .and_then(|v| v.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|n| n.as_u64().map(|n| n as u8))
                        .collect()
                })
                .unwrap_or_default();
            let vtype = val
                .get("vtype")
                .and_then(|v| v.as_str())
                .unwrap_or("sz")
                .to_string();
            startup::restore_run_value(name, "HKCU Run", bytes, &vtype)?;
        }
    }
    Ok(())
}

fn snapshot_path(state: &AppState, id: &str) -> PathBuf {
    state.snapshots_dir().join(format!("{}.json", id))
}

fn list_snapshot_files(state: &AppState) -> Vec<(u64, PathBuf)> {
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(state.snapshots_dir()) {
        for e in rd.flatten() {
            let p = e.path();
            if p.extension().map(|x| x == "json").unwrap_or(false) {
                if let Ok(s) = std::fs::read_to_string(&p) {
                    if let Ok(snap) = serde_json::from_str::<Snapshot>(&s) {
                        out.push((snap.ts, p));
                    }
                }
            }
        }
    }
    out.sort_by_key(|(ts, _)| *ts);
    out
}

// ---- Tauri commands ----

pub fn load_undo_entries(state: &AppState) -> Vec<UndoEntry> {
    let mut entries = load_undo(state);
    entries.sort_by_key(|e| e.ts);
    entries.reverse();
    entries
}

#[tauri::command]
pub fn get_undo_log(state: State<'_, AppState>) -> Vec<UndoEntry> {
    load_undo_entries(&state)
}

#[tauri::command]
pub async fn revert_entry(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<String, AppError> {
    let mut entries = load_undo(&state);
    let idx = entries
        .iter()
        .position(|e| e.id == id)
        .ok_or_else(|| AppError::NotFound("entry not found".to_string()))?;
    let entry = entries[idx].clone();
    if !entry.revertible {
        return Err(AppError::Command(
            "This change cannot be reverted automatically.".to_string(),
        ));
    }
    match entry.kind.as_str() {
        "accent" => {
            let before = entry
                .data
                .get("before")
                .and_then(|v| v.as_str())
                .unwrap_or("#000000");
            theme::apply_accent_hex_raw(before)?;
        }
        "mode" => {
            let before = entry
                .data
                .get("before")
                .and_then(|v| v.as_str())
                .unwrap_or("dark");
            theme::apply_mode_raw(before)?;
        }
        "transparency" => {
            let before = entry
                .data
                .get("before")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            theme::apply_transparency_raw(before)?;
        }
        "wallpaper" => {
            let before = entry
                .data
                .get("before")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            wallpaper::apply_wallpaper_raw(before)?;
        }
        "startup_disable" => {
            let name = entry
                .data
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let location = entry
                .data
                .get("location")
                .and_then(|v| v.as_str())
                .unwrap_or("HKCU Run");
            let bytes: Vec<u8> = entry
                .data
                .get("bytes")
                .and_then(|v| v.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|n| n.as_u64().map(|n| n as u8))
                        .collect()
                })
                .unwrap_or_default();
            let vtype = entry
                .data
                .get("vtype")
                .and_then(|v| v.as_str())
                .unwrap_or("sz");
            startup::restore_run_value(name, location, bytes, vtype)?;
        }
        "startup_folder_disable" => {
            let name = entry
                .data
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            startup::restore_folder_entry(name)?;
        }
        "duplicates_removed" => {
            let moved: Vec<duplicates::MovedFile> =
                serde_json::from_value(entry.data.get("moved").cloned().unwrap_or_default())
                    .unwrap_or_default();
            duplicates::restore_moved(&state, &moved)?;
        }
        "sort" => {
            let moves: Vec<organize::MoveOp> =
                serde_json::from_value(entry.data.get("moves").cloned().unwrap_or_default())
                    .unwrap_or_default();
            for m in moves.iter().rev() {
                let to = std::path::PathBuf::from(&m.to);
                let from = std::path::PathBuf::from(&m.from);
                if to.exists() {
                    if let Some(parent) = from.parent() {
                        let _ = std::fs::create_dir_all(parent);
                    }
                    let _ = std::fs::rename(&to, &from);
                }
            }
        }
        "cursors" => {
            let before: cursors::CursorState =
                serde_json::from_value(entry.data.get("before").cloned().unwrap_or_default())
                    .unwrap_or_else(|_| cursors::read_cursor_state());
            cursors::restore_cursors(&state, &before)?;
        }
        "widget_layout" => {
            // revert = restore the pre-reset layout (positions/sizes/monitor)
            let before: Vec<crate::widgets::WidgetConfig> =
                serde_json::from_value(entry.data.get("before").cloned().unwrap_or_default())
                    .unwrap_or_default();
            crate::widgets::restore_layout(&app, &state, &before)?;
        }
        "power" => {
            // revert = restore the pre-change power snapshot (plan + screen-off
            // timeouts + hibernate)
            let before: crate::power::PowerSnapshot =
                serde_json::from_value(entry.data.get("before").cloned().unwrap_or_default())
                    .unwrap_or_default();
            crate::power::restore_snapshot(&before)?;
        }
        "game_profile" => {
            // revert = undo a profile apply (game mode + scene freeze + layout)
            let before = entry.data.get("before").cloned().unwrap_or_default();
            crate::gaming::restore_profile_before(&state, &before)?;
        }
        "accessibility" => {
            // revert = restore the exact before snapshot of every toggle
            let before: crate::accessibility::AccessibilitySnapshot =
                serde_json::from_value(entry.data.get("before").cloned().unwrap_or_default())
                    .unwrap_or_default();
            crate::accessibility::restore_snapshot(&before)?;
        }
        "focus_session" => {
            // revert = restore the pre-session icon + toast state and clear the
            // session (works for both start and stop entries)
            let before_hide = entry
                .data
                .get("before_hide")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let before_toasts = entry
                .data
                .get("before_toasts")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            crate::productivity::restore_focus_before(&state, before_hide, before_toasts)?;
        }
        "animated_wallpaper" => {
            // revert = stop the animated wallpaper and restore the static one
            crate::wallpaper_engine::stop_animated(&app, &state)?;
        }
        "animated_wallpaper_stop" => {
            let scene: crate::wallpaper_engine::SceneConfig =
                serde_json::from_value(entry.data.get("scene").cloned().unwrap_or_default())
                    .unwrap_or_else(|_| crate::wallpaper_engine::default_scene());
            crate::wallpaper_engine::start_scene(&app, &scene)?;
        }
        "registry_cleanup" => {
            let hive = entry
                .data
                .get("hive")
                .and_then(|v| v.as_str())
                .unwrap_or("HKCU");
            let parent = entry
                .data
                .get("parent")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let leaf = entry
                .data
                .get("leaf")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let backup = entry.data.get("backup").cloned().unwrap_or_default();
            restore_registry_values(hive, &format!("{}\\{}", parent, leaf), &backup)?;
        }
        "file_association" => {
            let ext = entry.data.get("ext").and_then(|v| v.as_str()).unwrap_or("");
            let backup = entry.data.get("backup").cloned().unwrap_or_default();
            let path = format!(
                r"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\{}\UserChoice",
                ext
            );
            restore_registry_values("HKCU", &path, &backup)?;
        }
        "browser_policy" => {
            let browser = entry
                .data
                .get("browser")
                .and_then(|v| v.as_str())
                .unwrap_or("Edge");
            let policy = entry
                .data
                .get("policy")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let before = entry.data.get("before").cloned().unwrap_or_default();
            let base = if browser == "Chrome" {
                r"Software\Policies\Google\Chrome"
            } else {
                r"Software\Policies\Microsoft\Edge"
            };
            let key = RegKey::predef(HKEY_CURRENT_USER)
                .create_subkey(base)
                .map_err(|e| AppError::Command(e.to_string()))?
                .0;
            match before.as_u64() {
                Some(v) => {
                    key.set_value(policy, &(v as u32))
                        .map_err(|e| AppError::Command(e.to_string()))?;
                }
                None => {
                    let _ = key.delete_value(policy);
                }
            }
        }
        "power_plan" => {
            let guid = entry
                .data
                .get("before_guid")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if !guid.is_empty() {
                crate::cmd::hidden("powercfg")
                    .args(["/setactive", guid])
                    .output()
                    .map_err(|e| AppError::Command(e.to_string()))?;
            }
        }
        "wifi_forgot" => {
            let backup = entry
                .data
                .get("backup")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if !backup.is_empty() && std::path::Path::new(backup).exists() {
                crate::cmd::hidden("netsh")
                    .args(["wlan", "add", "profile", &format!("filename={}", backup)])
                    .output()
                    .map_err(|e| AppError::Command(e.to_string()))?;
            }
        }
        "vpn_connect" | "vpn_disconnect" => {
            // restore the VPN's previous state (reconnect if it was connected, etc.)
            let name = entry
                .data
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if !name.is_empty() {
                let before = entry
                    .data
                    .get("before_status")
                    .and_then(|v| v.as_str())
                    .unwrap_or("disconnected");
                if before == "connected" {
                    let _ = crate::network::vpn_connect_raw(name);
                } else {
                    let _ = crate::network::vpn_disconnect_raw(name);
                }
            }
        }
        "game_mode" => {
            let before = entry
                .data
                .get("before")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let key = RegKey::predef(HKEY_CURRENT_USER)
                .create_subkey(r"Software\Microsoft\GameBar")
                .map_err(|e| AppError::Command(e.to_string()))?
                .0;
            let v = if before { 1u32 } else { 0u32 };
            let _ = key.set_value("AutoGameModeEnabled", &v);
            let _ = key.set_value("AllowAutoGameMode", &v);
        }
        "stream_layout" => {
            let before = entry.data.get("before").cloned().unwrap_or_default();
            let icons = before
                .get("icons_hidden")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let autohide = before
                .get("taskbar_autohide")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let key = RegKey::predef(HKEY_CURRENT_USER)
                .create_subkey(r"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced")
                .map_err(|e| AppError::Command(e.to_string()))?
                .0;
            let _ = key.set_value("HideIcons", &(if icons { 1u32 } else { 0u32 }));
            let _ = key.set_value("TaskbarAutoHide", &(if autohide { 1u32 } else { 0u32 }));
        }
        "focus_mode" => {
            let before = entry
                .data
                .get("before_hide")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let key = RegKey::predef(HKEY_CURRENT_USER)
                .create_subkey(r"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced")
                .map_err(|e| AppError::Command(e.to_string()))?
                .0;
            let _ = key.set_value("HideIcons", &(if before { 1u32 } else { 0u32 }));
        }
        "permission" => {
            let id = entry
                .data
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("Microphone");
            let before = entry
                .data
                .get("before")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            let path = format!(
                r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\{}",
                id
            );
            let key = RegKey::predef(HKEY_CURRENT_USER)
                .create_subkey(path)
                .map_err(|e| AppError::Command(e.to_string()))?
                .0;
            key.set_value("Value", &(if before { "Allow" } else { "Deny" }))
                .map_err(|e| AppError::Command(e.to_string()))?;
        }
        "blue_light" => {
            let before = entry
                .data
                .get("before")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            if before {
                let _ =
                    crate::automation::apply_blue_light_raw(crate::automation::default_intensity());
            } else {
                crate::automation::apply_identity_ramp_pub()?;
            }
        }
        "archive" => {
            let zip_path = entry
                .data
                .get("zip")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let dir = entry
                .data
                .get("dir")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            if !zip_path.is_empty() {
                let file =
                    std::fs::File::open(&zip_path).map_err(|e| AppError::Command(e.to_string()))?;
                let mut archive =
                    zip::ZipArchive::new(file).map_err(|e| AppError::Command(e.to_string()))?;
                for i in 0..archive.len() {
                    let mut f = archive
                        .by_index(i)
                        .map_err(|e| AppError::Command(e.to_string()))?;
                    let name = f.name().to_string();
                    let out = std::path::Path::new(&dir).join(&name);
                    if let Some(parent) = out.parent() {
                        let _ = std::fs::create_dir_all(parent);
                    }
                    let mut out_f = std::fs::File::create(&out)
                        .map_err(|e| AppError::Command(e.to_string()))?;
                    std::io::copy(&mut f, &mut out_f)
                        .map_err(|e| AppError::Command(e.to_string()))?;
                }
            }
        }
        "sound_scheme" => {
            let before = entry
                .data
                .get("before")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if !before.is_empty() {
                crate::sounds::restore_scheme(before)?;
            }
        }
        "sound_event" => {
            let event = entry
                .data
                .get("event")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let before = entry
                .data
                .get("before")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if !event.is_empty() {
                crate::sounds::restore_event(event, before)?;
            }
        }
        "font_substitution" => {
            let original = entry
                .data
                .get("original")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let before = entry
                .data
                .get("before")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if !original.is_empty() {
                crate::fonts::restore_substitution(original, before)?;
            }
        }
        "rgb_color" => {
            let device_index = entry
                .data
                .get("device_index")
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as u32;
            let before_colors: Vec<[u8; 3]> = serde_json::from_value(
                entry.data.get("before_colors").cloned().unwrap_or_default(),
            )
            .unwrap_or_default();
            if !before_colors.is_empty() {
                crate::rgb::restore_colors(device_index, &before_colors)?;
            }
        }
        "video_wallpaper" => {
            crate::wallpaper_video::stop_video(&app, &state)?;
        }
        "video_wallpaper_stop" => {
            let video: crate::wallpaper_engine::VideoWallpaper =
                serde_json::from_value(entry.data.get("video").cloned().unwrap_or_default())
                    .unwrap_or_else(|_| {
                        // fallback: create a minimal video wallpaper
                        crate::wallpaper_engine::VideoWallpaper {
                            path: String::new(),
                            kind: "video".into(),
                            width: 0,
                            height: 0,
                            name: "restored".into(),
                        }
                    });
            if !video.path.is_empty() {
                crate::wallpaper_video::start_video(&app, &video)?;
            }
        }
        "style_applied" => {
            let before = entry.data.get("before").cloned().unwrap_or_default();
            if let Some(hex) = before.get("accent").and_then(|v| v.as_str()) {
                let _ = crate::theme::apply_accent_hex_raw(hex);
            }
            if let Some(mode) = before.get("mode").and_then(|v| v.as_str()) {
                let _ = crate::theme::apply_mode_raw(mode);
            }
            if let Some(t) = before.get("transparency").and_then(|v| v.as_bool()) {
                let _ = crate::theme::apply_transparency_raw(t);
            }
            if let Some(wp) = before.get("wallpaper").and_then(|v| v.as_str()) {
                if !wp.is_empty() {
                    let _ = crate::wallpaper::apply_wallpaper_raw(wp);
                }
            }
            // restore the engine (scene / video / static) exactly as it was
            let _ = crate::wallpaper_engine::stop_animated(&app, &state);
            let _ = crate::wallpaper_video::stop_video(&app, &state);
            if let Some(eng) = before.get("engine") {
                let active = eng.get("active").and_then(|v| v.as_bool()).unwrap_or(false);
                if active {
                    if let Some(scene) = eng.get("scene") {
                        if let Ok(sc) = serde_json::from_value(scene.clone()) {
                            let _ = crate::wallpaper_engine::start_scene(&app, &sc);
                        }
                    } else if let Some(media) = eng.get("media") {
                        if let Ok(v) = serde_json::from_value::<
                            crate::wallpaper_engine::VideoWallpaper,
                        >(media.clone())
                        {
                            if !v.path.is_empty() {
                                let _ = crate::wallpaper_video::start_video(&app, &v);
                            }
                        }
                    }
                    let restored = crate::wallpaper_engine::EngineState {
                        active: true,
                        frozen: eng.get("frozen").and_then(|v| v.as_bool()).unwrap_or(false),
                        scene: serde_json::from_value(
                            eng.get("scene").cloned().unwrap_or_default(),
                        )
                        .unwrap_or_default(),
                        media: serde_json::from_value(
                            eng.get("media").cloned().unwrap_or_default(),
                        )
                        .unwrap_or_default(),
                        static_wallpaper: eng
                            .get("static_wallpaper")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                    };
                    let _ = crate::wallpaper_engine::save_engine(&state, &restored);
                } else {
                    let _ = crate::wallpaper_engine::save_engine(
                        &state,
                        &crate::wallpaper_engine::EngineState::default(),
                    );
                }
            }
            // deeper components (A1.6): sound scheme, font substitution, RGB
            if let Some(guid) = before.get("sound_scheme").and_then(|v| v.as_str()) {
                if !guid.is_empty() {
                    let _ = crate::sounds::restore_scheme(guid);
                }
            }
            if let Some(f) = before.get("font") {
                let original = f.get("original").and_then(|v| v.as_str()).unwrap_or("");
                let b = f.get("before").and_then(|v| v.as_str()).unwrap_or("");
                if !original.is_empty() {
                    let _ = crate::fonts::restore_substitution(original, b);
                }
            }
            if let Some(rgb_arr) = before.get("rgb").and_then(|v| v.as_array()) {
                for dev in rgb_arr {
                    let di = dev
                        .get("device_index")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0) as u32;
                    let colors: Vec<[u8; 3]> = serde_json::from_value(
                        dev.get("before_colors").cloned().unwrap_or_default(),
                    )
                    .unwrap_or_default();
                    if !colors.is_empty() {
                        let _ = crate::rgb::restore_colors(di, &colors);
                    }
                }
            }
        }
        "marketplace_apply" => {
            if let Some(before) = entry.data.get("before") {
                if let Some(hex) = before.get("accent").and_then(|v| v.as_str()) {
                    let _ = crate::theme::apply_accent_hex_raw(hex);
                }
                if let Some(mode) = before.get("mode").and_then(|v| v.as_str()) {
                    let _ = crate::theme::apply_mode_raw(mode);
                }
                if let Some(wp) = before.get("wallpaper").and_then(|v| v.as_str()) {
                    let _ = crate::wallpaper::apply_wallpaper_raw(wp);
                }
                // restore the full composite: taskbar, lock screen, cursor, sound scheme
                if let Some(tb) = before.get("taskbar") {
                    if let Some(size) = tb.get("size").and_then(|v| v.as_str()) {
                        let v = match size {
                            "small" => 0u32,
                            "large" => 2u32,
                            _ => 1u32,
                        };
                        let _ = crate::shell::set_taskbar_value_raw("TaskbarSi", v);
                    }
                    if let Some(align) = tb.get("alignment").and_then(|v| v.as_str()) {
                        let v = if align == "left" { 0u32 } else { 1u32 };
                        let _ = crate::shell::set_taskbar_value_raw("TaskbarAl", v);
                    }
                    if let Some(auto) = tb.get("autohide").and_then(|v| v.as_bool()) {
                        let _ = crate::shell::set_taskbar_value_raw(
                            "TaskbarAutoHide",
                            if auto { 1u32 } else { 0u32 },
                        );
                    }
                }
                if let Some(ls) = before.get("lockscreen") {
                    let snap: crate::lockscreen::LockScreenState =
                        serde_json::from_value(ls.clone()).unwrap_or_else(|_| {
                            crate::lockscreen::LockScreenState {
                                mode: "spotlight".into(),
                                image_path: None,
                                slideshow_folder: None,
                                slideshow_interval_secs: None,
                                slideshow_shuffle: None,
                                hide_apps: None,
                            }
                        });
                    let _ = crate::lockscreen::restore_state(&state, &snap);
                }
                if let Some(cursor) = before.get("cursor") {
                    let c: crate::cursors::CursorState = serde_json::from_value(cursor.clone())
                        .unwrap_or_else(|_| crate::cursors::read_cursor_state());
                    let _ = crate::cursors::restore_cursors(&state, &c);
                }
                if let Some(scheme) = before.get("sound_scheme").and_then(|v| v.as_str()) {
                    if !scheme.is_empty() {
                        let _ = crate::sounds::restore_scheme(scheme);
                    }
                }
            }
        }
        "taskbar_size" | "taskbar_alignment" => {
            let name = entry
                .data
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let before = entry.data.get("before").and_then(|v| v.as_u64());
            let vals = vec![json!({ "name": name, "before": before })];
            crate::shell::restore_taskbar_registry(&vals)?;
        }
        "taskbar_autohide" => {
            let before = entry
                .data
                .get("before")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            crate::shell::set_taskbar_value_raw(
                "TaskbarAutoHide",
                if before { 1u32 } else { 0u32 },
            )?;
        }
        "taskbar_color_match" => {
            let before = entry
                .data
                .get("before")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            if before {
                let hex = crate::theme::current_accent_hex();
                crate::theme::apply_accent_hex_raw(&hex)?;
            } else {
                let key = crate::theme::personalize_key_pub()?;
                key.set_value("ColorPrevalence", &0u32)
                    .map_err(|e| AppError::Command(e.to_string()))?;
            }
        }
        "taskbar_position" => {
            let backup = entry.data.get("before_bytes").cloned().unwrap_or_default();
            crate::shell::restore_taskbar_position(&backup)?;
        }
        "lock_screen" => {
            let snap: crate::lockscreen::LockScreenState =
                serde_json::from_value(entry.data.get("before").cloned().unwrap_or_default())
                    .unwrap_or_else(|_| crate::lockscreen::LockScreenState {
                        mode: "spotlight".into(),
                        image_path: None,
                        slideshow_folder: None,
                        slideshow_interval_secs: None,
                        slideshow_shuffle: None,
                        hide_apps: None,
                    });
            crate::lockscreen::restore_state(&state, &snap)?;
        }
        "font_install" => {
            let name = entry
                .data
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if !name.is_empty() {
                crate::fonts::uninstall_font_raw(name)?;
            }
        }
        "font_uninstall" => {
            // the file was moved to the fonts backup dir, not deleted — move it back
            let moved: Vec<crate::fonts::MovedFontFile> =
                serde_json::from_value(entry.data.get("moved").cloned().unwrap_or_default())
                    .unwrap_or_default();
            if !moved.is_empty() {
                crate::fonts::restore_moved_fonts(&moved)?;
            }
        }
        "rename" => {
            let ops: Vec<crate::files::RenameOp> =
                serde_json::from_value(entry.data.get("ops").cloned().unwrap_or_default())
                    .unwrap_or_default();
            for op in ops.iter().rev() {
                let to = std::path::PathBuf::from(&op.to);
                let from = std::path::PathBuf::from(&op.from);
                if to.exists() {
                    let _ = std::fs::rename(&to, &from);
                }
            }
        }
        "wallpaper_slideshow" => {
            // restore the previous slideshow config (folder/interval/shuffle/enabled)
            let before: crate::wallpaper_static::SlideshowConfig =
                serde_json::from_value(entry.data.get("before").cloned().unwrap_or_default())
                    .unwrap_or_default();
            crate::storage::save_json(&state.data_dir.join("wallpaper_slideshow.json"), &before)?;
        }
        "display_profile" => {
            let monitors: Vec<crate::wallpaper::MonitorInfo> = serde_json::from_value(
                entry
                    .data
                    .get("before_monitors")
                    .cloned()
                    .unwrap_or_default(),
            )
            .unwrap_or_default();
            for m in &monitors {
                if !m.wallpaper.is_empty() {
                    let _ = crate::wallpaper::apply_monitor_wallpaper_raw(&m.id, &m.wallpaper);
                }
            }
        }
        _ => {
            return Err(AppError::Command(format!(
                "Cannot revert kind '{}'",
                entry.kind
            )))
        }
    }
    entries[idx].undone = true;
    save_undo(&state, &entries)?;
    Ok(format!("Reverted: {}", entry.description))
}

#[tauri::command]
pub fn snapshot_now(state: State<'_, AppState>) -> Result<Snapshot, AppError> {
    let snap = Snapshot {
        id: Uuid::new_v4().to_string(),
        ts: now_millis(),
        state: capture_state(),
    };
    save_json(&snapshot_path(&state, &snap.id), &snap)?;
    log_entry(
        &state,
        "snapshot",
        "Snapshot created (pre-makeover state)".to_string(),
        json!({ "snapshot_id": snap.id }),
        false,
    )?;
    Ok(snap)
}

#[tauri::command]
pub fn list_snapshots(state: State<'_, AppState>) -> Vec<Snapshot> {
    list_snapshot_files(&state)
        .into_iter()
        .filter_map(|(_, p)| std::fs::read_to_string(&p).ok())
        .filter_map(|s| serde_json::from_str::<Snapshot>(&s).ok())
        .collect()
}

#[tauri::command]
pub async fn restore_snapshot(state: State<'_, AppState>, id: String) -> Result<String, AppError> {
    let path = snapshot_path(&state, &id);
    let snap = load_json::<Snapshot>(
        &path,
        Snapshot {
            id,
            ts: 0,
            state: json!({}),
        },
    );
    if snap.id.is_empty() {
        return Err(AppError::NotFound("snapshot not found".to_string()));
    }
    apply_state_to_system(&state, &snap.state)?;
    Ok(format!("Restored snapshot from {}", snap.ts))
}

#[tauri::command]
pub async fn factory_fresh(state: State<'_, AppState>) -> Result<String, AppError> {
    let files = list_snapshot_files(&state);
    let (_, path) = files
        .first()
        .ok_or_else(|| "No snapshot exists yet. Create one before reverting.".to_string())?;
    let snap = std::fs::read_to_string(path)
        .map_err(|e| AppError::Command(e.to_string()))
        .and_then(|s| {
            serde_json::from_str::<Snapshot>(&s).map_err(|e| AppError::Command(e.to_string()))
        })?;
    apply_state_to_system(&state, &snap.state)?;
    Ok("Restored your pre-makeover state".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Hand-rolled temp dir (same pattern as wallpaper.rs) so these need no dev-dependency.
    struct TestDir(PathBuf);

    impl TestDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "reforge-undo-test-{}-{}",
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

    fn entry(kind: &str, revertible: bool, data: serde_json::Value) -> UndoEntry {
        UndoEntry {
            id: format!("id-{kind}"),
            ts: 1_700_000_000_000,
            kind: kind.to_string(),
            description: format!("changed {kind}"),
            revertible,
            undone: false,
            data,
        }
    }

    fn json(e: &UndoEntry) -> serde_json::Value {
        serde_json::to_value(e).unwrap()
    }

    #[test]
    fn undo_log_roundtrip_preserves_entries_in_order() {
        let t = TestDir::new();
        let entries = vec![
            entry("accent", true, serde_json::json!({ "before": "#6D7CFF" })),
            entry("mode", true, serde_json::json!({ "before": "dark" })),
            entry("wallpaper", false, serde_json::json!({ "before": "", "after": "C:\\a.jpg" })),
        ];
        save_undo(&t.state(), &entries).unwrap();

        let back = load_undo(&t.state());
        assert_eq!(back.len(), 3);
        assert_eq!(json(&back[0]), json(&entries[0]));
        assert_eq!(json(&back[1]), json(&entries[1]));
        assert_eq!(json(&back[2]), json(&entries[2]));
    }

    #[test]
    fn missing_undo_file_loads_empty() {
        let t = TestDir::new();
        assert!(load_undo(&t.state()).is_empty());
    }

    /// S4.4 — revert-coverage guard: every canonical revertible kind's payload
    /// must survive the undo-log persistence layer that revert_entry reads
    /// from, so a revert arm always sees the data it was written with.
    #[test]
    fn every_canonical_revertible_kind_payload_roundtrips() {
        let t = TestDir::new();
        let kinds = [
            ("accent", serde_json::json!({ "before": "#123456" })),
            ("mode", serde_json::json!({ "before": "light" })),
            ("transparency", serde_json::json!({ "before": false })),
            ("wallpaper", serde_json::json!({ "before": "C:\\old.jpg", "after": "C:\\new.jpg" })),
            ("style_applied", serde_json::json!({ "before": { "accent": "#000000" }, "style_id": "wp-x" })),
            ("animated_wallpaper", serde_json::json!({ "static_wallpaper": "C:\\s.jpg" })),
            ("video", serde_json::json!({ "before": "C:\\v.mp4" })),
            ("startup_disable", serde_json::json!({ "name": "BadApp.exe", "location": "HKLM" })),
            ("duplicates_removed", serde_json::json!({ "paths": ["C:\\d1.jpg", "C:\\d2.jpg"] })),
            ("sort", serde_json::json!({ "before": "name" })),
            ("cursors", serde_json::json!({ "before": "default" })),
            ("power_plan", serde_json::json!({ "before": "balanced" })),
            ("blue_light", serde_json::json!({ "before": true })),
            ("marketplace_apply", serde_json::json!({ "pack_id": "pack-1" })),
            ("display_profile", serde_json::json!({ "before": "default" })),
        ];
        let entries: Vec<UndoEntry> = kinds
            .iter()
            .map(|(k, d)| entry(k, true, d.clone()))
            .collect();
        save_undo(&t.state(), &entries).unwrap();

        let back = load_undo(&t.state());
        assert_eq!(back.len(), kinds.len());
        for (i, (k, d)) in kinds.iter().enumerate() {
            assert_eq!(back[i].kind, *k);
            assert!(back[i].revertible);
            assert_eq!(back[i].data, *d, "payload for kind {k} must survive round-trip");
        }
    }
}
