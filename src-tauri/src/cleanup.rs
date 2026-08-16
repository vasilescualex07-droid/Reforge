use crate::state::AppState;
use crate::storage::{format_bytes, now_millis};
use crate::undo;
use serde::Serialize;
use serde_json::json;
use std::path::{Path, PathBuf};
use tauri::State;
use walkdir::WalkDir;

use crate::error::AppError;
#[derive(Serialize, Clone)]
pub struct JunkItem {
    pub id: String,
    pub label: String,
    pub path: String,
    pub size: u64,
    pub file_count: u64,
    pub admin_required: bool,
}

#[derive(Serialize)]
pub struct JunkScan {
    pub items: Vec<JunkItem>,
    pub total_bytes: u64,
    pub scanned_at: u64,
}

#[derive(Serialize)]
pub struct CleanResult {
    pub freed_bytes: u64,
    pub deleted_count: u64,
    pub failed: Vec<String>,
    pub skipped_admin: Vec<String>,
}

struct Target {
    id: String,
    label: String,
    path: PathBuf,
    admin_required: bool,
}

fn targets() -> Vec<Target> {
    let temp = std::env::var("TEMP")
        .unwrap_or_else(|_| std::env::temp_dir().to_string_lossy().to_string());
    let local = std::env::var("LOCALAPPDATA").unwrap_or_default();
    let appdata = std::env::var("APPDATA").unwrap_or_default();
    let mut t = vec![
        Target {
            id: "temp".into(),
            label: "User temp files".into(),
            path: PathBuf::from(&temp),
            admin_required: false,
        },
        Target {
            id: "edge_cache".into(),
            label: "Edge browser cache".into(),
            path: PathBuf::from(&local).join(r"Microsoft\Edge\User Data\Default\Cache"),
            admin_required: false,
        },
        Target {
            id: "chrome_cache".into(),
            label: "Chrome browser cache".into(),
            path: PathBuf::from(&local).join(r"Google\Chrome\User Data\Default\Cache"),
            admin_required: false,
        },
        Target {
            id: "thumbnail_cache".into(),
            label: "Explorer thumbnail cache".into(),
            path: PathBuf::from(&local).join(r"Microsoft\Windows\Explorer"),
            admin_required: false,
        },
        Target {
            id: "crash_dumps".into(),
            label: "Crash dumps".into(),
            path: PathBuf::from(&local).join("CrashDumps"),
            admin_required: false,
        },
        Target {
            id: "npm_cache".into(),
            label: "npm cache".into(),
            path: PathBuf::from(&local).join("npm-cache"),
            admin_required: false,
        },
        Target {
            id: "windows_temp".into(),
            label: "Windows temp (admin)".into(),
            path: PathBuf::from(r"C:\Windows\Temp"),
            admin_required: true,
        },
        Target {
            id: "update_cache".into(),
            label: "Windows Update cache (admin)".into(),
            path: PathBuf::from(r"C:\Windows\SoftwareDistribution\Download"),
            admin_required: true,
        },
        Target {
            id: "delivery_opt_cache".into(),
            label: "Delivery Optimization cache (admin)".into(),
            path: PathBuf::from(r"C:\Windows\ServiceProfiles\NetworkService\AppData\Local\Microsoft\Windows\DeliveryOptimization\Cache"),
            admin_required: true,
        },
    ];
    // Firefox cache2 under profiles
    let profiles = PathBuf::from(&appdata).join(r"Mozilla\Firefox\Profiles");
    if let Ok(rd) = std::fs::read_dir(&profiles) {
        for e in rd.flatten() {
            let cache2 = e.path().join("cache2");
            if cache2.exists() {
                t.push(Target {
                    id: format!("firefox_cache_{}", e.file_name().to_string_lossy()),
                    label: "Firefox cache".into(),
                    path: cache2,
                    admin_required: false,
                });
            }
        }
    }
    t
}

fn dir_size(path: &Path) -> (u64, u64) {
    let mut size = 0u64;
    let mut count = 0u64;
    for entry in WalkDir::new(path)
        .max_depth(12)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if entry.file_type().is_file() {
            if let Ok(m) = entry.metadata() {
                size += m.len();
                count += 1;
            }
        }
    }
    (size, count)
}

