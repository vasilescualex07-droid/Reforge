//! Fun-widgets module (the "Widgets" hub): 12 toggleable gag/fun overlays.
//!
//! Structure mirrors the codebase conventions:
//! - `fun/mod.rs` — persisted store (enabled set, per-widget configs,
//!   achievement unlocks, lifetime counters), Tauri commands, global-hotkey
//!   sync, event emission, and the hooks other modules call (force-quit /
//!   completion counting).
//! - `fun/overlay.rs` — overlay window manager (transparent/borderless /
//!   always-on-top windows, multi-monitor aware).
//! - `fun/screen.rs` — screen-capture utility (GDI BitBlt → base64 PNG) used
//!   by Rage Shatter and Glitch Jumpscare.
//! - `fun/stats.rs` — background system-stats hooks (CPU poll, idle time via
//!   GetLastInputInfo, session uptime, process count) that emit `fun:stats`
//!   events only while widgets need them (resource hygiene §7: all-off ≈ zero).
//!
//! Resource-hygiene contract (widgets spec §7): the stats poll thread spins
//! down to a 2s no-op sleep when no widget is enabled; per-widget hotkeys are
//! unregistered the moment a widget is disabled; overlay windows are closed
//! (not hidden) on disable. The frontend owns all overlay HTML; Rust only
//! writes it to disk and spawns the window, so toggling off is a real teardown
//! of listeners/timers/windows, not a UI hide.
pub mod overlay;
pub mod screen;
pub mod stats;

use crate::error::AppError;
use crate::state::AppState;
use crate::storage::{load_json, save_json};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::str::FromStr;
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

// ---- app-handle bridge ----------------------------------------------------
// Commands that only receive `State<AppState>` (cleanup, maintenance) still
// need to emit completion events; the handle is parked here once at setup.
static APP: OnceLock<Mutex<Option<AppHandle>>> = OnceLock::new();

/// Serializes overlay spawns: async commands run concurrently, and two spawns
/// of the same label (boot reconcile double-fire) must not interleave their
/// existence-check / close / build — see `fun_spawn_overlay`.
static OVERLAY_SPAWN: OnceLock<tauri::async_runtime::Mutex<()>> = OnceLock::new();

pub fn set_app_handle(h: AppHandle) {
    let _ = APP
        .get_or_init(|| Mutex::new(None))
        .lock()
        .map(|mut g| *g = Some(h));
}

fn app_handle() -> Option<AppHandle> {
    APP.get()
        .and_then(|m| m.lock().ok())
        .and_then(|g| g.clone())
}

/// Emit a `fun:*` event to the frontend; no-op before setup / in tests.
pub fn emit<T: Serialize + Clone>(event: &str, payload: T) {
    if let Some(h) = app_handle() {
        let _ = h.emit(event, payload);
    }
}

// ---- persisted store -------------------------------------------------------
/// Everything the hub needs that must survive restarts. Written to
/// `data_dir/fun_widgets.json` via the app's standard storage helpers.
#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(default)]
pub struct FunStore {
    /// widget ids currently toggled on
    pub enabled: Vec<String>,
    /// per-widget config map (hotkey, thresholds, toggles…)
    pub configs: HashMap<String, Value>,
    /// unlocked achievement ids (persisted so nothing repeats)
    pub achievements: Vec<String>,
    /// lifetime counters (rage_uses, boss_uses, confetti_fired, cleanups,
    /// force_quits, last_cleanup_ms, …)
    pub counts: HashMap<String, u64>,
}

impl FunStore {
    pub fn is_enabled(&self, id: &str) -> bool {
        self.enabled.iter().any(|e| e == id)
    }
    pub fn count(&self, key: &str) -> u64 {
        self.counts.get(key).copied().unwrap_or(0)
    }
    pub fn config(&self, id: &str) -> Value {
        self.configs.get(id).cloned().unwrap_or_else(|| json!({}))
    }
    fn bump(&mut self, key: &str, n: u64) -> u64 {
        let v = self.count(key).saturating_add(n);
        self.counts.insert(key.to_string(), v);
        v
    }
}

fn store_path(state: &AppState) -> PathBuf {
    state.data_dir.join("fun_widgets.json")
}

fn load_store(state: &AppState) -> FunStore {
    load_json(&store_path(state), FunStore::default())
}

fn save_store(state: &AppState, store: &FunStore) -> Result<(), AppError> {
    save_json(&store_path(state), store)
}

// ---- global hotkeys --------------------------------------------------------
/// Widget ids that support a user-configurable global hotkey. Boss Key is the
/// flagship (fires even when Reforge isn't focused); the on-demand pranks get
/// one too so a user never needs the hub open to use them.
const HOTKEY_WIDGETS: &[&str] = &["rage", "confetti", "bsod", "boss", "glitch"];

