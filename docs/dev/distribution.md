# Distribution — pgit CLI, launch detach, permissions

Part of the `docs/dev/` set (`architecture`, `testing`, `frontend`, `backend`,
`distribution`) — deep-dive notes split out of CLAUDE.md, which keeps only the
operational rules and points here. A section referenced but not found in this
file lives in a sibling. `test/docs.test.ts` reads this set together with
CLAUDE.md, so the tree listings and command lists here are build-checked.

## CLI packaging: `pgit` per channel (#144)

- **Where `pgit` lands, per channel.** Homebrew cask: a `binary` stanza symlinks
  the app binary into the brew prefix. `.deb`: `/usr/bin/pgit`, a wrapper
  exec'ing `/usr/bin/platypusgit`, shipped via `bundle.linux.deb.files`.
  `.msi`: `<INSTALLDIR>\pgit.cmd` plus `INSTALLDIR` on the machine PATH, via a
  WiX fragment. `.dmg` and AppImage have **no hook at all** — a drag-install runs
  no code and an AppImage is never installed — so they get Settings → Command
  line and the installer scripts, served from the marketing site at
  `https://www.platypusgit.com/install-pgit.sh` / `…/install-pgit.ps1` and
  documented as a one-liner in the download page's `#cli` section.
- **Those URLs are a BUILD-TIME COPY of `scripts/install-pgit.*`, never a second
  committed file.** `site/scripts/copy-installers.mjs` copies both into
  `site/public/` from `pnpm dev` and `pnpm build`, and `site/.gitignore` covers
  the copies. A checked-in duplicate of a shell script drifts from the original,
  and the drifted one is the one people pipe into `sh`; a build step makes the
  served bytes the repo's bytes by construction. It is a plain byte copy — no
  templating, because a substitution pass could break the `curl … | sh` safety
  rules below without touching the file anyone reviews. Two consequences:
  `.github/workflows/site.yml` must keep running `pnpm build` rather than
  `astro build` (a 404 on a URL the page says to pipe into a shell is worse than
  no link), and its `paths:` filter lists `scripts/install-pgit.*` alongside
  `site/**` so editing an installer redeploys the served copy instead of leaving
  it stale until some unrelated site change.
- **The page presents the split, not the one-liner.** Homebrew / `.deb` / `.msi`
  users must not be told to run a script — `plan_install` would refuse the
  `package` shim anyway, so the instruction would be noise that reads as a
  failure. The `#cli` section leads with "most installs already have it", and the
  per-channel methods above it cross-link to it either way round: the `.dmg` and
  AppImage rows say the command is separate, the `.msi` and Homebrew rows say it
  came with the install. The one-liner ships beside a link to the script and a
  download-then-inspect-then-run form, since piping a URL into a shell is only
  auditable if reading it first is offered in the same place.
- **Three parties can own `pgit`, and `shim_status` says which.**
  `CliShimSource` is `app` (a directory we write) / `package` (launches us from
  anywhere else) / `foreign` (does not launch us) / `none`, and `installed` means
  *`pgit` is present and launches this app*. **A `package` shim is never
  overwritten and never offered for overwrite** — `plan_install` enforces it in
  the backend, not only by hiding the button, so a future caller (palette,
  first-run prompt) cannot reintroduce the fight.
- The scan order is **our dirs → known package paths → PATH**, deliberately.
  Ours first is what the Reinstall button depends on; "what would a shell
  actually run" is answered separately by `pathState`, not by reordering.
- **Recognition needs three probes**, because the channels ship three kinds of
  file: a symlink to `current_exe()`, a symlink named after the binary, and a
  small wrapper script mentioning it. That last one is why the deb wrapper spells
  its target absolutely instead of using `dirname "$0"`. Text reads are capped at
  4 KiB and non-UTF-8 counts as "no".
- **On an Intel Mac, Homebrew's prefix IS `/usr/local/bin`** — also our first
  shim dir — so a cask symlink classifies `app`. Accepted, not a bug: both are
  symlinks to the same target, and `plan_install` returns `KeepExisting` when the
  link already points at us, so Reinstall cannot clobber a brew-managed link.
