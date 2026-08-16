use crate::state::AppState;
use crate::storage::{load_json, now_millis, save_json};
use crate::undo;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use tauri::State;

// ---------------------------------------------------------------------------
// Shared: run a PowerShell command, return stdout as a string.
// ---------------------------------------------------------------------------

use crate::error::AppError;
pub fn ps(args: &[&str]) -> Result<String, AppError> {
    // E3 shell audit: callers pass fixed scripts or validated ids/paths only;
    // log every invocation with its args for the audit trail.
    let script = args.join("; ");
    tracing::info!(target: "shell", "powershell: {}", script);
    let out = crate::cmd::hidden("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command"])
        .arg(script)
        .output()
        .map_err(|e| AppError::Command(format!("PowerShell not available: {}", e)))?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(AppError::Command(format!(
            "PowerShell error: {}",
            stderr.trim()
        )));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

// ---------------------------------------------------------------------------
// Risk-Tiered Action Gate
// ---------------------------------------------------------------------------

#[derive(Clone, Serialize)]
pub struct RiskGate {
    pub tier: u8, // 1=info, 2=routine, 3=protection-reducing
    pub confirmation_required: bool,
    pub typed_required: bool,
    pub auto_re_enable_secs: Option<u64>,
    pub justification: String,
}

pub fn gate_for_action(action: &str) -> RiskGate {
    let tier3_actions = [
        "disable_rt_protection",
        "set_cfa_disabled",
        "set_asr_disabled",
        "add_exclusion",
        "disable_tamper_protection_attempt",
    ];
    let tier2_actions = ["remove_threat", "trigger_scan", "update_definitions"];
    let is_tier3 = tier3_actions.contains(&action);
    let is_tier2 = tier2_actions.contains(&action);
    RiskGate {
        tier: if is_tier3 { 3 } else if is_tier2 { 2 } else { 1 },
        confirmation_required: is_tier2 || is_tier3,
        typed_required: is_tier3,
        auto_re_enable_secs: if action == "disable_rt_protection" { Some(600) } else { None },
        justification: match action {
            "disable_rt_protection" => "Disabling real-time protection makes your PC vulnerable to malware until it re-enables. This action is logged and will auto-revert in 10 minutes.".into(),
            "set_cfa_disabled" => "Controlled Folder Access is a key ransomware defense. Disabling it weakens protection against file-encrypting malware.".into(),
            "set_asr_disabled" => "Attack Surface Reduction rules block common malware techniques. Disabling them increases your exposure.".into(),
            "add_exclusion" => "Exclusions tell your AV to skip specific files or folders — useful for false positives, but also a classic persistence technique for malware. Review exclusions regularly.".into(),
            "remove_threat" => "Removing a threat permanently deletes the quarantined item. This is not reversible — confirm this is not a false positive.".into(),
            _ => String::new(),
        },
    }
}

fn confirm_gate(state: &AppState, tier: u8, action: &str) -> Result<(), AppError> {
    if tier < 3 {
        return Ok(());
    }
    // Tier 3 always requires explicit typed confirmation stored in history
    undo::log_entry(
        state,
        "tier3_action",
        format!("Tier 3 action approved: {}", action),
        json!({ "action": action, "ts": now_millis() }),
        false,
    )?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Security Center Bridge — WMI root\SecurityCenter2
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone, Default)]
pub struct RegisteredProduct {
    pub name: String,
    pub product_kind: String, // "antivirus" | "firewall" | "antispyware"
    pub enabled: bool,
    pub up_to_date: bool,
    pub product_state_hex: String,
    pub path_to_exe: String,
    pub instance_guid: String,
}

fn parse_product_state(state_hex: &str) -> (bool, bool) {
    let val = u32::from_str_radix(state_hex.trim_start_matches("0x"), 16).unwrap_or(0);
    // Bit 0-3: active state — 0=disabled, 1=active, 4=disabled due to expired
    // Bits 12-15: definition status — 0=not installed, 1=out of date, 2=up to date, 3=update pending
    let enabled = (val & 0xF) == 1 || (val & 0xF) == 0xE;
    let up_to_date = ((val >> 12) & 0xF) == 2;
    (enabled, up_to_date)
}

