// Screen-capture utility for the fun-widgets module.
//
// Captures the full virtual desktop (all monitors) via GDI BitBlt into a
// 32bpp top-down DIB, converts BGRA → RGBA, PNG-encodes with the `image`
// crate and returns base64 — the overlay windows (rage.html, glitch.html)
// use this as the base texture they actually manipulate. Note: the `windows`
// 0.62 crate returns `Result` from GDI calls, so every handle acquisition is
// fallible and cleaned up on the error path.
use crate::error::AppError;
use std::ptr;

use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, SelectObject, BITMAPINFO,
    BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, GetDC, ReleaseDC, SRCCOPY, HGDIOBJ,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetSystemMetrics, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN,
};

/// Capture the whole virtual desktop (every monitor) as a base64 PNG.
pub fn capture_screen_base64() -> Result<String, AppError> {
    let x = unsafe { GetSystemMetrics(SM_XVIRTUALSCREEN) };
    let y = unsafe { GetSystemMetrics(SM_YVIRTUALSCREEN) };
    let w = unsafe { GetSystemMetrics(SM_CXVIRTUALSCREEN) };
    let h = unsafe { GetSystemMetrics(SM_CYVIRTUALSCREEN) };
    if w <= 0 || h <= 0 {
        return Err(AppError::Command("no screen to capture".into()));
    }

    let screen_dc = unsafe { GetDC(None) }; // None → the whole screen
    if screen_dc.is_invalid() {
        return Err(AppError::Command("failed to get screen DC".into()));
    }
    let mem_dc = unsafe { CreateCompatibleDC(None) };
    if mem_dc.is_invalid() {
        let _ = unsafe { ReleaseDC(None, screen_dc) };
        return Err(AppError::Command("failed to create capture DC".into()));
    }

    // Top-down (negative height) 32bpp DIB so row 0 is the top of the screen.
    let header = BITMAPINFOHEADER {
        biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
        biWidth: w,
        biHeight: -h,
        biPlanes: 1,
        biBitCount: 32,
        biCompression: BI_RGB.0,
        ..Default::default()
    };
    let info = BITMAPINFO {
        bmiHeader: header,
        bmiColors: [Default::default()],
    };
    let mut bits: *mut core::ffi::c_void = ptr::null_mut();
    let bmp = unsafe {
        CreateDIBSection(Some(mem_dc), &info, DIB_RGB_COLORS, &mut bits, None, 0)
    }
    .map_err(|_| AppError::Command("failed to create capture bitmap".into()))?;

    let cleanup = || {
        let _ = unsafe { DeleteObject(HGDIOBJ(bmp.0)) };
        let _ = unsafe { DeleteDC(mem_dc) };
        let _ = unsafe { ReleaseDC(None, screen_dc) };
    };

    if bits.is_null() {
        cleanup();
        return Err(AppError::Command("capture bitmap has no buffer".into()));
    }
    let _ = unsafe { SelectObject(mem_dc, HGDIOBJ(bmp.0)) };
    let ok = unsafe { BitBlt(mem_dc, 0, 0, w, h, Some(screen_dc), x, y, SRCCOPY) }.is_ok();
    if !ok {
        cleanup();
        return Err(AppError::Command("BitBlt capture failed".into()));
    }

    // BGRA row-major, top-down — copy the pixels BEFORE releasing the GDI
    // objects (the DIB section is owned by the bitmap/DC; reading after
    // DeleteObject would be a use-after-free).
    let n = (w as usize) * (h as usize);
    let bgra = unsafe { std::slice::from_raw_parts(bits as *const u8, n * 4) };
    let mut rgba = Vec::with_capacity(n * 4);
    for px in bgra.chunks_exact(4) {
        rgba.extend_from_slice(&[px[2], px[1], px[0], 255]);
    }
    cleanup();

    let img = image::RgbaImage::from_raw(w as u32, h as u32, rgba)
        .ok_or_else(|| AppError::Command("image buffer too small".into()))?;
    let mut png: Vec<u8> = Vec::new();
    image::DynamicImage::ImageRgba8(img)
        .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
        .map_err(|e| AppError::Command(format!("png encode: {e}")))?;
    Ok(base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &png))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_capture_decodes_to_png() {
        // Environment-dependent (needs a real screen) — in CI/headless this
        // would fail, so treat "no screen" as a valid skip.
        match capture_screen_base64() {
            Ok(b64) => {
                let bytes = base64::Engine::decode(
                    &base64::engine::general_purpose::STANDARD,
                    &b64,
                )
                .expect("valid base64");
                // PNG magic
                assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n");
            }
            Err(e) => {
                let msg = e.to_string();
                assert!(
                    msg.contains("no screen") || msg.contains("DC"),
                    "unexpected capture error: {msg}"
                );
            }
        }
    }
}