/// Shortcut currently registered per widget id (Rust owns registration; the
/// frontend only edits the string in config and we re-register on change).
static REGISTERED: OnceLock<Mutex<HashMap<String, Shortcut>>> = OnceLock::new();

fn registered_map() -> &'static Mutex<HashMap<String, Shortcut>> {
    REGISTERED.get_or_init(|| Mutex::new(HashMap::new()))
}

fn widget_hotkey(store: &FunStore, id: &str) -> Option<String> {
    store
        .config(id)
        .get("hotkey")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

/// (Re)build the global-shortcut table from the store: unregister everything
/// we own, then register hotkeys for enabled widgets. Idempotent and cheap —
/// called on every enable/disable/config change.
pub fn sync_hotkeys(app: &AppHandle, store: &FunStore) {
    // The global-shortcut plugin is always registered in lib.rs, so this
    // state access is safe everywhere the commands can run.
    let gs = app.global_shortcut();
    let mut reg = match registered_map().lock() {
        Ok(r) => r,
        Err(_) => return,
    };
    for (id, shortcut) in reg.drain() {
        let _ = gs.unregister(shortcut);
        let _ = id; // id was only kept for bookkeeping
    }
    for id in HOTKEY_WIDGETS {
        if !store.is_enabled(id) {
            continue;
        }
        let Some(key) = widget_hotkey(store, id) else { continue };
        let Ok(shortcut) = Shortcut::from_str(&key) else {
            emit(
                "fun:hotkey-error",
                json!({ "id": id, "reason": format!("invalid hotkey: {key}") }),
            );
            continue;
        };
        let id2 = id.to_string();
        if gs
            .on_shortcut(shortcut, move |app, _sc, event| {
                if event.state == ShortcutState::Pressed {
                    let _ = app.emit("fun:hotkey", json!({ "id": id2 }));
                }
            })
            .is_ok()
        {
            reg.insert(id.to_string(), shortcut);
        }
    }
}

/// Startup pass: restore hotkeys for widgets that were enabled + configured
/// last session. Called from setup with the raw data dir (AppState isn't
/// managed yet at that point).
pub fn sync_hotkeys_at_startup(app: &AppHandle) {
    if let Ok(dir) = app.path().app_data_dir() {
        let state = AppState { data_dir: dir };
        let store = load_store(&state);
        sync_hotkeys(app, &store);
    }
}

// ---- hooks for other modules ----------------------------------------------
/// Force-quit counter (Idle Roast / achievement engine stats). Called from
/// `tuneup::end_process` on success.
pub fn note_force_quit(state: &AppState) -> Result<(), AppError> {
    let mut store = load_store(state);
    store.bump("force_quits", 1);
    save_store(state, &store)
}

/// Real completion events (cleanup finished / maintenance run) — bumps the
/// lifetime counter, stamps `last_cleanup_ms` (for the Certificate) and emits
/// `fun:completion` so the frontend can fire Confetti + check achievements.
pub fn note_completion(state: &AppState, kind: &str) -> Result<(), AppError> {
    let mut store = load_store(state);
    store.bump("cleanups", 1);
    store
        .counts
        .insert("last_cleanup_ms".into(), crate::storage::now_millis());
    save_store(state, &store)?;
    emit(
        "fun:completion",
        json!({ "kind": kind, "cleanups": store.count("cleanups") }),
    );
    Ok(())
}

// ---- commands --------------------------------------------------------------

#[tauri::command]
pub fn fun_get_state(state: State<'_, AppState>) -> FunStore {
    load_store(&state)
}

#[tauri::command]
pub fn fun_set_enabled(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    on: bool,
) -> Result<FunStore, AppError> {
    let mut store = load_store(&state);
    if on {
        if !store.is_enabled(&id) {
            store.enabled.push(id.clone());
        }
    } else {
        store.enabled.retain(|e| e != &id);
    }
    save_store(&state, &store)?;
    sync_hotkeys(&app, &store);
    stats::set_active(!store.enabled.is_empty());
    emit("fun:enabled", json!({ "id": id, "on": on }));
    Ok(store)
}

/// Merge a JSON patch into one widget's config. Hotkey changes re-register the
/// global shortcut immediately.
#[tauri::command]
pub fn fun_set_config(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    patch: Value,
) -> Result<FunStore, AppError> {
    let mut store = load_store(&state);
    let entry = store.configs.entry(id.clone()).or_insert_with(|| json!({}));
    if let (Some(obj), Some(pobj)) = (entry.as_object_mut(), patch.as_object()) {
        for (k, v) in pobj {
            obj.insert(k.clone(), v.clone());
        }
    } else {
        *entry = patch;
    }
    save_store(&state, &store)?;
    sync_hotkeys(&app, &store);
    Ok(store)
}

/// Bump a lifetime counter (frontend calls this when a widget actually fires,
/// so counts are event-driven, not registration-driven). Returns the new value.
#[tauri::command]
pub fn fun_bump_count(state: State<'_, AppState>, key: String, n: u64) -> Result<u64, AppError> {
    let mut store = load_store(&state);
    let v = store.bump(&key, n);
    save_store(&state, &store)?;
    Ok(v)
}

/// Mark an achievement unlocked; returns true only if this call did the
/// unlocking (so the frontend knows to queue the toast exactly once).
#[tauri::command]
pub fn fun_unlock_achievement(state: State<'_, AppState>, id: String) -> Result<bool, AppError> {
    let mut store = load_store(&state);
    if store.achievements.iter().any(|a| a == &id) {
        return Ok(false);
    }
    store.achievements.push(id);
    save_store(&state, &store)?;
    Ok(true)
}

/// Live snapshot for on-demand consumers (Procrastination Certificate) and the
/// hub's stats row. `stats::snapshot()` refreshes sysinfo once if the poll
/// thread has never run, so a manual trigger always gets fresh numbers.
#[tauri::command]
pub fn fun_get_stats() -> stats::Snapshot {
    stats::snapshot()
}

/// Screen capture as base64 PNG (Rage Shatter / Glitch Jumpscare base texture).
#[tauri::command]
pub fn fun_capture_screen() -> Result<String, AppError> {
    screen::capture_screen_base64()
}

/// Decode a base64 PNG and write it to the user's Downloads folder. Returns
/// the written path. Used by the Procrastination Certificate's Save/Share.
#[tauri::command]
pub fn fun_save_png(
    state: State<'_, AppState>,
    data: String,
    filename: String,
) -> Result<String, AppError> {
    use base64::Engine as _;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.trim())
        .map_err(|e| AppError::Command(format!("invalid image data: {e}")))?;
    let safe_name: String = filename
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || "-_ .()".contains(c) { c } else { '_' })
        .collect();
    let dir = dirs::download_dir().unwrap_or_else(|| state.data_dir.clone());
    let path = dir.join(if safe_name.to_lowercase().ends_with(".png") {
        safe_name
    } else {
        format!("{safe_name}.png")
    });
    std::fs::write(&path, &bytes).map_err(|e| AppError::Command(e.to_string()))?;
    Ok(path.display().to_string())
}

