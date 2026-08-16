use crate::cmd::hidden as cmd;
use crate::state::AppState;
use crate::storage::{load_json, now_millis, save_json};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::PathBuf;
use sysinfo::{Disks, System};
use tauri::State;
use windows::Win32::System::Power::GetSystemPowerStatus;

#[derive(Serialize)]
pub struct BatteryInfo {
    pub on_ac: bool,
    pub percent: u8,
    pub charging: bool,
}

#[derive(Serialize)]
pub struct DiskSample {
    pub name: String,
    pub mount: String,
    pub total: u64,
    pub free: u64,
    pub free_pct: f32,
}

#[derive(Serialize)]
pub struct ProcSample {
    pub name: String,
    pub mem_mb: u64,
    pub cpu_pct: f32,
}

/// The stats-widget payload (S9.5): the widget's own depth beyond the classic
/// CPU/RAM/disk rows — GPU, network up/down rates and the hottest thermal zone.
/// All optional fields degrade to `None` when the OS exposes no data (e.g. no
/// GPU support from sysinfo on this build, no battery, no thermal zone).
#[derive(Serialize, Clone)]
pub struct WidgetStats {
    pub cpu: f32,
    pub ram_pct: f32,
    pub disk_free_pct: f32,
    pub gpu_name: Option<String>,
    pub gpu_usage: Option<f32>,
    pub net_up_kbps: f32,
    pub net_down_kbps: f32,
    pub thermal_c: Option<f32>,
}

/// The GPU (adapter) name via EnumDisplayDevices — sysinfo 0.33 removed GPU
/// support entirely, and Windows has no free usage% API without WMI/PDH, so the
/// widget reports the adapter name and renders usage as "—" honestly.
fn gpu_name() -> Option<String> {
    use windows::core::PCWSTR;
    use windows::Win32::Graphics::Gdi::{EnumDisplayDevicesW, DISPLAY_DEVICEW};
    unsafe {
        let mut i = 0u32;
        loop {
            let mut dev: DISPLAY_DEVICEW = std::mem::zeroed();
            dev.cb = std::mem::size_of::<DISPLAY_DEVICEW>() as u32;
            let ok = EnumDisplayDevicesW(PCWSTR(std::ptr::null()), i, &mut dev, 0).as_bool();
            if !ok {
                break;
            }
            let len = dev.DeviceString.iter().position(|&c| c == 0).unwrap_or(128);
            let name = String::from_utf16_lossy(&dev.DeviceString[..len]);
            // monitors report "... Monitor"; the adapter itself is the GPU
            if !name.to_lowercase().contains("monitor") {
                return Some(name);
            }
            i += 1;
        }
        None
    }
}

/// Sample the stats-widget payload. `sys` must be refreshed (refresh_all or
/// refresh_cpu) so cpu/ram are current. Networks/Components are read from their
/// standalone refreshed lists (sysinfo 0.33 removed them from `System`).
///
/// `last_net` carries the previous sample's cumulative received/transmitted
/// bytes so network RATES can be derived; pass `None` on the first sample and
/// rates report 0 until a second sample exists. `dt_secs` is the wall-clock
/// time between the two samples.
pub fn sample_widget_stats(
    sys: &mut System,
    last_net: &mut Option<(u64, u64)>,
    dt_secs: f32,
) -> WidgetStats {
    let cpu = sys.global_cpu_usage();
    let total = sys.total_memory();
    let used = sys.used_memory();
    let ram_pct = if total > 0 {
        used as f32 / total as f32 * 100.0
    } else {
        0.0
    };
    let disk_free_pct = Disks::new_with_refreshed_list()
        .iter()
        .next()
        .map(|d| {
            if d.total_space() > 0 {
                d.available_space() as f32 / d.total_space() as f32 * 100.0
            } else {
                0.0
            }
        })
        .unwrap_or(0.0);

    // network: cumulative bytes per interface; deltas give up/down rates
    let (recv, sent): (u64, u64) = sysinfo::Networks::new_with_refreshed_list()
        .iter()
        .fold((0, 0), |(r, s), (_, d)| (r + d.received(), s + d.transmitted()));
    let (net_down_kbps, net_up_kbps) = match (*last_net, dt_secs > 0.0) {
        (Some((pr, ps)), true) => {
            let dr = recv.saturating_sub(pr) as f64 * 8.0 / 1000.0 / dt_secs as f64;
            let ds = sent.saturating_sub(ps) as f64 * 8.0 / 1000.0 / dt_secs as f64;
            (dr.max(0.0) as f32, ds.max(0.0) as f32)
        }
        _ => (0.0, 0.0),
    };
    *last_net = Some((recv, sent));

    let thermal_c = sysinfo::Components::new_with_refreshed_list()
        .iter()
        .filter_map(|c| c.temperature())
        .filter(|t| *t > 0.0 && t.is_finite())
        .fold(None::<f32>, |acc, t| Some(acc.map_or(t, |a: f32| a.max(t))));

    WidgetStats {
        cpu,
        ram_pct,
        disk_free_pct,
        gpu_name: gpu_name(),
        gpu_usage: None, // no free Windows API — widget renders "—"
        net_up_kbps,
        net_down_kbps,
        thermal_c,
    }
}

