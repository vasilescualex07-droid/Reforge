// Style favorites (A2.1). Persisted in the app data dir as a real file rather
// than webview localStorage — same durability argument as onboarding.rs: the
// favorites must survive origin changes and rebuilds.
//
// The frontend sends style ids it already displays (internal identifiers);
// they are still treated as untrusted input: length-capped, and only the
// presence/absence toggle is stored, never rendered or executed.

use crate::state::AppState;
use crate::storage::{load_json, save_json};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::State;

use crate::error::AppError;
#[derive(Serialize, Deserialize, Default, Clone)]
pub struct FavoritesState {
    /// Style ids the user starred, in insertion order.
    #[serde(default)]
    pub ids: Vec<String>,
}

fn favorites_path(state: &AppState) -> PathBuf {
    state.data_dir.join("favorites.json")
}

fn validate_id(id: &str) -> Result<(), AppError> {
    if id.is_empty() || id.len() > 64 {
        return Err(AppError::Invalid("Invalid style id".to_string()));
    }
    // Style ids are internal identifiers — restrict to [a-z0-9-] so a
    // compromised webview can never smuggle a path or shell metacharacter
    // into storage or an undo entry (Standard A §6: paths validated).
    if !id
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        return Err(AppError::Invalid("Invalid style id".to_string()));
    }
    Ok(())
}

/// Pure toggle — presence/absence only, idempotent, insertion-order stable.
fn toggle(ids: &mut Vec<String>, id: &str, fav: bool) {
    if fav {
        if !ids.iter().any(|x| x == id) {
            ids.push(id.to_string());
        }
    } else {
        ids.retain(|x| x != id);
    }
}

#[tauri::command]
pub fn get_favorites(state: State<'_, AppState>) -> Vec<String> {
    let f: FavoritesState = load_json(&favorites_path(&state), FavoritesState::default());
    f.ids
}

#[tauri::command]
pub fn set_favorite(
    state: State<'_, AppState>,
    id: String,
    fav: bool,
) -> Result<Vec<String>, AppError> {
    validate_id(&id)?;
    let mut f: FavoritesState = load_json(&favorites_path(&state), FavoritesState::default());
    toggle(&mut f.ids, &id, fav);
    save_json(&favorites_path(&state), &f)?;
    Ok(f.ids)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_hostile_ids() {
        assert!(validate_id("wp-blue-aurora-natural").is_ok());
        assert!(validate_id("").is_err());
        assert!(validate_id(&"x".repeat(65)).is_err());
        assert!(validate_id("wp-../../etc/passwd").is_err());
        assert!(validate_id("wp-a b c").is_err());
    }

    #[test]
    fn toggle_is_idempotent_and_stable() {
        let mut ids = vec!["b".to_string(), "a".to_string()];
        toggle(&mut ids, "a", true); // already present — no dup
        assert_eq!(ids, vec!["b".to_string(), "a".to_string()]);
        toggle(&mut ids, "c", true);
        assert_eq!(ids, vec!["b".to_string(), "a".to_string(), "c".to_string()]);
        toggle(&mut ids, "a", false);
        assert_eq!(ids, vec!["b".to_string(), "c".to_string()]);
    }

    #[test]
    fn persists_across_loads() {
        let dir = std::env::temp_dir().join(format!("reforge-fav-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let state = AppState {
            data_dir: dir.clone(),
        };
        let path = favorites_path(&state);
        let mut f: FavoritesState = load_json(&path, FavoritesState::default());
        toggle(&mut f.ids, "wp-a-natural", true);
        save_json(&path, &f).unwrap();
        let reloaded: FavoritesState = load_json(&path, FavoritesState::default());
        assert_eq!(reloaded.ids, vec!["wp-a-natural"]);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
