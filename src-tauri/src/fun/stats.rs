//! System-stats hooks for the fun-widgets module.
//!
//! One background thread feeds every stats-hungry widget (CPU Fire Alarm,
//! Idle Roast, Achievement Popper, Procrastination Certificate):
//! - CPU usage via the same `sysinfo` crate Reforge's perf monitor already
//!   uses (no second dependency for the same data — spec §3)
//! - idle time via `GetLastInputInfo` (Windows)
//! - session uptime, RAM/disk, process count (sysinfo)
//!
//! Resource hygiene (§7): the thread does nothing but sleep while no widget
//! is enabled (`set_active(false)`), so "all 12 off" reads near-zero added
//! overhead. When active it polls every 1s (sustained-threshold logic — e.g.
//! 5s of CPU above the fire line — lives on the frontend over the event
//! stream) and emits a `fun:stats` event each tick.
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Clone, Default)]
pub struct Snapshot {
    pub cpu: f32,
    pub ram_pct: f32,
    pub mem_used: u64,
    pub mem_total: u64,
    pub disk_pct: f32,
    pub proc_count: usize,
    pub uptime_secs: u64,
    pub idle_secs: u64,
    pub top_procs: Vec<TopProc>,
}

#[derive(Serialize, Clone)]
pub struct TopProc {
    pub name: String,
    pub cpu: f32,
}

static ACTIVE: AtomicBool = AtomicBool::new(false);
static LATEST: OnceLock<Mutex<Snapshot>> = OnceLock::new();

fn latest() -> &'static Mutex<Snapshot> {
    LATEST.get_or_init(|| Mutex::new(Snapshot::default()))
}

pub fn set_active(on: bool) {
    ACTIVE.store(on, Ordering::Relaxed);
}

pub fn is_active() -> bool {
    ACTIVE.load(Ordering::Relaxed)
}

/// Milliseconds since the last keyboard/mouse input (GetLastInputInfo).
/// 0 on failure (never panics — the idle roast just won't fire).
pub fn idle_seconds() -> u64 {
    use windows::Win32::System::SystemInformation::GetTickCount64;
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
    let mut lii = LASTINPUTINFO {
        cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
        dwTime: 0,
    };
    if unsafe { GetLastInputInfo(&mut lii) }.as_bool() {
        let tick = unsafe { GetTickCount64() };
        tick.saturating_sub(lii.dwTime as u64) / 1000
    } else {
        0
    }
}

fn collect() -> Snapshot {
    use sysinfo::{Disks, System};
    let mut sys = System::new_all();
    sys.refresh_all();
    let total = sys.total_memory();
    let used = sys.used_memory();
    let ram_pct = if total > 0 {
        used as f32 / total as f32 * 100.0
    } else {
        0.0
    };
    let disks = Disks::new_with_refreshed_list();
    let disk_pct = disks
        .iter()
        .find(|d| d.mount_point() == std::path::Path::new("C:\\"))
        .or_else(|| disks.iter().next())
        .map(|d| {
            if d.total_space() > 0 {
                d.available_space() as f32 / d.total_space() as f32 * 100.0
            } else {
                0.0
            }
        })
        .unwrap_or(0.0);
    let mut procs: Vec<TopProc> = sys
        .processes()
        .values()
        .map(|p| TopProc {
            name: p.name().to_string_lossy().to_string(),
            cpu: p.cpu_usage(),
        })
        .collect();
    procs.sort_by(|a, b| b.cpu.total_cmp(&a.cpu));
    procs.truncate(5);
    Snapshot {
        cpu: sys.global_cpu_usage(),
        ram_pct,
        mem_used: used,
        mem_total: total,
        disk_pct,
        proc_count: sys.processes().len(),
        uptime_secs: System::uptime(),
        idle_secs: idle_seconds(),
        top_procs: procs,
    }
}

/// Latest snapshot for on-demand consumers. Forces a live collect the first
/// time (before the thread's first tick) so a manual trigger like the
/// Certificate always has fresh numbers, never zeros.
pub fn snapshot() -> Snapshot {
    let mut first = false;
    {
        let lock = latest();
        if let Ok(g) = lock.lock() {
            if g.mem_total == 0 && g.proc_count == 0 {
                first = true;
            }
        }
    }
    if first {
        let s = collect();
        if let Ok(mut g) = latest().lock() {
            *g = s.clone();
        }
        return s;
    }
    latest().lock().map(|g| g.clone()).unwrap_or_default()
}

/// Spawn the poll thread. Called once from setup. The thread lives for the
/// whole app run but does ~nothing while inactive (2s sleep loop), so it
/// satisfies "off ≈ zero overhead" without churny spawn/kill.
pub fn start(app: AppHandle) {
    std::thread::spawn(move || loop {
        if !is_active() {
            std::thread::sleep(std::time::Duration::from_secs(2));
            continue;
        }
        let s = collect();
        if let Ok(mut g) = latest().lock() {
            *g = s.clone();
        }    let _ = app.emit("fun:stats", &s);
    std::thread::sleep(std::time::Duration::from_secs(1));
    });
}
