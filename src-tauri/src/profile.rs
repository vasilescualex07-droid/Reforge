use crate::state::AppState;
use crate::storage::{now_millis, save_json};
use crate::{theme, undo, wallpaper};
use serde::Serialize;
use serde_json::json;
use tauri::State;

use crate::error::AppError;
#[derive(Serialize)]
pub struct ProfileExport {
    pub app: String,
    pub format: u32,
    pub generated_at: u64,
    pub theme: serde_json::Value,
    pub wallpaper: String,
    pub undo_count: usize,
}

#[tauri::command]
pub fn export_profile(state: State<'_, AppState>, path: String) -> Result<ProfileExport, AppError> {
    let undo_count = undo::load_undo_entries(&state).len();
    let profile = ProfileExport {
        app: "reforge".into(),
        format: 1,
        generated_at: now_millis(),
        theme: json!({
            "accent_hex": theme::current_accent_hex(),
            "mode": theme::current_mode(),
            "transparency": theme::current_transparency(),
        }),
        wallpaper: wallpaper::current_wallpaper(),
        undo_count,
    };
    let p = std::path::PathBuf::from(&path);
    save_json(&p, &profile)?;
    Ok(profile)
}

#[tauri::command]
pub fn import_profile(state: State<'_, AppState>, path: String) -> Result<String, AppError> {
    let p = std::path::PathBuf::from(&path);
    if !p.exists() {
        return Err(AppError::Command(format!("File not found: {}", path)));
    }
    let text = std::fs::read_to_string(&p).map_err(|e| AppError::Command(e.to_string()))?;
    let profile: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| AppError::Command(e.to_string()))?;
    if profile.get("app").and_then(|v| v.as_str()) != Some("reforge") {
        return Err(AppError::Command("Not a Reforge profile file".to_string()));
    }

    let mut applied = Vec::new();
    if let Some(hex) = profile
        .pointer("/theme/accent_hex")
        .and_then(|v| v.as_str())
    {
        let before = theme::current_accent_hex();
        theme::apply_accent_hex_raw(hex)?;
        undo::log_entry(
            &state,
            "accent",
            format!("[import] Accent → {}", hex),
            json!({ "before": before, "after": hex }),
            true,
        )?;
        applied.push("accent".to_string());
    }
    if let Some(mode) = profile.pointer("/theme/mode").and_then(|v| v.as_str()) {
        let before = theme::current_mode();
        theme::apply_mode_raw(mode)?;
        undo::log_entry(
            &state,
            "mode",
            format!("[import] Mode → {}", mode),
            json!({ "before": before, "after": mode }),
            true,
        )?;
        applied.push("mode".to_string());
    }
    if let Some(on) = profile
        .pointer("/theme/transparency")
        .and_then(|v| v.as_bool())
    {
        let before = theme::current_transparency();
        theme::apply_transparency_raw(on)?;
        undo::log_entry(
            &state,
            "transparency",
            format!("[import] Transparency {}", on),
            json!({ "before": before, "after": on }),
            true,
        )?;
        applied.push("transparency".to_string());
    }
    if let Some(wp) = profile.get("wallpaper").and_then(|v| v.as_str()) {
        if !wp.is_empty() && std::path::Path::new(wp).exists() {
            wallpaper::apply_wallpaper_raw(wp)?;
            undo::log_entry(
                &state,
                "wallpaper",
                format!("[import] Wallpaper → {}", wp),
                json!({ "before": wallpaper::current_wallpaper(), "after": wp }),
                true,
            )?;
            applied.push("wallpaper".to_string());
        }
    }

    Ok(format!(
        "Imported profile — applied: {}",
        applied.join(", ")
    ))
}
