//! **The Store manifest must keep agreeing with the rest of the tree.** It is a
//! hand-authored XML file that no build step reads on this developer's machine,
//! which makes it exactly the kind of file that drifts: a `productName` change, a
//! publisher change, or a renamed icon leaves it stale, and the failure surfaces
//! days later as a rejected submission rather than as a broken build.
//!
//! Same shape and same suite as `msi_identity.rs` beside it — a test over config
//! text, because the property is about what the tree *declares*, not what a
//! function returns. It lives in the Rust half because `tests.yml`'s `js` filter
//! does not match `src-tauri/`, so a vitest guard reading these files would be
//! skipped by exactly the edit it exists to police.
//!
//! Limits, stated honestly: this does not build a package, does not validate the
//! XML against Microsoft's schema, and cannot see Partner Center. It catches
//! drift between files, and it catches shipping the development identity by
//! accident. It cannot catch a manifest that is internally valid and wrong.
//!
//! Spec: docs/superpowers/specs/2026-08-27-msix-store-spec.md §B

use std::path::Path;

fn manifest() -> String {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("windows/Package.appxmanifest");
    std::fs::read_to_string(&path).expect("read windows/Package.appxmanifest")
}

fn conf() -> serde_json::Value {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json");
    let text = std::fs::read_to_string(&path).expect("read tauri.conf.json");
    serde_json::from_str(&text).expect("tauri.conf.json is valid JSON")
}

#[test]
fn the_manifest_names_the_executable_cargo_builds() {
    // The binary name comes from the Cargo package name, NOT `productName` — a
    // distinction #269 made load-bearing. A manifest naming a missing exe
    // produces a package that installs and then fails to launch.
    let exe = format!("{}.exe", env!("CARGO_PKG_NAME"));
    assert!(
        manifest().contains(&format!("Executable=\"{exe}\"")),
        "Package.appxmanifest does not name `{exe}` as its Executable."
    );
}

#[test]
fn the_display_name_matches_product_name() {
    let conf = conf();
    let product = conf["productName"]
        .as_str()
        .expect("productName is a string");
    assert!(
        manifest().contains(&format!("<DisplayName>{product}</DisplayName>")),
        "Package.appxmanifest's DisplayName is not `{product}` — the Store \
         listing and the app itself would disagree about what this is called."
    );
}

#[test]
fn the_publisher_display_name_matches_the_bundle_publisher() {
    let conf = conf();
    let publisher = conf["bundle"]["publisher"]
        .as_str()
        .expect("bundle.publisher is a string");
    assert!(
        manifest().contains(&format!(
            "<PublisherDisplayName>{publisher}</PublisherDisplayName>"
        )),
        "Package.appxmanifest's PublisherDisplayName is not `{publisher}`. Two \
         Windows channels claiming different publishers for one app is the bug \
         msi_identity.rs exists to prevent, one file over."
    );
}

#[test]
fn the_pgit_alias_is_declared_and_ends_in_exe() {
    // The alias is the ONLY thing that puts `pgit` on a Store user's PATH: an
    // MSIX runs no installer, so wix/pgit-cli.wxs has nothing to hook here. The
    // schema requires the ".exe" suffix.
    let manifest = manifest();
    assert!(
        manifest.contains("Category=\"windows.appExecutionAlias\""),
        "the appExecutionAlias extension is gone — a Store install would have no \
         `pgit` at all, which is the one thing #187 asks for on Windows."
    );
    assert!(
        manifest.contains("Alias=\"pgit.exe\""),
        "the alias is not `pgit.exe`. The schema requires the .exe suffix, and \
         the stem is what users actually type."
    );
}

#[test]
fn the_full_trust_capability_is_declared() {
    // Without it the app runs in an app container and can neither spawn the
    // user's git nor read their repositories — which is the entire product.
    assert!(
        manifest().contains("Name=\"runFullTrust\""),
        "runFullTrust is gone. The app would install and then be unable to run \
         git. It is a RESTRICTED capability needing a Partner Center \
         justification — see the manifest's own comment for the wording."
    );
}

