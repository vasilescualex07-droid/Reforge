use crate::state::AppState;
use crate::undo;
use serde::Serialize;
use serde_json::json;
use std::path::PathBuf;
use tauri::State;
use winreg::enums::{RegType, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
use winreg::{RegKey, RegValue};

use crate::error::AppError;
#[derive(Serialize, Clone)]
pub struct StartupEntry {
    pub name: String,
    pub command: String,
    pub location: String,
    pub enabled: bool,
    pub impact: u8,
    pub admin_required: bool,
}

const RUN_HKCU: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const RUN_HKLM: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";

fn startup_folder() -> PathBuf {
    let appdata = std::env::var("APPDATA").unwrap_or_default();
    PathBuf::from(appdata).join(r"Microsoft\Windows\Start Menu\Programs\Startup")
}

fn disabled_folder() -> PathBuf {
    startup_folder().join(".reforge_disabled")
}

fn reg_value_to_string(v: &RegValue) -> String {
    String::from_utf8_lossy(&v.bytes)
        .trim_end_matches('\0')
        .to_string()
}

pub fn vtype_name(v: &RegType) -> String {
    match v {
        RegType::REG_SZ => "sz".into(),
        RegType::REG_EXPAND_SZ => "expand_sz".into(),
        RegType::REG_MULTI_SZ => "multi_sz".into(),
        RegType::REG_DWORD => "dword".into(),
        RegType::REG_QWORD => "qword".into(),
        RegType::REG_BINARY => "binary".into(),
        _ => "none".into(),
    }
}

pub fn vtype_from_name(s: &str) -> RegType {
    match s {
        "expand_sz" => RegType::REG_EXPAND_SZ,
        "multi_sz" => RegType::REG_MULTI_SZ,
        "dword" => RegType::REG_DWORD,
        "qword" => RegType::REG_QWORD,
        "binary" => RegType::REG_BINARY,
        _ => RegType::REG_SZ,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vtype_roundtrip() {
        for v in [
            RegType::REG_SZ,
            RegType::REG_EXPAND_SZ,
            RegType::REG_MULTI_SZ,
            RegType::REG_DWORD,
            RegType::REG_QWORD,
            RegType::REG_BINARY,
        ] {
            let name = vtype_name(&v);
            assert_eq!(vtype_from_name(&name), v);
        }
    }

    #[test]
    fn impact_scores_heavier_for_hklm_and_updaters() {
        assert!(impact("NVIDIA Update", "", "HKLM Run") > impact("NotePad", "", "HKCU Run"));
    }
}

fn impact(name: &str, command: &str, location: &str) -> u8 {
    let mut s: u8 = 2;
    if location == "HKLM Run" {
        s += 2;
    }
    let low = format!("{} {}", name, command).to_lowercase();
    for kw in [
        "update",
        "updater",
        "auto",
        "launcher",
        "helper",
        "scheduler",
        "agent",
        "startup",
        "boost",
        "cloud",
        "sync",
    ] {
        if low.contains(kw) {
            s += 2;
        }
    }
    s.min(10)
}

pub fn capture_hkcu_run() -> serde_json::Value {
    let mut map = serde_json::Map::new();
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    if let Ok(key) = hkcu.open_subkey(RUN_HKCU) {
        for (name, value) in key.enum_values().filter_map(|v| v.ok()) {
            map.insert(
                name,
                json!({
                    "bytes": value.bytes,
                    "vtype": vtype_name(&value.vtype),
                }),
            );
        }
    }
    serde_json::Value::Object(map)
}

pub fn restore_run_value(
    name: &str,
    location: &str,
    bytes: Vec<u8>,
    vtype: &str,
) -> Result<(), AppError> {
    let hive = match location {
        "HKLM Run" => RegKey::predef(HKEY_LOCAL_MACHINE),
        _ => RegKey::predef(HKEY_CURRENT_USER),
    };
    let key = hive
        .open_subkey_with_flags(RUN_HKCU, winreg::enums::KEY_SET_VALUE)
        .map_err(|e| AppError::Command(e.to_string()))?;
    key.set_raw_value(
        name,
        &RegValue {
            bytes,
            vtype: vtype_from_name(vtype),
        },
    )
    .map_err(|e| AppError::Command(e.to_string()))
}

pub fn restore_folder_entry(name: &str) -> Result<(), AppError> {
    let from = disabled_folder().join(name);
    if !from.exists() {
        return Ok(());
    }
    let to = startup_folder().join(name);
    std::fs::rename(&from, &to).map_err(|e| AppError::Command(e.to_string()))
}

// ---- Tauri commands ----

#[tauri::command]
pub fn list_startup() -> Vec<StartupEntry> {
    let mut out = Vec::new();

    // HKCU Run
    if let Ok(key) = RegKey::predef(HKEY_CURRENT_USER).open_subkey(RUN_HKCU) {
        for (name, value) in key.enum_values().filter_map(|v| v.ok()) {
            out.push(StartupEntry {
                name: name.clone(),
                command: reg_value_to_string(&value),
                location: "HKCU Run".into(),
                enabled: true,
                impact: impact(&name, &reg_value_to_string(&value), "HKCU Run"),
                admin_required: false,
            });
        }
    }

    // HKLM Run (read-only attempt)
    if let Ok(key) = RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(RUN_HKLM) {
        for (name, value) in key.enum_values().filter_map(|v| v.ok()) {
            out.push(StartupEntry {
                name: name.clone(),
                command: reg_value_to_string(&value),
                location: "HKLM Run".into(),
                enabled: true,
                impact: impact(&name, &reg_value_to_string(&value), "HKLM Run"),
                admin_required: true,
            });
        }
    }

    // Startup folder
    if let Ok(rd) = std::fs::read_dir(startup_folder()) {
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if name == ".reforge_disabled" {
                continue;
            }
            out.push(StartupEntry {
                name: name.clone(),
                command: e.path().to_string_lossy().to_string(),
                location: "Startup folder".into(),
                enabled: true,
                impact: impact(&name, "", "Startup folder"),
                admin_required: false,
            });
        }
    }
    // Disabled entries
    if let Ok(rd) = std::fs::read_dir(disabled_folder()) {
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            out.push(StartupEntry {
                name,
                command: e.path().to_string_lossy().to_string(),
                location: "Startup folder".into(),
                enabled: false,
                impact: 0,
                admin_required: false,
            });
        }
    }

    out.sort_by_key(|x| std::cmp::Reverse(x.impact));
    out
}

