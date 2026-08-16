//! Startup restore matrix (S8.7): one pure planner + one executor that
//! re-applies the scene/video wallpaper, visible widgets, and blue-light
//! across a simulated reboot.
//!
//! `plan_restore` reads the three persisted state files (engine, widgets,
//! automation) with zero side effects, so a "reboot" is unit-testable:
//! write the state files, plan, and assert the plan consumed them.
//! `execute_restore` is the single boot path that spawns what the plan says.

use crate::automation::AutomationConfig;
use crate::state::AppState;
use crate::storage::load_json;
use crate::wallpaper_engine::{EngineState, SceneConfig, VideoWallpaper};
use crate::widgets::WidgetConfig;
use serde::Serialize;
use std::path::Path;
use tauri::AppHandle;

#[derive(Clone, Serialize)]
pub struct RestorePlan {
    pub scene: Option<SceneConfig>,
    pub video: Option<VideoWallpaper>,
    pub widgets: Vec<WidgetConfig>,
    pub blue_light_on: bool,
    pub blue_light_intensity: f32,
    /// S11.2 — auto-style at login: the full last-applied style payload when
    /// `auto_reapply_theme` is on. Re-applied theme components + static
    /// wallpaper at boot; scene/video already restores via the engine state.
    pub auto_style: Option<crate::styles::AppliedStyleRecord>,
}

impl RestorePlan {
    /// Nothing to restore — a clean boot.
    pub fn is_empty(&self) -> bool {
        self.scene.is_none()
            && self.video.is_none()
            && self.widgets.is_empty()
            && !self.blue_light_on
            && self.auto_style.is_none()
    }
}

/// Pure: read the engine / widgets / automation state files and build the
/// restore plan. Scene + video only count when the engine was left `active`
/// (a stopped engine must not resurrect itself on reboot).
pub fn plan_restore(data_dir: &Path) -> RestorePlan {
    let eng: EngineState = load_json(&data_dir.join("wallpaper_engine.json"), EngineState::default());
    let widgets: Vec<WidgetConfig> = load_json(&data_dir.join("widgets.json"), Vec::new());
    let auto: AutomationConfig = load_json(&data_dir.join("automation.json"), AutomationConfig::default());
    RestorePlan {
        scene: if eng.active { eng.scene } else { None },
        video: if eng.active { eng.media } else { None },
        widgets: widgets.into_iter().filter(|w| w.visible).collect(),
        blue_light_on: auto.blue_light_on,
        blue_light_intensity: auto.blue_light_intensity,
        auto_style: if auto.auto_reapply_theme {
            crate::styles::load_applied_style(data_dir)
        } else {
            None
        },
    }
}

/// Consume a plan: re-open the scene/video wallpaper, re-open visible
/// widgets, re-apply the blue-light gamma ramp, and re-apply the saved style's
/// theme layer (S11.2). Runs on the main thread (window creation requires it).
pub fn execute_restore(app: &AppHandle, data_dir: &Path, plan: RestorePlan) {
    if plan.is_empty() {
        return;
    }
    if let Some(video) = plan.video {
        let _ = crate::wallpaper_video::start_video(app, &video);
    } else if let Some(scene) = plan.scene {
        let _ = crate::wallpaper_engine::open_window(app, &scene, None);
    }
    for w in plan.widgets {
        let _ = crate::widgets::open_widget(app, &w);
    }
    if plan.blue_light_on {
        let _ = crate::automation::apply_blue_light_raw(plan.blue_light_intensity);
    }
    if let Some(rec) = plan.auto_style {
        let st = AppState {
            data_dir: data_dir.to_path_buf(),
        };
        let _ = crate::styles::reapply_theme_components(Some(app), &st, &rec.payload);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// A scratch data dir per test — the "machine" being rebooted. Keyed by a
    /// monotonic counter because Rust runs tests in the module in parallel.
    fn scratch_dir() -> std::path::PathBuf {
        use std::sync::atomic::{AtomicU32, Ordering};
        static N: AtomicU32 = AtomicU32::new(0);
        let dir = std::env::temp_dir().join(format!(
            "reforge-restore-{}-{}",
            std::process::id(),
            N.fetch_add(1, Ordering::SeqCst)
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn scene(id: &str) -> SceneConfig {
        SceneConfig {
            id: id.into(),
            name: id.into(),
            kind: "aurora".into(),
            mood: "calm".into(),
            speed: 1.0,
            density: 1.0,
            colors: vec!["#0f172a".into(), "#22d3ee".into()],
        }
    }

    fn video() -> VideoWallpaper {
        VideoWallpaper {
            path: r"C:\Users\you\Videos\aurora.mp4".into(),
            kind: "video".into(),
            width: 1920,
            height: 1080,
            name: "aurora".into(),
        }
    }

    fn widget(visible: bool) -> WidgetConfig {
        WidgetConfig {
            id: "w1".into(),
            kind: "clock".into(),
            x: 60.0,
            y: 60.0,
            w: 220.0,
            h: 120.0,
            title: "Clock".into(),
            content: "".into(),
            visible,
            monitor: 0,
        }
    }

    /// Simulated reboot: state files survive in the data dir, then the app
    /// relaunches and plans what to restore from them.
    #[test]
    fn simulated_reboot_plans_everything_persisted() {
        let dir = scratch_dir();

        let eng = EngineState {
            active: true,
            frozen: false,
            scene: Some(scene("aurora")),
            media: Some(video()),
            static_wallpaper: "".into(),
        };
        crate::storage::save_json(&dir.join("wallpaper_engine.json"), &eng).unwrap();

        let auto = AutomationConfig {
            weekly_junk: true,
            monthly_dupes: false,
            auto_reapply_theme: true,
            last_weekly_run: 0,
            last_monthly_run: 0,
            blue_light_on: true,
            blue_light_intensity: 0.42,
            blue_light_schedule: false,
            blue_light_start: "19:00".into(),
            blue_light_end: "07:00".into(),
            style_schedule: Vec::new(),
            created_at: 0,
            last_storage_clean: 0,
        };
        crate::storage::save_json(&dir.join("automation.json"), &auto).unwrap();

        crate::storage::save_json(&dir.join("widgets.json"), &vec![widget(true), widget(false)]).unwrap();

        let plan = plan_restore(&dir);
        assert_eq!(plan.scene.as_ref().unwrap().id, "aurora", "scene consumed from engine state");
        assert_eq!(plan.video.as_ref().unwrap().name, "aurora", "video consumed from engine state");
        assert_eq!(plan.widgets.len(), 1, "only visible widgets restore");
        assert!(plan.blue_light_on);
        assert_eq!(plan.blue_light_intensity, 0.42);
        assert!(!plan.is_empty());
    }

    #[test]
    fn stopped_engine_does_not_resurrect() {
        let dir = scratch_dir();
        let eng = EngineState {
            active: false, // user stopped it before reboot
            frozen: false,
            scene: Some(scene("aurora")),
            media: Some(video()),
            static_wallpaper: "".into(),
        };
        crate::storage::save_json(&dir.join("wallpaper_engine.json"), &eng).unwrap();
        let plan = plan_restore(&dir);
        assert!(plan.scene.is_none());
        assert!(plan.video.is_none());
    }

    #[test]
    fn clean_machine_has_empty_plan() {
        let dir = scratch_dir();
        let plan = plan_restore(&dir);
        assert!(plan.is_empty());
        assert!(plan.widgets.is_empty());
        assert!(!plan.blue_light_on);
    }
}
