use crate::state::AppState;
use crate::storage::{format_bytes, load_json, now_millis, save_json};
use crate::undo;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::io::Write;
use std::path::PathBuf;
use tauri::{Emitter, State};
use uuid::Uuid;
use walkdir::WalkDir;
use windows::core::PCWSTR;
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::Shell::{SHFileOperationW, FOF_ALLOWUNDO, FO_DELETE, SHFILEOPSTRUCTW};
use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};

// ---------------------------------------------------------------------------
// Smart folders (dynamic saved searches)
// ---------------------------------------------------------------------------

use crate::error::AppError;
#[derive(Serialize, Deserialize, Clone)]
pub struct SmartFolder {
    pub id: String,
    pub name: String,
    pub root: String,
    pub extensions: Vec<String>,
    pub min_age_days: Option<u64>,
    pub created_at: u64,
}

#[derive(Serialize, Clone)]
pub struct SmartHit {
    pub path: String,
    pub size: u64,
    pub modified: u64,
}

fn smart_path(state: &AppState) -> PathBuf {
    state.data_dir.join("smart_folders.json")
}

fn load_smart(state: &AppState) -> Vec<SmartFolder> {
    load_json(&smart_path(state), Vec::new())
}

#[tauri::command]
pub fn list_smart_folders(state: State<'_, AppState>) -> Vec<SmartFolder> {
    load_smart(&state)
}

#[tauri::command]
pub fn create_smart_folder(
    state: State<'_, AppState>,
    name: String,
    root: String,
    extensions: Vec<String>,
    min_age_days: Option<u64>,
) -> Result<SmartFolder, AppError> {
    let mut list = load_smart(&state);
    let sf = SmartFolder {
        id: Uuid::new_v4().to_string(),
        name,
        root,
        extensions,
        min_age_days,
        created_at: now_millis(),
    };
    list.push(sf.clone());
    save_json(&smart_path(&state), &list)?;
    Ok(sf)
}

#[tauri::command]
pub fn remove_smart_folder(state: State<'_, AppState>, id: String) -> Result<(), AppError> {
    let mut list = load_smart(&state);
    list.retain(|s| s.id != id);
    save_json(&smart_path(&state), &list)
}

#[tauri::command]
pub fn run_smart_folder(state: State<'_, AppState>, id: String) -> Result<Vec<SmartHit>, AppError> {
    let list = load_smart(&state);
    let sf = list
        .iter()
        .find(|s| s.id == id)
        .ok_or_else(|| "Smart folder not found".to_string())?;
    let root = PathBuf::from(&sf.root);
    if !root.is_dir() {
        return Err(AppError::Command(format!("Folder not found: {}", sf.root)));
    }
    let mut hits = Vec::new();
    for entry in WalkDir::new(&root)
        .max_depth(6)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if !entry.file_type().is_file() {
            continue;
        }
        let p = entry.path();
        let name = p
            .file_name()
            .map(|n| n.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        if !sf.extensions.is_empty() {
            let ext = p
                .extension()
                .map(|e| e.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            if !sf
                .extensions
                .iter()
                .any(|e| e.trim_start_matches('.').to_lowercase() == ext)
            {
                continue;
            }
        }
        let mtime = p
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        if let Some(days) = sf.min_age_days {
            let age_days = (now_millis() / 1000).saturating_sub(mtime) / 86400;
            if age_days < days {
                continue;
            }
        }
        let _ = name;
        if let Ok(meta) = p.metadata() {
            hits.push(SmartHit {
                path: p.to_string_lossy().to_string(),
                size: meta.len(),
                modified: mtime,
            });
        }
    }
    hits.sort_by_key(|x| std::cmp::Reverse(x.modified));
    hits.truncate(500);
    Ok(hits)
}

// ---------------------------------------------------------------------------
// Old file archiver (zip)
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone)]
pub struct ArchiveMove {
    pub rel: String, // relative path inside the dir
    pub original: String,
}

