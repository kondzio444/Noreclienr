//! Small helpers shared by the phase 2 modules: zip archives (adm-zip in the Electron launcher),
//! safe relative paths, hashes, time stamps and blocking file system work off the async runtime.

use crate::error::{msg, Result};
use serde_json::Value;
use sha1::{Digest, Sha1};
use std::io::Read;
use std::path::{Component, Path, PathBuf};

/// SHA-1 of bytes (hex).
pub fn sha1_hex(b: &[u8]) -> String {
    hex::encode(Sha1::digest(b))
}

/// `path.resolve(root, rel)` that never leaves `root` (None for `..`, absolute paths, empty names).
pub fn inside(root: &Path, rel: &str) -> Option<PathBuf> {
    let rel = rel.replace('\\', "/");
    let mut out = root.to_path_buf();
    let mut depth = 0usize;
    for c in Path::new(&rel).components() {
        match c {
            Component::Normal(p) => {
                out.push(p);
                depth += 1;
            }
            Component::CurDir => {}
            Component::ParentDir => {
                if depth == 0 {
                    return None;
                }
                out.pop();
                depth -= 1;
            }
            _ => return None,
        }
    }
    (depth > 0).then_some(out)
}

/// Only the last component of a name, rejecting `..`, hidden or empty names.
pub fn safe_name(file: &str) -> Result<String> {
    let n = Path::new(file).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    if n.is_empty() || n != file || n.starts_with('.') {
        return Err(msg("Nieprawidłowa nazwa pliku"));
    }
    Ok(n)
}

/// `path.basename` (also for Windows separators).
pub fn basename(p: &str) -> String {
    p.rsplit(['/', '\\']).next().unwrap_or(p).to_string()
}

/// "2026-10-31T12:34:56.789Z" – `new Date().toISOString()`.
pub fn iso_now() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

/// `toISOString().replace(/[:T]/g, '-').slice(0, n)`.
pub fn stamp_dash(n: usize) -> String {
    iso_now().replace([':', 'T'], "-").chars().take(n).collect()
}

/// Runs blocking file work (zips, hashing, copies) on the blocking pool.
pub async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tokio::task::spawn_blocking(f).await.map_err(crate::error::wrap)?
}

/// An archive read into memory: entry names and contents on demand.
pub struct Zip {
    archive: zip::ZipArchive<std::io::Cursor<Vec<u8>>>,
}

impl Zip {
    pub fn open(file: &Path) -> Result<Self> {
        Self::from_bytes(std::fs::read(file)?)
    }

    pub fn from_bytes(bytes: Vec<u8>) -> Result<Self> {
        Ok(Self { archive: zip::ZipArchive::new(std::io::Cursor::new(bytes))? })
    }

    /// Names of the files (directories left out).
    pub fn names(&self) -> Vec<String> {
        self.archive.file_names().filter(|n| !n.ends_with('/')).map(String::from).collect()
    }

    pub fn has(&self, name: &str) -> bool {
        self.archive.index_for_name(name).is_some()
    }

    pub fn read(&mut self, name: &str) -> Option<Vec<u8>> {
        let mut f = self.archive.by_name(name).ok()?;
        if f.is_dir() {
            return None;
        }
        let mut out = Vec::with_capacity(f.size() as usize);
        f.read_to_end(&mut out).ok()?;
        Some(out)
    }

    pub fn text(&mut self, name: &str) -> Option<String> {
        self.read(name).map(|b| String::from_utf8_lossy(&b).to_string())
    }

    pub fn json(&mut self, name: &str) -> Option<Value> {
        let t = self.text(name)?;
        serde_json::from_str(t.trim_start_matches('\u{feff}')).ok()
    }
}

/// Writes an archive from `(name, bytes)` pairs.
pub fn write_zip(out: &Path, files: Vec<(String, Vec<u8>)>) -> Result<()> {
    if let Some(d) = out.parent() {
        std::fs::create_dir_all(d)?;
    }
    let mut zip = zip::ZipWriter::new(std::fs::File::create(out)?);
    let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated).large_file(true);
    for (name, data) in files {
        zip.start_file(name, opts)?;
        std::io::Write::write_all(&mut zip, &data)?;
    }
    zip.finish()?;
    Ok(())
}

/// Zips folders of `base` (server backups) keeping their names; `skip(name)` leaves files out.
pub fn zip_folders(base: &Path, folders: &[String], out: &Path, skip: impl Fn(&str) -> bool) -> Result<()> {
    let mut zip = zip::ZipWriter::new(std::fs::File::create(out)?);
    let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated).large_file(true);
    fn walk(zip: &mut zip::ZipWriter<std::fs::File>, dir: &Path, prefix: &str, opts: zip::write::SimpleFileOptions, skip: &dyn Fn(&str) -> bool) -> Result<()> {
        for e in std::fs::read_dir(dir)? {
            let e = e?;
            let name = format!("{prefix}/{}", e.file_name().to_string_lossy());
            if e.file_type()?.is_dir() {
                zip.add_directory(format!("{name}/"), opts)?;
                walk(zip, &e.path(), &name, opts, skip)?;
            } else if !skip(&name) {
                zip.start_file(name, opts)?;
                std::io::copy(&mut std::fs::File::open(e.path())?, zip)?;
            }
        }
        Ok(())
    }
    for f in folders {
        walk(&mut zip, &base.join(f), f, opts, &skip)?;
    }
    zip.finish()?;
    Ok(())
}

