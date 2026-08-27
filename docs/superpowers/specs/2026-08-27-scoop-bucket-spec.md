# A Scoop bucket: one-line install and package-manager updates on Windows

Issue: [#187](https://github.com/jonassaa/platypusgit/issues/187) — the Windows
half. The Linux half shipped in #267 (spec:
`2026-08-26-apt-repository-spec.md`); this is deliberately the same shape on the
other platform, and reuses its machinery wherever the two are actually the same
problem.

## Problem

Windows is the last platform where installing and updating are both manual.

- **Install** is a `.msi` button on `site/src/pages/download.astro`. No
  `winget`, no `scoop`, no `choco` — the download page says so in as many
  words.
- **Update** is `update::capability` → `SelfUpdate`, so the in-app updater
  fetches `PlatypusGit_x64.msi` and runs it. That works, and it is the one
  platform where it does — but it is also the *only* route, so a Windows user
  who wants their machine's packages managed in one place cannot have that.

macOS has had both halves via Homebrew since the cask landed; Linux got both in
#267. #187 ranks the remaining pieces "by value per effort" and puts **Scoop
first**: per-user, no admin prompt, no third-party moderation queue, and it is
where the dev-first audience already is. `winget` is second and is *gated on a
decision this spec does not make* — see Scope.

## Scope

**In:** a Scoop bucket (`jonassaa/scoop-platypusgit`), the portable release
asset it installs, the release job that bumps its manifest, the in-app update
advice for a Scoop install, the `pgit` command on that install, and the
download-page + README copy.

**Out, on purpose:**

- **winget.** #187 gates it on bundle code signing, which is on CLAUDE.md's
  "deliberately NOT in codebase" list. An unsigned installer means SmartScreen
  warnings and friction through winget validation, and the fix is a certificate
  purchase, not code. Nothing here blocks it later: winget consumes the same
  stable-named `.msi` and the same `sha256` this pipeline already computes.
- **Chocolatey.** #187 says skip unless asked. Unchanged.
- **arm64.** Only `x64` is built (arm64 Linux is split out as #266). The
  manifest is written in Scoop's `architecture` form anyway so a second
  architecture is an added key, not a rewrite — the lesson #187 recorded for
  the apt pool applies verbatim here.

## Design

### A. Scoop installs a portable `.zip`, not the `.msi`

**The `.msi` cannot be the thing Scoop installs**, for two independent reasons:

1. Scoop's MSI extraction is a deprecated path (`lessmsi`, or an `msiexec /a`
   administrative install that mangles the layout). Relying on it makes our
   install correctness a function of the user's `scoop config`.
2. Even where it works, an MSI install is per-machine and elevated. That
   defeats the three properties #187 chose Scoop *for*: per-user, no admin
   prompt, and a clean `scoop uninstall`. A manifest whose installer writes to
   `C:\Program Files` and the machine PATH leaves Scoop unable to remove what
   it installed.

So the `windows` release job gains a second, portable asset:

```
PlatypusGit_x64_portable.zip
├── platypusgit.exe    the same binary the .msi wraps
├── pgit.cmd           the CLI entry point (see §C)
└── LICENSE            GPL-3.0; we redistribute a binary, so it travels with it
```

Stable-named like every other asset, `sha256` exported as a job output for the
manifest bump, and attached to the release before the signature step is read —
the ordering trap the `windows` job already documents.

**No new updater artifact.** The zip is not a Tauri bundle, gets no `.sig`, and
gets no key in `latest.json`. That is not an omission: §B switches self-update
*off* for the installs that come from it, so there is nothing for the updater
to fetch. Adding a `windows-x86_64-zip` key would create a payload no client
can legitimately ask for.

**Runtime dependencies are unchanged from the `.msi`.** Both need the WebView2
runtime (present on Windows 11, and on Windows 10 via Edge) and the MSVC
runtime; neither bundles them. The zip is not a *worse* install in this
respect, but it is a *quieter* one — the `.msi`'s WiX webview install mode can
bootstrap WebView2, and a zip cannot — so the manifest's `notes` say so, which
is where Scoop prints text after an install.

### B. `update::capability` gains `NotifyScoop`

`capability` returns `SelfUpdate` for `"windows"` unconditionally today. Left
alone, a Scoop install would:

1. discover a new version,
2. download `PlatypusGit_x64.msi`,
3. install it **per-machine into `C:\Program Files`**,

