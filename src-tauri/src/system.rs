use crate::state::AppState;
use crate::{startup, undo};
use serde::Serialize;
use sysinfo::{Disks, System};
use tauri::State;

#[derive(Serialize)]
pub struct DiskInfo {
    pub name: String,
    pub mount: String,
    pub total: u64,
    pub free: u64,
    pub free_pct: f32,
}

#[derive(Serialize)]
pub struct ProcInfo {
    pub name: String,
    pub mem_mb: u64,
    pub cpu_pct: f32,
}

#[derive(Serialize)]
pub struct SystemInfo {
    pub cpu_name: String,
    pub cpu_count: usize,
    pub cpu_usage_pct: f32,
    pub ram_total: u64,
    pub ram_used: u64,
    pub ram_free_pct: f32,
    pub os: String,
    pub host: String,
    pub disks: Vec<DiskInfo>,
    pub top_processes: Vec<ProcInfo>,
}

#[derive(Serialize)]
pub struct ScorePart {
    pub label: String,
    pub points: u8,
    pub max: u8,
}

#[derive(Serialize)]
pub struct HealthScore {
    pub score: u8,
    pub disk_free_pct: f32,
    pub ram_free_pct: f32,
    pub startup_count: usize,
    pub last_cleanup_ts: Option<u64>,
    pub breakdown: Vec<ScorePart>,
}

/// S1.2 — build provenance baked by build.rs at compile time. The frontend
/// shows it in Settings → About and uses it to flag a stale exe instead of
/// letting users run an old binary blindly.
#[derive(Serialize)]
pub struct BuildInfo {
    pub build_ts: Option<i64>,
    pub git_hash: Option<String>,
    pub exe_path: Option<String>,
}

#[tauri::command]
pub fn get_build_info() -> BuildInfo {
    BuildInfo {
        build_ts: option_env!("REFORGE_BUILD_TS").and_then(|s| s.parse().ok()),
        git_hash: option_env!("REFORGE_GIT_HASH").map(|s| s.to_string()),
        exe_path: std::env::current_exe()
            .ok()
            .map(|p| p.to_string_lossy().to_string()),
    }
}

#[tauri::command]
pub fn get_system_info() -> SystemInfo {
    let mut sys = System::new_all();
    sys.refresh_all();

    let cpu_usage = sys.global_cpu_usage();
    let total = sys.total_memory();
    let used = sys.used_memory();
    let free_pct = if total > 0 {
        (total.saturating_sub(used)) as f32 / total as f32 * 100.0
    } else {
        0.0
    };

    let cpu_name = sys
        .cpus()
        .first()
        .map(|c| c.brand().to_string())
        .unwrap_or_default();
    let os = System::long_os_version().unwrap_or_default();
    let host = System::host_name().unwrap_or_default();

    let disks: Vec<DiskInfo> = Disks::new_with_refreshed_list()
        .iter()
        .map(|d| {
            let free = d.available_space();
            let total = d.total_space();
            DiskInfo {
                name: d.name().to_string_lossy().to_string(),
                mount: d.mount_point().to_string_lossy().to_string(),
                total,
                free,
                free_pct: if total > 0 {
                    free as f32 / total as f32 * 100.0
                } else {
                    0.0
                },
            }
        })
        .collect();

    let mut procs: Vec<ProcInfo> = sys
        .processes()
        .values()
        .map(|p| ProcInfo {
            name: p.name().to_string_lossy().to_string(),
            mem_mb: p.memory() / 1024 / 1024,
            cpu_pct: p.cpu_usage(),
        })
        .collect();
    procs.sort_by_key(|x| std::cmp::Reverse(x.mem_mb));
    procs.truncate(8);

    SystemInfo {
        cpu_name,
        cpu_count: sys.cpus().len(),
        cpu_usage_pct: cpu_usage,
        ram_total: total,
        ram_used: used,
        ram_free_pct: free_pct,
        os,
        host,
        disks,
        top_processes: procs,
    }
}

fn clamp_pts(v: f32, lo: f32, hi: f32, max: u8) -> u8 {
    if v <= lo {
        return 0;
    }
    if v >= hi {
        return max;
    }
    ((v - lo) / (hi - lo) * max as f32) as u8
}

#[tauri::command]
pub fn get_health_score(state: State<'_, AppState>) -> HealthScore {
    let mut sys = System::new_all();
    sys.refresh_memory();
    let total = sys.total_memory();
    let used = sys.used_memory();
    let ram_free_pct = if total > 0 {
        (total.saturating_sub(used)) as f32 / total as f32 * 100.0
    } else {
        0.0
    };

    let disks: Vec<DiskInfo> = Disks::new_with_refreshed_list()
        .iter()
        .map(|d| {
            let free = d.available_space();
            let total = d.total_space();
            DiskInfo {
                name: d.name().to_string_lossy().to_string(),
                mount: d.mount_point().to_string_lossy().to_string(),
                total,
                free,
                free_pct: if total > 0 {
                    free as f32 / total as f32 * 100.0
                } else {
                    0.0
                },
            }
        })
        .collect();
    // Score only disks with meaningful capacity — tiny recovery / OEM
    // partitions that sit nearly full shouldn't tank the health score.
    let big_disks: Vec<&DiskInfo> = disks
        .iter()
        .filter(|d| d.total >= 10 * 1024 * 1024 * 1024)
        .collect();
    let scored: Vec<&DiskInfo> = if big_disks.is_empty() {
        disks.iter().collect()
    } else {
        big_disks
    };
    let disk_free_pct = scored
        .iter()
        .map(|d| d.free_pct)
        .fold(f32::MAX, |a, b| a.min(b));

    let startup_count = startup::list_startup().iter().filter(|e| e.enabled).count();

    let undo_entries = undo::load_undo_entries(&state);
    let last_cleanup_ts = undo_entries
        .iter()
        .filter(|e| e.kind == "junk_clean")
        .map(|e| e.ts)
        .max();

    let disk_pts = clamp_pts(disk_free_pct, 15.0, 55.0, 40);
    let ram_pts = clamp_pts(ram_free_pct, 15.0, 50.0, 15);
    let startup_pts = if startup_count == 0 {
        20
    } else {
        (20u8.saturating_sub((startup_count as u8).saturating_mul(2))).min(20)
    };
    let cleanup_pts = match last_cleanup_ts {
        Some(ts) => {
            let age_days = (crate::storage::now_millis().saturating_sub(ts)) / 86_400_000;
            if age_days <= 7 {
                25
            } else if age_days <= 30 {
                15
            } else {
                5
            }
        }
        None => 0,
    };

    let score = (disk_pts + ram_pts + startup_pts + cleanup_pts).min(100);

    HealthScore {
        score,
        disk_free_pct,
        ram_free_pct,
        startup_count,
        last_cleanup_ts,
        breakdown: vec![
            ScorePart {
                label: "Disk space".into(),
                points: disk_pts,
                max: 40,
            },
            ScorePart {
                label: "Startup clutter".into(),
                points: startup_pts,
                max: 20,
            },
            ScorePart {
                label: "Memory pressure".into(),
                points: ram_pts,
                max: 15,
            },
            ScorePart {
                label: "Recent cleanup".into(),
                points: cleanup_pts,
                max: 25,
            },
        ],
    }
}
