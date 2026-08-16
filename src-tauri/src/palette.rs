use std::collections::HashMap;

use crate::error::AppError;

#[tauri::command]
pub fn extract_palette(path: &str, count: u32) -> Result<Vec<String>, AppError> {
    let img = image::open(path).map_err(|e| AppError::Command(e.to_string()))?;
    let small = img.resize_exact(32, 32, image::imageops::FilterType::Triangle);
    let rgb = small.to_rgb8();
    let mut buckets: HashMap<(u8, u8, u8), u32> = HashMap::new();
    for p in rgb.pixels() {
        let q = ((p[0] / 16) * 16, (p[1] / 16) * 16, (p[2] / 16) * 16);
        *buckets.entry(q).or_insert(0) += 1;
    }
    let mut v: Vec<((u8, u8, u8), u32)> = buckets.into_iter().collect();
    v.sort_by_key(|x| std::cmp::Reverse(x.1));
    v.truncate(count as usize);
    Ok(v.into_iter()
        .map(|((r, g, b), _)| format!("#{:02X}{:02X}{:02X}", r, g, b))
        .collect())
}
