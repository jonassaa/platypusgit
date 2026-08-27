# MSIX Store Channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship platypusgit as an MSIX bundle the Microsoft Store signs and updates, without breaking the three Windows channels that already work.

**Architecture:** A fourth Windows channel over the same binary. `tauri build --no-bundle` produces the exe; a manifest committed in this repository plus `makeappx` produce the package; `update::capability` learns that a packaged install defers to the Store; `pgit` comes from an app execution alias, with the Scoop zip's existing `pgit.cmd` staged beside the exe so the install classifies as package-owned through machinery that already exists.

**Tech Stack:** Rust (edition 2021, no new crates), TypeScript/vitest, `makeappx` from the Windows SDK, PowerShell in `release.yml`, POSIX `sh` for `scripts/`, Astro for the site page.

**Spec:** `docs/superpowers/specs/2026-08-27-msix-store-spec.md` — read it before Task 1. Its §Verification reality governs what may be claimed.

## Global Constraints

- **This channel replaces nothing.** The `.msi`, the Scoop bucket and winget keep working unchanged. Any task that alters their behaviour is wrong.
- **No new Cargo dependency.** The identity probe is `extern "system"` against kernel32. `src-tauri` has neither `windows` nor `windows-sys` and this does not justify either.
- **Rust edition is 2021** — `extern "system" { … }`, *not* the 2024 `unsafe extern`.
- **`NotifyStore` is matched before `scoop_managed` and before bare `"windows"`.** A Store install that self-updated does not fail cleanly: Windows refuses to launch a package whose files were tampered with.
- **`bundle.publisher` must never equal `productName`** (done in #280, pinned by `msi_identity.rs`).
- **The MSIX job must not need `TAURI_SIGNING_PRIVATE_KEY`.** `--no-bundle` produces no updater artifact; the Store re-signs.
- **`makeappx`, never `winapp`, in CI.** `winapp` documents Windows 11 and the runner is Windows Server. `winapp` is for the local loop only.
- **`webviewInstallMode: { "type": "skip" }`** for the Store build. A package runs no bootstrapper.
- **`TargetDeviceFamily` `MinVersion` is `10.0.19041.0`** — the floor that licenses the `uap10` attributes.
- **x64 and arm64**, combined into one `.msixbundle`.
- **`pgit.cmd` inside the package is the relative form**, CRLF, byte-identical to `src-tauri/windows/pgit-portable.cmd`. Reuse `cli.rs::PORTABLE_SHIM_CMD`; do not write a second copy.
- **Six behaviours cannot be verified without Windows 11** (spec §Verification reality). Tasks 1–9 must never report them as verified. Task 10 records them as open.
- **"The MSIX revision must be 0" is unconfirmed.** Treat as unknown; verify at first upload.

---

### Task 1: `NotifyStore` in the update capability

**Files:**
- Modify: `src-tauri/src/update.rs` (the `UpdateCapability` enum, `InstallEnv`, `InstallEnv::new`, `capability`)
- Test: `src-tauri/tests/update.rs`

**Interfaces:**
- Consumes: nothing.
- Produces: `UpdateCapability::NotifyStore` (serializes `"notify-store"`); `InstallEnv { msix_packaged: bool, .. }`, false in `InstallEnv::new`.

- [ ] **Step 1: Write the failing tests**

Append to `src-tauri/tests/update.rs`:

```rust
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
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd src-tauri && cargo test --test update
```

Expected: compile error — `UpdateCapability::NotifyStore` not found, and `InstallEnv` has no field `msix_packaged`.

- [ ] **Step 3: Add the variant, the field and the arm**

In `src-tauri/src/update.rs`, add to the enum (after `NotifyScoop`):

```rust
    NotifyStore,
```

Extend the enum's doc comment with:

```rust
/// `NotifyStore` is a Microsoft Store install, and it is the one variant whose
/// reason is not "better advice". An MSIX is read-only after deployment and
/// Windows refuses to launch a package whose files were tampered with, so a
/// self-update here does not fail — it leaves an app that will not start. The
/// Store owns the upgrade; the panel says so and offers nothing to click.
```

Add the field to `InstallEnv`:

```rust
    /// This process has package identity — an MSIX install. Windows only.
    pub msix_packaged: bool,
```

...and to `InstallEnv::new`'s initializer:

```rust
            msix_packaged: false,
```

Then the arm, **first** among the Windows arms:

```rust
        "windows" if env.msix_packaged => UpdateCapability::NotifyStore,
        "windows" if env.scoop_managed => UpdateCapability::NotifyScoop,
        "windows" => UpdateCapability::SelfUpdate,
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd src-tauri && cargo test --test update
```

Expected: PASS, and no previously passing test in that file changes.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/update.rs src-tauri/tests/update.rs
git commit -m "feat(update): NotifyStore, ahead of SelfUpdate on Windows

An MSIX is read-only and Windows refuses to launch a tampered package, so a
self-updating Store install breaks the app rather than failing an update."
```

---

### Task 2: The package-identity probe

**Files:**
- Modify: `src-tauri/src/update.rs` (add `is_msix_packaged`)
- Modify: `src-tauri/src/commands/update.rs:38-55` (`get_update_capability`)
- Test: `src-tauri/tests/update.rs`

**Interfaces:**
- Consumes: `InstallEnv { msix_packaged }` from Task 1.
- Produces: `update::is_msix_packaged() -> bool`.

- [ ] **Step 1: Write the failing test**

Append to `src-tauri/tests/update.rs` (and add `is_msix_packaged` to the `use` list at the top of the file):

```rust
#[test]
#[cfg(not(windows))]
fn the_identity_probe_is_false_off_windows() {
    // The real probe cannot be exercised here — see the plan's Task 2 Windows
    // verification. What IS worth pinning is that the non-Windows arm exists and
    // is constant: `capability` must never receive a `true` it cannot mean.
    assert!(!is_msix_packaged());
}
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd src-tauri && cargo test --test update
```

Expected: compile error — `is_msix_packaged` not found in `update`.

- [ ] **Step 3: Implement the probe**

Add to `src-tauri/src/update.rs`:

```rust
/// Does this process have package identity — i.e. did it come from an MSIX?
///
/// `GetCurrentPackageFamilyName` is the documented discriminator: for a packaged
/// process it reports the family name (here, only its length — the buffer is
/// deliberately null, because the name itself is not the question), and for an
/// unpackaged one it returns `APPMODEL_ERROR_NO_PACKAGE`. Anything that is not
/// that error means "packaged", including `ERROR_INSUFFICIENT_BUFFER`, which is
/// what a null buffer is *supposed* to produce.
///
/// **Deliberately not a path test.** "Is the exe under `C:\Program
/// Files\WindowsApps`" is the tempting one-liner and it is wrong: Microsoft
/// documents that packages install to other PackageVolumes and other paths. Same
/// trap as `$env:SCOOP`, rejected for the same reason — the question is "was
/// THIS install packaged", and there is an API that answers exactly that.
///
/// No new dependency for one kernel32 function. Edition here is 2021, so this is
/// a plain `extern "system"` block, not the 2024 `unsafe extern` spelling.
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

/// Always false: only Windows has package identity, and the caller must never be
/// handed a `true` that `capability` would then have to interpret.
#[cfg(not(windows))]
pub fn is_msix_packaged() -> bool {
    false
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd src-tauri && cargo test --test update
```

Expected: PASS.

- [ ] **Step 5: Wire it into the command**

In `src-tauri/src/commands/update.rs`, inside `get_update_capability`, add above the `Ok(update::capability(…))`:

```rust
    let msix_packaged = os == "windows" && update::is_msix_packaged();
```

...and add to the `InstallEnv` literal, before `..update::InstallEnv::new(os)`:

```rust
        msix_packaged,
```

Extend that function's doc comment with:

```rust
/// The MSIX probe is an API call rather than a filesystem check, because package
/// identity is a property of the PROCESS and not of a path — see
/// `update::is_msix_packaged`. It is guarded by `os == "windows"` for the same
/// reason the others are: the answer is meaningless elsewhere.
```

- [ ] **Step 6: Verify the whole crate still compiles both ways**

```bash
cd src-tauri && cargo test --test update && cargo clippy --all-targets -- -D warnings
```

Expected: tests PASS, clippy clean. The `#[cfg(windows)]` body is not compiled on macOS — **this step does not verify the probe works.** That is Task 2's Windows verification below.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/update.rs src-tauri/src/commands/update.rs src-tauri/tests/update.rs
git commit -m "feat(update): detect an MSIX install by package identity

GetCurrentPackageFamilyName, not a WindowsApps path test — packages install to
other PackageVolumes, the same trap \$env:SCOOP was rejected for."
```

**Windows verification (cannot be done on macOS — do not mark Task 2 verified without it):**
Run the app under `winapp run .\dist` (spec §Verification reality) and confirm Settings → Updates reports the Store hint; then run the same binary unpackaged and confirm it reports self-update. A `cargo test` pass on any host proves only the stub.

---

### Task 3: `notify-store` in the frontend

**Files:**
- Modify: `src/lib/types.ts:479-495` (the `UpdateCapability` union and its doc)
- Modify: `src/features/update/packageHint.ts`
- Test: `src/features/update/packageHint.test.ts`

**Interfaces:**
- Consumes: the `"notify-store"` string produced by Task 1's `serde(rename_all = "kebab-case")`.
- Produces: `packageHint("notify-store", …) -> PackageHint`.

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe` in `src/features/update/packageHint.test.ts`:

```ts
  it("names the Store for a packaged install", () => {
    const hint = packageHint("notify-store", "windows");
    expect(hint).not.toBeNull();
    expect(hint?.note).toContain("Microsoft Store");
  });

  it("gives the Store hint no shell command to run", () => {
    // Every other notify variant hands over a command. This one must not: an
    // MSIX is read-only, there is nothing to type, and `winget upgrade` would be
    // advice for a channel this install did not come from.
    expect(packageHint("notify-store", "windows")?.command).toBe("");
  });

  it("trusts the backend's Store answer over the platform", () => {
    // Same rule the Scoop arm is pinned by: the capability is the more specific
    // answer and the platform switch must not get a chance to contradict it.
    expect(packageHint("notify-store", undefined)?.note).toContain(
      "Microsoft Store",
    );
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm vitest run src/features/update/packageHint.test.ts
```

Expected: FAIL — `notify-store` is not assignable to `UpdateCapability`, and `packageHint` returns `null`.

- [ ] **Step 3: Extend the union**

In `src/lib/types.ts`, add to the union:

```ts
  | "notify-store";
```

...and to its doc comment:

```ts
 * `notify-store` is a Microsoft Store (MSIX) install. It is the only variant
 * with no command to offer: the package is read-only, Windows refuses to launch
 * a tampered one, and the Store does the upgrade unprompted.
```

- [ ] **Step 4: Add the `packageHint` arm**

In `src/features/update/packageHint.ts`, add immediately after the `notify-scoop` block (before `if (capability !== "notify") return null;`):

```ts
  if (capability === "notify-store") {
    return {
      // The one hint with an empty command, and the reason is in the enum: the
      // Store updates this install by itself. Naming `winget upgrade` here would
      // send a Store user to a channel they are not on; naming a download would
      // send them to a file they cannot install over the package.
      note: "This install came from the Microsoft Store, which keeps it up to date:",
      command: "",
    };
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
pnpm vitest run src/features/update/packageHint.test.ts && pnpm tsc --noEmit
```

Expected: PASS, and `tsc` clean.

- [ ] **Step 6: Write the failing panel test**

`UpdatePanel.tsx:110-160` renders the note and then the command box **unconditionally** inside `{hint && (…)}` — so an empty command would draw an empty code box and a copy button that copies `""`. Add to `src/features/update/UpdatePanel.test.tsx`:

```tsx
  it("notify-store shows the note without an empty command box", () => {
    render(<UpdatePanel {...props({ capability: "notify-store" })} />);
    expect(screen.getByText(/Microsoft Store/)).toBeInTheDocument();
    // The note is the whole hint here. An empty code box with a copy button
    // that copies "" is worse than no box.
    expect(screen.queryByTestId("pg-update-pkg-hint")).toBeNull();
  });
```

Match the render/props helper the neighbouring tests in that file use — read one first (e.g. the `notify on macOS` case at line 70); do not invent a new harness.

- [ ] **Step 7: Run it to verify it fails**

```bash
pnpm vitest run src/features/update/UpdatePanel.test.tsx
```

Expected: FAIL — `pg-update-pkg-hint` is found, because the command box renders regardless.

- [ ] **Step 8: Guard the command box**

In `src/features/update/UpdatePanel.tsx`, wrap the command `<div>` (the one whose style sets `background: "var(--bg-2)"`, containing the `<code data-testid="pg-update-pkg-hint">` and the `PGIconButton`) so it only renders when there is a command:

```tsx
          {hint.command !== "" && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                background: "var(--bg-2)",
                borderRadius: "var(--r-2)",
                padding: "2px 2px 2px 8px",
              }}
            >
              {/* ...unchanged: the <code> and the copy button... */}
            </div>
          )}
```

Leave the note `<span>` outside the guard — it is what the Store arm has to say. Do not change the comment block above the command box; it explains why the command must be selectable and that reasoning still holds for every other arm.

- [ ] **Step 9: Run the tests to verify they pass**

```bash
pnpm vitest run src/features/update src/lib && pnpm tsc --noEmit
```

Expected: PASS, including the four existing `pg-update-pkg-hint` assertions for apt/scoop/brew/deb — those arms all have non-empty commands, so the guard must not change them.

- [ ] **Step 10: Commit**

```bash
git add src/lib/types.ts src/features/update/packageHint.ts \
        src/features/update/packageHint.test.ts \
        src/features/update/UpdatePanel.tsx src/features/update/UpdatePanel.test.tsx
git commit -m "feat(update): tell a Store install the Store updates it

The only hint with no command: an MSIX is read-only, so there is nothing for
the user to run. The panel's command box is now guarded on a non-empty command
so the note stands alone instead of drawing an empty box and a copy button that
copies nothing."
```

---

### Task 4: `pgit` classification for an MSIX-shaped install

**Files:**
- Test only: `src-tauri/src/cli.rs` (its `#[cfg(test)]` module)

**Interfaces:**
- Consumes: `cli.rs::PORTABLE_SHIM_CMD`, `classify_sighting`, `CliShimSource`.
- Produces: nothing. **No production code changes in this task** — the point is to prove none are needed.

- [ ] **Step 1: Write the test**

In `src-tauri/src/cli.rs`, in the test module beside `the_scoop_generated_shim_is_package_managed_too`, add:

```rust
    #[test]
    fn a_packaged_msix_install_is_package_managed() {
        // The MSIX stages the SAME pgit.cmd the Scoop zip does (release.yml), so
        // the exe_dir probe classifies it `Package` with no new code — which is
        // what stops Settings writing a second, competing shim into
        // %LOCALAPPDATA% that no uninstall would remove.
        //
        // FORWARD SLASHES ON PURPOSE, for the reason spelled out above the Scoop
        // cases: on a Unix host a backslash is an ordinary character, so a
        // backslashed path is ONE component and the probe would vacuously pass.
        let install =
            "C:/Program Files/WindowsApps/platypusgit_0.1.2.0_x64__abcdefgh/platypusgit.exe";
        let exe = Path::new(install);
        let shim = exe.parent().unwrap().join("pgit.cmd");
        assert_eq!(
            classify_sighting(
                // Argument order is (path, app_dirs, link, text, exe,
                // main_binary) — `path` FIRST. `link` is None because a .cmd is
                // a real file, not a symlink: recognition comes from `text`,
                // which is why the package must ship these exact bytes.
                &shim,
                &dirs(&["C:/Users/ada/AppData/Local/PlatypusGit/bin"]),
                None,
                Some(PORTABLE_SHIM_CMD),
                exe,
                "platypusgit"
            ),
            CliShimSource::Package
        );
    }
```

- [ ] **Step 2: Run it**

```bash
cd src-tauri && cargo test --lib cli::
```

Expected: **PASS on the first run.** This test is a characterisation test, not a red-green one — it asserts an existing property holds for a new install shape.

If it FAILS, stop and do not "fix" it by editing `cli.rs` production code. Compare the argument order and types against the neighbouring `the_scoop_generated_shim_is_package_managed_too` and `classify_sighting`'s signature (`src-tauri/src/cli.rs:423-431`) — a genuine failure here means the spec's §D conclusion is wrong and the spec needs revising before this plan continues.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/cli.rs
git commit -m "test(cli): an MSIX install classifies as package-managed

Characterisation test: the exe_dir pgit.cmd probe already covers the packaged
shape, so the Store channel needs no shim code of its own."
```

**Windows verification:** that `pgit` actually *runs* comes from the app execution alias, not from this file. Confirm from cmd, PowerShell **and Git Bash** on a real install (spec §Verification reality item 3).

---

### Task 5: The package manifest and its guard

**Files:**
- Create: `src-tauri/windows/Package.appxmanifest`
- Create: `src-tauri/tests/msix_identity.rs`
- Create: `src-tauri/tauri.msstore.conf.json`

**Interfaces:**
- Consumes: nothing.
- Produces: a manifest whose `Identity/@Name`, `Identity/@Publisher` and `Identity/@Version` are substituted by Task 6's script; the token strings `__MSIX_IDENTITY_NAME__`, `__MSIX_PUBLISHER__`, `__MSIX_VERSION__`, `__MSIX_ARCH__`.

- [ ] **Step 1: Write the manifest**

Create `src-tauri/windows/Package.appxmanifest`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<!--
  The Microsoft Store package manifest. HAND-AUTHORED AND COMMITTED, not
  generated by `winapp init`: every packaging trap this project has hit was a
  contract between two files nobody could see from one side (the apt sources
  path, Scoop's manifest.json, the WiX UpgradeCode), and a generated manifest is
  that shape by construction.

  The four __TOKEN__ values are substituted by scripts/msix-pack.sh. Identity
  Name and Publisher are ASSIGNED BY PARTNER CENTER and must match the product's
  identity page character for character or the upload is rejected — which is why
  they are not guessed here. Defaults are development values; msix_identity.rs
  pins that they stay obviously non-Store so a dev package can never be mistaken
  for a submittable one.

  Spec: docs/superpowers/specs/2026-08-27-msix-store-spec.md §B
-->
<Package
  xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  xmlns:uap3="http://schemas.microsoft.com/appx/manifest/uap/windows10/3"
  xmlns:uap10="http://schemas.microsoft.com/appx/manifest/uap/windows10/10"
  xmlns:desktop="http://schemas.microsoft.com/appx/manifest/desktop/windows10"
  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
  IgnorableNamespaces="uap uap3 uap10 desktop rescap">

  <Identity
    Name="__MSIX_IDENTITY_NAME__"
    Publisher="__MSIX_PUBLISHER__"
    Version="__MSIX_VERSION__"
    ProcessorArchitecture="__MSIX_ARCH__" />

  <Properties>
    <DisplayName>platypusgit</DisplayName>
    <PublisherDisplayName>Jonas Aasberg</PublisherDisplayName>
    <Logo>Assets\StoreLogo.png</Logo>
    <Description>A cross-platform, developer-focused git client.</Description>
  </Properties>

  <Dependencies>
    <!-- 10.0.19041.0 is the floor that licenses the uap10 attributes below to be
         used at all; on anything older the activation info would be incomplete
         and the install would fail. -->
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.19041.0"
                        MaxVersionTested="10.0.22621.0" />
  </Dependencies>

  <Resources>
    <Resource Language="en-US" />
  </Resources>

  <Applications>
    <!-- packagedClassicApp + mediumIL is the Desktop Bridge shape, chosen
         because it is the one the Store certainly accepts. Whether it is
         VIRTUALIZED — and so whether the app log and WebView2 localStorage move
         to a per-package location — is the open question in spec §E, to be
         settled by measuring a real install, not by argument. -->
    <Application Id="platypusgit"
                 Executable="platypusgit.exe"
                 uap10:RuntimeBehavior="packagedClassicApp"
                 uap10:TrustLevel="mediumIL">
      <uap:VisualElements
        DisplayName="platypusgit"
        Description="A cross-platform, developer-focused git client."
        BackgroundColor="transparent"
        Square150x150Logo="Assets\Square150x150Logo.png"
        Square44x44Logo="Assets\Square44x44Logo.png">
        <uap:DefaultTile Square71x71Logo="Assets\Square71x71Logo.png"
                         Square310x310Logo="Assets\Square310x310Logo.png"
                         Wide310x150Logo="Assets\Square310x310Logo.png" />
      </uap:VisualElements>
      <Extensions>
        <!-- This is what gives the user `pgit`. The alias must end in ".exe" and
             there is one per application; Windows places it in a directory that
             is on the default user PATH. It invokes the exe directly with the
             user's arguments, which is what cli.rs::parse_args already handles
             for the two symlink shim shapes. -->
        <uap3:Extension Category="windows.appExecutionAlias"
                        Executable="platypusgit.exe"
                        EntryPoint="Windows.FullTrustApplication">
          <uap3:AppExecutionAlias>
            <desktop:ExecutionAlias Alias="pgit.exe" />
          </uap3:AppExecutionAlias>
        </uap3:Extension>
      </Extensions>
    </Application>
  </Applications>

  <Capabilities>
    <!-- RESTRICTED capability. It makes Partner Center's "Restricted
         capabilities" submission field required and asks for a justification:
         this is a git client that shells out to the user's own git and reads the
         repositories they point it at. Routine for a packaged desktop app; not
         routine to discover on submission day. -->
    <rescap:Capability Name="runFullTrust" />
  </Capabilities>
</Package>
```

- [ ] **Step 2: Write the Store build config**

Create `src-tauri/tauri.msstore.conf.json`:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "bundle": {
    "windows": {
      "webviewInstallMode": {
        "type": "skip"
      }
    }
  }
}
```

- [ ] **Step 3: Write the failing guard test**

Create `src-tauri/tests/msix_identity.rs`:

```rust
//! **The Store manifest must keep agreeing with the rest of the tree.** It is a
//! hand-authored XML file that nothing else reads, which makes it exactly the
//! kind of file that drifts: a `productName` change, a version bump, or a
//! renamed icon leaves it stale and the failure surfaces at upload, days later,
//! as a rejected submission.
//!
//! Same shape and same suite as `msi_identity.rs` beside it — a test over config
//! text, in the Rust half because `tests.yml`'s `js` filter does not match
//! `src-tauri/`, so a vitest guard reading these files would be skipped by
//! exactly the edit it exists to police.
//!
//! Limits, stated honestly: this does not build a package, does not validate the
//! XML against Microsoft's schema, and cannot see Partner Center. It catches
//! drift and it catches shipping the development identity by accident.
//!
//! Spec: docs/superpowers/specs/2026-08-27-msix-store-spec.md §B

use std::path::Path;

fn manifest() -> String {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("windows/Package.appxmanifest");
    std::fs::read_to_string(&path).expect("read Package.appxmanifest")
}

fn conf() -> serde_json::Value {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json");
    let text = std::fs::read_to_string(&path).expect("read tauri.conf.json");
    serde_json::from_str(&text).expect("tauri.conf.json is valid JSON")
}

#[test]
fn the_manifest_names_the_executable_cargo_builds() {
    // The binary name comes from the Cargo package name, NOT productName, and a
    // manifest pointing at a missing exe produces a package that installs and
    // then fails to launch.
    let exe = format!("{}.exe", env!("CARGO_PKG_NAME"));
    let manifest = manifest();
    assert!(
        manifest.contains(&format!("Executable=\"{exe}\"")),
        "Package.appxmanifest does not name `{exe}` as its Executable."
    );
}

#[test]
fn the_display_name_matches_product_name() {
    let conf = conf();
    let product = conf["productName"].as_str().expect("productName is a string");
    assert!(
        manifest().contains(&format!("<DisplayName>{product}</DisplayName>")),
        "Package.appxmanifest's DisplayName is not `{product}` — the Store \
         listing and the app would disagree about what this is called."
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
    // The alias is the ONLY thing that puts `pgit` on a Store user's PATH — an
    // MSIX runs no installer, so the .msi's WiX Environment component has
    // nothing to hook here. The schema requires the ".exe" suffix.
    let manifest = manifest();
    assert!(
        manifest.contains("Category=\"windows.appExecutionAlias\""),
        "the appExecutionAlias extension is gone — a Store install would have \
         no `pgit` at all."
    );
    assert!(
        manifest.contains("Alias=\"pgit.exe\""),
        "the alias is not `pgit.exe`. The schema requires the .exe suffix, and \
         the name is what users type."
    );
}

#[test]
fn the_full_trust_capability_is_declared() {
    // Without it the app runs in an app container and cannot spawn the user's
    // git or read their repositories — which is the whole product.
    assert!(
        manifest().contains("Name=\"runFullTrust\""),
        "runFullTrust is gone. The app would install and then be unable to run \
         git. It is a RESTRICTED capability and needs a Partner Center \
         justification — see the manifest's own comment."
    );
}

#[test]
fn the_committed_identity_is_a_development_placeholder() {
    // Identity Name and Publisher are assigned by Partner Center. Committing a
    // real-looking pair invites someone to build a package that LOOKS
    // submittable and is rejected on upload; committing tokens makes the
    // substitution step impossible to forget.
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
             substitutes these, and a hard-coded identity silently packages the \
             wrong one."
        );
    }
}