/// S9.5 — on-demand snapshot for the frontend (board preview, preview mode).
/// Samples twice ~700ms apart so network rates are real, not zero.
#[tauri::command]
pub fn get_widget_stats() -> WidgetStats {
    let mut sys = System::new_all();
    let mut last_net = None;
    let _first = sample_widget_stats(&mut sys, &mut last_net, 0.0);
    std::thread::sleep(std::time::Duration::from_millis(700));
    sample_widget_stats(&mut sys, &mut last_net, 0.7)
}

#[derive(Serialize)]
pub struct PerfSnapshot {
    pub ts: u64,
    pub cpu_usage_pct: f32,
    pub ram_total: u64,
    pub ram_used: u64,
    pub ram_free_pct: f32,
    pub process_count: usize,
    pub uptime_secs: u64,
    pub boot_time_ts: u64,
    pub battery: Option<BatteryInfo>,
    pub disks: Vec<DiskSample>,
    pub top_processes: Vec<ProcSample>,
}

fn battery_info() -> Option<BatteryInfo> {
    unsafe {
        let mut status = windows::Win32::System::Power::SYSTEM_POWER_STATUS::default();
        if GetSystemPowerStatus(&mut status).is_ok() {
            if status.BatteryFlag == 255 {
                return None; // no battery
            }
            Some(BatteryInfo {
                on_ac: status.ACLineStatus == 1,
                percent: status.BatteryLifePercent,
                charging: status.BatteryFlag == 8,
            })
        } else {
            None
        }
    }
}

// ---------------------------------------------------------------------------
// Daily trend history
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone)]
pub struct PerfRecord {
    pub ts: u64,
    pub cpu_avg: f32,
    pub cpu_max: f32,
    pub ram_free_pct: f32,
    // running sum + count make cpu_avg a true daily average instead of a
    // geometric decay that never reflects the real mean
    #[serde(default)]
    pub cpu_sum: f32,
    #[serde(default)]
    pub cpu_count: u32,
}

fn history_path(state: &AppState) -> PathBuf {
    state.data_dir.join("perf_history.json")
}

fn record_sample(state: &AppState, cpu: f32, ram: f32) {
    let now = now_millis();
    let day = now / 86_400_000;
    let mut h: Vec<PerfRecord> = load_json(&history_path(state), Vec::new());
    let same_day = h.last().map(|r| r.ts / 86_400_000 == day).unwrap_or(false);
    if same_day {
        if let Some(r) = h.last_mut() {
            r.cpu_sum += cpu;
            r.cpu_count = r.cpu_count.saturating_add(1);
            r.cpu_avg = r.cpu_sum / r.cpu_count as f32;
            r.cpu_max = r.cpu_max.max(cpu);
            r.ram_free_pct = ram;
            r.ts = now;
        }
    } else {
        h.push(PerfRecord {
            ts: now,
            cpu_avg: cpu,
            cpu_max: cpu,
            ram_free_pct: ram,
            cpu_sum: cpu,
            cpu_count: 1,
        });
        if h.len() > 120 {
            h.drain(..h.len() - 120);
        }
    }
    let _ = save_json(&history_path(state), &h);
}

#[tauri::command]
pub fn get_perf_history(state: State<'_, AppState>) -> Vec<PerfRecord> {
    load_json(&history_path(&state), Vec::new())
}

// ---------------------------------------------------------------------------
// Resource leaderboard
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_resource_leaderboard(sort_by: String) -> Vec<ProcSample> {
    let mut sys = System::new_all();
    sys.refresh_all();
    let mut procs: Vec<ProcSample> = sys
        .processes()
        .values()
        .filter_map(|p| {
            let name = p.name().to_string_lossy().to_string();
            if name.is_empty() || name == "System Idle Process" {
                return None;
            }
            Some(ProcSample {
                name,
                mem_mb: p.memory() / 1024 / 1024,
                cpu_pct: p.cpu_usage(),
            })
        })
        .collect();
    match sort_by.as_str() {
        "cpu" => procs.sort_by(|a, b| b.cpu_pct.total_cmp(&a.cpu_pct)),
        "ram" => procs.sort_by_key(|x| std::cmp::Reverse(x.mem_mb)),
        _ => procs.sort_by_key(|x| std::cmp::Reverse(x.mem_mb)),
    }
    procs.truncate(30);
    procs
}

