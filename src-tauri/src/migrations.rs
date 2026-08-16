//! S12.5 — Versioned state + migration runner.
//!
//! State files live loose in the data dir; `schema_version.json` stamps the
//! schema they were written under. On boot, `run_migrations` applies every
//! pending migration in order (migration N takes version N → N+1) and stamps
//! the new version, so a future schema change never ships blind: the old file
//! is migrated before any code reads it.
//!
//! Migrations must be idempotent (a crash mid-run restarts from the stamped
//! version, and the next boot re-runs only the pending ones).

use crate::state::AppState;
use crate::storage::{load_json, save_json};
use serde::{Deserialize, Serialize};

use crate::error::AppError;

const VERSION_FILE: &str = "schema_version.json";

#[derive(Serialize, Deserialize, Clone)]
pub struct SchemaVersion {
    pub version: u32,
}

/// The schema the current code writes. Bump + append a migration when a state
/// file's shape changes.
pub const CURRENT_SCHEMA_VERSION: u32 = 1;

/// The version stamped when the file is absent (pre-versioning installs).
const UNVERSIONED: u32 = 0;

pub type Migration = fn(&AppState);

/// Ordered migration list: `MIGRATIONS[i]` migrates version `i` → `i + 1`.
const MIGRATIONS: &[Migration] = &[migrate_v0_to_v1];

/// v0 → v1: S11 added the blue-light schedule / style-schedule / created_at
/// fields to automation.json (serde-default, so old files load), but a
/// pre-versioning install's `created_at` is 0 — backfill it so the
/// maintenance scheduler's 24h first-run grace has a deterministic anchor
/// ("24h after the user first ran Reforge", not "24h after the upgrade").
fn migrate_v0_to_v1(state: &AppState) {
    let path = state.data_dir.join("automation.json");
    if !path.exists() {
        // No file = fresh install: don't fabricate one. The automation module
        // writes its own defaults on first change, and the maintenance
        // scheduler anchors created_at on the first manual run (see
        // automation.rs) — a clean machine needs no backfill.
        return;
    }
    let mut cfg: crate::automation::AutomationConfig =
        load_json(&path, crate::automation::AutomationConfig::default());
    if cfg.created_at == 0 {
        cfg.created_at = crate::storage::now_millis();
        let _ = save_json(&path, &cfg);
    }
}

/// The stamped schema version (0 when the file is absent).
pub fn current_version(state: &AppState) -> u32 {
    load_json(&state.data_dir.join(VERSION_FILE), SchemaVersion { version: UNVERSIONED }).version
}

/// Run every pending migration in order and stamp the result. Idempotent:
/// running it again on an already-migrated dir is a no-op.
pub fn run_migrations(state: &AppState) -> Result<u32, AppError> {
    // Lockstep guard: bumping CURRENT_SCHEMA_VERSION without adding a
    // migration (or vice versa) is a schema bug — fail loudly at boot.
    if MIGRATIONS.len() as u32 != CURRENT_SCHEMA_VERSION {
        return Err(AppError::Command(format!(
            "schema version mismatch: {CURRENT_SCHEMA_VERSION} declared but {} migrations defined",
            MIGRATIONS.len()
        )));
    }
    let mut v = current_version(state);
    while (v as usize) < MIGRATIONS.len() {
        MIGRATIONS[v as usize](state);
        v += 1;
        save_json(&state.data_dir.join(VERSION_FILE), &SchemaVersion { version: v })?;
    }
    Ok(v)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn scratch_dir() -> std::path::PathBuf {
        use std::sync::atomic::{AtomicU32, Ordering};
        static N: AtomicU32 = AtomicU32::new(0);
        let dir = std::env::temp_dir().join(format!(
            "reforge-migrations-{}-{}",
            std::process::id(),
            N.fetch_add(1, Ordering::SeqCst)
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn state(dir: &std::path::Path) -> AppState {
        AppState {
            data_dir: dir.to_path_buf(),
        }
    }

    /// An old-shape automation.json (pre-S11: no created_at) — the migration
    /// fixture a "pre-versioning install" leaves behind.
    fn write_legacy_automation(dir: &std::path::Path) {
        fs::write(
            dir.join("automation.json"),
            r#"{"weekly_junk":true,"monthly_dupes":false,"auto_reapply_theme":true,"last_weekly_run":0,"last_monthly_run":0,"blue_light_on":false,"blue_light_intensity":0.3}"#,
        )
        .unwrap();
    }

    #[test]
    fn unversioned_install_is_migrated_and_stamped() {
        let dir = scratch_dir();
        write_legacy_automation(&dir);

        let v = run_migrations(&state(&dir)).unwrap();
        assert_eq!(v, CURRENT_SCHEMA_VERSION);
        assert_eq!(current_version(&state(&dir)), CURRENT_SCHEMA_VERSION);

        // the backfill landed: created_at is now set (first-run grace anchor)
        let cfg: crate::automation::AutomationConfig =
            load_json(&dir.join("automation.json"), crate::automation::AutomationConfig::default());
        assert!(cfg.created_at > 0, "created_at backfilled by v1 migration");
        assert!(cfg.weekly_junk, "existing fields preserved");
    }

    #[test]
    fn already_migrated_dir_is_a_noop() {
        let dir = scratch_dir();
        write_legacy_automation(&dir);
        let st = state(&dir);
        run_migrations(&st).unwrap();
        let created = load_json::<crate::automation::AutomationConfig>(
            &dir.join("automation.json"),
            crate::automation::AutomationConfig::default(),
        )
        .created_at;

        // run again — version stays, created_at untouched (idempotent)
        let v2 = run_migrations(&st).unwrap();
        assert_eq!(v2, CURRENT_SCHEMA_VERSION);
        let created2 = load_json::<crate::automation::AutomationConfig>(
            &dir.join("automation.json"),
            crate::automation::AutomationConfig::default(),
        )
        .created_at;
        assert_eq!(created, created2);
    }

    #[test]
    fn clean_machine_is_stamped_without_touching_missing_files() {
        let dir = scratch_dir(); // no automation.json at all
        let v = run_migrations(&state(&dir)).unwrap();
        assert_eq!(v, CURRENT_SCHEMA_VERSION);
        // migration must not CREATE automation.json out of thin air
        assert!(!dir.join("automation.json").exists());
    }
}
