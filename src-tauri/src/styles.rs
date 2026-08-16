// Style Engine backend (B1). Applies a whole style — accent, mode,
// transparency, and wallpaper (static / live video / animated scene) — as one
// atomic operation with a single composite undo entry. Mirrors the JS mock so
// browser preview and the desktop app behave identically.

use crate::state::AppState;
use crate::{theme, undo, wallpaper, wallpaper_engine, wallpaper_video};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{Manager, State};

use crate::error::AppError;
#[derive(Serialize)]
pub struct StyleApplyResult {
    pub ok: bool,
    pub name: String,
    /// Non-fatal outcomes (e.g. RGB skipped because no OpenRGB device is
    /// present). Never silently swallowed — surfaced in the UI toast.
    #[serde(default)]
    pub notes: Vec<String>,
}

#[derive(serde::Deserialize, serde::Serialize, Clone)]
pub struct StyleApply {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub mode: Option<String>,
    #[serde(default)]
    pub accent_hex: Option<String>,
    #[serde(default)]
    pub transparency: Option<bool>,
    /// Static wallpaper: public asset path. Live: source media path (mp4/gif).
    #[serde(default)]
    pub wallpaper: Option<String>,
    /// "static" | "live" | "scene"
    #[serde(default)]
    pub wallpaper_type: Option<String>,
    #[serde(default)]
    pub scene: Option<wallpaper_engine::SceneConfig>,
    /// Whole-UI font substitution (a Windows font family name, e.g. Consolas).
    #[serde(default)]
    pub font: Option<String>,
    /// Sound scheme GUID. Validated before anything is applied (atomic).
    #[serde(default)]
    pub sound_scheme: Option<String>,
    /// "accent-sync" | "off" — capability-gated on OpenRGB availability.
    #[serde(default)]
    pub rgb: Option<String>,
}

fn capture_before(state: &AppState) -> serde_json::Value {
    let eng = wallpaper_engine::load_engine(state);
    let font_before = crate::fonts::list_font_substitutions()
        .into_iter()
        .find(|f| f.original.eq_ignore_ascii_case("Segoe UI Variable"))
        .map(|f| f.substituted)
        .unwrap_or_default();
    let rgb = crate::rgb::rgb_detect();
    json!({
        "accent": theme::current_accent_hex(),
        "mode": theme::current_mode(),
        "transparency": theme::current_transparency(),
        "wallpaper": wallpaper::current_wallpaper(),
        "engine": {
            "active": eng.active,
            "frozen": eng.frozen,
            "scene": eng.scene,
            "media": eng.media,
            "static_wallpaper": eng.static_wallpaper,
        },
        "sound_scheme": crate::sounds::get_current_scheme().guid,
        "font": {
            "original": "Segoe UI Variable",
            "before": font_before,
        },
        "rgb": if rgb.available {
            serde_json::to_value(
                rgb.devices.iter().map(|d| json!({
                    "device_index": d.index,
                    "before_colors": d.colors,
                })).collect::<Vec<_>>(),
            )
            .unwrap_or_default()
        } else {
            json!([])
        },
    })
}

#[tauri::command]
pub async fn apply_style(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    style: StyleApply,
) -> Result<StyleApplyResult, AppError> {
    apply_style_inner(app, state.inner().clone(), style).await
}

