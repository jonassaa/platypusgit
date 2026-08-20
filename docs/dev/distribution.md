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

## The `pgit` launch detaches — one variant must not (#163)

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
