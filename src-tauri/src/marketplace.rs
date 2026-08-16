use crate::state::AppState;
use crate::storage::{load_json, now_millis, save_json};
use crate::undo;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::PathBuf;
use tauri::State;
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Pack Marketplace — locally-scoped "bundle" system.
//
// A bundle is a directory named `{id}.reforgepack` containing:
//   manifest.json — what's in the pack
//   assets/       — files (wallpapers, fonts, sounds, etc.)
//
// This is a pure local system; no network calls. "Marketplace" here means
// import/export/share-ready bundle files.
//
// Each bundle is applied as a composite operation: a single undo entry stores
// the "before" snapshot so the entire look can be reverted atomically.
// ---------------------------------------------------------------------------

use crate::error::AppError;
#[derive(Serialize, Deserialize, Clone)]
pub struct BundleManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: String,
    pub description: String,
    #[serde(default)]
    pub license: String,
    #[serde(default)]
    pub tags: Vec<String>,
    pub thumbnail: String, // relative path inside assets/, or empty
    #[serde(default)]
    pub checksum: String, // sha256 over the bundle's files (manifest excluded)
    pub components: Vec<BundleComponent>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(tag = "type")]
pub enum BundleComponent {
    #[serde(rename = "accent")]
    Accent { hex: String },
    #[serde(rename = "theme_mode")]
    ThemeMode { mode: String },
    #[serde(rename = "wallpaper")]
    Wallpaper { asset: String },
    #[serde(rename = "taskbar")]
    Taskbar {
        size: Option<String>,
        alignment: Option<String>,
        autohide: Option<bool>,
    },
    #[serde(rename = "cursor")]
    Cursor { scheme: String },
    #[serde(rename = "sound_scheme")]
    SoundScheme { guid: String },
    #[serde(rename = "sound_event")]
    SoundEvent { event: String, asset: String },
    #[serde(rename = "scene")]
    Scene {
        id: String,
        kind: String,
        speed: f64,
        density: f64,
        colors: Vec<String>,
    },
    #[serde(rename = "font_sub")]
    FontSub {
        original: String,
        substitute: String,
    },
    #[serde(rename = "lock_screen")]
    LockScreen {
        mode: String, // "image" | "slideshow" | "spotlight"
        asset: Option<String>,
    },
}

#[derive(Serialize, Clone)]
pub struct BundleInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: String,
    pub description: String,
    pub component_count: usize,
    pub applied: bool,
}

fn bundles_dir(state: &AppState) -> PathBuf {
    state.data_dir.join("packs")
}

fn bundle_dir(state: &AppState, id: &str) -> PathBuf {
    bundles_dir(state).join(format!("{}.reforgepack", id))
}

fn empty_manifest(name: String) -> BundleManifest {
    BundleManifest {
        id: String::new(),
        name,
        version: "0.1".into(),
        author: "Unknown".into(),
        description: String::new(),
        license: String::new(),
        tags: Vec::new(),
        thumbnail: String::new(),
        checksum: String::new(),
        components: Vec::new(),
    }
}

fn list_bundles(state: &AppState) -> Vec<BundleInfo> {
    let dir = bundles_dir(state);
    // a pack counts as "applied" if the undo log has a marketplace_apply for it
    let applied_ids: std::collections::HashSet<String> = crate::undo::load_undo_entries(state)
        .into_iter()
        .filter(|e| e.kind == "marketplace_apply")
        .filter_map(|e| {
            e.data
                .get("bundle_id")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        })
        .collect();
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for e in rd.flatten() {
            let p = e.path();
            if !p.is_dir() || !p.extension().map(|x| x == "reforgepack").unwrap_or(false) {
                continue;
            }
            let manifest = p.join("manifest.json");
            let m: BundleManifest = load_json(
                &manifest,
                empty_manifest(
                    p.file_stem()
                        .map(|s| s.to_string_lossy().to_string())
                        .unwrap_or_default(),
                ),
            );
            if m.id.is_empty() {
                continue;
            }
            out.push(BundleInfo {
                id: m.id.clone(),
                name: m.name,
                version: m.version,
                author: m.author,
                description: m.description,
                component_count: m.components.len(),
                applied: applied_ids.contains(&m.id),
            });
        }
    }
    out.sort_by_key(|a| a.name.to_lowercase());
    out
}

