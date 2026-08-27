# MSIX in the Microsoft Store: free signing, Store-delivered updates

Research this builds on: `2026-08-27-microsoft-store-research.md` (routes,
policies, costs, citations). That document recommended this route; this one is
the design. Read its **Must test** list before starting — six behaviours here
cannot be verified on a developer Mac and are not claimed to be.

## Problem

Windows is the only platform where a new user meets a SmartScreen warning
before they meet the app. The `.msi` is unsigned, and signing it costs
$150–300/year for an OV certificate — the one distribution cost the project has
so far avoided entirely (apt signs with our own key; Homebrew and Scoop need no
certificate at all).

The Microsoft Store removes that cost rather than paying it: **submit an MSIX
and Microsoft re-signs the package for free.** No certificate to buy, renew, or
keep on an HSM, no SmartScreen prompt, and updates delivered by the Store
instead of by us.

Nothing about that is free of consequence, and the consequences are the design.
An MSIX is read-only after install, so the updater cannot work. It runs no
installer, so the `.msi`'s PATH write has nothing to hook. Its `AppData` writes
may be redirected somewhere the app's own documentation does not name.

## Scope

**In.** A submittable `.msixbundle` for x64 and arm64, built in CI; a
`Package.appxmanifest` in this repository; `update::capability` learning that a
packaged install defers to the Store; `pgit` working from a shell on a Store
install; the guard tests that keep all of it from drifting; the privacy policy
page the submission requires.

**Out.** The submission itself, the Partner Center account, and the Store name
reservation — those need an ID-verified human (§G). arm64 for any *other*
channel: this spec adds an arm64 build target for the MSIX bundle only, and
does not promise an arm64 `.msi`, zip, or updater entry. Automating submission
via the Store API — deliberately deferred to Follow-ups, because the
certification failure modes are the thing you would be automating around and
we have not seen one yet.

**Not a replacement for anything.** The Store is a fourth Windows channel
beside the `.msi`, the Scoop bucket, and (in progress) winget. It is the `.deb`
+ apt relationship again: the same binary reaching users a second way.

## Design

### A. Four Windows channels, one binary, four update stories

`update::capability` already answers "can this install replace itself, or should
it defer" per channel, and it already has three arms for three Windows
outcomes-in-waiting. The Store adds a fourth:

| Channel | Install shape | `capability` |
| --- | --- | --- |
| `.msi` direct download | per-machine installer | `SelfUpdate` |
| Scoop bucket | portable zip in Scoop's tree | `NotifyScoop` |
| winget (in progress, #278) | the same `.msi` | `SelfUpdate` |
| **Store MSIX** | **read-only package** | **`NotifyStore`** |

The binary is identical in all four. What differs is packaging and who owns the
upgrade — which is exactly the axis `capability` was built to express, so this
adds a row rather than a mechanism.

### B. Producing the MSIX: a manifest we can read, `makeappx` in CI

**`src-tauri/windows/Package.appxmanifest` is hand-authored and committed.**
`scripts/msix-pack.sh` renders version and architecture into it and calls
`makeappx`, per arch, then `makeappx bundle` to combine them.

**Why not `winapp init`:** it generates the manifest on the developer's machine,
which makes the manifest an artifact instead of a source file. Every trap this
project has hit in packaging was a contract between two files that nobody could
see from one side — the apt sources path, the Scoop `manifest.json`, the
`UpgradeCode`. A generated manifest is that shape by construction. `winapp`
stays extremely useful for the *local* loop (§Verification reality) and is not
in the release path.

**Why not `winapp pack` in CI:** its documented prerequisite is Windows 11 and
GitHub's `windows-latest` is Windows Server. `makeappx` ships with the Windows
SDK, which is already on the runner, and needs no such thing.

**Why not `@choochmeque/tauri-windows-bundle`:** it would do all of this from
`tauri.conf.json` in one command, including the arm64 bundle. Rejected for the
same reason `aptly` and `reprepro` were: it puts the release path behind one
person's tool, and the logic it replaces is a hundred lines of shell we can read.
Reconsider if the manifest ever needs to vary more than version and arch.

The job builds with `tauri build --no-bundle`, which matters twice: it produces
just the exe (all we stage), and it produces **no updater artifact**, so the
MSIX job needs neither `TAURI_SIGNING_PRIVATE_KEY` nor an exception to the
hard-error rule that key exists for.

What the manifest must carry, beyond the obvious:

- `uap10:RuntimeBehavior` + `uap10:TrustLevel="mediumIL"` — see §E for which
  runtime behaviour and why the choice is open.
- `<rescap:Capability Name="runFullTrust" />`. This is a **restricted**
  capability, which makes Partner Center's *Restricted capabilities* field
  required and asks for a justification at submission (§G). Routine for a
  packaged desktop app; not routine to discover on submission day.
- The `windows.appExecutionAlias` extension (§D).
- `TargetDeviceFamily MinVersion` at or above `10.0.19041.0`, which is what
  licenses the `uap10` attributes above to be used at all rather than the older
  `EntryPoint` spelling.

Icons need no work: `src-tauri/icons/` already carries the full
`Square*Logo`/`StoreLogo` set, generated from `app-icon.svg`. `winapp init`
would write its own `Assets/`; do not let it.

### C. `update::capability` gains `NotifyStore`

A fourth `UpdateCapability` variant, `notify-store` over IPC, plus
`msix_packaged: bool` on `InstallEnv`, plus the mirrored member in the TS union
(`src/lib/types.ts`). `capability` stays pure and stays fully testable on a Mac;
only the probe is platform code.

Arm order matters and the existing comment block explains why for apt and
Scoop. For the Store the rule is the same as Scoop's and for a stronger reason:
**`NotifyStore` wins over `SelfUpdate`.** A Store install that self-updated
would not fail cleanly — the package is read-only and Windows *refuses to launch
a package whose files were tampered with*. The failure mode is a broken app, not
a failed update.

```rust
"windows" if env.msix_packaged => UpdateCapability::NotifyStore,
"windows" if env.scoop_managed => UpdateCapability::NotifyScoop,
"windows" => UpdateCapability::SelfUpdate,
```

`msix_packaged` before `scoop_managed` because the two are mutually exclusive in
practice and the packaged answer is the one with a hard failure behind it.

**The probe is `GetCurrentPackageFamilyName`**, which returns
`APPMODEL_ERROR_NO_PACKAGE` (15700) when the caller has no package identity.
Twelve lines of `#[cfg(windows)] extern "system"` against `kernel32`, no new
dependency — `src-tauri/Cargo.toml` has neither `windows` nor `windows-sys`
today, and this does not justify either.

**Deliberately not a path test.** "Is the exe under `C:\Program
Files\WindowsApps`" is the tempting one-liner and it is wrong: Microsoft's own
documentation says packages can be installed on other PackageVolumes and at
other paths. This is the same trap as `$env:SCOOP`, rejected for the same
reason — the question is *"was this install packaged"*, and there is an API that
answers exactly that.

The user-facing string is the Store's own verb: an MSIX user updates from the
Microsoft Store's Library page, or by `winget upgrade` if they have it, and
never by downloading anything.

### D. `pgit` on an MSIX install — no production code changes

An MSIX runs no install-time code, so the `.msi`'s WiX `Environment` component
has nothing to hook. The MSIX-native mechanism is an app execution alias:

```xml
<uap3:Extension Category="windows.appExecutionAlias"
                Executable="platypusgit.exe"
                EntryPoint="Windows.FullTrustApplication">
  <uap3:AppExecutionAlias>
    <desktop:ExecutionAlias Alias="pgit.exe" />
  </uap3:AppExecutionAlias>
</uap3:Extension>
```

Windows places the alias in a directory that is on the default user PATH, so
this is what actually gives the user `pgit`. Constraints from the schema, all
satisfied: the alias must end in `.exe`, there is one per application, and the
user may disable it in Settings → App execution aliases.

The alias invokes `platypusgit.exe` directly with the user's arguments — which
is precisely what the two symlink shim shapes already do and what
`cli.rs::parse_args` already handles. No `pgit.cmd` wrapper is needed for the
alias to work.

**One is shipped anyway, and it is the reason no Rust changes.** The zip that
Scoop installs carries a `pgit.cmd` beside the exe, because
`package_shim_paths_for`'s first entry is `exe_dir/pgit.cmd` and finding it is
what makes the install classify as `CliShimSource::Package` — which is what
stops Settings offering to write a second, competing `pgit` into
`%LOCALAPPDATA%\PlatypusGit\bin` and appending that to the user's PATH. An MSIX
has the same need and the same answer: **stage the same `pgit.cmd` into the
package beside the exe.** Its body is the relative form
`@"%~dp0platypusgit.exe" %*`, matching the zip's and for the same two reasons —
a file inside a package knows neither its install path nor its version
directory, and `shim_installed_at` compares bodies only for shims the app
itself wrote, so the two forms cannot collide.

With that file present: `shim_status` returns `Package`, `installed` is true,
`plan_install` returns `KeepExisting`, `install_shim` is a no-op success. Every
one of those behaviours already exists and is already tested.

**`path_state` will read `OffPath`, and that is correct and invisible.** The
package's own directory genuinely is not on PATH; the alias directory is.
`Settings.tsx` passes `null` to `PathNote` whenever the shim is package-owned,
because where a package put its file is not the user's problem. The Scoop spec
states plainly that no code change is needed for this and none should be made
to "fix" it. The same holds here. *(An earlier draft of this design proposed
adding the alias directory to the Windows package-paths table. That was wrong,
and it is recorded here so it is not re-proposed.)*

The only edit to `cli.rs` is inside its `#[cfg(test)]` module: the
classification is load-bearing, so it gets an MSIX-shaped path and the
package's real `pgit.cmd` body, beside the Scoop-shaped case already there. No
production path in that file moves.

### E. WebView2, the version format, and one open question

**WebView2:** `webviewInstallMode: { "type": "skip" }`, in a
`src-tauri/tauri.msstore.conf.json` override. A package runs no bootstrapper, so
there is nothing else it could be. Evergreen WebView2 is preinstalled on
Windows 11 and reaches Windows 10 through Edge. If a clean Windows 10 turns out
to lack it, the fallback is `fixedRuntime` — roughly 180 MB inside the package —
and that is a deliberate v2 decision, not a thing to pre-pay.

**Version format:** MSIX versions are four-part. The release job already injects
a three-part version with `jq`; the manifest render appends the fourth part.
Treat "the revision must be 0 for Store submissions" as **unconfirmed** and
verify it on the first upload rather than trusting this sentence — it is cheap
to check and expensive to guess.

**Open question, to be settled by measurement, not by argument:**
`uap10:RuntimeBehavior="packagedClassicApp"` or `"win32App"`. The first is the
Desktop Bridge shape and is certainly accepted by the Store. The second is
documented as a valid combination with `mediumIL` and appears to avoid file
system and registry virtualization — which decides whether the app log and
WebView2 `localStorage` move to a per-package private location. Microsoft's
documentation marks its virtualization sections "applies only to virtualized
apps" without ever stating which of the two that is.

Start with `packagedClassicApp` because it is the shape the Store certainly
accepts, and find out where a real install writes. If the log moves, that is a
documentation change (`docs/dev/` names those paths) rather than a defect — but
it must be *known*, because a support instruction that names the wrong path is
worse than one that names none.

### F. The publisher name, which is wrong for this route today

`bundle.publisher` is `"platypusgit"` as of #278 — set deliberately, to match
how the project brands itself, and correct for the winget purpose it was chosen
for. It is wrong for this one: Tauri's Microsoft Store guidance says the
application publisher name **cannot** match the application product name, and
`productName` is `platypusgit`.

**Change it to `"Jonas Aasberg"`,** and do it before v0.1.2 is cut. The timing
is the whole point:

- No published release carries `"platypusgit"` yet — v0.1.1 predates #278 — so
  the change costs nothing today.
- After v0.1.2 ships it costs a second registry-identity change.
- After the first winget submission it is locked in by
  `AppsAndFeaturesEntries.Publisher`, which must match what the installer wrote.

**The existing guards cannot see this.** All three in
`src-tauri/tests/msi_identity.rs` are value-agnostic — publisher is non-empty,
and publisher `!=` the identifier fallback — so every one of them passes with
either value. It therefore needs a fourth test of its own rather than an edited
expectation, which is the shape the file already argues for: the field has more
than one wrong value, and each one that looks right deserves a guard.

Done in PR #280, ahead of this spec's implementation, because the cost grows
with every release. `UpgradeCode` is untouched, so no existing install is
orphaned.

### G. State outside this repository

Following `apt-repo-wizard.sh` and `scoop-bucket-wizard.sh`:
**`scripts/msstore-wizard.sh`** walks the steps that cannot live in a
repository, interactive, never piped into a shell, with `--dry-run` printing the
walk and changing nothing. It is run by the user, because it involves a
government ID.

1. Create the developer account **starting at `storedeveloper.microsoft.com`**.
   This is not a detail: that page states it is the only entry point for the
   fee-free flow, and reaching Partner Center any other way serves the legacy
   paid one.
2. Reserve the product name `platypusgit`.
3. Copy the assigned package identity — Name, Publisher (`CN=…`), Publisher
   display name — from the product's identity page into
   `Package.appxmanifest` **verbatim**. A mismatch is rejected at upload.
4. Complete the age-rating questionnaire (policy 11.11, all questions).
5. Justify `runFullTrust` in *Restricted capabilities* (§B).
6. Write the description with **the `git` dependency in its first line** —
   policy 10.2.4 permits depending on non-integrated software only if it is
   disclosed at the beginning of the description. The `.deb` already declares
   `Depends: git`; this is the same fact, said where the Store requires it.
7. Set the privacy policy URL.

**The privacy policy page is repo work and is in scope.** Policy 10.5.1: "Product
types that inherently have access to Personal Information must always have
privacy policies. These include, but are not limited to, Desktop Bridge and
Win32 products." The site has no such page. It should be short and it should say
what is already true and already build-gated — no telemetry, no account, no
network call except the update check and the forge APIs the user configures.
`test/privacy.test.ts` and `no_telemetry.rs` are what make that page
truthful rather than aspirational, and it should link to that claim rather than
merely assert it.

## Rejected alternatives

**Submit the `.msi` under policy 10.2.9.** The other accepted route: the Store
lists a link to an installer we host. It needs a CA-chained certificate, keeps
us responsible for updates, and does nothing about SmartScreen on direct
downloads. Its one advantage is a much smaller diff. Reconsider only if MSIX
certification fails for a reason we cannot design around — and note SignPath
Foundation offers free OV signing to open-source projects, which would make
this route cheap *and* fix direct downloads. That is worth chasing on its own
merits, independent of the Store.

**Ship MSIX instead of the `.msi`.** Breaks the updater manifest, the Scoop
bucket, and every direct-download user, to save maintaining a channel that
already works.

**A `windows`/`windows-sys` dependency for the identity probe.** One kernel32
function does not justify either crate.

**Automating the submission in this spec.** See Scope.

## Verification reality

**What is verified on a Mac, in CI, before any Windows machine is involved:**
`capability`'s new arm and its ordering (pure function, unit tests); the TS
union staying 1:1; the `pgit.cmd` classification with an MSIX-shaped path; the
manifest ↔ `tauri.conf.json` ↔ Cargo agreement, via a new
`src-tauri/tests/msix_identity.rs` in the same shape and the same suite as
`msi_identity.rs` — Rust, because `tests.yml`'s `js` filter does not match
`src-tauri/`, so a vitest guard reading these files would be skipped by exactly
the edit it exists to police; `docs.test.ts` staying green as new backend files
and a new channel join the trees.

CI can also prove the package *builds* — `makeappx` on the runner, both
architectures, one bundle — which is worth having even though it proves nothing
about the package *running*.

**What no amount of CI or macOS work can answer, and is therefore not claimed:**

1. **`GIT_ASKPASS`.** git execs this binary and reads a credential from its
   stdout synchronously. Under MSIX that binary sits in a directory Microsoft
   describes as "heavily locked down", and `docs/dev/distribution.md` already
   calls the askpass path "the whole risk of the feature". Test `git credential
   fill` against a real installed package — a successful *launch* proves
   nothing here.
2. **Whether the package is virtualized** (§E), which decides whether the log
   and `localStorage` move.
3. **`pgit` from Git Bash / MSYS**, not merely from cmd and PowerShell. This
   project reasons about that shell explicitly elsewhere.
4. **Spawning `git.exe`** from inside a full-trust package, and whether child
   processes inherit package identity in any way that reaches `proc.rs`.
5. **WebView2** on a clean Windows 10 with `webviewInstallMode: skip`.
6. **Whether the Store accepts the manifest at all** — restricted capability
   justification, version format, and the runtime-behaviour choice all meet
   reality for the first time at upload.

The local loop for all six is `winapp`, and it needs no certificate:
`winapp init` once, then `winapp run .\dist` registers a loose-layout package
and launches the app *with* package identity, which is enough to answer 1–5
without ever producing an `.msix`. `winapp unregister` afterwards, or the real
package reports "already installed". Prerequisite: Windows 11 and
`winget install microsoft.winappcli`.

## Follow-ups

- **`msstore-publish` in `release.yml`**, via the Store submission API, gated
  exactly like `bump-cask` and `apt-publish` — and written only after one
  submission has been done by hand.
- **arm64 for the other channels.** This spec adds the target for the bundle;
  an arm64 `.msi` and Scoop zip are a separate decision with their own updater
  manifest consequences.
- **`fixedRuntime` WebView2**, if Windows 10 needs it (§E).
- **SignPath Foundation**, which would fix SmartScreen for direct downloads —
  the one user-facing Windows problem the Store does not touch.
