use std::cell::Cell;

use platypusgit_lib::error::AppError;
use platypusgit_lib::update::{
    capability, compute_available, discover, is_newer, parse_release, ReleaseMeta, UpdateCapability,
};

#[test]
fn is_newer_detects_bumps_and_equality() {
    assert!(is_newer("0.0.5", "0.0.6"));
    assert!(is_newer("0.0.6", "0.1.0"));
    assert!(is_newer("0.9.0", "1.0.0"));
    assert!(!is_newer("0.0.6", "0.0.6"));
    assert!(!is_newer("0.1.0", "0.0.9"));
    // leading-v tolerated on either side
    assert!(is_newer("v0.0.5", "v0.0.6"));
    // 0.0.0 (dev build) is below every release
    assert!(is_newer("0.0.0", "0.0.1"));
    assert!(!is_newer("0.0.1", "0.0.0"));
}

#[test]
fn is_newer_orders_prereleases_below_their_release() {
    // The hand-rolled compare split on '.' and parsed each segment, so
    // "1.0.0-rc.1" became [1,0,0,1] — NEWER than 1.0.0. Real semver puts a
    // prerelease strictly below its release.
    assert!(!is_newer("1.0.0", "1.0.0-rc.1"));
    assert!(is_newer("1.0.0-rc.1", "1.0.0"));
    assert!(is_newer("1.0.0-rc.1", "1.0.0-rc.2"));
    assert!(!is_newer("1.0.0-rc.2", "1.0.0-rc.1"));
    assert!(!is_newer("1.0.0-rc.1", "1.0.0-rc.1"));
}

#[test]
fn is_newer_ignores_build_metadata() {
    // "0.2.0+build.5" parsed as a fourth component before. Note the semver
    // crate's own `Ord` would ALSO get this wrong (it totally-orders build
    // metadata lexically) — is_newer must use `cmp_precedence`.
    assert!(!is_newer("0.2.0", "0.2.0+build.5"));
    assert!(!is_newer("0.2.0+build.5", "0.2.0"));
    assert!(is_newer("0.2.0+build.5", "0.2.1"));
}

#[test]
fn is_newer_rejects_unparseable_versions_instead_of_guessing() {
    // Anything semver can't read yields "no update" rather than a wrong prompt.
    assert!(!is_newer("0.1.0", "nightly"));
    assert!(!is_newer("0.1.0", "v"));
    assert!(!is_newer("0.1.0", ""));
    assert!(!is_newer("garbage", "0.2.0"));
    // 4-component tags are not semver.
    assert!(!is_newer("1.0.0", "1.0.0.1"));
    // `trim_start_matches('v')` stripped every leading v; `strip_prefix` (and
    // `parse_release`) only strip one, so this is not 1.0.0.
    assert!(!is_newer("0.1.0", "vvv1.0.0"));
    // A number wider than u64 used to silently become 0.
    assert!(!is_newer("0.1.0", "99999999999999999999999.0.0"));
    // ...but a large in-range number still compares correctly.
    assert!(is_newer("1.0.0", "18446744073709551615.0.0"));
}

#[test]
fn compute_available_suppresses_dev_builds() {
    // 0.0.0 is a dev build — never prompt even though everything is "newer".
    assert!(!compute_available("0.0.0", "0.0.6"));
    assert!(compute_available("0.0.5", "0.0.6"));
    assert!(!compute_available("0.0.6", "0.0.6"));
}

fn meta(version: &str) -> ReleaseMeta {
    ReleaseMeta {
        tag: format!("v{version}"),
        version: version.to_string(),
        notes: "notes".into(),
        url: "https://example.com/r".into(),
        published_at: "2026-07-08T10:00:00Z".into(),
    }
}

#[test]
fn discover_never_fetches_for_a_dev_build() {
    // The point of the early return: dev + e2e builds must not touch the
    // network at all (a full e2e run reloads the app ~150x).
    let called = Cell::new(false);
    let info = discover("0.0.0", || {
        called.set(true);
        Ok(meta("9.9.9"))
    })
    .unwrap();
    assert!(!called.get(), "dev build must not issue the discovery GET");
    assert!(!info.available);
    assert_eq!(info.current_version, "0.0.0");
    assert_eq!(info.release_url, "");
}

