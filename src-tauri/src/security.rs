use crate::startup;
use serde::Serialize;

use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
use winreg::RegKey;

use crate::error::AppError;
#[derive(Serialize, Clone)]
pub struct AuditItem {
    pub id: String,
    pub title: String,
    pub status: String, // "ok" | "warn" | "info"
    pub detail: String,
    pub action_hint: String,
}

fn get_dword(hive: u64, path: &str, name: &str) -> Option<u32> {
    let hive = match hive {
        0 => HKEY_CURRENT_USER,
        _ => HKEY_LOCAL_MACHINE,
    };
    RegKey::predef(hive)
        .open_subkey(path)
        .and_then(|k| k.get_value(name))
        .ok()
}

fn run_netsh(args: &[&str]) -> String {
    crate::cmd::hidden("netsh")
        .args(args)
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default()
}

fn wifi_profiles() -> Vec<String> {
    run_netsh(&["wlan", "show", "profiles"])
        .lines()
        .filter_map(|l| {
            let l = l.trim();
            if let Some(idx) = l.find(':') {
                let name = l[idx + 1..].trim().trim_matches('"').to_string();
                if !name.is_empty() {
                    return Some(name);
                }
            }
            None
        })
        .collect()
}

fn firewall_state() -> Vec<String> {
    run_netsh(&["advfirewall", "show", "allprofiles", "state"])
        .lines()
        .filter(|l| l.to_lowercase().contains("state"))
        .map(|l| l.trim().to_string())
        .collect()
}

fn installed_apps() -> Vec<(String, String)> {
    let mut apps = Vec::new();
    let bases = [
        (
            HKEY_LOCAL_MACHINE,
            r"Software\Microsoft\Windows\CurrentVersion\Uninstall",
        ),
        (
            HKEY_LOCAL_MACHINE,
            r"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
        ),
        (
            HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\CurrentVersion\Uninstall",
        ),
    ];
    for (hive, base) in bases {
        if let Ok(key) = RegKey::predef(hive).open_subkey(base) {
            for sub in key.enum_keys().filter_map(|k| k.ok()) {
                if let Ok(sk) = key.open_subkey(&sub) {
                    let name: Option<String> = sk.get_value("DisplayName").ok();
                    let size: Option<u32> = sk.get_value("EstimatedSize").ok();
                    if let Some(n) = name {
                        apps.push((
                            n,
                            size.map(|s| format!("{} MB", s / 1024)).unwrap_or_default(),
                        ));
                    }
                }
            }
        }
    }
    apps
}

fn is_bloat(name: &str) -> bool {
    let n = name.to_lowercase();
    [
        "candy crush",
        "solitaire",
        "xbox",
        "bing",
        "cortana",
        "get help",
        "gethelp",
        "tiktok",
        "disney+",
        "spotify music",
        "news",
        "weather",
        "feedback hub",
    ]
    .iter()
    .any(|k| n.contains(k))
}

