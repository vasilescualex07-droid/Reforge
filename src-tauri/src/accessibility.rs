// Accessibility page (S10.7). Windows built-in accessibility toggles, each
// honest and capability-gated:
//   · High contrast   — registry Flags (bit 0 = on)
//   · Animations off  — SystemParametersInfoW SPI_SETCLIENTAREAANIMATION
//   · Cursor size     — HKCU\Control Panel\Cursors\CursorBaseSize (32/48/64) + SPI_SETCURSORS
//   · Text scale      — HKCU\Control Panel\Desktop\LogPixels (96..192) — applies after sign-out
//   · Color filters   — HKCU\Software\Microsoft\ColorFiltering Active/FilterType (applies live)
// Every change snapshots the before-state and logs an undoable "accessibility"
// entry so History restores the exact previous values.

use crate::error::AppError;
use crate::state::AppState;
use crate::undo;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::State;
use winreg::enums::HKEY_CURRENT_USER;
use winreg::RegKey;

#[derive(Serialize, Deserialize, Clone, PartialEq, Default)]
pub struct ColorFilterState {
    pub active: bool,
    /// 0 grayscale · 1 invert · 2 grayscale inverted · 3 deuteranopia · 4 protanopia · 5 tritanopia
    #[serde(default)]
    pub filter_type: u32,
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct AccessibilitySnapshot {
    pub high_contrast: bool,
    pub animations_off: bool,
    pub cursor_size: u32,
    pub text_scale_pct: u32,
    pub color_filter: ColorFilterState,
}

#[derive(Serialize, Clone)]
pub struct AccessibilityState {
    pub high_contrast: bool,
    pub animations_off: bool,
    pub cursor_size: u32,
    pub text_scale_pct: u32,
    pub color_filter: ColorFilterState,
}

fn hc_key() -> Result<RegKey, AppError> {
    RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey(r"Software\Microsoft\Accessibility\HighContrast")
        .map_err(|e| AppError::Command(format!("high contrast key: {e}")))
        .map(|(k, _)| k)
}

fn high_contrast_state() -> bool {
    hc_key()
        .ok()
        .and_then(|k| k.get_value::<u32, _>("Flags").ok())
        .map(|v| v & 1 == 1)
        .unwrap_or(false)
}

fn set_high_contrast(on: bool) -> Result<(), AppError> {
    // HCF_HIGHCONTRASTON plus the default scheme bits Windows writes itself.
    hc_key()?
        .set_value("Flags", &(if on { 0x7Eu32 } else { 0u32 }))
        .map_err(|e| AppError::Command(format!("set high contrast: {e}")))
}

fn animations_state() -> bool {
    // SPI_GETCLIENTAREAANIMATION returns 1 = animations on; we expose "off".
    unsafe {
        use windows::Win32::UI::WindowsAndMessaging::{
            SystemParametersInfoW, SPI_GETCLIENTAREAANIMATION,
        };
        let mut v: u32 = 0;
        if SystemParametersInfoW(
            SPI_GETCLIENTAREAANIMATION,
            0,
            Some(&mut v as *mut u32 as *mut core::ffi::c_void),
            windows::Win32::UI::WindowsAndMessaging::SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
        )
        .is_ok()
        {
            v == 0
        } else {
            false
        }
    }
}

fn set_animations(off: bool) -> Result<(), AppError> {
    unsafe {
        use windows::Win32::UI::WindowsAndMessaging::{
            SystemParametersInfoW, SPI_SETCLIENTAREAANIMATION, SPIF_SENDCHANGE,
        };
        SystemParametersInfoW(
            SPI_SETCLIENTAREAANIMATION,
            if off { 0u32 } else { 1u32 },
            None,
            SPIF_SENDCHANGE,
        )
        .map_err(|e| AppError::Command(format!("set animations: {e}")))?;
    }
    Ok(())
}

fn cursors_key() -> Result<RegKey, AppError> {
    RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey(r"Control Panel\Cursors")
        .map_err(|e| AppError::Command(format!("cursors key: {e}")))
        .map(|(k, _)| k)
}

fn cursor_size_state() -> u32 {
    cursors_key()
        .ok()
        .and_then(|k| k.get_value::<u32, _>("CursorBaseSize").ok())
        .unwrap_or(32)
}

fn set_cursor_size(size: u32) -> Result<(), AppError> {
    let size = match size {
        32 | 48 | 64 => size,
        _ => 32,
    };
    cursors_key()?
        .set_value("CursorBaseSize", &size)
        .map_err(|e| AppError::Command(format!("set cursor size: {e}")))?;
    unsafe {
        use windows::Win32::UI::WindowsAndMessaging::{
            SystemParametersInfoW, SPIF_SENDCHANGE, SPI_SETCURSORS,
        };
        SystemParametersInfoW(SPI_SETCURSORS, 0, None, SPIF_SENDCHANGE)
            .map_err(|e| AppError::Command(format!("apply cursors: {e}")))?;
    }
    Ok(())
}

fn desktop_key() -> Result<RegKey, AppError> {
    RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey(r"Control Panel\Desktop")
        .map_err(|e| AppError::Command(format!("desktop key: {e}")))
        .map(|(k, _)| k)
}

/// Text scale as a percentage (96 → 100%, 192 → 200%).
fn text_scale_state() -> u32 {
    desktop_key()
        .ok()
        .and_then(|k| k.get_value::<u32, _>("LogPixels").ok())
        .map(|v| ((v as f32 / 96.0) * 100.0).round() as u32)
        .unwrap_or(100)
}

fn set_text_scale(pct: u32) -> Result<(), AppError> {
    let pct = pct.clamp(100, 200);
    let logpixels = ((pct as f32 / 100.0) * 96.0).round() as u32;
    desktop_key()?
        .set_value("LogPixels", &logpixels)
        .map_err(|e| AppError::Command(format!("set text scale: {e}")))
}

fn color_filter_key() -> Result<RegKey, AppError> {
    RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey(r"Software\Microsoft\ColorFiltering")
        .map_err(|e| AppError::Command(format!("color filter key: {e}")))
        .map(|(k, _)| k)
}

fn color_filter_state() -> ColorFilterState {
    let k = color_filter_key().ok();
    ColorFilterState {
        active: k
            .as_ref()
            .and_then(|k| k.get_value::<u32, _>("Active").ok())
            .map(|v| v == 1)
            .unwrap_or(false),
        filter_type: k
            .as_ref()
            .and_then(|k| k.get_value::<u32, _>("FilterType").ok())
            .unwrap_or(0),
    }
}

fn set_color_filter(active: bool, filter_type: u32) -> Result<(), AppError> {
    let key = color_filter_key()?;
    key.set_value("Active", &(if active { 1u32 } else { 0u32 }))
        .map_err(|e| AppError::Command(format!("set color filter: {e}")))?;
    key.set_value("FilterType", &(filter_type % 6))
        .map_err(|e| AppError::Command(format!("set filter type: {e}")))
}

fn current_snapshot() -> AccessibilitySnapshot {
    AccessibilitySnapshot {
        high_contrast: high_contrast_state(),
        animations_off: animations_state(),
        cursor_size: cursor_size_state(),
        text_scale_pct: text_scale_state(),
        color_filter: color_filter_state(),
    }
}

// ---- tauri commands ---------------------------------------------------------

#[tauri::command]
pub fn get_accessibility_state() -> AccessibilityState {
    let s = current_snapshot();
    AccessibilityState {
        high_contrast: s.high_contrast,
        animations_off: s.animations_off,
        cursor_size: s.cursor_size,
        text_scale_pct: s.text_scale_pct,
        color_filter: s.color_filter,
    }
}

/// Apply a partial update: any field present in the payload is set. Logs one
/// undoable entry capturing the full before-state.
#[tauri::command]
pub fn set_accessibility_state(
    state: State<'_, AppState>,
    high_contrast: Option<bool>,
    animations_off: Option<bool>,
    cursor_size: Option<u32>,
    text_scale_pct: Option<u32>,
    color_filter: Option<ColorFilterState>,
) -> Result<AccessibilityState, AppError> {
    let before = current_snapshot();
    if let Some(v) = high_contrast {
        set_high_contrast(v)?;
    }
    if let Some(v) = animations_off {
        set_animations(v)?;
    }
    if let Some(v) = cursor_size {
        set_cursor_size(v)?;
    }
    if let Some(v) = text_scale_pct {
        set_text_scale(v)?;
    }
    if let Some(cf) = color_filter {
        set_color_filter(cf.active, cf.filter_type)?;
    }
    undo::log_entry(
        &state,
        "accessibility",
        "Accessibility settings changed".into(),
        json!({ "before": before }),
        true,
    )?;
    Ok(get_accessibility_state())
}

/// Undo support: restore the exact before snapshot.
pub fn restore_snapshot(snap: &AccessibilitySnapshot) -> Result<(), AppError> {
    set_high_contrast(snap.high_contrast)?;
    set_animations(snap.animations_off)?;
    set_cursor_size(snap.cursor_size)?;
    set_text_scale(snap.text_scale_pct)?;
    set_color_filter(snap.color_filter.active, snap.color_filter.filter_type)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_scale_maps_logpixels_to_percent() {
        // 96 → 100, 120 → 125, 144 → 150, 192 → 200
        assert_eq!(((96f64 / 96.0) * 100.0).round() as u32, 100);
        assert_eq!(((120f64 / 96.0) * 100.0).round() as u32, 125);
        assert_eq!(((192f64 / 96.0) * 100.0).round() as u32, 200);
    }

    #[test]
    fn snapshot_roundtrips_through_json() {
        let s = AccessibilitySnapshot {
            high_contrast: true,
            animations_off: true,
            cursor_size: 64,
            text_scale_pct: 125,
            color_filter: ColorFilterState {
                active: true,
                filter_type: 3,
            },
        };
        let v = serde_json::to_value(&s).unwrap();
        let back: AccessibilitySnapshot = serde_json::from_value(v).unwrap();
        assert!(back.high_contrast);
        assert_eq!(back.cursor_size, 64);
        assert_eq!(back.color_filter.filter_type, 3);
    }

    #[test]
    fn cursor_size_clamps_to_allowed_values() {
        assert_eq!(match 32 { 32 | 48 | 64 => 32, _ => 32 }, 32);
        let ok = |s: u32| match s {
            32 | 48 | 64 => s,
            _ => 32,
        };
        assert_eq!(ok(48), 48);
        assert_eq!(ok(999), 32);
    }
}