#[test]
fn discover_fetches_and_compares_for_a_real_install() {
    let called = Cell::new(false);
    let info = discover("0.0.5", || {
        called.set(true);
        Ok(meta("0.1.0"))
    })
    .unwrap();
    assert!(called.get());
    assert!(info.available);
    assert_eq!(info.latest_version, "0.1.0");
    assert_eq!(info.release_url, "https://example.com/r");

    // Same fetch, already current -> no prompt.
    let info = discover("0.1.0", || Ok(meta("0.1.0"))).unwrap();
    assert!(!info.available);
}

#[test]
fn discover_propagates_fetch_errors() {
    let err = discover("0.0.5", || Err(AppError::Network("offline".into()))).unwrap_err();
    assert!(matches!(err, AppError::Network(_)));
}

#[test]
fn capability_matches_platform_rule() {
    assert_eq!(
        capability("windows", false, false),
        UpdateCapability::SelfUpdate
    );
    assert_eq!(
        capability("linux", true, false),
        UpdateCapability::SelfUpdate
    );
    assert_eq!(capability("linux", false, false), UpdateCapability::Notify);
    assert_eq!(capability("macos", false, false), UpdateCapability::Notify);
    assert_eq!(capability("macos", true, false), UpdateCapability::Notify);
}

#[test]
fn capability_reports_apt_managed_linux_separately() {
    // The whole point of the third variant: an apt-managed .deb is told to run
    // `apt upgrade`, a sideloaded one is not.
    assert_eq!(
        capability("linux", false, true),
        UpdateCapability::NotifyApt
    );
    assert_eq!(capability("linux", false, false), UpdateCapability::Notify);
}

#[test]
fn capability_prefers_appimage_self_update_over_apt() {
    // An AppImage can replace itself, so it should — even on a box that also has
    // the apt repository configured for some other install.
    assert_eq!(
        capability("linux", true, true),
        UpdateCapability::SelfUpdate
    );
}

#[test]
fn capability_ignores_apt_off_linux() {
    // The caller never probes for a sources file off Linux; pin that a stray
    // `true` cannot invent an apt install on macOS or Windows.
    assert_eq!(capability("macos", false, true), UpdateCapability::Notify);
    assert_eq!(
        capability("windows", false, true),
        UpdateCapability::SelfUpdate
    );
}

#[test]
fn apt_sources_path_is_the_documented_contract() {
    // Pinned because scripts/install-platypusgit.sh writes this exact path and
    // nothing else connects the two. If one side moves, this fails instead of
    // the update panel quietly misreporting every apt install as sideloaded.
    assert_eq!(
        platypusgit_lib::update::APT_SOURCES_PATH,
        "/etc/apt/sources.list.d/platypusgit.sources"
    );
}

#[test]
fn parse_release_maps_github_json() {
    let json = r#"{
        "tag_name": "v0.1.0",
        "name": "0.1.0",
        "body": "rebase fixes\nlogo",
        "html_url": "https://github.com/jonassaa/platypusgit/releases/tag/v0.1.0",
        "published_at": "2026-07-08T10:00:00Z",
        "prerelease": false,
        "draft": false
    }"#;
    let rel = parse_release(json).unwrap();
    assert_eq!(rel.tag, "v0.1.0");
    assert_eq!(rel.version, "0.1.0");
    assert_eq!(rel.notes, "rebase fixes\nlogo");
    assert_eq!(
        rel.url,
        "https://github.com/jonassaa/platypusgit/releases/tag/v0.1.0"
    );
    assert_eq!(rel.published_at, "2026-07-08T10:00:00Z");
}

#[test]
fn parse_release_rejects_json_without_tag() {
    assert!(parse_release(r#"{"message":"Not Found"}"#).is_err());
}
