//! Overlay window manager for the fun-widgets module.
//!
//! Spawns/despawns transparent, borderless, always-on-top Tauri windows on
//! demand, positioned per-widget:
//! - `fullscreen` — covers the primary monitor (Rage Shatter, Confetti,
//!   BSOD, Boss Key, Glitch Jumpscare)
//! - `corner`     — anchored to a monitor corner (Fire Alarm, Idle Roast,
//!   Pet, Whip Cracker)
//!
//! Multi-monitor aware: geometry is computed from `primary_monitor()`, so a
//! fullscreen payoff always lands on the real display, and corner anchors sit
//! inside that monitor's bounds. Overlays never steal focus unless the widget
//! is interactive (`clickable`), and non-interactive ones are set to ignore
//! cursor events so the desktop beneath keeps working (resource hygiene §7 —
//! a fun overlay must never block real work).
use crate::error::AppError;
use crate::state::AppState;
use serde::Deserialize;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

#[derive(Deserialize, Clone, Default)]
pub struct OverlayOpts {
    /// Cover the full primary monitor (overrides corner/x/y).
    #[serde(default)]
    pub fullscreen: bool,
    /// Corner anchor: "top-left" | "top-right" | "bottom-left" | "bottom-right".
    #[serde(default)]
    pub corner: Option<String>,
    /// Window size (defaults to the monitor size when fullscreen).
    #[serde(default)]
    pub w: Option<f64>,
    #[serde(default)]
    pub h: Option<f64>,
    /// Transparent surface (screen-effect payoffs) vs solid window (BSOD, boss
    /// cover). Solid windows are cheaper and safer for full-blue renders.
    #[serde(default)]
    pub transparent: bool,
    /// true → the window receives mouse/keyboard input (Whip, Pet, BSOD/Boss
    /// dismiss); false → clicks pass through to the desktop underneath.
    #[serde(default)]
    pub clickable: bool,
    /// Steal focus on open — only for interactive payoffs that need keys
    /// (BSOD dismiss, Boss Key cover). Defaults false: payoffs never yank
    /// focus away from real work.
    #[serde(default)]
    pub focus: bool,
    #[serde(default)]
    pub title: String,
}

/// Compute (x, y, w, h) in physical pixels inside the given monitor bounds.
fn compute_geometry(
    mx: f64,
    my: f64,
    mw: f64,
    mh: f64,
    opts: &OverlayOpts,
) -> (f64, f64, f64, f64) {
    let w = opts.w.unwrap_or(mw);
    let h = opts.h.unwrap_or(mh);
    if opts.fullscreen {
        return (mx, my, mw, mh);
    }
    let m = 16.0; // corner margin so the widget never hugs the screen edge
    let (x, y) = match opts.corner.as_deref() {
        Some("bottom-right") => (mx + mw - w - m, my + mh - h - m),
        Some("bottom-left") => (mx + m, my + mh - h - m),
        Some("top-right") => (mx + mw - w - m, my + m),
        Some("top-left") => (mx + m, my + m),
        _ => (mx + (mw - w) / 2.0, my + (mh - h) / 2.0),
    };
    (x, y, w, h)
}

