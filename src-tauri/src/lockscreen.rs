use crate::state::AppState;
use crate::undo;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::State;
use winreg::enums::HKEY_CURRENT_USER;
use winreg::RegKey;

// ---------------------------------------------------------------------------
// Lock screen designer — per-user policies (no admin needed for HKCU).
//
//   Lock screen image:  HKCU\Software\Policies\Microsoft\Windows\Personalization
//                        "LockScreenImage" (REG_SZ path)
//
//   Slideshow:          HKCU\Software\Policies\Microsoft\Windows\Personalization
//                        "LockScreenImagesRootPath" (REG_SZ folder)
//
//   Lock screen apps:   HKCU\Software\Policies\Microsoft\Windows\Personalization
//                        "NoLockScreenToastNotifications" (DWORD)
//
//   Spotlight toggle:   HKCU\Software\Microsoft\Windows\CurrentVersion
//                       \ContentDeliveryManager "RotatingLockScreenEnabled" (DWORD)
//   Disable features:   HKCU\Software\Policies\Microsoft\Windows\CloudContent
//                       "DisableWindowsSpotlightFeatures" (DWORD)
// ---------------------------------------------------------------------------

use crate::error::AppError;
const PERSONALIZATION: &str = r"Software\Policies\Microsoft\Windows\Personalization";
const CLOUD_CONTENT: &str = r"Software\Policies\Microsoft\Windows\CloudContent";
const CDM: &str = r"Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager";

fn personalization_key() -> Result<RegKey, AppError> {
    RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey(PERSONALIZATION)
        .map(|(k, _)| k)
        .map_err(|e| AppError::Command(e.to_string()))
}

fn cloud_key() -> Result<RegKey, AppError> {
    RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey(CLOUD_CONTENT)
        .map(|(k, _)| k)
        .map_err(|e| AppError::Command(e.to_string()))
}

fn cdm_key() -> Result<RegKey, AppError> {
    RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey(CDM)
        .map(|(k, _)| k)
        .map_err(|e| AppError::Command(e.to_string()))
}

#[derive(Serialize, Deserialize, Clone)]
pub struct LockScreenState {
    pub mode: String, // "image" | "slideshow" | "spotlight"
    pub image_path: Option<String>,
    pub slideshow_folder: Option<String>,
    pub slideshow_interval_secs: Option<u32>,
    pub slideshow_shuffle: Option<bool>,
    pub hide_apps: Option<bool>,
}

fn get_dword(key: &RegKey, name: &str) -> Option<u32> {
    key.get_value::<u32, _>(name).ok()
}

fn get_string(key: &RegKey, name: &str) -> Option<String> {
    key.get_value::<String, _>(name).ok()
}

#[tauri::command]
pub fn get_lock_screen_state() -> LockScreenState {
    let pk = personalization_key().ok();
    let _ck = cloud_key().ok();
    let cdm = cdm_key().ok();

    let image_path = pk.as_ref().and_then(|k| get_string(k, "LockScreenImage"));
    let slideshow_folder = pk
        .as_ref()
        .and_then(|k| get_string(k, "LockScreenImagesRootPath"));
    let spotlight_on = cdm
        .as_ref()
        .and_then(|k| get_dword(k, "RotatingLockScreenEnabled"))
        .unwrap_or(1)
        != 0;

    let mode = if image_path.is_some() {
        "image"
    } else if slideshow_folder.is_some() {
        "slideshow"
    } else if spotlight_on {
        "spotlight"
    } else {
        "image" // fallback — image with none set = OS default
    };

    LockScreenState {
        mode: mode.into(),
        image_path,
        slideshow_folder,
        slideshow_interval_secs: pk
            .as_ref()
            .and_then(|k| get_dword(k, "LockScreenSlideshowInterval"))
            .map(|v| v * 60),
        slideshow_shuffle: pk
            .as_ref()
            .and_then(|k| get_dword(k, "LockScreenSlideshowShuffle"))
            .map(|v| v != 0),
        hide_apps: pk
            .as_ref()
            .and_then(|k| get_dword(k, "NoLockScreenToastNotifications"))
            .map(|v| v != 0),
    }
}

