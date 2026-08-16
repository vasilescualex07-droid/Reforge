use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{Emitter, State};

use crate::error::AppError;
pub fn load_json<T: DeserializeOwned>(path: &Path, default: T) -> T {
    match std::fs::read_to_string(path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or(default),
        Err(_) => default,
    }
}

fn io_err(path: &Path, e: std::io::Error) -> AppError {
    AppError::Io {
        path: path.display().to_string(),
        source: e,
    }
}

pub fn save_json<T: Serialize>(path: &Path, value: &T) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| io_err(path, e))?;
    }
    let s = serde_json::to_string_pretty(value).map_err(|e| AppError::Command(e.to_string()))?;
    std::fs::write(path, s).map_err(|e| io_err(path, e))
}

pub fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Local wall-clock minutes past midnight (0..1440) via GetLocalTime — no
/// chrono dependency. Used by the blue-light schedule and style scheduler
/// (S11), which are wall-clock features.
pub fn local_minutes() -> u32 {
    let st = unsafe { windows::Win32::System::SystemInformation::GetLocalTime() };
    (st.wHour as u32) * 60 + (st.wMinute as u32)
}

/// Local date as YYYY-MM-DD — the once-per-day key for scheduled styles.
pub fn local_date_key() -> String {
    let st = unsafe { windows::Win32::System::SystemInformation::GetLocalTime() };
    format!("{:04}-{:02}-{:02}", st.wYear, st.wMonth, st.wDay)
}

// ---------------------------------------------------------------------------
// S14 — Storage liberation: radar, biggest files, and the storage config.
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
pub struct DriveRadar {
    pub label: String,
    pub mount: String,
    pub total: u64,
    pub free: u64,
    pub used: u64,
    /// Top-level folders by size (reuses organize::scan_storage).
    pub top_level: Vec<crate::organize::FolderSize>,
}

/// Per-drive storage radar. Drive totals come from sysinfo's Disks (already a
/// dependency); each drive's top-level folder sizes come from scan_storage.
#[tauri::command]
pub fn scan_storage_radar() -> Vec<DriveRadar> {
    use sysinfo::Disks;
    let mut out = Vec::new();
    for d in Disks::new_with_refreshed_list().iter() {
        let mount = d.mount_point().to_string_lossy().to_string();
        let total = d.total_space();
        let free = d.available_space();
        if total == 0 {
            continue;
        }
        let top_level = crate::organize::scan_storage(mount.clone(), 6).unwrap_or_default();
        out.push(DriveRadar {
            label: d.name().to_string_lossy().to_string(),
            mount,
            total,
            free,
            used: total.saturating_sub(free),
            top_level,
        });
    }
    out.sort_by_key(|d| std::cmp::Reverse(d.used));
    out
}

#[derive(Serialize, Clone)]
pub struct BiggestFile {
    pub path: String,
    pub size: u64,
    pub modified: u64,
    pub category: String,
}

/// Top-N biggest files under `dir`, honoring a minimum-size gate (bytes).
/// Category = extension group (reuses organize::category_for).
pub fn scan_biggest_files_inner(
    dir: &str,
    top_n: u32,
    min_mb: u64,
    mut emit: impl FnMut(u64),
) -> Result<Vec<BiggestFile>, AppError> {
    let root = PathBuf::from(dir);
    if !root.is_dir() {
        return Err(AppError::Command(format!("Not a folder: {}", dir)));
    }
    let min_bytes = min_mb.saturating_mul(1024 * 1024);
    let mut found: Vec<BiggestFile> = Vec::new();
    let mut scanned = 0u64;
    let mut last_emit = std::time::Instant::now();
    for entry in walkdir::WalkDir::new(&root)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if entry.file_type().is_file() {
            let p = entry.path();
            if let Ok(m) = entry.metadata() {
                if m.len() >= min_bytes {
                    let modified = m
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs())
                        .unwrap_or(0);
                    found.push(BiggestFile {
                        path: p.to_string_lossy().to_string(),
                        size: m.len(),
                        modified,
                        category: crate::organize::category_for(&p.file_name().unwrap_or_default().to_string_lossy())
                            .unwrap_or("Other")
                            .to_string(),
                    });
                }
            }
            scanned += 1;
            if scanned.is_multiple_of(200) && last_emit.elapsed().as_millis() >= 50 {
                last_emit = std::time::Instant::now();
                emit(scanned);
            }
        }
    }
    emit(scanned);
    found.sort_by_key(|f| std::cmp::Reverse(f.size));
    found.truncate(top_n.max(1) as usize);
    Ok(found)
}

#[tauri::command]
pub fn scan_biggest_files(
    app: tauri::AppHandle,
    dir: String,
    top_n: u32,
    min_mb: u64,
) -> Result<Vec<BiggestFile>, AppError> {
    scan_biggest_files_inner(&dir, top_n, min_mb, |scanned| {
        let _ = app.emit(
            "scan-progress",
            serde_json::json!({ "scanned": scanned, "total": 0, "scanned_bytes": 0 }),
        );
    })
}

// ---- S14.4 storage settings ------------------------------------------------

