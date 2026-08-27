use std::cell::Cell;

use platypusgit_lib::error::AppError;
use platypusgit_lib::update::{
    capability, compute_available, discover, is_msix_packaged, is_newer, is_scoop_layout,
    parse_release, InstallEnv, ReleaseMeta, UpdateCapability,
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
        capability(InstallEnv::new("windows")),
        UpdateCapability::SelfUpdate
    );
    assert_eq!(
        capability(InstallEnv {
            is_appimage: true,
            ..InstallEnv::new("linux")
        }),
        UpdateCapability::SelfUpdate
    );
    assert_eq!(
        capability(InstallEnv::new("linux")),
        UpdateCapability::Notify
    );
    assert_eq!(
        capability(InstallEnv::new("macos")),
        UpdateCapability::Notify
    );
    assert_eq!(
        capability(InstallEnv {
            is_appimage: true,
            ..InstallEnv::new("macos")
        }),
        UpdateCapability::Notify
    );
}

#[test]
fn capability_reports_apt_managed_linux_separately() {
    // The whole point of the third variant: an apt-managed .deb is told to run
    // `apt upgrade`, a sideloaded one is not.
    assert_eq!(
        capability(InstallEnv {
            apt_managed: true,
            ..InstallEnv::new("linux")
        }),
        UpdateCapability::NotifyApt
    );
    assert_eq!(
        capability(InstallEnv::new("linux")),
        UpdateCapability::Notify
    );
}

#[test]
fn capability_prefers_appimage_self_update_over_apt() {
    // An AppImage can replace itself, so it should — even on a box that also has
    // the apt repository configured for some other install.
    assert_eq!(
        capability(InstallEnv {
            is_appimage: true,
            apt_managed: true,
            ..InstallEnv::new("linux")
        }),
        UpdateCapability::SelfUpdate
    );
}

#[test]
fn capability_ignores_apt_off_linux() {
    // The caller never probes for a sources file off Linux; pin that a stray
    // `true` cannot invent an apt install on macOS or Windows.
    assert_eq!(
        capability(InstallEnv {
            apt_managed: true,
            ..InstallEnv::new("macos")
        }),
        UpdateCapability::Notify
    );
    assert_eq!(
        capability(InstallEnv {
            apt_managed: true,
            ..InstallEnv::new("windows")
        }),
        UpdateCapability::SelfUpdate
    );
}

#[test]
fn capability_takes_scoop_off_the_self_update_path() {
    // Windows was SelfUpdate unconditionally, and that is exactly wrong for a
    // Scoop install: the updater runs the per-machine .msi, so the box ends up
    // with the new copy in Program Files AND Scoop's old one still on PATH.
    assert_eq!(
        capability(InstallEnv {
            scoop_managed: true,
            ..InstallEnv::new("windows")
        }),
        UpdateCapability::NotifyScoop
    );
    // ...and the .msi install it is distinguished FROM keeps self-updating.
    assert_eq!(
        capability(InstallEnv::new("windows")),
        UpdateCapability::SelfUpdate
    );
}

#[test]
fn capability_ignores_scoop_off_windows() {
    // Mirror of the apt case: the caller never probes for Scoop off Windows, so
    // pin that a stray `true` cannot invent a Scoop install elsewhere — an
    // AppImage told to run `scoop update` would be actively wrong.
    assert_eq!(
        capability(InstallEnv {
            scoop_managed: true,
            ..InstallEnv::new("macos")
        }),
        UpdateCapability::Notify
    );
    assert_eq!(
        capability(InstallEnv {
            scoop_managed: true,
            is_appimage: true,
            ..InstallEnv::new("linux")
        }),
        UpdateCapability::SelfUpdate
    );
    assert_eq!(
        capability(InstallEnv {
            scoop_managed: true,
            apt_managed: true,
            ..InstallEnv::new("linux")
        }),
        UpdateCapability::NotifyApt
    );
}

// FORWARD SLASHES IN WINDOWS PATHS, ON PURPOSE. `std::path`'s separator set is
// per-target: on a Unix host a backslash is an ordinary character, so
// `C:\scoop\apps\…` is ONE path component and every ancestor walk below would
// vacuously pass. `/` is a separator on both, and Windows accepts it in real
// paths too, so these cases exercise the same code the shipped Windows build
// runs — on the machine the suite actually runs on.
#[test]
fn scoop_layout_recognises_both_shapes_scoop_installs_into() {
    use std::path::Path;

    // A version directory, and the `current` junction the shims point through.
    // Both put the exe three deep under the root, which is the whole test.
    assert!(is_scoop_layout(Path::new(
        "C:/Users/dev/scoop/apps/platypusgit/0.1.0/platypusgit.exe"
    )));
    assert!(is_scoop_layout(Path::new(
        "C:/Users/dev/scoop/apps/platypusgit/current/platypusgit.exe"
    )));
    // A relocated root ($env:SCOOP) and a global one ($env:SCOOP_GLOBAL) differ
    // only ABOVE `apps` — which is why the probe reads neither variable.
    assert!(is_scoop_layout(Path::new(
        "D:/tools/apps/platypusgit/current/platypusgit.exe"
    )));
    assert!(is_scoop_layout(Path::new(
        "C:/ProgramData/scoop/apps/platypusgit/current/platypusgit.exe"
    )));
    // Windows paths are case-insensitive; so is the probe.
    assert!(is_scoop_layout(Path::new(
        "C:/Users/dev/scoop/Apps/PlatypusGit/current/platypusgit.exe"
    )));
}

