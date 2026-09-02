//! Update discovery logic: version comparison, per-platform capability, and
//! parsing the GitHub "latest release" payload. Pure + unit-tested; the network
//! fetch and Tauri commands live in `commands/update.rs`.

use std::cmp::Ordering;
use std::path::Path;
use std::time::Duration;

use semver::Version;
use serde::{Deserialize, Serialize};

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

/// Which releases this install is willing to be offered (#237).
///
/// `Stable` is the default and is not merely "filter out prereleases" — it is a
/// DIFFERENT endpoint. `GET /releases/latest` is GitHub's own answer to "what is
/// the current release", which excludes prereleases and drafts server-side and
/// respects `make_latest`; reproducing that by filtering the list would mean
/// re-deriving a rule GitHub already applies.
///
/// `Prerelease` means "offer me prereleases *as well*", never "only
/// prereleases": it takes the semver-highest of every published release, so a
/// user on the prerelease channel still gets a stable release when that is the
/// newest thing there is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum UpdateChannel {
    #[default]
    Stable,
    Prerelease,
}

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
    /// Whether the release being offered is marked prerelease on GitHub.
    ///
    /// Reported rather than inferred from the version string: GitHub's flag is
    /// what decides which channel a release belongs to, and the two can
    /// disagree in both directions — a `-rc.1` tag published as a full release,
    /// or a plain `v0.3.0` tag flagged prerelease. The flag is what the panel
    /// labels, so the label cannot contradict the channel that found it.
    pub prerelease: bool,
}

/// Whether this install can swap its own binary, should defer to a package
/// manager, or must not talk about updates at all. Serializes to
/// `"self-update"` / `"notify"` / `"notify-apt"` / `"notify-scoop"` /
/// `"store-managed"`.
///
/// `NotifyApt` exists because after #187 there are TWO kinds of `.deb` install
/// and they need different advice. On an apt-managed one, `apt upgrade` is the
/// answer. On a sideloaded `.deb` the same command reports "already the newest
/// version" while the panel says a new version exists — a dead end, which is
/// the exact failure `packageHint` was written to remove.
///
/// `NotifyScoop` is the same lesson on Windows, where getting it wrong is worse
/// than a dead end. Windows was `SelfUpdate` unconditionally, and self-updating
/// a Scoop install runs the per-machine `.msi`: the machine ends up with the new
/// copy in `C:\Program Files` AND Scoop's old one still on PATH and still behind
/// the Start Menu shortcut, with `scoop list` reporting the old version forever.
/// Silently two installs, from one click.
///
/// `StoreManaged` is a Microsoft Store (MSIX) install, and it is the one variant
/// that is not about advice at all: it means this install has NO update surface.
/// No check, no chip, no panel, no release link.
///
/// Two independent reasons, and either alone would be enough:
///
/// 1. **Store policy 10.2.5** — "the product and in-app products are updated
///    only through the Store". The v0.4.0 submission failed certification on
///    exactly this: the startup check found a newer GitHub release and the panel
///    auto-opened with a "View release" button onto an `.msi` download. The
///    report's own words were *"The product updates outside the Store … Location
///    where update is found: In App, soon after launch"*. Notifying is enough to
///    fail it — the app does not have to install anything.
/// 2. **Technically it could not work anyway.** An MSIX is read-only after
///    deployment and Windows refuses to launch a package whose files were
///    tampered with, so a self-update here does not fail — it leaves an app that
///    will not start.
///
/// So this variant is checked at the top of `check_for_update` (via
/// `may_check_for_updates`) and again in the frontend store, and it is the only
/// variant with no command to copy: there is nothing for the user to run,
/// because the Store upgrades the package by itself.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum UpdateCapability {
    SelfUpdate,
    Notify,
    NotifyApt,
    NotifyScoop,
    StoreManaged,
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

/// The metadata file Scoop writes into an installed app's version directory.
///
/// The Windows counterpart of `APT_SOURCES_PATH`, and a CONTRACT in the same
/// sense — except this one is with Scoop's installer rather than with a script
/// of ours, so we cannot fix it if it moves. It is held up by `release.yml`'s
/// `scoop-verify-live`, which asserts this file exists beside the exe after a
/// real `scoop install`: if a future Scoop stops writing it, the
/// release gate fails instead of quietly handing every Scoop user the `.msi`
/// self-updater and the two-installs outcome described on `NotifyScoop`.
pub const SCOOP_MANIFEST_FILE: &str = "manifest.json";