fn query_products(wmi_class: &str, kind: &str) -> Vec<RegisteredProduct> {
    let result = ps(&[&format!(
        "Get-CimInstance -Namespace root/SecurityCenter2 -ClassName {} | Select-Object displayName,productState,pathToSignedProductExe,instanceGuid | ConvertTo-Json",
        wmi_class
    )]);
    let stdout = match result {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    if stdout.is_empty() || stdout == "[]" {
        return Vec::new();
    }
    // PowerShell returns either a single object or an array
    let json_str = if stdout.starts_with('{') {
        format!("[{}]", stdout)
    } else {
        stdout
    };
    let items: Vec<serde_json::Value> = serde_json::from_str(&json_str).unwrap_or_default();
    items
        .into_iter()
        .map(|v| {
            let name = v
                .get("displayName")
                .and_then(|n| n.as_str())
                .unwrap_or("")
                .to_string();
            let state = v.get("productState").and_then(|s| s.as_i64()).unwrap_or(0);
            let exe = v
                .get("pathToSignedProductExe")
                .and_then(|e| e.as_str())
                .unwrap_or("")
                .to_string();
            let guid = v
                .get("instanceGuid")
                .and_then(|g| g.as_str())
                .unwrap_or("")
                .to_string();
            let state_hex = format!("0x{:08X}", state);
            let (enabled, up_to_date) = parse_product_state(&state_hex);
            RegisteredProduct {
                name,
                product_kind: kind.into(),
                enabled,
                up_to_date,
                product_state_hex: state_hex,
                path_to_exe: exe,
                instance_guid: guid,
            }
        })
        .collect()
}

#[derive(Serialize, Clone)]
pub struct SecurityHealth {
    pub overall_status: String, // "healthy" | "attention" | "critical" | "unknown"
    pub antivirus: Vec<RegisteredProduct>,
    pub firewall: Vec<RegisteredProduct>,
    pub antispyware: Vec<RegisteredProduct>,
    pub third_party_active: bool,
    pub defender_detail: Option<DefenderDetail>,
    pub tamper_protection_on: Option<bool>,
}

#[derive(Serialize, Clone, Default)]
pub struct DefenderDetail {
    pub real_time_protection_on: Option<bool>,
    pub last_scan_type: Option<String>,
    pub last_scan_time: Option<String>,
    pub last_scan_result: Option<String>,
    pub signature_age_days: Option<u32>,
    pub definitions_up_to_date: Option<bool>,
    pub definitions_age: Option<String>,
    pub tamper_protection: Option<bool>,
    pub behavior_monitor_on: Option<bool>,
    pub nis_on: Option<bool>,
    pub on_access_protection_on: Option<bool>,
    pub ioav_protection_on: Option<bool>,
}

fn query_defender_detail() -> Option<DefenderDetail> {
    let cmd = r#"Get-MpComputerStatus | ConvertTo-Json -Compress"#;
    let out = ps(&[cmd]).ok()?;
    let v: serde_json::Value = serde_json::from_str(&out).ok()?;
    let obj = v.as_object()?;
    Some(DefenderDetail {
        real_time_protection_on: obj
            .get("RealTimeProtectionEnabled")
            .and_then(|x| x.as_bool()),
        last_scan_type: obj
            .get("LastQuickScanDateTime")
            .and_then(|x| {
                if x.as_str()?.starts_with("0001") {
                    None
                } else {
                    Some(x.as_str()?.to_string())
                }
            })
            .or({
                // try full scan
                None
            }),
        last_scan_time: obj
            .get("LastQuickScanDateTime")
            .and_then(|x| x.as_str())
            .map(|s| s.to_string())
            .filter(|s| !s.starts_with("0001")),
        last_scan_result: {
            let quick = obj
                .get("LastQuickScanResult")
                .and_then(|x| x.as_i64())
                .unwrap_or(-1);
            if quick == 2 {
                Some("completed".into())
            } else if quick < 0 {
                None
            } else {
                Some("threats found".into())
            }
        },
        signature_age_days: obj
            .get("SignatureAge")
            .and_then(|x| x.as_i64())
            .map(|d| d as u32),
        definitions_up_to_date: obj.get("AntivirusEnabled").and_then(|x| x.as_bool()),
        definitions_age: obj
            .get("SignatureAge")
            .and_then(|x| x.as_i64())
            .map(|d| format!("{} days", d)),
        tamper_protection: obj.get("TamperProtection").and_then(|x| x.as_bool()),
        behavior_monitor_on: obj.get("BehaviorMonitorEnabled").and_then(|x| x.as_bool()),
        nis_on: obj.get("NISEnabled").and_then(|x| x.as_bool()),
        on_access_protection_on: obj
            .get("OnAccessProtectionEnabled")
            .and_then(|x| x.as_bool()),
        ioav_protection_on: obj.get("IoavProtectionEnabled").and_then(|x| x.as_bool()),
    })
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ScanHistoryEntry {
    pub ts: u64,
    pub scan_type: String,
    pub result: String,
    pub threats_found: u32,
}

fn scan_history_path(state: &AppState) -> PathBuf {
    state.data_dir.join("scan_history.json")
}

fn load_scan_history(state: &AppState) -> Vec<ScanHistoryEntry> {
    load_json(&scan_history_path(state), Vec::new())
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn security_get_health_status() -> SecurityHealth {
    let av = query_products("AntiVirusProduct", "antivirus");
    let fw = query_products("FirewallProduct", "firewall");
    let spy = query_products("AntiSpywareProduct", "antispyware");
    let third_party_active = av.iter().any(|p| p.enabled && !p.name.contains("Defender"))
        || spy
            .iter()
            .any(|p| p.enabled && !p.name.contains("Defender"));
    let defender_detail = query_defender_detail();

    let overall_status = {
        let av_ok = av.iter().any(|p| p.enabled);
        let fw_ok = fw.iter().any(|p| p.enabled);
        if !av_ok && !fw_ok {
            "critical"
        } else if !av_ok || !fw_ok || av.iter().any(|p| p.enabled && !p.up_to_date) {
            "attention"
        } else {
            "healthy"
        }
    };

    let tamper = defender_detail.as_ref().and_then(|d| d.tamper_protection);

    SecurityHealth {
        overall_status: overall_status.into(),
        antivirus: av,
        firewall: fw,
        antispyware: spy,
        third_party_active,
        defender_detail,
        tamper_protection_on: tamper,
    }
}

#[tauri::command]
pub fn security_list_registered_products() -> Vec<RegisteredProduct> {
    let mut all = query_products("AntiVirusProduct", "antivirus");
    all.extend(query_products("FirewallProduct", "firewall"));
    all.extend(query_products("AntiSpywareProduct", "antispyware"));
    all
}

#[tauri::command]
pub fn security_get_defender_detail() -> Option<DefenderDetail> {
    query_defender_detail()
}

// ---------------------------------------------------------------------------
// Scan orchestration
// ---------------------------------------------------------------------------

lazy_static::lazy_static! {
    static ref SCAN_IN_PROGRESS: AtomicBool = AtomicBool::new(false);
    static ref SCAN_PROGRESS: AtomicU64 = AtomicU64::new(0);
}

#[tauri::command]
pub fn security_trigger_scan(
    state: State<'_, AppState>,
    scan_type: String,
    path: Option<String>,
) -> Result<String, AppError> {
    if SCAN_IN_PROGRESS.load(Ordering::Relaxed) {
        return Err(AppError::Command("A scan is already in progress.".into()));
    }
    SCAN_IN_PROGRESS.store(true, Ordering::Relaxed);
    SCAN_PROGRESS.store(0, Ordering::Relaxed);

    // E3 shell audit: the custom-scan path is frontend input woven into a
    // PowerShell string — reject control characters and absurd lengths before
    // it ever reaches a command line (the single-quote escaping inside the
    // thread is defense in depth, not the only line).
    if scan_type == "custom" {
        if let Some(p) = path.as_deref() {
            if p.len() > 260 || p.chars().any(|c| c.is_control()) {
                return Err(AppError::Invalid(
                    "Scan path contains invalid characters.".into(),
                ));
            }
        }
    }

    let scan_type2 = scan_type.clone();
    let path2 = path.clone();
    let state_dir = state.data_dir.clone();

    std::thread::spawn(move || {
        let cmd = match scan_type2.as_str() {
            "quick" => "Start-MpScan -ScanType QuickScan".to_string(),
            "full" => "Start-MpScan -ScanType FullScan".to_string(),
            "custom" => {
                let p = path2.unwrap_or_default();
                format!(
                    "Start-MpScan -ScanType CustomScan -ScanPath '{}'",
                    p.replace('\'', "''")
                )
            }
            _ => "Start-MpScan -ScanType QuickScan".to_string(),
        };
        let result = ps(&[&cmd]);
        let (ok, threats) = match &result {
            Ok(s) => (
                true,
                if s.contains("threat") || s.contains("detected") {
                    1
                } else {
                    0
                },
            ),
            Err(_) => (false, 0),
        };
        let mut history: Vec<ScanHistoryEntry> = load_json(
            &scan_history_path(&AppState {
                data_dir: state_dir.clone(),
            }),
            Vec::new(),
        );
        history.push(ScanHistoryEntry {
            ts: now_millis(),
            scan_type: scan_type2.clone(),
            result: if ok {
                "completed".into()
            } else {
                "failed".into()
            },
            threats_found: threats,
        });
        if history.len() > 50 {
            history.drain(0..history.len() - 50);
        }
        let _ = save_json(
            &scan_history_path(&AppState {
                data_dir: state_dir,
            }),
            &history,
        );
        SCAN_IN_PROGRESS.store(false, Ordering::Relaxed);
        SCAN_PROGRESS.store(100, Ordering::Relaxed);
    });

    undo::log_entry(
        &state,
        "scan",
        format!("{} scan started", scan_type),
        json!({ "scan_type": scan_type }),
        false,
    )?;
    Ok(format!("{} scan started in the background.", scan_type))
}

#[tauri::command]
pub fn security_get_scan_progress() -> serde_json::Value {
    json!({
        "in_progress": SCAN_IN_PROGRESS.load(Ordering::Relaxed),
        "progress": SCAN_PROGRESS.load(Ordering::Relaxed),
    })
}

#[tauri::command]
pub fn security_get_scan_history(state: State<'_, AppState>) -> Vec<ScanHistoryEntry> {
    let mut h = load_scan_history(&state);
    h.reverse(); // newest first
    h.truncate(30);
    h
}

#[tauri::command]
pub fn security_open_thirdparty_scanner(_state: State<'_, AppState>) -> Result<String, AppError> {
    // Open Windows Security's own interface
    let _ = crate::cmd::hidden("ms-settings:windowsdefender").spawn();
    Ok("Opened Windows Security settings.".into())
}

// ---------------------------------------------------------------------------
// Threat & Quarantine Review
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
pub struct ThreatEntry {
    pub id: String,
    pub name: String,
    pub severity: String,
    pub category: String,
    pub category_description: String,
    pub date: String,
    pub state: String,
    pub path: String,
}

fn threat_category_description(cat: u32) -> &'static str {
    match cat {
        0 => "Invalid / unclassified",
        1 => "A trojan — malware disguised as legitimate software",
        2 => "A backdoor or bot — gives attackers remote access",
        3 => "A password-stealing or credential-harvesting tool",
        4 => "A remote-access trojan (RAT) — allows control of your PC",
        5 => "A monitoring tool — may log keystrokes or screen activity",
        6 => "A security bypass — disables or circumvents antivirus",
        7 => "A dropper — installs other malware onto your system",
        8 => "A worm — self-replicating malware that spreads across networks",
        9 => "Likely unwanted software — adware, toolbars, or potentially unwanted apps",
        10 => "A bot or command-and-control tool",
        11 => "Self-replicating malware that infects files",
        12 => "Encrypts your files and demands payment (ransomware)",
        13 => "A document exploit — malicious macros or script in Office files",
        14 => "An exploit kit or drive-by download tool",
        15 => "An evasion technique — hides from security software",
        16 => "Suspicious behavior, not confirmed malicious",
        17 => "A PUP (potentially unwanted program) — may not be malicious but is unwanted",
        18 => "An IP/URL reputation block — connection to a known bad address",
        _ => "Unknown threat category",
    }
}

#[tauri::command]
pub fn security_list_threats() -> Vec<ThreatEntry> {
    let cmd = r#"Get-MpThreatDetection | Select-Object ThreatID,ProcessName,ThreatStatusID,Resources,InitialDetectionTime,AdditionalActionsQuarantined | ConvertTo-Json"#;
    let out = match ps(&[cmd]) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    if out.is_empty() || out == "[]" {
        return Vec::new();
    }
    let json_str = if out.starts_with('{') {
        format!("[{}]", out)
    } else {
        out
    };
    let items: Vec<serde_json::Value> = serde_json::from_str(&json_str).unwrap_or_default();
    items
        .into_iter()
        .map(|v| {
            let id = v
                .get("ThreatID")
                .and_then(|x| x.as_i64())
                .unwrap_or(0)
                .to_string();
            let name = v
                .get("ProcessName")
                .and_then(|x| x.as_str())
                .unwrap_or("Unknown")
                .to_string();
            let state = v
                .get("ThreatStatusID")
                .and_then(|x| x.as_i64())
                .unwrap_or(0);
            let resources = v
                .get("Resources")
                .and_then(|x| x.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|r| r.as_str())
                        .collect::<Vec<_>>()
                        .join("; ")
                })
                .unwrap_or_default();
            let date = v
                .get("InitialDetectionTime")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string();
            let cat = v.get("ThreatID").and_then(|x| x.as_i64()).unwrap_or(0) as u32;
            ThreatEntry {
                id,
                name,
                severity: match state {
                    1..=3 => "low",
                    4..=6 => "medium",
                    _ => "high",
                }
                .into(),
                category: cat.to_string(),
                category_description: threat_category_description(cat).to_string(),
                date,
                state: match state {
                    0 => "unknown",
                    1 => "blocked",
                    2 => "quarantined",
                    3 => "cleaned",
                    4 => "allowed",
                    5 => "removed",
                    6 => "restored",
                    _ => "other",
                }
                .into(),
                path: resources,
            }
        })
        .collect()
}