- **macOS installs no longer need sudo.** `shim_dirs_for` is an ordered list and
  `install_shim` takes the first one it can write; attempting the write IS the
  writability test (a separate probe would only add a TOCTOU). `/usr/local/bin`
  stays first because it is the only default-PATH entry, so existing installs are
  untouched; everyone else falls through to `~/.local/bin` and the off-PATH state
  is *reported* with the line that fixes it, never hidden.
- **The Windows PATH write is PowerShell on purpose**, and both traps are load
  bearing: `setx` truncates at 1024 characters and `setx PATH "%PATH%;…"` writes
  the MERGED machine+user PATH into the user PATH; and a bare
  `[Environment]::SetEnvironmentVariable(…, 'User')` rewrites a `REG_EXPAND_SZ`
  PATH as `REG_SZ` with `%USERPROFILE%` permanently expanded. So the value is
  read `DoNotExpandEnvironmentNames` and written back with `GetValueKind`'s
  answer. The directory travels in `PGIT_BIN_DIR`, never argv — `-Command` takes
  a script and a path is user-controlled text.
- **Four traps in `src-tauri/wix/pgit-cli.wxs`**, each a way to fail the Windows
  release job and ship a release with no `.msi`. They are documented in the file
  itself; the short version: no doubled opening brace anywhere (the bundler
  renders fragments through Handlebars and then *discards* the result, so a
  malformed expression fails the build and a well-formed one is silently
  dropped); the `$(var.Win64)` preamble is **copied** because candle defines are
  per source file; `Source` uses `$(sys.SOURCEFILEDIR)` because candle's cwd is
  `target/release/wix/<arch>`; and `light` runs **without `-sval`**, so ICE
  validation is live — match `main.wxs`'s own component shapes rather than
  inventing one.
- **The exec bit on `/usr/bin/pgit` survives the bundler**, verified in source
  rather than assumed: git stores `100755`, `fs_utils::copy_file` is
  `std::fs::copy` (which copies permission bits), and tar-rs's
  `HeaderMode::Deterministic` *propagates* the user execute bit on Unix
  (`0o100 & mode` → `0o755`) instead of flattening to `0644`. Its Windows branch
  does not, but the `.deb` is built on `ubuntu-22.04`. `deb/postinst` is the belt
  for that brace and stays minimal: **a postinst exiting non-zero fails
  `dpkg -i` for the whole package.**
- **Uninstall needs no code.** Each channel's remover already deletes what it
  shipped. There is deliberately no `postrm` (a package must not delete files it
  did not ship) and no uninstall command (after an uninstall there is no app to
  run one).
- **`release.yml` is not involved.** All of this is additive bundle config;
  `bundle.targets`, `createUpdaterArtifacts`, the updater `pubkey` and the
  signing config are untouched. `bump-cask` rewrites the tap's cask with two
  `sed -i -E` expressions anchored on `^  version "` and `^  sha256 "`, so the
  cask's `binary` stanza matches neither anchor and the version bump keeps
  working.
- **Test seams are deliberate, and named as such**: `PGIT_APP_SEARCH_ROOT` /
  `PGIT_UNAME` in `install-pgit.sh` and `PGIT_POSTINST_PREFIX` in `deb/postinst`
  exist because three of five channels cannot be exercised on a developer
  machine. Nothing in normal use sets them.
- **`scripts/install-pgit.sh` must stay `curl … | sh`-safe**: POSIX `sh`,
  `set -eu`, and it never reads stdin — stdin IS the script, so there can be no
  prompts and every choice is a flag or an env var. Watch `set -e` around
  `[ … ] && cmd` as a function's or loop body's last command, and feed loops from
  a here-doc rather than a pipe when they assign to an outer variable.

## The `pgit` launch detaches — and one variant must not (#163)

