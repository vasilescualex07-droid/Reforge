use crate::state::AppState;
use crate::storage::{load_json, now_millis, save_json};
use crate::undo;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::PathBuf;
use std::time::Duration;
use tauri::{Emitter, State};
use windows::core::w;
use windows::Win32::Graphics::Gdi::{CreateDCW, DeleteDC};

use crate::error::AppError;
#[link(name = "gdi32")]
extern "system" {
    fn GetDeviceGammaRamp(hdc: *mut core::ffi::c_void, lpramp: *mut u16) -> i32;
    fn SetDeviceGammaRamp(hdc: *mut core::ffi::c_void, lpramp: *mut u16) -> i32;
}

// ---------------------------------------------------------------------------
// Blue light filter (gamma ramp)
// ---------------------------------------------------------------------------

fn read_current_ramp() -> Option<Vec<u16>> {
    unsafe {
        let dc = CreateDCW(w!("DISPLAY"), None, None, None);
        if dc.is_invalid() {
            return None;
        }
        let mut ramp = vec![0u16; 3 * 256];
        let ok = GetDeviceGammaRamp(dc.0, ramp.as_mut_ptr()) != 0;
        let _ = DeleteDC(dc);
        if ok {
            Some(ramp)
        } else {
            None
        }
    }
}

fn apply_warm_ramp(intensity: f32) -> Result<(), AppError> {
    let base = read_current_ramp().unwrap_or_else(|| {
        // default identity ramp
        let mut r = vec![0u16; 3 * 256];
        for i in 0..256u16 {
            let v = i * 257;
            r[i as usize] = v;
            r[256 + i as usize] = v;
            r[512 + i as usize] = v;
        }
        r
    });
    let mut ramp = base.clone();
    for i in 0..256usize {
        // reduce blue channel, slight boost to red/warm
        let b = ramp[512 + i];
        ramp[512 + i] = (b as f32 * (1.0 - intensity * 0.55)) as u16;
        let r = ramp[i];
        ramp[i] = ((r as f32) + (65535.0 - r as f32) * intensity * 0.18) as u16;
    }
    unsafe {
        let dc = CreateDCW(w!("DISPLAY"), None, None, None);
        if dc.is_invalid() {
            return Err(AppError::Command(
                "Could not open display device context".into(),
            ));
        }
        let ok = SetDeviceGammaRamp(dc.0, ramp.as_mut_ptr()) != 0;
        let _ = DeleteDC(dc);
        if !ok {
            return Err(AppError::Command("SetDeviceGammaRamp failed".into()));
        }
    }
    Ok(())
}

fn apply_identity_ramp() -> Result<(), AppError> {
    let mut ramp = vec![0u16; 3 * 256];
    for i in 0..256u16 {
        let v = i * 257;
        ramp[i as usize] = v;
        ramp[256 + i as usize] = v;
        ramp[512 + i as usize] = v;
    }
    unsafe {
        let dc = CreateDCW(w!("DISPLAY"), None, None, None);
        if dc.is_invalid() {
            return Err(AppError::Command(
                "Could not open display device context".into(),
            ));
        }
        let ok = SetDeviceGammaRamp(dc.0, ramp.as_mut_ptr()) != 0;
        let _ = DeleteDC(dc);
        if !ok {
            return Err(AppError::Command("SetDeviceGammaRamp failed".into()));
        }
    }
    Ok(())
}

#[tauri::command]
pub fn set_blue_light(
    state: State<'_, AppState>,
    on: bool,
    intensity: f32,
) -> Result<bool, AppError> {
    if on {
        apply_warm_ramp(intensity.clamp(0.05, 0.9))?;
    } else {
        apply_identity_ramp()?;
    }
    let mut cfg = load_config(&state);
    cfg.blue_light_on = on;
    cfg.blue_light_intensity = intensity;
    save_config(&state, &cfg)?;
    undo::log_entry(
        &state,
        "blue_light",
        format!(
            "Blue light filter → {} (intensity {:.0}%)",
            if on { "on" } else { "off" },
            intensity * 100.0
        ),
        json!({ "before": !on, "after": on }),
        true,
    )?;
    Ok(on)
}

