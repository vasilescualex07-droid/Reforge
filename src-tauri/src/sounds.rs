use crate::state::AppState;
use crate::undo;
use serde::Serialize;
use serde_json::json;
use tauri::State;
use uuid::Uuid;
use winreg::enums::HKEY_CURRENT_USER;
use winreg::RegKey;

// ---------------------------------------------------------------------------
// Sound schemes — HKCU\AppEvents\Schemes
//   Schemes\(default)            = GUID of the active scheme
//   Schemes\Names\{guid}         = scheme display name
//   Schemes\Apps\.Default\{evt}\.current  = current sound for an event
//   Schemes\Apps\.Default\{evt}\.default  = stock sound for an event
// Everything here is per-user — no admin needed. All changes are undoable.
// ---------------------------------------------------------------------------

use crate::error::AppError;
const SCHEMES: &str = r"AppEvents\Schemes";
const APPS_DEFAULT: &str = r"AppEvents\Schemes\Apps\.Default";

/// The canonical "Windows Default" scheme GUID. Stock Windows 10/11 stores
/// the default scheme under either this GUID or the plain name `.Default` —
/// treat them as aliases of the same scheme so curated style assignments
/// survive both machines (K7).
pub const DEFAULT_SCHEME_GUID: &str = "{f2e1dd92-4b1a-4f7e-8c5c-5d6b4c3a5d4b}";

/// Resolve a requested scheme to the local registry name: the canonical GUID
/// falls back to `.Default` when the machine stores Windows Default under the
/// plain name instead of the GUID subkey.
pub fn resolve_scheme_key(guid: &str) -> String {
    if guid.eq_ignore_ascii_case(DEFAULT_SCHEME_GUID) {
        if RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey(format!(r"AppEvents\Schemes\Names\{}", guid))
            .is_ok()
        {
            guid.to_string()
        } else {
            ".Default".to_string()
        }
    } else {
        guid.to_string()
    }
}

pub const STANDARD_EVENTS: &[(&str, &str)] = &[
    (".Default", "Default beep"),
    ("SystemAsterisk", "Asterisk"),
    ("SystemExclamation", "Exclamation"),
    ("SystemExit", "Exit Windows"),
    ("SystemHand", "Critical stop"),
    ("SystemNotification", "Notification"),
    ("SystemQuestion", "Question"),
    ("SystemStart", "Start Windows"),
    ("SystemWelcome", "Windows welcome"),
    ("DeviceConnect", "Device connect"),
    ("DeviceDisconnect", "Device disconnect"),
    ("DeviceFail", "Device fail"),
    ("DeviceReconnect", "Device reconnect"),
    ("MailBeep", "New mail"),
    ("Notification.Default", "New notification"),
    ("Notification.Mail", "Mail notification"),
    ("Notification.IM", "IM notification"),
    ("AppGPFault", "Program error"),
    ("MenuCommand", "Menu command"),
    ("MenuPopup", "Menu popup"),
    ("Maximize", "Maximize"),
    ("Minimize", "Minimize"),
    ("RestoreDown", "Restore down"),
    ("RestoreUp", "Restore up"),
    ("ShowWindow", "Show window"),
    ("WindowsUAC", "UAC prompt"),
    ("Foreground", "Program open"),
];

fn schemes_key() -> Result<RegKey, AppError> {
    RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey(SCHEMES)
        .map(|(k, _)| k)
        .map_err(|e| AppError::Command(e.to_string()))
}

fn apps_default_key() -> Result<RegKey, AppError> {
    RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey(APPS_DEFAULT)
        .map(|(k, _)| k)
        .map_err(|e| AppError::Command(e.to_string()))
}

#[derive(Serialize, Clone)]
pub struct SoundScheme {
    pub guid: String,
    pub name: String,
    pub current: bool,
    pub builtin: bool,
}

fn is_builtin_guid(guid: &str) -> bool {
    // Windows Default is stored under the canonical GUID on some machines and
    // under the plain name `.Default` on others — both are the built-in scheme.
    guid.eq_ignore_ascii_case(DEFAULT_SCHEME_GUID) || guid.eq_ignore_ascii_case(".Default")
}

#[tauri::command]
pub fn list_sound_schemes() -> Vec<SoundScheme> {
    let current = schemes_key()
        .and_then(|k| {
            k.get_value::<String, _>("")
                .map_err(|e| AppError::Command(e.to_string()))
        })
        .unwrap_or_default();
    let mut out = Vec::new();
    if let Ok(key) = RegKey::predef(HKEY_CURRENT_USER).open_subkey(r"AppEvents\Schemes\Names") {
        for guid in key.enum_keys().filter_map(|k| k.ok()) {
            let display = key
                .open_subkey(&guid)
                .ok()
                .and_then(|k| k.get_value::<String, _>("").ok())
                .unwrap_or_else(|| guid.clone());
            out.push(SoundScheme {
                guid: guid.clone(),
                name: display,
                current: guid.eq_ignore_ascii_case(&current),
                builtin: is_builtin_guid(&guid),
            });
        }
    }
    out.sort_by_key(|a| a.name.to_lowercase());
    out
}

