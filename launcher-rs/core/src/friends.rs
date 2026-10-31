//! Friends list shared with Nore Client through `<instance>/config/noreclient/friends.json`
//! (the friends half of launcher/src/main/social.js; the gallery follows in phase 2).

use crate::error::{msg, Result};
use crate::store::Store;
use regex::Regex;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

static NICK: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[A-Za-z0-9_]{2,16}$").unwrap());

fn friends_file(game_dir: &Path) -> PathBuf {
    game_dir.join("config").join("noreclient").join("friends.json")
}

async fn read_instance_friends(game_dir: &Path) -> Vec<String> {
    let Ok(text) = tokio::fs::read_to_string(friends_file(game_dir)).await else { return vec![] };
    let Ok(j) = serde_json::from_str::<Value>(&text) else { return vec![] };
    let list = match &j {
        Value::Array(a) => a.clone(),
        _ => j.get("friends").and_then(Value::as_array).cloned().unwrap_or_default(),
    };
    list.iter()
        .filter_map(|x| x.as_str().map(String::from).or_else(|| x.get("name").and_then(Value::as_str).map(String::from)))
        .filter(|n| NICK.is_match(n))
        .collect()
}

fn strings(d: &Value, k: &str) -> Vec<String> {
    d.get(k).and_then(Value::as_array).map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default()
}

/// The launcher list merged with friends added in the game.
pub async fn list(store: &Store, game_dirs: &[PathBuf]) -> Result<Vec<String>> {
    let (mut list, removed) = store.read(|d| (strings(d, "friends"), strings(d, "friendsRemoved")));
    let before = list.len();
    let removed: Vec<String> = removed.iter().map(|n| n.to_lowercase()).collect();
    let mut seen: Vec<String> = list.iter().map(|n| n.to_lowercase()).collect();
    for dir in game_dirs {
        for n in read_instance_friends(dir).await {
            let k = n.to_lowercase();
            if !seen.contains(&k) && !removed.contains(&k) {
                seen.push(k);
                list.push(n);
            }
        }
    }
    if list.len() != before {
        let l = list.clone();
        store.update(|d| d["friends"] = json!(l))?;
    }
    Ok(list)
}

/// Writes the list into every instance so Nore Client sees it.
pub async fn sync(store: &Store, game_dirs: &[PathBuf]) {
    let list = store.read(|d| strings(d, "friends"));
    let text = serde_json::to_string(&list).unwrap_or_else(|_| "[]".into());
    for dir in game_dirs {
        let f = friends_file(dir);
        if let Some(p) = f.parent() {
            if tokio::fs::create_dir_all(p).await.is_err() {
                continue;
            }
        }
        let _ = tokio::fs::write(&f, &text).await;
    }
}

pub async fn add(store: &Store, game_dirs: &[PathBuf], name: &str) -> Result<Value> {
    let name = name.trim();
    if !NICK.is_match(name) {
        return Err(msg("Nick musi mieć 2–16 znaków: litery, cyfry i _."));
    }
    let current = list(store, game_dirs).await?;
    if current.iter().any(|n| n.eq_ignore_ascii_case(name)) {
        return Err(msg(format!("{name} już jest na liście.")));
    }
    store.update(|d| {
        let mut l = current.clone();
        l.push(name.to_string());
        d["friends"] = json!(l);
        let removed: Vec<String> = strings(d, "friendsRemoved").into_iter().filter(|n| !n.eq_ignore_ascii_case(name)).collect();
        d["friendsRemoved"] = json!(removed);
    })?;
    sync(store, game_dirs).await;
    Ok(store.read(|d| d["friends"].clone()))
}

pub async fn remove(store: &Store, game_dirs: &[PathBuf], name: &str) -> Result<Value> {
    store.update(|d| {
        let l: Vec<String> = strings(d, "friends").into_iter().filter(|n| !n.eq_ignore_ascii_case(name)).collect();
        d["friends"] = json!(l);
        let mut removed = strings(d, "friendsRemoved");
        if !removed.iter().any(|n| n == name) {
            removed.push(name.to_string());
        }
        d["friendsRemoved"] = json!(removed);
    })?;
    sync(store, game_dirs).await;
    Ok(store.read(|d| d["friends"].clone()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn merges_game_friends_and_remembers_removals() {
        let dir = tempfile::tempdir().unwrap();
        let g = dir.path().join("inst");
        std::fs::create_dir_all(g.join("config/noreclient")).unwrap();
        std::fs::write(g.join("config/noreclient/friends.json"), r#"{"friends":[{"name":"Alex"},"Steve","zła nazwa"]}"#).unwrap();
        let store = Store::memory(json!({ "friends": ["steve"] }));
        let dirs = vec![g.clone()];
        assert_eq!(list(&store, &dirs).await.unwrap(), vec!["steve", "Alex"]);
        assert!(add(&store, &dirs, "ALEX").await.is_err());
        assert!(add(&store, &dirs, "x").await.is_err());
        add(&store, &dirs, "Notch").await.unwrap();
        let written: Vec<String> = serde_json::from_str(&std::fs::read_to_string(g.join("config/noreclient/friends.json")).unwrap()).unwrap();
        assert_eq!(written, vec!["steve", "Alex", "Notch"]);
        remove(&store, &dirs, "Alex").await.unwrap();
        // the game file is rewritten without Alex, and Alex stays removed
        assert_eq!(list(&store, &dirs).await.unwrap(), vec!["steve", "Notch"]);
    }
}