#[tauri::command]
pub fn get_security_audit() -> Vec<AuditItem> {
    let mut items = Vec::new();

    // Telemetry
    let ad = get_dword(
        0,
        r"Software\Microsoft\Windows\CurrentVersion\AdvertisingInfo",
        "Enabled",
    );
    let telemetry = get_dword(
        1,
        r"Software\Policies\Microsoft\Windows\DataCollection",
        "AllowTelemetry",
    );
    match (ad, telemetry) {
        (Some(0), _) => items.push(AuditItem {
            id: "ad_id".into(),
            title: "Advertising ID".into(),
            status: "ok".into(),
            detail: "Advertising ID is disabled.".into(),
            action_hint: "Nothing to do.".into(),
        }),
        _ => items.push(AuditItem {
            id: "ad_id".into(),
            title: "Advertising ID".into(),
            status: "warn".into(),
            detail: "Windows can use an advertising ID to show tailored ads.".into(),
            action_hint: "Disable in Settings → Privacy → General → Turn off 'Let apps show me personalized ads'.".into(),
        }),
    }
    match telemetry {
        Some(0) => items.push(AuditItem {
            id: "telemetry".into(),
            title: "Diagnostic data".into(),
            status: "ok".into(),
            detail: "Diagnostic data is set to the minimum (Security).".into(),
            action_hint: "Nothing to do.".into(),
        }),
        _ => items.push(AuditItem {
            id: "telemetry".into(),
            title: "Diagnostic data".into(),
            status: "info".into(),
            detail: "Diagnostic data level not restricted by policy.".into(),
            action_hint:
                "Set Settings → Privacy → Diagnostics to 'Required' if you prefer minimal data."
                    .into(),
        }),
    }

    // Startup risk
    let entries = startup::list_startup();
    let risky = entries
        .iter()
        .filter(|e| e.enabled && e.impact >= 7)
        .count();
    items.push(AuditItem {
        id: "startup_risk".into(),
        title: "Startup bloat".into(),
        status: if risky == 0 { "ok" } else { "warn" }.into(),
        detail: format!(
            "{} of {} startup entries look heavy (score ≥ 7).",
            risky,
            entries.len()
        ),
        action_hint: "Review and disable them in Tune-up → Startup manager.".into(),
    });

    // Wi-Fi
    let wifis = wifi_profiles();
    if wifis.is_empty() {
        items.push(AuditItem {
            id: "wifi".into(),
            title: "Saved Wi-Fi networks".into(),
            status: "info".into(),
            detail: "No saved Wi-Fi profiles found (or netsh unavailable).".into(),
            action_hint: "—".into(),
        });
    } else {
        items.push(AuditItem {
            id: "wifi".into(),
            title: "Saved Wi-Fi networks".into(),
            status: "info".into(),
            detail: format!("{} saved networks: {}", wifis.len(), wifis.join(", ")),
            action_hint: "Forget old networks in Settings → Network & Internet → Wi-Fi → Manage known networks.".into(),
        });
    }

    // Firewall
    let fw = firewall_state();
    if fw.is_empty() {
        items.push(AuditItem {
            id: "firewall".into(),
            title: "Windows Firewall".into(),
            status: "warn".into(),
            detail: "Could not read firewall state.".into(),
            action_hint: "Check Settings → Privacy & Security → Windows Security → Firewall."
                .into(),
        });
    } else {
        let all_on = fw.iter().all(|l| l.to_lowercase().contains("on"));
        items.push(AuditItem {
            id: "firewall".into(),
            title: "Windows Firewall".into(),
            status: if all_on { "ok" } else { "warn" }.into(),
            detail: fw.join(" · "),
            action_hint: if all_on {
                "Nothing to do.".into()
            } else {
                "Turn all firewall profiles on in Windows Security.".into()
            },
        });
    }

    // Bloatware
    let apps = installed_apps();
    let bloat: Vec<(String, String)> = apps.iter().filter(|(n, _)| is_bloat(n)).cloned().collect();
    items.push(AuditItem {
        id: "bloat".into(),
        title: "Pre-installed bloatware".into(),
        status: if bloat.is_empty() { "ok" } else { "warn" }.into(),
        detail: if bloat.is_empty() {
            "No obvious pre-installed bloatware detected.".into()
        } else {
            format!(
                "Found {} apps that are commonly unwanted: {}",
                bloat.len(),
                bloat.iter().map(|(n, s)| format!("{} ({})", n, s)).collect::<Vec<_>>().join(", ")
            )
        },
        action_hint: "Uninstall via Settings → Apps if you never use them. (Reforge never uninstalls without you.).".into(),
    });

    // USB history
    items.push(AuditItem {
        id: "usb_history".into(),
        title: "Removable-device history".into(),
        status: "info".into(),
        detail: "Windows remembers USB drives you've plugged in.".into(),
        action_hint: "Clear via Settings → Privacy → Clear activity history (manual).".into(),
    });

    items
}

// ---------------------------------------------------------------------------
// Permission auditor (microphone / camera / location)
// ---------------------------------------------------------------------------

use crate::state::AppState;
use crate::undo;
use serde_json::json;
use tauri::State;

#[derive(serde::Serialize, Clone)]
pub struct PermissionState {
    pub id: String, // "Microphone" | "Camera" | "Location"
    pub label: String,
    pub allowed: bool,
    pub apps: Vec<PermissionApp>,
}

#[derive(serde::Serialize, Clone)]
pub struct PermissionApp {
    pub name: String,
    pub allowed: bool,
}

