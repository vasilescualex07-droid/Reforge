use crate::error::AppError;
use crate::state::AppState;
use crate::undo;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::State;
use windows::Win32::UI::WindowsAndMessaging::{
    SystemParametersInfoW, SPIF_SENDCHANGE, SPIF_UPDATEINIFILE, SPI_SETCURSORS,
};
use winreg::enums::{HKEY_CURRENT_USER, KEY_QUERY_VALUE, KEY_SET_VALUE};
use winreg::RegKey;

const CURSORS_KEY: &str = r"Control Panel\Cursors";

const CURSOR_VALUES: [&str; 16] = [
    "Arrow",
    "Help",
    "AppStarting",
    "Wait",
    "Crosshair",
    "IBeam",
    "NWPen",
    "No",
    "SizeNS",
    "SizeWE",
    "SizeNWSE",
    "SizeNESW",
    "SizeAll",
    "UpArrow",
    "Hand",
    "Person",
];

#[derive(Serialize, Deserialize, Clone)]
pub struct CursorState {
    pub scheme_source: String,
    pub cursors: Vec<CursorValue>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct CursorValue {
    pub name: String,
    pub path: String,
}

#[derive(Serialize)]
pub struct CursorScheme {
    pub id: String,
    pub name: String,
    pub description: String,
}

fn cursor_key() -> Result<RegKey, AppError> {
    RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey_with_flags(CURSORS_KEY, KEY_QUERY_VALUE | KEY_SET_VALUE)
        .map_err(|e| AppError::Command(e.to_string()))
}

pub fn read_cursor_state() -> CursorState {
    let mut cursors = Vec::new();
    let scheme_source = cursor_key()
        .and_then(|k| {
            k.get_value("Scheme Source")
                .map_err(|e| AppError::Command(e.to_string()))
        })
        .unwrap_or_default();
    if let Ok(k) = cursor_key() {
        for name in CURSOR_VALUES {
            let path = k.get_value::<String, _>(name).unwrap_or_default();
            cursors.push(CursorValue {
                name: name.to_string(),
                path,
            });
        }
    }
    CursorState {
        scheme_source,
        cursors,
    }
}

fn schemes() -> Vec<CursorScheme> {
    vec![
        CursorScheme {
            id: "aero".into(),
            name: "Windows Aero".into(),
            description: "The modern Windows 10/11 cursors with the blue glow.".into(),
        },
        CursorScheme {
            id: "black".into(),
            name: "Windows Black".into(),
            description: "High-contrast black cursors — great on bright screens.".into(),
        },
        CursorScheme {
            id: "default".into(),
            name: "System default".into(),
            description: "Reset everything to whatever Windows is using by default.".into(),
        },
    ]
}

fn scheme_values(id: &str) -> Vec<(String, String)> {
    let pairs: Vec<(&str, &str)> = match id {
        "aero" => vec![
            ("Arrow", "aero_arrow.cur"),
            ("Help", "aero_helpsel.cur"),
            ("AppStarting", "aero_working.ani"),
            ("Wait", "aero_busy.ani"),
            ("Crosshair", "aero_cross.cur"),
            ("IBeam", "aero_beam.cur"),
            ("NWPen", "aero_pen.cur"),
            ("No", "aero_unavail.cur"),
            ("SizeNS", "aero_ns.cur"),
            ("SizeWE", "aero_ew.cur"),
            ("SizeNWSE", "aero_nwse.cur"),
            ("SizeNESW", "aero_nesw.cur"),
            ("SizeAll", "aero_move.cur"),
            ("UpArrow", "aero_up.cur"),
            ("Hand", "aero_link.cur"),
            ("Person", "aero_person.cur"),
        ],
        "black" => vec![
            ("Arrow", "aero_black_arrow.cur"),
            ("Help", "aero_black_helpsel.cur"),
            ("AppStarting", "aero_black_working.ani"),
            ("Wait", "aero_black_busy.ani"),
            ("Crosshair", "aero_black_cross.cur"),
            ("IBeam", "aero_black_beam.cur"),
            ("NWPen", "aero_black_pen.cur"),
            ("No", "aero_black_unavail.cur"),
            ("SizeNS", "aero_black_ns.cur"),
            ("SizeWE", "aero_black_ew.cur"),
            ("SizeNWSE", "aero_black_nwse.cur"),
            ("SizeNESW", "aero_black_nesw.cur"),
            ("SizeAll", "aero_black_move.cur"),
            ("UpArrow", "aero_black_up.cur"),
            ("Hand", "aero_black_link.cur"),
            ("Person", "aero_black_person.cur"),
        ],
        _ => vec![],
    };
    pairs
        .into_iter()
        .map(|(k, file)| (k.to_string(), format!(r"C:\Windows\Cursors\{}", file)))
        .collect()
}

pub(crate) fn apply_scheme_raw(id: &str) -> Result<(), AppError> {
    let key = cursor_key()?;
    if id == "default" {
        // empty paths = system default cursor for each slot
        for name in CURSOR_VALUES {
            key.set_value(name, &String::new())
                .map_err(|e| AppError::Command(e.to_string()))?;
        }
        key.set_value("Scheme Source", &String::new())
            .map_err(|e| AppError::Command(e.to_string()))?;
    } else {
        let values = scheme_values(id);
        for (k, v) in &values {
            if std::path::Path::new(v).exists() {
                key.set_value(k, v)
                    .map_err(|e| AppError::Command(e.to_string()))?;
            }
        }
        key.set_value("Scheme Source", &format!("Reforge:{}", id))
            .map_err(|e| AppError::Command(e.to_string()))?;
    }
    unsafe {
        SystemParametersInfoW(
            SPI_SETCURSORS,
            0,
            None,
            SPIF_UPDATEINIFILE | SPIF_SENDCHANGE,
        )
        .map_err(|e| AppError::Command(e.to_string()))?;
    }
    Ok(())
}

#[tauri::command]
pub fn list_cursor_schemes() -> Vec<CursorScheme> {
    schemes()
}

#[tauri::command]
pub fn get_cursor_state() -> CursorState {
    read_cursor_state()
}

#[tauri::command]
pub fn apply_cursor_scheme(
    state: State<'_, AppState>,
    id: String,
) -> Result<CursorState, AppError> {
    if !schemes().iter().any(|s| s.id == id) {
        return Err(AppError::Command(format!("Unknown cursor scheme: {}", id)));
    }
    let before = read_cursor_state();
    apply_scheme_raw(&id)?;
    undo::log_entry(
        &state,
        "cursors",
        format!("Applied cursor scheme: {}", id),
        json!({ "before": before, "after": id }),
        true,
    )?;
    Ok(read_cursor_state())
}

// undo support
pub fn restore_cursors(state: &AppState, before: &CursorState) -> Result<(), AppError> {
    let key = cursor_key()?;
    for c in &before.cursors {
        key.set_value(&c.name, &c.path)
            .map_err(|e| AppError::Command(e.to_string()))?;
    }
    key.set_value("Scheme Source", &before.scheme_source)
        .map_err(|e| AppError::Command(e.to_string()))?;
    unsafe {
        SystemParametersInfoW(
            SPI_SETCURSORS,
            0,
            None,
            SPIF_UPDATEINIFILE | SPIF_SENDCHANGE,
        )
        .map_err(|e| AppError::Command(e.to_string()))?;
    }
    let _ = state;
    Ok(())
}