…leaving the machine with two copies: the new MSI one, and Scoop's own under
`<root>\apps\platypusgit\current`, still on PATH via Scoop's shims and still
what the Start Menu shortcut points at. `scoop list` would report the old
version forever, and `scoop update platypusgit` would then "upgrade" the copy
the user is not running. Silent, and unrecoverable without understanding both
systems.

This is the same failure the apt work found on Linux, so it gets the same
answer: a fourth capability variant, and advice naming the package manager that
actually owns this install.

| capability | when | what the panel says |
| --- | --- | --- |
| `self-update` | Windows `.msi`, Linux AppImage | in-app install |
| `notify-apt` | apt-managed `.deb` | `sudo apt update && sudo apt upgrade platypusgit` |
| `notify-scoop` | Scoop install | `scoop update platypusgit` |
| `notify` | everything else | per-platform hint, or nothing |

**Detection: Scoop's own layout, not `$env:SCOOP`.** Scoop lays every install
out as `<root>\apps\<name>\<version>\…`, with the live version junctioned at
`<root>\apps\<name>\current`, and writes `manifest.json` + `install.json` into
the version directory. The root is relocatable (`$env:SCOOP`) and a global
install uses a different one (`$env:SCOOP_GLOBAL`), so reading an environment
variable is both fragile and wrong for the global case. Walking up from
`current_exe()` is neither:

```rust
// update.rs — pure, so it is testable from macOS and Linux too
pub fn is_scoop_layout(exe: &Path) -> bool   // .../apps/<CARGO_PKG_NAME>/<version>/exe
```

The app-directory name must equal `env!("CARGO_PKG_NAME")`, which is what makes
this a *contract with the bucket*: the manifest is `platypusgit.json`, so Scoop
names the directory `platypusgit`. `CARGO_PKG_NAME` is read rather than written
out for the same reason `cli.rs::MAIN_BINARY` is.

The command layer adds one `Path::exists` for Scoop's `manifest.json` beside
the exe — deliberately the same shape as the apt probe: no process spawn,
nothing to route through `proc.rs`, nothing to mock, and skipped entirely off
Windows rather than trusting a path not to exist there. `scoop-verify-live`
(§E) asserts that file is present after a real install, so the contract fails
the release gate rather than shipping quietly.

**`capability` takes a struct now.** A fourth positional `bool` next to three
others (`capability("linux", false, true, false)`) is a foot-gun with no
compiler help. `InstallEnv { os, is_appimage, apt_managed, scoop_managed }`
plus `InstallEnv::new(os)` makes every call site name what it is asserting:

```rust
capability(InstallEnv { scoop_managed: true, ..InstallEnv::new("windows") })
```

### C. `pgit` on a Scoop install, without a second shim

#187 says "Scoop shims the executable itself" and leaves it there. That is half
the story, and the missing half breaks an existing invariant.

`cli.rs::shim_status` answers *"is a `pgit` present and does it launch this
app"*, scanning for a file literally named `SHIM_NAME` — `pgit.cmd` on Windows
— and classifying what it finds as `App`, `Package` or `Foreign`. `install_shim`
refuses to write a second copy when a package already ships one (spec
`2026-08-17-pgit-cli-packaging-spec.md` §A: three parties may own `pgit` and
they must not fight).

A manifest whose `bin` lists only `platypusgit.exe` would therefore:

- give the user **no `pgit` at all**, the one thing #187's title asks for on
  Windows, and
- make Settings → Command line offer an install, writing a **competing**
  `pgit.cmd` into `%LOCALAPPDATA%\PlatypusGit\bin` and appending that to the
  user's PATH — a shim Scoop does not know about and will not remove on
  uninstall.

So the zip ships `pgit.cmd` and the manifest names it:

```json
"bin": ["platypusgit.exe", "pgit.cmd"]
```

Scoop shims a `.cmd` target with a generated `.cmd` of its own in
`<root>\shims`, which is the directory Scoop puts on PATH — so that entry is
what gives the user `pgit`.

**What makes the app itself classify it correctly is simpler, and does not
depend on Scoop's shim internals at all.** `shim_status` probes
`package_shim_paths_for`, whose first entry is `exe_dir/pgit.cmd` — and on a
Scoop install that is the zip's own `pgit.cmd`, sitting beside the exe. It is
read as text, `references_app` matches `MAIN_BINARY` in
`"%~dp0platypusgit.exe" %*`, and its directory is not one of ours, so:
`Package`. Settings offers no install, writes nothing, and `scoop uninstall`
removes every trace. Scoop's generated shim would classify the same way if the
PATH scan reached it, but it never has to.

