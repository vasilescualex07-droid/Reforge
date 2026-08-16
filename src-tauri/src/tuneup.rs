use crate::state::AppState;
use crate::storage::{load_json, save_json};
use crate::undo;
use serde::Serialize;
use serde_json::json;
use std::path::PathBuf;
use tauri::State;
use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
use winreg::RegKey;

// ---------------------------------------------------------------------------
// Bloatware uninstaller
// ---------------------------------------------------------------------------

use crate::error::AppError;
#[derive(Serialize, Clone)]
pub struct BloatApp {
    pub name: String,
    pub publisher: String,
    pub uninstall_string: String,
    pub hive: String,
    pub subkey: String,
    pub size_mb: Option<u64>,
}

fn uninstall_bases() -> [(u64, &'static str); 3] {
    [
        (1, r"Software\Microsoft\Windows\CurrentVersion\Uninstall"),
        (
            1,
            r"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
        ),
        (0, r"Software\Microsoft\Windows\CurrentVersion\Uninstall"),
    ]
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
        "tiktok",
        "disney+",
        "spotify music",
        "news",
        "weather",
        "feedback hub",
        "clipchamp",
        "skype",
        "one note",
        "onedrive",
        "tiktok",
        "linkedin",
        "zune",
        "mail and calendar",
        "groove music",
        "mixed reality",
    ]
    .iter()
    .any(|k| n.contains(k))
}