#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct StorageConfig {
    /// S14.3 — unused-scan threshold knobs (default 180 days / 10 MB).
    pub unused_days: u64,
    pub unused_min_mb: u64,
    /// S14.2 — safe-list category toggles (true = eligible for clean_now).
    pub safe_temp: bool,
    pub safe_update_cache: bool,
    pub safe_recycle_bin: bool,
    pub safe_browser_caches: bool,
    pub safe_installers: bool,
    /// S14.4 — paths never touched by any clean.
    pub exclusions: Vec<String>,
    /// Dry-run before delete (default ON).
    pub dry_run: bool,
    /// Auto-clean cadence (off / weekly / monthly).
    pub auto_clean: String,
}

impl Default for StorageConfig {
    fn default() -> Self {
        StorageConfig {
            unused_days: 180,
            unused_min_mb: 10,
            safe_temp: true,
            safe_update_cache: true,
            safe_recycle_bin: true,
            safe_browser_caches: true,
            safe_installers: true,
            exclusions: Vec::new(),
            dry_run: true,
            auto_clean: "off".into(),
        }
    }
}

fn config_path(state: &crate::state::AppState) -> PathBuf {
    state.data_dir.join("storage_config.json")
}

pub fn load_storage_config(state: &crate::state::AppState) -> StorageConfig {
    load_json(&config_path(state), StorageConfig::default())
}

#[tauri::command]
pub fn get_storage_config(state: State<'_, crate::state::AppState>) -> StorageConfig {
    load_storage_config(&state)
}

#[tauri::command]
pub fn set_storage_config(
    state: State<'_, crate::state::AppState>,
    cfg: StorageConfig,
) -> Result<StorageConfig, AppError> {
    save_json(&config_path(&state), &cfg)?;
    Ok(cfg)
}

pub fn format_bytes(bytes: u64) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = KB * 1024.0;
    const GB: f64 = MB * 1024.0;
    let b = bytes as f64;
    if b >= GB {
        format!("{:.1} GB", b / GB)
    } else if b >= MB {
        format!("{:.1} MB", b / MB)
    } else if b >= KB {
        format!("{:.1} KB", b / KB)
    } else {
        format!("{} B", bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_bytes() {
        assert_eq!(format_bytes(0), "0 B");
        assert_eq!(format_bytes(1023), "1023 B");
        assert_eq!(format_bytes(1024), "1.0 KB");
        assert_eq!(format_bytes(5 * 1024 * 1024), "5.0 MB");
        assert_eq!(format_bytes(2 * 1024 * 1024 * 1024), "2.0 GB");
    }

    #[test]
    fn json_roundtrip() {
        let dir = std::env::temp_dir().join(format!("reforge-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("t.json");
        save_json(&p, &vec![1u32, 2, 3]).unwrap();
        let back: Vec<u32> = load_json(&p, Vec::new());
        assert_eq!(back, vec![1, 2, 3]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn storage_config_defaults_are_sane() {
        let c = StorageConfig::default();
        assert_eq!(c.unused_days, 180);
        assert_eq!(c.unused_min_mb, 10);
        assert!(c.dry_run, "dry-run must default ON — never delete blind");
        assert_eq!(c.auto_clean, "off");
    }

    #[test]
    fn storage_config_roundtrips_through_json() {
        let dir = std::env::temp_dir().join(format!("reforge-scfg-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let state = crate::state::AppState { data_dir: dir.clone() };
        let cfg = StorageConfig {
            unused_days: 90,
            auto_clean: "weekly".into(),
            exclusions: vec![r"C:\Games".into()],
            ..Default::default()
        };
        let path = dir.join("storage_config.json");
        save_json(&path, &cfg).unwrap();
        let back = load_json(&path, StorageConfig::default());
        assert_eq!(back.unused_days, 90);
        assert_eq!(back.auto_clean, "weekly");
        assert_eq!(back.exclusions, vec![r"C:\Games"]);
        let _ = std::fs::remove_dir_all(&dir);
        let _ = state;
    }

    #[test]
    fn biggest_files_honor_size_gate_top_n_and_category() {
        use std::io::Write;
        let dir = std::env::temp_dir().join(format!("reforge-biggest-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        let mk = |name: &str, bytes: u64| {
            let p = dir.join(name);
            let mut f = std::fs::File::create(&p).unwrap();
            f.write_all(&vec![0u8; bytes as usize]).unwrap();
        };
        mk("big.mp4", 5 * 1024 * 1024); // 5 MB video
        mk("small.txt", 1024); // 1 KB — below the 1 MB gate
        mk("sub/medium.zip", 2 * 1024 * 1024); // 2 MB archive

        let found = scan_biggest_files_inner(dir.to_string_lossy().as_ref(), 10, 1, |_| {}).unwrap();
        assert_eq!(found.len(), 2, "the 1 KB file must be gated out");
        assert_eq!(found[0].path, dir.join("big.mp4").to_string_lossy());
        assert_eq!(found[0].size, 5 * 1024 * 1024);
        assert_eq!(found[0].category, "Videos");
        assert_eq!(found[1].category, "Archives");

        // top_n truncation
        let top1 = scan_biggest_files_inner(dir.to_string_lossy().as_ref(), 1, 1, |_| {}).unwrap();
        assert_eq!(top1.len(), 1);
        assert!(top1[0].path.ends_with("big.mp4"));

        let _ = std::fs::remove_dir_all(&dir);
    }
}