/// Defender threat IDs are positive integers. Validating keeps attacker-controlled
/// input (compromised webview, malicious script) out of the PowerShell command line.
fn validate_threat_id(threat_id: &str) -> Result<u64, AppError> {
    threat_id
        .parse::<u64>()
        .map_err(|_| AppError::Invalid(format!("Invalid threat ID: {}", threat_id)))
}

#[tauri::command]
pub fn security_get_threat_detail(threat_id: String) -> Result<serde_json::Value, AppError> {
    validate_threat_id(&threat_id)?;
    let cmd = format!(
        r#"Get-MpThreat -ThreatID {} | ConvertTo-Json -Compress"#,
        threat_id
    );
    let out = ps(&[&cmd])?;
    let v: serde_json::Value =
        serde_json::from_str(&out).map_err(|e| AppError::Command(format!("parse: {}", e)))?;
    Ok(v)
}

#[tauri::command]
pub fn security_restore_threat(
    state: State<'_, AppState>,
    threat_id: String,
) -> Result<String, AppError> {
    validate_threat_id(&threat_id)?;
    // MpCmdRun.exe -Restore is the documented path
    let mp_cmd = format!(
        "& \"$env:ProgramFiles\\Windows Defender\\MpCmdRun.exe\" -Restore -ThreatID {}",
        threat_id
    );
    let out = crate::cmd::hidden("powershell.exe")
        .args(["-NoProfile", "-Command", &mp_cmd])
        .output()
        .map_err(|e| AppError::Command(e.to_string()))?;
    if !out.status.success() {
        return Err(AppError::Command(format!(
            "Restore failed: {}",
            String::from_utf8_lossy(&out.stderr)
        )));
    }
    undo::log_entry(
        &state,
        "threat_restore",
        format!("Restored threat from quarantine: {}", threat_id),
        json!({ "threat_id": threat_id }),
        false, // Defender quarantine actions are one-way — no supported re-quarantine API
    )?;
    Ok(format!("Threat {} restored from quarantine.", threat_id))
}