#[tauri::command]
pub fn get_current_scheme() -> SoundScheme {
    let current = schemes_key()
        .ok()
        .and_then(|k| k.get_value::<String, _>("").ok())
        .unwrap_or_default();
    let name = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(format!(r"AppEvents\Schemes\Names\{}", current))
        .ok()
        .and_then(|k| k.get_value::<String, _>("").ok())
        .unwrap_or_else(|| "Custom".into());
    let builtin = is_builtin_guid(&current);
    SoundScheme {
        guid: current,
        name,
        current: true,
        builtin,
    }
}

#[tauri::command]
pub fn apply_sound_scheme(state: State<'_, AppState>, guid: String) -> Result<String, AppError> {
    // Resolve the canonical GUID → `.Default` alias so curated assignments
    // work on machines that store Windows Default under the plain name (K7).
    let key = resolve_scheme_key(&guid);
    let names = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(r"AppEvents\Schemes\Names")
        .map_err(|e| AppError::Command(e.to_string()))?;
    if names.open_subkey(&key).is_err() {
        return Err(AppError::Command(
            "That scheme doesn't exist on this machine.".into(),
        ));
    }
    let before = schemes_key()?
        .get_value::<String, _>("")
        .unwrap_or_default();
    schemes_key()?
        .set_value("", &key)
        .map_err(|e| AppError::Command(e.to_string()))?;
    // the shell redraws sounds on this broadcast
    notify_sound_change();
    let name = names
        .open_subkey(&key)
        .and_then(|k| k.get_value::<String, _>(""))
        .unwrap_or_else(|_| key.clone());
    undo::log_entry(
        &state,
        "sound_scheme",
        format!("Sound scheme → {}", name),
        json!({ "before": before, "after": key }),
        true,
    )?;
    Ok(format!(
        "Sound scheme changed to {} — it applies to new events immediately.",
        name
    ))
}

#[derive(Serialize, Clone)]
pub struct SoundEvent {
    pub event: String,
    pub label: String,
    pub current: String,
    pub default: String,
    pub has_sound: bool,
}

#[tauri::command]
pub fn list_sound_events() -> Vec<SoundEvent> {
    STANDARD_EVENTS
        .iter()
        .filter_map(|(evt, label)| {
            let key = apps_default_key().ok()?.open_subkey(evt).ok()?;
            let current = key.get_value::<String, _>(".current").unwrap_or_default();
            let default = key.get_value::<String, _>(".default").unwrap_or_default();
            Some(SoundEvent {
                event: evt.to_string(),
                label: label.to_string(),
                current: current.clone(),
                default,
                has_sound: !current.is_empty() && std::path::Path::new(&current).exists(),
            })
        })
        .collect()
}

#[tauri::command]
pub fn set_sound_event(
    state: State<'_, AppState>,
    event: String,
    path: String,
) -> Result<SoundEvent, AppError> {
    if !STANDARD_EVENTS.iter().any(|(e, _)| *e == event) {
        return Err(AppError::Command(format!("Unknown sound event: {}", event)));
    }
    if !path.is_empty() && !std::path::Path::new(&path).exists() {
        return Err(AppError::Command("Sound file not found.".into()));
    }
    let (key, _) = RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey(format!(r"{}\{}", APPS_DEFAULT, event))
        .map_err(|e| AppError::Command(e.to_string()))?;
    let before = key.get_value::<String, _>(".current").unwrap_or_default();
    if path.is_empty() {
        // assign "(None)" — Windows reads an empty .current as no sound
        let _ = key.set_value(".current", &String::new());
    } else {
        key.set_value(".current", &path)
            .map_err(|e| AppError::Command(e.to_string()))?;
    }
    notify_sound_change();
    undo::log_entry(
        &state,
        "sound_event",
        format!(
            "Sound for {} → {}",
            event,
            if path.is_empty() { "(none)" } else { &path }
        ),
        json!({ "event": event, "before": before, "after": path }),
        true,
    )?;
    let label = STANDARD_EVENTS
        .iter()
        .find(|(e, _)| *e == event)
        .map(|(_, l)| l.to_string())
        .unwrap_or_else(|| event.clone());
    Ok(SoundEvent {
        event,
        label,
        current: path.clone(),
        default: String::new(),
        has_sound: !path.is_empty(),
    })
}