// ---------------------------------------------------------------------------
// Schedule / automation config
// ---------------------------------------------------------------------------

/// One wall-clock style apply: at `time` ("HH:MM") the backend applies
/// `payload` (the same StyleApply the studio sends) through the exact same
/// `apply_style` path, so a scheduled apply is a normal revertible undo entry.
#[derive(Serialize, Deserialize, Clone)]
pub struct StyleScheduleEntry {
    pub id: String,
    /// "HH:MM" — fires at the first scheduler tick whose local minute matches.
    pub time: String,
    /// Catalog style id (informational — the payload is what's applied).
    pub style_id: String,
    pub name: String,
    pub payload: crate::styles::StyleApply,
    /// YYYY-MM-DD of the last fire — the once-per-day guard.
    #[serde(default)]
    pub last_fired_day: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct AutomationConfig {
    pub weekly_junk: bool,
    pub monthly_dupes: bool,
    pub auto_reapply_theme: bool,
    pub last_weekly_run: u64,
    pub last_monthly_run: u64,
    pub blue_light_on: bool,
    pub blue_light_intensity: f32,
    // S11.1 — time-based blue light filter with a 10-min transition ramp.
    #[serde(default)]
    pub blue_light_schedule: bool,
    /// "HH:MM" — the window opens here (overnight windows supported: start > end).
    #[serde(default)]
    pub blue_light_start: String,
    /// "HH:MM" — the window closes here.
    #[serde(default)]
    pub blue_light_end: String,
    // S11.3 — scheduled style applies (morning/evening/any time of day).
    #[serde(default)]
    pub style_schedule: Vec<StyleScheduleEntry>,
    // S11.6 — first-run grace: a fresh config with last_*_run == 0 must not
    // auto-clean immediately on the first boot; the first run happens 24h
    // after the config is created.
    #[serde(default)]
    pub created_at: u64,
    // S14.5 — last scheduled safe-clean (weekly/monthly per storage config).
    #[serde(default)]
    pub last_storage_clean: u64,
}

impl Default for AutomationConfig {
    fn default() -> Self {
        AutomationConfig {
            weekly_junk: true,
            monthly_dupes: false,
            auto_reapply_theme: true,
            last_weekly_run: 0,
            last_monthly_run: 0,
            blue_light_on: false,
            blue_light_intensity: 0.3,
            blue_light_schedule: false,
            blue_light_start: "19:00".into(),
            blue_light_end: "07:00".into(),
            style_schedule: Vec::new(),
            created_at: 0,
            last_storage_clean: 0,
        }
    }
}

fn config_path(state: &AppState) -> PathBuf {
    state.data_dir.join("automation.json")
}

fn load_config(state: &AppState) -> AutomationConfig {
    load_json(&config_path(state), AutomationConfig::default())
}

fn save_config(state: &AppState, cfg: &AutomationConfig) -> Result<(), AppError> {
    save_json(&config_path(state), cfg)
}

#[tauri::command]
pub fn get_automation_config(state: State<'_, AppState>) -> AutomationConfig {
    load_config(&state)
}

#[tauri::command]
pub fn set_automation_config(
    state: State<'_, AppState>,
    cfg: AutomationConfig,
) -> Result<AutomationConfig, AppError> {
    save_config(&state, &cfg)?;
    Ok(cfg)
}

// ---------------------------------------------------------------------------
// S11.1 — blue light schedule (pure — fake-clock testable)
// ---------------------------------------------------------------------------

/// What the blue-light scheduler should do at a given wall-clock minute.
#[derive(Debug, PartialEq, Clone, Copy)]
pub enum BlueLightDecision {
    /// Schedule disabled — never touch the gamma (manual mode owns it).
    Idle,
    /// Schedule enabled, currently outside the window — apply the identity ramp.
    Off,
    /// Apply the warm ramp at this (possibly ramped) intensity.
    Apply(f32),
}

fn parse_hhmm(s: &str) -> Option<u32> {
    let (h, m) = s.trim().split_once(':')?;
    let h: u32 = h.parse().ok()?;
    let m: u32 = m.parse().ok()?;
    if h < 24 && m < 60 {
        Some(h * 60 + m)
    } else {
        None
    }
}

/// Pure schedule decision. `start == end` means a 24h window. Windows may
/// wrap past midnight (start > end). The transition ramp is `ramp_min`
/// minutes: intensity fades in over the first `ramp_min` minutes after the
/// window opens and fades out over the last `ramp_min` minutes before it
/// closes (S11.1's 10-min ramp, injectable for tests).
pub fn blue_light_decision(
    schedule: bool,
    start: &str,
    end: &str,
    intensity: f32,
    now_min: u32,
    ramp_min: u32,
) -> BlueLightDecision {
    if !schedule {
        return BlueLightDecision::Idle;
    }
    let Some(s) = parse_hhmm(start) else {
        return BlueLightDecision::Off;
    };
    let Some(e) = parse_hhmm(end) else {
        return BlueLightDecision::Off;
    };
    let ramp = ramp_min.max(1);
    let peak = intensity.clamp(0.05, 0.9);

    let in_window = if s == e {
        true
    } else if s < e {
        (s..e).contains(&now_min)
    } else {
        now_min >= s || now_min < e
    };
    if !in_window {
        return BlueLightDecision::Off;
    }
    // start == end means a 24h window — no ramp, always at peak.
    if s == e {
        return BlueLightDecision::Apply(peak);
    }

    let since_open = if s < e || now_min >= s {
        now_min - s
    } else {
        // wrapped past midnight: the window opened yesterday evening
        now_min + 1440 - s
    };
    if since_open < ramp {
        return BlueLightDecision::Apply(peak * (since_open as f32 / ramp as f32));
    }

    let until_close = if s < e || now_min < e {
        e - now_min
    } else {
        // wrapped: the window closes tomorrow morning
        1440 - now_min + e
    };
    if until_close <= ramp {
        return BlueLightDecision::Apply(peak * (until_close as f32 / ramp as f32));
    }

    BlueLightDecision::Apply(peak)
}

/// Background thread: while the schedule is enabled, own the gamma ramp —
/// follow the schedule (with its 10-min ramp), persist the resulting on/off
/// state, and never write the gamma twice for the same target. When the
/// schedule is disabled it does nothing (manual mode owns the ramp).
pub fn spawn_blue_light_scheduler(state: AppState) {
    std::thread::spawn(move || {
        // None = not yet applied since the schedule was last active;
        // Some(None) = applied off; Some(Some(i)) = applied ramped intensity.
        let mut last_target: Option<Option<f32>> = None;
        loop {
            std::thread::sleep(Duration::from_secs(30));
            let mut cfg = load_config(&state);
            let now_min = crate::storage::local_minutes();
            let target = blue_light_decision(
                cfg.blue_light_schedule,
                &cfg.blue_light_start,
                &cfg.blue_light_end,
                cfg.blue_light_intensity,
                now_min,
                10,
            );
            let target_opt = match target {
                BlueLightDecision::Idle => {
                    last_target = None;
                    continue;
                }
                BlueLightDecision::Off => None,
                BlueLightDecision::Apply(i) => Some(i),
            };
            if last_target == Some(target_opt) {
                continue;
            }
            let res = match target_opt {
                Some(i) => apply_warm_ramp(i),
                None => apply_identity_ramp(),
            };
            if res.is_ok() {
                cfg.blue_light_on = target_opt.is_some();
                let _ = save_config(&state, &cfg);
                last_target = Some(target_opt);
            }
        }
    });
}

// ---------------------------------------------------------------------------
// S11.3 — scheduled style applies
// ---------------------------------------------------------------------------

/// Pure: which schedule entries are due at `now_min` on `today`? An entry is
/// due when its wall-clock minute matches AND it hasn't already fired today
/// (the once-per-day guard). Fake-clock testable.
pub fn style_schedule_due(
    entries: &[StyleScheduleEntry],
    now_min: u32,
    today: &str,
) -> Vec<StyleScheduleEntry> {
    entries
        .iter()
        .filter(|e| parse_hhmm(&e.time) == Some(now_min) && e.last_fired_day != today)
        .cloned()
        .collect()
}

/// Background thread: every 20s, fire any due scheduled styles through the
/// exact `apply_style` path (revertible undo entries). The entry is marked
/// fired before the apply so a slow/failed apply never re-fires all day; a
/// failure is surfaced as a `reforge-maintenance-failed` event, never
/// swallowed.
pub fn spawn_style_scheduler(state: AppState, handle: tauri::AppHandle) {
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(Duration::from_secs(20));
            let mut cfg = load_config(&state);
            if cfg.style_schedule.is_empty() {
                continue;
            }
            let now_min = crate::storage::local_minutes();
            let today = crate::storage::local_date_key();
            let due = style_schedule_due(&cfg.style_schedule, now_min, &today);
            if due.is_empty() {
                continue;
            }
            for entry in due {
                if let Some(slot) = cfg.style_schedule.iter_mut().find(|e| e.id == entry.id) {
                    slot.last_fired_day = today.clone();
                }
                let _ = save_config(&state, &cfg);
                let h = handle.clone();
                let st = state.clone();
                let fired = entry.clone();
                tauri::async_runtime::spawn(async move {
                    match crate::styles::apply_style_inner(h.clone(), st, fired.payload.clone()).await {
                        Ok(res) => {
                            tracing::info!("scheduled style applied: {}", res.name);
                            let _ = h.emit(
                                "reforge-maintenance-result",
                                json!({ "message": format!("Scheduled style applied: {}", res.name) }),
                            );
                        }
                        Err(e) => {
                            let _ = h.emit(
                                "reforge-maintenance-failed",
                                json!({ "message": format!("Scheduled style \"{}\" failed: {}", fired.name, e) }),
                            );
                        }
                    }
                });
            }
        }
    });
}

