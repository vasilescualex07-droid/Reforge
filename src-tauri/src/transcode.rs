use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use symphonia::core::audio::Signal;

// ---------------------------------------------------------------------------
// Media Transcode Pipeline — one shared path for every media import in the app.
// ffmpeg ships as a bundled sidecar (resources/bin/ffmpeg.exe); if it's absent
// we degrade gracefully and say so explicitly — never silently.
// ---------------------------------------------------------------------------

use crate::error::AppError;
use crate::state::AppState;
use crate::storage::{load_json, save_json};
use tauri::State;

const MAX_IMPORT_BYTES: u64 = 500 * 1024 * 1024; // 500 MB hard cap on imports

// ---------------------------------------------------------------------------
// Transcode preset (C3.1) — one of three quality/size budgets applied to every
// media import. Picked in Settings; persisted to transcode_config.json so the
// choice survives restarts and drives both video wallpapers and style media.
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum TranscodePreset {
    High,
    Balanced,
    Performance,
}

impl TranscodePreset {
    /// Longest edge the import is scaled to. Sources smaller than the cap keep
    /// their size (scale=min keeps aspect, never upscales).
    pub fn max_dim(self) -> u32 {
        match self {
            TranscodePreset::High => 1920,
            TranscodePreset::Balanced => 1280,
            TranscodePreset::Performance => 960,
        }
    }
    pub fn bitrate(self) -> &'static str {
        match self {
            TranscodePreset::High => "8000k",
            TranscodePreset::Balanced => "5000k",
            TranscodePreset::Performance => "2500k",
        }
    }
    pub fn crf(self) -> u32 {
        match self {
            TranscodePreset::High => 18,
            TranscodePreset::Balanced => 23,
            TranscodePreset::Performance => 28,
        }
    }
    pub fn ffmpeg_preset(self) -> &'static str {
        match self {
            TranscodePreset::High => "slow",
            TranscodePreset::Balanced => "medium",
            TranscodePreset::Performance => "veryfast",
        }
    }
    pub fn label(self) -> &'static str {
        match self {
            TranscodePreset::High => "High quality",
            TranscodePreset::Balanced => "Balanced",
            TranscodePreset::Performance => "Performance",
        }
    }
    /// Honest one-line description shown in Settings next to the picker.
    pub fn description(self) -> String {
        let mbps = self
            .bitrate()
            .trim_end_matches('k')
            .parse::<u32>()
            .unwrap_or(0)
            / 1000;
        format!("{}p cap · ~{} Mbps max", self.max_dim(), mbps)
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct TranscodeConfig {
    pub preset: TranscodePreset,
}

impl Default for TranscodeConfig {
    fn default() -> Self {
        TranscodeConfig {
            preset: TranscodePreset::Balanced,
        }
    }
}

fn config_path(state: &AppState) -> PathBuf {
    state.data_dir.join("transcode_config.json")
}

fn load_config(state: &AppState) -> TranscodeConfig {
    load_json(&config_path(state), TranscodeConfig::default())
}

#[tauri::command]
pub fn get_transcode_config(state: State<'_, AppState>) -> TranscodeConfig {
    load_config(&state)
}

#[tauri::command]
pub fn set_transcode_config(
    state: State<'_, AppState>,
    config: TranscodeConfig,
) -> Result<TranscodeConfig, AppError> {
    save_json(&config_path(&state), &config)?;
    Ok(config)
}

pub fn ffmpeg_path() -> Option<PathBuf> {
    // 1. bundled sidecar next to the exe (release builds copy resources here)
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let candidate = dir.join("ffmpeg.exe");
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }
    // 2. project resources dir (dev mode)
    for cand in [
        PathBuf::from("resources/bin/ffmpeg.exe"),
        PathBuf::from("src-tauri/resources/bin/ffmpeg.exe"),
    ] {
        if cand.exists() {
            return Some(cand);
        }
    }
    // 3. on PATH
    if let Ok(out) = crate::cmd::hidden("ffmpeg").arg("-version").output() {
        if out.status.success() {
            return Some(PathBuf::from("ffmpeg"));
        }
    }
    None
}

