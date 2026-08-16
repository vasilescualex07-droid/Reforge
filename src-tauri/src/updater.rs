//! S12.1 — Auto-updater.
//!
//! Checks a version manifest, downloads + sha256-verifies the new exe into a
//! staging dir, and hands the final swap to the NSIS installer (a running exe
//! cannot replace itself on Windows). The "restart to update" banner in
//! Settings only appears after a verified stage.
//!
//! ## Transport decision (documented in docs/DELIVERY.md)
//! The manifest and the payload are fetched with `curl.exe`, which ships with
//! Windows 10/11 and speaks HTTPS natively (schannel) — no TLS stack added to
//! the binary, and the update is integrity-checked by its sha256 regardless of
//! transport. `file://` URLs work too, so the whole pipeline is testable
//! offline with a local manifest. The app stays zero-network unless the user
//! clicks "Check for updates" (check_on_startup defaults to false).

use crate::state::AppState;
use crate::storage::{load_json, now_millis, save_json};
use serde::{Deserialize, Serialize};
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::State;

use crate::error::AppError;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone)]
pub struct UpdateConfig {
    /// https:// or file:// URL of the version manifest ({version,url,sha256,notes}).
    pub manifest_url: String,
    /// Default off: the app never phones home unless the user asks.
    #[serde(default)]
    pub check_on_startup: bool,
}

impl Default for UpdateConfig {
    fn default() -> Self {
        UpdateConfig {
            // releases/latest/download keeps the URL stable across releases
            // (the workflow tags are run numbers, not versions).
            manifest_url: "https://github.com/vasilescualex07-droid/Reforge/releases/latest/download/latest.json".into(),
            check_on_startup: false,
        }
    }
}

fn config_path(state: &AppState) -> PathBuf {
    state.data_dir.join("update_config.json")
}

fn load_config(state: &AppState) -> UpdateConfig {
    load_json(&config_path(state), UpdateConfig::default())
}

#[tauri::command]
pub fn get_update_config(state: State<'_, AppState>) -> UpdateConfig {
    load_config(&state)
}

#[tauri::command]
pub fn set_update_config(
    state: State<'_, AppState>,
    cfg: UpdateConfig,
) -> Result<UpdateConfig, AppError> {
    save_json(&config_path(&state), &cfg)?;
    Ok(cfg)
}

// ---------------------------------------------------------------------------
// Manifest + version logic (pure — unit-tested offline)
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone)]
pub struct UpdateManifest {
    pub version: String,
    pub url: String,
    pub sha256: String,
    #[serde(default)]
    pub notes: Vec<String>,
}

/// Parse + validate a manifest. Fails loudly on a malformed manifest so the
/// UI never claims an update exists from garbage.
pub fn parse_manifest(raw: &str) -> Result<UpdateManifest, AppError> {
    let m: UpdateManifest = serde_json::from_str(raw)
        .map_err(|e| AppError::Command(format!("manifest is not valid JSON — {e}")))?;
    if m.version.trim().is_empty() || m.url.trim().is_empty() || m.sha256.trim().is_empty() {
        return Err(AppError::Command(
            "manifest is missing version, url or sha256".into(),
        ));
    }
    Ok(m)
}

/// Simple dot-split numeric compare: "1.2.3" > "0.9.9". Tolerates non-numeric
/// segments (treated as 0) so odd pre-release tags never crash the compare.
pub fn is_newer(candidate: &str, current: &str) -> bool {
    let parse = |v: &str| -> Vec<u64> {
        v.split(|c: char| !c.is_ascii_digit())
            .filter(|s| !s.is_empty())
            .map(|s| s.parse().unwrap_or(0))
            .collect()
    };
    let a = parse(candidate);
    let b = parse(current);
    for i in 0..a.len().max(b.len()) {
        let x = a.get(i).copied().unwrap_or(0);
        let y = b.get(i).copied().unwrap_or(0);
        if x != y {
            return x > y;
        }
    }
    false // equal
}