/// Moves a file or folder; falls back to copy + delete across devices.
pub fn move_path(from: &Path, to: &Path) -> std::io::Result<()> {
    if let Some(d) = to.parent() {
        std::fs::create_dir_all(d)?;
    }
    if std::fs::rename(from, to).is_ok() {
        return Ok(());
    }
    copy_recursive(from, to, true)?;
    if from.is_dir() {
        std::fs::remove_dir_all(from)
    } else {
        std::fs::remove_file(from)
    }
}

/// `fs.cp(from, to, { recursive: true, force })`.
pub fn copy_recursive(from: &Path, to: &Path, force: bool) -> std::io::Result<()> {
    let meta = std::fs::metadata(from)?;
    if meta.is_dir() {
        std::fs::create_dir_all(to)?;
        for e in std::fs::read_dir(from)? {
            let e = e?;
            copy_recursive(&e.path(), &to.join(e.file_name()), force)?;
        }
        Ok(())
    } else {
        if !force && to.exists() {
            return Ok(());
        }
        if let Some(d) = to.parent() {
            std::fs::create_dir_all(d)?;
        }
        std::fs::copy(from, to).map(|_| ())
    }
}

/// Names in a folder (empty when it cannot be read).
pub fn read_dir_names(dir: &Path) -> Vec<String> {
    std::fs::read_dir(dir).map(|rd| rd.flatten().map(|e| e.file_name().to_string_lossy().to_string()).collect()).unwrap_or_default()
}

/// mtime in ms (0 when unknown).
pub fn mtime_ms(meta: &std::fs::Metadata) -> f64 {
    meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as f64).unwrap_or(0.0)
}

/// Unix time (ms) of an ISO date, 0 when it cannot be read (`Date.parse` → NaN → 0 in comparisons).
pub fn parse_date(s: &str) -> i64 {
    chrono::DateTime::parse_from_rfc3339(s).map(|d| d.timestamp_millis()).unwrap_or(0)
}

/// Compares strings like `localeCompare` for the lists the UI sorts (case-insensitive, Polish letters by base letter).
pub fn locale_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    fn key(s: &str) -> String {
        s.chars()
            .map(|c| match c {
                'ą' | 'Ą' => 'a',
                'ć' | 'Ć' => 'c',
                'ę' | 'Ę' => 'e',
                'ł' | 'Ł' => 'l',
                'ń' | 'Ń' => 'n',
                'ó' | 'Ó' => 'o',
                'ś' | 'Ś' => 's',
                'ź' | 'Ź' | 'ż' | 'Ż' => 'z',
                c => c,
            })
            .flat_map(char::to_lowercase)
            .collect()
    }
    key(a).cmp(&key(b)).then_with(|| a.cmp(b))
}

/// Downloads / home folders where a browser saves files (blocked CurseForge files).
pub fn download_dirs() -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = Vec::new();
    for d in [dirs::download_dir(), dirs::home_dir().map(|h| h.join("Downloads")), dirs::home_dir().map(|h| h.join("Pobrane"))].into_iter().flatten() {
        if !v.contains(&d) {
            v.push(d);
        }
    }
    v
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inside_never_leaves_the_root() {
        let r = Path::new("/srv/x");
        assert_eq!(inside(r, "mods/a.jar"), Some(PathBuf::from("/srv/x/mods/a.jar")));
        assert_eq!(inside(r, "./config/../options.txt"), Some(PathBuf::from("/srv/x/options.txt")));
        assert_eq!(inside(r, "../etc/passwd"), None);
        assert_eq!(inside(r, "/etc/passwd"), None);
        assert_eq!(inside(r, ""), None);
        assert!(safe_name("../a").is_err() && safe_name(".hidden").is_err() && safe_name("a.jar").is_ok());
    }

    #[test]
    fn zip_round_trip() {
        let d = tempfile::tempdir().unwrap();
        let f = d.path().join("a.zip");
        write_zip(&f, vec![("x/y.txt".into(), b"hi".to_vec())]).unwrap();
        let mut z = Zip::open(&f).unwrap();
        assert_eq!(z.names(), vec!["x/y.txt"]);
        assert_eq!(z.text("x/y.txt").unwrap(), "hi");
        assert!(z.read("nope").is_none());
    }

    #[test]
    fn polish_sorting() {
        let mut v = vec!["Żubr", "zebra", "Łoś", "lis", "Ćma", "ćwierć"];
        v.sort_by(|a, b| locale_cmp(a, b));
        assert_eq!(v, vec!["Ćma", "ćwierć", "lis", "Łoś", "zebra", "Żubr"]);
    }
}
