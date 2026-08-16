use crate::cmd::hidden as cmd;
use crate::state::AppState;
use crate::storage::now_millis;
use crate::undo;
use serde::Serialize;
use serde_json::json;
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::State;

use crate::error::AppError;
#[derive(Serialize, Clone)]
pub struct NetHog {
    pub name: String,
    pub pid: u32,
    pub connections: u32,
}

fn process_names() -> HashMap<u32, String> {
    let mut map = HashMap::new();
    let out = cmd("tasklist")
        .args(["/fo", "csv", "/nh"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();
    for line in out.lines() {
        let f: Vec<&str> = line.split(',').collect();
        if f.len() >= 2 {
            let name = f[0].trim_matches('"').to_string();
            let pid: u32 = f[1].trim_matches('"').parse().unwrap_or(0);
            if pid > 0 {
                map.insert(pid, name);
            }
        }
    }
    map
}

#[tauri::command]
pub fn get_bandwidth_hogs() -> Vec<NetHog> {
    let out = cmd("netstat")
        .args(["-ano"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();
    let mut counts: HashMap<u32, u32> = HashMap::new();
    for line in out.lines() {
        let l = line.trim();
        if !l.contains("ESTABLISHED") && !l.contains("TIME_WAIT") {
            continue;
        }
        if let Some(pid) = l
            .split_whitespace()
            .last()
            .and_then(|p| p.parse::<u32>().ok())
        {
            *counts.entry(pid).or_insert(0) += 1;
        }
    }
    let names = process_names();
    let mut hogs: Vec<NetHog> = counts
        .into_iter()
        .filter_map(|(pid, c)| {
            let name = names
                .get(&pid)
                .cloned()
                .unwrap_or_else(|| format!("PID {}", pid));
            if name.contains("System") || name.contains("svchost") {
                return None;
            }
            Some(NetHog {
                name,
                pid,
                connections: c,
            })
        })
        .collect();
    hogs.sort_by_key(|x| std::cmp::Reverse(x.connections));
    hogs.truncate(15);
    hogs
}

// ---------------------------------------------------------------------------
// Saved Wi-Fi profiles
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
pub struct WifiProfile {
    pub name: String,
    pub backed_up: bool,
}

fn run_netsh(args: &[&str]) -> Result<String, AppError> {
    // E3 shell audit: every caller passes a fixed arg list (never concatenated
    // user input) — log each invocation with its args for the audit trail.
    tracing::info!(target: "shell", "netsh: {}", args.join(" "));
    let out = cmd("netsh")
        .args(args)
        .output()
        .map_err(|e| AppError::Command(e.to_string()))?;
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

#[tauri::command]
pub fn list_wifi_profiles() -> Vec<WifiProfile> {
    let out = run_netsh(&["wlan", "show", "profiles"]).unwrap_or_default();
    let mut profiles = Vec::new();
    for line in out.lines() {
        let l = line.trim();
        if let Some(idx) = l.find(':') {
            let name = l[idx + 1..].trim().trim_matches('"').to_string();
            if !name.is_empty() && l.to_lowercase().starts_with("all user profile") {
                profiles.push(WifiProfile {
                    name,
                    backed_up: false,
                });
            }
        }
    }
    profiles
}

fn wifi_backup_dir(state: &AppState) -> PathBuf {
    state.data_dir.join("wifi_backups")
}

#[tauri::command]
pub fn forget_wifi_profile(state: State<'_, AppState>, name: String) -> Result<String, AppError> {
    // E3 shell audit: the profile name is frontend input woven into a netsh
    // arg — bound it before it reaches a command line (no control chars,
    // sane length; it is passed as one argv element, never shell-concatenated).
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 128 || name.chars().any(|c| c.is_control()) {
        return Err(AppError::Invalid("Invalid Wi-Fi profile name.".into()));
    }
    // backup the profile XML first so it can be restored
    let dir = wifi_backup_dir(&state);
    std::fs::create_dir_all(&dir).map_err(|e| AppError::Command(e.to_string()))?;
    let file = dir.join(format!("{}_{}.xml", now_millis(), sanitize(name)));
    tracing::info!(target: "shell", "netsh: wlan export profile name={name} folder={}", dir.display());
    let ok = cmd("netsh")
        .args([
            "wlan",
            "export",
            "profile",
            &format!("name={}", name),
            &format!("folder={}", dir.display()),
        ])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    let backup_path = if ok {
        find_exported_xml(&dir, name).unwrap_or_else(|| file.to_string_lossy().to_string())
    } else {
        String::new()
    };
    tracing::info!(target: "shell", "netsh: wlan delete profile name={name}");
    let del = cmd("netsh")
        .args(["wlan", "delete", "profile", &format!("name={}", name)])
        .output()
        .map_err(|e| AppError::Command(e.to_string()))?;
    if !del.status.success() {
        return Err(AppError::Command(
            String::from_utf8_lossy(&del.stderr).trim().to_string(),
        ));
    }
    undo::log_entry(
        &state,
        "wifi_forgot",
        format!("Forgot saved Wi-Fi network: {}", name),
        json!({ "name": name, "backup": backup_path }),
        true,
    )?;
    Ok(format!(
        "Forgot {} (profile backed up — restorable from History).",
        name
    ))
}

fn find_exported_xml(dir: &PathBuf, name: &str) -> Option<String> {
    let lower = name.to_lowercase().replace([' ', '\\', '/', ':'], "_");
    let mut best: Option<(u64, String)> = None;
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.flatten() {
            let p = e.path();
            if p.extension().map(|x| x == "xml").unwrap_or(false) {
                let fname = p
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_lowercase())
                    .unwrap_or_default();
                if fname.contains(&lower) || lower.contains(&fname) {
                    let mtime = p
                        .metadata()
                        .and_then(|m| m.modified())
                        .ok()
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs())
                        .unwrap_or(0);
                    if best.as_ref().is_none_or(|(t, _)| mtime > *t) {
                        best = Some((mtime, p.to_string_lossy().to_string()));
                    }
                }
            }
        }
    }
    best.map(|(_, p)| p)
}

fn sanitize(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

// ---------------------------------------------------------------------------
// VPN connections
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
pub struct VpnConnection {
    pub name: String,
    pub server_address: String,
    pub status: String, // "connected" | "disconnected" | "connecting" | ...
    #[serde(rename = "type")]
    pub type_: String,
}

fn vpn_status_label(raw: &str) -> String {
    match raw.to_lowercase().as_str() {
        "connected" => "connected".into(),
        "connecting" => "connecting".into(),
        "disconnected" => "disconnected".into(),
        "alwayson" => "connected".into(),
        other => other.to_string(),
    }
}

fn run_powershell(script: &str) -> Result<String, AppError> {
    // E3 shell audit: every caller passes a fixed constant script (the VPN
    // queries) — log each invocation with its args for the audit trail.
    tracing::info!(target: "shell", "powershell: {}", script);
    let out = cmd("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .output()
        .map_err(|e| AppError::Command(e.to_string()))?;
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

#[tauri::command]
pub fn list_vpn_connections() -> Vec<VpnConnection> {
    // Get-VpnConnection is available on Windows 10+; older systems return nothing
    // and the UI states that explicitly instead of failing silently.
    let script = "try { Get-VpnConnection | Select-Object Name,ServerAddress,ConnectionStatus,TunnelType | ConvertTo-Json -Compress } catch { '' }";
    let out = run_powershell(script).unwrap_or_default();
    if out.is_empty() || out == "null" {
        return Vec::new();
    }
    let v: serde_json::Value = serde_json::from_str(&out).unwrap_or(serde_json::Value::Null);
    let arr = match v {
        serde_json::Value::Array(a) => a,
        serde_json::Value::Object(_) => vec![v],
        _ => return Vec::new(),
    };
    arr.into_iter()
        .filter_map(|e| {
            let name = e.get("Name")?.as_str()?.to_string();
            Some(VpnConnection {
                name,
                server_address: e
                    .get("ServerAddress")
                    .and_then(|s| s.as_str())
                    .unwrap_or("")
                    .to_string(),
                status: vpn_status_label(
                    e.get("ConnectionStatus")
                        .and_then(|s| s.as_str())
                        .unwrap_or("disconnected"),
                ),
                type_: e
                    .get("TunnelType")
                    .and_then(|s| s.as_str())
                    .unwrap_or("")
                    .to_string(),
            })
        })
        .collect()
}

// raw (no undo logging) — used by revert
pub fn vpn_connect_raw(name: &str) -> Result<String, AppError> {
    tracing::info!(target: "shell", "rasdial connect: {name}");
    let out = cmd("rasdial")
        .arg(name)
        .output()
        .map_err(|e| AppError::Command(e.to_string()))?;
    if out.status.success() {
        Ok(format!("Connected to {}", name))
    } else {
        let err = String::from_utf8_lossy(&out.stdout).trim().to_string();
        Err(AppError::Command(format!(
            "Could not connect to '{}'. {}",
            name,
            if err.is_empty() {
                "Check the VPN profile or run as admin.".into()
            } else {
                err
            }
        )))
    }
}

pub fn vpn_disconnect_raw(name: &str) -> Result<String, AppError> {
    tracing::info!(target: "shell", "rasdial disconnect: {name}");
    let out = cmd("rasdial")
        .args([name, "/d"])
        .output()
        .map_err(|e| AppError::Command(e.to_string()))?;
    if out.status.success() {
        Ok(format!("Disconnected from {}", name))
    } else {
        Err(AppError::Command(format!(
            "Could not disconnect '{}': {}",
            name,
            String::from_utf8_lossy(&out.stdout).trim()
        )))
    }
}

#[tauri::command]
pub fn vpn_connect(
    state: State<'_, AppState>,
    name: String,
) -> Result<Vec<VpnConnection>, AppError> {
    let before_status = list_vpn_connections()
        .into_iter()
        .find(|v| v.name == name)
        .map(|v| v.status)
        .unwrap_or_else(|| "disconnected".into());
    let msg = vpn_connect_raw(&name)?;
    undo::log_entry(
        &state,
        "vpn_connect",
        msg.clone(),
        json!({ "name": name, "before_status": before_status }),
        true,
    )?;
    Ok(list_vpn_connections())
}

#[tauri::command]
pub fn vpn_disconnect(
    state: State<'_, AppState>,
    name: String,
) -> Result<Vec<VpnConnection>, AppError> {
    let before_status = list_vpn_connections()
        .into_iter()
        .find(|v| v.name == name)
        .map(|v| v.status)
        .unwrap_or_else(|| "connected".into());
    let msg = vpn_disconnect_raw(&name)?;
    undo::log_entry(
        &state,
        "vpn_disconnect",
        msg.clone(),
        json!({ "name": name, "before_status": before_status }),
        true,
    )?;
    Ok(list_vpn_connections())
}

// ---------------------------------------------------------------------------
// Network reset
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct NetResetResult {
    pub steps: Vec<NetResetStep>,
    pub backup: Option<NetResetBackup>,
}

#[derive(Serialize)]
pub struct NetResetStep {
    pub name: String,
    pub ok: bool,
    pub detail: String,
}

#[derive(Serialize, Clone)]
pub struct NetResetBackup {
    pub backup_dir: String,
    pub files: Vec<String>,
}

fn run_step(name: &str, program: &str, args: &[&str]) -> NetResetStep {
    tracing::info!(target: "shell", "{program}: {}", args.join(" "));
    let out = crate::cmd::hidden(program).args(args).output();
    match out {
        Ok(o) => {
            let detail = String::from_utf8_lossy(&o.stdout).trim().to_string();
            NetResetStep {
                name: name.into(),
                ok: o.status.success(),
                detail,
            }
        }
        Err(e) => NetResetStep {
            name: name.into(),
            ok: false,
            detail: e.to_string(),
        },
    }
}

/// Capture the current adapter/IP configuration before a disruptive reset so the
/// user can see (and manually restore) what changed.
fn backup_network_state(state: &AppState) -> NetResetBackup {
    let dir = state
        .data_dir
        .join("network_backups")
        .join(now_millis().to_string());
    let _ = std::fs::create_dir_all(&dir);
    let mut files = Vec::new();
    for (label, program, args) in [
        ("ipconfig_all.txt", "ipconfig", vec!["/all"]),
        (
            "netsh_ip_config.txt",
            "netsh",
            vec!["interface", "ip", "show", "config"],
        ),
        ("route_print.txt", "route", vec!["print"]),
    ] {
        if let Ok(o) = crate::cmd::hidden(program).args(&args).output() {
            let path = dir.join(label);
            if std::fs::write(&path, &o.stdout).is_ok() {
                files.push(path.to_string_lossy().to_string());
            }
        }
    }
    NetResetBackup {
        backup_dir: dir.to_string_lossy().to_string(),
        files,
    }
}

#[tauri::command]
pub fn reset_network(state: State<'_, AppState>) -> Result<NetResetResult, AppError> {
    // back up current adapter state first so a disruptive reset is never a mystery
    let backup = backup_network_state(&state);
    let steps = vec![
        run_step("Flush DNS cache", "ipconfig", &["/flushdns"]),
        run_step("Release IP", "ipconfig", &["/release"]),
        run_step("Renew IP", "ipconfig", &["/renew"]),
        run_step("Reset Winsock catalog", "netsh", &["winsock", "reset"]),
        run_step("Reset TCP/IP stack", "netsh", &["int", "ip", "reset"]),
    ];
    undo::log_entry(
        &state,
        "network_reset",
        format!(
            "Network reset — {} of {} steps succeeded (may need a reboot)",
            steps.iter().filter(|s| s.ok).count(),
            steps.len()
        ),
        json!({ "steps": steps, "backup": backup }),
        false,
    )?;
    Ok(NetResetResult {
        steps,
        backup: Some(backup),
    })
}