#[derive(Serialize, Clone)]
pub struct TranscodeStatus {
    pub available: bool,
    pub version: Option<String>,
    pub path: Option<String>,
    pub max_import_bytes: u64,
    pub note: String,
}

#[tauri::command]
pub fn media_get_transcode_status(state: State<'_, AppState>) -> TranscodeStatus {
    let preset = load_config(&state).preset;
    match ffmpeg_path() {
        Some(p) => {
            let ver = crate::cmd::hidden(p.to_str().unwrap_or("ffmpeg"))
                .arg("-version")
                .output()
                .ok()
                .map(|o| {
                    String::from_utf8_lossy(&o.stdout)
                        .lines()
                        .next()
                        .unwrap_or("ffmpeg")
                        .to_string()
                });
            TranscodeStatus {
                available: true,
                version: ver,
                path: Some(p.to_string_lossy().into()),
                max_import_bytes: MAX_IMPORT_BYTES,
                note: format!(
                    "Videos are normalized on import — preset: {} ({}).",
                    preset.label(),
                    preset.description()
                ),
            }
        }
        None => TranscodeStatus {
            available: false,
            version: None,
            path: None,
            max_import_bytes: MAX_IMPORT_BYTES,
            note: "ffmpeg is not bundled on this install. Video imports still work but play \
                   at source size; install the ffmpeg sidecar for normalized playback."
                .into(),
        },
    }
}

// ---- video import / normalization -----------------------------------------

#[derive(Serialize, Clone)]
pub struct MediaImport {
    pub source: String,
    pub normalized: String, // path of the import-ready file
    pub kind: String,       // "video" | "gif"
    pub width: u32,
    pub height: u32,
    pub normalized_by: String, // "ffmpeg" | "image" | "passthrough"
    pub note: String,
}

pub fn sniff_media_kind(path: &Path) -> Result<String, AppError> {
    let data = std::fs::read(path)
        .map_err(|e| AppError::Command(format!("read {}: {}", path.display(), e)))?;
    if data.len() < 12 {
        return Err(AppError::Command("file is too small to be media".into()));
    }
    let is_gif = &data[0..6] == b"GIF89a" || &data[0..6] == b"GIF87a";
    let is_webm = &data[0..4] == b"\x1a\x45\xdf\xa3"; // EBML (webm/mkv)
    let is_mp4_ftyp = &data[4..8] == b"ftyp";
    let is_mov = &data[4..8] == b"moov" || &data[4..8] == b"mdat";
    if is_gif {
        Ok("gif".into())
    } else if is_webm || is_mp4_ftyp || is_mov {
        Ok("video".into())
    } else {
        Err(AppError::Command(
            "not a recognizable video or GIF (checked file header, not extension)".into(),
        ))
    }
}

/// ffmpeg transcode with live progress (E1): `-progress pipe:1` streams
/// `out_time_ms` lines which we parse and hand to the callback as seconds
/// elapsed. The caller pushes this onto a blocking thread, so the UI never
/// freezes and the frontend receives `transcode-progress` events. Stderr is
/// drained on a helper thread (with `-loglevel error` it stays tiny, but the
/// pipe must never fill and deadlock ffmpeg).
fn transcode_video_p(
    src: &Path,
    dst: &Path,
    progress: &mut dyn FnMut(f64),
    preset: TranscodePreset,
) -> Result<(u32, u32), AppError> {
    let ff = ffmpeg_path().ok_or("ffmpeg sidecar not found")?;
    let dim = preset.max_dim();
    let bufsize = format!("{}k", preset.bitrate().trim_end_matches('k').parse::<u32>().unwrap_or(6000) * 2);
    let mut child = crate::cmd::hidden(ff.to_str().unwrap_or("ffmpeg"))
        .args([
            "-y",
            "-i",
            &src.to_string_lossy(),
            "-vf",
            &format!(
                "scale='min({},iw)':'min({},ih)':force_original_aspect_ratio=decrease",
                dim, dim
            ),
            "-c:v",
            "libx264",
            "-preset",
            preset.ffmpeg_preset(),
            "-crf",
            &preset.crf().to_string(),
            "-maxrate",
            preset.bitrate(),
            "-bufsize",
            &bufsize,
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            "-an",
            "-r",
            "30",
            "-progress",
            "pipe:1",
            "-loglevel",
            "error",
            &dst.to_string_lossy(),
        ])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| AppError::Command(e.to_string()))?;

    let err_handle = child.stderr.take().map(|mut se| {
        std::thread::spawn(move || {
            use std::io::Read;
            let mut s = String::new();
            let _ = se.read_to_string(&mut s);
            s
        })
    });

    if let Some(out) = child.stdout.take() {
        use std::io::BufRead;
        let mut reader = std::io::BufReader::new(out);
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) => break,
                Ok(_) => {
                    if let Some(v) = line.trim().strip_prefix("out_time_ms=") {
                        if let Ok(ms) = v.trim().parse::<i64>() {
                            progress(ms as f64 / 1000.0);
                        }
                    }
                }
                Err(_) => break,
            }
        }
    }

    let status = child.wait().map_err(|e| AppError::Command(e.to_string()))?;
    let stderr_text = err_handle.and_then(|h| h.join().ok()).unwrap_or_default();
    if !status.success() {
        return Err(AppError::Command(format!(
            "ffmpeg failed: {}",
            stderr_text.lines().next_back().unwrap_or("unknown error")
        )));
    }
    // The transcode itself succeeded — a later dimension-probe hiccup must not
    // fail the import. Fall back to the screen size so the wallpaper still
    // plays (the video HTML sizes to the window, not the media's dims).
    Ok(probe_dimensions(dst).unwrap_or_else(|_| screen_fallback_dims()))
}