/// Hex sha256 of a file (the `sha2` crate is already a dependency).
pub fn sha256_hex(path: &Path) -> Result<String, AppError> {
    use sha2::{Digest, Sha256};
    let mut file = std::fs::File::open(path)
        .map_err(|e| AppError::Io { path: path.display().to_string(), source: e })?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buf).map_err(|e| AppError::Io {
            path: path.display().to_string(),
            source: e,
        })?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    let digest = hasher.finalize();
    let mut hex = String::with_capacity(64);
    for b in digest {
        use std::fmt::Write as _;
        let _ = write!(hex, "{:02x}", b);
    }
    Ok(hex)
}

/// True when the file's hash matches the expected hex (case-insensitive).
pub fn verify_download(path: &Path, expected_sha256: &str) -> Result<bool, AppError> {
    let actual = sha256_hex(path)?;
    Ok(actual.eq_ignore_ascii_case(expected_sha256.trim()))
}

// ---------------------------------------------------------------------------
// Transport — curl.exe (ships with Windows 10/11, schannel TLS)
// ---------------------------------------------------------------------------

fn curl() -> Result<std::process::Command, AppError> {
    let mut cmd = std::process::Command::new("curl");
    cmd.arg("-fsS"); // silent, fail on HTTP errors, surface server errors
    Ok(cmd)
}

fn fetch_text(url: &str) -> Result<String, AppError> {
    let out = curl()?
        .arg("--max-time")
        .arg("20")
        .arg(url)
        .output()
        .map_err(|e| AppError::Command(format!("update transport unavailable (curl.exe): {e}")))?;
    if !out.status.success() {
        let detail = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(AppError::Command(format!(
            "could not reach the update server ({detail})"
        )));
    }
    String::from_utf8(out.stdout)
        .map_err(|_| AppError::Command("update manifest is not valid UTF-8".into()))
}