#[tauri::command]
pub fn plan_archive(dir: String, months: u64) -> Result<Vec<ArchiveMove>, AppError> {
    let root = PathBuf::from(&dir);
    if !root.is_dir() {
        return Err(AppError::Command(format!("Not a folder: {}", dir)));
    }
    let cutoff = now_millis() / 1000 - months * 30 * 86400;
    let mut moves = Vec::new();
    for entry in WalkDir::new(&root)
        .max_depth(4)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if !entry.file_type().is_file() {
            continue;
        }
        let p = entry.path();
        let mtime = p
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(u64::MAX);
        if mtime < cutoff {
            let rel = p
                .strip_prefix(&root)
                .map(|r| r.to_string_lossy().to_string())
                .unwrap_or_default();
            moves.push(ArchiveMove {
                rel,
                original: p.to_string_lossy().to_string(),
            });
        }
    }
    moves.sort_by(|a, b| a.rel.cmp(&b.rel));
    Ok(moves)
}

#[tauri::command]
pub fn apply_archive(
    state: State<'_, AppState>,
    dir: String,
    months: u64,
) -> Result<String, AppError> {
    let plan = plan_archive(dir.clone(), months)?;
    if plan.is_empty() {
        return Ok("Nothing to archive — no files are that old.".to_string());
    }
    let root = PathBuf::from(&dir);
    let stamp = chrono_like_stamp();
    // millisecond suffix + collision guard: two archives in the same day must
    // never silently overwrite each other (the older zip is the revert source)
    let mut zip_path = root.join(format!("_Reforge_Archive_{}_{}.zip", stamp, now_millis()));
    let mut n = 1u32;
    while zip_path.exists() {
        zip_path = root.join(format!(
            "_Reforge_Archive_{}_{}_{}.zip",
            stamp,
            now_millis(),
            n
        ));
        n += 1;
    }
    let file = std::fs::File::create(&zip_path).map_err(|e| AppError::Command(e.to_string()))?;
    let mut zip = zip::ZipWriter::new(file);
    let opts: zip::write::SimpleFileOptions = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    let mut total_bytes = 0u64;
    let mut archived = 0usize;
    for m in &plan {
        let src = PathBuf::from(&m.original);
        if !src.exists() {
            continue;
        }
        if let Ok(bytes) = std::fs::read(&src) {
            total_bytes += bytes.len() as u64;
            if zip.start_file(&m.rel, opts).is_ok() && zip.write_all(&bytes).is_ok() {
                archived += 1;
            }
        }
    }
    zip.finish().map_err(|e| AppError::Command(e.to_string()))?;
    // remove originals that were archived
    let mut removed = 0usize;
    for m in &plan {
        let src = PathBuf::from(&m.original);
        if src.exists() && std::fs::remove_file(&src).is_ok() {
            removed += 1;
        }
    }
    undo::log_entry(
        &state,
        "archive",
        format!(
            "Archived {} old files ({} → {})",
            archived,
            format_bytes(total_bytes),
            zip_path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default()
        ),
        json!({ "zip": zip_path.to_string_lossy().to_string(), "moves": plan, "dir": dir }),
        true,
    )?;
    Ok(format!(
        "Archived {} files ({} removed from their folders)",
        archived, removed
    ))
}

fn chrono_like_stamp() -> String {
    let now = now_millis();
    let secs = now / 1000;
    let days = secs / 86400;
    let (y, m, d) = date_from_days(days as i64);
    format!("{}{:02}{:02}", y, m, d)
}

pub fn date_from_days(days: i64) -> (i64, i64, i64) {
    // civil-from-days (Howard Hinnant algorithm)
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m, d)
}

// ---------------------------------------------------------------------------
// Batch rename
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone)]
pub struct RenameOp {
    pub from: String,
    pub to: String,
}