// ---- look capture: snapshot the current look into a bundle --------------------

fn capture_look(state: &AppState) -> BundleManifest {
    let id = Uuid::new_v4().to_string();
    let mut components = Vec::new();
    // accent
    let hex = crate::theme::current_accent_hex();
    components.push(BundleComponent::Accent { hex });
    // theme mode
    let mode = crate::theme::current_mode();
    components.push(BundleComponent::ThemeMode { mode });
    // wallpaper — copy file into assets
    let wp = crate::wallpaper::current_wallpaper();
    if !wp.is_empty() {
        let asset_name = format!("wp_{}.png", now_millis());
        let dst = bundle_dir(state, &id).join("assets").join(&asset_name);
        if let Some(parent) = dst.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::copy(&wp, &dst);
        components.push(BundleComponent::Wallpaper { asset: asset_name });
    }
    // taskbar
    let tb = crate::shell::read_taskbar_state();
    let size = match tb.size.as_str() {
        "small" => Some("small".into()),
        "medium" => None,
        "large" => Some("large".into()),
        _ => None,
    };
    let alignment = match tb.alignment.as_str() {
        "left" => Some("left".into()),
        _ => None,
    };
    let autohide = if tb.autohide { Some(true) } else { None };
    if size.is_some() || alignment.is_some() || autohide.is_some() {
        components.push(BundleComponent::Taskbar {
            size,
            alignment,
            autohide,
        });
    }
    // cursor scheme
    let cursor_state = crate::cursors::read_cursor_state();
    if !cursor_state.scheme_source.is_empty() {
        components.push(BundleComponent::Cursor {
            scheme: cursor_state.scheme_source,
        });
    }
    // lock screen mode
    let ls = crate::lockscreen::get_lock_screen_state();
    let asset = ls
        .image_path
        .as_ref()
        .filter(|_| ls.mode == "image")
        .cloned();
    components.push(BundleComponent::LockScreen {
        mode: ls.mode,
        asset,
    });

    BundleManifest {
        id,
        name: "Captured Look".into(),
        version: "1.0".into(),
        author: "Reforge User".into(),
        description: "A snapshot of your current look captured in one click.".into(),
        license: "Proprietary".into(),
        tags: vec!["captured".into()],
        thumbnail: String::new(),
        checksum: String::new(),
        components,
    }
}

// ---- Tauri commands -----------------------------------------------------------

#[tauri::command]
pub fn marketplace_list_bundles(state: State<'_, AppState>) -> Vec<BundleInfo> {
    list_bundles(&state)
}

// ---------------------------------------------------------------------------
// Pack safety — packs are declarative data, never code.
// ---------------------------------------------------------------------------

const FORBIDDEN_EXTENSIONS: &[&str] = &[
    "exe", "dll", "scr", "sys", "com", "msi", "msc", "ps1", "psm1", "bat", "cmd", "vbs", "vbe",
    "js", "jse", "wsf", "wsh", "hta", "jar", "sh", "bash", "py", "rb", "pl", "cpl", "ocx", "drv",
];

const PACK_SIZE_CAP: u64 = 500 * 1024 * 1024; // 500 MB, matches the media import cap

/// Detect executable/script content by real file header, not by extension.
fn looks_executable(data: &[u8]) -> bool {
    let head = &data[..data.len().min(16)];
    head.starts_with(b"MZ") // PE (exe/dll/sys)
        || head.starts_with(b"\x7fELF") // ELF
        || head.starts_with(b"#!") // shebang script
        || head.starts_with(b"\xfe\xed\xfa") // Mach-O
        || head.starts_with(b"\xca\xfe\xba\xbe") // Mach-O fat
        || head.starts_with(b"<%") // ASP/JSP-ish text script
}