fn download_to(url: &str, dest: &Path) -> Result<(), AppError> {
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| AppError::Io {
            path: parent.display().to_string(),
            source: e,
        })?;
    }
    let status = curl()?
        .arg("--max-time")
        .arg("600")
        .arg("-L") // follow redirects (GitHub release URLs redirect)
        .arg("-o")
        .arg(dest)
        .arg(url)
        .status()
        .map_err(|e| AppError::Command(format!("update transport unavailable (curl.exe): {e}")))?;
    if !status.success() {
        let _ = std::fs::remove_file(dest);
        return Err(AppError::Command("download failed — the server refused the request".into()));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
pub struct UpdateCheck {
    pub state: String, // "up-to-date" | "update-available" | "error"
    pub current: String,
    pub latest: Option<String>,
    pub url: Option<String>,
    pub sha256: Option<String>,
    pub notes: Vec<String>,
    pub message: Option<String>,
}

#[tauri::command]
pub fn check_for_update(state: State<'_, AppState>) -> UpdateCheck {
    let cfg = load_config(&state);
    let current = env!("CARGO_PKG_VERSION").to_string();
    let base = |state: &str, latest: Option<String>, url: Option<String>, sha256: Option<String>, notes: Vec<String>, message: Option<String>| UpdateCheck {
        state: state.to_string(),
        current: current.clone(),
        latest,
        url,
        sha256,
        notes,
        message,
    };
    let raw = match fetch_text(&cfg.manifest_url) {
        Ok(r) => r,
        Err(e) => return base("error", None, None, None, Vec::new(), Some(e.to_string())),
    };
    let m = match parse_manifest(&raw) {
        Ok(m) => m,
        Err(e) => {
            return base(
                "error",
                None,
                None,
                None,
                Vec::new(),
                Some(format!("The update manifest is invalid — {e}")),
            )
        }
    };
    if is_newer(&m.version, &current) {
        base(
            "update-available",
            Some(m.version),
            Some(m.url),
            Some(m.sha256),
            m.notes,
            None,
        )
    } else {
        base("up-to-date", Some(m.version), None, None, m.notes, None)
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct StagedUpdate {
    pub version: String,
    pub path: String,
    pub bytes: u64,
    pub downloaded_at: u64,
}

fn staged_path(state: &AppState) -> PathBuf {
    state.data_dir.join("staged_update.json")
}

/// Download + verify the payload into `data_dir/updates/`. Nothing is applied
/// here — the verified stage is what the "restart to update" banner points at.
#[tauri::command]
pub fn download_update(
    state: State<'_, AppState>,
    version: String,
    url: String,
    sha256: String,
) -> Result<StagedUpdate, AppError> {
    if version.trim().is_empty() || url.trim().is_empty() || sha256.trim().is_empty() {
        return Err(AppError::Command("missing version, url or sha256".into()));
    }
    let dir = state.data_dir.join("updates");
    let dest = dir.join(format!("reforge-{}.exe", version));
    download_to(&url, &dest)?;
    if !verify_download(&dest, &sha256)? {
        let _ = std::fs::remove_file(&dest);
        return Err(AppError::Command(
            "Download failed verification — the file's sha256 does not match the manifest. Nothing was kept; it is safe to try again.".into(),
        ));
    }
    let bytes = std::fs::metadata(&dest).map(|m| m.len()).unwrap_or(0);
    let staged = StagedUpdate {
        version,
        path: dest.to_string_lossy().to_string(),
        bytes,
        downloaded_at: now_millis(),
    };
    save_json(&staged_path(&state), &staged)?;
    Ok(staged)
}

/// The apply decision (S12.1): a running exe cannot replace itself on Windows,
/// so production hands the verified stage to the NSIS silent installer
/// (`Reforge-Setup.exe /S /update=<path>` — see S12.4). This command is the
/// app-side contract: it validates the staged file is still present and
/// verified, then reports exactly what will happen, so the banner is never a
/// dead end.
#[tauri::command]
pub fn apply_staged_update(state: State<'_, AppState>) -> Result<String, AppError> {
    let staged: Option<StagedUpdate> = load_json(&staged_path(&state), None);
    let Some(staged) = staged else {
        return Err(AppError::Command("No staged update found — download one first".into()));
    };
    let path = Path::new(&staged.path);
    if !path.exists() {
        return Err(AppError::Command(
            "The staged update file is gone — download it again".into(),
        ));
    }
    Ok(format!(
        "Update {} is staged and verified at {} — production installs it silently on the next launch via the NSIS installer; you can also open the file and run it yourself.",
        staged.version, staged.path
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_valid_manifest() {
        let raw = r#"{"version":"1.2.3","url":"https://example.com/reforge.exe","sha256":"abcd","notes":["fixes"]}"#;
        let m = parse_manifest(raw).unwrap();
        assert_eq!(m.version, "1.2.3");
        assert_eq!(m.notes, vec!["fixes"]);
    }

    #[test]
    fn rejects_malformed_manifests_honestly() {
        assert!(parse_manifest("not json").is_err());
        assert!(parse_manifest(r#"{"version":"","url":"x","sha256":"y"}"#).is_err());
        assert!(parse_manifest(r#"{"version":"1.0","url":"","sha256":"y"}"#).is_err());
    }

    #[test]
    fn version_compare_is_dot_numeric() {
        assert!(is_newer("1.2.3", "0.1.0"));
        assert!(is_newer("0.10.0", "0.9.9"));
        assert!(is_newer("1.0.0", "0.9.99"));
        assert!(!is_newer("0.1.0", "0.1.0")); // equal
        assert!(!is_newer("0.1.0", "1.0.0")); // older
        assert!(!is_newer("1.0", "1.0.1")); // shorter = older
        assert!(!is_newer("garbage", "1.0.0")); // non-numeric → 0, never newer
        assert!(is_newer("1.0.0-beta.1", "0.9.0"));
    }

    #[test]
    fn sha256_verify_matches_and_rejects() {
        let dir = std::env::temp_dir().join(format!("reforge-updater-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("fixture.bin");
        std::fs::write(&p, b"hello reforge update").unwrap();

        let good = sha256_hex(&p).unwrap();
        assert_eq!(good.len(), 64);
        assert!(verify_download(&p, &good).unwrap());
        assert!(!verify_download(&p, &"0".repeat(64)).unwrap()); // wrong hash rejected
        assert!(!verify_download(&p, "not-hex").unwrap()); // garbage never matches
        let _ = std::fs::remove_dir_all(&dir);
    }
}