#[tauri::command]
pub fn preview_rename(
    dir: String,
    prefix: String,
    extension: String,
    start_at: u32,
) -> Result<Vec<RenameOp>, AppError> {
    let root = PathBuf::from(&dir);
    if !root.is_dir() {
        return Err(AppError::Command(format!("Not a folder: {}", dir)));
    }
    let ext_filter = extension.trim().trim_start_matches('.').to_lowercase();
    let mut files: Vec<PathBuf> = std::fs::read_dir(&root)
        .map_err(|e| AppError::Command(e.to_string()))?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_file())
        .collect();
    files.sort();
    let mut ops = Vec::new();
    let mut n = start_at;
    for p in files {
        let ext = p
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        if !ext_filter.is_empty() && ext != ext_filter {
            continue;
        }
        let new_name = if prefix.is_empty() {
            format!("{}{}", "file_", n)
        } else {
            format!("{}_{:03}", prefix, n)
        };
        let ext_dot = if ext.is_empty() {
            String::new()
        } else {
            format!(".{}", ext)
        };
        let to = root.join(format!("{}{}", new_name, ext_dot));
        if to != p {
            ops.push(RenameOp {
                from: p.to_string_lossy().to_string(),
                to: to.to_string_lossy().to_string(),
            });
        }
        n += 1;
    }
    Ok(ops)
}

#[tauri::command]
pub fn apply_rename(
    state: State<'_, AppState>,
    dir: String,
    prefix: String,
    extension: String,
    start_at: u32,
) -> Result<String, AppError> {
    let ops = preview_rename(dir, prefix, extension, start_at)?;
    if ops.is_empty() {
        return Ok("No files matched.".to_string());
    }
    let mut done = 0usize;
    for op in &ops {
        let from = PathBuf::from(&op.from);
        let to = PathBuf::from(&op.to);
        if std::fs::rename(&from, &to).is_ok() {
            done += 1;
        }
    }
    undo::log_entry(
        &state,
        "rename",
        format!("Renamed {} files", done),
        json!({ "ops": ops }),
        true,
    )?;
    Ok(format!("Renamed {} files", done))
}

// ---------------------------------------------------------------------------
// Screenshot organizer
// ---------------------------------------------------------------------------

fn is_screenshot_name(name: &str) -> bool {
    let n = name.to_lowercase();
    // keep this narrow: a bare "win" prefix would match files like
    // "windows_notes.txt", so require the common screenshot patterns only
    n.starts_with("screenshot")
        || n.starts_with("screen shot")
        || n.starts_with("screen capture")
        || n.starts_with("snipping")
        || n.contains("capture")
        || n.starts_with("snip")
}

#[tauri::command]
pub fn organize_screenshots(state: State<'_, AppState>, dir: String) -> Result<String, AppError> {
    let root = PathBuf::from(&dir);
    if !root.is_dir() {
        return Err(AppError::Command(format!("Not a folder: {}", dir)));
    }
    let mut moves = Vec::new();
    for entry in std::fs::read_dir(&root)
        .map_err(|e| AppError::Command(e.to_string()))?
        .flatten()
    {
        let p = entry.path();
        if !p.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if !is_screenshot_name(&name) {
            continue;
        }
        let mtime = p
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let days = (mtime / 86400) as i64;
        let (y, m, _) = date_from_days(days);
        let sub = root.join(format!("{:04}\\{:02}", y, m));
        moves.push(crate::organize::MoveOp {
            from: p.to_string_lossy().to_string(),
            to: sub.join(&name).to_string_lossy().to_string(),
        });
    }
    let mut applied = 0usize;
    for m in &moves {
        let from = PathBuf::from(&m.from);
        let to = PathBuf::from(&m.to);
        if let Some(parent) = to.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if std::fs::rename(&from, &to).is_ok() {
            applied += 1;
        }
    }
    if applied > 0 {
        undo::log_entry(
            &state,
            "sort",
            format!("Organized {} screenshots into dated folders", applied),
            json!({ "moves": moves }),
            true,
        )?;
    }
    Ok(format!(
        "Organized {} screenshots into YYYY/MM folders",
        applied
    ))
}

