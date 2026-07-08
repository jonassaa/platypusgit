//! Update discovery logic: version comparison, per-platform capability, and
//! parsing the GitHub "latest release" payload. Pure + unit-tested; the network
//! fetch and Tauri commands live in `commands/update.rs`.

use serde::Serialize;

use crate::error::{AppError, AppResult};

pub const REPO_SLUG: &str = "jonassaa/platypusgit";

/// Discovery result handed to the frontend.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub available: bool,
    pub current_version: String,
    pub latest_version: String,
    pub notes: String,
    pub release_url: String,
    pub published_at: String,
}

/// Whether this install can swap its own binary or should defer to a package
/// manager. Serializes to `"self-update"` / `"notify"`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum UpdateCapability {
    SelfUpdate,
    Notify,
}

/// Subset of a GitHub release we care about.
#[derive(Debug, Clone, PartialEq)]
pub struct ReleaseMeta {
    pub tag: String,
    pub version: String,
    pub notes: String,
    pub url: String,
    pub published_at: String,
}

fn parts(v: &str) -> Vec<u64> {
    v.trim()
        .trim_start_matches('v')
        .split('.')
        .map(|p| p.trim().parse::<u64>().unwrap_or(0))
        .collect()
}

/// True when `latest` is strictly greater than `current` (numeric X.Y.Z).
pub fn is_newer(current: &str, latest: &str) -> bool {
    let (c, l) = (parts(current), parts(latest));
    let n = c.len().max(l.len());
    for i in 0..n {
        let cc = c.get(i).copied().unwrap_or(0);
        let ll = l.get(i).copied().unwrap_or(0);
        if ll != cc {
            return ll > cc;
        }
    }
    false
}

/// Whether to prompt: newer AND not a dev build (`0.0.0`).
pub fn compute_available(current: &str, latest: &str) -> bool {
    current != "0.0.0" && is_newer(current, latest)
}

/// Per-platform self-update vs notify decision. See the plan's Global Constraints.
pub fn capability(os: &str, is_appimage: bool) -> UpdateCapability {
    match os {
        "windows" => UpdateCapability::SelfUpdate,
        "linux" if is_appimage => UpdateCapability::SelfUpdate,
        _ => UpdateCapability::Notify,
    }
}

/// Parse the JSON body of `GET /repos/:slug/releases/latest`.
pub fn parse_release(json: &str) -> AppResult<ReleaseMeta> {
    let v: serde_json::Value = serde_json::from_str(json)
        .map_err(|e| AppError::Network(format!("parse release json: {e}")))?;
    let tag = v["tag_name"]
        .as_str()
        .ok_or_else(|| AppError::Network("release json missing tag_name".into()))?
        .to_string();
    let version = tag.strip_prefix('v').unwrap_or(&tag).to_string();
    Ok(ReleaseMeta {
        tag,
        version,
        notes: v["body"].as_str().unwrap_or("").to_string(),
        url: v["html_url"].as_str().unwrap_or("").to_string(),
        published_at: v["published_at"].as_str().unwrap_or("").to_string(),
    })
}

/// Guard for `open_url`: only allow https links out.
pub fn is_safe_url(url: &str) -> bool {
    url.starts_with("https://")
}