#[tauri::command]
pub fn security_remove_threat(
    state: State<'_, AppState>,
    threat_id: String,
) -> Result<String, AppError> {
    validate_threat_id(&threat_id)?;
    let gate = gate_for_action("remove_threat");
    confirm_gate(&state, gate.tier, "remove_threat")?;
    // MpCmdRun.exe -Remove -ThreatID
    let mp_cmd = format!(
        "& \"$env:ProgramFiles\\Windows Defender\\MpCmdRun.exe\" -Remove -ThreatID {}",
        threat_id
    );
    let out = crate::cmd::hidden("powershell.exe")
        .args(["-NoProfile", "-Command", &mp_cmd])
        .output()
        .map_err(|e| AppError::Command(e.to_string()))?;
    if !out.status.success() {
        return Err(AppError::Command(format!(
            "Remove failed: {}",
            String::from_utf8_lossy(&out.stderr)
        )));
    }
    undo::log_entry(
        &state,
        "threat_remove",
        format!("Removed threat from quarantine: {}", threat_id),
        json!({ "threat_id": threat_id }),
        false, // permanently removing a threat is not reversible by design
    )?;
    Ok(format!(
        "Threat {} has been permanently removed.",
        threat_id
    ))
}

// ---------------------------------------------------------------------------
// Real-Time Protection Safety Gate — mandatory auto-re-enable timer
// ---------------------------------------------------------------------------