// ---- preview (PlaySoundW from winmm) ---------------------------------------

const SND_ASYNC: u32 = 0x0001;
const SND_NODEFAULT: u32 = 0x0002;
const SND_FILENAME: u32 = 0x0002_0000;
const SND_PURGE: u32 = 0x0040;

#[link(name = "winmm")]
extern "system" {
    fn PlaySoundW(psz_sound: *const u16, hmod: *const core::ffi::c_void, fdw_sound: u32) -> i32;
}

#[tauri::command]
pub fn preview_sound(path: String) -> Result<String, AppError> {
    if !std::path::Path::new(&path).exists() {
        return Err(AppError::Command("Sound file not found.".into()));
    }
    let wide: Vec<u16> = path.encode_utf16().chain(Some(0)).collect();
    let ok = unsafe {
        PlaySoundW(
            wide.as_ptr(),
            std::ptr::null(),
            SND_FILENAME | SND_ASYNC | SND_NODEFAULT,
        )
    };
    if ok == 0 {
        Err(AppError::Command(
            "Windows couldn't play that file (unsupported format?).".into(),
        ))
    } else {
        Ok("Playing…".into())
    }
}

#[tauri::command]
pub fn stop_preview() -> Result<(), AppError> {
    unsafe {
        PlaySoundW(std::ptr::null(), std::ptr::null(), SND_PURGE);
    }
    Ok(())
}

// ---- import an audio file as a scheme asset ---------------------------------

#[tauri::command]
pub fn import_sound_asset(state: State<'_, AppState>, source: String) -> Result<String, AppError> {
    let src = std::path::Path::new(&source);
    if !src.exists() {
        return Err(AppError::Command("Source file not found.".into()));
    }
    let dir = state.data_dir.join("sounds");
    std::fs::create_dir_all(&dir).map_err(|e| AppError::Command(e.to_string()))?;
    let stem = src
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "sound".into());
    let dst = dir.join(format!("{}_{}.wav", crate::storage::now_millis(), stem));
    let samples = crate::transcode::convert_audio_to_wav(src, &dst)?;
    let secs = samples / 44100;
    Ok(format!(
        "Imported {} ({}s of audio) → {}",
        stem,
        secs,
        dst.to_string_lossy()
    ))
}

// ---- save the current set of sounds as a named scheme ------------------------

#[tauri::command]
pub fn save_current_scheme(state: State<'_, AppState>, name: String) -> Result<String, AppError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::Command("Give the scheme a name.".into()));
    }
    // A scheme is just a Named GUID; the .current values stay in place and the
    // name becomes selectable. New GUID = a new scheme whose sounds are the
    // current ones.
    let guid = format!("{{{}}}", Uuid::new_v4());
    let (key, _) = RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey(format!(r"AppEvents\Schemes\Names\{}", guid))
        .map_err(|e| AppError::Command(e.to_string()))?;
    key.set_value("", &name)
        .map_err(|e| AppError::Command(e.to_string()))?;
    let before = schemes_key()?
        .get_value::<String, _>("")
        .unwrap_or_default();
    schemes_key()?
        .set_value("", &guid)
        .map_err(|e| AppError::Command(e.to_string()))?;
    notify_sound_change();
    undo::log_entry(
        &state,
        "sound_scheme",
        format!("Saved sound scheme '{}' and switched to it", name),
        json!({ "before": before, "after": guid }),
        true,
    )?;
    Ok(format!("Scheme '{}' saved and is now active.", name))
}

// ---- helper: register an event sound directly (for marketplace/undo) ---------

pub fn set_event_raw(event: &str, path: &str) -> Result<(), AppError> {
    let (key, _) = RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey(format!(r"{}\{}", APPS_DEFAULT, event))
        .map_err(|e| AppError::Command(e.to_string()))?;
    key.set_value(".current", &path)
        .map_err(|e| AppError::Command(e.to_string()))?;
    Ok(())
}

pub fn set_scheme_raw(guid: &str) -> Result<(), AppError> {
    schemes_key()?
        .set_value("", &guid.to_string())
        .map_err(|e| AppError::Command(e.to_string()))
}

fn notify_sound_change() {
    use windows::Win32::Foundation::{LPARAM, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE,
    };
    let setting: Vec<u16> = "SndSchem".encode_utf16().chain(Some(0)).collect();
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

// undo support ------------------------------------------------------------------

pub fn restore_scheme(before: &str) -> Result<(), AppError> {
    if !before.is_empty() {
        set_scheme_raw(before)?;
    }
    notify_sound_change();
    Ok(())
}

pub fn restore_event(event: &str, before: &str) -> Result<(), AppError> {
    set_event_raw(event, before)?;
    notify_sound_change();
    Ok(())
}
