use crate::state::AppState;
use crate::{theme, undo, wallpaper};
use rand::Rng;
use serde::Serialize;
use serde_json::json;
use std::path::Path;
use tauri::State;

use crate::error::AppError;
#[derive(Serialize, Clone)]
pub struct Pack {
    pub id: String,
    pub name: String,
    pub description: String,
    pub mode: String,
    pub accent_hex: String,
    pub gradient: [String; 2],
    pub category: String,
}

fn packs() -> Vec<Pack> {
    vec![
        Pack {
            id: "midnight-rain".into(),
            name: "Midnight Rain".into(),
            description: "Deep indigo nights with a calm blue accent. Dark, focused, premium."
                .into(),
            mode: "dark".into(),
            accent_hex: "#6D7CFF".into(),
            gradient: ["#0B1026".into(), "#2A3B7C".into()],
            category: "Calm".into(),
        },
        Pack {
            id: "sunset-boulevard".into(),
            name: "Sunset Boulevard".into(),
            description: "Warm oranges melting into dusk. Cozy and energetic.".into(),
            mode: "dark".into(),
            accent_hex: "#FF7B54".into(),
            gradient: ["#1A0E2E".into(), "#E4572E".into()],
            category: "Energetic".into(),
        },
        Pack {
            id: "nordic-frost".into(),
            name: "Nordic Frost".into(),
            description: "Icy light blues on a crisp, bright desktop. Clean and airy.".into(),
            mode: "light".into(),
            accent_hex: "#2E7CF6".into(),
            gradient: ["#EAF4FF".into(), "#A8C8F0".into()],
            category: "Minimal".into(),
        },
        Pack {
            id: "forest-calm".into(),
            name: "Forest Calm".into(),
            description: "Mossy greens and deep teals. Easy on the eyes, grounded.".into(),
            mode: "dark".into(),
            accent_hex: "#34D399".into(),
            gradient: ["#071A12".into(), "#14532D".into()],
            category: "Nature".into(),
        },
        Pack {
            id: "retro-wave".into(),
            name: "Retro Wave".into(),
            description: "Synthwave magenta and cyan, straight from 1986.".into(),
            mode: "dark".into(),
            accent_hex: "#FF2E88".into(),
            gradient: ["#0D0221".into(), "#7B2FF7".into()],
            category: "Retro".into(),
        },
        Pack {
            id: "minimal-mono".into(),
            name: "Minimal Mono".into(),
            description: "Greyscale restraint. Nothing distracts from your work.".into(),
            mode: "light".into(),
            accent_hex: "#111827".into(),
            gradient: ["#F8FAFC".into(), "#D1D5DB".into()],
            category: "Minimal".into(),
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_hex() {
        assert_eq!(hex_to_rgb("#FF2E88"), (255, 46, 136));
        assert_eq!(hex_to_rgb("#000000"), (0, 0, 0));
    }

    #[test]
    fn builtin_packs_are_well_formed() {
        let all = packs();
        assert_eq!(all.len(), 6);
        for p in &all {
            assert_eq!(p.gradient.len(), 2);
            assert!(p.accent_hex.starts_with('#'));
            assert!(p.mode == "dark" || p.mode == "light");
        }
    }
}

fn hex_to_rgb(hex: &str) -> (u8, u8, u8) {
    let h = hex.trim_start_matches('#');
    if h.len() != 6 {
        return (0, 0, 0);
    }
    (
        u8::from_str_radix(&h[0..2], 16).unwrap_or(0),
        u8::from_str_radix(&h[2..4], 16).unwrap_or(0),
        u8::from_str_radix(&h[4..6], 16).unwrap_or(0),
    )
}

fn generate_gradient(path: &Path, c1: &str, c2: &str) -> Result<(), AppError> {
    let (w, h) = (2560u32, 1440u32);
    let a = hex_to_rgb(c1);
    let b = hex_to_rgb(c2);
    let mut rng = rand::thread_rng();
    let img = image::RgbImage::from_fn(w, h, |x, y| {
        let t = (x as f32 + y as f32) / (w as f32 + h as f32);
        let n = rng.gen_range(-5.0f32..5.0);
        let r = (a.0 as f32 * (1.0 - t) + b.0 as f32 * t + n).clamp(0.0, 255.0) as u8;
        let g = (a.1 as f32 * (1.0 - t) + b.1 as f32 * t + n).clamp(0.0, 255.0) as u8;
        let bl = (a.2 as f32 * (1.0 - t) + b.2 as f32 * t + n).clamp(0.0, 255.0) as u8;
        image::Rgb([r, g, bl])
    });
    img.save(path).map_err(|e| AppError::Command(e.to_string()))
}

// ---- Tauri commands ----

#[tauri::command]
pub fn list_packs() -> Vec<Pack> {
    packs()
}

#[tauri::command]
pub fn apply_pack(state: State<'_, AppState>, id: String) -> Result<Pack, AppError> {
    let pack = packs()
        .into_iter()
        .find(|p| p.id == id)
        .ok_or_else(|| format!("Unknown pack: {}", id))?;

    std::fs::create_dir_all(state.wallpapers_dir())
        .map_err(|e| AppError::Command(e.to_string()))?;
    let wp_path = state.wallpapers_dir().join(format!("{}.png", pack.id));
    let wp_str = wp_path.to_string_lossy().to_string();

    generate_gradient(&wp_path, &pack.gradient[0], &pack.gradient[1])?;

    // accent
    let before_accent = theme::current_accent_hex();
    theme::apply_accent_hex_raw(&pack.accent_hex)?;
    undo::log_entry(
        &state,
        "accent",
        format!("[{}] Accent → {}", pack.name, pack.accent_hex),
        json!({ "before": before_accent, "after": pack.accent_hex }),
        true,
    )?;

    // mode
    let before_mode = theme::current_mode();
    theme::apply_mode_raw(&pack.mode)?;
    undo::log_entry(
        &state,
        "mode",
        format!("[{}] Mode → {}", pack.name, pack.mode),
        json!({ "before": before_mode, "after": pack.mode }),
        true,
    )?;

    // wallpaper
    let before_wp = wallpaper::current_wallpaper();
    wallpaper::apply_wallpaper_raw(&wp_str)?;
    undo::log_entry(
        &state,
        "wallpaper",
        format!("[{}] Wallpaper applied", pack.name),
        json!({ "before": before_wp, "after": wp_str }),
        true,
    )?;

    theme::persist_theme(&state);
    Ok(pack)
}