lazy_static::lazy_static! {
    static ref RT_DISABLE_UNTIL: AtomicU64 = AtomicU64::new(0);
}

#[tauri::command]
pub fn security_request_temporary_rt_disable(
    state: State<'_, AppState>,
    duration_secs: Option<u64>,
) -> Result<String, AppError> {
    let secs = duration_secs.unwrap_or(600).clamp(60, 3600); // min 1 min, max 1 hour
    let gate = gate_for_action("disable_rt_protection");
    confirm_gate(&state, gate.tier, "disable_rt_protection")?;

    let until = now_millis() + secs * 1000;
    RT_DISABLE_UNTIL.store(until, Ordering::Relaxed);

    // Disable real-time protection via PowerShell
    let cmd = "Set-MpPreference -DisableRealtimeMonitoring $true";
    let _ = ps(&[cmd]);
    // Also disable behavior monitoring if present
    let _ = ps(&["Set-MpPreference -DisableBehaviorMonitoring $true"]);

    // Schedule the re-enable
    let until_clone = until;
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(secs));
        if RT_DISABLE_UNTIL.load(Ordering::Relaxed) == until_clone {
            // only re-enable if no manual cancel/interrupt happened
            let _ = ps(&["Set-MpPreference -DisableRealtimeMonitoring $false"]);
            let _ = ps(&["Set-MpPreference -DisableBehaviorMonitoring $false"]);
            RT_DISABLE_UNTIL.store(0, Ordering::Relaxed);
        }
    });

    undo::log_entry(
        &state,
        "rt_disable",
        format!(
            "Real-time protection disabled for {}s (mandatory auto-re-enable)",
            secs
        ),
        json!({ "duration_secs": secs, "until": until }),
        false,
    )?;
    Ok(format!(
        "Real-time protection disabled for {} seconds. It will re-enable automatically.",
        secs
    ))
}

#[tauri::command]
pub fn security_get_rt_disable_remaining_time() -> serde_json::Value {
    let until = RT_DISABLE_UNTIL.load(Ordering::Relaxed);
    let remaining = if until > now_millis() {
        (until - now_millis()) / 1000
    } else {
        0u64
    };
    json!({ "disabled": remaining > 0, "remaining_secs": remaining })
}

#[tauri::command]
pub fn security_cancel_rt_disable_early(state: State<'_, AppState>) -> Result<String, AppError> {
    RT_DISABLE_UNTIL.store(0, Ordering::Relaxed);
    let _ = ps(&["Set-MpPreference -DisableRealtimeMonitoring $false"]);
    let _ = ps(&["Set-MpPreference -DisableBehaviorMonitoring $false"]);
    undo::log_entry(
        &state,
        "rt_reenable",
        "Real-time protection re-enabled early (manual cancel)".to_string(),
        json!({}),
        false,
    )?;
    Ok("Real-time protection re-enabled.".into())
}

#[tauri::command]
pub fn security_get_tamper_protection_status() -> Option<bool> {
    query_defender_detail().and_then(|d| d.tamper_protection)
}

// ---------------------------------------------------------------------------
// Exclusions management
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
pub struct Exclusion {
    pub target: String,
    pub kind: String, // "path" | "file" | "extension" | "process"
}

/// PowerShell single-quoted strings treat everything literally except `''`
/// (an escaped quote), so the `''` escaping used below is already injection-
/// safe. This is defense-in-depth (M3): reject control characters outright so
/// a future change in quoting style can't silently open an injection hole.
///
/// The rejection set is deliberately minimal — `;` `&` `$` `(` `)` and similar
/// are all *legal* Windows filename characters (e.g. "Program Files (x86)"),
/// and they are inert inside single quotes anyway, so rejecting them would
/// only break legitimate exclusions.
fn validate_exclusion_target(target: &str) -> Result<(), AppError> {
    if target.trim().is_empty() {
        return Err(AppError::Command(
            "Exclusion target cannot be empty.".into(),
        ));
    }
    let forbidden = ['\u{0}', '\n', '\r', '\t'];
    if let Some(c) = target.chars().find(|c| forbidden.contains(c)) {
        return Err(AppError::Command(format!(
            "Exclusion target contains a control character that is not allowed: {}",
            c.escape_default()
        )));
    }
    Ok(())
}