const CONSENT_BASE: &str =
    r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore";

fn consent_value(id: &str) -> Option<String> {
    RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(format!(r"{}\{}", CONSENT_BASE, id))
        .and_then(|k| k.get_value::<String, _>("Value"))
        .ok()
}

pub fn read_permission_state(id: &str, label: &str) -> PermissionState {
    let mut apps = Vec::new();
    let mut allowed = consent_value(id)
        .map(|v| v.eq_ignore_ascii_case("Allow"))
        .unwrap_or(true);
    if let Ok(key) =
        RegKey::predef(HKEY_CURRENT_USER).open_subkey(format!(r"{}\{}", CONSENT_BASE, id))
    {
        if let Ok(nonpackaged) = key.open_subkey("NonPackaged") {
            for (name, _) in nonpackaged.enum_values().filter_map(|v| v.ok()) {
                let v: Option<String> = nonpackaged.get_value(&name).ok();
                let ok = v.map(|x| x.eq_ignore_ascii_case("Allow")).unwrap_or(false);
                let pretty = name
                    .trim_start_matches("App:")
                    .trim_start_matches("Package:")
                    .rsplit('\\')
                    .next()
                    .unwrap_or(&name)
                    .to_string();
                apps.push(PermissionApp {
                    name: pretty,
                    allowed: ok,
                });
            }
        }
        // per-package subkeys
        if let Ok(pk) = key.open_subkey("Packages") {
            for sub in pk.enum_keys().filter_map(|k| k.ok()) {
                if let Ok(sk) = pk.open_subkey(&sub) {
                    let v: Option<String> = sk.get_value("Value").ok();
                    let ok = v.map(|x| x.eq_ignore_ascii_case("Allow")).unwrap_or(false);
                    apps.push(PermissionApp {
                        name: sub.clone(),
                        allowed: ok,
                    });
                }
            }
        }
    }
    apps.sort_by(|a, b| b.allowed.cmp(&a.allowed).then(a.name.cmp(&b.name)));
    apps.truncate(24);
    if allowed && apps.is_empty() {
        allowed = true;
    }
    PermissionState {
        id: id.into(),
        label: label.into(),
        allowed,
        apps,
    }
}

#[tauri::command]
pub fn get_permissions() -> Vec<PermissionState> {
    vec![
        read_permission_state("Microphone", "Microphone"),
        read_permission_state("Camera", "Camera"),
        read_permission_state("Location", "Location"),
    ]
}

#[tauri::command]
pub fn set_permission(
    state: State<'_, AppState>,
    id: String,
    allowed: bool,
) -> Result<PermissionState, AppError> {
    let before = read_permission_state(&id, &id);
    let path = format!(r"{}\{}", CONSENT_BASE, id);
    let key = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey_with_flags(path, winreg::enums::KEY_SET_VALUE | winreg::enums::KEY_READ)
        .map_err(|e| AppError::Command(e.to_string()))?;
    key.set_value("Value", &if allowed { "Allow" } else { "Deny" })
        .map_err(|e| AppError::Command(e.to_string()))?;
    undo::log_entry(
        &state,
        "permission",
        format!("{} access → {}", id, if allowed { "Allow" } else { "Deny" }),
        json!({ "id": id, "before": before.allowed, "after": allowed }),
        true,
    )?;
    Ok(read_permission_state(&id, &id))
}

// ---------------------------------------------------------------------------
// Browser privacy hardening
// ---------------------------------------------------------------------------

#[derive(serde::Serialize, Clone)]
pub struct PrivacyPolicyItem {
    pub id: String,
    pub browser: String,
    pub label: String,
    pub enabled: bool,
    pub description: String,
}