// ---------------------------------------------------------------------------
// S11.6 — due-maintenance scheduler (real weekly/monthly automation)
// ---------------------------------------------------------------------------

/// When is a task due? `last == 0` means "never run" — the first run waits
/// `FIRST_RUN_GRACE_MS` after the config was created so a fresh install
/// doesn't auto-clean on first boot.
fn maintenance_due(last_run: u64, created_at: u64, now: u64, interval_ms: u64) -> bool {
    if last_run == 0 {
        created_at > 0 && now.saturating_sub(created_at) >= FIRST_RUN_GRACE_MS
    } else {
        now.saturating_sub(last_run) >= interval_ms
    }
}

const FIRST_RUN_GRACE_MS: u64 = 24 * 3600 * 1000;

#[derive(Serialize)]
pub struct MaintenanceRun {
    pub ran_junk: bool,
    pub junk_freed: u64,
    pub ran_dupes: bool,
    pub dupe_wasted: u64,
    pub reapplied_theme: bool,
    pub notes: Vec<String>,
}

/// The runnable core — the command wraps it and the background scheduler
/// calls it directly (S11.6), so a due run is identical whether triggered by
/// "Run now" or by the clock.
pub fn run_due_maintenance_inner(state: &AppState) -> Result<MaintenanceRun, AppError> {
    let mut cfg = load_config(state);
    let now = now_millis();
    let week = 7 * 86400 * 1000u64;
    let month = 30 * 86400 * 1000u64;
    let mut result = MaintenanceRun {
        ran_junk: false,
        junk_freed: 0,
        ran_dupes: false,
        dupe_wasted: 0,
        reapplied_theme: false,
        notes: Vec::new(),
    };

    if cfg.weekly_junk && maintenance_due(cfg.last_weekly_run, cfg.created_at, now, week) {
        let scan = crate::cleanup::scan_junk();
        let non_admin: Vec<String> = scan
            .items
            .iter()
            .filter(|i| !i.admin_required)
            .map(|i| i.id.clone())
            .collect();
        if !non_admin.is_empty() {
            if let Ok(res) = crate::cleanup::clean_junk_inner(state, non_admin) {
                result.ran_junk = true;
                result.junk_freed = res.freed_bytes;
                result.notes.push(format!(
                    "Weekly junk clean freed {}",
                    crate::storage::format_bytes(res.freed_bytes)
                ));
            }
        }
        cfg.last_weekly_run = now;
    }

    if cfg.monthly_dupes && maintenance_due(cfg.last_monthly_run, cfg.created_at, now, month) {
        if let Ok(scan) = crate::duplicates::scan_duplicates_silent(
            std::env::var("USERPROFILE").unwrap_or_default(),
            1,
        ) {
            result.ran_dupes = true;
            result.dupe_wasted = scan.total_wasted;
            result.notes.push(format!(
                "Monthly duplicate scan found {} wasted",
                crate::storage::format_bytes(scan.total_wasted)
            ));
        }
        cfg.last_monthly_run = now;
    }

    // S14.5 — scheduled safe clean: weekly / monthly per the storage config.
    // Dry-run first, then apply the enabled categories; the report card lands
    // in the undo log as a `storage_clean` entry (visible in History).
    let storage_cfg = crate::storage::load_storage_config(state);
    let (due, interval) = match storage_cfg.auto_clean.as_str() {
        "weekly" => (maintenance_due(cfg.last_storage_clean, cfg.created_at, now, week), week),
        "monthly" => (maintenance_due(cfg.last_storage_clean, cfg.created_at, now, month), month),
        _ => (false, 0),
    };
    if due && interval > 0 {
        let ids: Vec<String> = crate::cleanup::preview_clean_now_inner(state)
            .iter()
            .map(|i| i.id.clone())
            .collect();
        if !ids.is_empty() {
            match crate::cleanup::clean_now_inner(state, ids) {
                Ok(res) => {
                    let verb = if storage_cfg.dry_run { "would free" } else { "freed" };
                    result.notes.push(format!(
                        "Scheduled safe clean {} {}{}",
                        verb,
                        crate::storage::format_bytes(res.freed_bytes),
                        if storage_cfg.dry_run {
                            " (dry run — nothing deleted)".to_string()
                        } else if res.failed.is_empty() {
                            String::new()
                        } else {
                            format!(" ({} skipped)", res.failed.len())
                        }
                    ));
                }
                Err(e) => result.notes.push(format!("Scheduled safe clean failed: {e}")),
            }
        }
        cfg.last_storage_clean = now;
    }

    if cfg.auto_reapply_theme {
        // S11.2 — re-apply the FULL last-applied style (accent, mode,
        // transparency, font, sound scheme, static wallpaper) instead of only
        // the accent/mode snapshot, so an OS update can't silently reset the
        // look. Falls back to the old accent+mode path when no style exists.
        if let Some(rec) = crate::styles::load_applied_style(&state.data_dir) {
            match crate::styles::reapply_theme_components(None, state, &rec.payload) {
                Ok(notes) => {
                    result.reapplied_theme = true;
                    if notes.is_empty() {
                        result.notes.push(format!("Re-applied saved style: {}", rec.name));
                    } else {
                        result.notes.push(format!("Re-applied saved style: {}", rec.name));
                        result.notes.extend(notes);
                    }
                }
                Err(e) => result
                    .notes
                    .push(format!("Style re-apply failed: {e}")),
            }
        } else {
            let dir = state.data_dir.clone();
            let theme_file = dir.join("theme_state.json");
            if let Ok(s) = std::fs::read_to_string(&theme_file) {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&s) {
                    if let Some(hex) = v.get("accent_hex").and_then(|x| x.as_str()) {
                        if crate::theme::apply_accent_hex_raw(hex).is_ok() {
                            result.reapplied_theme = true;
                            result.notes.push("Re-applied saved accent color".into());
                        }
                    }
                    if let Some(mode) = v.get("mode").and_then(|x| x.as_str()) {
                        let _ = crate::theme::apply_mode_raw(mode);
                    }
                }
            }
        }
    }

    save_config(state, &cfg)?;
    undo::log_entry(
        state,
        "scheduled_maintenance",
        "Scheduled maintenance run".to_string(),
        json!({ "result": result }),
        false,
    )?;
    Ok(result)
}