fn parse_exclusions(cmd_result: &str) -> Vec<Exclusion> {
    let v: serde_json::Value = serde_json::from_str(cmd_result).unwrap_or_default();
    let obj = v.as_object().or_else(|| {
        v.as_array()
            .and_then(|a| a.first())
            .and_then(|f| f.as_object())
    });
    let mut all = Vec::new();
    if let Some(o) = obj {
        if let Some(paths) = o.get("ExclusionPath").and_then(|x| x.as_array()) {
            for p in paths {
                if let Some(s) = p.as_str() {
                    all.push(Exclusion {
                        target: s.to_string(),
                        kind: "path".into(),
                    });
                }
            }
        }
        if let Some(exts) = o.get("ExclusionExtension").and_then(|x| x.as_array()) {
            for e in exts {
                if let Some(s) = e.as_str() {
                    all.push(Exclusion {
                        target: s.to_string(),
                        kind: "extension".into(),
                    });
                }
            }
        }
        if let Some(procs) = o.get("ExclusionProcess").and_then(|x| x.as_array()) {
            for p in procs {
                if let Some(s) = p.as_str() {
                    all.push(Exclusion {
                        target: s.to_string(),
                        kind: "process".into(),
                    });
                }
            }
        }
    }
    all
}

#[tauri::command]
pub fn security_manage_exclusions(
    action: String,
    target: String,
    kind: String,
) -> Result<Vec<Exclusion>, AppError> {
    if action != "list" {
        validate_exclusion_target(&target)?;
    }
    match action.as_str() {
        "add" => {
            match kind.as_str() {
                "path" => ps(&[&format!(
                    "Add-MpPreference -ExclusionPath '{}'",
                    target.replace('\'', "''")
                )]),
                "extension" => ps(&[&format!(
                    "Add-MpPreference -ExclusionExtension '{}'",
                    target.replace('\'', "''")
                )]),
                "process" => ps(&[&format!(
                    "Add-MpPreference -ExclusionProcess '{}'",
                    target.replace('\'', "''")
                )]),
                _ => return Err(AppError::Command("Unknown exclusion kind".into())),
            }?;
        }
        "remove" => {
            match kind.as_str() {
                "path" => ps(&[&format!(
                    "Remove-MpPreference -ExclusionPath '{}'",
                    target.replace('\'', "''")
                )]),
                "extension" => ps(&[&format!(
                    "Remove-MpPreference -ExclusionExtension '{}'",
                    target.replace('\'', "''")
                )]),
                "process" => ps(&[&format!(
                    "Remove-MpPreference -ExclusionProcess '{}'",
                    target.replace('\'', "''")
                )]),
                _ => return Err(AppError::Command("Unknown exclusion kind".into())),
            }?;
        }
        "list" => {}
        _ => {
            return Err(AppError::Command(
                "Action must be add, remove, or list".into(),
            ))
        }
    }
    let out = ps(&["Get-MpPreference | ConvertTo-Json -Compress"])?;
    Ok(parse_exclusions(&out))
}

// ---------------------------------------------------------------------------
// Protection Hardening — Controlled Folder Access + ASR rules
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn security_get_cfa_status() -> serde_json::Value {
    let out = ps(&[
        "Get-MpPreference | Select-Object EnableControlledFolderAccess | ConvertTo-Json -Compress",
    ])
    .unwrap_or_default();
    let v: serde_json::Value =
        serde_json::from_str(&out).unwrap_or(json!({"EnableControlledFolderAccess": null}));
    let mode = v
        .get("EnableControlledFolderAccess")
        .and_then(|x| x.as_i64())
        .unwrap_or(0);
    json!({
        "enabled": mode == 1,
        "audit_mode": mode == 2,
        "mode": match mode {
            0 => "disabled",
            1 => "enabled",
            2 => "audit",
            _ => "unknown",
        },
    })
}

#[tauri::command]
pub fn security_set_cfa_mode(state: State<'_, AppState>, mode: String) -> Result<String, AppError> {
    let gate = if mode == "disabled" {
        gate_for_action("set_cfa_disabled")
    } else {
        RiskGate {
            tier: 3,
            confirmation_required: true,
            typed_required: false,
            auto_re_enable_secs: None,
            justification: "Enabling ransomware protection is a Tier 3 action.".into(),
        }
    };
    confirm_gate(&state, gate.tier, "set_cfa")?;
    let v = match mode.as_str() {
        "enabled" => 1u32,
        "audit" => 2u32,
        _ => 0u32,
    };
    let cmd = format!("Set-MpPreference -EnableControlledFolderAccess {}", v);
    ps(&[&cmd])?;
    undo::log_entry(
        &state,
        "cfa",
        format!("Controlled Folder Access → {}", mode),
        json!({ "mode": mode }),
        false,
    )?;
    Ok(format!("Controlled Folder Access set to '{}'.", mode))
}

#[tauri::command]
pub fn security_manage_cfa_allowlist(
    action: String,
    target: String,
    is_folder: bool,
) -> Result<String, AppError> {
    let param = if is_folder {
        "ControlledFolderAccessProtectedFolders"
    } else {
        "ControlledFolderAccessAllowedApplications"
    };
    let add_remove = match action.as_str() {
        "add" => "Add",
        "remove" => "Remove",
        _ => return Err(AppError::Command("Action must be add or remove".into())),
    };
    validate_exclusion_target(&target)?;
    let cmd = format!(
        "{}-MpPreference -{} '{}'",
        add_remove,
        param,
        target.replace('\'', "''")
    );
    ps(&[&cmd])?;
    Ok(format!(
        "{} {} to {} allowlist.",
        if action == "add" { "Added" } else { "Removed" },
        target,
        if is_folder {
            "protected folder"
        } else {
            "allowed app"
        }
    ))
}