#[test]
fn the_committed_identity_stays_a_substitution_token() {
    // Identity Name and Publisher are assigned by Partner Center. Committing a
    // real-looking pair invites someone to build a package that LOOKS
    // submittable and is rejected on upload; keeping tokens makes the
    // substitution step impossible to forget, because a leftover token is also
    // checked by scripts/msix-pack.sh before it packs.
    let manifest = manifest();
    for token in [
        "__MSIX_IDENTITY_NAME__",
        "__MSIX_PUBLISHER__",
        "__MSIX_VERSION__",
        "__MSIX_ARCH__",
    ] {
        assert!(
            manifest.contains(token),
            "`{token}` is missing from Package.appxmanifest. If it was replaced \
             with a real value, put the token back: scripts/msix-pack.sh \
             substitutes these at pack time, and a hard-coded identity silently \
             packages the wrong one."
        );
    }
}

#[test]
fn the_minimum_version_licenses_the_uap10_attributes() {
    // uap10:RuntimeBehavior / uap10:TrustLevel arrived in Windows 10 2004
    // (10.0.19041). Declaring them under a lower floor makes the activation info
    // incomplete and the install fails rather than degrading.
    let manifest = manifest();
    assert!(
        manifest.contains("uap10:RuntimeBehavior"),
        "the uap10 activation attributes are gone."
    );
    assert!(
        manifest.contains("MinVersion=\"10.0.19041.0\""),
        "TargetDeviceFamily MinVersion is not 10.0.19041.0, which is the floor \
         the uap10 attributes above it require."
    );
}

#[test]
fn no_comment_contains_a_double_hyphen() {
    // XML forbids `--` inside a comment body, and this manifest is comment-heavy
    // by design. Writing `--` as an em-dash substitute made the file fail to
    // parse — which `makeappx` would have reported at RELEASE time, from a
    // Windows runner, with the manifest already staged. Caught here instead.
    //
    // No XML crate for this: the property is textual and one dependency for one
    // assertion is the wrong trade. `<!--` and `-->` are the delimiters, so they
    // are stripped before the scan rather than special-cased inside it.
    let manifest = manifest();
    let bodies = manifest.replace("<!--", "\u{1}").replace("-->", "\u{1}");
    for (i, chunk) in bodies.split('\u{1}').enumerate() {
        // Odd chunks are comment bodies; even ones are markup between comments.
        if i % 2 == 1 {
            assert!(
                !chunk.contains("--"),
                "a comment in Package.appxmanifest contains `--`, which is \
                 illegal inside an XML comment and makes the whole manifest \
                 unparseable. Use an em dash. Offending comment starts: {}",
                chunk.trim().chars().take(60).collect::<String>()
            );
        }
    }
}

#[test]
fn every_referenced_asset_exists_in_the_icons_directory() {
    // The manifest names Assets\<name>.png; msix-pack.sh copies those from
    // src-tauri/icons/. A name that matches neither is a package whose tiles are
    // blank, or a pack step that fails at release time. The icons are generated
    // output (#206), so a regeneration that drops a size must fail here.
    let manifest = manifest();
    let icons = Path::new(env!("CARGO_MANIFEST_DIR")).join("icons");
    let mut checked = 0;
    for fragment in manifest.split("Assets\\").skip(1) {
        // Terminate on `"` OR `<`, because the references come in two shapes:
        // a quoted attribute (`Square44x44Logo="Assets\…png"`) and element text
        // (`<Logo>Assets\StoreLogo.png</Logo>`). Assuming only the first ran
        // past the `</Logo>` and swallowed half the manifest as a "filename".
        // Neither character is legal in a Windows filename, so either ends it.
        let name = fragment
            .split(|c| c == '"' || c == '<')
            .next()
            .expect("split always yields a first element");
        assert!(
            icons.join(name).exists(),
            "Package.appxmanifest references Assets\\{name}, but \
             src-tauri/icons/{name} does not exist. Either the manifest names a \
             tile we do not render, or `tauri icon` was re-run and dropped one."
        );
        checked += 1;
    }
    // A manifest that referenced nothing would pass the loop vacuously.
    assert!(
        checked >= 4,
        "expected at least the store logo and three tile sizes to be \
         referenced, found {checked}"
    );
}