#[tauri::command]
pub fn list_bloatware() -> Vec<BloatApp> {
    let mut out = Vec::new();
    for (hive_id, base) in uninstall_bases() {
        let hive = if hive_id == 1 {
            HKEY_LOCAL_MACHINE
        } else {
            HKEY_CURRENT_USER
        };
        let hive_name = if hive_id == 1 { "HKLM" } else { "HKCU" };
        if let Ok(key) = RegKey::predef(hive).open_subkey(base) {
            for sub in key.enum_keys().filter_map(|k| k.ok()) {
                if let Ok(sk) = key.open_subkey(&sub) {
                    let name: Option<String> = sk.get_value("DisplayName").ok();
                    let uninst: Option<String> = sk.get_value("UninstallString").ok();
                    let publisher: Option<String> = sk.get_value("Publisher").ok();
                    let size: Option<u32> = sk.get_value("EstimatedSize").ok();
                    if let Some(n) = name {
                        if is_bloat(&n) {
                            out.push(BloatApp {
                                name: n,
                                publisher: publisher.unwrap_or_default(),
                                uninstall_string: uninst.unwrap_or_default(),
                                hive: hive_name.into(),
                                subkey: format!("{}\\{}", base, sub),
                                size_mb: size.map(|s| s as u64 / 1024),
                            });
                        }
                    }
                }
            }
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

#[tauri::command]
pub fn uninstall_bloatware(
    state: State<'_, AppState>,
    name: String,
    uninstall_string: String,
) -> Result<String, AppError> {
    if uninstall_string.trim().is_empty() {
        return Err(AppError::Command(
            "No uninstall command available for this app — remove it via Settings → Apps.".into(),
        ));
    }
    let display = name.clone();
    let uninst = uninstall_string.clone();
    let (cmd, args) = if let Some(rest) = uninst.strip_prefix('"') {
        // "path\uninst.exe" /S
        match rest.find('"') {
            Some(i) => (rest[..i].to_string(), rest[i + 1..].trim().to_string()),
            // Malformed entry — no closing quote. Use the whole rest as the
            // command and no args instead of slicing out of bounds.
            None => (rest.to_string(), String::new()),
        }
    } else {
        let mut parts = uninst.splitn(2, ' ');
        (
            parts.next().unwrap_or("").to_string(),
            parts.next().unwrap_or("").to_string(),
        )
    };
    if cmd.is_empty() {
        return Err(AppError::Command("Uninstall command is empty.".into()));
    }
    undo::log_entry(
        &state,
        "uninstall",
        format!(
            "Launched uninstaller for {} (uninstall is not auto-reversible)",
            display
        ),
        json!({ "name": display, "command": uninst }),
        false,
    )?;
    // Fire-and-forget: launch uninstaller detached so the app stays responsive.
    let _ = crate::cmd::hidden(&cmd)
        .args(args.split_whitespace())
        .spawn()
        .map_err(|e| AppError::Command(format!("Failed to launch uninstaller: {}", e)))?;
    Ok(format!("Launched uninstaller for {}", display))
}

// ---------------------------------------------------------------------------
// RAM optimizer / process manager
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
pub struct MemHog {
    pub name: String,
    pub pid: u32,
    pub mem_mb: u64,
    pub cpu_pct: f32,
}

#[tauri::command]
pub fn get_memory_hogs() -> Vec<MemHog> {
    use sysinfo::System;
    let mut sys = System::new_all();
    sys.refresh_all();
    let mut hogs: Vec<MemHog> = sys
        .processes()
        .iter()
        .filter_map(|(pid, p)| {
            let name = p.name().to_string_lossy().to_string();
            let mem = p.memory();
            if mem < 50 * 1024 * 1024 {
                return None;
            }
            Some(MemHog {
                name,
                pid: pid.as_u32(),
                mem_mb: mem / 1024 / 1024,
                cpu_pct: p.cpu_usage(),
            })
        })
        .collect();
    hogs.sort_by_key(|x| std::cmp::Reverse(x.mem_mb));
    hogs.truncate(20);
    hogs
}

#[tauri::command]
pub fn end_process(state: State<'_, AppState>, name: String, pid: u32) -> Result<String, AppError> {
    let out = crate::cmd::hidden("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .output()
        .map_err(|e| AppError::Command(e.to_string()))?;
    let ok = out.status.success();
    let msg = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if ok {
        undo::log_entry(
            &state,
            "process_ended",
            format!("Ended process {} (PID {})", name, pid),
            json!({ "name": name, "pid": pid }),
            false,
        )?;
        // fun widgets — force-quit counter (Idle Roast roast-lines / the
        // Achievement engine's force-quit milestones)
        let _ = crate::fun::note_force_quit(&state);
        Ok(format!(
            "Ended {} — it will restart next time it's launched.",
            name
        ))
    } else {
        Err(AppError::Command(format!(
            "Could not end {}: {}",
            name, msg
        )))
    }
}

// ---------------------------------------------------------------------------
// Registry cleaner (orphaned uninstall entries)
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
pub struct OrphanEntry {
    pub name: String,
    pub hive: String,
    pub subkey: String,
    pub install_location: String,
    pub reason: String,
}

fn orphan_entries() -> Vec<OrphanEntry> {
    let mut out = Vec::new();
    for (hive_id, base) in uninstall_bases() {
        let hive = if hive_id == 1 {
            HKEY_LOCAL_MACHINE
        } else {
            HKEY_CURRENT_USER
        };
        let hive_name = if hive_id == 1 { "HKLM" } else { "HKCU" };
        if let Ok(key) = RegKey::predef(hive).open_subkey(base) {
            for sub in key.enum_keys().filter_map(|k| k.ok()) {
                if let Ok(sk) = key.open_subkey(&sub) {
                    let name: Option<String> = sk.get_value("DisplayName").ok();
                    let loc: Option<String> = sk.get_value("InstallLocation").ok();
                    let uninst: Option<String> = sk.get_value("UninstallString").ok();
                    let mut reason = None;
                    if let Some(l) = &loc {
                        if !l.trim().is_empty() {
                            let p = PathBuf::from(l);
                            if !p.exists() {
                                reason = Some(format!("InstallLocation missing: {}", l));
                            }
                        }
                    }
                    if reason.is_none() {
                        if let Some(u) = &uninst {
                            if !u.trim().is_empty() && !u.to_lowercase().contains("msiexec") {
                                let path = u
                                    .trim_matches('"')
                                    .split_whitespace()
                                    .next()
                                    .unwrap_or("")
                                    .to_string();
                                if !path.is_empty() {
                                    let p = PathBuf::from(&path);
                                    if !p.exists() {
                                        reason = Some(format!("Uninstaller missing: {}", path));
                                    }
                                }
                            }
                        }
                    }
                    if let (Some(n), Some(r)) = (name, reason) {
                        out.push(OrphanEntry {
                            name: n,
                            hive: hive_name.into(),
                            subkey: format!("{}\\{}", base, sub),
                            install_location: loc.unwrap_or_default(),
                            reason: r,
                        });
                    }
                }
            }
        }
    }
    out
}

#[tauri::command]
pub fn scan_orphaned_entries() -> Vec<OrphanEntry> {
    orphan_entries()
}

#[tauri::command]
pub fn remove_orphaned_entry(
    state: State<'_, AppState>,
    hive: String,
    subkey: String,
    name: String,
) -> Result<String, AppError> {
    let reg_hive = if hive == "HKLM" {
        HKEY_LOCAL_MACHINE
    } else {
        HKEY_CURRENT_USER
    };
    let key = RegKey::predef(reg_hive);
    let parent = subkey.rsplit_once('\\').map(|(p, _)| p).unwrap_or("");
    let leaf = subkey.rsplit_once('\\').map(|(_, l)| l).unwrap_or("");
    if parent.is_empty() || leaf.is_empty() {
        return Err(AppError::Command("Bad subkey".into()));
    }
    // backup all values before deleting the key
    let mut backup = serde_json::Map::new();
    if let Ok(sk) = key.open_subkey(&subkey) {
        for v in sk.enum_values().filter_map(|v| v.ok()) {
            let (vname, vval) = v;
            backup.insert(
                vname,
                json!({ "bytes": vval.bytes, "vtype": format!("{:?}", vval.vtype) }),
            );
        }
    }
    match key.delete_subkey_all(&subkey) {
        Ok(_) => {
            undo::log_entry(
                &state,
                "registry_cleanup",
                format!("Removed orphaned registry entry: {} ({})", name, subkey),
                json!({ "hive": hive, "parent": parent, "leaf": leaf, "backup": backup }),
                true,
            )?;
            Ok(format!("Removed orphaned entry: {}", name))
        }
        Err(e) => Err(AppError::Command(format!(
            "Failed to remove {}: {}",
            name, e
        ))),
    }
}

// ---------------------------------------------------------------------------
// Power plan tuner
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
pub struct PowerPlan {
    pub name: String,
    pub guid: String,
    pub active: bool,
}

fn parse_power_plans() -> Vec<PowerPlan> {
    let out = crate::cmd::hidden("powercfg")
        .args(["/list"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();
    let mut plans = Vec::new();
    for line in out.lines() {
        let l = line.trim();
        if l.starts_with("GUID") || l.is_empty() {
            continue;
        }
        // e.g. "Power Scheme GUID: 381b4222-f694-41f0-9685-ff5bb260df2e  (Balanced) *"
        if let Some(rest) = l.strip_prefix("Power Scheme GUID:") {
            let guid = rest.split_whitespace().next().unwrap_or("").to_string();
            let name = rest
                .split('(')
                .nth(1)
                .map(|s| {
                    s.trim_end_matches(')')
                        .trim()
                        .trim_end_matches('*')
                        .trim()
                        .to_string()
                })
                .unwrap_or_else(|| "Unknown".into());
            let active = rest.contains('*') || l.contains('*');
            if !guid.is_empty() {
                plans.push(PowerPlan { name, guid, active });
            }
        }
    }
    plans
}

#[tauri::command]
pub fn list_power_plans() -> Vec<PowerPlan> {
    parse_power_plans()
}

#[tauri::command]
pub fn set_active_power_plan(
    state: State<'_, AppState>,
    guid: String,
    name: String,
) -> Result<Vec<PowerPlan>, AppError> {
    let before = parse_power_plans()
        .into_iter()
        .find(|p| p.active)
        .map(|p| (p.guid, p.name))
        .unwrap_or_default();
    let out = crate::cmd::hidden("powercfg")
        .args(["/setactive", &guid])
        .output()
        .map_err(|e| AppError::Command(e.to_string()))?;
    if !out.status.success() {
        return Err(AppError::Command(
            String::from_utf8_lossy(&out.stderr).trim().to_string(),
        ));
    }
    undo::log_entry(
        &state,
        "power_plan",
        format!("Active power plan → {}", name),
        json!({ "before_guid": before.0, "before_name": before.1, "after_guid": guid, "after_name": name }),
        true,
    )?;
    Ok(parse_power_plans())
}

// ---------------------------------------------------------------------------
// Scheduled task auditor
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
pub struct TaskInfo {
    pub name: String,
    pub status: String,
    pub trigger: String,
    pub author: String,
    pub risky: bool,
}

#[tauri::command]
pub fn audit_scheduled_tasks() -> Vec<TaskInfo> {
    let out = crate::cmd::hidden("schtasks")
        .args(["/query", "/fo", "csv", "/v"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();
    let mut tasks = Vec::new();
    let mut lines = out.lines();
    let header = lines.next().unwrap_or("");
    let cols: Vec<&str> = header.split(',').map(|c| c.trim_matches('"')).collect();
    let idx = |name: &str| cols.iter().position(|c| c.trim() == name);
    let (ni, si, ti, ai) = (
        idx("TaskName").or(idx("Task Name")),
        idx("Status"),
        idx("Schedule Type").or(idx("Next Run Time")),
        idx("Author"),
    );
    if ni.is_none() {
        return tasks;
    }
    for line in lines {
        let f: Vec<&str> = line.split(',').map(|c| c.trim_matches('"')).collect();
        let get = |i: Option<usize>| i.and_then(|i| f.get(i)).copied().unwrap_or("").to_string();
        let name = get(ni);
        if name.is_empty() {
            continue;
        }
        let status = get(si);
        let trigger = get(ti);
        let author = get(ai);
        let nlow = name.to_lowercase();
        let risky = (trigger.contains("at logon")
            || trigger.contains("on logon")
            || trigger.contains("at startup")
            || trigger.contains("on startup"))
            && (author.is_empty() || !author.contains("microsoft"))
            && !(nlow.contains("microsoft")
                || nlow.contains("windows")
                || nlow.contains("onedrive")
                || nlow.contains("nvidia")
                || nlow.contains("adobe"));
        tasks.push(TaskInfo {
            name: name.rsplit('\\').next().unwrap_or(&name).to_string(),
            status,
            trigger,
            author,
            risky,
        });
    }
    tasks.sort_by_key(|x| std::cmp::Reverse(x.risky));
    tasks.truncate(60);
    tasks
}

// ---------------------------------------------------------------------------
// Boot time tracker
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
pub struct BootStats {
    pub last_boot_ms: Option<u64>,
    pub trend_ms: Option<u64>, // previous average
    pub samples: u32,
    pub available: bool,
}

fn boot_times_path(state: &AppState) -> PathBuf {
    state.data_dir.join("boot_times.json")
}

#[tauri::command]
pub fn get_boot_stats(state: State<'_, AppState>) -> BootStats {
    // Read the most recent boot duration from the Windows performance event log.
    let out = crate::cmd::hidden("wevtutil")
        .args([
            "qe",
            "Microsoft-Windows-Diagnostics-Performance/Operational",
            "/q:*[System[(EventID=100)]]",
            "/c:1",
            "/rd:true",
            "/f:text",
        ])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();
    let mut last = None;
    if !out.is_empty() {
        for line in out.lines() {
            let l = line.trim();
            if let Some(rest) = l.strip_prefix("BootTime:") {
                let v: u64 = rest.trim().parse().unwrap_or(0);
                if v > 0 {
                    last = Some(v); // milliseconds
                }
            }
        }
    }
    let mut history: Vec<u64> = load_json(&boot_times_path(&state), Vec::new());
    if let Some(v) = last {
        history.push(v);
        if history.len() > 30 {
            history.drain(..history.len() - 30);
        }
        let _ = save_json(&boot_times_path(&state), &history);
    }
    let samples = history.len() as u32;
    let trend_ms = if history.len() >= 2 {
        Some(history[..history.len() - 1].iter().sum::<u64>() / (history.len() as u64 - 1))
    } else {
        None
    };
    BootStats {
        last_boot_ms: last,
        trend_ms,
        samples,
        available: last.is_some(),
    }
}

// ---------------------------------------------------------------------------
// Browser extension auditor
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
pub struct ExtensionInfo {
    pub browser: String,
    pub name: String,
    pub version: String,
    pub enabled: bool,
    pub source: String, // "web store" | "unknown"
}

fn chrome_like_extensions(base: &PathBuf, browser: &str) -> Vec<ExtensionInfo> {
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(base) {
        for prof in rd.flatten() {
            let ext_dir = prof.path().join("Extensions");
            if !ext_dir.is_dir() {
                continue;
            }
            let prefs = prof.path().join("Preferences");
            let prefs_json: serde_json::Value = std::fs::read_to_string(&prefs)
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or(serde_json::Value::Null);
            let mut ext_map: serde_json::Map<String, serde_json::Value> = serde_json::Map::new();
            if let Some(settings) = prefs_json.get("extensions").and_then(|e| e.get("settings")) {
                if let Some(obj) = settings.as_object() {
                    for (k, v) in obj {
                        let id = k.trim_matches('"');
                        if id.len() == 32 {
                            let state: i64 = v.get("state").and_then(|s| s.as_i64()).unwrap_or(0);
                            let loc: i64 = v.get("location").and_then(|l| l.as_i64()).unwrap_or(0);
                            let enabled = state == 1;
                            let webstore = loc == 1;
                            ext_map.insert(
                                id.to_string(),
                                json!({ "enabled": enabled, "webstore": webstore }),
                            );
                        }
                    }
                }
            }
            if let Ok(rd2) = std::fs::read_dir(&ext_dir) {
                for ext in rd2.flatten() {
                    let id = ext.file_name().to_string_lossy().to_string();
                    if let Ok(rd3) = std::fs::read_dir(ext.path()) {
                        for ver in rd3.flatten() {
                            let mf = ver.path().join("manifest.json");
                            if let Ok(s) = std::fs::read_to_string(&mf) {
                                if let Ok(m) = serde_json::from_str::<serde_json::Value>(&s) {
                                    let name = m
                                        .get("name")
                                        .and_then(|n| n.as_str())
                                        .unwrap_or("?")
                                        .trim_matches('_')
                                        .to_string();
                                    let version = m
                                        .get("version")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("?")
                                        .to_string();
                                    let meta = ext_map.get(&id);
                                    let enabled = meta
                                        .and_then(|m| m.get("enabled"))
                                        .and_then(|e| e.as_bool())
                                        .unwrap_or(true);
                                    let webstore = meta
                                        .and_then(|m| m.get("webstore"))
                                        .and_then(|w| w.as_bool())
                                        .unwrap_or(false);
                                    out.push(ExtensionInfo {
                                        browser: browser.into(),
                                        name,
                                        version,
                                        enabled,
                                        source: if webstore {
                                            "web store".into()
                                        } else {
                                            "unknown".into()
                                        },
                                    });
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    out
}

#[tauri::command]
pub fn audit_browser_extensions() -> Vec<ExtensionInfo> {
    let local = std::env::var("LOCALAPPDATA").unwrap_or_default();
    let appdata = std::env::var("APPDATA").unwrap_or_default();
    let mut out = Vec::new();
    out.extend(chrome_like_extensions(
        &PathBuf::from(&local).join(r"Google\Chrome\User Data"),
        "Chrome",
    ));
    out.extend(chrome_like_extensions(
        &PathBuf::from(&local).join(r"Microsoft\Edge\User Data"),
        "Edge",
    ));
    out.extend(chrome_like_extensions(
        &PathBuf::from(&local).join(r"BraveSoftware\Brave-Browser\User Data"),
        "Brave",
    ));
    // Firefox
    let prof_dir = PathBuf::from(&appdata).join(r"Mozilla\Firefox\Profiles");
    if let Ok(rd) = std::fs::read_dir(&prof_dir) {
        for prof in rd.flatten() {
            let ext_dir = prof.path().join("extensions");
            if !ext_dir.is_dir() {
                continue;
            }
            for ext in std::fs::read_dir(&ext_dir).into_iter().flatten().flatten() {
                let name = ext.file_name().to_string_lossy().to_string();
                if name.ends_with(".xpi") {
                    out.push(ExtensionInfo {
                        browser: "Firefox".into(),
                        name: name.trim_end_matches(".xpi").to_string(),
                        version: "?".into(),
                        enabled: true,
                        source: "unknown".into(),
                    });
                }
            }
        }
    }
    out.sort_by(|a, b| a.browser.cmp(&b.browser).then(a.name.cmp(&b.name)));
    out.truncate(120);
    out
}

// ---------------------------------------------------------------------------
// Default app / file association manager
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
pub struct AssociationInfo {
    pub ext: String,
    pub prog_id: String,
    pub handler: String,
}

#[tauri::command]
pub fn audit_file_associations() -> Vec<AssociationInfo> {
    let exts = [
        ".html", ".htm", ".pdf", ".txt", ".md", ".jpg", ".png", ".mp3", ".mp4", ".zip", ".docx",
        ".xlsx", ".pptx", ".csv", ".json",
    ];
    let mut out = Vec::new();
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    for ext in exts {
        let path = format!(
            r"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\{}\UserChoice",
            ext
        );
        let mut prog_id = String::new();
        let mut handler = String::new();
        if let Ok(k) = hkcu.open_subkey(&path) {
            prog_id = k.get_value("ProgId").unwrap_or_default();
            handler = k.get_value("Hash").unwrap_or_default();
        }
        if prog_id.is_empty() {
            if let Ok(k) = hkcu.open_subkey(format!(
                r"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\{}",
                ext
            )) {
                if let Ok(rd) = k.open_subkey("OpenWithProgids") {
                    if let Some((name, _)) = rd.enum_values().filter_map(|v| v.ok()).next() {
                        prog_id = name;
                    }
                }
            }
        }
        out.push(AssociationInfo {
            ext: ext.into(),
            prog_id: if prog_id.is_empty() {
                "system default".into()
            } else {
                prog_id
            },
            handler: if handler.is_empty() {
                "system default".into()
            } else {
                "user choice".into()
            },
        });
    }
    out
}

#[tauri::command]
pub fn reset_file_association(state: State<'_, AppState>, ext: String) -> Result<String, AppError> {
    let path = format!(
        r"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\{}\UserChoice",
        ext
    );
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    // backup the UserChoice values
    let mut backup = serde_json::Map::new();
    if let Ok(k) = hkcu.open_subkey(&path) {
        for v in k.enum_values().filter_map(|v| v.ok()) {
            let (vname, vval) = v;
            backup.insert(
                vname,
                json!({ "bytes": vval.bytes, "vtype": format!("{:?}", vval.vtype) }),
            );
        }
    }
    let parent = format!(
        r"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\{}",
        ext
    );
    match hkcu.delete_subkey_all(format!(r"{}\UserChoice", parent)) {
        Ok(_) => {
            undo::log_entry(
                &state,
                "file_association",
                format!("Reset file association for {} to system default", ext),
                json!({ "ext": ext, "backup": backup }),
                true,
            )?;
            Ok(format!("{} will now open with the system default.", ext))
        }
        Err(e) => Err(AppError::Command(format!("Could not reset {}: {}", ext, e))),
    }
}

// ---------------------------------------------------------------------------
// Driver inventory (read-only)
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct DriverInfo {
    pub name: String,
    pub provider: String,
    pub version: String,
    pub date: String,
}

#[tauri::command]
pub fn list_drivers() -> Vec<DriverInfo> {
    let out = crate::cmd::hidden("pnputil")
        .args(["/enum-drivers"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();
    let mut drivers = Vec::new();
    let mut cur = DriverInfo {
        name: String::new(),
        provider: String::new(),
        version: String::new(),
        date: String::new(),
    };
    let mut have = false;
    for line in out.lines() {
        let l = line.trim();
        if let Some(rest) = l.strip_prefix("Published Name:") {
            if have {
                drivers.push(cur);
            }
            cur = DriverInfo {
                name: String::new(),
                provider: String::new(),
                version: String::new(),
                date: String::new(),
            };
            cur.name = rest.trim().to_string();
            have = true;
        } else if let Some(rest) = l.strip_prefix("Driver Provider:") {
            cur.provider = rest.trim().to_string();
        } else if let Some(rest) = l.strip_prefix("Driver Version:") {
            cur.version = rest.trim().to_string();
        } else if let Some(rest) = l.strip_prefix("Driver Date:") {
            cur.date = rest.trim().to_string();
        }
    }
    if have {
        drivers.push(cur);
    }
    drivers.sort_by(|a, b| a.name.cmp(&b.name));
    drivers
}