/// Extract `WxH` from an ffmpeg `-i` stream line. Modern ffmpeg prints hex
/// tags before the dimensions (`Stream #0:0[0x1](und): Video: h264 (Main)
/// (avc1 / 0x31637661), yuv420p(...), 720x1280`), so taking the *first* `x`
/// in the line lands in a codec tag and the parse fails. Instead, scan for the
/// first real `<digits>x<digits>` run anywhere on the line.
pub fn parse_video_dimensions(line: &str) -> Option<(u32, u32)> {
    let b = line.as_bytes();
    let n = b.len();
    let mut i = 0;
    while i + 2 < n {
        if !b[i].is_ascii_digit() {
            i += 1;
            continue;
        }
        let ws = i;
        while i < n && b[i].is_ascii_digit() {
            i += 1;
        }
        if i >= n || b[i] != b'x' {
            continue;
        }
        let hs = i + 1;
        let mut j = hs;
        while j < n && b[j].is_ascii_digit() {
            j += 1;
        }
        let end = j;
        i = end;
        if end == hs {
            continue;
        }
        let w: u32 = line[ws..hs - 1].parse().ok()?;
        let h: u32 = line[hs..end].parse().ok()?;
        if w > 0 && h > 0 {
            return Some((w, h));
        }
    }
    None
}

/// Fallback dimensions when nothing else works: the virtual screen size, so a
/// wallpaper still plays (its HTML sizes to the window, not the video dims)
/// instead of the whole import failing.
fn screen_fallback_dims() -> (u32, u32) {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetSystemMetrics, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN,
    };
    unsafe {
        let w = GetSystemMetrics(SM_CXVIRTUALSCREEN);
        let h = GetSystemMetrics(SM_CYVIRTUALSCREEN);
        if w > 0 && h > 0 {
            (w as u32, h as u32)
        } else {
            (1920, 1080)
        }
    }
}

/// Probe dimensions straight from the container header — no subprocess, so
/// `list_video_wallpapers` doesn't spawn ffmpeg per file. Covers GIF (header
/// u16 width/height) and MP4/MOV (walk moov→trak→tkhd; width/height are
/// 16.16 fixed point). Returns None for anything it can't parse so callers
/// fall back to ffmpeg / the screen-size fallback.
pub fn probe_dimensions_native(path: &Path) -> Option<(u32, u32)> {
    let data = std::fs::read(path).ok()?;
    // GIF: "GIF89a" / "GIF87a" then u16le width, u16le height (10 bytes total)
    if data.len() >= 10 && (&data[0..6] == b"GIF89a" || &data[0..6] == b"GIF87a") {
        let w = u16::from_le_bytes([data[6], data[7]]) as u32;
        let h = u16::from_le_bytes([data[8], data[9]]) as u32;
        if w > 0 && h > 0 {
            return Some((w, h));
        }
        return None;
    }
    if data.len() < 12 {
        return None;
    }
    // MP4/MOV: top-level boxes; only `moov` matters for dimensions.
    let mut pos = 0usize;
    while pos + 8 <= data.len() {
        let (header, box_len) = box_len_at(&data, pos)?;
        if box_len < header || pos + box_len > data.len() {
            break;
        }
        if &data[pos + 4..pos + 8] == b"moov" {
            if let Some(dims) = moov_dimensions(&data[pos..pos + box_len]) {
                return Some(dims);
            }
        }
        pos += box_len;
    }
    None
}

