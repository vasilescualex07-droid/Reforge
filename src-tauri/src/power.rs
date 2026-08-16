// Power & battery view (S10.1). Reads real Windows state: live battery from
// GetSystemPowerStatus, battery health from powercfg /batteryreport, the active
// power plan + screen-off timeouts from powercfg, and hibernate from HKLM.
// Every mutating command snapshots the before-state and logs an undoable entry
// (kind "power") so History can restore it.

use crate::state::AppState;
use crate::storage::{load_json, save_json};
use crate::undo;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::{Path, PathBuf};
use tauri::State;
use winreg::enums::HKEY_LOCAL_MACHINE;
use winreg::RegKey;

use crate::error::AppError;

// The three classic Windows power schemes.
const PLANS: [(&str, &str, &str); 3] = [
    (
        "381b4222-f694-41f0-9685-ff5bb260df2e",
        "Balanced",
        "Best blend of performance and battery life",
    ),
    (
        "a1841308-3541-4fab-bc81-f71556f20b4a",
        "Best power efficiency",
        "Power saver — maximum battery life",
    ),
    (
        "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c",
        "Best performance",
        "High performance — maximum speed",
    ),
];

#[derive(Serialize, Clone)]
pub struct PowerPlan {
    pub guid: String,
    pub name: String,
    pub hint: String,
    pub active: bool,
}

#[derive(Serialize, Clone)]
pub struct PowerState {
    pub battery: Option<LiveBattery>,
    pub battery_health: Option<BatteryHealth>,
    pub plans: Vec<PowerPlan>,
    pub screen_off_ac_min: u32,
    pub screen_off_dc_min: u32,
    pub hibernate_enabled: bool,
    pub hibernate_supported: bool,
}

#[derive(Serialize, Clone)]
pub struct LiveBattery {
    pub percent: u8,
    pub on_ac: bool,
    pub charging: bool,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct BatteryHealth {
    pub health_pct: Option<u32>,
    pub design_mwh: Option<u32>,
    pub full_mwh: Option<u32>,
    pub cycle_count: Option<u32>,
}

/// Snapshot shape stored in the undo entry (kind "power").
#[derive(Serialize, Deserialize, Clone, Default)]
pub struct PowerSnapshot {
    pub plan_guid: String,
    pub screen_off_ac_min: u32,
    pub screen_off_dc_min: u32,
    pub hibernate_enabled: bool,
}

fn powercfg(args: &[&str]) -> String {
    crate::cmd::hidden("powercfg")
        .args(args)
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default()
}

fn live_battery() -> Option<LiveBattery> {
    unsafe {
        use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
        let mut st: SYSTEM_POWER_STATUS = std::mem::zeroed();
        if GetSystemPowerStatus(&mut st).is_err() || st.BatteryFlag == 255 {
            return None; // no battery
        }
        Some(LiveBattery {
            percent: st.BatteryLifePercent,
            on_ac: st.ACLineStatus == 1,
            charging: st.BatteryFlag == 8,
        })
    }
}

fn battery_health(dir: &Path) -> Option<BatteryHealth> {
    // powercfg /batteryreport is slow (~1s) and needs a temp file; the health
    // numbers (design/full capacity) only change over weeks, so cache the
    // parsed result in the app data dir.
    let cache: PathBuf = dir.join("battery_health.json");
    let cached: Option<BatteryHealth> = load_json(&cache, None);
    if let Some(h) = &cached {
        return Some(h.clone());
    }
    let out = std::env::temp_dir().join("reforge_battery_report.html");
    powercfg(&["/batteryreport", &format!("/output {}", out.display())]);
    let s = std::fs::read_to_string(&out).unwrap_or_default();
    let parse = |label: &str| -> Option<u32> {
        s.lines().find(|l| l.contains(label)).and_then(|l| {
            let after = l.split(label).nth(1)?;
            after
                .split(|c: char| !c.is_ascii_digit())
                .find(|x| !x.is_empty())?
                .parse()
                .ok()
        })
    };
    let design = parse("DESIGN CAPACITY");
    let full = parse("FULL CHARGE CAPACITY");
    let cycles = parse("CYCLE COUNT");
    let health = match (design, full) {
        (Some(d), Some(f)) if d > 0 => Some((f as f64 / d as f64 * 100.0).round() as u32),
        _ => None,
    };
    let bh = BatteryHealth {
        health_pct: health,
        design_mwh: design,
        full_mwh: full,
        cycle_count: cycles,
    };
    let _ = save_json(&cache, &bh);
    Some(bh)
}

fn active_scheme() -> (String, String) {
    let out = powercfg(&["/getactivescheme"]);
    // "Power Scheme GUID: 381b4222-f694-41f0-9685-ff5bb260df2e  (Balanced)"
    let guid = out
        .split_whitespace()
        .find(|t| t.contains('-') && t.len() == 36)
        .unwrap_or_default()
        .to_string();
    let name = out
        .split('(')
        .nth(1)
        .and_then(|s| s.split(')').next())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "Custom".into());
    (guid, name)
}