#[tauri::command]
pub fn run_due_maintenance(state: State<'_, AppState>) -> Result<MaintenanceRun, AppError> {
    run_due_maintenance_inner(&state)
}

/// Background thread: every minute, run whichever maintenance task is due
/// (weekly junk / monthly dupes), honoring the first-run grace. Failures are
/// emitted as `reforge-maintenance-failed` so the shell can toast them
/// (S11.6 — failure notifications).
pub fn spawn_maintenance_scheduler(state: AppState, handle: tauri::AppHandle) {
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(Duration::from_secs(60));
            let now = now_millis();
            let mut cfg = load_config(&state);
            if cfg.created_at == 0 {
                cfg.created_at = now;
                let _ = save_config(&state, &cfg);
                continue; // first tick just stamps creation — nothing due yet
            }
            let week = 7 * 86400 * 1000u64;
            let month = 30 * 86400 * 1000u64;
            let weekly_due =
                cfg.weekly_junk && maintenance_due(cfg.last_weekly_run, cfg.created_at, now, week);
            let monthly_due = cfg.monthly_dupes
                && maintenance_due(cfg.last_monthly_run, cfg.created_at, now, month);
            if !weekly_due && !monthly_due {
                continue;
            }
            match run_due_maintenance_inner(&state) {
                Ok(_) => {}
                Err(e) => {
                    let _ = handle.emit(
                        "reforge-maintenance-failed",
                        json!({ "message": format!("Scheduled maintenance failed: {e}") }),
                    );
                }
            }
        }
    });
}