// ASR rules — fetch the authoritative list from Defender
fn asr_rules_list() -> Vec<serde_json::Value> {
    match ps(&["Get-MpPreference | Select-Object AttackSurfaceReductionRules_Ids, AttackSurfaceReductionRules_Actions | ConvertTo-Json -Compress"]) {
        Ok(out) => {
            let v: serde_json::Value = serde_json::from_str(&out).unwrap_or_default();
            let ids = v.get("AttackSurfaceReductionRules_Ids").and_then(|x| x.as_array()).cloned().unwrap_or_default();
            let actions = v.get("AttackSurfaceReductionRules_Actions").and_then(|x| x.as_array()).cloned().unwrap_or_default();
            let mut rules = Vec::new();
            for (i, id) in ids.iter().enumerate() {
                let action = actions.get(i).and_then(|a| a.as_i64()).unwrap_or(0);
                let name = asr_rule_name(id.as_str().unwrap_or(""));
                rules.push(json!({
                    "id": id,
                    "name": name,
                    "action": match action { 1 => "enabled", 2 => "audit", _ => "disabled" },
                }));
            }
            rules
        }
        Err(_) => Vec::new(),
    }
}

fn asr_rule_name(guid: &str) -> String {
    match guid.to_lowercase().as_str() {
        "26190899-1602-49e8-8b69-e1b1b0f3c0b9" => {
            "Blocks Office apps from creating child processes (stops macro-driven attacks)"
        }
        "3b576869-a4ec-4529-8536-b80a7769e899" => {
            "Blocks Office apps from creating executable content"
        }
        "75668c1f-73b5-4cf0-bb93-3ecf5cb7cc84" => {
            "Blocks Office apps from injecting into other processes"
        }
        "5beb7efe-fd9a-4556-801d-275e5ffc04cc" => "Blocks Win32 API calls from Office macros",
        "92e97fa1-2edf-4476-bdd6-9dd0b4dddc7b" => {
            "Blocks credential stealing from Windows Local Security Authority Subsystem (lsass.exe)"
        }
        "d4f940ab-401b-4efc-aadc-ad5f3c50688a" => {
            "Blocks executable files from running unless they meet a prevalence or age criteria"
        }
        "9e6c4e1f-7d60-472f-ba1a-a39ef669e4b2" => {
            "Blocks untrusted and unsigned processes that run from USB drives"
        }
        "d3e037e1-3eb8-44c8-a917-57927947596d" => {
            "Blocks JavaScript or VBScript from launching downloaded executable content"
        }
        "be9ba2d9-53ea-4cdc-84e5-9b1eeee46550" => {
            "Blocks process creations originating from PSExec and WMI commands"
        }
        "01443614-cd74-433a-b99e-2ecdc07bfc25" => {
            "Blocks executable content from email client and webmail"
        }
        "b2b3f03d-6a65-4f7b-a9c7-1c7ef74a9ba4" => {
            "Blocks untrusted processes from running from removable media"
        }
        "c0033c00-d16d-4114-a5a0-dc9b3a7d2ceb" => "Blocks credential theft from Windows LSA",
        "7674ba52-37eb-4a4f-a9a1-f0f9a1619a2c" => {
            "Blocks Adobe Reader from creating child processes"
        }
        "e6db77e5-3df2-4cf1-b95a-636979351e5b" => "Blocks behaviors associated with ransomware",
        "c1db55db-c0b3-4f92-9181-8c1b5e5c7b5f" => {
            "Blocks files downloaded from low-reputation sources by Microsoft Office"
        }
        "33ddedf1-c6e0-47cb-833e-de613396038f" => "Blocks use of stolen or forged certificates",
        _ => "Unknown ASR rule — see Microsoft documentation for details",
    }
    .to_string()
}

#[tauri::command]
pub fn security_list_asr_rules() -> Vec<serde_json::Value> {
    asr_rules_list()
}

#[tauri::command]
pub fn security_set_asr_rule_action(
    state: State<'_, AppState>,
    rule_id: String,
    action: String,
) -> Result<String, AppError> {
    if action == "disabled" {
        let gate = gate_for_action("set_asr_disabled");
        confirm_gate(&state, gate.tier, "set_asr_disabled")?;
    }
    let action_val = match action.as_str() {
        "enabled" => 1u32,
        "audit" => 2u32,
        _ => 0u32,
    };
    let cmd = format!(
        "Set-MpPreference -AttackSurfaceReductionRules_Ids '{}' -AttackSurfaceReductionRules_Actions {}",
        rule_id, action_val
    );
    ps(&[&cmd])?;
    undo::log_entry(
        &state,
        "asr_rule",
        format!("ASR rule {} → {}", rule_id, action),
        json!({ "rule_id": rule_id, "action": action }),
        false,
    )?;
    Ok(format!("ASR rule {} set to '{}'.", rule_id, action))
}