/// Box header helpers — ISO-BMFF box size is u32 BE; `size == 1` means a u64
/// size follows the type, `size == 0` means "to end of file".
fn box_len_at(data: &[u8], pos: usize) -> Option<(usize, usize)> {
    if pos + 8 > data.len() {
        return None;
    }
    let size = u32::from_be_bytes(data[pos..pos + 4].try_into().ok()?) as usize;
    if size == 1 {
        if pos + 16 > data.len() {
            return None;
        }
        let len = u64::from_be_bytes(data[pos + 8..pos + 16].try_into().ok()?) as usize;
        Some((16, len))
    } else if size == 0 {
        Some((8, data.len() - pos))
    } else {
        Some((8, size))
    }
}

fn moov_dimensions(moov: &[u8]) -> Option<(u32, u32)> {
    let mut pos = 8usize; // skip the moov box header
    while pos + 8 <= moov.len() {
        let (header, box_len) = box_len_at(moov, pos)?;
        if box_len < header || pos + box_len > moov.len() {
            break;
        }
        if &moov[pos + 4..pos + 8] == b"trak" {
            if let Some(d) = trak_dimensions(&moov[pos..pos + box_len]) {
                return Some(d);
            }
        }
        pos += box_len;
    }
    None
}

fn trak_dimensions(trak: &[u8]) -> Option<(u32, u32)> {
    let mut pos = 8usize; // skip the trak box header
    while pos + 8 <= trak.len() {
        let (header, box_len) = box_len_at(trak, pos)?;
        if box_len < header || pos + box_len > trak.len() {
            break;
        }
        if &trak[pos + 4..pos + 8] == b"tkhd" {
            return tkhd_dimensions(&trak[pos..pos + box_len]);
        }
        pos += box_len;
    }
    None
}

/// `tkhd`: after version/flags, v0 has creation(4) mod(4) id(4) reserved(4)
/// duration(4), v1 has the 64-bit variants (12 bytes more); then reserved(8),
/// layer/altgroup/volume/reserved (2×4), matrix (36), width(4), height(4).
/// Width/height are 16.16 fixed point.
fn tkhd_dimensions(tkhd: &[u8]) -> Option<(u32, u32)> {
    if tkhd.len() < 20 {
        return None;
    }
    let version = tkhd[8];
    let w_off = if version == 1 { 96 } else { 84 };
    if tkhd.len() < w_off + 8 {
        return None;
    }
    let w = u32::from_be_bytes(tkhd[w_off..w_off + 4].try_into().ok()?) >> 16;
    let h = u32::from_be_bytes(tkhd[w_off + 4..w_off + 8].try_into().ok()?) >> 16;
    // Sanity-bound the fixed offsets: other muxers may lay the tkhd out
    // differently, and a garbage-but-plausible value must not beat ffmpeg's
    // correct parse (probe_dimensions trusts the header probe first).
    if (1..=16384).contains(&w) && (1..=16384).contains(&h) {
        Some((w, h))
    } else {
        None
    }
}

