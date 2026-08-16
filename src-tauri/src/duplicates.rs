use crate::state::AppState;
use crate::storage::format_bytes;
use crate::undo;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use tauri::State;
use walkdir::WalkDir;

use crate::error::AppError;
#[derive(Serialize, Clone)]
pub struct DuplicateGroup {
    pub id: String,
    pub name: String,
    pub size: u64,
    pub files: Vec<DuplicateFile>,
}

#[derive(Serialize, Clone)]
pub struct DuplicateFile {
    pub path: String,
    pub modified: u64,
}

#[derive(Serialize)]
pub struct DuplicateScan {
    pub groups: Vec<DuplicateGroup>,
    pub total_wasted: u64,
    pub scanned_bytes: u64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct MovedFile {
    pub from: String,
    pub to: String,
}

pub(crate) fn trash_dir(state: &AppState) -> PathBuf {
    state.data_dir.join("trash")
}

fn file_hash(path: &Path) -> Option<u64> {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    match std::fs::File::open(path) {
        Ok(mut f) => {
            let mut buf = [0u8; 64 * 1024];
            loop {
                match std::io::Read::read(&mut f, &mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        buf[..n].hash(&mut hasher);
                    }
                    Err(_) => return None,
                }
            }
            Some(hasher.finish())
        }
        Err(_) => None,
    }
}

fn quick_hash(path: &Path) -> Option<u64> {
    // hash of size + first 64KB + last 64KB — cheap pre-filter
    let meta = std::fs::metadata(path).ok()?;
    if !meta.is_file() {
        return None;
    }
    let len = meta.len();
    let mut f = std::fs::File::open(path).ok()?;
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    len.hash(&mut hasher);
    let mut buf = vec![0u8; 65536];
    let n = std::io::Read::read(&mut f, &mut buf).ok()?;
    buf[..n].hash(&mut hasher);
    if len > 131072 {
        use std::io::{Read, Seek, SeekFrom};
        let _ = f.seek(SeekFrom::End(-65536));
        let n = Read::read(&mut f, &mut buf).ok()?;
        buf[..n].hash(&mut hasher);
    }
    Some(hasher.finish())
}

#[tauri::command]
pub async fn scan_duplicates(
    app: tauri::AppHandle,
    dir: String,
    min_size_mb: Option<u64>,
) -> Result<DuplicateScan, AppError> {
    let root = PathBuf::from(&dir);
    if !root.is_dir() {
        return Err(AppError::Command(format!("Not a folder: {}", dir)));
    }
    // count files up front so the progress events carry a real denominator
    let total = WalkDir::new(&root)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .count();
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        scan_duplicates_impl(Some(&app), &root, min_size_mb, total)
    })
    .await
    .map_err(|e| AppError::Command(format!("scan aborted: {}", e)))?
}

/// Non-UI sweep (maintenance runs this in the background with no AppHandle,
/// so no progress events — same scan logic, silent).
pub fn scan_duplicates_silent(dir: String, min_size_mb: u64) -> Result<DuplicateScan, AppError> {
    let root = PathBuf::from(&dir);
    if !root.is_dir() {
        return Err(AppError::Command(format!("Not a folder: {}", dir)));
    }
    let total = WalkDir::new(&root)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .count();
    scan_duplicates_impl(None, &root, Some(min_size_mb), total)
}

/// The actual scan — runs on a blocking thread so a huge folder never freezes
/// the UI, emitting `scan-progress` { scanned, total, scanned_bytes } events
/// (throttled to ~20/s) that the Organize view renders as a live progress bar.
fn scan_duplicates_impl(
    app: Option<&tauri::AppHandle>,
    root: &Path,
    min_size_mb: Option<u64>,
    total: usize,
) -> Result<DuplicateScan, AppError> {
    use tauri::Emitter;
    let min_bytes = min_size_mb.unwrap_or(1) * 1024 * 1024;

    let mut by_key: HashMap<(u64, u64), Vec<PathBuf>> = HashMap::new();
    let mut scanned_bytes = 0u64;
    let mut scanned = 0usize;
    let mut last_emit = std::time::Instant::now();

    for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if entry.file_type().is_file() {
            scanned += 1;
            if let Ok(m) = entry.metadata() {
                let len = m.len();
                if len >= min_bytes {
                    scanned_bytes += len;
                    if let Some(h) = quick_hash(entry.path()) {
                        by_key
                            .entry((len, h))
                            .or_default()
                            .push(entry.path().to_path_buf());
                    }
                }
            }
            if scanned.is_multiple_of(25) && last_emit.elapsed().as_millis() >= 50 {
                last_emit = std::time::Instant::now();
                if let Some(app) = app {
                    let _ = app.emit(
                        "scan-progress",
                        json!({ "scanned": scanned, "total": total, "scanned_bytes": scanned_bytes }),
                    );
                }
            }
        }
    }
    if let Some(app) = app {
        let _ = app.emit(
            "scan-progress",
            json!({ "scanned": total, "total": total, "scanned_bytes": scanned_bytes }),
        );
    }

    let mut groups = Vec::new();
    let mut total_wasted = 0u64;
    for (key, mut paths) in by_key {
        paths.sort();
        if paths.len() < 2 {
            continue;
        }
        // confirm with full hash
        let mut confirmed: Vec<PathBuf> = Vec::new();
        let mut seen: HashMap<u64, PathBuf> = HashMap::new();
        for p in paths {
            if let Some(h) = file_hash(&p) {
                if let Some(first) = seen.get(&h) {
                    let _ = first;
                    confirmed.push(p);
                } else {
                    seen.insert(h, p);
                }
            }
        }
        if confirmed.is_empty() {
            continue;
        }
        // group = first file + all confirmed duplicates of it
        let first = seen.into_values().next().unwrap_or_default();
        let mut files: Vec<DuplicateFile> = confirmed
            .into_iter()
            .map(|p| {
                let modified = std::fs::metadata(&p)
                    .and_then(|m| m.modified())
                    .map(|t| {
                        t.duration_since(std::time::UNIX_EPOCH)
                            .map(|d| d.as_secs())
                            .unwrap_or(0)
                    })
                    .unwrap_or(0);
                DuplicateFile {
                    path: p.to_string_lossy().to_string(),
                    modified,
                }
            })
            .collect();
        files.sort_by_key(|f| f.path.clone());
        let size = key.0;
        total_wasted += size * files.len() as u64;
        groups.push(DuplicateGroup {
            id: format!("dup-{}", key.1),
            name: first
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default(),
            size,
            files,
        });
    }

    groups.sort_by_key(|x| std::cmp::Reverse(x.size));
    Ok(DuplicateScan {
        groups,
        total_wasted,
        scanned_bytes,
    })
}

