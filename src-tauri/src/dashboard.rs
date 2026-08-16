use crate::state::AppState;
use crate::storage::load_json;
use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
pub struct DashboardMetrics {
    pub personalization_score: u32,
    pub storage_freed: u64,
    pub files_organized: u64,
    pub time_saved_secs: u64,
    pub active_features: Vec<String>,
}

#[tauri::command]
pub fn get_dashboard_metrics(state: State<'_, AppState>) -> DashboardMetrics {
    let entries = crate::undo::load_undo_entries(&state);
    let mut storage_freed = 0u64;
    let mut files_organized = 0u64;
    let mut active: Vec<String> = Vec::new();

    for e in &entries {
        match e.kind.as_str() {
            "junk_clean" | "trash_emptied" => {
                if let Some(f) = e.data.get("freed").and_then(|v| v.as_u64()) {
                    storage_freed += f;
                }
            }
            "downloads_expired" => {
                if let Some(f) = e.data.get("freed").and_then(|v| v.as_u64()) {
                    storage_freed += f;
                }
            }
            "archive" => {
                if let Some(m) = e.data.get("moves").and_then(|v| v.as_array()) {
                    files_organized += m.len() as u64;
                }
            }
            "sort" => {
                if let Some(m) = e.data.get("moves").and_then(|v| v.as_array()) {
                    files_organized += m.len() as u64;
                }
            }
            "rename" => {
                if let Some(o) = e.data.get("ops").and_then(|v| v.as_array()) {
                    files_organized += o.len() as u64;
                }
            }
            _ => {}
        }
    }

    // personalization: count active makeover features
    let eng: crate::wallpaper_engine::EngineState = load_json(
        &state.data_dir.join("wallpaper_engine.json"),
        crate::wallpaper_engine::EngineState::default(),
    );
    if eng.active {
        active.push("Animated wallpaper".into());
    }
    let theme: serde_json::Value = load_json(
        &state.data_dir.join("theme_state.json"),
        serde_json::json!({}),
    );
    let accent = theme
        .get("accent_hex")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if !accent.is_empty() && accent.to_lowercase() != "#6d7cff" {
        active.push(format!("Custom accent {}", accent));
    }
    let widgets: Vec<serde_json::Value> =
        load_json(&state.data_dir.join("widgets.json"), Vec::new());
    if !widgets.is_empty() {
        active.push(format!("{} desktop widget(s)", widgets.len()));
    }
    let automation: crate::automation::AutomationConfig = load_json(
        &state.data_dir.join("automation.json"),
        crate::automation::AutomationConfig::default(),
    );
    if automation.blue_light_on {
        active.push("Blue light filter".into());
    }
    if automation.weekly_junk {
        active.push("Scheduled maintenance".into());
    }
    let macros: Vec<serde_json::Value> = load_json(&state.data_dir.join("macros.json"), Vec::new());
    if !macros.is_empty() {
        active.push(format!("{} automation macro(s)", macros.len()));
    }
    // Cursors live in the registry (HKCU Control Panel\Cursors), not in a
    // cursors.json file — read the real state so "Custom cursor scheme"
    // actually shows up after a scheme is applied.
    if !crate::cursors::read_cursor_state().scheme_source.is_empty() {
        active.push("Custom cursor scheme".into());
    }

    let base = 30u32;
    let feats = (active.len() as u32) * 10;
    let personalization_score = (base + feats).min(100);

    let time_saved_secs = files_organized * 4 + storage_freed / (1024 * 1024) * 3;

    DashboardMetrics {
        personalization_score,
        storage_freed,
        files_organized,
        time_saved_secs,
        active_features: active,
    }
}