/// Walk the pack: reject scripts/executables (content-sniffed, not extension-
/// trusted), cap total size, and reject anything that looks like an archive we'd
/// be tempted to extract (we never extract archives — they stay inert files).
fn validate_pack_security(dir: &std::path::Path) -> Result<(), AppError> {
    let mut total: u64 = 0;
    let mut count: u64 = 0;
    for entry in walkdir::WalkDir::new(dir).max_depth(12) {
        let entry = entry.map_err(|e| AppError::Command(format!("pack scan error: {}", e)))?;
        if !entry.file_type().is_file() {
            continue;
        }
        let p = entry.path();
        let ext = p
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();
        if FORBIDDEN_EXTENSIONS.contains(&ext.as_str()) {
            return Err(AppError::Command(format!(
                "Pack contains a forbidden file type ({}) — packs are data-only and may not ship scripts or executables: {}",
                ext, p.display()
            )));
        }
        let data = std::fs::read(p)
            .map_err(|e| AppError::Command(format!("read {}: {}", p.display(), e)))?;
        if looks_executable(&data) {
            return Err(AppError::Command(format!(
                "Pack contains executable content (real file header) — packs are data-only: {}",
                p.display()
            )));
        }
        total += data.len() as u64;
        count += 1;
        if total > PACK_SIZE_CAP {
            return Err(AppError::Command(format!(
                "Pack exceeds the {} MB safety cap.",
                PACK_SIZE_CAP / (1024 * 1024)
            )));
        }
    }
    if count == 0 {
        return Err(AppError::Command("Pack is empty.".into()));
    }
    Ok(())
}

/// Component asset names must be plain filenames — no traversal, no separators.
fn asset_name_ok(asset: &str) -> bool {
    !asset.is_empty()
        && asset != "."
        && asset != ".."
        && !asset.contains("..")
        && !asset.contains('/')
        && !asset.contains('\\')
        && !asset.starts_with('.')
}

fn sha256_hex(data: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(data);
    h.finalize().iter().map(|b| format!("{:02x}", b)).collect()
}

/// Deterministic checksum over every file in a bundle except manifest.json
/// (the manifest carries the checksum itself, so it can't be part of it).
fn bundle_checksum(dir: &std::path::Path) -> String {
    let mut entries: Vec<(String, String)> = Vec::new();
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.flatten() {
            let p = e.path();
            if !p.is_file() {
                continue;
            }
            if p.file_name().map(|n| n == "manifest.json").unwrap_or(false) {
                continue;
            }
            if let Ok(data) = std::fs::read(&p) {
                let rel = p
                    .strip_prefix(dir)
                    .map(|r| r.to_string_lossy().to_string())
                    .unwrap_or_default();
                entries.push((rel, sha256_hex(&data)));
            }
        }
    }
    entries.sort();
    let joined: String = entries
        .iter()
        .map(|(r, s)| format!("{}:{}\n", r, s))
        .collect();
    sha256_hex(joined.as_bytes())
}

#[tauri::command]
pub fn marketplace_import(
    state: State<'_, AppState>,
    source: String,
) -> Result<BundleInfo, AppError> {
    let src = std::path::Path::new(&source);
    if !src.is_dir() {
        return Err(AppError::Command(
            "Source must be a .reforgepack directory (a folder with manifest.json inside).".into(),
        ));
    }
    let manifest_path = src.join("manifest.json");
    let m: BundleManifest = load_json(&manifest_path, empty_manifest(String::new()));
    if m.id.is_empty() || m.name.is_empty() || m.version.is_empty() {
        return Err(AppError::Command(
            "Invalid pack: manifest.json is missing or incomplete (needs id, name, version)."
                .into(),
        ));
    }
    // validate component assets point at plain filenames and exist
    let assets = src.join("assets");
    for comp in &m.components {
        let asset = match comp {
            BundleComponent::Wallpaper { asset } | BundleComponent::SoundEvent { asset, .. } => {
                Some(asset)
            }
            BundleComponent::LockScreen { asset: Some(a), .. } => Some(a),
            _ => None,
        };
        if let Some(a) = asset {
            if !asset_name_ok(a) {
                return Err(AppError::Command(format!(
                    "Pack contains an unsafe asset path '{}' — refusing to install.",
                    a
                )));
            }
            if !assets.join(a).exists() {
                return Err(AppError::Command(format!(
                    "Pack references missing asset '{}'.",
                    a
                )));
            }
        }
    }
    // security sweep over the whole bundle
    validate_pack_security(src)?;
    // checksum verification (when the pack ships one)
    if !m.checksum.is_empty() {
        let actual = bundle_checksum(src);
        if actual != m.checksum {
            return Err(AppError::Command("Checksum mismatch — the pack is corrupted or was tampered with. Refusing to install.".into(),));
        }
    }
    let dst = bundle_dir(&state, &m.id);
    if dst.exists() {
        return Err(AppError::Command(format!(
            "A pack with id '{}' is already installed.",
            m.id
        )));
    }
    // copy the entire bundle directory
    if let Some(parent) = dst.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    copy_dir_all(src, &dst)
        .map_err(|e| AppError::Command(format!("Failed to copy pack: {}", e)))?;
    Ok(BundleInfo {
        id: m.id.clone(),
        name: m.name,
        version: m.version,
        author: m.author,
        description: m.description,
        component_count: m.components.len(),
        applied: false,
    })
}