#[test]
fn the_minimum_version_licenses_the_uap10_attributes() {
    // uap10:RuntimeBehavior / uap10:TrustLevel were introduced in 10.0.19041.
    // Declaring them with a lower floor makes the activation info incomplete and
    // the install fails on older systems rather than degrading.
    let manifest = manifest();
    assert!(
        manifest.contains("uap10:RuntimeBehavior"),
        "the uap10 activation attributes are gone."
    );
    assert!(
        manifest.contains("MinVersion=\"10.0.19041.0\""),
        "TargetDeviceFamily MinVersion is not 10.0.19041.0, which is the floor \
         the uap10 attributes require."
    );
}
```

- [ ] **Step 4: Run the guard to verify it passes, then prove it can fail**

```bash
cd src-tauri && cargo test --test msix_identity
```

Expected: 7 passed.

Then prove it bites — temporarily change `<DisplayName>platypusgit</DisplayName>` to `<DisplayName>PlatypusGit</DisplayName>`, re-run, and confirm `the_display_name_matches_product_name` FAILS. Revert.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/windows/Package.appxmanifest src-tauri/tauri.msstore.conf.json src-tauri/tests/msix_identity.rs
git commit -m "feat(distribution): the Store package manifest, with a drift guard

Hand-authored and committed rather than generated: a manifest nothing else
reads is exactly the file that goes stale, and the failure surfaces days later
as a rejected upload."
```