/// Does this executable live inside a Scoop install?
///
/// Scoop's layout is `<root>/apps/<name>/<version>/…`, with the live version
/// junctioned at `<root>/apps/<name>/current`. Both shapes put the exe exactly
/// three directories below the root, so the whole test is: the third ancestor is
/// named `apps`, and the directory under it is named after this package.
///
/// The app-directory name is `CARGO_PKG_NAME` rather than a literal, which makes
/// it a contract with the bucket: the manifest is `platypusgit.json`, so Scoop
/// names the directory `platypusgit`. Read from Cargo for the same reason
/// `cli.rs::MAIN_BINARY` is — a rename must not silently stop matching.
///
/// **Deliberately not `$env:SCOOP`.** That variable is relocatable, is a
/// different variable for a global install (`SCOOP_GLOBAL`), and above all is
/// set for anyone who uses Scoop *at all* — so an `.msi` install on a Scoop
/// user's machine would be told to `scoop update` a package Scoop does not have.
/// The question is "was THIS install made by Scoop", and the exe's own path is
/// the only thing that answers it.
///
/// Pure and path-only, so it is testable from macOS and Linux. The filesystem
/// half (the `SCOOP_MANIFEST_FILE` probe) lives in `commands::update`.
pub fn is_scoop_layout(exe: &Path) -> bool {
    let named = |dir: Option<&Path>, want: &str| {
        dir.and_then(Path::file_name)
            .and_then(|name| name.to_str())
            // Windows paths are case-insensitive; so is this.
            .is_some_and(|name| name.eq_ignore_ascii_case(want))
    };
    let version_dir = exe.parent();
    let app_dir = version_dir.and_then(Path::parent);
    let apps_dir = app_dir.and_then(Path::parent);
    named(apps_dir, "apps") && named(app_dir, env!("CARGO_PKG_NAME"))
}

/// Subset of a GitHub release we care about.
#[derive(Debug, Clone, PartialEq)]
pub struct ReleaseMeta {
    pub tag: String,
    pub version: String,
    pub notes: String,
    pub url: String,
    pub published_at: String,
    /// GitHub's `prerelease` flag. See `UpdateInfo::prerelease`.
    pub prerelease: bool,
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
            prerelease: false,
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
        prerelease: rel.prerelease,
    })
}

/// How this particular install reached the machine — everything `capability`
/// decides from.
///
/// A struct rather than a fourth positional `bool`. `capability("linux", false,
/// true, false)` is unreadable at the call site and the compiler cannot catch a
/// swapped pair; with `InstallEnv::new` supplying the all-false baseline, every
/// caller and every test names only the thing it is actually asserting:
///
/// ```ignore
/// capability(InstallEnv { scoop_managed: true, ..InstallEnv::new("windows") })
/// ```
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InstallEnv<'a> {
    /// `std::env::consts::OS` in production; a literal in tests.
    pub os: &'a str,
    /// Running from an AppImage — `APPIMAGE` set and non-empty. Linux only.
    pub is_appimage: bool,
    /// The platypusgit apt repository is configured on this machine. Linux only.
    pub apt_managed: bool,
    /// This executable lives inside a Scoop install. Windows only.
    pub scoop_managed: bool,
    /// This process has package identity — an MSIX install. Windows only.
    pub msix_packaged: bool,
}

impl<'a> InstallEnv<'a> {
    /// The baseline: a plain install on `os`, managed by nothing.
    pub fn new(os: &'a str) -> Self {
        Self {
            os,
            is_appimage: false,
            apt_managed: false,
            scoop_managed: false,
            msix_packaged: false,
        }
    }
}