pub fn probe_dimensions(path: &Path) -> Result<(u32, u32), AppError> {
    // 1. Container-header parse — fast and needs no sidecar. The app's own
    //    imports are always mp4/gif, so this covers the common cases.
    if let Some(dims) = probe_dimensions_native(path) {
        return Ok(dims);
    }
    // 2. ffmpeg -i, with a parser that survives hex codec tags.
    if let Some(ff) = ffmpeg_path() {
        let out = crate::cmd::hidden(ff.to_str().unwrap_or("ffmpeg"))
            .args(["-i", &path.to_string_lossy()])
            .output()
            .map_err(|e| AppError::Command(e.to_string()))?;
        let err = String::from_utf8_lossy(&out.stderr);
        for line in err.lines() {
            if line.contains("Video:") {
                if let Some((w, h)) = parse_video_dimensions(line) {
                    return Ok((w, h));
                }
            }
        }
    }
    Err(AppError::Command(
        "could not determine video dimensions".into(),
    ))
}

// ---- GIF normalization (pure Rust via the image crate) ----------------------

pub fn normalize_gif(src: &Path, dst: &Path, preset: TranscodePreset) -> Result<(u32, u32), AppError> {
    let img = image::open(src).map_err(|e| AppError::Command(format!("decode GIF: {}", e)))?;
    let (w, h) = (img.width(), img.height());
    let scale = (preset.max_dim() as f32 / w.max(h) as f32).min(1.0);
    let (nw, nh) = (
        ((w as f32 * scale).round() as u32).max(1),
        ((h as f32 * scale).round() as u32).max(1),
    );
    let resized = if scale < 1.0 {
        img.resize(nw, nh, image::imageops::FilterType::Lanczos3)
    } else {
        img
    };
    resized
        .save_with_format(dst, image::ImageFormat::Gif)
        .map_err(|e| AppError::Command(format!("re-encode GIF: {}", e)))?;
    Ok((nw, nh))
}

/// Shared entry point: validate source, normalize, and report what happened.
/// `progress` receives seconds of ffmpeg elapsed (E1) — the commands wrap this
/// in a blocking thread and forward the ticks as `transcode-progress` events.
/// the commands wrap this in a blocking thread and forward the ticks as
/// `transcode-progress` events.
pub fn import_media_p(
    src: &Path,
    out_dir: &Path,
    progress: &mut dyn FnMut(f64),
    preset: TranscodePreset,
) -> Result<MediaImport, AppError> {
    let meta = std::fs::metadata(src)
        .map_err(|e| AppError::Command(format!("{}: {}", src.display(), e)))?;
    if meta.len() > MAX_IMPORT_BYTES {
        return Err(AppError::Command(format!(
            "Source file is {:.1} MB — the import cap is {} MB. Pick a smaller file.",
            meta.len() as f64 / (1024.0 * 1024.0),
            MAX_IMPORT_BYTES / (1024 * 1024)
        )));
    }
    if meta.len() < 64 {
        return Err(AppError::Command(
            "Source file is too small to be a real video or GIF.".into(),
        ));
    }
    let kind = sniff_media_kind(src)?;
    std::fs::create_dir_all(out_dir).map_err(|e| AppError::Command(e.to_string()))?;
    let stem = src
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "media".into());
    let name = format!("{}_{}", crate::storage::now_millis(), stem);
    match kind.as_str() {
        "gif" => {
            if ffmpeg_path().is_some() {
                // Preserve animation: run the GIF through the shared FFmpeg pipeline
                // (GIF -> H.264 MP4) so it loops as a real video, capped like any import.
                let dst = out_dir.join(format!("{}.mp4", name));
                let (w, h) = transcode_video_p(src, &dst, progress, preset)?;
                Ok(MediaImport {
                    source: src.to_string_lossy().into(),
                    normalized: dst.to_string_lossy().into(),
                    // the artifact is an MP4 — the video wallpaper path treats it as video
                    kind: "video".into(),
                    width: w,
                    height: h,
                    normalized_by: "ffmpeg".into(),
                    note: "Animated GIF converted to a looping MP4 (animation preserved, capped resolution & bitrate).".into(),
                })
            } else {
                // No ffmpeg: keep the GIF file. Note: without ffmpeg an animated GIF
                // may flatten to its first frame, which is called out explicitly.
                let dst = out_dir.join(format!("{}.gif", name));
                let (w, h) = normalize_gif(src, &dst, preset)?;
                Ok(MediaImport {
                    source: src.to_string_lossy().into(),
                    normalized: dst.to_string_lossy().into(),
                    kind: "gif".into(),
                    width: w,
                    height: h,
                    normalized_by: "image".into(),
                    note: "ffmpeg not bundled — GIF kept as-is; animated GIFs may flatten to a static frame. Install the ffmpeg sidecar for animated GIFs.".into(),
                })
            }
        }
        _ => {
            // video: normalize if ffmpeg exists, else validate + passthrough copy
            let dst = out_dir.join(format!("{}.mp4", name));
            if ffmpeg_path().is_some() {
                let (w, h) = transcode_video_p(src, &dst, progress, preset)?;
                Ok(MediaImport {
                    source: src.to_string_lossy().into(),
                    normalized: dst.to_string_lossy().into(),
                    kind: "video".into(),
                    width: w,
                    height: h,
                    normalized_by: "ffmpeg".into(),
                    note: format!(
                        "Video normalized ({} — {}p cap, {} Mbps max, 30 fps, loop-friendly).",
                        preset.label(),
                        preset.max_dim(),
                        preset.bitrate().trim_end_matches('k').parse::<u32>().unwrap_or(0) / 1000
                    ),
                })
            } else {
                let copy = out_dir.join(format!("{}.mp4", name));
                std::fs::copy(src, &copy).map_err(|e| AppError::Command(e.to_string()))?;
                let (w, h) = probe_dimensions(src).unwrap_or_else(|_| screen_fallback_dims());
                Ok(MediaImport {
                    source: src.to_string_lossy().into(),
                    normalized: copy.to_string_lossy().into(),
                    kind: "video".into(),
                    width: w,
                    height: h,
                    normalized_by: "passthrough".into(),
                    note: "ffmpeg not bundled — playing at source size. Install the sidecar for normalization."
                        .into(),
                })
            }
        }
    }
}