#[tauri::command]
pub fn remove_duplicates(
    state: State<'_, AppState>,
    paths: Vec<String>,
) -> Result<String, AppError> {
    let trash = trash_dir(&state);
    std::fs::create_dir_all(&trash).map_err(|e| AppError::Command(e.to_string()))?;
    let mut moved = Vec::new();
    let mut moved_bytes = 0u64;
    for p in &paths {
        let src = PathBuf::from(p);
        if !src.is_file() {
            continue;
        }
        let name = src
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "file".into());
        // avoid collisions in trash
        let mut dst = trash.join(&name);
        let mut i = 1;
        while dst.exists() {
            dst = trash.join(format!("{}_{}", i, name));
            i += 1;
        }
        if let Ok(m) = src.metadata() {
            moved_bytes += m.len();
        }
        match std::fs::rename(&src, &dst) {
            Ok(_) => moved.push(MovedFile {
                from: p.clone(),
                to: dst.to_string_lossy().to_string(),
            }),
            Err(_) => {
                // file may be locked; try copy+delete semantics via remove fallback? just report
                let _ = p;
            }
        }
    }
    undo::log_entry(
        &state,
        "duplicates_removed",
        format!(
            "Moved {} duplicate files ({}) to staging trash",
            moved.len(),
            format_bytes(moved_bytes)
        ),
        json!({ "moved": moved }),
        true,
    )?;
    Ok(format!(
        "Moved {} files to staging trash (reversible)",
        moved.len()
    ))
}

#[tauri::command]
pub fn empty_trash(state: State<'_, AppState>) -> Result<String, AppError> {
    let trash = trash_dir(&state);
    if !trash.exists() {
        return Ok("Trash is empty".into());
    }
    let mut freed = 0u64;
    for entry in WalkDir::new(&trash).into_iter().filter_map(|e| e.ok()) {
        if entry.file_type().is_file() {
            if let Ok(m) = entry.metadata() {
                freed += m.len();
            }
        }
    }
    std::fs::remove_dir_all(&trash).map_err(|e| AppError::Command(e.to_string()))?;
    std::fs::create_dir_all(&trash).map_err(|e| AppError::Command(e.to_string()))?;
    undo::log_entry(
        &state,
        "trash_emptied",
        format!(
            "Permanently deleted {} of staged duplicates",
            format_bytes(freed)
        ),
        json!({ "freed": freed }),
        false,
    )?;
    Ok(format!(
        "Emptied staging trash — freed {}",
        format_bytes(freed)
    ))
}

#[tauri::command]
pub fn trash_size(state: State<'_, AppState>) -> u64 {
    let trash = trash_dir(&state);
    let mut total = 0u64;
    if trash.exists() {
        for entry in WalkDir::new(&trash).into_iter().filter_map(|e| e.ok()) {
            if entry.file_type().is_file() {
                if let Ok(m) = entry.metadata() {
                    total += m.len();
                }
            }
        }
    }
    total
}

// undo support: restore moved duplicates
pub fn restore_moved(state: &AppState, moved: &[MovedFile]) -> Result<(), AppError> {
    for m in moved {
        let to = PathBuf::from(&m.to);
        let from = PathBuf::from(&m.from);
        if to.exists() {
            if let Some(parent) = from.parent() {
                std::fs::create_dir_all(parent).map_err(|e| AppError::Command(e.to_string()))?;
            }
            let _ = std::fs::rename(&to, &from);
        }
    }
    let _ = state;
    Ok(())
}
