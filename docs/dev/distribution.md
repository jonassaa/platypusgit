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

### Package naming

The Debian package is **`platypus-git`** — Tauri kebab-cases `productName` and
`DebConfig` has no override. `provides: ["platypusgit"]` makes the obvious guess
resolve too, but `platypus-git` is canonical everywhere we print it, because that
is what `apt search`, `apt remove` and `dpkg -l` use.

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