---

### Task 6: `scripts/msix-pack.sh`

**Files:**
- Create: `scripts/msix-pack.sh`
- Test: manual dry run (see steps)

**Interfaces:**
- Consumes: `src-tauri/windows/Package.appxmanifest`, `src-tauri/windows/pgit-portable.cmd`, `src-tauri/icons/*`, a built `platypusgit.exe`.
- Produces: `--out` directory containing a staged package layout, and (unless `--stage-only`) a `.msix` per arch.

- [ ] **Step 1: Write the script**

Create `scripts/msix-pack.sh`:

```sh
#!/bin/sh
# Stage and pack the Microsoft Store MSIX. One generator, in this repository,
# for the same reason apt-repo-publish.sh and scoop-manifest.sh are: the
# artifact users install is reviewable here, runs locally, and cannot drift from
# a second copy somewhere else.
#
# `makeappx` rather than `winapp pack` ON PURPOSE: winapp documents Windows 11
# as a prerequisite and GitHub's windows-latest is Windows Server. makeappx
# ships with the Windows SDK, which is already on the runner. winapp remains the
# right tool for the LOCAL loop (spec §Verification reality) and is not in the
# release path.
#
# --stage-only renders the manifest and builds the payload tree WITHOUT calling
# makeappx, so the whole substitution step is testable on a Mac.
#
# Spec: docs/superpowers/specs/2026-08-27-msix-store-spec.md §B
set -eu

usage() {
    cat <<'USAGE'
usage: msix-pack.sh --version X.Y.Z --arch x64|arm64 --exe PATH --out DIR
                    [--identity-name NAME] [--publisher CN] [--stage-only]

  --version        three-part app version; a fourth part is appended
  --arch           MSIX ProcessorArchitecture
  --exe            the built platypusgit.exe to package
  --out            directory to stage into (created; must not already exist)
  --identity-name  Partner Center's assigned Identity/@Name
  --publisher      Partner Center's assigned Identity/@Publisher (CN=...)
  --stage-only     stage and render only; do not run makeappx
USAGE
}

VERSION=""
ARCH=""
EXE=""
OUT=""
STAGE_ONLY=0
# Development defaults. Overridden for a real submission by the flags above,
# whose values come from the product's identity page in Partner Center and must
# match it character for character.
IDENTITY_NAME="${MSIX_IDENTITY_NAME:-platypusgit.dev}"
PUBLISHER="${MSIX_PUBLISHER:-CN=platypusgit-development}"

while [ $# -gt 0 ]; do
    case "$1" in
        --version) VERSION="$2"; shift 2 ;;
        --arch) ARCH="$2"; shift 2 ;;
        --exe) EXE="$2"; shift 2 ;;
        --out) OUT="$2"; shift 2 ;;
        --identity-name) IDENTITY_NAME="$2"; shift 2 ;;
        --publisher) PUBLISHER="$2"; shift 2 ;;
        --stage-only) STAGE_ONLY=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
    esac
done

for required in VERSION ARCH EXE OUT; do
    eval "value=\$$required"
    if [ -z "$value" ]; then
        echo "missing required argument for $required" >&2
        usage >&2
        exit 2
    fi
done

case "$ARCH" in
    x64|arm64) ;;
    *) echo "--arch must be x64 or arm64, got: $ARCH" >&2; exit 2 ;;
esac

# Three-part in, four-part out. The fourth part is 0 because the Store is
# documented to reserve the revision field -- TREAT THAT AS UNCONFIRMED (spec
# §E) and check it against the first real upload rather than trusting this line.
case "$VERSION" in
    *.*.*) MSIX_VERSION="$VERSION.0" ;;
    *) echo "--version must be three-part (X.Y.Z), got: $VERSION" >&2; exit 2 ;;
esac

[ -e "$EXE" ] || { echo "no such executable: $EXE" >&2; exit 1; }
[ -e "$OUT" ] && { echo "refusing to overwrite existing --out: $OUT" >&2; exit 1; }

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
manifest_src="$root/src-tauri/windows/Package.appxmanifest"
[ -f "$manifest_src" ] || { echo "missing manifest: $manifest_src" >&2; exit 1; }

mkdir -p "$OUT/Assets"
cp "$EXE" "$OUT/platypusgit.exe"

# The SAME pgit.cmd the Scoop zip ships, byte for byte. It is what makes the
# install classify as CliShimSource::Package via cli.rs's exe_dir probe, which
# is what stops Settings writing a second, competing shim into %LOCALAPPDATA%
# that no uninstall would remove. See pgit-portable.cmd's own header.
cp "$root/src-tauri/windows/pgit-portable.cmd" "$OUT/pgit.cmd"

# Store logos, already generated from app-icon.svg by `tauri icon` (#206).
for logo in Square30x30Logo Square44x44Logo Square71x71Logo Square150x150Logo \
            Square310x310Logo StoreLogo; do
    cp "$root/src-tauri/icons/$logo.png" "$OUT/Assets/$logo.png"
done

# sed, not a template engine: four fixed tokens, and the delimiter is | because
# a publisher CN contains commas and spaces but never a pipe.
sed -e "s|__MSIX_IDENTITY_NAME__|$IDENTITY_NAME|g" \
    -e "s|__MSIX_PUBLISHER__|$PUBLISHER|g" \
    -e "s|__MSIX_VERSION__|$MSIX_VERSION|g" \
    -e "s|__MSIX_ARCH__|$ARCH|g" \
    "$manifest_src" > "$OUT/AppxManifest.xml"

# A leftover token means the manifest would be packaged with a literal
# `__MSIX_...__` in it, which makeappx accepts and the Store rejects.
if grep -q '__MSIX_' "$OUT/AppxManifest.xml"; then
    echo "unsubstituted token left in $OUT/AppxManifest.xml:" >&2
    grep -n '__MSIX_' "$OUT/AppxManifest.xml" >&2
    exit 1
fi

echo "staged $ARCH payload in $OUT (version $MSIX_VERSION)"

if [ "$STAGE_ONLY" -eq 1 ]; then
    echo "--stage-only: not calling makeappx"
    exit 0
fi

command -v makeappx.exe >/dev/null 2>&1 || {
    echo "makeappx.exe not on PATH -- it ships with the Windows SDK." >&2
    echo "On a non-Windows host use --stage-only." >&2
    exit 1
}

# No signing here: the Microsoft Store re-signs the package, which is the whole
# reason this channel costs nothing (spec §Problem).
makeappx.exe pack /d "$OUT" /p "$OUT.msix" /o
echo "packed $OUT.msix"
```