fn clear_dir_contents(path: &Path) -> (u64, u64, Vec<String>) {
    let mut freed = 0u64;
    let mut count = 0u64;
    let mut failed = Vec::new();
    let entries: Vec<_> = WalkDir::new(path)
        .max_depth(12)
        .min_depth(1)
        .into_iter()
        .filter_map(|e| e.ok())
        .collect();
    // delete children before parents
    for entry in entries.iter().rev() {
        let p = entry.path();
        if entry.file_type().is_file() || entry.file_type().is_symlink() {
            if let Ok(m) = entry.metadata() {
                freed += m.len();
            }
            match std::fs::remove_file(p) {
                Ok(_) => count += 1,
                Err(e) => failed.push(format!("{}: {}", p.display(), e)),
            }
        } else if entry.file_type().is_dir() {
            let _ = std::fs::remove_dir(p);
        }
    }
    (freed, count, failed)
}

// ---- Tauri commands ----

#[tauri::command]
pub fn scan_junk() -> JunkScan {
    let mut items = Vec::new();
    let mut total = 0u64;
    for t in targets() {
        if !t.path.exists() {
            continue;
        }
        let (size, count) = dir_size(&t.path);
        if size == 0 && count == 0 {
            continue;
        }
        total += size;
        items.push(JunkItem {
            id: t.id,
            label: t.label,
            path: t.path.to_string_lossy().to_string(),
            size,
            file_count: count,
            admin_required: t.admin_required,
        });
    }
    items.sort_by_key(|x| std::cmp::Reverse(x.size));
    JunkScan {
        items,
        total_bytes: total,
        scanned_at: now_millis(),
    }
}

pub fn clean_junk_inner(state: &AppState, ids: Vec<String>) -> Result<CleanResult, AppError> {
    let mut freed = 0u64;
    let mut deleted = 0u64;
    let mut failed = Vec::new();
    let mut skipped_admin = Vec::new();

    for t in targets() {
        if !ids.contains(&t.id) {
            continue;
        }
        if t.admin_required {
            skipped_admin.push(t.label.clone());
            continue;
        }
        if !t.path.exists() {
            continue;
        }
        let (f, c, ferr) = clear_dir_contents(&t.path);
        freed += f;
        deleted += c;
        failed.extend(ferr);
    }

    let result = CleanResult {
        freed_bytes: freed,
        deleted_count: deleted,
        failed,
        skipped_admin,
    };

    undo::log_entry(
        state,
        "junk_clean",
        format!(
            "Cleaned {} of junk ({} files)",
            format_bytes(result.freed_bytes),
            result.deleted_count
        ),
        json!({ "freed": result.freed_bytes, "deleted": result.deleted_count, "at": now_millis() }),
        false,
    )?;

    Ok(result)
}

#[tauri::command]
pub fn clean_junk(state: State<'_, AppState>, ids: Vec<String>) -> Result<CleanResult, AppError> {
    let r = clean_junk_inner(&state, ids)?;
    // fun widgets — real completion events (Confetti Cannon auto-fire + the
    // Certificate's "time since last cleanup" stat + cleanup achievements)
    let _ = crate::fun::note_completion(&state, "cleanup");
    Ok(r)
}

// ---------------------------------------------------------------------------
// S14.2 — one-click safe clean (curated list, dry-run first, trash-staged)
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
pub struct CleanNowItem {
    pub id: String,
    pub label: String,
    pub path: String,
    pub size: u64,
    pub file_count: u64,
    /// "permanent" = regenerable junk (confirm once, then deleted);
    /// "trash" = non-regenerable (moved to the staging trash, undoable).
    pub action: String,
    pub admin_required: bool,
}

/// Windows Recycle Bin size in bytes (Shell.Application COM via PowerShell).
/// Returns None when the shell reports nothing (empty / unavailable).
pub fn recycle_bin_size() -> Option<u64> {
    let script = "$sh = New-Object -ComObject Shell.Application; $rb = $sh.Namespace(0xA); $sum = 0; $rb.Items() | ForEach-Object { $sum += $_.Size }; $sum";
    let out = crate::cmd::hidden("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command"])
        .arg(script)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    s.parse::<u64>().ok()
}

/// Empty the Windows Recycle Bin (Shell COM). Admin not required for the
/// current user's bin.
pub fn empty_recycle_bin() -> Result<(), AppError> {
    let script = "Clear-RecycleBin -Force -ErrorAction SilentlyContinue";
    let out = crate::cmd::hidden("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command"])
        .arg(script)
        .output()
        .map_err(|e| AppError::Command(format!("PowerShell not available: {}", e)))?;
    if !out.status.success() {
        return Err(AppError::Command(String::from_utf8_lossy(&out.stderr).trim().into()));
    }
    Ok(())
}