One consequence worth stating so it is not read as a bug later: that sighting's
`path_state` is `OffPath`, because `…\apps\platypusgit\current` is genuinely
not on PATH — Scoop's `shims` directory is. It is not rendered: `Settings.tsx`
passes `null` to `PathNote` whenever the shim is package-owned, precisely
because where a package put its file is not the user's problem. No code change
is needed for this, and none should be made to "fix" the value.

The classification is load-bearing, so it is pinned with a unit test carrying
the zip's real `pgit.cmd` body and a Scoop-shaped path.

**The zip's `pgit.cmd` is relative, unlike every other one we ship.**
`cli.rs::shim_cmd_body` writes an absolute path to the exe, which is right for
a shim the app writes at a known install path. A file inside a zip knows
neither, and Scoop's `current` junction means an absolute path would be wrong
after the next `scoop update` anyway. The zip's copy is therefore
`@"%~dp0platypusgit.exe" %*` — resolved against the `.cmd`'s own directory.
`shim_installed_at` compares bodies byte-for-byte, but only for shims the *app*
wrote, so the two forms do not collide.

### D. The manifest, and who writes it

`scripts/scoop-manifest.sh` renders the whole manifest from `--version`,
`--url` and `--hash`. One generator, in this repository, for the same reason
`apt-repo-publish.sh` is: the artifact users consume is reviewable here, runs
locally, and cannot drift from a second copy in the bucket repo.

```json
{
  "version": "0.1.0",
  "homepage": "https://www.platypusgit.com",
  "license": "GPL-3.0-only",
  "architecture": { "64bit": { "url": "…/releases/download/v0.1.0/PlatypusGit_x64_portable.zip", "hash": "…" } },
  "bin": ["platypusgit.exe", "pgit.cmd"],
  "shortcuts": [["platypusgit.exe", "platypusgit"]],
  "checkver": { "github": "https://github.com/jonassaa/platypusgit" },
  "autoupdate": { "architecture": { "64bit": { "url": "…/releases/download/v$version/PlatypusGit_x64_portable.zip" } } }
}
```

Four decisions inside it:

- **The URL is the tag URL, not `releases/latest/download`.** Every other
  channel deliberately uses the stable-named latest path so the Homebrew cask
  can track it. A Scoop manifest pins a `hash` to a specific build, and
  `releases/latest/download/…` *moves* on the next release — the manifest would
  then hash-mismatch every install between a release and the next bump. Tag URL
  and hash move together, in one commit.
- **`architecture.64bit`, not top-level `url`/`hash`** — see Scope: arm64
  becomes a key, not a rewrite.
- **`shortcuts`** because this is a GUI app; without it a Scoop install has no
  Start Menu entry and the only launch route is a terminal.
- **`checkver`/`autoupdate` stay even though CI pushes the bump.** They cost
  nothing, they are what a bucket is conventionally expected to carry, and they
  are the fallback if a release ever lands without `bump-scoop` running (the
  prerelease-promotion gap the release workflow's runbook comment describes is
  exactly that case).

### E. `bump-scoop`, and a real install as the gate

`bump-scoop` mirrors `bump-cask` step for step — same `if:` prerelease gate,
the same GitHub App (`vars.TAP_APP_ID` / `secrets.TAP_APP_PRIVATE_KEY`) scoped
to one more repository, the same fail-loudly-on-an-empty-hash guard, the same
`github-actions[bot]` attribution. **No new secret**, which is most of why
Scoop is the cheap piece.

`scoop-verify-live` then does on Windows what `apt-verify-live` does on Linux:
after the push, a clean `windows-latest` runner installs Scoop, adds the
bucket, installs the package, and asserts

- the app directory holds `platypusgit.exe` and `pgit.cmd`,
- `manifest.json` is beside them — the §B detection contract,
- `scoop which pgit` resolves into the shims directory,
- `scoop list` reports the version just published.

It deliberately does **not** run `platypusgit --version`: the Windows binary is
GUI-subsystem, so its stdout is not attached to the runner's console and the
check would be a coin flip rather than a gate.

A second, cheaper gate lives in the `windows` build job itself: extract the zip
just built and assert the three files are there and that `pgit.cmd` names the
exe. It catches a broken asset before it is ever attached, on the machine that
made it.

