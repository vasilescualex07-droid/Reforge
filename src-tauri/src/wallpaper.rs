use crate::state::AppState;
use crate::undo;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashSet;
use std::ffi::c_void;
use std::path::{Path, PathBuf};

// ---------------------------------------------------------------------------
// Bundled wallpaper path resolution — the single shared layer every wallpaper
// flow uses (library, style packs, custom imports). Layout-independent: works
// under `cargo tauri dev`, from a debug/release exe inside src-tauri/target,
// and from a packaged install that ships media under resources/.
// ---------------------------------------------------------------------------

/// Candidate public roots, in priority order. `exe_dir` is walked *up* so the
/// search doesn't depend on how deep the build output happens to sit
/// (src-tauri/target/<profile> is three levels under the project root here).
use crate::error::AppError;
fn wallpaper_roots(
    manifest_dir: Option<&Path>,
    cwd: Option<&Path>,
    exe_dir: Option<&Path>,
) -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Some(manifest) = manifest_dir {
        roots.push(manifest.join("../public"));
    }
    if let Some(cwd) = cwd {
        roots.push(cwd.join("public"));
    }
    if let Some(exe_dir) = exe_dir {
        // Walk up to the filesystem root (ancestors() is finite, so no depth
        // cap is needed) — covers src-tauri/target/<profile> at any depth, a
        // packaged install (media under resources/), and exe-adjacent layouts.
        // Each root is expected to *contain* a `wallpapers/` subdir, matching
        // how the dev server serves /wallpapers/... from public/.
        for ancestor in exe_dir.ancestors() {
            roots.push(ancestor.join("public"));
            roots.push(ancestor.join("resources"));
            roots.push(ancestor.to_path_buf());
        }
    }
    let mut seen = HashSet::new();
    roots.retain(|r| seen.insert(r.clone()));
    roots
}

/// Why a `/wallpapers/...` path failed to resolve.
#[derive(Debug)]
enum ResolveError {
    /// No candidate root contained the file.
    NotFound(Vec<PathBuf>),
    /// The path resolved to a real file, but it escaped the matched root.
    Escape(PathBuf),
}

/// Resolve a `/wallpapers/...` relative path against the given roots.
/// The canonicalized result must stay inside its root — `..` segments that
/// would escape are rejected, never silently followed. NotFound errors list
/// every path searched so the failure is diagnosable, not a bare "not found".
fn resolve_in(relative: &str, roots: &[PathBuf]) -> Result<PathBuf, ResolveError> {
    let mut searched: Vec<PathBuf> = Vec::new();
    for root in roots {
        let p = root.join(relative);
        if !p.exists() {
            searched.push(p);
            continue;
        }
        if let Ok(canon) = p.canonicalize() {
            if let Ok(root_canon) = root.canonicalize() {
                if !canon.starts_with(&root_canon) {
                    return Err(ResolveError::Escape(p));
                }
                return Ok(canon);
            }
        }
        // canonicalize failed (e.g. a permission edge) but the file exists —
        // trust the existence check and the caller's re-check rather than
        // guessing at symlinks. The `..` guard above already ran when it could.
        return Ok(p);
    }
    Err(ResolveError::NotFound(searched))
}

/// Shared resolver: turn a bundled `/wallpapers/...` path into a real,
/// canonical absolute filesystem path. Non-bundled paths (absolute OS paths)
/// pass through unchanged. Returns an error naming every location searched.
pub fn resolve_wallpaper(public_path: &str) -> Result<String, AppError> {
    if !public_path.starts_with("/wallpapers/") {
        return Ok(public_path.to_string());
    }
    let relative = public_path.trim_start_matches('/');
    let roots = wallpaper_roots(
        std::env::var("CARGO_MANIFEST_DIR")
            .ok()
            .map(PathBuf::from)
            .as_deref(),
        std::env::current_dir().ok().as_deref(),
        std::env::current_exe()
            .ok()
            .and_then(|e| e.parent().map(Path::to_path_buf))
            .as_deref(),
    );
    match resolve_in(relative, &roots) {
        Ok(p) => Ok(p.to_string_lossy().to_string()),
        Err(ResolveError::NotFound(searched)) => Err(AppError::Command(format!(
            "Wallpaper not found: {} (searched: {})",
            public_path,
            searched
                .iter()
                .map(|p| p.to_string_lossy().to_string())
                .collect::<Vec<_>>()
                .join(", ")
        ))),
        Err(ResolveError::Escape(p)) => Err(AppError::Command(format!(
            "Wallpaper path escapes the public dir: {}",
            p.to_string_lossy()
        ))),
    }
}
use tauri::State;
use windows::core::{PCWSTR, PWSTR};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
};
use windows::Win32::UI::Shell::{DesktopWallpaper, IDesktopWallpaper};
use windows::Win32::UI::WindowsAndMessaging::{
    SystemParametersInfoW, SPIF_SENDCHANGE, SPIF_UPDATEINIFILE, SPI_GETDESKWALLPAPER,
    SPI_SETDESKWALLPAPER,
};