#[tauri::command]
pub fn set_lock_screen_image(
    state: State<'_, AppState>,
    source: String,
) -> Result<LockScreenState, AppError> {
    let src = std::path::Path::new(&source);
    if !src.exists() {
        return Err(AppError::Command("Image file not found.".into()));
    }
    // copy image into app data so the path is stable even if source moves
    let dst = state.data_dir.join("lockscreen").join("lock_image.png");
    let parent = dst
        .parent()
        .ok_or("Lock screen image path has no parent dir")?;
    std::fs::create_dir_all(parent).map_err(|e| AppError::Command(e.to_string()))?;
    std::fs::copy(src, &dst).map_err(|e| AppError::Command(e.to_string()))?;

    // clear spotlight and slideshow
    let cdm = cdm_key()?;
    let _ = cdm.set_value("RotatingLockScreenEnabled", &0u32);
    let pk = personalization_key()?;
    let _ = pk.delete_value("LockScreenImagesRootPath");
    // set the lock screen image
    let path = dst.to_string_lossy().to_string();
    pk.set_value("LockScreenImage", &path)
        .map_err(|e| AppError::Command(e.to_string()))?;

    undo::log_entry(
        &state,
        "lock_screen",
        "Set lock screen image".into(),
        json!({ "mode": "image", "path": path, "before": get_lock_screen_state() }),
        true,
    )?;
    Ok(get_lock_screen_state())
}

#[tauri::command]
pub fn set_lock_screen_slideshow(
    state: State<'_, AppState>,
    folder: String,
    interval_minutes: Option<u32>,
    shuffle: Option<bool>,
) -> Result<LockScreenState, AppError> {
    let dir = std::path::Path::new(&folder);
    if !dir.is_dir() {
        return Err(AppError::Command(format!("Folder not found: {}", folder)));
    }
    let pk = personalization_key()?;
    let _ = pk.delete_value("LockScreenImage");
    pk.set_value("LockScreenImagesRootPath", &folder)
        .map_err(|e| AppError::Command(e.to_string()))?;
    if let Some(interval) = interval_minutes {
        let raw = interval.max(1);
        pk.set_value("LockScreenSlideshowInterval", &raw)
            .map_err(|e| AppError::Command(e.to_string()))?;
    }
    if let Some(do_shuffle) = shuffle {
        pk.set_value(
            "LockScreenSlideshowShuffle",
            &(if do_shuffle { 1u32 } else { 0u32 }),
        )
        .map_err(|e| AppError::Command(e.to_string()))?;
    }
    // turn off spotlight
    let cdm = cdm_key()?;
    let _ = cdm.set_value("RotatingLockScreenEnabled", &0u32);

    undo::log_entry(
        &state,
        "lock_screen",
        "Set lock screen slideshow".into(),
        json!({ "mode": "slideshow", "folder": folder, "before": get_lock_screen_state() }),
        true,
    )?;
    Ok(get_lock_screen_state())
}

#[tauri::command]
pub fn set_lock_screen_spotlight(state: State<'_, AppState>) -> Result<LockScreenState, AppError> {
    let pk = personalization_key()?;
    let _ = pk.delete_value("LockScreenImage");
    let _ = pk.delete_value("LockScreenImagesRootPath");
    let cdm = cdm_key()?;
    cdm.set_value("RotatingLockScreenEnabled", &1u32)
        .map_err(|e| AppError::Command(e.to_string()))?;

    undo::log_entry(
        &state,
        "lock_screen",
        "Enabled lock screen spotlight".into(),
        json!({ "mode": "spotlight", "before": get_lock_screen_state() }),
        true,
    )?;
    Ok(get_lock_screen_state())
}

