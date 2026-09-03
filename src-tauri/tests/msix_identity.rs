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

fn repo(rel: &str) -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri has a parent")
        .join(rel)
}

fn script(rel: &str) -> String {
    std::fs::read_to_string(repo(rel)).unwrap_or_else(|e| panic!("read {rel}: {e}"))
}

/// The whitespace-separated list assigned to `name` at the start of a line, as
/// in `SIZES="16 20 24"`. Deliberately dumb: these are two fixed lines in two
/// shell scripts, and a shell parser to read them would be the larger risk.
fn shell_list(source: &str, name: &str) -> Vec<String> {
    let prefix = format!("{name}=\"");
    let line = source
        .lines()
        .find(|l| l.starts_with(&prefix))
        .unwrap_or_else(|| panic!("no line starting `{prefix}`"));
    line[prefix.len()..]
        .split('"')
        .next()
        .expect("split always yields a first element")
        .split_whitespace()
        .map(str::to_owned)
        .collect()
}

/// Line number of the line that RUNS `cmd`, skipping comments. Matching the
/// bare string instead would happily find the command inside the paragraph of
/// comment explaining it — which is how the first draft of this passed against a
/// script whose `makepri` call had been commented out.
fn command_line(source: &str, cmd: &str) -> Option<usize> {
    source
        .lines()
        .position(|l| !l.trim_start().starts_with('#') && l.trim_start().starts_with(cmd))
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

// ---------------------------------------------------------------------------
// The unplated app-list icons (#390)
//
// Windows draws an app's icon on a SYSTEM ICON PLATE — a rounded square in the
// user's accent colour, blue on a default install — wherever it is shown
// without tile padding (taskbar, Start, all-apps, task view, ALT+TAB, snap
// assist) unless the package offers a `_altform-unplated` candidate at the
// right target size. The plate is there to guarantee contrast for icons that
// assume one; app-icon.svg is transparent and needs none, so the plate is pure
// damage, and that is what a Store install shipped until this was fixed.
//
// Three separate things have to stay true for the fix to hold, and NONE of them
// is visible in a package that installs, launches and passes certification —
// the only symptom is a blue box on somebody's taskbar, which no CI job can
// see. Hence guards.
// ---------------------------------------------------------------------------

#[test]
fn the_packer_stages_a_target_size_icon_for_every_rendered_size() {
    let sizes = shell_list(&script("scripts/msix-pack.sh"), "TARGETSIZES");
    assert!(
        sizes.len() >= 10,
        "scripts/msix-pack.sh's TARGETSIZES has shrunk to {} entries. Windows \
         picks the EXACT pixel size for the user's DPI, so a dropped size is a \
         rescale of a neighbour, not a missing file nobody notices.",
        sizes.len()
    );
    for n in &sizes {
        let icon = repo("src-tauri/icons/msix").join(format!("Square44x44Logo.targetsize-{n}.png"));
        assert!(
            icon.exists(),
            "scripts/msix-pack.sh stages Square44x44Logo.targetsize-{n}.png but \
             src-tauri/icons/msix/ has no such file, so the pack step would \
             abort at release time. Re-render the ladder: \
             `sh scripts/gen-msix-appicons.sh`."
        );
    }
}

#[test]
fn the_generator_and_the_packer_agree_on_the_size_ladder() {
    // Two lists in two scripts, one of which is run by hand on a developer
    // machine months apart from the other. Adding a size to the generator and
    // forgetting the packer renders a PNG that is never packaged; the reverse
    // fails the release. Neither is discoverable by reading one file.
    let rendered = shell_list(&script("scripts/gen-msix-appicons.sh"), "SIZES");
    let staged = shell_list(&script("scripts/msix-pack.sh"), "TARGETSIZES");
    assert_eq!(
        rendered, staged,
        "gen-msix-appicons.sh's SIZES and msix-pack.sh's TARGETSIZES have \
         drifted apart. They describe one ladder from two ends."
    );
}

#[test]
fn the_packer_stages_all_three_theme_candidates() {
    // The DEFAULT candidate alone does not suppress the plate — the suppression
    // IS `_altform-unplated`, and Windows wants a light-theme sibling beside it.
    // Losing one `cp` line leaves a package that looks complete in a file
    // listing and still plates the icon.
    let packer = script("scripts/msix-pack.sh");
    for form in ["_altform-unplated", "_altform-lightunplated"] {
        assert!(
            packer.contains(&format!("Square44x44Logo.targetsize-${{n}}{form}.png")),
            "scripts/msix-pack.sh no longer stages the `{form}` candidate. \
             Without it Windows falls back to the plated default and the \
             taskbar icon sits on an accent-coloured square."
        );
    }
}

#[test]
fn the_packer_builds_a_resource_index_before_packing() {
    // makeappx does not build one, and without it the qualifiers in those
    // filenames are just characters: MRM is the only thing that reads
    // `targetsize-48_altform-unplated` as a candidate selector. A package with
    // all 42 assets and no resources.pri behaves exactly like a package with
    // none of them.
    let packer = script("scripts/msix-pack.sh");
    let pri = command_line(&packer, "makepri.exe new")
        .expect("scripts/msix-pack.sh no longer RUNS `makepri.exe new`, so the package would carry no resources.pri and every target-size icon in it would be ignored");
    let pack = command_line(&packer, "makeappx.exe pack")
        .expect("scripts/msix-pack.sh no longer RUNS `makeappx.exe pack`");
    assert!(
        pri < pack,
        "`makepri.exe new` runs AFTER `makeappx.exe pack` in \
         scripts/msix-pack.sh. The index has to exist before the payload is \
         zipped, or it is simply not in the package."
    );
}

#[test]
fn the_tile_background_stays_transparent() {
    // Step 3 of Microsoft's target-based-asset procedure: "In the manifest file,
    // set the BackgroundColor for every icon you are making transparent." A
    // solid colour here puts a coloured square back behind the Start tile — a
    // different surface from the taskbar plate above, with the same look and the
    // same cause, so it is pinned in the same place.
    assert!(
        manifest().contains("BackgroundColor=\"transparent\""),
        "VisualElements/@BackgroundColor is no longer `transparent`. The mark \
         is designed to sit on the system's own background; giving it a colour \
         reintroduces the plate this ladder exists to remove."
    );
}