/// Does this process have package identity — i.e. did it come from an MSIX?
///
/// `GetCurrentPackageFamilyName` is the documented discriminator: for a packaged
/// process it reports the family name (here only its length — the name itself is
/// not the question, so the buffer is deliberately null), and for an unpackaged
/// one it returns `APPMODEL_ERROR_NO_PACKAGE`. Anything that is *not* that error
/// means "packaged", including the `ERROR_INSUFFICIENT_BUFFER` a null buffer is
/// supposed to produce.
///
/// **Deliberately not a path test.** "Is the exe under `C:\Program
/// Files\WindowsApps`" is the tempting one-liner and it is wrong: Microsoft
/// documents that packages install to other PackageVolumes and other paths. Same
/// trap as `$env:SCOOP`, rejected for the same reason — the question is "was
/// THIS install packaged", and there is an API that answers exactly that.
///
/// No new dependency for one kernel32 function. The crate edition is 2021, so
/// this is a plain `extern "system"` block, not the 2024 `unsafe extern`.
#[cfg(windows)]
pub fn is_msix_packaged() -> bool {
    const APPMODEL_ERROR_NO_PACKAGE: u32 = 15700;

    #[link(name = "kernel32")]
    extern "system" {
        fn GetCurrentPackageFamilyName(length: *mut u32, name: *mut u16) -> u32;
    }

    let mut length: u32 = 0;
    let rc = unsafe { GetCurrentPackageFamilyName(&mut length, std::ptr::null_mut()) };
    rc != APPMODEL_ERROR_NO_PACKAGE
}

/// Always false: only Windows has package identity, and `capability` must never
/// be handed a `true` it would then have to interpret.
#[cfg(not(windows))]
pub fn is_msix_packaged() -> bool {
    false
}

/// Per-platform self-update vs notify decision. See the plan's Global Constraints.
///
/// `apt_managed` is only ever true on Linux and `scoop_managed` only ever on
/// Windows (the caller does not probe for either off its own platform), and the
/// AppImage arm deliberately wins over apt: an AppImage can replace itself, so
/// it should, even on a machine that also has the apt repository configured for
/// a different install.
///
/// Scoop is the one package manager that wins over `SelfUpdate` rather than
/// losing to it, because the Windows self-update path does not *replace* a Scoop
/// install — it adds a second one alongside. See `UpdateCapability::NotifyScoop`.
///
/// `msix_packaged` is checked BEFORE `scoop_managed`, and the order is load-
/// bearing even though the two are mutually exclusive in practice (Scoop unpacks
/// a zip; it does not register a package). If a future probe ever gets it wrong,
/// this order fails toward the answer with a broken app behind it rather than
/// toward `scoop update` on an install Scoop does not own.
pub fn capability(env: InstallEnv<'_>) -> UpdateCapability {
    match env.os {
        "windows" if env.msix_packaged => UpdateCapability::StoreManaged,
        "windows" if env.scoop_managed => UpdateCapability::NotifyScoop,
        "windows" => UpdateCapability::SelfUpdate,
        "linux" if env.is_appimage => UpdateCapability::SelfUpdate,
        "linux" if env.apt_managed => UpdateCapability::NotifyApt,
        _ => UpdateCapability::Notify,
    }
}

/// Is this install allowed to ask GitHub what the newest release is?
///
/// One pure function, so "may this install check" has a single answer that both
/// `commands::update::check_for_update` and `src/features/update/useUpdateStore`
/// are written against — and one that a test can exercise without a registered
/// MSIX package (`is_msix_packaged` is a constant `false` everywhere a test can
/// run).
///
/// A predicate rather than an inline `matches!` at the call site because the
/// call site is a *refusal*, and Store policy 10.2.5 is the reason for it: the
/// rule needs somewhere to be stated once and pinned by name. See
/// `UpdateCapability::StoreManaged`.
///
/// Every other variant answers `true`. `Notify*` installs still check — they
/// just hand the install off to a package manager afterwards, and telling a
/// `.deb` user that `apt upgrade` has something for them is the whole point of
/// #187.
pub fn may_check_for_updates(capability: UpdateCapability) -> bool {
    !matches!(capability, UpdateCapability::StoreManaged)
}

/// How many releases the prerelease channel considers.
///
/// GitHub returns `/releases` newest-first by creation date, so the newest
/// release by *any* ordering is in the first page. One page is therefore enough
/// to answer "what is the newest thing published", and asking for more would
/// spend bandwidth to re-rank releases that are already known to be older.
const RELEASES_PER_PAGE: u32 = 30;

/// Map one release object from either endpoint.
fn release_from_value(v: &serde_json::Value) -> AppResult<ReleaseMeta> {
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
        // Absent means false: `/releases/latest` never returns a prerelease, so
        // a missing flag there is the truth rather than a gap.
        prerelease: v["prerelease"].as_bool().unwrap_or(false),
    })
}