- **`pgit .` hands the prompt straight back**, like `code .`. The detach is in
  the BINARY (`detach.rs`, called from one site in `lib.rs::run`), not in the
  shims: two of the four shapes are symlinks to this executable, so there is no
  script to put a `&` in, and `setsid` does not exist on macOS.
- **`Parsed::Askpass` must never detach, and that is the whole risk of this
  feature.** git runs this binary as `GIT_ASKPASS` and reads the credential from
  its stdout, **synchronously**; a process that spawned a child and exited hands
  git an empty credential, so every authenticated fetch, pull and push fails with
  nothing in any error to trace it back to. `should_detach` therefore answers
  yes for `Parsed::Launch` only, and additionally refuses while
  `ASKPASS_MODE_ENV` is set — git's prompt string parses as a *path*, so a
  reordering that let it reach the gate would otherwise read as a launch.
  `Parsed::Help` stays synchronous for the same reason at a lower stake.
- **`GIT_ASKPASS` points at the bare executable, never at the `pgit` shim**, and
  since this landed there are two independent reasons: `GIT_ASKPASS` is exec'd
  directly and cannot carry arguments (#61 D5), *and* `pgit` now detaches.
- **It re-execs; it does not `fork()` and carry on.** macOS forbids using
  CoreFoundation, AppKit or WebKit's XPC services in a forked child that has not
  `exec`'d (fork(2) says so outright), and the child here IS the GUI. cwd is
  passed to it explicitly even though an exec'd child inherits it, because
  `parse_args` resolves `pgit ../other-repo` against it.
- **Gated on stdout being a terminal**, so Finder, the Dock, a `.desktop` entry
  and the e2e harness's pipes are untouched. Consequence worth knowing:
  `pgit . > file` still blocks, by design.
- **Windows is deliberately unchanged.** The release binary is GUI-subsystem, so
  `cmd.exe` and PowerShell already return; Git Bash waits, but its stdout is an
  MSYS named pipe that `IsTerminal` reports as not a terminal, so the gate would
  refuse there anyway. Fixing that shell needs a Windows machine to verify on.
- `tests/cli_detach.rs` drives the real binary through a **pty** for the two
  paths that must stay synchronous, and `git credential fill` — git's own
  credential machinery, offline — for the credentialed one. A pure-function test
  cannot show that git still gets its answer.

## Permissions (Tauri 2)
- Shared permissions in `src-tauri/capabilities/default.json`. Current set: `core:default`, `core:window:allow-minimize`, `core:window:allow-toggle-maximize`, `core:window:allow-close`, `core:window:allow-start-dragging`, `core:window:allow-set-title`, `core:webview:allow-create-webview-window`, `core:webview:allow-set-webview-zoom` (the `view.zoom*` chords), `dialog:default`, `dialog:allow-open`, `os:default`, `log:default`. Capability scopes `windows: ["main", "merge"]` (merge resolver runs as a second window).
- **Self-update permissions are scoped narrower** — `updater:default` + `process:allow-restart` live in `src-tauri/capabilities/updater.json` with `windows: ["main"]`, NOT in `default.json`. The merge resolver window must not be able to swap the binary or relaunch the process mid-conflict. Keep new privileged permissions out of the shared capability unless both windows genuinely need them.
- **E2E-only permissions** live in the inline `e2e-focus` capability in `src-tauri/tauri.e2e.conf.json`, NOT in `default.json`: `core:window:allow-set-focus` + `wdio-webdriver:default`. That capability is loaded only via `--config src-tauri/tauri.e2e.conf.json`, and the `tauri-plugin-wdio-webdriver` crate is an optional dep behind the `e2e` cargo feature (`--features …,e2e` in `test:e2e:build`), so the WebDriver bridge is never compiled into or permitted in dev/production builds.
- New plugin: `cargo add tauri-plugin-X`, `pnpm add @tauri-apps/plugin-X`, register with `.plugin(tauri_plugin_X::init())` in `lib.rs`, add plugin permissions to capability file.

