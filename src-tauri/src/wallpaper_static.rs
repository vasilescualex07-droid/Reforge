use crate::state::AppState;
use crate::storage::{load_json, now_millis, save_json};
use crate::undo;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::{Path, PathBuf};
use tauri::State;

// ---------------------------------------------------------------------------
// Static wallpaper depth — history + folder-based rotation.
//
// The slideshow reuses the same "rotate on an interval" concept as the Lock
// Screen Designer; the folder you point it at IS a collection. No new gallery
// UI — the existing Wallpaper input in Makeover drives it.
// ---------------------------------------------------------------------------

use crate::error::AppError;
const HISTORY_CAP: usize = 100;

#[derive(Serialize, Deserialize, Clone)]
pub struct WallpaperHistoryEntry {
    pub ts: u64,
    pub path: String,
    pub monitor_id: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SlideshowConfig {
    pub enabled: bool,
    pub folder: String,
    pub interval_minutes: u32,
    pub shuffle: bool,
    pub next_rotation_ts: Option<u64>,
    pub last_applied: Option<String>,
    /// S11.5 — favorite paths (inside `folder`): weighted 3× in the rotation.
    #[serde(default)]
    pub favorites: Vec<String>,
    /// S11.5 — day/night preference: at night, prefer images whose name reads
    /// night (moon/dark/stars…); by day, day (sun/morning/bright…). Falls
    /// back to all images when nothing matches — honest, never a dead folder.
    #[serde(default)]
    pub day_night_filter: bool,
    /// S11.5 — cursor into the weighted sequence (sequential mode). Each
    /// favorite occupies 3 slots, so the rotation advances through them in
    /// deterministic order. `None` = start of the sequence.
    #[serde(default)]
    pub last_seq_index: Option<u32>,
}

impl Default for SlideshowConfig {
    fn default() -> Self {
        SlideshowConfig {
            enabled: false,
            folder: String::new(),
            interval_minutes: 30,
            shuffle: false,
            next_rotation_ts: None,
            last_applied: None,
            favorites: Vec::new(),
            day_night_filter: false,
            last_seq_index: None,
        }
    }
}

fn history_path(state: &AppState) -> PathBuf {
    state.data_dir.join("wallpaper_history.json")
}

fn slideshow_path(state: &AppState) -> PathBuf {
    state.data_dir.join("wallpaper_slideshow.json")
}

/// Append a wallpaper use to the history (newest first, capped).
pub fn record_history(state: &AppState, path: &str, monitor_id: Option<String>) {
    let mut history: Vec<WallpaperHistoryEntry> = load_json(&history_path(state), Vec::new());
    history.insert(
        0,
        WallpaperHistoryEntry {
            ts: now_millis(),
            path: path.to_string(),
            monitor_id,
        },
    );
    history.truncate(HISTORY_CAP);
    let _ = save_json(&history_path(state), &history);
}

// ---------------------------------------------------------------------------
// Image discovery (a folder of images = a collection)
// ---------------------------------------------------------------------------

const IMAGE_EXTS: &[&str] = &["jpg", "jpeg", "png", "bmp", "webp", "gif", "tif", "tiff"];

fn is_image(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| IMAGE_EXTS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

fn list_images(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.flatten() {
            let p = e.path();
            if p.is_file() && is_image(&p) {
                out.push(p);
            }
        }
    }
    out.sort();
    out
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_wallpaper_history(state: State<'_, AppState>) -> Vec<WallpaperHistoryEntry> {
    load_json(&history_path(&state), Vec::new())
}

#[tauri::command]
pub fn get_wallpaper_slideshow(state: State<'_, AppState>) -> SlideshowConfig {
    load_json(&slideshow_path(&state), SlideshowConfig::default())
}

#[tauri::command]
pub fn set_wallpaper_slideshow(
    state: State<'_, AppState>,
    cfg: SlideshowConfig,
) -> Result<SlideshowConfig, AppError> {
    let before: SlideshowConfig = load_json(&slideshow_path(&state), SlideshowConfig::default());
    if cfg.enabled && !cfg.folder.is_empty() {
        let dir = Path::new(&cfg.folder);
        if !dir.is_dir() {
            return Err(AppError::Command(format!(
                "Slideshow folder not found: {}",
                cfg.folder
            )));
        }
        if list_images(dir).is_empty() {
            return Err(AppError::Command(format!(
                "No supported images (jpg/png/bmp/webp/gif) found in: {}",
                cfg.folder
            )));
        }
    }
    let mut next = cfg;
    if next.enabled {
        next.next_rotation_ts = Some(next_rotation_after(&next, now_millis()));
    } else {
        next.next_rotation_ts = None;
    }
    save_json(&slideshow_path(&state), &next)?;
    undo::log_entry(
        &state,
        "wallpaper_slideshow",
        format!(
            "Wallpaper rotation {}",
            if next.enabled {
                format!(
                    "on (every {} min from {})",
                    next.interval_minutes, next.folder
                )
            } else {
                "off".into()
            }
        ),
        json!({ "enabled": next.enabled, "folder": next.folder, "interval_minutes": next.interval_minutes, "before": before }),
        true,
    )?;
    Ok(next)
}

// ---------------------------------------------------------------------------
// Rotation decision (pure — fake-clock testable, S3.11)
// ---------------------------------------------------------------------------

/// True when the slideshow is enabled and `now` has passed the next-rotation
/// deadline. Clock is injected so tests use a fake `now`.
pub fn rotation_due(cfg: &SlideshowConfig, now: u64) -> bool {
    cfg.enabled && cfg.next_rotation_ts.map(|t| now >= t).unwrap_or(false)
}

/// The next rotation deadline after an apply/change at `now` — the interval
/// change takes effect immediately (a 30→5 min edit fires 5 min from now, not
/// on the old 30-min schedule).
pub fn next_rotation_after(cfg: &SlideshowConfig, now: u64) -> u64 {
    now + (cfg.interval_minutes.max(1) as u64) * 60_000
}

/// How much a favorite outweighs a normal image in the rotation.
const FAVOR_WEIGHT: usize = 3;

const NIGHT_KEYS: &[&str] = &[
    "night", "moon", "dark", "dusk", "midnight", "stars", "starry", "galaxy", "nebula",
    "space", "aurora", "north", "twilight", "lunar", "cosmic",
];
const DAY_KEYS: &[&str] = &[
    "day", "sun", "sunrise", "sunset", "light", "morning", "bright", "dawn", "noon",
    "sky", "daylight", "golden", "afternoon",
];

fn name_matches(path: &Path, keys: &[&str]) -> bool {
    let name = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    keys.iter().any(|k| name.contains(k))
}

/// S11.5 — day/night preference. Night hours = 18:00–05:59. When the filter
/// is off, every image qualifies. When on, only images whose name matches the
/// current half of the day are candidates — but if none match, ALL images are
/// used (honest fallback: a folder of unnamed files is never a dead rotation).
pub fn filter_for_time(images: Vec<PathBuf>, now_min: u32, day_night: bool) -> Vec<PathBuf> {
    if !day_night {
        return images;
    }
    let night = !(6 * 60..18 * 60).contains(&now_min);
    let keys = if night { NIGHT_KEYS } else { DAY_KEYS };
    let matched: Vec<PathBuf> = images
        .iter()
        .filter(|p| name_matches(p, keys))
        .cloned()
        .collect();
    if matched.is_empty() {
        images
    } else {
        matched
    }
}

fn weight(cfg: &SlideshowConfig, p: &Path) -> usize {
    if cfg.favorites.iter().any(|f| f == &p.to_string_lossy()) {
        FAVOR_WEIGHT
    } else {
        1
    }
}

/// Weighted random pick (shuffle mode) — favorites are 3× more likely.
fn pick_shuffle(cfg: &SlideshowConfig, images: &[PathBuf]) -> Option<PathBuf> {
    if images.is_empty() {
        return None;
    }
    use rand::Rng;
    let total: usize = images.iter().map(|p| weight(cfg, p)).sum();
    let mut r = rand::thread_rng().gen_range(0..total);
    for p in images {
        let w = weight(cfg, p);
        if r < w {
            return Some(p.clone());
        }
        r -= w;
    }
    images.first().cloned()
}

/// Next pick in sequential mode, advancing the weighted-sequence cursor. Each
/// favorite occupies `FAVOR_WEIGHT` slots, so it comes around 3× more often
/// than a plain image, in deterministic order. Returns (path, next index).
pub fn next_seq_pick(cfg: &SlideshowConfig, images: &[PathBuf]) -> Option<(PathBuf, u32)> {
    if images.is_empty() {
        return None;
    }
    let mut seq: Vec<PathBuf> = Vec::new();
    for p in images {
        for _ in 0..weight(cfg, p) {
            seq.push(p.clone());
        }
    }
    let idx = match cfg.last_seq_index {
        Some(i) => ((i as usize + 1) % seq.len()) as u32,
        None => 0,
    };
    Some((seq[idx as usize].clone(), idx))
}

/// The full rotation decision for one tick — returns the image to apply, or
/// None when nothing should change: not enabled, not due, paused (battery
/// saver / fullscreen app), empty folder, or the only candidate is the
/// wallpaper already on screen (no duplicate applies). `now_min` is the local
/// wall-clock minute — injectable for the fake-clock tests (S11.5 day/night).
/// The full rotation decision for one tick — returns the image to apply, or
/// None when nothing should change: not enabled, not due, paused (battery
/// saver / fullscreen app), empty folder, or the only candidate is the
/// wallpaper already on screen (no duplicate applies). `now_min` is the local
/// wall-clock minute — injectable for the fake-clock tests (S11.5 day/night).
/// `cfg` is `&mut` because sequential mode advances the weighted-sequence
/// cursor (`last_seq_index`) as part of the decision.
pub fn rotation_decision(
    cfg: &mut SlideshowConfig,
    images: &[PathBuf],
    now: u64,
    now_min: u32,
    paused: bool,
) -> Option<PathBuf> {
    if !cfg.enabled || cfg.folder.is_empty() || paused {
        return None;
    }
    if !rotation_due(cfg, now) {
        return None;
    }
    if images.is_empty() {
        return None;
    }
    let pool = filter_for_time(images.to_vec(), now_min, cfg.day_night_filter);
    if pool.is_empty() {
        return None;
    }
    // no duplicate applies: a single-image folder has nothing new to show, so
    // don't re-apply the same wallpaper (and spam history) every interval
    if pool.len() == 1
        && cfg.last_applied.as_deref() == Some(pool[0].to_string_lossy().as_ref())
    {
        return None;
    }
    let picked = if cfg.shuffle {
        let mut p = pick_shuffle(cfg, &pool)?;
        // shuffle can land on the current wallpaper — retry once for variety
        if pool.len() > 1 && p.to_string_lossy().as_ref() == cfg.last_applied.as_deref().unwrap_or("") {
            p = pick_shuffle(cfg, &pool)?;
        }
        p
    } else {
        let (p, idx) = next_seq_pick(cfg, &pool)?;
        cfg.last_seq_index = Some(idx);
        p
    };
    Some(picked)
}

/// S11.5 — "Skip now": apply the next image immediately (no due check),
/// honoring favorites + day/night, and restart the interval clock.
#[tauri::command]
pub fn skip_slideshow(state: State<'_, AppState>) -> Result<String, AppError> {
    let mut cfg: SlideshowConfig = load_json(&slideshow_path(&state), SlideshowConfig::default());
    if !cfg.enabled || cfg.folder.is_empty() {
        return Err(AppError::Command(
            "Slideshow is not enabled — nothing to skip".into(),
        ));
    }
    let images = list_images(Path::new(&cfg.folder));
    let now_min = crate::storage::local_minutes();
    let pool = filter_for_time(images.clone(), now_min, cfg.day_night_filter);
    if pool.is_empty() {
        return Err(AppError::Command(
            "No supported images (jpg/png/bmp/webp/gif) found in the slideshow folder".into(),
        ));
    }
    if pool.len() == 1
        && cfg.last_applied.as_deref() == Some(pool[0].to_string_lossy().as_ref())
    {
        return Err(AppError::Command(
            "Only one image — nothing new to skip to".into(),
        ));
    }
    let picked = if cfg.shuffle {
        let mut p = pick_shuffle(&cfg, &pool).ok_or_else(|| {
            AppError::Command("Could not pick the next wallpaper".into())
        })?;
        if pool.len() > 1
            && p.to_string_lossy().as_ref() == cfg.last_applied.as_deref().unwrap_or("")
        {
            // shuffle can land on the current wallpaper — retry once
            p = pick_shuffle(&cfg, &pool).ok_or_else(|| {
                AppError::Command("No other image to skip to".into())
            })?;
            if p.to_string_lossy().as_ref() == cfg.last_applied.as_deref().unwrap_or("") {
                return Err(AppError::Command("No other image to skip to".into()));
            }
        }
        p
    } else {
        let (p, idx) = next_seq_pick(&cfg, &pool).ok_or_else(|| {
            AppError::Command("Could not pick the next wallpaper".into())
        })?;
        cfg.last_seq_index = Some(idx);
        p
    };
    let picked_str = picked.to_string_lossy().to_string();
    if crate::wallpaper::apply_wallpaper_raw(&picked_str).is_ok() {
        record_history(&state, &picked_str, None);
        cfg.last_applied = Some(picked_str.clone());
        cfg.next_rotation_ts = Some(next_rotation_after(&cfg, now_millis()));
        save_json(&slideshow_path(&state), &cfg)?;
        Ok(format!("Skipped to {}", picked_str))
    } else {
        Err(AppError::Command(
            "Could not apply the next wallpaper".into(),
        ))
    }
}

// ---------------------------------------------------------------------------
// Rotation thread (started in setup)
// ---------------------------------------------------------------------------

pub fn spawn_rotation(state: AppState) {
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(15));
        let mut cfg: SlideshowConfig =
            load_json(&slideshow_path(&state), SlideshowConfig::default());
        if !cfg.enabled || cfg.folder.is_empty() {
            continue;
        }
        let now = now_millis();
        let now_min = crate::storage::local_minutes();
        // pause on battery saver / fullscreen app — same signal as the engine
        let paused = crate::wallpaper_engine::rotation_paused();
        let images = list_images(Path::new(&cfg.folder));
        let Some(picked) = rotation_decision(&mut cfg, &images, now, now_min, paused) else {
            continue;
        };
        let picked_str = picked.to_string_lossy().to_string();
        if crate::wallpaper::apply_wallpaper_raw(&picked_str).is_ok() {
            record_history(&state, &picked_str, None);
            cfg.last_applied = Some(picked_str);
            cfg.next_rotation_ts = Some(next_rotation_after(&cfg, now));
            let _ = save_json(&slideshow_path(&state), &cfg);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(enabled: bool, interval_minutes: u32, last: Option<&str>) -> SlideshowConfig {
        SlideshowConfig {
            enabled,
            folder: "C:/Wallpapers".into(),
            interval_minutes,
            shuffle: false,
            next_rotation_ts: Some(1_000_000),
            last_applied: last.map(|s| s.to_string()),
            favorites: Vec::new(),
            day_night_filter: false,
            last_seq_index: None,
        }
    }

    fn imgs(names: &[&str]) -> Vec<PathBuf> {
        names
            .iter()
            .map(|n| PathBuf::from(format!("C:/Wallpapers/{}", n)))
            .collect()
    }

    fn s(p: &Path) -> String {
        p.to_string_lossy().to_string()
    }

    #[test]
    fn rotation_due_uses_the_injected_clock() {
        let c = cfg(true, 30, None);
        assert!(!rotation_due(&c, 999_999)); // just before the deadline
        assert!(rotation_due(&c, 1_000_000)); // exactly due
        assert!(rotation_due(&c, 2_000_000)); // overdue
        assert!(!rotation_due(&cfg(false, 30, None), 2_000_000)); // disabled never fires
    }

    #[test]
    fn not_due_or_paused_means_no_rotation() {
        let im = imgs(&["a.jpg", "b.jpg"]);
        let mut c = cfg(true, 30, None);
        assert_eq!(rotation_decision(&mut c, &im, 999_999, 12 * 60, false), None); // not due
        assert_eq!(rotation_decision(&mut c, &im, 2_000_000, 12 * 60, true), None); // paused
        assert_eq!(rotation_decision(&mut cfg(false, 30, None), &im, 2_000_000, 12 * 60, false), None); // disabled
        assert_eq!(rotation_decision(&mut c, &[], 2_000_000, 12 * 60, false), None); // empty folder
    }

    #[test]
    fn sequential_rotation_advances_and_wraps() {
        let im = imgs(&["a.jpg", "b.jpg", "c.jpg"]);
        let mut c = cfg(true, 30, None);
        assert_eq!(s(&rotation_decision(&mut c, &im, 2_000_000, 12 * 60, false).unwrap()), "C:/Wallpapers/a.jpg");
        c.last_applied = Some("C:/Wallpapers/a.jpg".into());
        assert_eq!(s(&rotation_decision(&mut c, &im, 3_000_000, 12 * 60, false).unwrap()), "C:/Wallpapers/b.jpg");
        c.last_applied = Some("C:/Wallpapers/b.jpg".into());
        assert_eq!(s(&rotation_decision(&mut c, &im, 4_000_000, 12 * 60, false).unwrap()), "C:/Wallpapers/c.jpg");
        c.last_applied = Some("C:/Wallpapers/c.jpg".into());
        assert_eq!(s(&rotation_decision(&mut c, &im, 5_000_000, 12 * 60, false).unwrap()), "C:/Wallpapers/a.jpg");
    }

    #[test]
    fn single_image_folder_never_reapplies_the_same_wallpaper() {
        let im = imgs(&["only.jpg"]);
        // first rotation applies it
        let mut c = cfg(true, 30, None);
        assert_eq!(s(&rotation_decision(&mut c, &im, 2_000_000, 12 * 60, false).unwrap()), "C:/Wallpapers/only.jpg");
        // next rotation has nothing new — no duplicate apply, no history spam
        c.last_applied = Some("C:/Wallpapers/only.jpg".into());
        assert_eq!(rotation_decision(&mut c, &im, 3_000_000, 12 * 60, false), None);
    }

    #[test]
    fn interval_change_takes_effect_immediately() {
        let mut c = cfg(true, 30, None);
        // a 5-min change at t=5_000_000 fires at t+5min, not on the old 30-min cadence
        c.interval_minutes = 5;
        c.next_rotation_ts = Some(next_rotation_after(&c, 5_000_000));
        assert_eq!(c.next_rotation_ts, Some(5_000_000 + 5 * 60_000));
        assert!(!rotation_due(&c, 5_000_000 + 5 * 60_000 - 1));
        assert!(rotation_due(&c, 5_000_000 + 5 * 60_000));
    }

    #[test]
    fn shuffle_always_picks_from_the_folder() {
        let mut c = cfg(true, 30, Some("C:/Wallpapers/b.jpg"));
        c.shuffle = true;
        let im = imgs(&["a.jpg", "b.jpg", "c.jpg", "d.jpg"]);
        for _ in 0..50 {
            let p = rotation_decision(&mut c, &im, 2_000_000, 12 * 60, false).unwrap();
            assert!(im.contains(&p), "pick {} not in folder", s(&p));
        }
    }

    #[test]
    fn favorites_are_weighted_three_times_in_sequential_mode() {
        let mut c = cfg(true, 30, None);
        c.favorites = vec!["C:/Wallpapers/b.jpg".into()];
        let im = imgs(&["a.jpg", "b.jpg", "c.jpg"]);
        // weighted sequence = [a, b, b, b, c] — b (the favorite) occupies 3
        // of the 5 slots, so over a cycle it comes around 3× more often
        assert_eq!(s(&rotation_decision(&mut c, &im, 2_000_000, 12 * 60, false).unwrap()), "C:/Wallpapers/a.jpg");
        assert_eq!(s(&rotation_decision(&mut c, &im, 3_000_000, 12 * 60, false).unwrap()), "C:/Wallpapers/b.jpg");
        assert_eq!(s(&rotation_decision(&mut c, &im, 4_000_000, 12 * 60, false).unwrap()), "C:/Wallpapers/b.jpg");
        assert_eq!(s(&rotation_decision(&mut c, &im, 5_000_000, 12 * 60, false).unwrap()), "C:/Wallpapers/b.jpg");
        assert_eq!(s(&rotation_decision(&mut c, &im, 6_000_000, 12 * 60, false).unwrap()), "C:/Wallpapers/c.jpg");
        // wraps back to the start of the weighted sequence, cursor resets
        assert_eq!(s(&rotation_decision(&mut c, &im, 7_000_000, 12 * 60, false).unwrap()), "C:/Wallpapers/a.jpg");
        assert_eq!(c.last_seq_index, Some(0));
    }

    #[test]
    fn day_night_filter_prefers_matching_names_and_falls_back_honestly() {
        let mut c = cfg(true, 30, None);
        c.day_night_filter = true;
        let im = imgs(&["mountain-day.jpg", "moonlight.jpg", "plain.jpg"]);
        // 14:00 (day) → only day-named image qualifies
        let day_pick = rotation_decision(&mut c, &im, 2_000_000, 14 * 60, false).unwrap();
        assert_eq!(s(&day_pick), "C:/Wallpapers/mountain-day.jpg");
        // 22:00 (night) → only night-named image qualifies
        let night_pick = rotation_decision(&mut c, &im, 2_000_000, 22 * 60, false).unwrap();
        assert_eq!(s(&night_pick), "C:/Wallpapers/moonlight.jpg");
        // no matching names → honest fallback to the whole folder (never dead)
        let mut c2 = cfg(true, 30, None);
        c2.day_night_filter = true;
        let im2 = imgs(&["img-1.jpg", "img-2.jpg"]);
        let picked = rotation_decision(&mut c2, &im2, 2_000_000, 22 * 60, false).unwrap();
        assert!(im2.contains(&picked));
        // filter off → everything qualifies at any hour
        let picked_off = rotation_decision(&mut cfg(true, 30, None), &im, 2_000_000, 22 * 60, false).unwrap();
        assert_eq!(s(&picked_off), "C:/Wallpapers/mountain-day.jpg");
    }

    #[test]
    fn filter_for_time_night_bounds() {
        let im = imgs(&["moon.jpg", "sun.jpg"]);
        // 17:59 is day; 18:00 is night; 05:59 is night; 06:00 is day
        assert_eq!(filter_for_time(im.clone(), 17 * 60 + 59, true).len(), 1);
        assert_eq!(s(&filter_for_time(im.clone(), 18 * 60, true)[0]), "C:/Wallpapers/moon.jpg");
        assert_eq!(s(&filter_for_time(im.clone(), 5 * 60 + 59, true)[0]), "C:/Wallpapers/moon.jpg");
        assert_eq!(s(&filter_for_time(im.clone(), 6 * 60, true)[0]), "C:/Wallpapers/sun.jpg");
        // filter off passes everything through untouched
        assert_eq!(filter_for_time(im.clone(), 12 * 60, false).len(), 2);
    }
}
