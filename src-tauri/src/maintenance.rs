use crate::duplicates;
use crate::state::AppState;
use crate::storage::{load_json, now_millis, save_json};
use crate::{cleanup, organize};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::error::AppError;
#[derive(Serialize, Deserialize, Clone)]
pub struct MaintenanceReport {
    pub ts: u64,
    pub junk_bytes: u64,
    pub junk_items: usize,
    pub duplicate_bytes: u64,
    pub duplicate_files: usize,
    pub storage_top: Vec<organize::FolderSize>,
    /// S11.4 — heavy startup entries (impact ≥ 7) caught by the audit.
    #[serde(default)]
    pub startup_heavy: usize,
    pub notes: Vec<String>,
}

fn reports_dir(state: &AppState) -> std::path::PathBuf {
    state.data_dir.join("reports")
}

#[derive(Serialize)]
pub struct UserFolder {
    pub label: String,
    pub path: String,
    pub exists: bool,
}

/// Well-known user folders for whole-PC sweeps (Makeover Session, A1.6/C5).
/// Only folders that exist are candidates for scanning; the frontend uses the
/// paths as-is for scan_duplicates, so no path is ever constructed blindly.
#[tauri::command]
pub fn get_user_folders() -> Vec<UserFolder> {
    let home = dirs::home_dir().unwrap_or_default();
    let home_str = home.to_string_lossy().to_string();
    let mut out = vec![UserFolder {
        label: "Home".into(),
        path: home_str.clone(),
        exists: home.is_dir(),
    }];
    for base in ["Desktop", "Documents", "Downloads", "Pictures", "OneDrive"] {
        let d = home.join(base);
        out.push(UserFolder {
            label: base.into(),
            path: d.to_string_lossy().to_string(),
            exists: d.is_dir(),
        });
    }
    out
}

#[tauri::command]
pub fn run_maintenance(state: State<'_, AppState>) -> Result<MaintenanceReport, AppError> {
    let mut notes = Vec::new();

    // 1. junk scan (dry-run — never deletes)
    let junk = cleanup::scan_junk();
    notes.push(format!(
        "Found {} of junk across {} areas (nothing deleted — clean from Tune-up).",
        crate::storage::format_bytes(junk.total_bytes),
        junk.items.len()
    ));

    // 2. storage snapshot of the user profile
    let home = dirs::home_dir().unwrap_or_default();
    let storage_top = if home.is_dir() {
        organize::scan_storage(home.to_string_lossy().to_string(), 10).unwrap_or_default()
    } else {
        Vec::new()
    };

    // 2b. startup audit — how many heavy auto-start entries are slowing boot?
    let startup_heavy = crate::startup::list_startup()
        .into_iter()
        .filter(|e| e.impact >= 7)
        .count();
    if startup_heavy > 0 {
        notes.push(format!(
            "{} heavy startup entr{} (impact ≥ 7) — review in Tune-up → Startup.",
            startup_heavy,
            if startup_heavy == 1 { "y" } else { "ies" }
        ));
    }

    // 3. quick duplicate sweep of Desktop + Downloads + Documents
    let mut dup_bytes = 0u64;
    let mut dup_files = 0usize;
    let home = dirs::home_dir().unwrap_or_default();
    for base in ["Desktop", "Downloads", "Documents"] {
        let d = home.join(base);
        if d.is_dir() {
            if let Ok(scan) =
                duplicates::scan_duplicates_silent(d.to_string_lossy().to_string(), 20)
            {
                dup_bytes += scan.total_wasted;
                dup_files += scan.groups.len();
            }
        }
    }
    notes.push(format!(
        "Duplicate sweep found {} wasted across {} groups (Desktop/Downloads/Documents).",
        crate::storage::format_bytes(dup_bytes),
        dup_files
    ));

    let report = MaintenanceReport {
        ts: now_millis(),
        junk_bytes: junk.total_bytes,
        junk_items: junk.items.len(),
        duplicate_bytes: dup_bytes,
        duplicate_files: dup_files,
        storage_top,
        startup_heavy,
        notes,
    };

    std::fs::create_dir_all(reports_dir(&state)).map_err(|e| AppError::Command(e.to_string()))?;
    let path = reports_dir(&state).join(format!("{}.json", report.ts));
    save_json(&path, &report)?;

    // keep only the 10 most recent reports
    let mut files: Vec<_> = std::fs::read_dir(reports_dir(&state))
        .map(|rd| {
            rd.flatten()
                .filter_map(|e| e.path().extension().map(|_| e.path()))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    files.sort();
    while files.len() > 10 {
        if let Some(old) = files.first() {
            let _ = std::fs::remove_file(old);
            files.remove(0);
        }
    }

    // fun widgets — maintenance runs are real completion events too
    let _ = crate::fun::note_completion(&state, "maintenance");

    Ok(report)
}

#[tauri::command]
pub fn list_reports(state: State<'_, AppState>) -> Vec<MaintenanceReport> {
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(reports_dir(&state)) {
        for e in rd.flatten() {
            let p = e.path();
            if p.extension().map(|x| x == "json").unwrap_or(false) {
                if let Ok(s) = std::fs::read_to_string(&p) {
                    if let Ok(r) = serde_json::from_str::<MaintenanceReport>(&s) {
                        out.push(r);
                    }
                }
            }
        }
    }
    out.sort_by_key(|r| r.ts);
    out.reverse();
    out
}

/// S11.4 — archive a report: move it out of the active list into
/// `reports/archive/` so History's report cards stay focused on what's
/// actionable. Archived reports are never deleted without user action.
#[tauri::command]
pub fn archive_report(state: State<'_, AppState>, ts: u64) -> Result<String, AppError> {
    let src = reports_dir(&state).join(format!("{}.json", ts));
    if !src.exists() {
        return Err(AppError::Command("Report not found".into()));
    }
    let archive = reports_dir(&state).join("archive");
    std::fs::create_dir_all(&archive).map_err(|e| AppError::Io {
        path: archive.display().to_string(),
        source: e,
    })?;
    std::fs::rename(&src, archive.join(format!("{}.json", ts))).map_err(|e| AppError::Io {
        path: src.display().to_string(),
        source: e,
    })?;
    Ok("Report archived".into())
}

// silence unused warning if load_json unused in some cfgs
#[allow(dead_code)]
fn _unused(state: &AppState) {
    let _ = load_json::<Vec<u8>>(&state.data_dir.join("_"), Vec::new());
}