#[tauri::command]
pub fn marketplace_export_look(
    state: State<'_, AppState>,
    name: String,
) -> Result<BundleInfo, AppError> {
    let m = capture_look(&state);
    let dir = bundle_dir(&state, &m.id);
    std::fs::create_dir_all(dir.join("assets")).map_err(|e| AppError::Command(e.to_string()))?;
    // write manifest (with the user's name), then compute + store the checksum
    let mut m = m;
    m.name = if name.is_empty() {
        "My Look".into()
    } else {
        name
    };
    let manifest_path = dir.join("manifest.json");
    save_json(&manifest_path, &m)?;
    m.checksum = bundle_checksum(&dir);
    save_json(&manifest_path, &m)?;
    Ok(BundleInfo {
        id: m.id.clone(),
        name: m.name,
        version: m.version,
        author: m.author,
        description: m.description,
        component_count: m.components.len(),
        applied: false,
    })
}

#[tauri::command]
pub fn marketplace_export_to_path(
    state: State<'_, AppState>,
    bundle_id: String,
    out_path: String,
) -> Result<String, AppError> {
    let src = bundle_dir(&state, &bundle_id);
    if !src.exists() {
        return Err(AppError::Command(format!(
            "Bundle {} not found.",
            bundle_id
        )));
    }
    let dst = std::path::Path::new(&out_path);
    if dst.exists() {
        return Err(AppError::Command("Target path already exists.".into()));
    }
    copy_dir_all(&src, dst).map_err(|e| AppError::Command(format!("Export failed: {}", e)))?;
    Ok(format!("Exported to {}", dst.display()))
}