#[derive(Serialize, Deserialize, Clone)]
pub struct MonitorInfo {
    pub id: String,
    pub wallpaper: String,
}

#[derive(Serialize)]
pub struct WallpaperState {
    pub current: String,
    pub monitor_supported: bool,
    pub monitors: Vec<MonitorInfo>,
}

fn pwstr_to_string(p: PWSTR) -> String {
    if p.is_null() {
        return String::new();
    }
    let len = (0usize..)
        .find(|&i| unsafe { *p.0.add(i) } == 0)
        .unwrap_or(0);
    if len == 0 {
        return String::new();
    }
    unsafe { String::from_utf16_lossy(std::slice::from_raw_parts(p.0, len)) }
}

// ---- low-level apply (no undo logging) ----

pub fn apply_wallpaper_raw(path: &str) -> Result<(), AppError> {
    let wide: Vec<u16> = path.encode_utf16().chain(Some(0)).collect();
    unsafe {
        SystemParametersInfoW(
            SPI_SETDESKWALLPAPER,
            0,
            Some(wide.as_ptr() as *mut c_void),
            SPIF_UPDATEINIFILE | SPIF_SENDCHANGE,
        )
        .map_err(|e| AppError::Command(e.to_string()))?;
    }
    Ok(())
}

pub fn current_wallpaper() -> String {
    let mut buf = vec![0u16; 1024];
    let res = unsafe {
        SystemParametersInfoW(
            SPI_GETDESKWALLPAPER,
            buf.len() as u32,
            Some(buf.as_mut_ptr() as *mut c_void),
            windows::Win32::UI::WindowsAndMessaging::SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
        )
    };
    if res.is_ok() {
        let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        return String::from_utf16_lossy(&buf[..end]);
    }
    String::new()
}

fn list_monitors() -> Result<Vec<MonitorInfo>, AppError> {
    let mut infos = Vec::new();
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let desktop: IDesktopWallpaper = CoCreateInstance(&DesktopWallpaper, None, CLSCTX_ALL)
            .map_err(|e| AppError::Command(e.to_string()))?;
        let count = desktop
            .GetMonitorDevicePathCount()
            .map_err(|e| AppError::Command(e.to_string()))?;
        for i in 0..count {
            let id = desktop
                .GetMonitorDevicePathAt(i)
                .map_err(|e| AppError::Command(e.to_string()))?;
            let id_str = pwstr_to_string(id);
            let wp = desktop
                .GetWallpaper(PCWSTR(id.0))
                .map(pwstr_to_string)
                .unwrap_or_default();
            infos.push(MonitorInfo {
                id: id_str,
                wallpaper: wp,
            });
        }
        CoUninitialize();
    }
    Ok(infos)
}

pub fn apply_monitor_wallpaper_raw(monitor_id: &str, path: &str) -> Result<(), AppError> {
    let mid: Vec<u16> = monitor_id.encode_utf16().chain(Some(0)).collect();
    let wp: Vec<u16> = path.encode_utf16().chain(Some(0)).collect();
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let desktop: IDesktopWallpaper = CoCreateInstance(&DesktopWallpaper, None, CLSCTX_ALL)
            .map_err(|e| AppError::Command(e.to_string()))?;
        desktop
            .SetWallpaper(PCWSTR(mid.as_ptr()), PCWSTR(wp.as_ptr()))
            .map_err(|e| AppError::Command(e.to_string()))?;
        CoUninitialize();
    }
    Ok(())
}

// ---- Tauri commands ----

#[tauri::command]
pub fn get_wallpapers() -> WallpaperState {
    let monitors = list_monitors().unwrap_or_default();
    WallpaperState {
        current: current_wallpaper(),
        monitor_supported: !monitors.is_empty(),
        monitors,
    }
}

#[tauri::command]
pub fn set_wallpaper(state: State<'_, AppState>, path: String) -> Result<WallpaperState, AppError> {
    let path = resolve_wallpaper(&path)?;
    if !std::path::Path::new(&path).exists() {
        return Err(AppError::Command(format!("File not found: {}", path)));
    }
    let before = current_wallpaper();
    apply_wallpaper_raw(&path)?;
    crate::wallpaper_static::record_history(&state, &path, None);
    undo::log_entry(
        &state,
        "wallpaper",
        format!("Wallpaper → {}", path),
        json!({ "before": before, "after": path }),
        true,
    )?;
    Ok(get_wallpapers())
}