/// Parse the JSON body of `GET /repos/:slug/releases/latest`.
pub fn parse_release(json: &str) -> AppResult<ReleaseMeta> {
    let v: serde_json::Value = serde_json::from_str(json)
        .map_err(|e| AppError::Network(format!("parse release json: {e}")))?;
    release_from_value(&v)
}

/// Parse the JSON body of `GET /repos/:slug/releases` — the prerelease channel.
///
/// Drafts are dropped here rather than relied on being absent. An
/// unauthenticated request does not see them, which is what we make, but this
/// function is also the one place a future authenticated request would flow
/// through, and offering a draft would point every user at a release page that
/// 404s for them.
///
/// A single malformed entry does not fail the whole check — it is skipped. The
/// alternative is that one release published with an odd payload turns the
/// updater off for everyone on the channel until it is fixed.
pub fn parse_releases(json: &str) -> AppResult<Vec<ReleaseMeta>> {
    let v: serde_json::Value = serde_json::from_str(json)
        .map_err(|e| AppError::Network(format!("parse releases json: {e}")))?;
    let arr = v
        .as_array()
        .ok_or_else(|| AppError::Network("releases json is not an array".into()))?;
    Ok(arr
        .iter()
        .filter(|r| !r["draft"].as_bool().unwrap_or(false))
        .filter_map(|r| release_from_value(r).ok())
        .collect())
}

/// The semver-highest release in the list, or `None` if none has a usable tag.
///
/// By PRECEDENCE, not by list order, and that is the whole point of the
/// prerelease channel. GitHub orders `/releases` by creation date, so a patch
/// cut on an old line after a newer prerelease would otherwise win — and the
/// same ordering is what makes `1.0.0` correctly beat a stale `1.1.0-rc.1`
/// only when precedence, not dates, decides. Unparseable tags are skipped for
/// the reason `is_newer` refuses them: no comparison is better than a wrong one.
pub fn pick_newest(releases: &[ReleaseMeta]) -> Option<&ReleaseMeta> {
    releases
        .iter()
        .filter_map(|r| parse_version(&r.version).map(|v| (v, r)))
        .max_by(|(a, _), (b, _)| a.cmp_precedence(b))
        .map(|(_, r)| r)
}

/// Blocking GET returning the response body. Call inside `spawn_blocking`.
/// Unauthenticated (60 req/hr/IP is ample for our cadence — and dev/e2e builds
/// never get here, see `discover`).
fn get_body(url: &str) -> AppResult<String> {
    // `https_only` matters because the agent follows up to 5 redirects by
    // default — without it a redirect could downgrade us to plaintext http.
    let agent = ureq::AgentBuilder::new()
        .timeout(HTTP_TIMEOUT)
        .https_only(true)
        .build();
    let resp = agent
        .get(url)
        .set("User-Agent", "platypusgit-updater")
        .set("Accept", "application/vnd.github+json")
        .call()
        .map_err(|e| AppError::Network(e.to_string()))?;
    resp.into_string()
        .map_err(|e| AppError::Network(e.to_string()))
}

/// Blocking GET of the latest published release from GitHub (stable channel).
pub fn fetch_latest_release() -> AppResult<ReleaseMeta> {
    let url = format!("https://api.github.com/repos/{REPO_SLUG}/releases/latest");
    parse_release(&get_body(&url)?)
}

/// Blocking GET of the newest release including prereleases.
pub fn fetch_newest_release() -> AppResult<ReleaseMeta> {
    let url = format!(
        "https://api.github.com/repos/{REPO_SLUG}/releases?per_page={RELEASES_PER_PAGE}"
    );
    let releases = parse_releases(&get_body(&url)?)?;
    pick_newest(&releases)
        .cloned()
        .ok_or_else(|| AppError::Network("no published releases".into()))
}

/// The fetch for a channel. The one place the two endpoints are chosen between,
/// so no caller can pair a channel with the wrong URL.
pub fn fetch_for_channel(channel: UpdateChannel) -> AppResult<ReleaseMeta> {
    match channel {
        UpdateChannel::Stable => fetch_latest_release(),
        UpdateChannel::Prerelease => fetch_newest_release(),
    }
}