// ---------------------------------------------------------------------------
// Battery health (powercfg battery report)
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_battery_health() -> serde_json::Value {
    let dir = std::env::temp_dir();
    let out = dir.join("reforge_battery_report.html");
    let ok = cmd("powercfg")
        .args(["/batteryreport", &format!("/output {}", out.display())])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    if !ok {
        return json!({ "available": false });
    }
    let s = std::fs::read_to_string(&out).unwrap_or_default();
    let parse = |label: &str| -> Option<u32> {
        s.lines().find(|l| l.contains(label)).and_then(|l| {
            let after = l.split(label).nth(1)?;
            after
                .split(|c: char| !c.is_ascii_digit())
                .find(|x| !x.is_empty())?
                .parse()
                .ok()
        })
    };
    let design = parse("DESIGN CAPACITY");
    let full = parse("FULL CHARGE CAPACITY");
    let cycles = parse("CYCLE COUNT");
    let health = match (design, full) {
        (Some(d), Some(f)) if d > 0 => Some((f as f64 / d as f64 * 100.0).round() as u32),
        _ => None,
    };
    json!({
        "available": true,
        "design_mwh": design,
        "full_mwh": full,
        "health_pct": health,
        "cycle_count": cycles,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::{load_json, save_json};

    #[test]
    fn daily_average_is_true_mean() {
        let dir = std::env::temp_dir().join(format!("reforge-perf-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let state = AppState {
            data_dir: dir.clone(),
        };

        // three samples on the same day
        record_sample(&state, 10.0, 50.0);
        record_sample(&state, 20.0, 50.0);
        record_sample(&state, 30.0, 50.0);
        let h = load_json::<Vec<PerfRecord>>(&history_path(&state), Vec::new());
        assert_eq!(h.len(), 1);
        assert!(
            (h[0].cpu_avg - 20.0).abs() < 0.001,
            "avg should be (10+20+30)/3 = 20, got {}",
            h[0].cpu_avg
        );
        assert_eq!(h[0].cpu_max as u32, 30);
        assert_eq!(h[0].cpu_count, 3);

        // a record that belongs to a previous day starts a fresh bucket
        let mut h2 = load_json::<Vec<PerfRecord>>(&history_path(&state), Vec::new());
        h2[0].ts -= 2 * 86_400_000;
        save_json(&history_path(&state), &h2).unwrap();
        record_sample(&state, 99.0, 60.0);
        let h3 = load_json::<Vec<PerfRecord>>(&history_path(&state), Vec::new());
        assert_eq!(h3.len(), 2);
        assert_eq!(h3[1].cpu_avg, 99.0);
        assert_eq!(h3[1].cpu_count, 1);

        std::fs::remove_dir_all(&dir).ok();
    }
}

// ---------------------------------------------------------------------------
// Live snapshot
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_performance(state: State<'_, AppState>) -> PerfSnapshot {
    let mut sys = System::new_all();
    sys.refresh_all();

    let total = sys.total_memory();
    let used = sys.used_memory();
    let free_pct = if total > 0 {
        (total.saturating_sub(used)) as f32 / total as f32 * 100.0
    } else {
        0.0
    };

    let boot = System::boot_time();
    let uptime = System::uptime();

    let disks: Vec<DiskSample> = Disks::new_with_refreshed_list()
        .iter()
        .map(|d| {
            let free = d.available_space();
            let total = d.total_space();
            DiskSample {
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

    let mut procs: Vec<ProcSample> = sys
        .processes()
        .values()
        .map(|p| ProcSample {
            name: p.name().to_string_lossy().to_string(),
            mem_mb: p.memory() / 1024 / 1024,
            cpu_pct: p.cpu_usage(),
        })
        .collect();
    procs.sort_by_key(|x| std::cmp::Reverse(x.mem_mb));
    procs.truncate(12);

    record_sample(&state, sys.global_cpu_usage(), free_pct);

    PerfSnapshot {
        ts: now_millis(),
        cpu_usage_pct: sys.global_cpu_usage(),
        ram_total: total,
        ram_used: used,
        ram_free_pct: free_pct,
        process_count: sys.processes().len(),
        uptime_secs: uptime,
        boot_time_ts: boot,
        battery: battery_info(),
        disks,
        top_processes: procs,
    }
}