// Public wrappers for marketplace / automation (no Tauri State needed).
pub fn set_lock_screen_image_pub(state: &AppState, source: &str) -> Result<(), AppError> {
    let src = std::path::Path::new(source);
    if !src.exists() {
        return Err(AppError::Command("Image file not found.".into()));
    }
    let dst = state.data_dir.join("lockscreen").join("lock_image.png");
    let parent = dst
        .parent()
        .ok_or("Lock screen image path has no parent dir")?;
    std::fs::create_dir_all(parent).map_err(|e| AppError::Command(e.to_string()))?;
    std::fs::copy(src, &dst).map_err(|e| AppError::Command(e.to_string()))?;
    let cdm = cdm_key()?;
    let _ = cdm.set_value("RotatingLockScreenEnabled", &0u32);
    let pk = personalization_key()?;
    let _ = pk.delete_value("LockScreenImagesRootPath");
    let path = dst.to_string_lossy().to_string();
    pk.set_value("LockScreenImage", &path)
        .map_err(|e| AppError::Command(e.to_string()))
}

pub fn set_lock_screen_spotlight_pub(state: &AppState) -> Result<(), AppError> {
    let _ = state;
    let pk = personalization_key()?;
    let _ = pk.delete_value("LockScreenImage");
    let _ = pk.delete_value("LockScreenImagesRootPath");
    let cdm = cdm_key()?;
    cdm.set_value("RotatingLockScreenEnabled", &1u32)
        .map_err(|e| AppError::Command(e.to_string()))
}

#[tauri::command]
pub fn set_lock_screen_hide_apps(
    state: State<'_, AppState>,
    hide: bool,
) -> Result<LockScreenState, AppError> {
    let pk = personalization_key()?;
    pk.set_value(
        "NoLockScreenToastNotifications",
        &(if hide { 1u32 } else { 0u32 }),
    )
    .map_err(|e| AppError::Command(e.to_string()))?;

    undo::log_entry(
        &state,
        "lock_screen",
        format!(
            "Lock screen detailed status {}",
            if hide { "hidden" } else { "shown" }
        ),
        json!({ "hide_apps": hide, "before": get_lock_screen_state() }),
        true,
    )?;
    Ok(get_lock_screen_state())
}

// ---- undo support ------------------------------------------------------------

/// Re-apply a previously captured LockScreenState (registry writes only — no undo
/// logging, used by the History revert flow).
pub fn restore_state(state: &AppState, snap: &LockScreenState) -> Result<(), AppError> {
    let _ = state;
    let pk = personalization_key()?;
    let cdm = cdm_key()?;
    match snap.image_path.as_deref() {
        Some(p) if !p.is_empty() && std::path::Path::new(p).exists() => {
            let _ = cdm.set_value("RotatingLockScreenEnabled", &0u32);
            let _ = pk.delete_value("LockScreenImagesRootPath");
            pk.set_value("LockScreenImage", &p.to_string())
                .map_err(|e| AppError::Command(e.to_string()))?;
        }
        _ => {
            let _ = pk.delete_value("LockScreenImage");
            match snap.slideshow_folder.as_deref() {
                Some(f) if !f.is_empty() => {
                    pk.set_value("LockScreenImagesRootPath", &f.to_string())
                        .map_err(|e| AppError::Command(e.to_string()))?;
                    if let Some(secs) = snap.slideshow_interval_secs {
                        pk.set_value("LockScreenSlideshowInterval", &(secs / 60).max(1))
                            .map_err(|e| AppError::Command(e.to_string()))?;
                    }
                    if let Some(sh) = snap.slideshow_shuffle {
                        pk.set_value(
                            "LockScreenSlideshowShuffle",
                            &(if sh { 1u32 } else { 0u32 }),
                        )
                        .map_err(|e| AppError::Command(e.to_string()))?;
                    }
                    let _ = cdm.set_value("RotatingLockScreenEnabled", &0u32);
                }
                _ => {
                    let _ = pk.delete_value("LockScreenImagesRootPath");
                    let _ = cdm.set_value("RotatingLockScreenEnabled", &1u32);
                }
            }
        }
    }
    if let Some(hide) = snap.hide_apps {
        pk.set_value(
            "NoLockScreenToastNotifications",
            &(if hide { 1u32 } else { 0u32 }),
        )
        .map_err(|e| AppError::Command(e.to_string()))?;
    }
    Ok(())
}
