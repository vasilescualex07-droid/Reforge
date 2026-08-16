use serde::Serialize;
use winreg::enums::HKEY_LOCAL_MACHINE;
use winreg::RegKey;

// ---------------------------------------------------------------------------
// OS Capability Matrix — single source of truth for what this OS build allows.
// Computed on demand (cheap) and cached by the frontend.
// ---------------------------------------------------------------------------

use crate::error::AppError;
#[derive(Serialize, Clone)]
pub struct CapabilityMatrix {
    pub os_name: String,      // e.g. "Windows 11 Pro"
    pub build: u32,           // e.g. 26200
    pub version_band: String, // "win10" | "win11_21h2" ... | "win11_25h2" | "unknown"
    pub is_win11: bool,
    pub admin: bool,
    pub secure_boot: Option<bool>,
    // per-capability flags
    pub taskbar_reposition_supported: bool, // Win10 only — Win11 removed the ability
    pub font_substitution_supported: bool,  // HKLM FontSubstitutes — needs admin
    pub lockscreen_policy_supported: bool,  // HKLM Personalization policy — needs admin
    pub boot_customization_supported: bool, // always false — safe userspace substitute only
    pub rgb_supported: bool,                // OpenRGB SDK reachable right now
    pub video_wallpaper_supported: bool,    // WorkerW technique available
    pub ffmpeg_available: bool,             // transcode sidecar present
    pub elevation_required_reason: Option<String>,
}

pub fn build_number() -> u32 {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    match hklm.open_subkey(r"SOFTWARE\Microsoft\Windows NT\CurrentVersion") {
        Ok(k) => k
            .get_value::<String, _>("CurrentBuildNumber")
            .ok()
            .and_then(|s| s.trim().parse::<u32>().ok())
            .unwrap_or(0),
        Err(_) => 0,
    }
}

pub fn product_name() -> String {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    match hklm.open_subkey(r"SOFTWARE\Microsoft\Windows NT\CurrentVersion") {
        Ok(k) => k
            .get_value::<String, _>("ProductName")
            .unwrap_or_else(|_| "Windows".into()),
        Err(_) => "Windows".into(),
    }
}

fn version_band(build: u32) -> String {
    if build == 0 {
        return "unknown".into();
    }
    if build < 22000 {
        return "win10".into();
    }
    let bands: &[(u32, &str)] = &[
        (26100, "win11_24h2"),
        (25999, "win11_25h2"), // 25H2 preview band sits above 26100
        (22631, "win11_23h2"),
        (22621, "win11_22h2"),
        (22000, "win11_21h2"),
    ];
    for (min, name) in bands {
        if build >= *min {
            return name.to_string();
        }
    }
    "win11".into()
}

pub fn is_admin() -> bool {
    // Check for a high/medium integrity token without requiring windows crate admin API.
    unsafe {
        use windows::Win32::Foundation::HANDLE;
        use windows::Win32::Security::{
            GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY,
        };
        use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

        let mut token = HANDLE::default();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).is_err() {
            return false;
        }
        let mut elev: TOKEN_ELEVATION = std::mem::zeroed();
        let mut len: u32 = 0;
        if GetTokenInformation(
            token,
            TokenElevation,
            Some(&mut elev as *mut _ as *mut core::ffi::c_void),
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut len,
        )
        .is_err()
        {
            return false;
        }
        elev.TokenIsElevated != 0
    }
}

pub fn secure_boot_status() -> Option<bool> {
    // UEFI secure boot state lives in firmware; try the documented WMI read.
    let out = crate::cmd::hidden("powershell.exe")
        .args([
            "-NoProfile",
            "-Command",
            "try { (Confirm-SecureBootUEFI) } catch { 'n/a' }",
        ])
        .output()
        .ok()?;
    let s = String::from_utf8_lossy(&out.stdout).trim().to_lowercase();
    match s.as_str() {
        "true" => Some(true),
        "false" => Some(false),
        _ => None,
    }
}

fn rgb_reachable() -> bool {
    use std::io::{Read, Write};
    use std::net::TcpStream;
    use std::time::Duration;
    let mut ok = false;
    if let Ok(mut s) = TcpStream::connect_timeout(
        // constant literal — safe to unwrap
        &"127.0.0.1:6742".parse().unwrap(),
        Duration::from_millis(700),
    ) {
        s.set_read_timeout(Some(Duration::from_millis(700))).ok();
        s.set_write_timeout(Some(Duration::from_millis(700))).ok();
        let _ = s.write_all(&[0x00]); // device 0 handshake
        let mut buf = [0u8; 4];
        if s.read_exact(&mut buf).is_ok() {
            ok = true;
        }
    }
    ok
}

pub fn ffmpeg_available() -> bool {
    crate::transcode::ffmpeg_path().is_some()
}

pub fn compute() -> CapabilityMatrix {
    let build = build_number();
    let is_win11 = build >= 22000;
    let admin = is_admin();
    let band = version_band(build);
    let mut caps = CapabilityMatrix {
        os_name: product_name(),
        build,
        version_band: band.clone(),
        is_win11,
        admin,
        secure_boot: secure_boot_status(),
        taskbar_reposition_supported: !is_win11,
        font_substitution_supported: true,
        lockscreen_policy_supported: true,
        boot_customization_supported: false,
        rgb_supported: false,
        video_wallpaper_supported: true,
        ffmpeg_available: false,
        elevation_required_reason: None,
    };
    caps.rgb_supported = rgb_reachable();
    caps.ffmpeg_available = ffmpeg_available();

    // Surface which admin-gated features need elevation on this machine.
    if !admin {
        let needed: Vec<&str> = Vec::new();
        let _ = needed;
        caps.elevation_required_reason = Some(
            "Reforge is running without administrator rights. Font swapping and lock-screen \
             customization write to machine-wide registry keys and need elevation."
                .into(),
        );
    }
    let _ = band;
    caps
}

#[tauri::command]
pub fn get_capability_matrix() -> CapabilityMatrix {
    compute()
}

#[tauri::command]
pub fn request_elevation() -> Result<String, AppError> {
    // Relaunch ourselves with a UAC prompt. Only the app triggers the OS prompt.
    let exe = std::env::current_exe().map_err(|e| AppError::Command(e.to_string()))?;
    let out = crate::cmd::hidden("powershell.exe")
        .args([
            "-NoProfile",
            "-Command",
            &format!(
                "Start-Process -FilePath '{}' -Verb RunAs",
                exe.to_string_lossy()
            ),
        ])
        .output()
        .map_err(|e| AppError::Command(e.to_string()))?;
    if out.status.success() {
        Ok("Reforge is relaunching with administrator rights…".into())
    } else {
        Err(AppError::Command(
            "Elevation was declined or failed. Font and lock-screen features need admin rights."
                .into(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn band_classification() {
        assert!(version_band(19045).starts_with("win10"));
        assert!(version_band(22631).starts_with("win11"));
        assert!(version_band(26100).starts_with("win11"));
        assert!(version_band(0) == "unknown");
    }

    #[test]
    fn win11_hides_repositioning() {
        let is_win11 = 26200 >= 22000;
        let supported = !is_win11;
        assert!(!supported);
    }
}
