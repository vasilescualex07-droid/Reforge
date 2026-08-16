use crate::state::AppState;
use crate::undo;
use serde::Serialize;
use serde_json::json;
use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;
use tauri::State;

// ---------------------------------------------------------------------------
// OpenRGB SDK protocol — TCP 127.0.0.1:6742
//
// Packet: [Magic 0x00][DeviceIndex u32 LE][PacketId u32 LE][DataSize u32 LE][Data]
//   PacketId:  0 = REQUEST_CONTROLLER_COUNT
//              1 = REQUEST_CONTROLLER_DATA
//              2 = REQUEST_CONTROLLER_COLORS
//              3 = REQUEST_UPDATE_LEDS
//              4 = REQUEST_UPDATE_ZONE_LEDS
//              5 = REQUEST_UPDATE_MODE
//              6 = REQUEST_SAVE_PROFILE
//              7 = REQUEST_LOAD_PROFILE
// Response: same header, client frees the data.
//
// Controller data is big-endian inside the data payload (OpenRGB schema).
// This implementation is minimal — enough for static color + restore.
// ---------------------------------------------------------------------------

use crate::error::AppError;
const MAGIC: u8 = 0x00;
const REQUEST_CONTROLLER_COUNT: u32 = 0;
const REQUEST_CONTROLLER_DATA: u32 = 1;
const REQUEST_CONTROLLER_COLORS: u32 = 2;
const REQUEST_UPDATE_LEDS: u32 = 3;
const REQUEST_UPDATE_MODE: u32 = 5;

fn connect() -> Result<TcpStream, AppError> {
    let addr = "127.0.0.1:6742"
        .to_socket_addrs()
        .map_err(|e| AppError::Command(e.to_string()))?
        .next()
        .ok_or("DNS resolution failed for OpenRGB SDK".to_string())?;
    let stream = TcpStream::connect_timeout(&addr, Duration::from_millis(1000)).map_err(|e| {
        AppError::Command(format!(
            "OpenRGB not reachable on 6742: {}. Is OpenRGB running with SDK enabled?",
            e
        ))
    })?;
    stream
        .set_read_timeout(Some(Duration::from_millis(2000)))
        .ok();
    stream
        .set_write_timeout(Some(Duration::from_millis(2000)))
        .ok();
    Ok(stream)
}

fn send_packet(
    stream: &mut TcpStream,
    device_index: u32,
    packet_id: u32,
    data: &[u8],
) -> Result<(), AppError> {
    let header: [u8; 16] = [
        MAGIC,
        (device_index & 0xff) as u8,
        ((device_index >> 8) & 0xff) as u8,
        ((device_index >> 16) & 0xff) as u8,
        ((device_index >> 24) & 0xff) as u8,
        (packet_id & 0xff) as u8,
        ((packet_id >> 8) & 0xff) as u8,
        ((packet_id >> 16) & 0xff) as u8,
        ((packet_id >> 24) & 0xff) as u8,
        (data.len() & 0xff) as u8,
        ((data.len() >> 8) & 0xff) as u8,
        ((data.len() >> 16) & 0xff) as u8,
        ((data.len() >> 24) & 0xff) as u8,
        0,
        0,
        0, // padding
    ];
    stream
        .write_all(&header)
        .map_err(|e| AppError::Command(e.to_string()))?;
    if !data.is_empty() {
        stream
            .write_all(data)
            .map_err(|e| AppError::Command(e.to_string()))?;
    }
    stream
        .flush()
        .map_err(|e| AppError::Command(e.to_string()))?;
    Ok(())
}

fn read_response(stream: &mut TcpStream) -> Result<Vec<u8>, AppError> {
    let mut header = [0u8; 16];
    stream
        .read_exact(&mut header)
        .map_err(|e| AppError::Command(format!("OpenRGB read: {}", e)))?;
    let data_len = u32::from_le_bytes([header[8], header[9], header[10], header[11]]) as usize;
    let mut data = vec![0u8; data_len];
    if data_len > 0 {
        let mut read = 0;
        while read < data_len {
            let n = stream
                .read(&mut data[read..])
                .map_err(|e| AppError::Command(e.to_string()))?;
            if n == 0 {
                return Err(AppError::Command(
                    "OpenRGB connection closed unexpectedly".into(),
                ));
            }
            read += n;
        }
    }
    Ok(data)
}

fn read_cstring(data: &[u8], offset: &mut usize) -> String {
    let start = *offset;
    while *offset < data.len() && data[*offset] != 0 {
        *offset += 1;
    }
    let s = String::from_utf8_lossy(&data[start..*offset]).to_string();
    *offset += 1; // skip null
    s
}

fn read_u32_be(data: &[u8], offset: &mut usize) -> u32 {
    let v = u32::from_be_bytes([
        data[*offset],
        data[*offset + 1],
        data[*offset + 2],
        data[*offset + 3],
    ]);
    *offset += 4;
    v
}