// ---------------------------------------------------------------------------
// Autorun Threat-Surface Auditor — reuses existing startup/task enumeration
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
pub struct FlaggedEntry {
    pub name: String,
    pub location: String,
    pub command: String,
    pub flags: Vec<String>, // why it was flagged
    pub is_signed: Option<bool>,
}

#[tauri::command]
pub fn security_audit_autorun_threat_surface() -> Vec<FlaggedEntry> {
    let mut flagged = Vec::new();
    // reuse startup entries
    let startups = crate::startup::list_startup();
    for s in startups {
        let mut entry_flags = Vec::new();
        let cmd_lower = s.command.to_lowercase();
        if cmd_lower.contains("%temp%")
            || cmd_lower.contains("%appdata%")
            || cmd_lower.contains("\\temp\\")
        {
            entry_flags.push(
                "Launches from a temp or appdata directory (common malware persistence location)"
                    .into(),
            );
        }
        if cmd_lower.contains("powershell") && cmd_lower.contains("-enc") {
            entry_flags
                .push("Uses encoded PowerShell command (often an obfuscation technique)".into());
        }
        if cmd_lower.contains("rundll32") && cmd_lower.len() < 40 {
            entry_flags
                .push("Short command via rundll32 — could be a proxy execution technique".into());
        }
        // check if signed (best-effort: check for an Authenticode signature via signtool)
        let is_signed = if !s.command.is_empty() {
            // Try to check signature via PowerShell
            let out = ps(&[&format!(
                "Get-AuthenticodeSignature '{}' | Select-Object -ExpandProperty Status",
                s.command.replace('\'', "''")
            )]);
            out.map(|o| o.contains("Valid")).unwrap_or(false)
        } else {
            false
        };
        if !is_signed && !s.command.is_empty() {
            entry_flags.push(
                "Not digitally signed (unsigned binaries are a common malware vector)".into(),
            );
        }
        if !entry_flags.is_empty() {
            flagged.push(FlaggedEntry {
                name: s.name,
                location: s.location,
                command: s.command,
                flags: entry_flags,
                is_signed: Some(is_signed),
            });
        }
    }
    flagged
}

#[tauri::command]
pub fn security_get_flagged_entry_detail(
    name: String,
    location: String,
) -> Result<serde_json::Value, AppError> {
    let startups = crate::startup::list_startup();
    let entry = startups
        .into_iter()
        .find(|s| s.name == name && s.location == location)
        .ok_or_else(|| "Entry not found".to_string())?;
    Ok(json!(entry))
}

// ---------------------------------------------------------------------------
// Definitions freshness nudge
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn security_update_definitions(state: State<'_, AppState>) -> Result<String, AppError> {
    let cmd = "Update-MpSignature";
    ps(&[cmd])?;
    undo::log_entry(
        &state,
        "definitions_update",
        "Manually updated Defender definitions".into(),
        json!({}),
        false,
    )?;
    Ok("Defender definitions updated.".into())
}

// ---------------------------------------------------------------------------
// Security digest (optional §4.1)
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn security_get_digest(state: State<'_, AppState>) -> serde_json::Value {
    let health = security_get_health_status();
    let history = load_scan_history(&state);
    let recent_scans: Vec<&ScanHistoryEntry> = history.iter().rev().take(5).collect();
    json!({
        "overall": health.overall_status,
        "third_party_active": health.third_party_active,
        "tamper_protection": health.tamper_protection_on,
        "recent_scans": recent_scans,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn threat_id_accepts_positive_integers() {
        assert_eq!(validate_threat_id("1").unwrap(), 1);
        assert_eq!(validate_threat_id("1234567890123").unwrap(), 1234567890123);
    }

    #[test]
    fn threat_id_rejects_injection_and_junk() {
        assert!(validate_threat_id("").is_err());
        assert!(validate_threat_id("abc").is_err());
        assert!(validate_threat_id("-1").is_err());
        assert!(validate_threat_id("1.5").is_err());
        assert!(validate_threat_id("1; Remove-Item -Force -Recurse C:\\").is_err());
        assert!(validate_threat_id("1' -and (whoami)").is_err());
        assert!(validate_threat_id("1 & whoami").is_err());
        assert!(validate_threat_id("0x10").is_err());
        // Whitespace sneaking past a trim would break the PS command line.
        assert!(validate_threat_id(" 42").is_err());
        assert!(validate_threat_id("42 ").is_err());
    }

    #[test]
    fn exclusion_target_rejects_control_chars_only() {
        // Legal Windows path characters — including `;` `&` `$` and parens —
        // must pass ("Program Files (x86)" is a real path).
        assert!(validate_exclusion_target(r"C:\Program Files (x86)\App").is_ok());
        assert!(validate_exclusion_target(r"C:\Program Files\App;v2").is_ok());
        assert!(validate_exclusion_target("a & b.exe").is_ok());
        assert!(validate_exclusion_target("$(pwd).exe").is_ok());
        assert!(validate_exclusion_target(".jpg").is_ok());
        // Empty and control characters are never legal in a target.
        assert!(validate_exclusion_target("").is_err());
        assert!(validate_exclusion_target(" ").is_err());
        assert!(validate_exclusion_target("C:\\x\ny").is_err());
        assert!(validate_exclusion_target("C:\\x\ry").is_err());
        assert!(validate_exclusion_target("a\tb").is_err());
    }
}