/// Old installers (.msi/.exe) in Downloads older than `older_than_days`.
/// Non-regenerable → always trash-staged, never hard-deleted.
pub fn old_installers(older_than_days: u64, exclusions: &[String]) -> Vec<CleanNowItem> {
    let home = dirs::home_dir().unwrap_or_default();
    let dl = home.join("Downloads");
    let mut out = Vec::new();
    if !dl.is_dir() {
        return out;
    }
    let now = now_millis();
    let cutoff = now.saturating_sub(older_than_days.max(1) * 86400 * 1000);
    for e in std::fs::read_dir(&dl).into_iter().flatten().flatten() {
        let p = e.path();
        if !p.is_file() {
            continue;
        }
        let name = p.file_name().unwrap_or_default().to_string_lossy().to_lowercase();
        if !(name.ends_with(".msi") || name.ends_with(".exe")) {
            continue;
        }
        let path_str = p.to_string_lossy().to_string();
        if exclusions.iter().any(|x| path_str.starts_with(x)) {
            continue;
        }
        let modified = p
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        if modified == 0 || modified >= cutoff {
            continue;
        }
        if let Ok(m) = p.metadata() {
            out.push(CleanNowItem {
                id: format!("installer_{}", e.file_name().to_string_lossy()),
                label: e.file_name().to_string_lossy().to_string(),
                path: path_str,
                size: m.len(),
                file_count: 1,
                action: "trash".into(),
                admin_required: false,
            });
        }
    }
    out.sort_by_key(|x| std::cmp::Reverse(x.size));
    out
}

/// Build the curated safe-clean list honoring the S14.4 config (category
/// toggles + exclusions + dry-run).
fn safe_clean_items(state: &AppState) -> Vec<CleanNowItem> {
    let cfg = crate::storage::load_storage_config(state);
    let mut items: Vec<CleanNowItem> = Vec::new();
    let mk = |t: &Target| CleanNowItem {
        id: t.id.clone(),
        label: t.label.clone(),
        path: t.path.to_string_lossy().to_string(),
        size: 0,
        file_count: 0,
        action: "permanent".into(),
        admin_required: t.admin_required,
    };
    for t in targets() {
        if !t.path.exists() {
            continue;
        }
        let eligible = match t.id.as_str() {
            "temp" | "windows_temp" | "npm_cache" | "crash_dumps" => cfg.safe_temp,
            "update_cache" | "delivery_opt_cache" => cfg.safe_update_cache,
            "edge_cache" | "chrome_cache" | "firefox_cache" | "thumbnail_cache" => cfg.safe_browser_caches,
            _ => false,
        };
        if !eligible {
            continue;
        }
        let mut it = mk(&t);
        let (size, count) = dir_size(&t.path);
        it.size = size;
        it.file_count = count;
        items.push(it);
    }
    if cfg.safe_recycle_bin {
        if let Some(b) = recycle_bin_size() {
            if b > 0 {
                items.push(CleanNowItem {
                    id: "recycle_bin".into(),
                    label: "Recycle Bin".into(),
                    path: "Recycle Bin".into(),
                    size: b,
                    file_count: 1,
                    action: "permanent".into(),
                    admin_required: false,
                });
            }
        }
    }
    if cfg.safe_installers {
        items.extend(old_installers(cfg.unused_days, &cfg.exclusions));
    }
    items.sort_by_key(|x| std::cmp::Reverse(x.size));
    items
}

/// S14.2 — preview exactly what one-click safe clean would delete.
pub fn preview_clean_now_inner(state: &AppState) -> Vec<CleanNowItem> {
    safe_clean_items(state)
}