/// The apply path, callable from anywhere — the studio command, the startup
/// auto-style restore (S11.2), and the style scheduler (S11.3). A scheduled
/// apply is exactly as revertible as a studio apply (one composite undo
/// entry).
pub async fn apply_style_inner(
    app: tauri::AppHandle,
    state: AppState,
    style: StyleApply,
) -> Result<StyleApplyResult, AppError> {
    use tauri::Emitter;
    let state_h: State<'_, AppState> = app.state::<AppState>();
    let before = capture_before(&state);
    let mut notes: Vec<String> = Vec::new();

    // Deeper components run FIRST so a fallible one (a missing font file)
    // aborts the whole style before anything is touched (A1.6). Sound schemes
    // and RGB are capability-gated instead: a scheme/device missing on this
    // machine degrades to a note (K7) rather than killing the style.
    if let Some(font) = &style.font {
        crate::fonts::set_font_substitution(
            state_h.clone(),
            "Segoe UI Variable".into(),
            font.clone(),
        )
        .map_err(|e| AppError::Command(format!("Style not applied — {e}")))?;
    }
    if let Some(guid) = &style.sound_scheme {
        // K7 fix — a scheme missing on this machine must NOT abort the whole
        // style: it degrades to a note (like RGB) and the rest applies.
        match crate::sounds::apply_sound_scheme(state_h.clone(), guid.clone()) {
            Ok(msg) => notes.push(msg),
            Err(e) => notes.push(format!("Sound scheme not applied — {e}")),
        }
    }
    if let Some(intent) = &style.rgb {
        let det = crate::rgb::rgb_detect();
        if !det.available {
            notes.push(format!("RGB not applied — {}", det.note));
        } else {
            // The frontend is untrusted and rgb_set_static slices the hex
            // string — validate before touching OpenRGB (defense in depth).
            let valid_hex = style
                .accent_hex
                .clone()
                .or_else(|| Some(theme::current_accent_hex()))
                .filter(|h| {
                    h.len() == 7
                        && h.starts_with('#')
                        && h[1..].chars().all(|c| c.is_ascii_hexdigit())
                });
            match (intent.as_str(), valid_hex) {
                ("accent-sync", Some(hex)) => {
                    for dev in &det.devices {
                        if let Err(e) =
                            crate::rgb::rgb_set_static(state_h.clone(), dev.index, hex.clone())
                        {
                            notes.push(format!("{}: {}", dev.name, e));
                        }
                    }
                }
                ("accent-sync", None) => {
                    notes.push("RGB not applied — accent color is not a valid hex color.".into());
                }
                ("off", _) => {
                    for dev in &det.devices {
                        if let Err(e) =
                            crate::rgb::rgb_restore_current_mode(state_h.clone(), dev.index)
                        {
                            notes.push(format!("{}: {}", dev.name, e));
                        }
                    }
                }
                _ => {}
            }
        }
    }

    let had_deeper = style.font.is_some() || style.sound_scheme.is_some() || style.rgb.is_some();

    // Theme + wallpaper core. A failure here (e.g. a missing wallpaper file)
    // happens after deeper components may already be applied — surface that
    // honestly instead of pretending the whole style failed cleanly.
    let core: Result<(), AppError> = async {
        if let Some(mode) = &style.mode {
            theme::apply_mode_raw(mode)?;
        }
        if let Some(hex) = &style.accent_hex {
            theme::apply_accent_hex_raw(hex)?;
        }
        if let Some(t) = style.transparency {
            theme::apply_transparency_raw(t)?;
        }
        theme::persist_theme(&state);
        persist_applied_style(&state, &style.id, &style.name, &style);

        let wtype = style.wallpaper_type.as_deref().unwrap_or("static");
        let prev = wallpaper_engine::load_engine(&state);
        let static_wp = if prev.static_wallpaper.is_empty() {
            wallpaper::current_wallpaper()
        } else {
            prev.static_wallpaper.clone()
        };

        match wtype {
            "scene" => {
                // stop any running video/static first, then start the scene
                let _ = wallpaper_video::stop_video(&app, &state);
                if let Some(scene) = &style.scene {
                    wallpaper_engine::start_scene(&app, scene)?;
                    wallpaper_engine::save_engine(
                        &state,
                        &wallpaper_engine::EngineState {
                            active: true,
                            frozen: false,
                            scene: Some(scene.clone()),
                            media: None,
                            static_wallpaper: static_wp.clone(),
                        },
                    )?;
                } else {
                    wallpaper_engine::save_engine(
                        &state,
                        &wallpaper_engine::EngineState::default(),
                    )?;
                }
            }
            "live" => {
                wallpaper_engine::stop_animated(&app, &state)?;
                if let Some(src) = &style.wallpaper {
                    // Never fall back to the raw path: resolve_wallpaper passes
                    // absolute paths through and rejects escaping bundled
                    // paths, so an error here is a real problem (C3).
                    let resolved = wallpaper::resolve_wallpaper_path(src.clone())?;
                    // The ffmpeg pass runs on a blocking thread with live
                    // `transcode-progress` events (E1) — the UI never freezes.
                    let out_dir = state.wallpapers_dir();
                    let preset = crate::transcode::get_transcode_config(state_h.clone()).preset;
                    let app2 = app.clone();
                    let import = tauri::async_runtime::spawn_blocking(move || {
                        let mut last = std::time::Instant::now();
                        let r = crate::transcode::import_media_p(
                            std::path::Path::new(&resolved),
                            &out_dir,
                            &mut |secs| {
                                if last.elapsed().as_millis() >= 250 {
                                    last = std::time::Instant::now();
                                    let _ = app2.emit(
                                        "transcode-progress",
                                        json!({ "phase": "transcoding", "seconds": secs }),
                                    );
                                }
                            },
                            preset,
                        );
                        let _ = app2.emit("transcode-progress", json!({ "phase": "done" }));
                        r
                    })
                    .await
                    .map_err(|e| AppError::Command(format!("import aborted: {}", e)))??;
                    let video = wallpaper_engine::VideoWallpaper {
                        path: import.normalized.clone(),
                        kind: if import.kind == "gif" { "gif" } else { "video" }.into(),
                        width: import.width,
                        height: import.height,
                        name: std::path::Path::new(&import.normalized)
                            .file_stem()
                            .map(|s| s.to_string_lossy().to_string())
                            .unwrap_or_else(|| "media".into()),
                    };
                    wallpaper_video::start_video(&app, &video)?;
                    wallpaper_engine::save_engine(
                        &state,
                        &wallpaper_engine::EngineState {
                            active: true,
                            frozen: false,
                            scene: None,
                            media: Some(video),
                            static_wallpaper: static_wp.clone(),
                        },
                    )?;
                }
            }
            _ => {
                // static: stop engines first, then apply the image
                let _ = wallpaper_engine::stop_animated(&app, &state);
                let _ = wallpaper_video::stop_video(&app, &state);
                if let Some(path) = &style.wallpaper {
                    // Never fall back to the raw path (C3) — see above.
                    let resolved = wallpaper::resolve_wallpaper_path(path.clone())?;
                    wallpaper::apply_wallpaper_raw(&resolved)?;
                }
                wallpaper_engine::save_engine(&state, &wallpaper_engine::EngineState::default())?;
            }
        }
        Ok(())
    }
    .await;
    if let Err(e) = core {
        return Err(AppError::Command(if had_deeper {
            format!("{e} — some changes were already applied and can be reverted from History")
        } else {
            e.to_string()
        }));
    }

    undo::log_entry(
        &state_h,
        "style_applied",
        format!("Applied style: {}", style.name),
        json!({ "before": before, "style_id": style.id }),
        true,
    )?;
    Ok(StyleApplyResult {
        ok: true,
        name: style.name,
        notes,
    })
}

