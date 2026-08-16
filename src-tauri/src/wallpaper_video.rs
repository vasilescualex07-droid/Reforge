use crate::error::AppError;
use crate::state::AppState;
use crate::storage::{load_json, save_json};
use crate::undo;
use crate::wallpaper;
use crate::wallpaper_engine::{EngineState, VideoWallpaper, WALLPAPER_WINDOW_LABEL};
use serde_json::json;
use std::path::PathBuf;
use tauri::{Manager, State, WebviewUrl, WebviewWindowBuilder};
use windows::Win32::UI::WindowsAndMessaging::{
    SetParent, SetWindowPos, HWND_BOTTOM, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER,
    SWP_NOSENDCHANGING, SWP_NOSIZE,
};

fn engine_path(state: &AppState) -> PathBuf {
    state.data_dir.join("wallpaper_engine.json")
}

fn load_engine(state: &AppState) -> EngineState {
    load_json(&engine_path(state), EngineState::default())
}

fn save_engine(state: &AppState, e: &EngineState) -> Result<(), AppError> {
    save_json(&engine_path(state), e)
}

// The video element src is a file:// URL to the imported media. The HTML is
// regenerated when switching wallpapers so the src always points at the right
// file through the same wallpaper_video.html path.
fn video_html(video: &VideoWallpaper, fade_in: bool) -> String {
    let is_gif = video.kind == "gif";
    let mime = if is_gif { "image/gif" } else { "video/mp4" };
    let src = tauri::Url::from_file_path(&video.path)
        .map(|u| u.to_string())
        .unwrap_or_default();
    let fade = if fade_in {
        // E4.7 — 2s fade-in for cross-type switches (video over the previous
        // wallpaper). prefers-reduced-motion skips the animation entirely.
        r#"
video{{animation:reforge-fade 2000ms ease;}}
@keyframes reforge-fade{{from{{opacity:0}}to{{opacity:1}}}}
@media (prefers-reduced-motion: reduce){{video{{animation:none}}}}"#
    } else {
        ""
    };
    format!(
        r#"<!DOCTYPE html><html><head><meta charset="utf-8"><style>
html,body{{margin:0;padding:0;overflow:hidden;background:#000;width:100%;height:100%}}
video{{display:block;width:100vw;height:100vh;object-fit:cover}}{fade}
</style></head><body>
<video id="v" autoplay muted loop playsinline src="{src}" type="{mime}"></video>
<script>
const v = document.getElementById('v');
window.__setPaused = (p) => {{ if(p) v.pause(); else v.play().catch(()=>{{}}); }};
</script></body></html>"#,
        fade = fade,
        src = src,
        mime = mime,
    )
}

fn open_video_window(
    app: &tauri::AppHandle,
    video: &VideoWallpaper,
    fade_in: bool,
) -> Result<(), AppError> {
    let (x, y, w, h) = crate::wallpaper_engine::virtual_screen();
    let html = video_html(video, fade_in);
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Command(e.to_string()))?;
    let file = dir.join("wallpaper_video.html");
    std::fs::write(&file, html).map_err(|e| AppError::Command(e.to_string()))?;
    let url =
        tauri::Url::from_file_path(&file).map_err(|_| "invalid video wallpaper url".to_string())?;

    // Gate the build (webview_gate.rs) — the video wallpaper can open from the
    // deferred boot restore while the frontend's overlay spawn is mid-creation;
    // two WebView2 creations in flight on the main thread deadlock.
    let app = app.clone();
    crate::webview_gate::run(move || -> Result<(), AppError> {
        let win = WebviewWindowBuilder::new(&app, WALLPAPER_WINDOW_LABEL, WebviewUrl::External(url))
            .title("Reforge Video Wallpaper")
            .decorations(false)
            .resizable(false)
            .maximizable(false)
            .minimizable(false)
            .closable(true)
            .skip_taskbar(true)
            .shadow(false)
            .focused(false)
            .always_on_bottom(true)
            .inner_size(w as f64, h as f64)
            .position(x as f64, y as f64)
            .build()
            .map_err(|e| AppError::Command(format!("video wallpaper window: {}", e)))?;

        if let Ok(hwnd) = win.hwnd() {
            let hwnd = windows::Win32::Foundation::HWND(hwnd.0);
            // Parent into the desktop background layer (behind the icons) — the
            // same shared technique the scene engine uses. HWND_BOTTOM is applied
            // for real (no SWP_NOZORDER) and the window is never activated.
            if let Some(parent) = crate::wallpaper_engine::desktop_background_parent() {
                unsafe {
                    let _ = SetParent(hwnd, Some(parent));
                    let _ = SetWindowPos(
                        hwnd,
                        Some(HWND_BOTTOM),
                        0,
                        0,
                        0,
                        0,
                        SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_NOSENDCHANGING,
                    );
                }
            }
        }
        Ok(())
    })
    .unwrap_or(Ok(())) // queued behind an in-flight creation — opens right after
}

fn close_video_window(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window(WALLPAPER_WINDOW_LABEL) {
        let _ = win.close();
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn list_video_wallpapers(state: State<'_, AppState>) -> Vec<VideoWallpaper> {
    let dir = state.wallpapers_dir();
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for entry in rd.flatten() {
            let p = entry.path();
            let kind = match p.extension().and_then(|e| e.to_str()) {
                Some("gif") => "gif",
                Some("mp4") => "video",
                _ => continue,
            };
            let name = p
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            let (w, h) = crate::transcode::probe_dimensions(&p)
                .unwrap_or_else(|_| {
                    let (_, _, sw, sh) = crate::wallpaper_engine::virtual_screen();
                    (sw.max(0) as u32, sh.max(0) as u32)
                });
            out.push(VideoWallpaper {
                path: p.to_string_lossy().to_string(),
                kind: kind.into(),
                width: w,
                height: h,
                name,
            });
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

#[tauri::command]
pub async fn set_video_wallpaper(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    source: String,
) -> Result<EngineState, AppError> {
    use tauri::Emitter;
    let before = load_engine(&state);
    let static_wp = if before.static_wallpaper.is_empty() {
        wallpaper::current_wallpaper()
    } else {
        before.static_wallpaper.clone()
    };
    // Library tiles send bundled /wallpapers/... paths — resolve them through
    // the same shared layer as static wallpapers before importing.
    let source = wallpaper::resolve_wallpaper(&source)?;
    let src = std::path::Path::new(&source).to_path_buf();
    // The ffmpeg pass can take a minute+ on a big video — run it on a blocking
    // thread so the UI never freezes, forwarding live `transcode-progress`
    // events (E1) that the Makeover view renders while it waits.
    let out_dir = state.wallpapers_dir();
    let preset = crate::transcode::get_transcode_config(state.clone()).preset;
    let app2 = app.clone();
    let import = tauri::async_runtime::spawn_blocking(move || {
        let mut last = std::time::Instant::now();
        let result =
            crate::transcode::import_media_p(&src, &out_dir, &mut |secs| {
                if last.elapsed().as_millis() >= 250 {
                    last = std::time::Instant::now();
                    let _ = app2.emit(
                        "transcode-progress",
                        json!({ "phase": "transcoding", "seconds": secs }),
                    );
                }
            }, preset);
        let _ = app2.emit("transcode-progress", json!({ "phase": "done" }));
        result
    })
    .await
    .map_err(|e| AppError::Command(format!("import aborted: {}", e)))??;
    let norm = std::path::Path::new(&import.normalized);
    let kind = if import.kind == "gif" { "gif" } else { "video" };
    let name = norm
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "media".into());
    let video = VideoWallpaper {
        path: import.normalized.clone(),
        kind: kind.into(),
        width: import.width,
        height: import.height,
        name: name.clone(),
    };
    // E4.7 — switching to a video fades it in over the previous wallpaper.
    close_video_window(&app);
    open_video_window(&app, &video, before.active)?;
    let eng = EngineState {
        active: true,
        frozen: false,
        scene: None,
        media: Some(video.clone()),
        static_wallpaper: static_wp.clone(),
    };
    save_engine(&state, &eng)?;
    undo::log_entry(
        &state,
        "video_wallpaper",
        format!("Video wallpaper → {}", name),
        json!({ "video": video, "before_active": before.active, "static_wallpaper": static_wp }),
        true,
    )?;
    Ok(eng)
}

#[tauri::command]
pub fn stop_video_wallpaper(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<EngineState, AppError> {
    let before = load_engine(&state);
    close_video_window(&app);
    if !before.static_wallpaper.is_empty() {
        let _ = wallpaper::apply_wallpaper_raw(&before.static_wallpaper);
    }
    let eng = EngineState {
        active: false,
        frozen: false,
        scene: None,
        media: None,
        static_wallpaper: String::new(),
    };
    save_engine(&state, &eng)?;
    undo::log_entry(
        &state,
        "video_wallpaper_stop",
        "Stopped video wallpaper (static restored)".to_string(),
        json!({ "video": before.media }),
        true,
    )?;
    Ok(eng)
}

// undo support: stop without logging
pub fn stop_video(app: &tauri::AppHandle, state: &AppState) -> Result<(), AppError> {
    close_video_window(app);
    let eng = load_engine(state);
    if !eng.static_wallpaper.is_empty() {
        let _ = wallpaper::apply_wallpaper_raw(&eng.static_wallpaper);
    }
    let cleared = EngineState {
        active: false,
        frozen: false,
        scene: None,
        media: None,
        static_wallpaper: String::new(),
    };
    save_engine(state, &cleared)?;
    Ok(())
}

// undo support: restart a video without logging
pub fn start_video(app: &tauri::AppHandle, video: &VideoWallpaper) -> Result<(), AppError> {
    close_video_window(app);
    open_video_window(app, video, false)?;
    Ok(())
}
