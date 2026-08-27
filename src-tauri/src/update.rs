//! Update discovery logic: version comparison, per-platform capability, and
//! parsing the GitHub "latest release" payload. Pure + unit-tested; the network
//! fetch and Tauri commands live in `commands/update.rs`.

use std::cmp::Ordering;
use std::time::Duration;

use semver::Version;
use serde::Serialize;

use crate::error::{AppError, AppResult};

pub const REPO_SLUG: &str = "jonassaa/platypusgit";

/// Version stamped into dev, `pnpm tauri dev`, and e2e builds. Release CI
/// rewrites it from the tag, so a binary reporting this is never a real install.
pub const DEV_VERSION: &str = "0.0.0";

/// Total budget for the discovery GET. `ureq` 2.x defaults every timeout to
/// `None`, so a host that completes the TLS handshake and then stalls pins the
/// `spawn_blocking` thread forever and Settings' "Check for updates" button
/// becomes a permanently disabled spinner with no cancel.
const HTTP_TIMEOUT: Duration = Duration::from_secs(10);

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
/// manager. Serializes to `"self-update"` / `"notify"` / `"notify-apt"`.
///
/// `NotifyApt` exists because after #187 there are TWO kinds of `.deb` install
/// and they need different advice. On an apt-managed one, `apt upgrade` is the
/// answer. On a sideloaded `.deb` the same command reports "already the newest
/// version" while the panel says a new version exists — a dead end, which is
/// the exact failure `packageHint` was written to remove.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum UpdateCapability {
    SelfUpdate,
    Notify,
    NotifyApt,
}

/// The deb822 sources file `scripts/install-platypusgit.sh` writes.
///
/// A CONTRACT between that script and this module: its presence is the whole
/// signal that this install is apt-managed. Change it in one place only and the
/// update panel starts telling apt users to go download a file by hand. The
/// script names this constant in its own comment, and
/// `scripts/apt-repo-smoke.sh` asserts the path exists after a real install, so
/// a drift fails the release gate rather than shipping quietly.
pub const APT_SOURCES_PATH: &str = "/etc/apt/sources.list.d/platypusgit.sources";

/// Subset of a GitHub release we care about.
#[derive(Debug, Clone, PartialEq)]
pub struct ReleaseMeta {
    pub tag: String,
    pub version: String,
    pub notes: String,
    pub url: String,
    pub published_at: String,
}

/// Parse a release tag or crate version into a semver `Version`.
///
/// Tolerates a single leading `v` (matching `parse_release`, which uses
/// `strip_prefix` — so `vvv1.0.0` is rejected rather than silently accepted the
/// way `trim_start_matches` did) and surrounding whitespace.
pub fn parse_version(v: &str) -> Option<Version> {
    let t = v.trim();
    Version::parse(t.strip_prefix('v').unwrap_or(t)).ok()
}

/// True when `latest` is strictly greater than `current` under real semver
/// precedence.
///
/// Uses the `semver` crate — the same one `tauri-plugin-updater` compares with,
/// so discovery can't disagree with the installer. The previous hand-rolled
/// per-segment `parse::<u64>().unwrap_or(0)` got prereleases backwards
/// (`1.0.0-rc.1` parsed as `[1,0,0,1]`, i.e. *newer* than `1.0.0`), treated
/// build metadata as a fourth component, and silently mapped any number wider
/// than `u64` to `0`.
///
/// Anything unparseable on either side yields `false`: a wrong "no update" is
/// strictly better than prompting someone to downgrade.
///
/// Compares with `cmp_precedence`, NOT `Ord`: the crate's `Ord` is a total order
/// that sorts build metadata lexically, so plain `l > c` would still call
/// `0.2.0+build.5` newer than `0.2.0`. `cmp_precedence` is semver §10
/// precedence, which ignores build metadata.
pub fn is_newer(current: &str, latest: &str) -> bool {
    match (parse_version(current), parse_version(latest)) {
        (Some(c), Some(l)) => l.cmp_precedence(&c) == Ordering::Greater,
        _ => false,
    }
}

/// Whether to prompt: newer AND not a dev build (`0.0.0`).
pub fn compute_available(current: &str, latest: &str) -> bool {
    current != DEV_VERSION && is_newer(current, latest)
}

/// Full discovery, with the fetch injected so the dev short-circuit is testable.
///
/// A dev/e2e build (`0.0.0`) returns immediately and `fetch` is never called.
/// That matters beyond tidiness: `compute_available` already discarded the
/// result, but the GET still went out — so every `pnpm tauri dev` launch and
/// every e2e app boot hit `api.github.com`, and since `openRepo`/`resetApp` each
/// `browser.refresh()`, a full e2e run made on the order of 150 unauthenticated
/// requests against a 60/hr limit.
pub fn discover(
    current: &str,
    fetch: impl FnOnce() -> AppResult<ReleaseMeta>,
) -> AppResult<UpdateInfo> {
    if current == DEV_VERSION {
        return Ok(UpdateInfo {
            available: false,
            current_version: current.to_string(),
            latest_version: current.to_string(),
            notes: String::new(),
            release_url: String::new(),
            published_at: String::new(),
        });
    }
    let rel = fetch()?;
    Ok(UpdateInfo {
        available: compute_available(current, &rel.version),
        current_version: current.to_string(),
        latest_version: rel.version,
        notes: rel.notes,
        release_url: rel.url,
        published_at: rel.published_at,
    })
}

/// Per-platform self-update vs notify decision. See the plan's Global Constraints.
///
/// `apt_managed` is only ever true on Linux (the caller does not look for a
/// sources file anywhere else), and the AppImage arm deliberately wins over it:
/// an AppImage can replace itself, so it should, even on a machine that also has
/// the apt repository configured for a different install.
pub fn capability(os: &str, is_appimage: bool, apt_managed: bool) -> UpdateCapability {
    match os {
        "windows" => UpdateCapability::SelfUpdate,
        "linux" if is_appimage => UpdateCapability::SelfUpdate,
        "linux" if apt_managed => UpdateCapability::NotifyApt,
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

/// Blocking GET of the latest published release from GitHub. Call inside
/// `spawn_blocking`. Unauthenticated (60 req/hr/IP is ample for our cadence —
/// and dev/e2e builds never get here, see `discover`).
pub fn fetch_latest_release() -> AppResult<ReleaseMeta> {
    let url = format!("https://api.github.com/repos/{REPO_SLUG}/releases/latest");
    // `https_only` matters because the agent follows up to 5 redirects by
    // default — without it a redirect could downgrade us to plaintext http.
    let agent = ureq::AgentBuilder::new()
        .timeout(HTTP_TIMEOUT)
        .https_only(true)
        .build();
    let resp = agent
        .get(&url)
        .set("User-Agent", "platypusgit-updater")
        .set("Accept", "application/vnd.github+json")
        .call()
        .map_err(|e| AppError::Network(e.to_string()))?;
    let body = resp
        .into_string()
        .map_err(|e| AppError::Network(e.to_string()))?;
    parse_release(&body)
}