#[tauri::command]
pub fn toggle_startup(
    state: State<'_, AppState>,
    name: String,
    location: String,
    enable: bool,
) -> Result<Vec<StartupEntry>, AppError> {
    match location.as_str() {
        "HKCU Run" => {
            if enable {
                // restore from the undo log
                let entries = crate::storage::load_json::<Vec<undo::UndoEntry>>(
                    &state.undo_log_path(),
                    Vec::new(),
                );
                let found = entries
                    .iter()
                    .rev()
                    .find(|e| {
                        e.kind == "startup_disable"
                            && e.data.get("name").and_then(|v| v.as_str()) == Some(name.as_str())
                            && e.data.get("location").and_then(|v| v.as_str()) == Some("HKCU Run")
                            && !e.undone
                    })
                    .ok_or_else(|| "No recorded backup for this entry".to_string())?;
                let bytes: Vec<u8> = found
                    .data
                    .get("bytes")
                    .and_then(|v| v.as_array())
                    .map(|a| {
                        a.iter()
                            .filter_map(|n| n.as_u64().map(|n| n as u8))
                            .collect()
                    })
                    .unwrap_or_default();
                let vtype = found
                    .data
                    .get("vtype")
                    .and_then(|v| v.as_str())
                    .unwrap_or("sz");
                restore_run_value(&name, "HKCU Run", bytes, vtype)?;
                // mark undone
                let mut entries = crate::storage::load_json::<Vec<undo::UndoEntry>>(
                    &state.undo_log_path(),
                    Vec::new(),
                );
                if let Some(e) = entries.iter_mut().find(|e| e.id == found.id) {
                    e.undone = true;
                }
                crate::storage::save_json(&state.undo_log_path(), &entries)?;
            } else {
                let key = RegKey::predef(HKEY_CURRENT_USER)
                    .open_subkey_with_flags(
                        RUN_HKCU,
                        winreg::enums::KEY_SET_VALUE | winreg::enums::KEY_QUERY_VALUE,
                    )
                    .map_err(|e| AppError::Command(e.to_string()))?;
                let raw = key
                    .get_raw_value(&name)
                    .map_err(|e| AppError::Command(e.to_string()))?;
                undo::log_entry(
                    &state,
                    "startup_disable",
                    format!("Disabled startup entry: {}", name),
                    json!({
                        "name": name,
                        "location": "HKCU Run",
                        "bytes": raw.bytes,
                        "vtype": vtype_name(&raw.vtype),
                    }),
                    true,
                )?;
                key.delete_value(&name)
                    .map_err(|e| AppError::Command(e.to_string()))?;
            }
        }
        "Startup folder" => {
            let src = if enable {
                disabled_folder().join(&name)
            } else {
                startup_folder().join(&name)
            };
            let dst = if enable {
                startup_folder().join(&name)
            } else {
                std::fs::create_dir_all(disabled_folder())
                    .map_err(|e| AppError::Command(e.to_string()))?;
                disabled_folder().join(&name)
            };
            if !src.exists() {
                return Err(AppError::Command(format!("Entry not found: {}", name)));
            }
            std::fs::rename(&src, &dst).map_err(|e| AppError::Command(e.to_string()))?;
            if !enable {
                undo::log_entry(
                    &state,
                    "startup_folder_disable",
                    format!("Disabled startup entry: {}", name),
                    json!({ "name": name, "location": "Startup folder" }),
                    true,
                )?;
            }
        }
        _ => {
            return Err(AppError::Command(format!(
                "Unsupported location: {}",
                location
            )))
        }
    }
    Ok(list_startup())
}
