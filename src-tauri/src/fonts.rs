use crate::state::AppState;
use crate::undo;
use serde::Serialize;
use serde_json::json;
use std::path::PathBuf;
use tauri::State;
use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
use winreg::RegKey;

// ---------------------------------------------------------------------------
// Font replacer
//
// System font substitution:  HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion
//                            \FontSubstitutes — needs admin. Capability-gated.
//
// Per-user font installation: %LocalAppData%\Microsoft\Windows\Fonts +
//                            HKCU\Software\Microsoft\Windows NT\CurrentVersion
//                            \Fonts — no admin needed.
// ---------------------------------------------------------------------------

use crate::error::AppError;
const FONT_SUBS: &str = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\FontSubstitutes";
const FONTS_HKLM: &str = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts";
const FONTS_HKCU: &str = r"Software\Microsoft\Windows NT\CurrentVersion\Fonts";

fn subs_key() -> Result<RegKey, AppError> {
    RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey_with_flags(
            FONT_SUBS,
            winreg::enums::KEY_READ | winreg::enums::KEY_SET_VALUE,
        )
        .map_err(|e| AppError::Command(e.to_string()))
}

fn subs_key_read() -> Result<RegKey, AppError> {
    RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey(FONT_SUBS)
        .map_err(|e| AppError::Command(e.to_string()))
}

/// Signatures for font files — TrueType (ttf) and OpenType (otf).
fn validate_font(path: &PathBuf) -> Result<String, AppError> {
    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if ext != "ttf" && ext != "otf" {
        return Err(AppError::Command(
            "Only .ttf (TrueType) and .otf (OpenType) fonts are supported.".into(),
        ));
    }
    let data = std::fs::read(path).map_err(|e| AppError::Command(format!("read font: {}", e)))?;
    if data.len() < 12 {
        return Err(AppError::Command(
            "That file is too small to be a real font.".into(),
        ));
    }
    let is_ttf = &data[0..4] == b"\x00\x01\x00\x00" || &data[0..4] == b"\x00\x01\x00\x01";
    let is_otf = &data[0..4] == b"OTTO";
    if !is_ttf && !is_otf {
        return Err(AppError::Command(
            "That file doesn't look like a valid font (no TrueType or OpenType header).".into(),
        ));
    }
    // read the font family name from the name table (simple heuristic: 4-128 chars after header)
    // For practical purposes, use the filename stem.
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "font".into());
    if stem.len() < 2 || stem.len() > 128 {
        return Err(AppError::Command(
            "Font filename too short or too long.".into(),
        ));
    }
    Ok(stem)
}

#[derive(Serialize, Clone)]
pub struct FontEntry {
    pub name: String,
    pub filename: String,
    pub source: String, // "system" | "user" | "substitution"
    pub substituted_to: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct FontSubstitution {
    pub original: String,
    pub substituted: String,
}

#[tauri::command]
pub fn list_installed_fonts() -> Vec<FontEntry> {
    let mut out = Vec::new();
    // HKLM system fonts
    if let Ok(key) = RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(FONTS_HKLM) {
        for (name, value) in key.enum_values().filter_map(|v| v.ok()) {
            let fname = String::from_utf8_lossy(&value.bytes)
                .trim_end_matches('\0')
                .to_string();
            out.push(FontEntry {
                name,
                filename: fname,
                source: "system".into(),
                substituted_to: None,
            });
        }
    }
    // HKCU user fonts
    if let Ok(key) = RegKey::predef(HKEY_CURRENT_USER).open_subkey(FONTS_HKCU) {
        for (name, value) in key.enum_values().filter_map(|v| v.ok()) {
            let fname = String::from_utf8_lossy(&value.bytes)
                .trim_end_matches('\0')
                .to_string();
            out.push(FontEntry {
                name,
                filename: fname,
                source: "user".into(),
                substituted_to: None,
            });
        }
    }
    out.sort_by_key(|a| a.name.to_lowercase());
    out
}

#[tauri::command]
pub fn list_font_substitutions() -> Vec<FontSubstitution> {
    let mut out = Vec::new();
    if let Ok(key) = subs_key_read() {
        for (name, value) in key.enum_values().filter_map(|v| v.ok()) {
            let sub = String::from_utf8_lossy(&value.bytes)
                .trim_end_matches('\0')
                .to_string();
            out.push(FontSubstitution {
                original: name,
                substituted: sub,
            });
        }
    }
    out.sort_by_key(|a| a.original.to_lowercase());
    out
}

#[tauri::command]
pub fn set_font_substitution(
    state: State<'_, AppState>,
    original: String,
    substitute: String,
) -> Result<Vec<FontSubstitution>, AppError> {
    // verify the font exists either in system or user list
    if !substitute.is_empty() {
        let all = list_installed_fonts();
        let found = all.iter().any(|f| {
            f.name.eq_ignore_ascii_case(&substitute) || f.filename.eq_ignore_ascii_case(&substitute)
        });
        if !found {
            // try validating as a path to a font file
            let path = std::path::Path::new(&substitute);
            if !path.exists()
                || path.extension().map(|e| e.to_string_lossy().to_lowercase())
                    != Some("ttf".into())
                    && path.extension().map(|e| e.to_string_lossy().to_lowercase())
                        != Some("otf".into())
            {
                return Err(AppError::Command(format!(
                    "Font '{}' not found in installed fonts and is not a valid font file path.",
                    substitute
                )));
            }
        }
    }
    // check capability
    let caps = crate::capability::compute();
    if !caps.font_substitution_supported || !caps.admin {
        return Err(AppError::Command("Font substitution needs administrator rights. 👑 Use the Settings → Elevate button to relaunch.".into()));
    }

    let key = subs_key()?;
    let before = key.get_value::<String, _>(&original).unwrap_or_default();
    if substitute.is_empty() {
        // restore default
        let _ = key.delete_value(&original);
    } else {
        key.set_value(&original, &substitute)
            .map_err(|e| AppError::Command(e.to_string()))?;
    }

    // log the shell pending change
    crate::shell::mark_pending(&state, "font_substitution")?;
    undo::log_entry(
        &state,
        "font_substitution",
        format!(
            "Font substitution: {} → {}",
            original,
            if substitute.is_empty() {
                "(default)"
            } else {
                &substitute
            }
        ),
        json!({ "original": original, "before": before, "after": substitute }),
        true,
    )?;
    Ok(list_font_substitutions())
}

#[tauri::command]
pub fn install_user_font(
    state: State<'_, AppState>,
    path: String,
) -> Result<Vec<FontEntry>, AppError> {
    let src = std::path::Path::new(&path);
    let name = validate_font(&src.to_path_buf())?;
    // copy to user fonts dir
    let local_fonts = dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from(std::env::var("LOCALAPPDATA").unwrap_or_default()))
        .join("Microsoft")
        .join("Windows")
        .join("Fonts");
    std::fs::create_dir_all(&local_fonts).map_err(|e| AppError::Command(e.to_string()))?;
    let dst = local_fonts.join(format!(
        "{}.{}",
        name,
        src.extension()
            .map(|e| e.to_string_lossy())
            .unwrap_or_else(|| "ttf".into())
    ));
    std::fs::copy(src, &dst).map_err(|e| AppError::Command(e.to_string()))?;
    // register in HKCU
    let (key, _) = RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey(FONTS_HKCU)
        .map_err(|e| AppError::Command(e.to_string()))?;
    // The value name is the font family name (what the OS uses)
    let name_clone = name.clone();
    let display_name = dst
        .file_name()
        .map(|s| s.to_string_lossy())
        .unwrap_or_else(|| name_clone.into());
    key.set_value(&name, &display_name.to_string())
        .map_err(|e| AppError::Command(e.to_string()))?;

