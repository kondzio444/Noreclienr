//! Screenshot gallery of every instance (port of the gallery part of launcher/src/main/social.js):
//! the newest screenshots with 360 px PNG thumbnails (cached), full images as data URLs.

use crate::error::{msg, Result};
use crate::js::ValueExt;
use crate::util;
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};

static THUMBS: LazyLock<Mutex<HashMap<String, Option<String>>>> = LazyLock::new(Mutex::default);

fn png_data_url(img: &image::DynamicImage) -> Option<String> {
    let mut out = std::io::Cursor::new(Vec::new());
    img.write_to(&mut out, image::ImageFormat::Png).ok()?;
    Some(format!("data:image/png;base64,{}", B64.encode(out.into_inner())))
}

/// A 360 px wide thumbnail (None when the file is not a readable image).
pub fn thumbnail(p: &Path) -> Option<String> {
    let img = image::open(p).ok()?;
    let h = ((img.height() as f64) * 360.0 / (img.width().max(1) as f64)).round().max(1.0) as u32;
    png_data_url(&img.resize_exact(360, h, image::imageops::FilterType::Triangle))
}

/// The newest screenshots of the instances (`[{ name, path, time, size, instanceId, instance, thumb }]`).
pub async fn list(instances: Vec<Value>, limit: usize) -> Value {
    tokio::task::spawn_blocking(move || {
        let mut out: Vec<Value> = Vec::new();
        for inst in &instances {
            let dir = PathBuf::from(inst.string_or("gameDir", "")).join("screenshots");
            for f in util::read_dir_names(&dir).into_iter().filter(|f| f.to_lowercase().ends_with(".png")) {
                let p = dir.join(&f);
                let Ok(m) = std::fs::metadata(&p) else { continue };
                out.push(json!({ "name": f, "path": p.to_string_lossy(), "time": util::mtime_ms(&m), "size": m.len(), "instanceId": inst["id"], "instance": inst["name"] }));
            }
        }
        out.sort_by(|a, b| b.num_of("time").partial_cmp(&a.num_of("time")).unwrap_or(std::cmp::Ordering::Equal));
        out.truncate(limit);
        for it in out.iter_mut() {
            let key = format!("{}|{}", it.string_or("path", ""), it.num_of("time"));
            let cached = THUMBS.lock().unwrap_or_else(|e| e.into_inner()).get(&key).cloned();
            let t = match cached {
                Some(t) => t,
                None => {
                    let t = thumbnail(Path::new(&it.string_or("path", "")));
                    THUMBS.lock().unwrap_or_else(|e| e.into_inner()).insert(key, t.clone());
                    t
                }
            };
            it["thumb"] = json!(t);
        }
        json!(out)
    })
    .await
    .unwrap_or(json!([]))
}

pub async fn full_image(p: &Path) -> Value {
    let p = p.to_path_buf();
    tokio::task::spawn_blocking(move || image::open(&p).ok().and_then(|i| png_data_url(&i)).map(Value::String).unwrap_or(Value::Null))
        .await
        .unwrap_or(Value::Null)
}

/// RGBA pixels of an image (for the clipboard).
pub fn rgba(p: &Path) -> Result<(u32, u32, Vec<u8>)> {
    let img = image::open(p).map_err(|_| msg("Nie można odczytać obrazu."))?.to_rgba8();
    Ok((img.width(), img.height(), img.into_raw()))
}

/// Only screenshots of Nore instances may be read, copied, opened or deleted through the gallery.
pub fn screenshot_path(p: &str, instances: &[Value]) -> Result<PathBuf> {
    let full = std::path::absolute(p).unwrap_or_else(|_| PathBuf::from(p));
    let norm: PathBuf = full.components().collect();
    let ok = norm.to_string_lossy().to_lowercase().ends_with(".png")
        && !norm.components().any(|c| matches!(c, std::path::Component::ParentDir))
        && instances.iter().any(|i| norm.starts_with(PathBuf::from(i.string_or("gameDir", "")).join("screenshots")));
    if !ok {
        return Err(msg("Niedozwolona ścieżka."));
    }
    Ok(norm)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn screenshots_and_paths() {
        let d = tempfile::tempdir().unwrap();
        let shots = d.path().join("inst/screenshots");
        std::fs::create_dir_all(&shots).unwrap();
        image::RgbaImage::from_pixel(720, 360, image::Rgba([255, 128, 0, 255])).save(shots.join("a.png")).unwrap();
        std::fs::write(shots.join("broken.png"), b"x").unwrap();
        let inst = json!({ "id": "i", "name": "Test", "gameDir": d.path().join("inst").to_string_lossy() });
        let l = list(vec![inst.clone()], 300).await;
        assert_eq!(l.as_array().unwrap().len(), 2);
        let a = l.as_array().unwrap().iter().find(|x| x["name"] == "a.png").unwrap();
        assert!(a["thumb"].as_str().unwrap().starts_with("data:image/png;base64,"));
        assert!(l.as_array().unwrap().iter().find(|x| x["name"] == "broken.png").unwrap()["thumb"].is_null());
        assert!(screenshot_path(&shots.join("a.png").to_string_lossy(), std::slice::from_ref(&inst)).is_ok());
        assert!(screenshot_path(&d.path().join("inst/options.png").to_string_lossy(), std::slice::from_ref(&inst)).is_err());
        assert!(screenshot_path(&format!("{}/../../x.png", shots.display()), std::slice::from_ref(&inst)).is_err());
        assert_eq!(rgba(&shots.join("a.png")).unwrap().0, 720);
    }
}