#[tauri::command]
pub fn set_monitor_wallpaper(
    state: State<'_, AppState>,
    monitor_id: String,
    path: String,
) -> Result<WallpaperState, AppError> {
    let path = resolve_wallpaper(&path)?;
    if !std::path::Path::new(&path).exists() {
        return Err(AppError::Command(format!("File not found: {}", path)));
    }
    let before = current_wallpaper();
    apply_monitor_wallpaper_raw(&monitor_id, &path)?;
    crate::wallpaper_static::record_history(&state, &path, Some(monitor_id.clone()));
    undo::log_entry(
        &state,
        "wallpaper",
        format!("Wallpaper → {} (per-monitor)", path),
        json!({ "before": before, "after": path }),
        true,
    )?;
    Ok(get_wallpapers())
}

/// Resolve a bundled /wallpapers/... path to a real filesystem path.
///
/// Returns an error if the path escapes the public dir via `..` segments.
#[tauri::command]
pub fn resolve_wallpaper_path(public_path: String) -> Result<String, AppError> {
    resolve_wallpaper(&public_path)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Hand-rolled temp dir so the tests need no dev-dependency.
    struct TestDir(PathBuf);

    impl TestDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "reforge-wp-test-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_nanos())
                    .unwrap_or(0)
            ));
            std::fs::create_dir_all(&path).unwrap();
            TestDir(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn write(path: &Path, contents: &str) {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(path, contents).unwrap();
    }

    #[test]
    fn finds_bundled_wallpaper_in_nested_target_layout() {
        let t = TestDir::new();
        // Simulates <project>/public/wallpapers/static/… with the exe at
        // <project>/src-tauri/target/release — the layout that used to fail
        // because the old fallback only climbed two levels.
        write(&t.path().join("public/wallpapers/static/a.jpg"), "x");
        let exe_dir = t.path().join("src-tauri/target/release");
        std::fs::create_dir_all(&exe_dir).unwrap();

        let roots = wallpaper_roots(None, None, Some(&exe_dir));
        let resolved = resolve_in("wallpapers/static/a.jpg", &roots).unwrap();
        assert!(resolved.is_absolute());
        assert!(resolved.ends_with("public/wallpapers/static/a.jpg"));
    }

    #[test]
    fn finds_bundled_wallpaper_in_packaged_resources_layout() {
        let t = TestDir::new();
        // Packaged install: media shipped under resources/wallpapers next to
        // the exe rather than a dev public/ tree.
        write(&t.path().join("resources/wallpapers/static/a.jpg"), "x");
        let exe_dir = t.path();
        std::fs::create_dir_all(exe_dir).unwrap();

        let roots = wallpaper_roots(None, None, Some(exe_dir));
        let resolved = resolve_in("wallpapers/static/a.jpg", &roots).unwrap();
        assert!(resolved.ends_with("resources/wallpapers/static/a.jpg"));
    }

    #[test]
    fn rejects_path_traversal_outside_public_root() {
        let t = TestDir::new();
        write(&t.path().join("public/wallpapers/static/a.jpg"), "x");
        write(&t.path().join("secret.txt"), "do not read");
        let exe_dir = t.path().join("src-tauri/target/release");
        std::fs::create_dir_all(&exe_dir).unwrap();

        let roots = wallpaper_roots(None, None, Some(&exe_dir));
        // `..` climbs out of the public root to a real file — must be rejected
        // as an escape, not silently followed.
        let err = resolve_in("../secret.txt", &roots).unwrap_err();
        assert!(matches!(err, ResolveError::Escape(_)));
    }

    #[test]
    fn missing_wallpaper_reports_searched_roots() {
        let t = TestDir::new();
        let exe_dir = t.path().join("src-tauri/target/release");
        std::fs::create_dir_all(&exe_dir).unwrap();

        let roots = wallpaper_roots(None, None, Some(&exe_dir));
        let err = resolve_in("wallpapers/static/nope.jpg", &roots).unwrap_err();
        let searched = match err {
            ResolveError::NotFound(s) => s,
            ResolveError::Escape(_) => panic!("expected NotFound"),
        };
        // Every candidate root was tried and is reported.
        assert!(searched.len() >= 3);
        assert!(searched.iter().all(|p| !p.exists()));
    }

    #[test]
    fn non_bundled_path_passes_through_unchanged() {
        let abs = "C:\\Users\\you\\Pictures\\mountain.jpg";
        assert_eq!(resolve_wallpaper(abs).unwrap(), abs);
    }
}