- [ ] **Step 2: Make it executable and dry-run it on this host**

```bash
chmod +x scripts/msix-pack.sh
printf 'not really an exe\n' > /tmp/platypusgit.exe
rm -rf /tmp/msixstage
scripts/msix-pack.sh --version 0.1.2 --arch x64 --exe /tmp/platypusgit.exe \
    --out /tmp/msixstage --stage-only
```

Expected: `staged x64 payload in /tmp/msixstage (version 0.1.2.0)`.

- [ ] **Step 3: Assert the staged tree and the substitution**

```bash
ls /tmp/msixstage /tmp/msixstage/Assets
grep -E 'Name=|Publisher=|Version=|ProcessorArchitecture=' /tmp/msixstage/AppxManifest.xml
diff /tmp/msixstage/pgit.cmd src-tauri/windows/pgit-portable.cmd && echo "pgit.cmd identical"
grep -c '__MSIX_' /tmp/msixstage/AppxManifest.xml || echo "no tokens left"
```

Expected: `platypusgit.exe`, `pgit.cmd`, `AppxManifest.xml`, six PNGs under `Assets/`; `Version="0.1.2.0"` and `ProcessorArchitecture="x64"`; `pgit.cmd identical`; no tokens left.

- [ ] **Step 4: Prove the two guards fail**