fn read_u16_be(data: &[u8], offset: &mut usize) -> u16 {
    let v = u16::from_be_bytes([data[*offset], data[*offset + 1]]);
    *offset += 2;
    v
}

#[derive(Serialize, Clone)]
pub struct RGBDevice {
    pub index: u32,
    pub name: String,
    pub kind: u32,
    pub num_leds: u32,
    pub num_modes: u16,
    pub active_mode: u16,
    pub colors: Vec<[u8; 3]>,
}

#[derive(Serialize, Clone)]
pub struct RGBState {
    pub available: bool,
    pub devices: Vec<RGBDevice>,
    pub note: String,
}

#[tauri::command]
pub fn rgb_detect() -> RGBState {
    let mut stream = match connect() {
        Ok(s) => s,
        Err(e) => {
            return RGBState {
                available: false,
                devices: Vec::new(),
                note: e.to_string(),
            };
        }
    };
    // get count
    if send_packet(&mut stream, 0, REQUEST_CONTROLLER_COUNT, &[]).is_err() {
        return RGBState {
            available: false,
            devices: Vec::new(),
            note: "OpenRGB SDK handshake failed.".into(),
        };
    }
    let count_data = match read_response(&mut stream) {
        Ok(d) => d,
        Err(e) => {
            return RGBState {
                available: false,
                devices: Vec::new(),
                note: e.to_string(),
            };
        }
    };
    if count_data.len() < 4 {
        return RGBState {
            available: false,
            devices: Vec::new(),
            note: "Unexpected response from OpenRGB SDK.".into(),
        };
    }
    let count = u32::from_le_bytes([count_data[0], count_data[1], count_data[2], count_data[3]]);
    let mut devices = Vec::new();
    for i in 0..count {
        if send_packet(&mut stream, i, REQUEST_CONTROLLER_DATA, &[]).is_err() {
            continue;
        }
        let data = match read_response(&mut stream) {
            Ok(d) => d,
            Err(_) => continue,
        };
        let mut off = 0;
        let name = read_cstring(&data, &mut off);
        let kind = read_u32_be(&data, &mut off);
        let _loc = read_cstring(&data, &mut off);
        let _serial = read_cstring(&data, &mut off);
        let _ver = read_cstring(&data, &mut off);
        let _vendor = read_cstring(&data, &mut off);
        let active_mode = read_u16_be(&data, &mut off);
        let num_modes = read_u16_be(&data, &mut off);
        // skip modes
        for _ in 0..num_modes {
            let _mode_name = read_cstring(&data, &mut off);
            let _mode_val = read_u32_be(&data, &mut off);
            let _mode_flags = read_u32_be(&data, &mut off);
            let _speed_min = read_u16_be(&data, &mut off);
            let _speed_max = read_u16_be(&data, &mut off);
            let _speed = read_u16_be(&data, &mut off);
            let _color_mode = read_u32_be(&data, &mut off);
            let num_colors = read_u16_be(&data, &mut off);
            for _ in 0..num_colors {
                let _r = data.get(off).copied().unwrap_or(0);
                let _g = data.get(off + 1).copied().unwrap_or(0);
                let _b = data.get(off + 2).copied().unwrap_or(0);
                off += 3; // check _custom_colors after
                          // Actually colors are r,g,b per led. After mode colors there may be custom colors.
                          // Let's just advance.
            }
            // custom colors (num_custom_colors u16 + 3 bytes each)
            if off + 2 <= data.len() {
                let num_custom = read_u16_be(&data, &mut off);
                for _ in 0..num_custom {
                    off = off.saturating_add(3);
                }
            }
        }
        // zones
        let num_zones = read_u16_be(&data, &mut off);
        for _ in 0..num_zones {
            let _zone_name = read_cstring(&data, &mut off);
            let _zone_type = read_u32_be(&data, &mut off);
            let _leds_min = read_u16_be(&data, &mut off);
            let _leds_max = read_u16_be(&data, &mut off);
            let _leds_count = read_u16_be(&data, &mut off);
            let _matrix_h = read_u16_be(&data, &mut off);
            let _matrix_w = read_u16_be(&data, &mut off);
            let _zone_flags = read_u32_be(&data, &mut off);
        }
        let num_leds = read_u16_be(&data, &mut off);
        for _ in 0..num_leds {
            let _led_name = read_cstring(&data, &mut off);
            let _led_idx = read_u32_be(&data, &mut off);
        }
        let num_colors = read_u16_be(&data, &mut off);
        let mut colors = Vec::new();
        for _ in 0..num_colors {
            let r = data.get(off).copied().unwrap_or(0);
            let g = data.get(off + 1).copied().unwrap_or(0);
            let b = data.get(off + 2).copied().unwrap_or(0);
            colors.push([r, g, b]);
            off += 4; // 4 bytes per color (r,g,b,pad)
        }
        devices.push(RGBDevice {
            index: i,
            name,
            kind,
            num_leds: num_leds as u32,
            num_modes,
            active_mode,
            colors,
        });
    }
    let note = if devices.is_empty() {
        "No RGB devices found via OpenRGB SDK.".into()
    } else {
        format!("{} device(s) detected.", devices.len())
    };
    RGBState {
        available: true,
        devices,
        note,
    }
}

