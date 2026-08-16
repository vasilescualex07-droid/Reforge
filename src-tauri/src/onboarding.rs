// Onboarding state (welcome wizard). Persisted in the app data dir as a real
// file rather than webview `localStorage`: localStorage is scoped to the
// webview origin, which changed between builds (localhost devUrl -> custom
// protocol), so a localStorage-only flag reappears on every launch.
//
// The value is deliberately a tiny JSON object so the file is human-readable
// and future onboarding milestones can reuse it.

use crate::state::AppState;
use crate::storage::{load_json, save_json};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::State;

use crate::error::AppError;
#[derive(Serialize, Deserialize, Default, Clone)]
pub struct OnboardingState {
    /// Set once the "Welcome to Reforge" wizard has been shown/dismissed.
    #[serde(default)]
    pub wizard_seen: bool,
}

fn onboarding_path(state: &AppState) -> PathBuf {
    state.data_dir.join("onboarding.json")
}

#[tauri::command]
pub fn get_onboarding_state(state: State<'_, AppState>) -> OnboardingState {
    load_json(&onboarding_path(&state), OnboardingState::default())
}

#[tauri::command]
pub fn set_onboarding_state(
    state: State<'_, AppState>,
    onb: OnboardingState,
) -> Result<(), AppError> {
    save_json(&onboarding_path(&state), &onb)
}