fn policy_items() -> Vec<PrivacyPolicyItem> {
    let browsers = [
        ("Chrome", r"Software\Policies\Google\Chrome"),
        ("Edge", r"Software\Policies\Microsoft\Edge"),
    ];
    let mut out = Vec::new();
    for (browser, base) in browsers {
        let k = RegKey::predef(HKEY_CURRENT_USER).open_subkey(base).ok();
        let get = |name: &str| -> bool {
            k.as_ref()
                .and_then(|key| key.get_value::<u32, _>(name).ok())
                .map(|v| v != 0)
                .unwrap_or(false)
        };
        out.push(PrivacyPolicyItem {
            id: format!("{}-metrics", browser.to_lowercase()),
            browser: browser.into(),
            label: "Usage metrics reporting".into(),
            enabled: get("MetricsReportingEnabled"),
            description: "Sends usage stats and crash reports to the vendor.".into(),
        });
        out.push(PrivacyPolicyItem {
            id: format!("{}-suggest", browser.to_lowercase()),
            browser: browser.into(),
            label: "Search suggestions".into(),
            enabled: get("SearchSuggestEnabled"),
            description: "Sends keystrokes to the search engine for suggestions.".into(),
        });
        out.push(PrivacyPolicyItem {
            id: format!("{}-pwmgr", browser.to_lowercase()),
            browser: browser.into(),
            label: "Password manager".into(),
            enabled: get("PasswordManagerEnabled"),
            description: "Stores your passwords in the browser (reversible toggle).".into(),
        });
        out.push(PrivacyPolicyItem {
            id: format!("{}-3pck", browser.to_lowercase()),
            browser: browser.into(),
            label: "Block third-party cookies".into(),
            enabled: get("BlockThirdPartyCookies"),
            description: "Prevents cross-site tracking cookies.".into(),
        });
    }
    out
}

#[tauri::command]
pub fn get_browser_privacy() -> Vec<PrivacyPolicyItem> {
    policy_items()
}

#[tauri::command]
pub fn set_browser_policy(
    state: State<'_, AppState>,
    browser: String,
    policy: String,
    enabled: bool,
) -> Result<Vec<PrivacyPolicyItem>, AppError> {
    let base = if browser == "Chrome" {
        r"Software\Policies\Google\Chrome"
    } else {
        r"Software\Policies\Microsoft\Edge"
    };
    let key = RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey(base)
        .map_err(|e| AppError::Command(e.to_string()))?
        .0;
    let before: Option<u32> = key.get_value(&policy).ok();
    key.set_value(&policy, &(if enabled { 1u32 } else { 0u32 }))
        .map_err(|e| AppError::Command(e.to_string()))?;
    undo::log_entry(
        &state,
        "browser_policy",
        format!(
            "{} {} → {}",
            browser,
            policy,
            if enabled { "on" } else { "off" }
        ),
        json!({ "browser": browser, "policy": policy, "before": before }),
        true,
    )?;
    Ok(policy_items())
}

// ---------------------------------------------------------------------------
// USB history (read-only)
// ---------------------------------------------------------------------------

#[derive(serde::Serialize, Clone)]
pub struct UsbDevice {
    pub name: String,
    pub vid: String,
    pub pid: String,
    pub first_seen: Option<u64>,
}

#[tauri::command]
pub fn get_usb_history() -> Vec<UsbDevice> {
    let mut out = Vec::new();
    if let Ok(key) =
        RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(r"SYSTEM\CurrentControlSet\Enum\USBSTOR")
    {
        for sub in key.enum_keys().filter_map(|k| k.ok()) {
            if let Ok(sk) = key.open_subkey(&sub) {
                for inst in sk.enum_keys().filter_map(|k| k.ok()) {
                    if let Ok(ik) = sk.open_subkey(&inst) {
                        let name: Option<String> = ik.get_value("FriendlyName").ok();
                        let props: Option<String> = ik.get_value("DeviceDesc").ok();
                        let segs: Vec<&str> = sub.split('&').collect();
                        let vid = segs
                            .iter()
                            .find(|s| s.starts_with("Ven_"))
                            .map(|s| s.trim_start_matches("Ven_").to_string())
                            .unwrap_or_default();
                        let pid = segs
                            .iter()
                            .find(|s| s.starts_with("Prod_"))
                            .map(|s| s.trim_start_matches("Prod_").to_string())
                            .unwrap_or_default();
                        out.push(UsbDevice {
                            name: name.unwrap_or_else(|| props.unwrap_or_default()),
                            vid,
                            pid,
                            first_seen: None,
                        });
                    }
                }
            }
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out.dedup_by(|a, b| a.name == b.name);
    out.truncate(40);
    out
}
