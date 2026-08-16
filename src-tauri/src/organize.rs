use crate::state::AppState;
use crate::storage::format_bytes;
use crate::undo;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::{Path, PathBuf};
use tauri::State;
use walkdir::WalkDir;

use crate::error::AppError;
#[derive(Serialize, Deserialize, Clone)]
pub struct FolderSize {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub file_count: u64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct MoveOp {
    pub from: String,
    pub to: String,
}

fn dir_size(path: &Path) -> (u64, u64) {
    let mut size = 0u64;
    let mut count = 0u64;
    for entry in WalkDir::new(path)
        .max_depth(8)
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

#[tauri::command]
pub fn scan_storage(dir: String, top_n: u32) -> Result<Vec<FolderSize>, AppError> {
    let root = PathBuf::from(&dir);
    if !root.is_dir() {
        return Err(AppError::Command(format!("Not a folder: {}", dir)));
    }
    let mut items = Vec::new();
    if let Ok(rd) = std::fs::read_dir(&root) {
        for e in rd.flatten() {
            if e.path().is_dir() {
                let (size, count) = dir_size(&e.path());
                if size > 0 {
                    items.push(FolderSize {
                        name: e.file_name().to_string_lossy().to_string(),
                        path: e.path().to_string_lossy().to_string(),
                        size,
                        file_count: count,
                    });
                }
            }
        }
    }
    items.sort_by_key(|x| std::cmp::Reverse(x.size));
    items.truncate(top_n as usize);
    Ok(items)
}

/// Exact YYYY-MM bucket for a file mtime, using real civil-date math
/// (reuses the shared days-to-date conversion in files.rs).
pub fn month_year(mtime: u64) -> (u64, u32) {
    let days = (mtime / 86400) as i64;
    let (y, m, _) = crate::files::date_from_days(days);
    (y as u64, m as u32)
}

/// Extension-group category for a file name (S14.1 radar reuses this).
pub fn category_for(name: &str) -> Option<&'static str> {
    let ext = name.rsplit('.').next()?.to_lowercase();
    match ext.as_str() {
        "jpg" | "jpeg" | "png" | "gif" | "bmp" | "webp" | "svg" | "heic" | "tiff" | "ico" => {
            Some("Images")
        }
        "mp4" | "mkv" | "avi" | "mov" | "wmv" | "webm" | "flv" | "m4v" => Some("Videos"),
        "mp3" | "wav" | "flac" | "aac" | "ogg" | "m4a" | "wma" => Some("Audio"),
        "zip" | "rar" | "7z" | "tar" | "gz" | "bz2" | "xz" | "iso" => Some("Archives"),
        "doc" | "docx" | "pdf" | "txt" | "md" | "rtf" | "odt" | "xls" | "xlsx" | "ppt" | "pptx"
        | "csv" | "json" | "xml" => Some("Documents"),
        _ => None,
    }
}

fn plan_moves(root: &Path, mode: &str) -> Vec<MoveOp> {
    let mut moves = Vec::new();
    if let Ok(rd) = std::fs::read_dir(root) {
        for e in rd.flatten() {
            let p = e.path();
            if !p.is_file() {
                continue;
            }
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            let sub = match mode {
                "type" => category_for(&name).unwrap_or("Other").to_string(),
                "date" => {
                    let mtime = p
                        .metadata()
                        .and_then(|m| m.modified())
                        .ok()
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs())
                        .unwrap_or(0);
                    format!("{:04}-{:02}", month_year(mtime).0, month_year(mtime).1)
                }
                _ => continue,
            };
            let dst_dir = root.join(&sub);
            let mut dst = dst_dir.join(&name);
            if dst.exists() {
                let stem = p
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_else(|| "file".into());
                let ext = p
                    .extension()
                    .map(|x| format!(".{}", x.to_string_lossy()))
                    .unwrap_or_default();
                let mut i = 1;
                loop {
                    dst = dst_dir.join(format!("{}_{}{}", stem, i, ext));
                    if !dst.exists() {
                        break;
                    }
                    i += 1;
                }
            }
            if dst != p {
                moves.push(MoveOp {
                    from: p.to_string_lossy().to_string(),
                    to: dst.to_string_lossy().to_string(),
                });
            }
        }
    }
    moves
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn date_buckets_are_calendar_accurate() {
        // 2023-11-15T00:00:00Z
        let nov_2023 = 1_700_006_400;
        // 2024-08-15T00:00:00Z
        let aug_2024 = 1_723_680_000;
        // 2025-01-01T00:00:00Z
        let jan_2025 = 1_737_000_000;
        assert_eq!(month_year(nov_2023), (2023, 11));
        assert_eq!(month_year(aug_2024), (2024, 8));
        assert_eq!(month_year(jan_2025), (2025, 1));
    }
}

#[tauri::command]
pub fn preview_sort(dir: String, mode: String) -> Result<Vec<MoveOp>, AppError> {
    let root = PathBuf::from(&dir);
    if !root.is_dir() {
        return Err(AppError::Command(format!("Not a folder: {}", dir)));
    }
    Ok(plan_moves(&root, &mode))
}

#[tauri::command]
pub fn apply_sort(
    state: State<'_, AppState>,
    dir: String,
    mode: String,
) -> Result<String, AppError> {
    let root = PathBuf::from(&dir);
    if !root.is_dir() {
        return Err(AppError::Command(format!("Not a folder: {}", dir)));
    }
    let plan = plan_moves(&root, &mode);
    let mut applied = 0usize;
    let mut bytes = 0u64;
    for m in &plan {
        let from = PathBuf::from(&m.from);
        let to = PathBuf::from(&m.to);
        if let Some(parent) = to.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(meta) = from.metadata() {
            bytes += meta.len();
        }
        if std::fs::rename(&from, &to).is_ok() {
            applied += 1;
        }
    }
    undo::log_entry(
        &state,
        "sort",
        format!(
            "Auto-sorted {} files ({}) by {}",
            applied,
            format_bytes(bytes),
            mode
        ),
        json!({ "moves": plan }),
        true,
    )?;
    Ok(format!("Sorted {} files into folders by {}", applied, mode))
}