```bash
# a two-part version is refused
scripts/msix-pack.sh --version 0.1 --arch x64 --exe /tmp/platypusgit.exe --out /tmp/x1 || echo "rejected, as intended"
# an existing --out is refused rather than overwritten
scripts/msix-pack.sh --version 0.1.2 --arch x64 --exe /tmp/platypusgit.exe --out /tmp/msixstage || echo "rejected, as intended"
```

Expected: both print `rejected, as intended`.

- [ ] **Step 5: Commit**

```bash
git add scripts/msix-pack.sh
git commit -m "feat(distribution): stage and pack the Store MSIX

makeappx rather than winapp pack: winapp documents Windows 11 and the runner is
Windows Server. --stage-only keeps the substitution testable off Windows."
```

---

### Task 7: The MSIX job in `release.yml`

**Files:**
- Modify: `.github/workflows/release.yml` (new `msix` job after `windows`)

**Interfaces:**
- Consumes: `needs.version.outputs.version` and `.tag`; `scripts/msix-pack.sh`.
- Produces: `PlatypusGit.msixbundle` attached to the release.

- [ ] **Step 1: Add the job**

Insert after the `windows` job in `.github/workflows/release.yml`:

```yaml
  # The Microsoft Store package. A SEPARATE job from `windows` on purpose: it
  # builds twice (x64 + arm64), needs no signing key at all -- the Store
  # re-signs, which is the whole economics of this channel -- and must not be
  # able to break the .msi/portable artifacts if makeappx or the manifest is
  # wrong. Spec: docs/superpowers/specs/2026-08-27-msix-store-spec.md §B
  msix:
    needs: version
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ needs.version.outputs.tag }}

      - name: Install pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 9

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: x86_64-pc-windows-msvc,aarch64-pc-windows-msvc

      - name: Cache cargo
        uses: Swatinem/rust-cache@v2
        with:
          workspaces: src-tauri

      - name: Inject version ${{ needs.version.outputs.version }}
        shell: bash
        run: |
          set -euo pipefail
          v="${{ needs.version.outputs.version }}"
          tmp="$(mktemp)"
          jq --arg v "$v" '.version = $v' src-tauri/tauri.conf.json > "$tmp" && mv "$tmp" src-tauri/tauri.conf.json
          jq --arg v "$v" '.version = $v' package.json > "$tmp" && mv "$tmp" package.json
          sed -i -E "s/^version = \".*\"/version = \"$v\"/" src-tauri/Cargo.toml

      - name: Install frontend deps
        run: pnpm install --frozen-lockfile

      # --no-bundle twice over: it is all we need (the package payload is the
      # exe), and it produces NO updater artifact, so this job needs neither
      # TAURI_SIGNING_PRIVATE_KEY nor an exception to the hard-error rule that
      # key exists for.
      - name: Build x64
        run: pnpm tauri build --no-bundle --target x86_64-pc-windows-msvc --config src-tauri/tauri.msstore.conf.json

      - name: Build arm64
        run: pnpm tauri build --no-bundle --target aarch64-pc-windows-msvc --config src-tauri/tauri.msstore.conf.json

      - name: Stage and pack both architectures
        shell: bash
        run: |
          set -euo pipefail
          v="${{ needs.version.outputs.version }}"
          scripts/msix-pack.sh --version "$v" --arch x64 \
            --exe src-tauri/target/x86_64-pc-windows-msvc/release/platypusgit.exe \
            --out msix-x64
          scripts/msix-pack.sh --version "$v" --arch arm64 \
            --exe src-tauri/target/aarch64-pc-windows-msvc/release/platypusgit.exe \
            --out msix-arm64

      - name: Bundle
        shell: bash
        run: |
          set -euo pipefail
          mkdir -p msix-bundle
          cp msix-x64.msix msix-arm64.msix msix-bundle/
          makeappx.exe bundle /d msix-bundle /p PlatypusGit.msixbundle /o

      # The .msi has no equivalent gate because the bundler owns its shape. This
      # one does: the payload is assembled by our own script, and a bundle with
      # the wrong shape is only discovered at upload -- days later, as a rejected
      # submission. Mirrors the portable zip's shape gate above.
      - name: Gate — the bundle has the shape the Store needs
        shell: pwsh
        run: |
          $ErrorActionPreference = 'Stop'
          if (-not (Test-Path 'PlatypusGit.msixbundle')) { throw 'no msixbundle produced' }
          $out = 'bundle-check'
          Expand-Archive -Path 'PlatypusGit.msixbundle' -DestinationPath $out -Force
          foreach ($arch in 'x64', 'arm64') {
              if (-not (Test-Path (Join-Path $out "msix-$arch.msix"))) {
                  throw "msixbundle is missing the $arch package"
              }
          }
          foreach ($arch in 'x64', 'arm64') {
              $inner = "inner-$arch"
              Expand-Archive -Path (Join-Path $out "msix-$arch.msix") -DestinationPath $inner -Force
              foreach ($f in 'platypusgit.exe', 'pgit.cmd', 'AppxManifest.xml') {
                  if (-not (Test-Path (Join-Path $inner $f))) {
                      throw "$arch package has no $f at its root"
                  }
              }
              $manifest = Get-Content (Join-Path $inner 'AppxManifest.xml') -Raw
              if ($manifest -match '__MSIX_') { throw "$arch manifest has an unsubstituted token" }
              if ($manifest -notmatch 'Alias="pgit\.exe"') { throw "$arch manifest lost the pgit alias" }
          }
          Write-Host 'msixbundle OK'

      - name: Attach to the release
        uses: softprops/action-gh-release@v2
        with:
          tag_name: ${{ needs.version.outputs.tag }}
          files: PlatypusGit.msixbundle
```

