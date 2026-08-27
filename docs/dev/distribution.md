# Distribution — pgit CLI, launch detach, permissions

Part of the `docs/dev/` set (`architecture`, `testing`, `frontend`, `backend`,
`distribution`). `test/docs.test.ts` reads this set together with CLAUDE.md.

## CLI packaging: `pgit` per channel (#144)

- **Where `pgit` lands:** Homebrew cask — a `binary` stanza symlinks the app
  binary; `.deb` — `/usr/bin/pgit` wrapper via `bundle.linux.deb.files`;
  `.msi` — `<INSTALLDIR>\pgit.cmd` + `INSTALLDIR` on the machine PATH via a WiX
  fragment. `.dmg` and AppImage have **no hook** (a drag-install runs no code)
  → Settings → Command line, plus installer scripts served at
  `https://www.platypusgit.com/install-pgit.sh` / `….ps1`.
- **Those URLs are a build-time COPY of `scripts/install-pgit.*`**
  (`site/scripts/copy-installers.mjs`, copies gitignored) — never a second
  committed file, and a plain byte copy (no templating). Consequences:
  `site.yml` must keep running `pnpm build` (not `astro build`), and its
  `paths:` filter lists `scripts/install-pgit.*` so editing an installer
  redeploys the served copy.
- The download page presents the split: package-channel users are never told to
  run a script (`plan_install` refuses the `package` shim anyway); the
  one-liner ships beside a link to the script and a
  download-then-inspect-then-run form.
- **Three parties can own `pgit`, and `shim_status` says which:**
  `CliShimSource` = `app` / `package` / `foreign` / `none`; `installed` means
  present AND launches this app. **A `package` shim is never overwritten and
  never offered for overwrite** — enforced in `plan_install`, not only the UI.
- Scan order is our dirs → known package paths → PATH (Reinstall depends on
  ours-first; "what would a shell run" is `pathState`). Recognition needs three
  probes: a symlink to `current_exe()`, a symlink named after the binary, a
  wrapper script mentioning it (why the deb wrapper spells its target
  absolutely). Text reads capped at 4 KiB; non-UTF-8 counts as "no".
- On an Intel Mac, Homebrew's prefix IS `/usr/local/bin` (our first shim dir),
  so a cask symlink classifies `app` — accepted: `plan_install` returns
  `KeepExisting` when the link already points at us.
- **macOS installs need no sudo:** `shim_dirs_for` is ordered and
  `install_shim` takes the first it can write — attempting the write IS the
  writability test (a probe adds a TOCTOU). `/usr/local/bin` first (the only
  default-PATH entry); fallback `~/.local/bin` with the off-PATH state
  *reported* with the fixing line, never hidden.
- **The Windows PATH write is PowerShell on purpose:** `setx` truncates at 1024
  chars and writes the merged machine+user PATH into the user PATH; a bare
  `SetEnvironmentVariable` rewrites `REG_EXPAND_SZ` as `REG_SZ`. Read with
  `DoNotExpandEnvironmentNames`, write back with `GetValueKind`'s answer. The
  directory travels in `PGIT_BIN_DIR`, never argv.
- **Four traps in `src-tauri/wix/pgit-cli.wxs`** (documented in the file): no
  doubled `{{` anywhere (the bundler renders fragments through Handlebars and
  discards the result — malformed fails the build, well-formed is silently
  dropped); the `$(var.Win64)` preamble is COPIED (candle defines are per
  source file); `Source` uses `$(sys.SOURCEFILEDIR)` (candle's cwd is the wix
  target dir); `light` runs without `-sval`, so ICE validation is live — match
  `main.wxs`'s component shapes.
- The exec bit on `/usr/bin/pgit` survives the bundler — verified in source:
  git stores `100755`, `fs::copy` keeps permission bits, tar-rs's
  `Deterministic` mode propagates user-exec on Unix (its Windows branch does
  not, but the `.deb` builds on ubuntu-22.04). `deb/postinst` stays minimal —
  **a postinst exiting non-zero fails `dpkg -i` for the whole package.**
- **Uninstall needs no code:** each channel's remover deletes what it shipped;
  deliberately no `postrm` and no uninstall command.
- **`release.yml` is untouched** — all additive bundle config. `bump-cask`'s
  two `sed` anchors (`^  version "`, `^  sha256 "`) don't match the `binary`
  stanza.
- Test seams (`PGIT_APP_SEARCH_ROOT`/`PGIT_UNAME` in `install-pgit.sh`,
  `PGIT_POSTINST_PREFIX` in `deb/postinst`) exist because three of five
  channels cannot run on a developer machine. Nothing in normal use sets them.