/// Spawn an overlay window. The frontend builds the complete HTML (it owns the
/// particle/audio code); Rust writes it to disk and creates the window so the
/// overlay is a real transparent always-on-top surface. Geometry is computed
/// here from the primary monitor (frontend never needs physical pixels).
///
/// `async` is load-bearing: `WebviewWindowBuilder::build()` deadlocks on
/// Windows when called from a *synchronous* command or event handler (the
/// creation waits in a nested message pump; see tauri's WebviewWindowBuilder
/// docs). Running on the async runtime's thread lets the controller creation
/// complete — sync commands run on the main thread and freeze the whole app
/// (the "whip opens only after closing reforge / never works" bug).
#[tauri::command]
pub async fn fun_spawn_overlay(
    app: AppHandle,
    state: State<'_, AppState>,
    label: String,
    html: String,
    opts: overlay::OverlayOpts,
) -> Result<(), AppError> {
    // Re-spawning a label replaces the old window (never stacks two). The
    // boot reconcile can double-fire (store subscribe + refresh catch-up)
    // while the widget's lazy start is still in flight, so two spawns land
    // back-to-back — and because async commands run concurrently, the second
    // spawn's existence check can race the first spawn's registration.
    // Serialize the whole check+close+spawn sequence, then wait for the old
    // window's async teardown (close is async on Windows; building while it's
    // pending fails "label already exists" and the pending close then
    // destroys the first window, leaving none at all).
    let lock = OVERLAY_SPAWN.get_or_init(|| tauri::async_runtime::Mutex::new(()));
    let _guard = lock.lock().await;
    if app.get_webview_window(&label).is_some() {
        overlay::close(&app, &label);
        for _ in 0..100 {
            if app.get_webview_window(&label).is_none() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    }
    overlay::spawn(&app, &state, &label, &html, &opts)
}

#[tauri::command]
pub fn fun_close_overlay(app: AppHandle, label: String) {
    overlay::close(&app, &label);
}

/// What's registered right now (id → shortcut string) so the hub can show the
/// live binding and detect a failed registration.
#[tauri::command]
pub fn fun_hotkey_state() -> HashMap<String, String> {
    registered_map()
        .lock()
        .map(|m| m.iter().map(|(k, v)| (k.clone(), v.to_string())).collect())
        .unwrap_or_default()
}
