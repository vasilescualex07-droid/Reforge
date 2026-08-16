//! S14.6 — The bonus saves. Real commands, no placeholders:
//!   - Recycle Bin size display + empty (with confirm)
//!   - Windows.old detection (admin, size + honest note)
//!   - Hibernation / pagefile size notes
//!   - Big-duplicate groups (>500 MB) flagged from the existing duplicate scan
//!
//! Honesty: every number here is measured live at call time. Windows.old is
//! only reported when it exists; hiberfil/pagefile are reported when present.

use crate::state::AppState;
use crate::storage::format_bytes;
use serde::Serialize;
use tauri::State;

use crate::error::AppError;

#[derive(Serialize, Clone)]
pub struct RecycleBinState {
    pub size: u64,
    pub empty: bool,
}

/// Current Recycle Bin size + whether it's already empty.
#[tauri::command]
pub fn recycle_bin_state() -> RecycleBinState {
    let size = crate::cleanup::recycle_bin_size().unwrap_or(0);
    RecycleBinState {
        size,
        empty: size == 0,
    }
}

/// Empty the Windows Recycle Bin (confirm happens in the UI; there is no undo
/// for the OS Recycle Bin, so the frontend always confirms first).
#[tauri::command]
pub fn empty_recycle_bin(state: State<'_, AppState>) -> Result<String, AppError> {
    let size = crate::cleanup::recycle_bin_size().unwrap_or(0);
    crate::cleanup::empty_recycle_bin()?;
    crate::undo::log_entry(
        &state,
        "storage_clean",
        format!("Emptied the Recycle Bin (freed {})", format_bytes(size)),
        serde_json::json!({ "freed": size, "at": crate::storage::now_millis() }),
        false,
    )?;
    Ok(format!("Recycle Bin emptied — freed {}", format_bytes(size)))
}

#[derive(Serialize, Clone)]
pub struct WindowsOldInfo {
    pub exists: bool,
    pub size: u64,
    /// Honest note: deleting Windows.old is a one-way door (no undo), and it
    /// may be the only copy of files from the previous Windows install.
    pub note: String,
}

/// Windows.old detection — present only when a previous Windows install was
/// left behind. Size is real; the note is the honest warning.
#[tauri::command]
pub fn windows_old_info() -> WindowsOldInfo {
    let p = std::path::PathBuf::from(r"C:\Windows.old");
    if !p.is_dir() {
        return WindowsOldInfo {
            exists: false,
            size: 0,
            note: "No previous Windows install found".into(),
        };
    }
    let size = crate::organize::scan_storage(r"C:\Windows.old".into(), 1)
        .ok()
        .and_then(|v| v.first().map(|f| f.size))
        .unwrap_or(0);
    WindowsOldInfo {
        exists: true,
        size,
        note: "Files from your previous Windows install. Removing it is permanent and can't be undone — keep it until you're sure nothing you need is inside.".into(),
    }
}

#[derive(Serialize, Clone)]
pub struct SwapFileInfo {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub note: String,
}

/// hiberfil.sys / pagefile.sys sizes — real, and only when present. Deleting
/// them isn't offered (they're managed by Windows); this is a size note.
#[tauri::command]
pub fn swap_file_sizes() -> Vec<SwapFileInfo> {
    let mut out = Vec::new();
    for (name, note) in [
        ("hiberfil.sys", "Used by Hibernate / Fast Startup. Managed by Windows — disable hibernation in Power settings to remove it."),
        ("pagefile.sys", "The virtual-memory page file. Managed by Windows — disable it only via Advanced system settings."),
    ] {
        let p = std::path::PathBuf::from(format!(r"C:\{}", name));
        if let Ok(m) = p.metadata() {
            out.push(SwapFileInfo {
                name: name.into(),
                path: p.to_string_lossy().to_string(),
                size: m.len(),
                note: note.into(),
            });
        }
    }
    out
}

#[derive(Serialize, Clone)]
pub struct BigDupeGroup {
    pub id: String,
    pub wasted_bytes: u64,
    pub file_count: usize,
    pub sample_paths: Vec<String>,
}

/// Big-duplicate groups (≥ `min_mb` wasted) flagged from the existing
/// duplicate scanner — the "dupes eating a whole drive" finder.
#[tauri::command]
pub fn big_dupe_groups(_state: State<'_, AppState>, min_mb: u64) -> Vec<BigDupeGroup> {
    let min = min_mb.max(1).saturating_mul(1024 * 1024);
    let home = dirs::home_dir().unwrap_or_default();
    let dir = home.to_string_lossy().to_string();
    let scan = match crate::duplicates::scan_duplicates_silent(dir, 1) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let mut out = Vec::new();
    for g in &scan.groups {
        // per-group wasted = (n-1) copies of the same file
        let wasted = g.size.saturating_mul(g.files.len().saturating_sub(1) as u64);
        if wasted >= min {
            out.push(BigDupeGroup {
                id: g.id.clone(),
                wasted_bytes: wasted,
                file_count: g.files.len(),
                sample_paths: g.files.iter().take(3).map(|f| f.path.clone()).collect(),
            });
        }
    }
    out.sort_by_key(|g| std::cmp::Reverse(g.wasted_bytes));
    out.truncate(10);
    out
}