// ---- audio -> WAV (pure Rust: symphonia decode + hound encode) --------------

pub fn convert_audio_to_wav(src: &Path, dst: &Path) -> Result<u64, AppError> {
    if src
        .extension()
        .map(|e| e.to_string_lossy().eq_ignore_ascii_case("wav"))
        .unwrap_or(false)
    {
        // already wav — copy as-is
        std::fs::copy(src, dst).map_err(|e| AppError::Command(e.to_string()))?;
        return Ok(std::fs::metadata(dst).map(|m| m.len()).unwrap_or(0));
    }
    let src_file = std::fs::File::open(src).map_err(|e| AppError::Command(e.to_string()))?;
    let hint = symphonia::core::probe::Hint::new();
    let mss = symphonia::core::io::MediaSourceStream::new(
        Box::new(src_file),
        symphonia::core::io::MediaSourceStreamOptions::default(),
    );
    let mut probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &symphonia::core::formats::FormatOptions::default(),
            &symphonia::core::meta::MetadataOptions::default(),
        )
        .map_err(|e| AppError::Command(format!("unsupported audio format: {}", e)))?;
    let track = probed
        .format
        .default_track()
        .ok_or("no audio track found")?;
    let track_id = track.id;
    let sample_rate = track.codec_params.sample_rate.ok_or("no sample rate")?;
    let channels = track
        .codec_params
        .channels
        .map(|c| c.count())
        .unwrap_or(2)
        .max(1);
    let mut decoder = symphonia::default::get_codecs()
        .make(
            &track.codec_params,
            &symphonia::core::codecs::DecoderOptions::default(),
        )
        .map_err(|e| AppError::Command(format!("decode error: {}", e)))?;

    // wav writer config
    let mut writer = hound::WavWriter::create(
        dst,
        hound::WavSpec {
            channels: channels as u16,
            sample_rate,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        },
    )
    .map_err(|e| AppError::Command(e.to_string()))?;

    let mut total: u64 = 0;
    loop {
        let packet = match probed.format.next_packet() {
            Ok(p) => p,
            Err(symphonia::core::errors::Error::IoError(_))
            | Err(symphonia::core::errors::Error::ResetRequired) => break,
            Err(e) => return Err(AppError::Command(format!("read error: {}", e))),
        };
        if packet.track_id() != track_id {
            continue;
        }
        match decoder.decode(&packet) {
            Ok(decoded) => {
                if let symphonia::core::audio::AudioBufferRef::F32(buf) = &decoded {
                    let num_frames = buf.frames();
                    let num_ch = buf.spec().channels.count();
                    for i in 0..num_frames {
                        for ch in 0..num_ch {
                            let sample = buf.chan(ch)[i];
                            let v = (sample.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
                            writer
                                .write_sample(v)
                                .map_err(|e| AppError::Command(e.to_string()))?;
                            total += 1;
                        }
                    }
                } else {
                    return Err(AppError::Command(
                        "unexpected audio sample format from decoder".into(),
                    ));
                }
            }
            Err(symphonia::core::errors::Error::DecodeError(_)) => continue,
            Err(e) => return Err(AppError::Command(format!("decode error: {}", e))),
        }
    }
    writer
        .finalize()
        .map_err(|e| AppError::Command(e.to_string()))?;
    if total == 0 {
        return Err(AppError::Command(
            "no audio samples decoded — is this really an audio file?".into(),
        ));
    }
    Ok(total)
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- ISO-BMFF box builder (for the native probe tests) ----
    fn box_(typ: &[u8; 4], body: &[u8]) -> Vec<u8> {
        let mut v = Vec::new();
        v.extend_from_slice(&((8 + body.len()) as u32).to_be_bytes());
        v.extend_from_slice(typ);
        v.extend_from_slice(body);
        v
    }

    /// A version-0 tkhd body. Width/height land at offset 84 from box start.
    fn tkhd_v0(width: u32, height: u32) -> Vec<u8> {
        let mut b = Vec::new();
        b.push(0u8); // version 0
        b.extend_from_slice(&[0, 0, 7]); // flags
        // creation(4) mod(4) track_id(4) reserved(4) duration(4)
        for _ in 0..5 {
            b.extend_from_slice(&0u32.to_be_bytes());
        }
        // reserved(8)
        b.extend_from_slice(&0u64.to_be_bytes());
        // layer(2) alternate_group(2) volume(2) reserved(2)
        b.extend_from_slice(&0u16.to_be_bytes());
        b.extend_from_slice(&0u16.to_be_bytes());
        b.extend_from_slice(&0x0100u16.to_be_bytes());
        b.extend_from_slice(&0u16.to_be_bytes());
        // matrix (36 bytes)
        for _ in 0..9 {
            b.extend_from_slice(&0u32.to_be_bytes());
        }
        // width/height as 16.16 fixed point
        b.extend_from_slice(&(width << 16).to_be_bytes());
        b.extend_from_slice(&(height << 16).to_be_bytes());
        b
    }

    #[test]
    fn parses_modern_ffmpeg_line_with_hex_tags() {
        // The exact shape the bundled ffmpeg prints: hex tags before the real
        // dimensions used to break the old first-'x' parser.
        let line = "  Stream #0:0[0x1](und): Video: h264 (Main) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 720x1280 [SAR 1:1 DAR 9:16], 2355 kb/s, 23.98 fps";
        assert_eq!(parse_video_dimensions(line), Some((720, 1280)));
    }

    #[test]
    fn parses_plain_ffmpeg_line() {
        let line = "    Stream #0:0: Video: h264 (High), yuv420p, 1920x1080 [SAR 1:1 DAR 16:9], 30 fps";
        assert_eq!(parse_video_dimensions(line), Some((1920, 1080)));
    }

    #[test]
    fn rejects_lines_without_dimensions() {
        assert_eq!(
            parse_video_dimensions("    Stream #0:1: Audio: aac, 44100 Hz, stereo"),
            None
        );
        assert_eq!(parse_video_dimensions(""), None);
        assert_eq!(parse_video_dimensions("Video: h264"), None);
    }

    #[test]
    fn ignores_codec_tag_that_is_not_a_dimension() {
        // 0x31637661 looks like `0x31637661` to a naive parser — the scanner
        // must skip it and find the real 640x360.
        assert_eq!(
            parse_video_dimensions("Video: h264 (avc1 / 0x31637661), 640x360"),
            Some((640, 360))
        );
    }

    #[test]
    fn gif_header_probe() {
        let t = std::env::temp_dir().join(format!("reforge-gif-probe-{}.gif", std::process::id()));
        let mut data = b"GIF89a".to_vec();
        data.extend_from_slice(&800u16.to_le_bytes());
        data.extend_from_slice(&600u16.to_le_bytes());
        std::fs::write(&t, &data).unwrap();
        let dims = probe_dimensions_native(&t);
        let _ = std::fs::remove_file(&t);
        assert_eq!(dims, Some((800, 600)));
    }

    #[test]
    fn mp4_tkhd_probe() {
        let t = std::env::temp_dir().join(format!("reforge-mp4-probe-{}.mp4", std::process::id()));
        let tkhd = box_(b"tkhd", &tkhd_v0(1280, 720));
        let trak = box_(b"trak", &tkhd);
        let moov = box_(b"moov", &trak);
        let ftyp = box_(b"ftyp", b"isom");
        let mut file = ftyp;
        file.extend_from_slice(&moov);
        std::fs::write(&t, &file).unwrap();
        let dims = probe_dimensions_native(&t);
        let _ = std::fs::remove_file(&t);
        assert_eq!(dims, Some((1280, 720)));
    }

    #[test]
    fn mp4_tkhd_v1_probe() {
        let t = std::env::temp_dir().join(format!("reforge-mp4-probe-v1-{}.mp4", std::process::id()));
        let mut b = Vec::new();
        b.push(1u8); // version 1
        b.extend_from_slice(&[0, 0, 7]);
        // creation(8) mod(8) id(4) reserved(4) duration(8)
        b.extend_from_slice(&0u64.to_be_bytes());
        b.extend_from_slice(&0u64.to_be_bytes());
        b.extend_from_slice(&0u32.to_be_bytes());
        b.extend_from_slice(&0u32.to_be_bytes());
        b.extend_from_slice(&0u64.to_be_bytes());
        // reserved(8) + layer/alt/volume/reserved
        b.extend_from_slice(&0u64.to_be_bytes());
        for _ in 0..4 {
            b.extend_from_slice(&0u16.to_be_bytes());
        }
        // matrix (36)
        for _ in 0..9 {
            b.extend_from_slice(&0u32.to_be_bytes());
        }
        b.extend_from_slice(&(3840u32 << 16).to_be_bytes());
        b.extend_from_slice(&(2160u32 << 16).to_be_bytes());
        let tkhd = box_(b"tkhd", &b);
        let trak = box_(b"trak", &tkhd);
        let moov = box_(b"moov", &trak);
        std::fs::write(&t, &moov).unwrap();
        let dims = probe_dimensions_native(&t);
        let _ = std::fs::remove_file(&t);
        assert_eq!(dims, Some((3840, 2160)));
    }

    // ---- C3.1: transcode presets ----

    #[test]
    fn presets_cap_resolution_monotonically() {
        // The whole point of the preset: each step down produces a smaller cap.
        assert!(TranscodePreset::High.max_dim() > TranscodePreset::Balanced.max_dim());
        assert!(TranscodePreset::Balanced.max_dim() > TranscodePreset::Performance.max_dim());
    }

    #[test]
    fn presets_trade_quality_for_size() {
        // Higher quality = higher bitrate + lower crf (less compression).
        assert!(TranscodePreset::High.bitrate() != TranscodePreset::Performance.bitrate());
        assert!(TranscodePreset::High.crf() < TranscodePreset::Performance.crf());
    }

    #[test]
    fn config_defaults_to_balanced() {
        let cfg = TranscodeConfig::default();
        assert_eq!(cfg.preset, TranscodePreset::Balanced);
        // Balanced must stay the honest middle: it caps 4K sources to 1280p.
        assert_eq!(cfg.preset.max_dim(), 1280);
    }

    #[test]
    fn description_is_human_readable() {
        assert!(TranscodePreset::High.description().contains("1920p"));
        assert!(TranscodePreset::Performance.description().contains("960p"));
        assert!(TranscodePreset::Balanced.description().contains("Mbps"));
    }

    #[test]
    fn config_roundtrips_through_json() {
        let cfg = TranscodeConfig {
            preset: TranscodePreset::Performance,
        };
        let s = serde_json::to_string(&cfg).unwrap();
        let back: TranscodeConfig = serde_json::from_str(&s).unwrap();
        assert_eq!(back.preset, TranscodePreset::Performance);
    }
}