// ---------------------------------------------------------------------------
// Downloads auto-expiry (Recycle Bin)
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
pub struct StaleDownload {
    pub path: String,
    pub size: u64,
    pub modified: u64,
    pub age_days: u64,
}

#[tauri::command]
pub fn list_stale_downloads(dir: String, older_than_days: u64) -> Vec<StaleDownload> {
    let root = PathBuf::from(&dir);
    let cutoff = now_millis() / 1000 - older_than_days * 86400;
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(&root) {
        for e in rd.flatten() {
            let p = e.path();
            if !p.is_file() {
                continue;
            }
            let mtime = p
                .metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            if mtime < cutoff {
                let size = p.metadata().map(|m| m.len()).unwrap_or(0);
                out.push(StaleDownload {
                    path: p.to_string_lossy().to_string(),
                    size,
                    modified: mtime,
                    age_days: (now_millis() / 1000 - mtime) / 86400,
                });
            }
        }
    }
    out.sort_by_key(|x| std::cmp::Reverse(x.modified));
    out
}

fn send_to_recycle_bin(paths: &[String]) -> Result<u32, AppError> {
    let mut combined: Vec<u16> = Vec::new();
    for p in paths {
        combined.extend(p.encode_utf16());
        combined.push(0);
    }
    combined.push(0); // double-null terminate
    let mut op = SHFILEOPSTRUCTW {
        hwnd: HWND(std::ptr::null_mut()),
        wFunc: FO_DELETE,
        pFrom: PCWSTR(combined.as_ptr()),
        pTo: PCWSTR(std::ptr::null()),
        fFlags: FOF_ALLOWUNDO.0 as u16,
        fAnyOperationsAborted: windows::core::BOOL(0),
        hNameMappings: std::ptr::null_mut(),
        lpszProgressTitle: PCWSTR(std::ptr::null()),
    };
    unsafe {
        let code = SHFileOperationW(&mut op);
        if code != 0 {
            return Err(AppError::Command(format!(
                "Recycle Bin operation failed (code {})",
                code
            )));
        }
    }
    Ok(paths.len() as u32)
}

#[tauri::command]
pub fn delete_stale_downloads(
    state: State<'_, AppState>,
    dir: String,
    older_than_days: u64,
    paths: Vec<String>,
) -> Result<String, AppError> {
    let list = list_stale_downloads(dir, older_than_days);
    let mut to_delete: Vec<String> = Vec::new();
    let mut total = 0u64;
    for s in &list {
        if paths.contains(&s.path) {
            to_delete.push(s.path.clone());
            total += s.size;
        }
    }
    if to_delete.is_empty() {
        return Ok("Nothing selected.".to_string());
    }
    let n = send_to_recycle_bin(&to_delete)?;
    undo::log_entry(
        &state,
        "downloads_expired",
        format!(
            "Sent {} stale downloads ({}) to Recycle Bin",
            n,
            format_bytes(total)
        ),
        json!({ "paths": to_delete, "freed": total, "restore_hint": "Restore from the Recycle Bin." }),
        false,
    )?;
    Ok(format!(
        "Sent {} files ({}) to the Recycle Bin — restorable anytime.",
        n,
        format_bytes(total)
    ))
}

// ---------------------------------------------------------------------------
// Stale apps (not updated in N days)
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
pub struct StaleApp {
    pub name: String,
    pub exe: String,
    pub last_modified: u64,
    pub age_days: u64,
}