#[tauri::command]
pub fn rgb_set_static(
    state: State<'_, AppState>,
    device_index: u32,
    hex: String,
) -> Result<String, AppError> {
    // parse hex color
    let hex = hex.trim_start_matches('#');
    let r = u8::from_str_radix(&hex[0..2], 16).map_err(|_| "Invalid hex color".to_string())?;
    let g = u8::from_str_radix(&hex[2..4], 16).map_err(|_| "Invalid hex color".to_string())?;
    let b = u8::from_str_radix(&hex[4..6], 16).map_err(|_| "Invalid hex color".to_string())?;

    // read current colors first (for undo)
    let mut stream = connect()?;
    send_packet(&mut stream, device_index, REQUEST_CONTROLLER_COLORS, &[])?;
    let before_data = read_response(&mut stream)?;
    let num_colors = before_data.len() / 4;
    let mut before_colors = Vec::new();
    for i in 0..num_colors {
        if i * 4 + 3 < before_data.len() {
            before_colors.push([
                before_data[i * 4],
                before_data[i * 4 + 1],
                before_data[i * 4 + 2],
            ]);
        }
    }

    // build update payload: 4 bytes per LED (r,g,b,pad)
    let mut payload = Vec::with_capacity(num_colors * 4);
    for _ in 0..num_colors {
        payload.push(r);
        payload.push(g);
        payload.push(b);
        payload.push(0);
    }
    send_packet(&mut stream, device_index, REQUEST_UPDATE_LEDS, &payload)?;
    let _ = read_response(&mut stream);

    undo::log_entry(
        &state,
        "rgb_color",
        format!("RGB device {} → #{}", device_index, hex),
        json!({
            "device_index": device_index,
            "before_colors": before_colors,
            "after": hex,
        }),
        true,
    )?;
    Ok(format!("Set device {} to #{}", device_index, hex))
}

#[tauri::command]
pub fn rgb_restore_current_mode(
    state: State<'_, AppState>,
    device_index: u32,
) -> Result<String, AppError> {
    // re-apply the current mode by reading it and sending UPDATE_MODE
    let mut stream = connect()?;
    send_packet(&mut stream, device_index, REQUEST_CONTROLLER_DATA, &[])?;
    let data = read_response(&mut stream)?;
    // parse mode data again to find the active mode's struct
    let mut off = 0;
    let _name = read_cstring(&data, &mut off);
    let _kind = read_u32_be(&data, &mut off);
    let _loc = read_cstring(&data, &mut off);
    let _serial = read_cstring(&data, &mut off);
    let _ver = read_cstring(&data, &mut off);
    let _vendor = read_cstring(&data, &mut off);
    let active_mode = read_u16_be(&data, &mut off);
    let num_modes = read_u16_be(&data, &mut off);
    // find the active mode's data in the modes array
    let mut mode_data = Vec::new();
    for mi in 0..num_modes {
        let mode_start = off;
        let _mode_name = read_cstring(&data, &mut off);
        let _mode_val = read_u32_be(&data, &mut off);
        let _mode_flags = read_u32_be(&data, &mut off);
        let _speed_min = read_u16_be(&data, &mut off);
        let _speed_max = read_u16_be(&data, &mut off);
        let _speed = read_u16_be(&data, &mut off);
        let _color_mode = read_u32_be(&data, &mut off);
        let num_colors = read_u16_be(&data, &mut off);
        for _ in 0..num_colors {
            off = off.saturating_add(3);
        }
        if off + 2 <= data.len() {
            let num_custom = read_u16_be(&data, &mut off);
            for _ in 0..num_custom {
                off = off.saturating_add(3);
            }
        }
        if mi == active_mode {
            mode_data = data[mode_start..off].to_vec();
        }
    }
    if mode_data.is_empty() {
        return Err(AppError::Command(
            "Could not find the active mode's data.".into(),
        ));
    }
    send_packet(&mut stream, device_index, REQUEST_UPDATE_MODE, &mode_data)?;
    let _ = read_response(&mut stream)?;

    undo::log_entry(
        &state,
        "rgb_color",
        format!("RGB device {} restored to current mode", device_index),
        json!({ "device_index": device_index, "note": "restored to current mode" }),
        true,
    )?;
    Ok(format!(
        "Device {} restored to its current mode.",
        device_index
    ))
}

// undo support ------------------------------------------------------------------

pub fn restore_colors(device_index: u32, before_colors: &[[u8; 3]]) -> Result<(), AppError> {
    let mut stream = connect()?;
    let mut payload = Vec::with_capacity(before_colors.len() * 4);
    for c in before_colors {
        payload.push(c[0]);
        payload.push(c[1]);
        payload.push(c[2]);
        payload.push(0);
    }
    send_packet(&mut stream, device_index, REQUEST_UPDATE_LEDS, &payload)?;
    let _ = read_response(&mut stream);
    Ok(())
}