#[test]
fn scoop_layout_rejects_everything_else() {
    use std::path::Path;

    // The .msi install — the one that MUST keep self-updating.
    assert!(!is_scoop_layout(Path::new(
        "C:/Program Files/platypusgit/platypusgit.exe"
    )));
    // Another app's Scoop directory. Requiring the app-dir name is what stops a
    // Scoop user's unrelated install from reading as ours.
    assert!(!is_scoop_layout(Path::new(
        "C:/Users/dev/scoop/apps/ripgrep/current/rg.exe"
    )));
    // Right name, wrong grandparent: a hand-made tree that only rhymes.
    assert!(!is_scoop_layout(Path::new(
        "C:/src/bin/platypusgit/current/platypusgit.exe"
    )));
    // Too shallow to have the three ancestors, and a bare filename.
    assert!(!is_scoop_layout(Path::new(
        "C:/apps/platypusgit/platypusgit.exe"
    )));
    assert!(!is_scoop_layout(Path::new("platypusgit.exe")));
    // The dev build, which reports version 0.0.0 and never asks anyway.
    assert!(!is_scoop_layout(Path::new(
        "/Users/dev/platypusgit/src-tauri/target/debug/platypusgit"
    )));
}

#[test]
fn scoop_manifest_file_is_the_documented_contract() {
    // Pinned for the same reason APT_SOURCES_PATH is, with one difference that
    // matters: this contract is with SCOOP's installer, not with a script of
    // ours. release.yml's scoop-verify-live asserts the file is really there
    // after a real `scoop install`, so a Scoop change fails the release rather
    // than silently putting every Scoop user back on the .msi self-updater.
    assert_eq!(platypusgit_lib::update::SCOOP_MANIFEST_FILE, "manifest.json");
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

#[test]
fn capability_takes_a_packaged_install_off_the_self_update_path() {
    // An MSIX is read-only after install and Windows REFUSES TO LAUNCH a package
    // whose files were tampered with. So unlike every other notify variant, this
    // one is not about giving better advice — self-updating here breaks the app.
    assert_eq!(
        capability(InstallEnv {
            msix_packaged: true,
            ..InstallEnv::new("windows")
        }),
        UpdateCapability::NotifyStore
    );
    // ...and the .msi install it is distinguished FROM keeps self-updating.
    assert_eq!(
        capability(InstallEnv::new("windows")),
        UpdateCapability::SelfUpdate
    );
}

#[test]
fn capability_prefers_the_store_over_scoop_when_both_look_true() {
    // The two are mutually exclusive in practice (Scoop unpacks a zip; it does
    // not register a package), so this pins the ORDER rather than a real state:
    // if a future probe ever gets it wrong, fail toward the answer with a broken
    // app behind it, not toward `scoop update` on an install Scoop does not own.
    assert_eq!(
        capability(InstallEnv {
            msix_packaged: true,
            scoop_managed: true,
            ..InstallEnv::new("windows")
        }),
        UpdateCapability::NotifyStore
    );
}

#[test]
#[cfg(not(windows))]
fn the_identity_probe_is_false_off_windows() {
    // The real probe cannot be exercised here — that needs a registered package
    // (see the plan's Task 2 Windows verification). What IS worth pinning is that
    // the non-Windows arm exists and is constant: `capability` must never receive
    // a `true` it cannot mean.
    assert!(!is_msix_packaged());
}

#[test]
fn capability_ignores_msix_off_windows() {
    // Mirror of the apt and Scoop cases: the caller never probes off Windows, so
    // pin that a stray `true` cannot invent a Store install elsewhere.
    assert_eq!(
        capability(InstallEnv {
            msix_packaged: true,
            ..InstallEnv::new("macos")
        }),
        UpdateCapability::Notify
    );
    assert_eq!(
        capability(InstallEnv {
            msix_packaged: true,
            is_appimage: true,
            ..InstallEnv::new("linux")
        }),
        UpdateCapability::SelfUpdate
    );
}
