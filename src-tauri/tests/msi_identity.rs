//! **The Windows `.msi` must keep telling the registry who published it and
//! which product line it upgrades.** Two `bundle` fields in `tauri.conf.json`
//! decide that, and both have defaults that are wrong in a way nothing else
//! notices — the `.msi` builds, installs, and runs exactly the same either way.
//! The damage shows up in Add/Remove Programs and, downstream of it, in the
//! Windows Package Manager, which reads that registry entry back and refuses to
//! guess (`docs/dev/distribution.md`, "The MSI's registry identity").
//!
//! Same shape as `no_telemetry.rs` beside it: a test over config text, because
//! the property is about what the tree *declares*, not what a function returns.
//! It lives in the Rust half because `tests.yml`'s `js` filter does not match
//! `src-tauri/` — a vitest guard reading this file would be skipped by exactly
//! the one-line edit it exists to police.
//!
//! Limits, stated honestly: this pins the two values, not their consequences.
//! It cannot see the registry, and it does not build an `.msi`. It catches the
//! realistic accident — a field dropped in a config tidy-up, or a `productName`
//! change made without realising an unpinned `UpgradeCode` followed it.

use std::path::Path;

/// The `UpgradeCode` every shipped `.msi` has carried. It is **not** an
/// arbitrary GUID: it is the value Tauri's own derivation was already producing
/// from `productName`, so pinning it changed nothing for anyone who installed
/// v0.1.x. Confirm with `pnpm tauri inspect wix-upgrade-code`, which prints the
/// derived default and the override on separate lines.
///
/// Changing this orphans every existing Windows install — the next installer
/// lands *alongside* the old one instead of upgrading it, and winget's
/// `AppsAndFeaturesEntries.UpgradeCode` stops matching.
const PINNED_UPGRADE_CODE: &str = "8E03762C-0A45-5879-AB93-77EB9C468C68";

fn conf() -> serde_json::Value {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json");
    let text = std::fs::read_to_string(&path).expect("read tauri.conf.json");
    serde_json::from_str(&text).expect("tauri.conf.json is valid JSON")
}

#[test]
fn the_bundle_names_a_publisher() {
    let conf = conf();
    let publisher = conf["bundle"]["publisher"].as_str();

    assert!(
        publisher.is_some_and(|p| !p.trim().is_empty()),
        "bundle.publisher is gone. Without it the bundler does NOT fall back to \
         the Cargo `authors` — it takes the SECOND SEGMENT of the bundle \
         identifier (`bundle_id.split('.').nth(1)`), and ours is \
         `io.github.jonassaa.platypusgit`, so every `.msi` would ship claiming \
         `github` as its publisher in Add/Remove Programs. See \
         `docs/dev/distribution.md`."
    );
}

#[test]
fn the_publisher_is_not_the_identifier_fallback() {
    let conf = conf();
    let identifier = conf["identifier"]
        .as_str()
        .expect("identifier is a string");
    let publisher = conf["bundle"]["publisher"]
        .as_str()
        .expect("bundle.publisher is a string");

    // Reproduces the bundler's fallback (`msi/mod.rs`) rather than hard-coding
    // `github`, so this keeps meaning the right thing if the identifier moves.
    let fallback = identifier.split('.').nth(1).unwrap_or(identifier);
    assert_ne!(
        publisher, fallback,
        "bundle.publisher has been set to `{fallback}` — the exact string the \
         bundler would have used anyway from the identifier. That is the bug \
         this field exists to fix, not a fix for it."
    );
}

/// Tauri's own Microsoft Store page: *"Your application publisher name cannot
/// match the application product name"*, and it names `bundle.publisher` as the
/// way to resolve the clash. Nothing in the `.msi` path enforces this — a
/// matching pair builds and installs fine — so the cost lands later, at a Store
/// submission, by which point the publisher is already written into every
/// installed machine's registry and into the winget `PackageIdentifier`.
///
/// This was not hypothetical: `publisher` first landed as `platypusgit`, which
/// is exactly `productName`, and the clash was caught by reading
/// `docs/superpowers/specs/2026-08-27-microsoft-store-research.md` rather than
/// by any test. Hence this one.
#[test]
fn the_publisher_does_not_collide_with_the_product_name() {
    let conf = conf();
    let product = conf["productName"].as_str().expect("productName is a string");
    let publisher = conf["bundle"]["publisher"]
        .as_str()
        .expect("bundle.publisher is a string");

    // Case-insensitive: the constraint is about the displayed names being the
    // same name, not the same bytes.
    assert_ne!(
        publisher.to_lowercase(),
        product.to_lowercase(),
        "bundle.publisher and productName are both `{product}`. Tauri documents \
         this pair as invalid for the Microsoft Store — the publisher name may \
         not match the product name — and fixing it after a release rewrites \
         the publisher in every installed machine's Add/Remove Programs entry. \
         See `docs/dev/distribution.md`."
    );
}

#[test]
fn the_wix_upgrade_code_is_pinned() {
    let conf = conf();
    let code = conf["bundle"]["windows"]["wix"]["upgradeCode"].as_str();

    assert_eq!(
        code,
        Some(PINNED_UPGRADE_CODE),
        "bundle.windows.wix.upgradeCode is missing or changed. Unpinned, it is \
         derived from `productName` (`Uuid::new_v5(NAMESPACE_DNS, \
         \"<productName>.exe.app.x64\")`), which quietly makes a rename break \
         in-place MSI upgrades. Pinned, a rename is safe — but editing the pin \
         itself orphans every existing Windows install."
    );
}