- [ ] **Step 2: Lint the workflow locally**

```bash
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/release.yml')); print('release.yml parses')"
```

Expected: `release.yml parses`.

- [ ] **Step 3: Confirm no existing job changed**

```bash
git diff .github/workflows/release.yml | grep -E '^-' | grep -v '^---'
```

Expected: **no output.** This job is purely additive; a removed line means an existing channel was touched.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci(release): build and attach the Store msixbundle

Separate job from windows: two targets, no signing key, and it must not be able
to break the .msi if makeappx or the manifest is wrong."
```

**Verification reality:** this job proves the package *builds*. It proves nothing about the package *running* — see the Windows items on Tasks 2 and 4.

---

### Task 8: The privacy policy page

**Files:**
- Create: `site/src/pages/privacy.astro`
- Modify: the site footer component (find with `rg -ln "support" site/src/components`)

**Interfaces:**
- Consumes: nothing.
- Produces: `https://www.platypusgit.com/privacy`, the URL Partner Center's Properties page requires.

- [ ] **Step 1: Read a sibling page for the layout and prop conventions**

```bash
cat site/src/pages/support.astro
```

Match its layout import, frontmatter and heading structure exactly. Do not invent a new page shape.

- [ ] **Step 2: Write the page**

Create `site/src/pages/privacy.astro` following that structure. Content requirements — these are the substance, the wording is yours:

- Store policy 10.5.1 requires this page for a Win32/Desktop Bridge product **whether or not** it collects anything, so the page's job is to state what is already true.
- No telemetry, no analytics, no account, no crash reporting.
- The network calls that DO happen and why, all user-initiated or update-related: the update check against the GitHub releases API, and the forge (GitHub/GitLab) APIs the user configures with their own token. Tokens are stored by the OS keychain and never sent anywhere but that forge.
- Repository contents never leave the machine.
- **Link the claim to the gate, don't just assert it:** `test/privacy.test.ts` and `src-tauri/tests/no_telemetry.rs` fail the build if an analytics dependency, a network call from `src/`, or an undisclosed hostname appears. That is what makes this page a promise rather than a paragraph.
- A contact route for privacy questions (reuse whatever the support page uses).

- [ ] **Step 3: Link it from the footer**

Add a `Privacy` link beside the existing footer links, matching their markup.

- [ ] **Step 4: Build the site and confirm the route exists**

```bash
pnpm --filter site build 2>/dev/null || (cd site && pnpm build)
```

Then confirm the output contains the page:

```bash
ls site/dist/privacy/index.html
```

Expected: the file exists.

- [ ] **Step 5: Run the privacy guard, which reads the tree this page describes**

```bash
pnpm vitest run test/privacy.test.ts
```