pub fn spawn(
    app: &AppHandle,
    state: &AppState,
    label: &str,
    html: &str,
    opts: &OverlayOpts,
) -> Result<(), AppError> {
    let dir = state.data_dir.join("fun");
    std::fs::create_dir_all(&dir).map_err(|e| AppError::Command(e.to_string()))?;
    let file = dir.join(format!("{label}.html"));
    std::fs::write(&file, html).map_err(|e| AppError::Command(e.to_string()))?;
    let url = tauri::Url::from_file_path(&file).map_err(|_| "invalid overlay url".to_string())?;

    let mon = app
        .primary_monitor()
        .map_err(|e| AppError::Command(format!("no monitor: {e}")))?
        .ok_or_else(|| AppError::Command("no primary monitor".into()))?;
    let p = mon.position();
    let s = mon.size();
    let (x, y, w, h) = compute_geometry(p.x as f64, p.y as f64, s.width as f64, s.height as f64, opts);

    let title = if opts.title.is_empty() {
        label.to_string()
    } else {
        opts.title.clone()
    };
    // The build + post-build tweaks run through the webview gate: WebView2
    // deadlocks if a second controller is created on the main thread while a
    // first creation is still in flight (the nested-pump re-entrancy — see
    // webview_gate.rs). During boot the overlay spawn (frontend reconcile) can
    // overlap the deferred restore's wallpaper window, so the spawn is queued
    // behind it and opens a moment later instead of freezing the app.
    tracing::info!("overlay '{label}': spawn begin");
    let opts = opts.clone();
    let app = app.clone();
    let label_owned = label.to_string();
    let title = title.clone();
    let label_in = label_owned.clone();
    let result = crate::webview_gate::run(move || -> Result<(), AppError> {
        tracing::info!("overlay '{label_in}': build begin");
        let mut builder = WebviewWindowBuilder::new(&app, &label_owned, WebviewUrl::External(url))
            .title(&title)
            .decorations(false)
            .resizable(false)
            .maximizable(false)
            .minimizable(false)
            .skip_taskbar(true)
            .shadow(false)
            .always_on_top(true)
            .inner_size(w, h)
            .position(x, y)
            .focused(false); // payoffs never steal focus unless a widget asks (BSOD/Boss)
        if opts.transparent {
            builder = builder.transparent(true);
        }
        let win = match builder.build() {
            Ok(w) => w,
            Err(e) => {
                tracing::error!("overlay '{label_in}': build failed: {e}");
                return Err(AppError::Command(e.to_string()));
            }
        };
        tracing::info!("overlay '{label_in}': build ok");
        if !opts.clickable {
            let _ = win.set_ignore_cursor_events(true);
        }
        if opts.focus {
            let _ = win.set_focus();
        }
        Ok(())
    });
    match &result {
        Some(Ok(())) => tracing::info!("overlay '{label}': spawn ok"),
        Some(Err(e)) => tracing::error!("overlay '{label}': spawn error: {e}"),
        None => tracing::info!("overlay '{label}': spawn queued"),
    }
    result.unwrap_or(Ok(())) // queued behind an in-flight creation — opens right after
}

pub fn close(app: &AppHandle, label: &str) {
    if let Some(win) = app.get_webview_window(label) {
        let _ = win.close();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fullscreen_covers_the_monitor() {
        let o = OverlayOpts { fullscreen: true, ..Default::default() };
        assert_eq!(compute_geometry(0.0, 0.0, 1920.0, 1080.0, &o), (0.0, 0.0, 1920.0, 1080.0));
    }

    #[test]
    fn fullscreen_respects_monitor_offset() {
        let o = OverlayOpts { fullscreen: true, ..Default::default() };
        assert_eq!(compute_geometry(1920.0, 0.0, 1920.0, 1080.0, &o), (1920.0, 0.0, 1920.0, 1080.0));
    }

    #[test]
    fn bottom_right_anchors_inside_bounds() {
        let o = OverlayOpts {
            corner: Some("bottom-right".into()),
            w: Some(360.0),
            h: Some(240.0),
            ..Default::default()
        };
        let (x, y, w, h) = compute_geometry(0.0, 0.0, 1920.0, 1080.0, &o);
        assert_eq!((x, y, w, h), (1920.0 - 360.0 - 16.0, 1080.0 - 240.0 - 16.0, 360.0, 240.0));
        assert!(x + w <= 1920.0 && y + h <= 1080.0, "must stay inside the monitor");
    }

    #[test]
    fn missing_corner_centers() {
        let o = OverlayOpts { w: Some(700.0), h: Some(560.0), ..Default::default() };
        assert_eq!(compute_geometry(0.0, 0.0, 1920.0, 1080.0, &o), ((1920.0 - 700.0) / 2.0, (1080.0 - 560.0) / 2.0, 700.0, 560.0));
    }

    #[test]
    fn size_defaults_to_monitor_when_unset() {
        let o = OverlayOpts { corner: Some("top-left".into()), ..Default::default() };
        let (x, y, w, h) = compute_geometry(0.0, 0.0, 1920.0, 1080.0, &o);
        assert_eq!((x, y, w, h), (16.0, 16.0, 1920.0, 1080.0));
    }
}