/// S14.2 — run the safe clean. With the config's dry-run ON this reports what
/// WOULD be freed and touches nothing; otherwise it applies: regenerable junk
/// is deleted, non-regenerable items move to the staging trash (undoable),
/// locked files are reported as skipped.
pub fn clean_now_inner(state: &AppState, ids: Vec<String>) -> Result<CleanResult, AppError> {
    let cfg = crate::storage::load_storage_config(state);
    let mut freed = 0u64;
    let mut deleted = 0u64;
    let mut failed = Vec::new();
    let mut skipped_admin = Vec::new();
    // Per-category totals for the History report card (S14.5).
    let mut categories: Vec<(String, u64)> = Vec::new();
    let mut record = |label: &str, freed_amt: u64| {
        if freed_amt > 0 {
            if let Some(e) = categories.iter_mut().find(|(l, _)| l == label) {
                e.1 += freed_amt;
            } else {
                categories.push((label.to_string(), freed_amt));
            }
        }
    };

    for it in safe_clean_items(state) {
        if !ids.contains(&it.id) {
            continue;
        }
        if cfg.dry_run {
            freed += it.size;
            continue;
        }
        match it.action.as_str() {
            "permanent" => {
                if it.id == "recycle_bin" {
                    if empty_recycle_bin().is_ok() {
                        freed += it.size;
                        deleted += 1;
                        record(&it.label, it.size);
                    } else {
                        failed.push("Recycle Bin: could not empty".into());
                    }
                    continue;
                }
                let target = PathBuf::from(&it.path);
                if it.admin_required {
                    skipped_admin.push(it.label.clone());
                    continue;
                }
                if !target.exists() {
                    continue;
                }
                let (f, c, ferr) = clear_dir_contents(&target);
                freed += f;
                deleted += c;
                record(&it.label, f);
                failed.extend(ferr);
            }
            "trash" => {
                // stage to the undoable staging trash (like duplicate removal)
                let trash = crate::duplicates::trash_dir(state);
                let _ = std::fs::create_dir_all(&trash);
                let src = PathBuf::from(&it.path);
                if !src.exists() {
                    continue;
                }
                let name = src.file_name().unwrap_or_default().to_string_lossy().to_string();
                let mut dst = trash.join(&name);
                let mut i = 1;
                while dst.exists() {
                    dst = trash.join(format!("{}_{}", i, name));
                    i += 1;
                }
                match std::fs::rename(&src, &dst) {
                    Ok(_) => {
                        freed += it.size;
                        deleted += 1;
                        record(&it.label, it.size);
                    }
                    Err(_) => failed.push(format!("{}: locked or in use", it.label)),
                }
            }
            _ => {}
        }
    }

    if cfg.dry_run {
        // dry-run is honest: report the would-be total, delete nothing
        return Ok(CleanResult {
            freed_bytes: freed,
            deleted_count: 0,
            failed,
            skipped_admin,
        });
    }

    let mut skipped = failed.clone();
    skipped.extend(skipped_admin.iter().cloned());
    undo::log_entry(
        state,
        "storage_clean",
        format!(
            "Safe clean freed {} ({})",
            format_bytes(freed),
            if deleted == 1 { "1 item".into() } else { format!("{} items", deleted) }
        ),
        json!({
            "freed": freed,
            "deleted": deleted,
            "dry_run": false,
            "at": now_millis(),
            // S14.5 — History report card data: per-category totals + skip reasons.
            "categories": categories.iter().map(|(l, f)| json!({ "label": l, "freed": f })).collect::<Vec<_>>(),
            "skipped": skipped,
        }),
        false,
    )?;
    let _ = crate::fun::note_completion(state, "cleanup");
    Ok(CleanResult {
        freed_bytes: freed,
        deleted_count: deleted,
        failed,
        skipped_admin,
    })
}

#[tauri::command]
pub fn preview_clean_now(state: State<'_, AppState>) -> Vec<CleanNowItem> {
    preview_clean_now_inner(&state)
}

#[tauri::command]
pub fn clean_now(state: State<'_, AppState>, ids: Vec<String>) -> Result<CleanResult, AppError> {
    clean_now_inner(&state, ids)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dry_run_reports_without_touching_anything() {
        // The safe list is built from real system paths (TEMP, caches) — the
        // dry-run contract is that NOTHING gets deleted. We prove it by
        // planting a sentinel in the real TEMP and asserting it survives.
        let temp = std::env::var("TEMP").unwrap_or_else(|_| std::env::temp_dir().to_string_lossy().to_string());
        let sentinel = PathBuf::from(&temp).join(format!("reforge-dryrun-{}", std::process::id()));
        std::fs::write(&sentinel, b"keep me").unwrap();

        let dir = std::env::temp_dir().join(format!("reforge-clean-cfg-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let state = AppState { data_dir: dir.clone() };
        // default config: dry_run = true
        let ids = vec!["temp".to_string()];
        let r = clean_now_inner(&state, ids).unwrap();
        assert_eq!(r.deleted_count, 0, "dry run must delete nothing");
        assert!(std::fs::metadata(&sentinel).is_ok(), "sentinel must survive a dry run");

        // with dry_run OFF the same call is a REAL clean — sentinel dies
        let cfg = crate::storage::StorageConfig { dry_run: false, ..Default::default() };
        crate::storage::save_json(&dir.join("storage_config.json"), &cfg).unwrap();
        let r2 = clean_now_inner(&state, vec!["temp".to_string()]).unwrap();
        assert!(r2.deleted_count > 0, "real clean should delete temp contents");
        assert!(std::fs::metadata(&sentinel).is_err(), "sentinel must be gone after a real clean");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