    undo::log_entry(
        &state,
        "font_install",
        format!("Installed user font: {}", name),
        json!({ "name": name, "path": dst.to_string_lossy().to_string() }),
        true,
    )?;
    Ok(list_installed_fonts())
}

// undo support: a font file moved out of the user fonts dir so removal is reversible
#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct MovedFontFile {
    pub from: String,
    pub to: String,
}

pub fn restore_moved_fonts(moved: &[MovedFontFile]) -> Result<(), AppError> {
    for m in moved {
        if std::path::Path::new(&m.to).exists() {
            if let Some(parent) = std::path::Path::new(&m.from).parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            std::fs::rename(&m.to, &m.from).map_err(|e| AppError::Command(e.to_string()))?;
        }
    }
    Ok(())
}

/// Delete a user font's registry entry and files without logging (used by undo).
pub fn uninstall_font_raw(name: &str) -> Result<(), AppError> {
    let (key, _) = RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey(FONTS_HKCU)
        .map_err(|e| AppError::Command(e.to_string()))?;
    let _ = key.delete_value(name);
    if let Some(local_fonts) =
        dirs::data_local_dir().map(|d| d.join("Microsoft").join("Windows").join("Fonts"))
    {
        if let Ok(entries) = std::fs::read_dir(&local_fonts) {
            for e in entries.flatten() {
                let fname = e.file_name().to_string_lossy().to_string();
                if fname.to_lowercase().starts_with(&name.to_lowercase()) {
                    let _ = std::fs::remove_file(e.path());
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn remove_user_font(
    state: State<'_, AppState>,
    name: String,
) -> Result<Vec<FontEntry>, AppError> {
    let (key, _) = RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey(FONTS_HKCU)
        .map_err(|e| AppError::Command(e.to_string()))?;
    let before = key.get_value::<String, _>(&name).unwrap_or_default();
    let _ = key.delete_value(&name);
    // move matching font files to the backup dir instead of deleting, so the
    // uninstall is reversible from History
    let backup_dir = state.data_dir.join("fonts_backup");
    let _ = std::fs::create_dir_all(&backup_dir);
    let mut moved: Vec<MovedFontFile> = Vec::new();
    if let Some(local_fonts) =
        dirs::data_local_dir().map(|d| d.join("Microsoft").join("Windows").join("Fonts"))
    {
        if let Ok(entries) = std::fs::read_dir(&local_fonts) {
            for e in entries.flatten() {
                let fname = e.file_name().to_string_lossy().to_string();
                if fname.to_lowercase().starts_with(&name.to_lowercase()) {
                    let from = e.path().to_string_lossy().to_string();
                    let to = backup_dir.join(&fname).to_string_lossy().to_string();
                    if std::fs::rename(e.path(), &to).is_ok() {
                        moved.push(MovedFontFile { from, to });
                    }
                }
            }
        }
    }

    undo::log_entry(
        &state,
        "font_uninstall",
        format!("Removed user font: {}", name),
        json!({ "name": name, "before": before, "moved": moved }),
        true,
    )?;
    Ok(list_installed_fonts())
}

// undo support ------------------------------------------------------------------

pub fn restore_substitution(original: &str, before: &str) -> Result<(), AppError> {
    let key = subs_key()?;
    if before.is_empty() {
        let _ = key.delete_value(original);
    } else {
        key.set_value(original, &before.to_string())
            .map_err(|e| AppError::Command(e.to_string()))?;
    }
    Ok(())
}