- **`scripts/install-pgit.sh` stays `curl … | sh`-safe:** POSIX `sh`,
  `set -eu`, and it never reads stdin (stdin IS the script — no prompts; every
  choice is a flag or env var). Watch `set -e` around `[ … ] && cmd` as a
  function's last command, and feed loops from here-docs when they assign outer
  variables.

## The `pgit` launch detaches — except where it must not (#163, #197)

- **`pgit .` hands the prompt straight back**, like `code .`. The detach is in
  the BINARY (`detach.rs`, one call site in `lib.rs::run`) — two shim shapes
  are symlinks to the executable, and macOS has no `setsid`.
- **`Parsed::Askpass` must never detach — the whole risk of the feature:** git
  execs this binary as `GIT_ASKPASS` and reads the credential from stdout
  synchronously; a detaching askpass hands git an empty credential and every
  authenticated op fails with nothing traceable. `should_detach` answers yes
  for `Parsed::Launch` only, and refuses while `ASKPASS_MODE_ENV` is set (a
  prompt string parses as a path). `Parsed::Help` stays synchronous too.
- `GIT_ASKPASS` points at the bare executable, never the `pgit` shim — askpass
  is exec'd directly and cannot carry arguments, and the shim now detaches.
- **It re-execs; it does not `fork()` and carry on** — macOS forbids
  CF/AppKit/XPC use in a forked, non-exec'd child, and the child IS the GUI.
  cwd is passed explicitly (`parse_args` resolves `pgit ../other-repo` against
  it).
- Gated on stdout being a terminal, so Finder, the Dock, `.desktop` entries and
  the e2e harness's pipes are untouched. `pgit . > file` blocks, by design.
  Windows deliberately unchanged: the GUI-subsystem binary already returns in
  cmd/PowerShell, and Git Bash's MSYS pipe fails `IsTerminal` anyway.