/// Screen-off timeout in minutes from `powercfg /query SCHEME_CURRENT SUB_VIDEO VIDEOIDLE`.
fn screen_off_minutes() -> (u32, u32) {
    let out = powercfg(&["/query", "SCHEME_CURRENT", "SUB_VIDEO", "VIDEOIDLE"]);
    let mut ac = 0u32;
    let mut dc = 0u32;
    for line in out.lines() {
        if line.contains("Current AC Power Setting Index") {
            ac = hex_index(line);
        } else if line.contains("Current DC Power Setting Index") {
            dc = hex_index(line);
        }
    }
    (ac / 60, dc / 60)
}

fn hex_index(line: &str) -> u32 {
    // "Current AC Power Setting Index: 0x00000258" → seconds
    line.split("0x")
        .nth(1)
        .and_then(|h| u32::from_str_radix(h.trim(), 16).ok())
        .unwrap_or(0)
}

fn hibernate_state() -> (bool, bool) {
    let supported = {
        let out = powercfg(&["/a"]);
        out.contains("Hibernate") && !out.contains("The following sleep states are not available")
    };
    let enabled = RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey(r"SYSTEM\CurrentControlSet\Control\Power")
        .and_then(|k| k.get_value::<u32, _>("HibernateEnabled"))
        .map(|v| v == 1)
        .unwrap_or(false);
    (supported, enabled)
}

fn current_snapshot() -> PowerSnapshot {
    let (plan_guid, _) = active_scheme();
    let (ac, dc) = screen_off_minutes();
    let (_, hibernate_enabled) = hibernate_state();
    PowerSnapshot {
        plan_guid,
        screen_off_ac_min: ac,
        screen_off_dc_min: dc,
        hibernate_enabled,
    }
}

// ---- tauri commands ---------------------------------------------------------

#[tauri::command]
pub fn get_power_state(state: State<'_, AppState>) -> PowerState {
    let (plan_guid, active_name) = active_scheme();
    let (ac, dc) = screen_off_minutes();
    let (hibernate_supported, hibernate_enabled) = hibernate_state();
    let plans: Vec<PowerPlan> = PLANS
        .iter()
        .map(|(guid, name, hint)| PowerPlan {
            guid: guid.to_string(),
            name: name.to_string(),
            hint: hint.to_string(),
            active: *guid == plan_guid,
        })
        .collect();
    // A custom/unknown active plan still shows (not active on any card).
    let plans = if plans.iter().any(|p| p.active) {
        plans
    } else {
        let mut plans = plans;
        plans.insert(
            0,
            PowerPlan {
                guid: plan_guid.clone(),
                name: active_name,
                hint: "Active plan".into(),
                active: true,
            },
        );
        plans
    };
    PowerState {
        battery: live_battery(),
        battery_health: battery_health(&state.data_dir),
        plans,
        screen_off_ac_min: ac,
        screen_off_dc_min: dc,
        hibernate_enabled,
        hibernate_supported,
    }
}

#[tauri::command]
pub fn set_power_plan(state: State<'_, AppState>, guid: String) -> Result<String, AppError> {
    let before = current_snapshot();
    let out = powercfg(&["/setactive", &guid]);
    if out.contains("error") || out.contains("Error") {
        return Err(AppError::Command(format!("powercfg /setactive: {}", out.trim())));
    }
    let name = PLANS
        .iter()
        .find(|(g, _, _)| *g == guid)
        .map(|(_, n, _)| *n)
        .unwrap_or("plan");
    undo::log_entry(
        &state,
        "power",
        format!("Power plan → {}", name),
        json!({ "before": before, "after": json!({ "plan_guid": guid }) }),
        true,
    )?;
    Ok(format!("Power plan → {}", name))
}