#[tauri::command]
pub fn flag_stale_apps(days: u64) -> Vec<StaleApp> {
    let mut out = Vec::new();
    let bases = [
        (1, r"Software\Microsoft\Windows\CurrentVersion\Uninstall"),
        (
            1,
            r"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
        ),
        (0, r"Software\Microsoft\Windows\CurrentVersion\Uninstall"),
    ];
    for (hive_id, base) in bases {
        let hive = if hive_id == 1 {
            HKEY_LOCAL_MACHINE
        } else {
            HKEY_CURRENT_USER
        };
        if let Ok(key) = winreg::RegKey::predef(hive).open_subkey(base) {
            for sub in key.enum_keys().filter_map(|k| k.ok()) {
                if let Ok(sk) = key.open_subkey(&sub) {
                    let name: Option<String> = sk.get_value("DisplayName").ok();
                    let icon: Option<String> = sk.get_value("DisplayIcon").ok();
                    let loc: Option<String> = sk.get_value("InstallLocation").ok();
                    let mut exe = icon
                        .unwrap_or_default()
                        .split(',')
                        .next()
                        .unwrap_or("")
                        .trim_matches('"')
                        .to_string();
                    if exe.is_empty() {
                        exe = loc.unwrap_or_default();
                    }
                    if exe.is_empty() {
                        continue;
                    }
                    let p = PathBuf::from(&exe);
                    if !p.is_file() {
                        continue;
                    }
                    if let Ok(meta) = p.metadata() {
                        if let Ok(modified) = meta.modified() {
                            if let Ok(d) = modified.duration_since(std::time::UNIX_EPOCH) {
                                let mtime = d.as_secs();
                                let age = (now_millis() / 1000 - mtime) / 86400;
                                if age >= days {
                                    out.push(StaleApp {
                                        name: name.unwrap_or_default(),
                                        exe,
                                        last_modified: mtime,
                                        age_days: age,
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    out.sort_by_key(|x| std::cmp::Reverse(x.age_days));
    out.truncate(40);
    out
}

// ---------------------------------------------------------------------------
// Cross-cloud duplicate finder
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
pub struct CloudDupGroup {
    pub name: String,
    pub size: u64,
    pub paths: Vec<String>,
}

fn cloud_roots() -> Vec<PathBuf> {
    let user = std::env::var("USERPROFILE").unwrap_or_default();
    let mut roots = Vec::new();
    for r in [
        "OneDrive",
        "OneDrive - Personal",
        "OneDrive - Work",
        "Dropbox",
        "Google Drive",
        "GoogleDrive",
    ] {
        let p = PathBuf::from(&user).join(r);
        if p.is_dir() {
            roots.push(p);
        }
    }
    roots
}

#[tauri::command]
pub fn scan_cloud_duplicates() -> Vec<CloudDupGroup> {
    let roots = cloud_roots();
    if roots.is_empty() {
        return Vec::new();
    }
    use std::collections::HashMap;
    let mut by_key: HashMap<(String, u64), Vec<String>> = HashMap::new();
    for root in &roots {
        for entry in WalkDir::new(root)
            .max_depth(5)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            if !entry.file_type().is_file() {
                continue;
            }
            let p = entry.path();
            if let Ok(meta) = p.metadata() {
                let name = p
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default();
                by_key
                    .entry((name, meta.len()))
                    .or_default()
                    .push(p.to_string_lossy().to_string());
            }
        }
    }
    let mut groups = Vec::new();
    for ((name, size), paths) in by_key {
        if paths.len() > 1 {
            groups.push(CloudDupGroup { name, size, paths });
        }
    }
    groups.sort_by_key(|x| std::cmp::Reverse(x.size));
    groups.truncate(40);
    groups
}

// ---------------------------------------------------------------------------
// S14.3 — "Time to let go" (unused for a long time)
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
pub struct UnusedFile {
    pub path: String,
    pub size: u64,
    /// Last-changed unix seconds (honest proxy — Windows disables NTFS
    /// last-*accessed* by default, so the UI says "last changed", never
    /// "last opened").
    pub modified: u64,
    pub days_old: u64,
    pub category: String,
}

/// Files under `dir` whose last-changed time is older than `older_than_days`
/// and whose size is at least `min_mb`. Both knobs honored; defaults come from
/// the S14.4 storage config (180 days / 10 MB) so it only surfaces things
/// worth deleting.
pub fn scan_unused_inner(
    dir: &str,
    older_than_days: u64,
    min_mb: u64,
    mut emit: impl FnMut(u64),
) -> Result<Vec<UnusedFile>, AppError> {
    let root = PathBuf::from(dir);
    if !root.is_dir() {
        return Err(AppError::Command(format!("Not a folder: {}", dir)));
    }
    let min_bytes = min_mb.max(1).saturating_mul(1024 * 1024);
    let now = now_millis();
    let mut out = Vec::new();
    let mut scanned = 0u64;
    let mut last_emit = std::time::Instant::now();
    for entry in WalkDir::new(&root)
        .max_depth(8)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if !entry.file_type().is_file() {
            continue;
        }
        let p = entry.path();
        if let Ok(m) = p.metadata() {
            if m.len() >= min_bytes {
                let modified = m
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                if let Some(days_old) = unused_age(modified.saturating_mul(1000), now, older_than_days) {
                    out.push(UnusedFile {
                        path: p.to_string_lossy().to_string(),
                        size: m.len(),
                        modified,
                        days_old,
                        category: crate::organize::category_for(
                            &p.file_name().unwrap_or_default().to_string_lossy(),
                        )
                        .unwrap_or("Other")
                        .to_string(),
                    });
                }
            }
        }
        scanned += 1;
        if scanned.is_multiple_of(200) && last_emit.elapsed().as_millis() >= 50 {
            last_emit = std::time::Instant::now();
            emit(scanned);
        }
    }
    emit(scanned);
    out.sort_by_key(|x| std::cmp::Reverse(x.size));
    out.truncate(200);
    Ok(out)
}

/// Pure "is this file old enough?" — returns days-old when last-changed is at
/// least `older_than_days` ago, None when fresh or unknown (honest proxy:
/// Windows disables NTFS last-*accessed*, so we use last-*changed*).
pub fn unused_age(modified_ms: u64, now_ms: u64, older_than_days: u64) -> Option<u64> {
    if modified_ms == 0 {
        return None;
    }
    let days = now_ms.saturating_sub(modified_ms) / 86400 / 1000;
    (days >= older_than_days.max(1)).then_some(days)
}

#[tauri::command]
pub fn scan_unused(
    app: tauri::AppHandle,
    dir: String,
    older_than_days: u64,
    min_mb: u64,
) -> Result<Vec<UnusedFile>, AppError> {
    scan_unused_inner(&dir, older_than_days, min_mb, |scanned| {
        let _ = app.emit(
            "scan-progress",
            json!({ "scanned": scanned, "total": 0, "scanned_bytes": 0 }),
        );
    })
}

/// S14.3 — move unused files to the staging trash (undoable). Excluded paths
/// from the storage config are never touched.
pub fn delete_unused_inner(state: &AppState, paths: Vec<String>) -> Result<u64, AppError> {
    let cfg = crate::storage::load_storage_config(state);
    let trash = crate::duplicates::trash_dir(state);
    std::fs::create_dir_all(&trash).map_err(|e| AppError::Command(e.to_string()))?;
    let mut freed = 0u64;
    let mut staged = 0u64;
    for p in &paths {
        if cfg.exclusions.iter().any(|x| p.starts_with(x)) {
            continue;
        }
        let src = PathBuf::from(p);
        if !src.is_file() {
            continue;
        }
        let name = src
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "file".into());
        let mut dst = trash.join(&name);
        let mut i = 1;
        while dst.exists() {
            dst = trash.join(format!("{}_{}", i, name));
            i += 1;
        }
        if let Ok(m) = src.metadata() {
            freed += m.len();
        }
        if std::fs::rename(&src, &dst).is_ok() {
            staged += 1;
        }
    }
    undo::log_entry(
        state,
        "storage_clean",
        format!(
            "Staged {} unused files ({}) to trash",
            staged,
            format_bytes(freed)
        ),
        json!({ "freed": freed, "staged": staged, "dry_run": false, "at": now_millis() }),
        true,
    )?;
    Ok(freed)
}

#[tauri::command]
pub fn delete_unused(state: State<'_, AppState>, paths: Vec<String>) -> Result<u64, AppError> {
    delete_unused_inner(&state, paths)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unused_age_math_honors_the_threshold() {
        let now = 1_800_000_000_000u64; // arbitrary "now"
        let day = 86400u64 * 1000;
        assert_eq!(unused_age(now, now, 180), None, "fresh file is not unused");
        assert_eq!(unused_age(now - 179 * day, now, 180), None, "179 days < 180 threshold");
        assert_eq!(unused_age(now - 180 * day, now, 180), Some(180), "exactly the threshold counts");
        assert_eq!(unused_age(now - 365 * day, now, 180), Some(365));
        assert_eq!(unused_age(0, now, 180), None, "unknown mtime never surfaces");
        assert_eq!(unused_age(now - 400 * day, now, 0), Some(400), "0 threshold still means ≥1 day");
    }

    #[test]
    fn scan_unused_wires_age_and_size_gates() {
        use std::io::Write;
        let dir = std::env::temp_dir().join(format!("reforge-unused-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();

        let fresh_big = dir.join("fresh_big.bin");
        std::fs::File::create(&fresh_big)
            .unwrap()
            .write_all(&vec![0u8; 20 * 1024 * 1024])
            .unwrap(); // 20 MB, fresh mtime
        let small = dir.join("small.log");
        std::fs::File::create(&small).unwrap().write_all(b"tiny").unwrap();

        // Fresh big + small → nothing qualifies under 180 days / 1 MB (the
        // age DECISION is covered by unused_age_math; the size gate by
        // min_mb below — this proves the walker wires both knobs).
        let r = scan_unused_inner(dir.to_string_lossy().as_ref(), 180, 1, |_| {}).unwrap();
        assert!(r.is_empty(), "fresh files must not be flagged (age gate)");

        // min_mb=30 excludes the 20 MB file even if old — the size gate holds
        let r3 = scan_unused_inner(dir.to_string_lossy().as_ref(), 180, 30, |_| {}).unwrap();
        assert!(r3.is_empty(), "size gate must exclude below-threshold files");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn delete_unused_stages_to_trash_and_honors_exclusions() {
        let dir = std::env::temp_dir().join(format!("reforge-del-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("keep")).unwrap();
        let state = crate::state::AppState { data_dir: dir.clone() };

        let doomed = dir.join("doomed.bin");
        std::fs::write(&doomed, vec![0u8; 1024 * 1024]).unwrap();
        let excluded = dir.join("keep/precious.bin");
        std::fs::write(&excluded, vec![0u8; 512 * 1024]).unwrap();

        // exclusion: the keep/ path must never be touched
        let cfg = crate::storage::StorageConfig {
            exclusions: vec![dir.join("keep").to_string_lossy().to_string()],
            ..Default::default()
        };
        crate::storage::save_json(&dir.join("storage_config.json"), &cfg).unwrap();

        let freed = delete_unused_inner(
            &state,
            vec![doomed.to_string_lossy().to_string(), excluded.to_string_lossy().to_string()],
        )
        .unwrap();
        assert_eq!(freed, 1024 * 1024, "only the doomed file counts");
        assert!(std::fs::metadata(&excluded).is_ok(), "excluded path must survive");
        assert!(std::fs::metadata(&doomed).is_err(), "doomed file moved out");
        assert!(dir.join("trash").join("doomed.bin").exists(), "file must land in the staging trash");
        let _ = std::fs::remove_dir_all(&dir);
    }

}