- **A dev build never detaches, whatever the arguments say (#197).** `tauri dev`
  inherits the developer's terminal to the app it spawns, so the tty gate says
  yes — and the parent exiting 0 is how the CLI learns the app closed: it stops
  the vite dev server that a dev build's webview loads `devUrl` from, leaving a
  `setsid`'d orphan pointed at a closed port. It reads as `tauri dev` returning
  instantly and the window never painting. The term is `tauri::is_dev()`
  (`!cfg!(feature = "custom-protocol")`), which is the exact condition and not a
  proxy: the same flag chooses `devUrl` over the embedded assets. `cargo run`
  stays in the foreground for the same reason; the e2e build sets
  `tauri/custom-protocol` and is unchanged (its stdio is a pipe anyway).
- `tests/cli_detach.rs` drives the real binary through a **pty** for the
  must-stay-synchronous paths and `git credential fill` (offline) for the
  credentialed one — a pure-function test cannot show git still gets its
  answer.

## The update check is opt-out, and the gate is in the store (#237)

`updateCheckMode` (`PersistedState`, default `"auto"`) decides whether the app
asks GitHub about a newer release: `auto` (startup check, today's behaviour),
`manual` (nothing automatic; Settings → "Check for updates" still works), or
`never` (no request from any path — the Settings button renders disabled and the
titlebar `UpdateChip` is hidden).

Three modes, not a toggle, because `manual` and `never` promise different things:
`manual` is about controlling the *timing*, `never` is for a locked-down,
offline, or blocked-endpoint machine where even an accidental click must produce
no outbound traffic — and for users who read "no telemetry, no account" as
covering the update endpoint too. Switching out of `never` is one click in the
same row, so it is not a dead end.

Two things are load-bearing about *where* this lives:

- **The gate is inside `useUpdateStore.check()`, not at the `AppShell` call
  site.** `check()` already takes `manual`, so it can decide before touching
  `checkForUpdate()`: an automatic check needs `auto`, a manual one needs
  anything but `never` (`checkAllowed`, pure and exported). Settings, the command
  palette and the keymap all reach `check()`; gating only at the startup call
  site would leave three paths able to spend a request the user switched off.
  `src/features/update/updateCheckMode.test.ts` asserts `checkForUpdate` is
  never **called** — a request whose result is discarded still hits the network.
- **The last-checked timestamp is NOT in `PersistedState`.** It lives beside
  `dismissedVersion` under the update store's own `pg-update-last-checked` key.
  `PersistedState` is the portable-preferences bag that #254 exports to a
  shareable JSON file, and a per-machine "when did this install last look" is
  state, not a preference. It also only advances on a *completed* check: a
  timestamp that moved on an offline failure would read as "checked fine just
  now" on exactly the machine whose updater is stuck.

The per-version snooze (`dismissedVersion` / `shouldNag`) is orthogonal and
unchanged — that is "not this release", not "not ever".

## Permissions (Tauri 2)

- Shared permissions in `src-tauri/capabilities/default.json`: `core:default`,
  window minimize/toggle-maximize/close/start-dragging/set-title, webview
  create-webview-window + set-webview-zoom (the `view.zoom*` chords),
  `dialog:default` + `dialog:allow-open`, `os:default`, `log:default`. Scoped
  `windows: ["main", "merge"]`.
- **Self-update permissions are narrower:** `updater:default` +
  `process:allow-restart` live in `src-tauri/capabilities/updater.json` with
  `windows: ["main"]` — the merge resolver must not be able to swap the binary
  or relaunch mid-conflict. Keep new privileged permissions out of the shared
  capability unless both windows genuinely need them.
- **E2E-only permissions** (`core:window:allow-set-focus` +
  `wdio-webdriver:default`) live in the inline `e2e-focus` capability in
  `src-tauri/tauri.e2e.conf.json`, loaded only via `--config`; the
  `tauri-plugin-wdio-webdriver` crate is an optional dep behind the `e2e` cargo
  feature — never compiled into or permitted in dev/production builds.
- New plugin: `cargo add tauri-plugin-X`, `pnpm add @tauri-apps/plugin-X`,
  register `.plugin(tauri_plugin_X::init())` in `lib.rs`, add its permissions
  to the capability file.

## App icons — one master, transparent, regenerated (#206)

- **`src-tauri/icons/app-icon.svg` is the master.** Every raster in
  `src-tauri/icons/` (`icon.icns`, `icon.ico`, `32x32.png`, `128x128.png`,
  `128x128@2x.png` — the five `bundle.icon` entries — plus `icon.png`, `64x64`
  and the Windows-Store `Square*Logo`/`StoreLogo` set) is generated from it. Do
  not hand-edit a raster; re-render the master. **`src-tauri/icons/` holds
  exactly two hand-authored files — `logo.svg` and `app-icon.svg`; everything
  else there is output.** Keep it that way: the directory used to also carry
  `logo-bg.png`, `logo-256.png` and `logo-32.png`, unreferenced renders left
  from the initial release, and the stale framing they froze was a trap for
  anyone who grabbed one for a README.
- **It is a different file from `logo.svg` on purpose.** `logo.svg` is the
  24×24 in-app brand mark, kept coordinate-identical to `src/design/logo.tsx`
  (pinned by `logo.test.tsx`) and copied to `public/` and `site/public/`.
  `app-icon.svg` is the same paths under a tighter `viewBox` (`3 3 18 18`, a
  5.6% safe margin) because a platform icon has no surrounding chrome to sit
  in. Changing the mark means editing both.
- **No background plate.** The original set was a full-bleed `#1c2020` square
  with the head at ~42% of the canvas, which read as a dark box in the Dock and
  taskbar. Transparent + cropped puts the head at ~89% of the canvas and lets
  it sit on whatever the OS paints behind it. Both fills stay legible on light
  and dark; the eyes are inside the teal head, never on the backdrop.
- **Regenerate:**

  ```bash
  inkscape --export-type=png --export-width=1024 --export-height=1024 \
    --export-filename=/tmp/app-icon-1024.png src-tauri/icons/app-icon.svg
  pnpm tauri icon /tmp/app-icon-1024.png
  rm -rf src-tauri/icons/android src-tauri/icons/ios   # desktop-only app
  ```

  `tauri icon` also emits iOS/Android sets this project does not ship — drop
  them, they were never tracked.
- **Verify transparency, don't eyeball it.** A PNG can carry an alpha channel
  and still be fully opaque (the old set did: `hasAlpha: yes`, every corner
  `α=255`). Check a corner pixel's alpha, and check `.icns`/`.ico` members too
  — `iconutil -c iconset` unpacks the former, the latter is a container of
  PNGs.

## The MSI's registry identity — pinned for winget

Two `bundle` fields in `tauri.conf.json` exist only to control what the `.msi`
writes into the Windows registry. Both were added because the Windows Package
Manager reads that registry entry back and refuses to guess.

- **`bundle.publisher: "Jonas Aasberg"`.** Unset, the bundler does *not* fall back
  to the Cargo `authors` — it splits the bundle identifier and takes the second
  segment (`settings.rs`, `msi/mod.rs`):

  ```rust
  let manufacturer = settings.publisher()
    .unwrap_or_else(|| bundle_id.split('.').nth(1).unwrap_or(bundle_id));
  ```

  `io.github.jonassaa.platypusgit` → **`github`**. Every `.msi` up to and
  including v0.1.1 therefore shipped with `Publisher: github` in Add/Remove
  Programs and its shortcut bookkeeping under `HKCU\Software\github\platypusgit`.
  That is wrong on its own, and it is disqualifying for winget: a manifest's
  `AppsAndFeaturesEntries.Publisher` must match what the installer actually
  wrote, so the manifest would have had to claim `github` as the publisher —
  straight into a trademark/impersonation review.

  Setting it moves the HKCU key to `Software\Jonas Aasberg\platypusgit`. That
  key holds only shortcut flags and a `PrevInstallDir` search, and the default
  install location is unchanged, so an upgrade over an older MSI still lands in
  the same place. It does **not** touch the `UpgradeCode`.

  **It is a person's name, not the brand, and that is the constraint talking.**
  Tauri's Microsoft Store page states *"Your application publisher name cannot
  match the application product name"* and points at `bundle.publisher` as the
  fix. `productName` is `platypusgit`, so `"platypusgit"` — the obvious choice,
  and the one the winget precedent (`GitButler.GitButler`) suggests — is exactly
  the pair Tauri documents as invalid. It shipped that way for one commit (#278)
  before `docs/superpowers/specs/2026-08-27-microsoft-store-research.md` caught
  it, and the window to change it closes the moment a release carries it into
  users' registries. `msi_identity.rs` now fails on the collision.

- **`bundle.windows.wix.upgradeCode`.** Pinned to
  `8E03762C-0A45-5879-AB93-77EB9C468C68` — **the value the derivation was
  already producing**, confirmed with `pnpm tauri inspect wix-upgrade-code`
  before and after (it prints both the derived default and the override, so the
  no-op is visible in one line). Pinning is therefore invisible to anyone who
  already installed v0.1.x, and from here a `productName` change can no longer
  orphan their install.

**The `ProductCode` is not pinnable and must not be** — Tauri's `main.wxs` uses
`<Product Id="*">`, so it regenerates on every build. Anything that needs it
(a winget manifest does) has to read it out of the released `.msi`, never
predict it.

The MSI is **`InstallScope="perMachine"`**, hardcoded in the bundler's
`main.wxs` — not configurable. That is why `wix/pgit-cli.wxs` can write the
machine PATH, and why a winget manifest for this app is `Scope: machine`.

## The APT repository — one-line Linux install (#187)

Spec: `docs/superpowers/specs/2026-08-26-apt-repository-spec.md`. Read that for
the *why*; this is the operational summary.

- **Where it lives.** `jonassaa/apt-platypusgit` + GitHub Pages, served at
  `apt.platypusgit.com`. It holds **no workflows and no code** — Pages serves it
  off the branch. It **cannot** live in the marketing site: `site.yml` uploads
  `site/dist` as the whole Pages artifact, so every site deploy would delete a
  pool the release job had pushed. And the pool cannot point at GitHub release
  assets either — apt resolves `Filename:` relative to the repository root.
- **Three scripts, all in `scripts/`.** `apt-repo-publish.sh` (pool add + prune
  + index + sign), `apt-repo-smoke.sh` (serve + install in a container +
  assert), `install-platypusgit.sh` (the user-facing one-liner). `release.yml`'s
  `apt-publish` job calls the first two; `apt-verify-live` calls the second
  against the live host. Keeping the logic in reviewable scripts rather than in
  YAML is what makes it testable on a laptop.
- **Stateless index.** No `aptly`, no `reprepro`: the pool directory IS the state
  and git IS the history, so the index is a pure function of the pool and a
  re-run reproduces it. `workflow_dispatch` against an existing tag is therefore
  a genuine no-op.

### Four traps, all of them measured

1. **`Release` must be generated OUTSIDE `dists/<suite>/`.** Deleting the old one
   is not enough — the shell redirect recreates the file inside the directory
   `apt-ftparchive` walks, and it streams its output, so it hashes the header it
   already flushed and `Release` lands in its own checksum list. Write to
   `mktemp`, then move. The script refuses to publish a self-referential
   `Release`.
2. **`gzip -n`.** Without it the gzip header carries a timestamp, `Packages.gz`
   differs every run, and the no-op short-circuit is dead code.
3. **Idempotency is decided on `Packages`, never on the tree.** `apt-ftparchive
   release` stamps a `Date:`, so `Release` always differs. The job compares the
   freshly generated `Packages` and, if identical, leaves the whole tree alone.
4. **The smoke client must be `--platform linux/amd64`.** We ship amd64 only, so
   an arm64 client (the default on an Apple Silicon Mac) verifies the signature,
   fetches `Packages`, and then says "Unable to locate package" — which reads as
   a broken repository rather than a wrong architecture.

### Deliberate non-expiry

**No key expiry and no `Valid-Until`.** Both are the same trap: an expired
signing key or `Release` file is a *silent, global `apt update` failure* for
every existing install, and extending a key's expiry changes it so every client
needs the new copy. Revocation is the tool for a compromise — hence the
revocation certificate the wizard generates. The cost, accepted knowingly: no
freeze/replay protection beyond HTTPS.

Nothing needs periodic re-signing, precisely *because* there is no
`Valid-Until`.

### The contract nobody can see from one side

`/etc/apt/sources.list.d/platypusgit.sources` is written by
`install-platypusgit.sh` and read by `update::capability`
(`update.rs::APT_SOURCES_PATH`) to tell an apt-managed `.deb` from a sideloaded
one. Two files, two languages, one string. A Rust test pins the constant and the
smoke gate asserts the path exists after a real install, so a drift fails CI
rather than silently telling every apt user to go download a file by hand.

### Package naming, and what `productName` actually controls

The Debian package is **`platypusgit`**.

**`productName` is lowercase on purpose, and it is load-bearing.** Tauri derives
the Debian `Package:` field from it — `tauri-bundler/src/bundle/linux/debian.rs`:

```rust
let package = heck::AsKebabCase(settings.product_name());
```

`DebConfig` has no name override, so the *only* lever is `productName`. It was
`"PlatypusGit"`, whose internal capital is a word boundary, so kebab-casing
produced `platypus-git`. Lowercase maps straight through — and it matches how the
project brands itself everywhere else (`site/src/data/site.ts` has
`name: 'platypusgit'`).

`provides` + `replaces` + `conflicts` all name the **old** `platypus-git`, so a
sideloaded install of an older `.deb` upgrades cleanly instead of hitting a dpkg
file conflict — both packages own `/usr/bin/platypusgit`. `provides` also keeps an
older `apt install platypus-git` working. Note a virtual name **installs without
reporting**: `apt policy platypus-git` shows no candidate, which is why
`platypusgit` is the name the page and the app print.

**Everything else `productName` renames, and who has to follow:**

| Renamed | Consequence |
| --- | --- |
| macOS `platypusgit.app` | The **Homebrew cask must change in the same release** — its `app`, `binary` and `postflight` stanzas all name the bundle, and `bump-cask` only rewrites version + sha256. That job now cross-checks the cask's `app` stanza against `productName` and **fails the release** on a mismatch, because the alternative is discovering it when `brew install` breaks for every macOS user. |
| `scripts/install-pgit.sh` | Searches BOTH `platypusgit.app` and `PlatypusGit.app`. It exists to serve an already-installed app, so dropping the old name would break the `pgit` one-liner for existing users. |
| `.desktop` file | `platypusgit.desktop`. No consumer in this repo. |
| Windows `UpgradeCode` | **No longer** — it is now pinned in `tauri.conf.json` (see below), so `productName` has stopped being load-bearing for MSI upgrades. It *was* derived as `Uuid::new_v5(NAMESPACE_DNS, "<productName>.exe.app.x64")` (`bundle/windows/msi/mod.rs`), which meant a rename **broke in-place MSI upgrades** — the new installer landed alongside the old. |

**Not** renamed, deliberately: the release assets (`PlatypusGit_amd64.deb` and
friends) are stable names the cask and `latest.json` track, decoupled from the
bundler's output by a `cp` in `release.yml`; the Windows shim directory
`%LOCALAPPDATA%\PlatypusGit\bin` (`cli.rs`), because renaming it orphans an
existing PATH entry; and the in-app display strings (window title, Welcome hero,
logo label), which are a separate branding decision.

The binary is `platypusgit` either way — it comes from the Cargo package name,
not `productName`, so `/usr/bin/platypusgit`, `platypusgit.exe` and the e2e
snapshot are all unaffected.

`depends` in `tauri.conf.json` **appends to** the bundler's auto-detected libs —
the merge is in `tauri-cli` (`interface/rust.rs`, `depends_deb` is seeded from
config then pushed onto), not in `tauri-bundler`'s `debian.rs`, which reads the
already-merged list and looks like it replaces. Getting that backwards ships an
uninstallable package.

### Running it locally

macOS has neither `apt-ftparchive` nor `gpg`, so the publish script re-execs
itself in a container with `--docker`. A full loop:

```bash
# a throwaway key (gpg lives in the container, not on the host)
docker run --rm -v "$PWD/fixtures:/out" debian:bookworm sh -c '...gen-key...'

export APT_GPG_PRIVATE_KEY="$(cat fixtures/test-private.asc)"
export APT_GPG_PASSPHRASE=testpass
scripts/apt-repo-publish.sh --repo /tmp/aptrepo --deb PlatypusGit_amd64.deb \
    --version 0.0.17 --docker

scripts/apt-repo-smoke.sh --repo /tmp/aptrepo --version 0.0.17 \
    --installer scripts/install-platypusgit.sh
```

Drop `--installer` for the isolation mode (a hand-written sources file), which
answers "is the index broken, or is the installer broken?". Add `--expect-git`
when the `.deb` was built after the `Depends: git` change. To prove the gate can
fail, corrupt a byte of `InRelease` and re-run — expect `BADSIG` and exit 100.

### Release-time notes

- `apt-publish` reuses `vars.TAP_APP_ID` / `secrets.TAP_APP_PRIVATE_KEY`. Those
  names now cover **two** repos; the App must be installed on
  `apt-platypusgit` with Contents: write.
- Its `if:` gate is **copied** from `bump-cask`, not retyped. A typo there
  pushes a prerelease into a signed index that every client discovers on its
  next `apt update`.
- **A prerelease never reaches apt.** Same gate as `bump-cask` and
  `updater-manifest`: the `.deb` is attached to the GitHub release and stays
  invisible to `apt upgrade`. That is correct, and it is not a bug report.
- The pool keeps the **newest 10** releases and logs what it pruned. Older
  `.deb`s remain on GitHub Releases.
- A `workflow_dispatch` against a tag built **before** the `Depends: git` change
  fails the pre-push gate, by design.

### The manual setup

`scripts/apt-repo-wizard.sh` walks the eight steps that live outside this repo
(repo, key, seed, DNS, Pages, secrets, App install, fingerprint). Interactive —
never piped into a shell. `--dry-run` prints the walk and changes nothing. It is
run **by the user**: it creates a public repository, edits DNS, and installs a
GitHub App.

## The Scoop bucket — one-line Windows install (#187)

Spec: `docs/superpowers/specs/2026-08-27-scoop-bucket-spec.md`. The apt
section's Windows twin, and much smaller: **no new secret, no host, no signing
key, no DNS.** One repository plus the App the Homebrew tap already uses.

- **Where it lives.** `jonassaa/scoop-platypusgit`, holding only
  `bucket/platypusgit.json` and a README. `scoop bucket add` clones a git repo,
  so unlike apt there is nothing to serve.
- **Scoop installs a portable `.zip`, never the `.msi`.** Scoop's msi handling
  is a deprecated path, and an `msiexec` install is per-machine and elevated —
  which destroys the three properties Scoop was chosen for (per-user, no admin
  prompt, clean uninstall). `release.yml`'s `windows` job therefore builds
  `PlatypusGit_x64_portable.zip` (`platypusgit.exe` + `pgit.cmd` + `LICENSE`, at
  the zip **root**) and exports its `sha256`.
- **`scripts/scoop-manifest.sh` renders the manifest**, the way
  `apt-repo-publish.sh` builds the index: the artifact users install from is
  reviewable here and runs on a laptop. `bump-scoop` calls it; nothing patches
  a committed manifest in place.
- **The manifest URL is the release *tag* URL**, not
  `releases/latest/download/…` like every other channel. A Scoop `hash` pins one
  specific build, and the stable path moves on the next release — pointing there
  would hash-mismatch every install between a release and its bump.

### Three traps, and why each is load-bearing

1. **`pgit.cmd` ships inside the zip and is named in `bin`.** Not a convenience:
   `cli.rs::shim_status` probes `exe_dir/pgit.cmd` before it scans PATH, and
   finding it is what classifies a Scoop install as `CliShimSource::Package`.
   Without it the user gets no `pgit` **and** Settings offers to write a
   competing shim into `%LOCALAPPDATA%` that Scoop neither knows about nor
   removes. Its body is **relative** (`%~dp0platypusgit.exe`) where
   `shim_cmd_body`'s is absolute, because Scoop re-points the `current` junction
   on every update. `cli.rs::PORTABLE_SHIM_CMD` includes the shipped bytes and a
   test pins the classification.
2. **A Scoop install must NOT self-update.** `update::capability` returned
   `SelfUpdate` for Windows unconditionally; self-updating here runs the
   per-machine `.msi`, so the box ends up with the new copy in Program Files
   **and** Scoop's old one still on PATH and still behind the Start Menu
   shortcut, with `scoop list` wrong forever. Hence `NotifyScoop`, detected by
   `update::is_scoop_layout` (the exe sits in `apps/<CARGO_PKG_NAME>/<version>`)
   **plus** one `Path::exists` for Scoop's own `manifest.json` beside it. Never
   `$env:SCOOP`: it is relocatable, wrong for `SCOOP_GLOBAL`, and set for anyone
   who uses Scoop *at all* — so an `.msi` install on a Scoop user's machine would
   be told to `scoop update` a package Scoop does not have.
3. **`scoop-verify-live` needs `-RunAsAdmin`.** GitHub's `windows-latest` user is
   in the Administrators group and Scoop's installer refuses to run elevated by
   default, so without the flag the gate fails on every release. It is a CI-only
   flag — never advice to pass on to users, who are not elevated. Scoop's PATH
   edit also has to be re-exported through `$GITHUB_PATH` to reach later steps.

### Verification, honestly

`cargo test`/`pnpm test` cover the pure parts (`is_scoop_layout`, the shim
classification, the panel's hint). The manifest and the install itself are
proven only by CI, in two places: the `windows` job expands the zip it just
built and asserts its shape, and **`scoop-verify-live` does a real
`scoop install` on a clean Windows runner** — asserting the payload,
`manifest.json` (the `update.rs` contract), the `pgit` shim, and the version.
That job is the first thing that has ever run this on Windows.

### The manual setup

`scripts/scoop-bucket-wizard.sh` walks the four steps outside this repo (create,
seed, App install, verify the first publish). Interactive, `--dry-run`-able, run
**by the user** — it creates a public repository. The bucket is seeded **empty of
manifests** on purpose: the first `bump-scoop` writes one, and a hand-seeded
manifest would carry a hash for an asset that did not exist yet.

## The Microsoft Store — MSIX

Spec: `docs/superpowers/specs/2026-08-27-msix-store-spec.md`; plan:
`docs/superpowers/plans/2026-08-27-msix-store-plan.md`. Read the spec for the
*why* — especially §E, which holds the one open question. This is the
operational summary.

**Why this channel exists at all:** Microsoft re-signs an MSIX submitted to the
Store, for free. It is the only Windows channel that removes the SmartScreen
warning without buying a $150–300/year certificate — the one distribution cost
this project has otherwise avoided entirely.

### Four Windows channels, one binary

The binary is identical in all four. What differs is packaging and who owns the
upgrade, which is exactly the axis `update::capability` expresses:

| Channel | Install shape | `capability` |
| --- | --- | --- |
| `.msi` direct download | per-machine installer | `SelfUpdate` |
| Scoop bucket | portable zip in Scoop's tree | `NotifyScoop` |
| winget | the same `.msi` | `SelfUpdate` |
| **Store MSIX** | **read-only package** | **`NotifyStore`** |

**`NotifyStore` is matched FIRST among the Windows arms, and that order is
load-bearing.** Unlike every other notify variant it is not about giving better
advice: an MSIX is read-only after deployment and Windows *refuses to launch a
package whose files were tampered with*, so a self-update here does not fail —
it leaves an app that will not start. If a future probe gets it wrong, this
order fails toward the answer with a broken app behind it rather than toward
`scoop update` on an install Scoop does not own.

**The probe is `update::is_msix_packaged`** — `GetCurrentPackageFamilyName`,
twelve lines of `extern "system"`, no new crate. **Deliberately not** a
"is the exe under `C:\Program Files\WindowsApps`" test: Microsoft documents that
packages install to other PackageVolumes and other paths. Same trap as
`$env:SCOOP`, rejected for the same reason — the question is *"was this install
packaged"*, and there is an API that answers exactly that.

### `makeappx` builds it; `winapp` is only for the local loop

`release.yml`'s **`msix`** job: two `--no-bundle` builds (x64 + arm64) →
`scripts/msix-pack.sh` per arch → `makeappx bundle` → shape gate → attach.

- **Not `winapp pack` in CI.** `winapp` documents Windows 11 as a prerequisite
  and `windows-latest` is Windows Server. `makeappx` ships with the Windows SDK
  already on the runner.
- **A separate job from `windows`**, so a broken manifest cannot take the `.msi`
  and the portable zip down with it. It references no `TAURI_SIGNING_*` secret:
  `--no-bundle` produces no updater artifact, and nothing here feeds
  `latest.json` because a Store install never self-updates.
- **`makeappx bundle` needs `/bv`.** Without it the bundle is stamped `0.0.0.0`,
  which is lower than anything already in the Store and is rejected as a
  downgrade. The inner packages carry the real version; the bundle must be told
  separately.
- **`webviewInstallMode: "skip"`** via `src-tauri/tauri.msstore.conf.json` — a
  package runs no bootstrapper. Evergreen WebView2 is preinstalled on Windows 11
  and arrives via Edge on Windows 10; `fixedRuntime` (~180 MB inside the package)
  is the fallback if that proves wrong, and is a deliberate later decision.

### `pgit` on a Store install — nothing in `cli.rs` changed

Two separate mechanisms, and conflating them is the trap:

1. **The `appExecutionAlias` in the manifest is what gives the user `pgit`.** An
   MSIX runs no installer, so `wix/pgit-cli.wxs` has nothing to hook here.
2. **`pgit.cmd`, staged into the package beside the exe, is what makes the
   install classify as `CliShimSource::Package`** — `shim_status` probes
   `exe_dir/pgit.cmd` before it scans PATH. That is what stops Settings offering
   to write a second, competing shim into `%LOCALAPPDATA%` that uninstalling the
   package would leave behind. It is byte-identical to the Scoop zip's copy
   (`src-tauri/windows/pgit-portable.cmd`, `cli.rs::PORTABLE_SHIM_CMD`).

**`path_state` reads `OffPath` on this channel, and that is correct.** The
package's own directory genuinely is not on PATH; the alias directory is.
`Settings.tsx` passes `null` to `PathNote` for any package-owned shim, so it is
never rendered. **No code change is needed for this and none should be made to
"fix" it** — the same note the Scoop section carries, for the same reason. An
earlier draft of the design proposed adding the alias directory to the Windows
package-paths table; that was wrong and is recorded as rejected in the spec.

### The manifest is a source file, and a guard keeps it honest

`src-tauri/windows/Package.appxmanifest` is hand-authored and committed, not
generated by `winapp init` — a generated manifest is a contract nobody can see
from one side, which is the shape of every packaging trap in this document.

`src-tauri/tests/msix_identity.rs` pins it against the rest of the tree (exe
name from Cargo, `DisplayName` from `productName`, `PublisherDisplayName` from
`bundle.publisher`, the alias, `runFullTrust`, the `uap10` version floor, and
that every `Assets\…` reference exists in `icons/`). Two of those guards exist
because they caught real bugs while being written:

- **XML comments cannot contain `--`.** Used as an em-dash it makes the manifest
  unparseable — which `makeappx` would have reported at release time, from a
  Windows runner, with the payload already staged.
- The asset check first swallowed half the manifest as a "filename", because
  `<Logo>Assets\…</Logo>` is element text while the tile logos are quoted
  attributes.

**Identity `Name` and `Publisher` stay `__MSIX_…__` tokens.** Partner Center
assigns them; `msix-pack.sh` substitutes them and refuses to pack if any token
survives, and a guard fails the build if a real value is committed. So a local
build can never quietly claim the Store identity.

`Wide310x150Logo` is deliberately absent: `icons/` holds only square renders and
the slot is optional.

### Verification, honestly

`cargo test`/`pnpm test` cover the pure parts (the `capability` arm and its
ordering, the packaged shim classification, the panel's hint, the manifest
guards). `msix-pack.sh --stage-only` makes the token substitution testable on a
Mac — the one step that must not be wrong is the one step needing no Windows.
CI proves the bundle *builds* and has the right shape.

**Six behaviours are NOT verified, and this channel should not be called done
until they are.** The local loop for five of them is `winapp run .\dist`, which
registers a loose-layout package and needs no certificate:

1. **`GIT_ASKPASS`** — git execs this binary and reads a credential from its
   stdout synchronously, and under MSIX that binary sits in a directory
   Microsoft describes as "heavily locked down". A successful *launch* proves
   nothing; test `git credential fill`. This is the highest risk in the channel.
2. **Whether the package is virtualized** (spec §E), which decides whether the
   app log and WebView2 `localStorage` move to a per-package private location.
   Until measured, assume the paths in this doc set may differ here.
3. **`pgit` from Git Bash / MSYS**, not merely cmd and PowerShell.
4. **Spawning `git.exe`** from inside a full-trust package.
5. **WebView2** on a clean Windows 10 with `webviewInstallMode: skip`.
6. **Whether the Store accepts the manifest** — restricted-capability
   justification, version format and runtime behaviour all meet reality for the
   first time at upload.

**One claim in the tree is unconfirmed:** that the MSIX version's fourth part
must be `0`. `msix-pack.sh` appends `.0` and says so in its own comment. Settle
it at the first upload and fix the script and spec §E together if it disagrees.

### The manual setup

`scripts/msstore-wizard.sh` walks the eight steps outside this repo.
Interactive, `--dry-run`-able, run **by the user** — step 1 is a government ID
check. It automates almost nothing by design; what it carries is the traps:

- **The fee-free account flow exists ONLY from `storedeveloper.microsoft.com`.**
  Reaching Partner Center any other way serves the legacy flow, which still
  charges $19.
- `runFullTrust` is a **restricted** capability: Partner Center requires a
  written justification.
- Policy **10.2.4** means the `git` dependency must be the **first line** of the
  Store description, not a footnote.
- Policy **10.5.1** requires a privacy policy URL for a Win32/Desktop Bridge
  product regardless of what it collects — hence `site/src/pages/privacy.astro`,
  served at `https://www.platypusgit.com/privacy`.

The one thing it does automate is the step where a typo is silent: it turns the
assigned identity values into the exact `msix-pack.sh` invocation. Those values
are never written to disk.