// undo support
pub fn default_intensity() -> f32 {
    0.3
}

pub fn apply_blue_light_raw(intensity: f32) -> Result<(), AppError> {
    apply_warm_ramp(intensity.clamp(0.05, 0.9))
}

pub fn apply_identity_ramp_pub() -> Result<(), AppError> {
    apply_identity_ramp()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::styles::StyleApply;

    fn entry(id: &str, time: &str, day: &str) -> StyleScheduleEntry {
        StyleScheduleEntry {
            id: id.into(),
            time: time.into(),
            style_id: "s1".into(),
            name: id.into(),
            payload: StyleApply {
                id: "s1".into(),
                name: "Style".into(),
                mode: None,
                accent_hex: None,
                transparency: None,
                wallpaper: None,
                wallpaper_type: None,
                scene: None,
                font: None,
                sound_scheme: None,
                rgb: None,
            },
            last_fired_day: day.into(),
        }
    }

    #[test]
    fn disabled_schedule_never_touches_the_gamma() {
        assert_eq!(
            blue_light_decision(false, "19:00", "07:00", 0.5, 12 * 60, 10),
            BlueLightDecision::Idle
        );
    }

    #[test]
    fn schedule_window_and_ramp() {
        // start 19:00 (1140), end 07:00 (420) — overnight
        // midday: off
        assert_eq!(
            blue_light_decision(true, "19:00", "07:00", 0.5, 12 * 60, 10),
            BlueLightDecision::Off
        );
        // 19:00 sharp: ramp starts at 0
        assert_apply(
            blue_light_decision(true, "19:00", "07:00", 0.5, 19 * 60, 10),
            0.0,
        );
        // 19:05: halfway up
        assert_apply(
            blue_light_decision(true, "19:00", "07:00", 0.5, 19 * 60 + 5, 10),
            0.25,
        );
        // 19:30: full intensity
        assert_eq!(
            blue_light_decision(true, "19:00", "07:00", 0.5, 19 * 60 + 30, 10),
            BlueLightDecision::Apply(0.5)
        );
        // 06:55: 5 min before close → half intensity (fading out)
        assert_apply(
            blue_light_decision(true, "19:00", "07:00", 0.5, 6 * 60 + 55, 10),
            0.25,
        );
        // 07:00 exactly: closed
        assert_eq!(
            blue_light_decision(true, "19:00", "07:00", 0.5, 7 * 60, 10),
            BlueLightDecision::Off
        );
    }

    #[test]
    fn same_day_window_does_not_wrap() {
        // start 08:00, end 18:00 — a day window
        assert_eq!(
            blue_light_decision(true, "08:00", "18:00", 0.4, 7 * 60 + 59, 10),
            BlueLightDecision::Off
        );
        assert_apply(
            blue_light_decision(true, "08:00", "18:00", 0.4, 8 * 60 + 3, 10),
            0.12,
        );
        assert_eq!(
            blue_light_decision(true, "08:00", "18:00", 0.4, 12 * 60, 10),
            BlueLightDecision::Apply(0.4)
        );
        assert_eq!(
            blue_light_decision(true, "08:00", "18:00", 0.4, 18 * 60, 10),
            BlueLightDecision::Off
        );
    }

    #[test]
    fn equal_times_mean_all_day() {
        assert_eq!(
            blue_light_decision(true, "06:00", "06:00", 0.3, 0, 10),
            BlueLightDecision::Apply(0.3)
        );
        assert_eq!(
            blue_light_decision(true, "06:00", "06:00", 0.3, 12 * 60, 10),
            BlueLightDecision::Apply(0.3)
        );
    }

    /// Compare a decision against an expected Apply intensity with a small
    /// float tolerance (f32 ramp math is not bit-exact).
    fn assert_apply(d: BlueLightDecision, expected: f32) {
        match d {
            BlueLightDecision::Apply(v) => assert!(
                (v - expected).abs() < 0.001,
                "expected Apply({expected}) got Apply({v})"
            ),
            other => panic!("expected Apply({expected}) got {other:?}"),
        }
    }

    #[test]
    fn invalid_times_degrade_to_off_not_panic() {
        assert_eq!(
            blue_light_decision(true, "bogus", "07:00", 0.5, 12 * 60, 10),
            BlueLightDecision::Off
        );
        assert_eq!(
            blue_decision_off_on_bad_end(),
            BlueLightDecision::Off
        );
        // intensity is clamped into the safe gamma range
        assert_eq!(
            blue_light_decision(true, "19:00", "07:00", 2.0, 19 * 60 + 30, 10),
            BlueLightDecision::Apply(0.9)
        );
    }

    fn blue_decision_off_on_bad_end() -> BlueLightDecision {
        blue_light_decision(true, "19:00", "25:00", 0.5, 12 * 60, 10)
    }

    #[test]
    fn scheduled_style_due_only_when_minute_matches_and_not_fired_today() {
        let entries = vec![entry("a", "18:00", ""), entry("b", "18:00", "2026-08-15"), entry("c", "09:30", "")];
        let due = style_schedule_due(&entries, 18 * 60, "2026-08-15");
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].id, "a");
        // same minute tomorrow (different day) → c is due too, b already fired today
        let due2 = style_schedule_due(&entries, 9 * 60 + 30, "2026-08-16");
        assert_eq!(due2.len(), 1);
        assert_eq!(due2[0].id, "c");
        // a fired today → not due again today
        assert!(style_schedule_due(&entries, 18 * 60, "2026-08-15").iter().all(|e| e.id != "b"));
    }

    #[test]
    fn maintenance_first_run_has_a_grace_period() {
        // fresh config (last=0): due only after created_at + 24h
        let created = 1_000_000;
        assert!(!maintenance_due(0, created, created + 23 * 3600 * 1000, 7 * 86400 * 1000));
        assert!(maintenance_due(0, created, created + 25 * 3600 * 1000, 7 * 86400 * 1000));
        // normal cadence after the first run
        let last = created + 48 * 3600 * 1000;
        assert!(!maintenance_due(last, created, last + 6 * 86400 * 1000, 7 * 86400 * 1000));
        assert!(maintenance_due(last, created, last + 8 * 86400 * 1000, 7 * 86400 * 1000));
    }
}