#[tauri::command]
pub fn marketplace_apply_bundle(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    bundle_id: String,
) -> Result<String, AppError> {
    let manifest_path = bundle_dir(&state, &bundle_id).join("manifest.json");
    let m: BundleManifest = load_json(&manifest_path, empty_manifest(String::new()));
    if m.id.is_empty() {
        return Err(AppError::Command(
            "Bundle not found or manifest corrupted.".into(),
        ));
    }
    // capture before state for undo
    let before_accent = crate::theme::current_accent_hex();
    let before_mode = crate::theme::current_mode();
    let before_wallpaper = crate::wallpaper::current_wallpaper();
    let before_taskbar = crate::shell::read_taskbar_state();
    let before_lockscreen = crate::lockscreen::get_lock_screen_state();
    let before_cursor = crate::cursors::read_cursor_state();
    let before_scheme = crate::sounds::list_sound_schemes()
        .into_iter()
        .find(|s| s.current)
        .map(|s| s.guid)
        .unwrap_or_default();

    let assets = bundle_dir(&state, &bundle_id).join("assets");

    // apply each component
    for comp in &m.components {
        match comp {
            BundleComponent::Accent { hex } => {
                let _ = crate::theme::apply_accent_hex_raw(hex);
            }
            BundleComponent::ThemeMode { mode } => {
                let _ = crate::theme::apply_mode_raw(mode);
            }
            BundleComponent::Wallpaper { asset } => {
                let path = assets.join(asset);
                if path.exists() {
                    let _ = crate::wallpaper::apply_wallpaper_raw(&path.to_string_lossy());
                }
            }
            BundleComponent::Taskbar {
                size,
                alignment,
                autohide,
            } => {
                if let Some(s) = size {
                    let v = match s.as_str() {
                        "small" => 0u32,
                        "large" => 2u32,
                        _ => 1u32,
                    };
                    let _ = crate::shell::set_taskbar_value_raw("TaskbarSi", v);
                }
                if let Some(a) = alignment {
                    let v = if a == "left" { 0u32 } else { 1u32 };
                    let _ = crate::shell::set_taskbar_value_raw("TaskbarAl", v);
                }
                if let Some(h) = autohide {
                    let _ = crate::shell::set_taskbar_value_raw(
                        "TaskbarAutoHide",
                        if *h { 1u32 } else { 0u32 },
                    );
                }
                crate::shell::notify_shell_change_pub();
            }
            BundleComponent::Cursor { scheme } => {
                let _ = crate::cursors::apply_scheme_raw(scheme);
            }
            BundleComponent::SoundScheme { guid } => {
                let _ = crate::sounds::set_scheme_raw(guid);
            }
            BundleComponent::SoundEvent { event, asset } => {
                let path = assets.join(asset);
                if path.exists() {
                    let _ = crate::sounds::set_event_raw(event, &path.to_string_lossy());
                }
            }
            BundleComponent::Scene {
                id: _sid,
                kind,
                speed,
                density,
                colors,
            } => {
                let scene = crate::wallpaper_engine::SceneConfig {
                    id: _sid.clone(),
                    name: m.name.clone(),
                    kind: kind.clone(),
                    mood: "custom".into(),
                    speed: *speed,
                    density: *density,
                    colors: colors.clone(),
                };
                let _ = crate::wallpaper_engine::start_scene(&app, &scene);
            }
            BundleComponent::FontSub {
                original,
                substitute,
            } => {
                let _ = crate::fonts::restore_substitution(original, substitute);
            }
            BundleComponent::LockScreen { mode, asset } => {
                match mode.as_str() {
                    "image" => {
                        if let Some(a) = asset {
                            let path = assets.join(a);
                            if path.exists() {
                                // copy to app data lock screen dir
                                let dst = state
                                    .data_dir
                                    .join("lockscreen")
                                    .join("bundle_lockscreen.png");
                                if let Some(parent) = dst.parent() {
                                    let _ = std::fs::create_dir_all(parent);
                                }
                                let _ = std::fs::copy(&path, &dst);
                                let _ = crate::lockscreen::set_lock_screen_image_pub(
                                    &state,
                                    &dst.to_string_lossy(),
                                );
                            }
                        }
                    }
                    "slideshow" => {
                        // can't meaningfully capture a slideshow from bundle — skip
                    }
                    _ => {
                        let _ = crate::lockscreen::set_lock_screen_spotlight_pub(&state);
                    }
                }
            }
        }
    }

    // log composite undo
    undo::log_entry(
        &state,
        "marketplace_apply",
        format!("Applied pack: {}", m.name),
        json!({
            "bundle_id": bundle_id,
            "before": {
                "accent": before_accent,
                "mode": before_mode,
                "wallpaper": before_wallpaper,
                "taskbar": before_taskbar,
                "lockscreen": before_lockscreen,
                "cursor": before_cursor,
                "sound_scheme": before_scheme,
            }
        }),
        true,
    )?;

    Ok(format!(
        "Applied pack '{}' ({} components). Revert from History.",
        m.name,
        m.components.len()
    ))
}

#[tauri::command]
pub fn marketplace_get_manifest(
    state: State<'_, AppState>,
    bundle_id: String,
) -> Result<serde_json::Value, AppError> {
    let manifest_path = bundle_dir(&state, &bundle_id).join("manifest.json");
    let m: BundleManifest = load_json(&manifest_path, empty_manifest(String::new()));
    if m.id.is_empty() {
        return Err(AppError::Command("Bundle not found.".into()));
    }
    serde_json::to_value(&m).map_err(|e| AppError::Command(e.to_string()))
}

#[tauri::command]
pub fn marketplace_delete_bundle(
    state: State<'_, AppState>,
    bundle_id: String,
) -> Result<(), AppError> {
    let dir = bundle_dir(&state, &bundle_id);
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| AppError::Command(e.to_string()))?;
    }
    Ok(())
}

// helper: recursive directory copy
fn copy_dir_all(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_all(&src_path, &dst_path)?;
        } else {
            std::fs::copy(&src_path, &dst_path)?;
        }
    }
    Ok(())
}