Expected: PASS. If the page introduced a new hostname, the guard will say so — add it to the allowlist **with a written reason**, per CLAUDE.md.

- [ ] **Step 6: Commit**

```bash
git add site/src/pages/privacy.astro site/src/components
git commit -m "docs(site): a privacy policy, because the Store requires one

Policy 10.5.1 requires it for a Win32 product regardless of what it collects.
It states what privacy.test.ts and no_telemetry.rs already enforce."
```

---

### Task 9: `scripts/msstore-wizard.sh`

**Files:**
- Create: `scripts/msstore-wizard.sh`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing in the tree — it walks a human through Partner Center.

- [ ] **Step 1: Read the two existing wizards and match them**

```bash
head -60 scripts/scoop-bucket-wizard.sh
head -40 scripts/apt-repo-wizard.sh
```

Match their structure: interactive, never piped into a shell, `--dry-run` prints the walk and changes nothing, one numbered step per screen, and a final "what you should have now" summary.

- [ ] **Step 2: Write the wizard**

*This is the one task specified as requirements rather than code, deliberately:
the two existing wizards define the house style for interactive scripts and
inventing a third shape from a plan would fight them. Step 1 is not optional.*

Steps it must cover, in this order, with the reasons attached — each of these is a trap, not a formality:

1. **Create the account starting at `https://storedeveloper.microsoft.com`.** That page states it is the only entry point for the fee-free flow; reaching Partner Center any other way serves the legacy paid one. Individual account (policy 10.14 reserves Company for trade/profession). Government ID + selfie.
2. **Reserve the product name `platypusgit`** (policy 10.1.1: unique, no descriptive text).
3. **Copy the assigned package identity** — Identity `Name`, `Publisher` (`CN=…`), and Publisher display name — from the product's identity page, and pass them to `msix-pack.sh` as `--identity-name` / `--publisher`. **Character for character**; a mismatch is rejected at upload.
4. **Age ratings:** every IARC question (policy 11.11).
5. **Restricted capabilities:** justify `runFullTrust` — a git client that spawns the user's own git and reads the repositories they open.
6. **Description:** the `git` dependency must be in the **first line** (policy 10.2.4 permits depending on non-integrated software only if disclosed at the beginning of the description).
7. **Privacy policy URL:** `https://www.platypusgit.com/privacy` (Task 8).
8. **Upload** `PlatypusGit.msixbundle` from the release, and record what the first submission teaches — especially whether the four-part version's revision really must be 0.

- [ ] **Step 3: Test the dry run**

```bash
chmod +x scripts/msstore-wizard.sh
scripts/msstore-wizard.sh --dry-run
```

Expected: the whole walk printed, nothing created, exit 0. Confirm it never reads stdin in `--dry-run`.

- [ ] **Step 4: Commit**

```bash
git add scripts/msstore-wizard.sh
git commit -m "feat(distribution): walk the Partner Center steps for the Store

Same shape as the apt and Scoop wizards. Leads with the entry-point trap: the
fee-free flow exists only from storedeveloper.microsoft.com."
```

---

### Task 10: Document the channel

**Files:**
- Modify: `docs/dev/distribution.md`
- Modify: `CLAUDE.md` (only if a new load-bearing rule emerged)

**Interfaces:**
- Consumes: everything above.
- Produces: the operational summary `test/docs.test.ts` reads.

- [ ] **Step 1: Add the section**

Add a `## The Microsoft Store — MSIX (spec: …)` section to `docs/dev/distribution.md`, following the shape of the apt section: pointer to the spec for the *why*, then the operational facts. It must state:

- The four Windows channels and their `capability` outcomes (spec §A's table).
- `makeappx` in CI, `winapp` for the local loop, and why they differ.
- That `pgit` comes from the app execution alias, that `pgit.cmd` in the package is what makes the install classify as `Package`, and that `path_state: OffPath` is correct and unrendered — **so nobody "fixes" it.**
- That the manifest's identity tokens are substituted at pack time from Partner Center's values.
- The six unverified behaviours, as open questions with the `winapp run` loop that answers five of them.
- That the Store revision-must-be-0 claim is unconfirmed until the first upload.

- [ ] **Step 2: Run the doc invariants**

```bash
pnpm vitest run --project docs
```

Expected: PASS. If it fails naming a new backend module, add it to the `src-tauri/src/` tree in `docs/dev/architecture.md` in this same commit — that is exactly the drift the test exists to catch.

- [ ] **Step 3: Full local suite before handing over**

```bash
pnpm test && pnpm tsc --noEmit
cd src-tauri && cargo test && cargo clippy --all-targets -- -D warnings
```

Expected: all PASS. Record the counts in the PR body.

- [ ] **Step 4: E2E, only if `src/` or `src-tauri/` changed (it did — Tasks 1–4)**

```bash
pnpm test:e2e:docker build
pnpm test:e2e:docker run --spec e2e/specs/settings.e2e.ts
```

Pick the spec(s) covering Settings → Updates and Settings → Command line. CI runs the full suite; do not run it all locally.

- [ ] **Step 5: Commit**

```bash
git add docs/dev/distribution.md docs/dev/architecture.md CLAUDE.md
git commit -m "docs(distribution): the Microsoft Store channel

Records the two things most likely to be undone by a future reader: OffPath is
correct for a package-owned shim, and the revision-must-be-0 claim is
unconfirmed until the first upload."
```

---

## What this plan does not deliver

Stated so the PR cannot imply otherwise:

- **A submitted app.** Tasks 1–10 produce a submittable bundle. The account, the name reservation, the identity values and the upload are Task 9's wizard, run by a human.
- **Any of the six Windows behaviours in spec §Verification reality.** `GIT_ASKPASS` is the one with real risk behind it.
- **The `packagedClassicApp` vs `win32App` answer** (spec §E). Task 5 commits the shape the Store certainly accepts; whether the log and `localStorage` move is measured afterwards.
- **`msstore-publish` automation.** Deliberately after the first manual submission.
- **arm64 for any other channel.** This adds the target for the bundle only.