#[tauri::command]
pub fn get_applied_style(state: State<'_, AppState>) -> Option<String> {
    undo::get_last_style_id(&state)
}

// ---------------------------------------------------------------------------
// S11.2 — auto-style at login. Every successful apply persists the full
// payload; boot (restore.rs) and the weekly scheduled maintenance re-apply it
// so an OS update can't silently reset the look. The engine's scene/video is
// restored separately from its own state file (S8.7) — this covers the theme
// layer + static wallpaper only.
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone)]
pub struct AppliedStyleRecord {
    pub id: String,
    pub name: String,
    pub payload: StyleApply,
}

pub fn applied_style_path(data_dir: &std::path::Path) -> std::path::PathBuf {
    data_dir.join("applied_style.json")
}

pub fn persist_applied_style(state: &AppState, id: &str, name: &str, payload: &StyleApply) {
    let rec = AppliedStyleRecord {
        id: id.to_string(),
        name: name.to_string(),
        payload: payload.clone(),
    };
    let _ = crate::storage::save_json(&applied_style_path(&state.data_dir), &rec);
}

pub fn load_applied_style(data_dir: &std::path::Path) -> Option<AppliedStyleRecord> {
    crate::storage::load_json(
        &applied_style_path(data_dir),
        Option::<AppliedStyleRecord>::None,
    )
}

/// Re-apply the theme-level components of a style: font, sound scheme, RGB
/// accent-sync, mode, accent, transparency, static wallpaper. No undo entry —
/// the original apply stays revertible from History; this only restores what
/// an OS update may have reset. `app` may be None (e.g. the maintenance
/// command path) — the components that need an AppHandle then degrade to a
/// note instead of aborting.
pub fn reapply_theme_components(
    app: Option<&tauri::AppHandle>,
    state: &AppState,
    payload: &StyleApply,
) -> Result<Vec<String>, AppError> {
    let mut notes = Vec::new();
    if let (Some(app), Some(font)) = (app, &payload.font) {
        let st: State<'_, AppState> = app.state::<AppState>();
        match crate::fonts::set_font_substitution(st, "Segoe UI Variable".into(), font.clone()) {
            Ok(_) => {}
            Err(e) => notes.push(format!("Font not re-applied — {e}")),
        }
    } else if payload.font.is_some() {
        notes.push("Font not re-applied (no app context)".into());
    }
    if let (Some(app), Some(guid)) = (app, &payload.sound_scheme) {
        let st: State<'_, AppState> = app.state::<AppState>();
        match crate::sounds::apply_sound_scheme(st, guid.clone()) {
            Ok(msg) => notes.push(msg),
            Err(e) => notes.push(format!("Sound scheme not re-applied — {e}")),
        }
    } else if payload.sound_scheme.is_some() {
        notes.push("Sound scheme not re-applied (no app context)".into());
    }
    if let (Some(app), Some(intent)) = (app, &payload.rgb) {
        let st: State<'_, AppState> = app.state::<AppState>();
        let det = crate::rgb::rgb_detect();
        if det.available && intent == "accent-sync" {
            let hex = payload
                .accent_hex
                .clone()
                .unwrap_or_else(theme::current_accent_hex);
            for dev in &det.devices {
                if let Err(e) = crate::rgb::rgb_set_static(st.clone(), dev.index, hex.clone()) {
                    notes.push(format!("{}: {}", dev.name, e));
                }
            }
        }
    }
    if let Some(mode) = &payload.mode {
        theme::apply_mode_raw(mode)?;
    }
    if let Some(hex) = &payload.accent_hex {
        theme::apply_accent_hex_raw(hex)?;
    }
    if let Some(t) = payload.transparency {
        theme::apply_transparency_raw(t)?;
    }
    theme::persist_theme(state);
    // Static wallpaper only — scene/live restore via the engine state (S8.7).
    if payload.wallpaper_type.as_deref() == Some("static") {
        if let Some(p) = &payload.wallpaper {
            if let Ok(resolved) = wallpaper::resolve_wallpaper_path(p.clone()) {
                let _ = wallpaper::apply_wallpaper_raw(&resolved);
            }
        }
    }
    Ok(notes)
}
