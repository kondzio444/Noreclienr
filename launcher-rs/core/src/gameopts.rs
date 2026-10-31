//! Graphics profiles written into options.txt (port of launcher/src/main/gameopts.js).
//! Applied once when chosen; later changes made in the game are never overwritten.

use crate::error::Result;
use std::path::Path;

/// (key, value) pairs of a profile, in the order gameopts.js lists them.
pub fn profile(name: &str) -> Option<(&'static str, Vec<(&'static str, &'static str)>)> {
    Some(match name {
        "performance" => (
            "Wydajność",
            vec![
                ("renderDistance", "8"),
                ("simulationDistance", "6"),
                ("graphicsMode", "0"),
                ("particles", "2"),
                ("entityShadows", "false"),
                ("biomeBlendRadius", "0"),
                ("entityDistanceScaling", "0.75"),
                ("mipmapLevels", "2"),
                ("maxFps", "260"),
                ("enableVsync", "false"),
            ],
        ),
        "balanced" => (
            "Zrównoważony",
            vec![
                ("renderDistance", "12"),
                ("simulationDistance", "8"),
                ("graphicsMode", "1"),
                ("particles", "1"),
                ("entityShadows", "true"),
                ("biomeBlendRadius", "1"),
                ("entityDistanceScaling", "1"),
                ("mipmapLevels", "4"),
            ],
        ),
        "quality" => (
            "Jakość",
            vec![
                ("renderDistance", "16"),
                ("simulationDistance", "12"),
                ("graphicsMode", "1"),
                ("particles", "0"),
                ("entityShadows", "true"),
                ("biomeBlendRadius", "2"),
                ("entityDistanceScaling", "1"),
                ("mipmapLevels", "4"),
            ],
        ),
        _ => return None,
    })
}

/// Minecraft before 1.18 has no simulation distance; before 1.16 graphics is "fancyGraphics".
pub fn keys_for(mc: &str) -> (bool, bool) {
    let minor = mc.strip_prefix("1.").and_then(|r| r.split(|c: char| !c.is_ascii_digit()).next()).and_then(|n| n.parse::<u32>().ok()).unwrap_or(99);
    (minor >= 18, minor >= 16)
}

/// options.txt text with the profile applied; unknown lines stay, missing keys are appended.
pub fn apply_profile(text: &str, name: &str, mc: &str) -> String {
    let Some((_, opts)) = profile(name) else { return text.to_string() };
    let (simulation, graphics_mode) = keys_for(mc);
    let mut want: Vec<(String, String)> = Vec::new();
    for (k, v) in opts {
        if k == "simulationDistance" && !simulation {
            continue;
        }
        if k == "graphicsMode" && !graphics_mode {
            want.push(("fancyGraphics".into(), (v != "0").to_string()));
            continue;
        }
        want.push((k.into(), v.into()));
    }
    let mut lines: Vec<String> = text.split('\n').map(|l| l.strip_suffix('\r').unwrap_or(l).to_string()).collect();
    if lines.last().is_some_and(String::is_empty) {
        lines.pop();
    }
    let mut seen = std::collections::HashSet::new();
    let mut out: Vec<String> = lines
        .into_iter()
        .map(|line| match line.find(':') {
            Some(i) if i > 0 => {
                let key = &line[..i];
                match want.iter().find(|(k, _)| k == key) {
                    Some((k, v)) => {
                        seen.insert(k.clone());
                        format!("{k}:{v}")
                    }
                    None => line,
                }
            }
            _ => line,
        })
        .collect();
    for (k, v) in &want {
        if !seen.contains(k) {
            out.push(format!("{k}:{v}"));
        }
    }
    out.join("\n") + "\n"
}

/// Applies a profile to an instance's options.txt. Returns true when written.
pub async fn apply_to_instance(game_dir: &Path, mc: &str, name: &str) -> Result<bool> {
    if profile(name).is_none() {
        return Ok(false);
    }
    let file = game_dir.join("options.txt");
    let text = tokio::fs::read_to_string(&file).await.unwrap_or_default();
    tokio::fs::create_dir_all(game_dir).await?;
    tokio::fs::write(&file, apply_profile(&text, name, mc)).await?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profile_keeps_other_options() {
        let out = apply_profile("version:3955\nrenderDistance:32\nlang:pl_pl\n", "performance", "1.21.1");
        assert!(out.starts_with("version:3955\nrenderDistance:8\nlang:pl_pl\n"));
        assert!(out.contains("simulationDistance:6\n"));
        assert!(out.contains("entityDistanceScaling:0.75\n"));
        let old = apply_profile("", "quality", "1.12.2");
        assert!(old.contains("fancyGraphics:true") && !old.contains("simulationDistance") && !old.contains("graphicsMode"));
        assert_eq!(apply_profile("a:b\n", "nope", "1.21"), "a:b\n");
    }
}
