use crate::error::AppError;
use crate::state::AppState;
use crate::storage::{load_json, now_millis, save_json};
use crate::undo;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::PathBuf;
use tauri::State;
use uuid::Uuid;
use windows::core::PCWSTR;
use windows::Win32::Graphics::Gdi::{
    EnumDisplayDevicesW, EnumDisplaySettingsW, DEVMODEW, DISPLAY_DEVICEW, ENUM_CURRENT_SETTINGS,
};

#[derive(Serialize, Clone)]
pub struct MonitorInfo {
    pub id: String,
    pub name: String,
    pub resolution: String,
    pub refresh: u32,
    pub primary: bool,
}

fn devmode_to_str(dm: &DEVMODEW) -> String {
    format!("{}x{}", dm.dmPelsWidth, dm.dmPelsHeight)
}

#[tauri::command]
pub fn get_display_info() -> Vec<MonitorInfo> {
    let mut out = Vec::new();
    unsafe {
        let mut i = 0u32;
        loop {
            let mut dev: DISPLAY_DEVICEW = std::mem::zeroed();
            dev.cb = std::mem::size_of::<DISPLAY_DEVICEW>() as u32;
            let ok = EnumDisplayDevicesW(PCWSTR(std::ptr::null()), i, &mut dev, 0).as_bool();
            if !ok {
                break;
            }
            let name_len = dev.DeviceName.iter().position(|&c| c == 0).unwrap_or(32);
            let name = String::from_utf16_lossy(&dev.DeviceName[..name_len]);
            let mut dm: DEVMODEW = std::mem::zeroed();
            dm.dmSize = std::mem::size_of::<DEVMODEW>() as u16;
            let has_settings = EnumDisplaySettingsW(
                PCWSTR(dev.DeviceName.as_ptr()),
                ENUM_CURRENT_SETTINGS,
                &mut dm,
            )
            .as_bool();
            if has_settings {
                let is_primary = dm.Anonymous1.Anonymous2.dmPosition.x == 0
                    && dm.Anonymous1.Anonymous2.dmPosition.y == 0;
                out.push(MonitorInfo {
                    id: name.clone(),
                    name,
                    resolution: devmode_to_str(&dm),
                    refresh: dm.dmDisplayFrequency,
                    primary: is_primary,
                });
            }
            i += 1;
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Display profiles (saved arrangements)
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone)]
pub struct DisplayProfile {
    pub id: String,
    pub name: String,
    pub created_at: u64,
    pub monitors: Vec<MonitorProfile>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct MonitorProfile {
    pub id: String,
    pub wallpaper: String,
}

fn profiles_path(state: &AppState) -> PathBuf {
    state.data_dir.join("display_profiles.json")
}

fn load_profiles(state: &AppState) -> Vec<DisplayProfile> {
    load_json(&profiles_path(state), Vec::new())
}

#[tauri::command]
pub fn list_display_profiles(state: State<'_, AppState>) -> Vec<DisplayProfile> {
    load_profiles(&state)
}

#[tauri::command]
pub fn save_display_profile(
    state: State<'_, AppState>,
    name: String,
) -> Result<DisplayProfile, AppError> {
    let monitors: Vec<MonitorProfile> = get_display_info()
        .into_iter()
        .map(|m| MonitorProfile {
            id: m.id.clone(),
            wallpaper: crate::wallpaper::current_wallpaper(),
        })
        .collect();
    let prof = DisplayProfile {
        id: Uuid::new_v4().to_string(),
        name,
        created_at: now_millis(),
        monitors,
    };
    let mut list = load_profiles(&state);
    list.push(prof.clone());
    save_json(&profiles_path(&state), &list)?;
    Ok(prof)
}

#[tauri::command]
pub fn apply_display_profile(state: State<'_, AppState>, id: String) -> Result<String, AppError> {
    let list = load_profiles(&state);
    let prof = list
        .iter()
        .find(|p| p.id == id)
        .ok_or_else(|| "Profile not found".to_string())?;
    // snapshot current per-monitor wallpapers so the whole profile can be undone
    let before_monitors: Vec<crate::wallpaper::MonitorInfo> =
        crate::wallpaper::get_wallpapers().monitors;
    let mut applied = 0usize;
    for m in &prof.monitors {
        if !m.wallpaper.is_empty()
            && crate::wallpaper::apply_monitor_wallpaper_raw(&m.id, &m.wallpaper).is_ok()
        {
            applied += 1;
        }
    }
    undo::log_entry(
        &state,
        "display_profile",
        format!(
            "Applied display profile '{}' ({} monitors)",
            prof.name, applied
        ),
        json!({ "profile": prof, "before_monitors": before_monitors }),
        true,
    )?;
    Ok(format!("Applied '{}' to {} monitors", prof.name, applied))
}

#[tauri::command]
pub fn delete_display_profile(state: State<'_, AppState>, id: String) -> Result<(), AppError> {
    let mut list = load_profiles(&state);
    list.retain(|p| p.id != id);
    save_json(&profiles_path(&state), &list)
}