### F. State outside this repository

Exactly one new external thing: the bucket repo, `jonassaa/scoop-platypusgit`,
with the existing GitHub App installed on it. No DNS record, no Pages site, no
signing key, no second secret — the apt repo needed all four, and that
asymmetry is the whole "cheapest remaining win" argument.

`scripts/scoop-bucket-wizard.sh` walks it (create, seed, install the App,
verify a push, verify the first publish), idempotent and `--dry-run`-able, the
same shape as `apt-repo-wizard.sh`. Until it has been run, the download page's
`scoop bucket add` line names a repository that 404s — the same window #267
accepted for `apt.platypusgit.com`, and the reason the wizard exists.

**The bucket starts empty of manifests.** The seed is a README and a `bucket/`
directory; the first `bump-scoop` writes `bucket/platypusgit.json`. Seeding a
hand-made manifest would mean publishing a `hash` for an asset that does not
exist yet — the portable zip first appears in the next release — and a bucket
whose only manifest fails to install is worse than a bucket with none.

### G. The page and the README

- `site/src/data/site.ts` gains `scoop` (bucket URL, bucket name, package name)
  and `assets.windowsPortableZip`, so the page, the manifest generator's
  defaults and the README cannot drift.
- The Windows card on `download.astro` leads with the two-line Scoop install,
  keeps the `.msi` button beside it, and its "there is no winget or Chocolatey
  package today" note becomes true again by naming Scoop as the one that does
  exist.
- `pgitMatrix` gains a Scoop row (`ships: true` — §C), and the Windows
  `specs` list stops implying the `.msi` is the only route.
- **The README's Windows lines and one Status bullet.** #271 landed a full
  README pass mid-flight — it had already replaced the stale Linux install
  section, so this change keeps that text untouched and adds only the Scoop
  route beside the `.msi`.

  One bullet it wrote does need correcting rather than extending: *"No `winget`
  or `scoop` yet — **both** wait on that code signing"*. Scoop never waited on
  code signing, and nothing here required a certificate; only winget does,
  because only winget's route is an installer that SmartScreen judges. Leaving
  it would attribute a blocker to the piece that just shipped without one. The
  `.msi` line's "the first Windows install is a manual download" goes for the
  same reason: it is now a one-liner too.

## Rejected alternatives

- **A Scoop manifest wrapping the `.msi`** (`installer.script` + `msiexec`) —
  §A. Elevated, per-machine, and un-uninstallable by Scoop.
- **Reading `$env:SCOOP` to detect a Scoop install** — §B. Wrong for
  `SCOOP_GLOBAL`, and set for *any* Scoop user rather than for *this install*,
  so an MSI install on a machine that also uses Scoop would be told to
  `scoop update` something Scoop does not have.
- **Leaving Windows on `SelfUpdate` and letting the updater win** — §B. Two
  copies, silently.
- **A `pgit`-only `bin` entry, or no `pgit` at all** — §C. Either no CLI, or a
  competing shim.
- **Publishing the portable zip on the download page as its own install
  route.** It would create a class of user with no package manager *and* no
  installer, whose self-update lands a second copy in Program Files — the §B
  failure with none of the §B detection. The asset exists for Scoop; the page
  offers the `.msi` and Scoop.
- **winget in this change** — Scope.

## Verification reality

Stated plainly, because it bounds what this change can claim:

- **No Windows machine is in the loop while writing this.** Everything Windows
  is verified by CI, not locally.
- **The zip smoke runs on the real `windows-latest` runner** at build time, so
  a malformed asset fails before it is attached.
- **`scoop-verify-live` is the real proof, and it first runs on the first
  release cut after this merges.** A manifest field name that Scoop rejects
  would surface there, not in review. That is why the manifest is minimal and
  conventional, and why the bucket is seeded empty (§F) rather than with a
  guessed manifest.
- Everything that can be verified without Windows is: the manifest generator
  runs locally, `is_scoop_layout` is pure and unit-tested on macOS, the shim
  classification is pinned with a real Scoop shim body, and the panel's Scoop
  hint is a component test.

## Follow-ups

- **winget** — the remaining #187 item, gated on bundle code signing.
- **`.rpm` + a dnf repo**, and an AUR `platypusgit-bin` — already recorded as
  apt follow-ups; unchanged by this.
- **arm64 Windows** — same shape as #266 for Linux; the manifest is already in
  the form that accepts it.