#[tauri::command]
pub fn set_screen_off_timeout(
    state: State<'_, AppState>,
    ac_min: u32,
    dc_min: u32,
) -> Result<String, AppError> {
    let before = current_snapshot();
    let ac = ac_min.clamp(1, 600);
    let dc = dc_min.clamp(1, 600);
    let out = powercfg(&["/change", "monitor-timeout-ac", &ac.to_string()]);
    let out2 = powercfg(&["/change", "monitor-timeout-dc", &dc.to_string()]);
    if out.contains("error") || out2.contains("error") {
        return Err(AppError::Command("powercfg /change monitor-timeout failed".into()));
    }
    undo::log_entry(
        &state,
        "power",
        format!("Screen off after {} min (AC) / {} min (DC)", ac, dc),
        json!({
            "before": before,
            "after": json!({ "screen_off_ac_min": ac, "screen_off_dc_min": dc })
        }),
        true,
    )?;
    Ok(format!("Screen off: {} min on power, {} min on battery", ac, dc))
}

#[tauri::command]
pub fn set_hibernate(state: State<'_, AppState>, enabled: bool) -> Result<String, AppError> {
    let before = current_snapshot();
    let out = powercfg(&["/h", if enabled { "on" } else { "off" }]);
    if out.contains("error") || out.contains("Error") || out.contains("access is denied") {
        return Err(AppError::Command(
            "Hibernate change failed — needs administrator rights".into(),
        ));
    }
    undo::log_entry(
        &state,
        "power",
        format!("Hibernate → {}", if enabled { "on" } else { "off" }),
        json!({ "before": before, "after": json!({ "hibernate_enabled": enabled }) }),
        true,
    )?;
    Ok(format!("Hibernate {}", if enabled { "enabled" } else { "disabled" }))
}

/// Undo support: restore a PowerSnapshot (plan + screen-off + hibernate).
pub fn restore_snapshot(snap: &PowerSnapshot) -> Result<(), AppError> {
    if !snap.plan_guid.is_empty() {
        powercfg(&["/setactive", &snap.plan_guid]);
    }
    if snap.screen_off_ac_min > 0 || snap.screen_off_dc_min > 0 {
        powercfg(&[
            "/change",
            "monitor-timeout-ac",
            &snap.screen_off_ac_min.max(1).to_string(),
        ]);
        powercfg(&[
            "/change",
            "monitor-timeout-dc",
            &snap.screen_off_dc_min.max(1).to_string(),
        ]);
    }
    powercfg(&["/h", if snap.hibernate_enabled { "on" } else { "off" }]);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_index_parses_seconds() {
        assert_eq!(hex_index("Current AC Power Setting Index: 0x00000258"), 600);
        assert_eq!(hex_index("Current DC Power Setting Index: 0x00000078"), 120);
        assert_eq!(hex_index("no index here"), 0);
    }

    #[test]
    fn active_scheme_parses_guid_and_name() {
        let out = "Power Scheme GUID: 381b4222-f694-41f0-9685-ff5bb260df2e  (Balanced)";
        let guid = out
            .split_whitespace()
            .find(|t| t.contains('-') && t.len() == 36)
            .unwrap_or_default()
            .to_string();
        assert_eq!(guid, "381b4222-f694-41f0-9685-ff5bb260df2e");
        let name = out
            .split('(')
            .nth(1)
            .and_then(|s| s.split(')').next())
            .map(|s| s.trim().to_string())
            .unwrap_or_default();
        assert_eq!(name, "Balanced");
    }

    #[test]
    fn snapshot_roundtrips_through_json() {
        let s = PowerSnapshot {
            plan_guid: "abc".into(),
            screen_off_ac_min: 10,
            screen_off_dc_min: 5,
            hibernate_enabled: true,
        };
        let v = serde_json::to_value(&s).unwrap();
        let back: PowerSnapshot = serde_json::from_value(v).unwrap();
        assert_eq!(back.plan_guid, "abc");
        assert_eq!(back.screen_off_ac_min, 10);
        assert!(back.hibernate_enabled);
    }

    #[test]
    fn plans_mark_active_correctly() {
        let plans: Vec<PowerPlan> = PLANS
            .iter()
            .map(|(guid, name, hint)| PowerPlan {
                guid: guid.to_string(),
                name: name.to_string(),
                hint: hint.to_string(),
                active: *guid == "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c",
            })
            .collect();
        assert_eq!(plans.iter().filter(|p| p.active).count(), 1);
    }
}
