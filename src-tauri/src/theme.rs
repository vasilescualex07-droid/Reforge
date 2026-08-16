use crate::error::AppError;
use crate::state::AppState;
use crate::undo;
use serde::Serialize;
use serde_json::json;
use tauri::State;
use windows::Win32::Foundation::{LPARAM, WPARAM};
use windows::Win32::UI::WindowsAndMessaging::{
    SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE,
};
use winreg::enums::HKEY_CURRENT_USER;
use winreg::RegKey;

const PERSONALIZE: &str = r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize";

#[derive(Serialize, Clone)]
pub struct ThemeState {
    pub accent_hex: String,
    pub mode: String, // "dark" | "light"
    pub transparency: bool,
    pub color_prevalence: bool,
}

pub(crate) fn personalize_key_pub() -> Result<RegKey, AppError> {
    personalize_key()
}

/// Registry failures carry the key so the frontend can show a specific,
/// actionable error (Standard B §4): "Windows blocked the registry change".
fn reg_err(key: &str, e: std::io::Error) -> AppError {
    AppError::Registry {
        key: key.to_string(),
        source: e,
    }
}

fn personalize_key() -> Result<RegKey, AppError> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    hkcu.create_subkey(PERSONALIZE)
        .map(|(k, _)| k)
        .map_err(|e| reg_err(PERSONALIZE, e))
}

fn hex_from_dword(v: u32) -> String {
    let r = (v & 0xFF) as u8;
    let g = ((v >> 8) & 0xFF) as u8;
    let b = ((v >> 16) & 0xFF) as u8;
    format!("#{:02X}{:02X}{:02X}", r, g, b)
}

fn dword_from_hex(hex: &str) -> Result<u32, AppError> {
    let h = hex.trim_start_matches('#');
    if h.len() != 6 {
        return Err(AppError::Invalid(
            "expected a color like #RRGGBB".to_string(),
        ));
    }
    let r = u8::from_str_radix(&h[0..2], 16).map_err(|e| AppError::Invalid(e.to_string()))?;
    let g = u8::from_str_radix(&h[2..4], 16).map_err(|e| AppError::Invalid(e.to_string()))?;
    let b = u8::from_str_radix(&h[4..6], 16).map_err(|e| AppError::Invalid(e.to_string()))?;
    Ok(((b as u32) << 16) | ((g as u32) << 8) | (r as u32))
}

fn get_dword(name: &str) -> Option<u32> {
    personalize_key()
        .and_then(|k| k.get_value(name).map_err(|e| reg_err(name, e)))
        .ok()
}

pub fn current_accent_hex() -> String {
    hex_from_dword(get_dword("AccentColor").unwrap_or(0))
}

pub fn current_mode() -> String {
    match get_dword("AppsUseLightTheme") {
        Some(1) => "light".to_string(),
        _ => "dark".to_string(),
    }
}

pub fn current_transparency() -> bool {
    get_dword("EnableTransparency")
        .map(|v| v == 1)
        .unwrap_or(true)
}

pub fn current_color_prevalence() -> bool {
    get_dword("ColorPrevalence")
        .map(|v| v == 1)
        .unwrap_or(false)
}

fn notify_theme_changed() {
    let setting: Vec<u16> = "ImmersiveColorSet".encode_utf16().chain(Some(0)).collect();
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

// ---- low-level apply (no undo logging) ----

pub fn apply_accent_hex_raw(hex: &str) -> Result<(), AppError> {
    let dword = dword_from_hex(hex)?;
    let key = personalize_key()?;
    key.set_value("AccentColor", &dword)
        .map_err(|e| reg_err("AccentColor", e))?;
    let _ = key.set_value("SystemAccentColor", &dword);
    key.set_value("ColorPrevalence", &1u32)
        .map_err(|e| reg_err("ColorPrevalence", e))?;
    notify_theme_changed();
    Ok(())
}

pub fn apply_mode_raw(mode: &str) -> Result<(), AppError> {
    let light = match mode {
        "light" => 1u32,
        _ => 0u32,
    };
    let key = personalize_key()?;
    key.set_value("AppsUseLightTheme", &light)
        .map_err(|e| reg_err("AppsUseLightTheme", e))?;
    key.set_value("SystemUsesLightTheme", &light)
        .map_err(|e| reg_err("SystemUsesLightTheme", e))?;
    notify_theme_changed();
    Ok(())
}

pub fn apply_transparency_raw(on: bool) -> Result<(), AppError> {
    let v = if on { 1u32 } else { 0u32 };
    let key = personalize_key()?;
    key.set_value("EnableTransparency", &v)
        .map_err(|e| reg_err("EnableTransparency", e))?;
    notify_theme_changed();
    Ok(())
}

// ---- persistence (so scheduled maintenance can re-apply after OS updates) ----

pub fn persist_theme(state: &AppState) {
    let s = json!({
        "accent_hex": current_accent_hex(),
        "mode": current_mode(),
        "transparency": current_transparency(),
    });
    let _ = crate::storage::save_json(&state.data_dir.join("theme_state.json"), &s);
}

// ---- Tauri commands ----

#[tauri::command]
pub fn get_theme_state() -> ThemeState {
    ThemeState {
        accent_hex: current_accent_hex(),
        mode: current_mode(),
        transparency: current_transparency(),
        color_prevalence: current_color_prevalence(),
    }
}

#[tauri::command]
pub fn set_accent_color(state: State<'_, AppState>, hex: String) -> Result<ThemeState, AppError> {
    let before = current_accent_hex();
    apply_accent_hex_raw(&hex)?;
    undo::log_entry(
        &state,
        "accent",
        format!("Accent color → {}", hex),
        json!({ "before": before, "after": hex }),
        true,
    )?;
    persist_theme(&state);
    Ok(get_theme_state())
}

#[tauri::command]
pub fn set_theme_mode(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    mode: String,
) -> Result<ThemeState, AppError> {
    let before = current_mode();
    apply_mode_raw(&mode)?;
    // F-B: move the Mica material's dark flag with the mode override
    crate::apply_mica(&app);
    undo::log_entry(
        &state,
        "mode",
        format!("Theme mode → {}", mode),
        json!({ "before": before, "after": mode }),
        true,
    )?;
    persist_theme(&state);
    Ok(get_theme_state())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_roundtrip() {
        for hex in ["#6D7CFF", "#FF2E88", "#000000", "#FFFFFF", "#34D399"] {
            let d = dword_from_hex(hex).unwrap();
            assert_eq!(hex_from_dword(d), hex.to_uppercase());
        }
    }

    #[test]
    fn hex_requires_six_digits() {
        assert!(dword_from_hex("#FFF").is_err());
        assert!(dword_from_hex("notacolor").is_err());
    }
}

#[tauri::command]
pub fn set_transparency(state: State<'_, AppState>, on: bool) -> Result<ThemeState, AppError> {
    let before = current_transparency();
    apply_transparency_raw(on)?;
    undo::log_entry(
        &state,
        "transparency",
        format!("Taskbar transparency {}", if on { "on" } else { "off" }),
        json!({ "before": before, "after": on }),
        true,
    )?;
    persist_theme(&state);
    Ok(get_theme_state())
}
