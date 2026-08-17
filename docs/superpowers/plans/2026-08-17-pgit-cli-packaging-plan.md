# `pgit` CLI packaging — implementation plan

**Goal:** `pgit` is present after installing the app on every channel that gives
us a hook (Homebrew cask, `.deb`, `.msi`), a documented one-liner script covers
the ones that don't (`.dmg`, AppImage), Settings → Command line works on Windows,
and a package-managed `pgit` is reported as *installed* rather than overwritten.

**Architecture:** `src-tauri/src/cli.rs` keeps ownership of the shim. Its
single-answer `default_shim_dir` / `shim_installed_at` pair becomes a small pure
core — an ordered candidate list, a `PATH` splitter, a scan order, and one
`references_app` predicate — with the impure `shim_status` / `install_shim`
reduced to probing that core. Packaging is additive config only:
`bundle.linux.deb.files` + `postInstallScript` for the deb wrapper, and
`bundle.windows.wix.fragmentPaths` + `componentRefs` for a WiX fragment.
`release.yml` is not touched.

**Tech Stack:** Rust (no new crates), Tauri 2 bundler config, WiX v3 fragment,
POSIX `sh`, PowerShell 5.1+, React 18 + Zustand, vitest/RTL.

**Design doc:** `docs/superpowers/specs/2026-08-17-pgit-cli-packaging-spec.md`
**Issue:** [#144](https://github.com/jonassaa/platypusgit/issues/144)

## Global Constraints

- Every IPC-crossing fn returns `AppResult<T>`. No new `AppError` variant is
  expected; if one appears, `src/lib/errors.ts` changes in the same commit.
- `CliShimStatus` / `CliInstallOutcome` gain fields → `src/lib/types.ts` in the
  same commit. `installed` / `shimPath` / `target` / `path` / `manualCommand`
  keep their names and meanings so the existing Settings test keeps passing.
- Frontend never calls `invoke()` directly — `lib/tauri.ts` wrappers only.
- New Rust work in commands stays inside `spawn_blocking` (already true for both
  CLI commands).
- No `window.confirm` / `window.prompt`.
- **`release.yml`, `bundle.targets`, `createUpdaterArtifacts`, the updater
  `pubkey` and the signing config are untouched.** Bundle config changes are
  additive keys only.
- The WiX fragment contains no `{{` (Handlebars renders and discards it) and no
  preprocessor variable it does not define itself.
- `src-tauri/deb/pgit` must be committed mode `100755`.
- The `.sh` must be safe under `curl … | sh`: `set -eu`, no bashisms, never reads
  stdin.
- Secrets/paths reach a spawned shell through the environment, not argv.
- Run pnpm/cargo with `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"`.
- **Do not run e2e** — no spec here touches a webview flow that a spec covers,
  and the Docker slot is shared.
- Do not edit `site/` (#145 owns it) and do not touch the tap repo.

## File Structure

**Create:**
- `src-tauri/deb/pgit` — the `/usr/bin/pgit` wrapper (mode 755)
- `src-tauri/deb/postinst` — guarded `chmod` (mode 755)
- `src-tauri/wix/pgit-cli.wxs` — the `PgitCli` component fragment
- `src-tauri/wix/pgit.cmd` — the MSI shim
- `scripts/install-pgit.sh`
- `scripts/install-pgit.ps1`
- `docs/superpowers/specs/2026-08-17-pgit-cli-packaging-spec.md`
- `docs/superpowers/plans/2026-08-17-pgit-cli-packaging-plan.md`

**Modify:**
- `src-tauri/src/cli.rs` — the pure core, `CliShimSource`, `CliPathState`,
  rewritten `shim_status` / `install_shim`, Windows `install_shim_at`, tests
- `src-tauri/tauri.conf.json` — `linux.deb.files` + `postInstallScript`,
  `windows.wix.fragmentPaths` + `componentRefs`
- `src/lib/types.ts` — the two new fields on each struct
- `src/screens/Settings.tsx` — the four `source` states, the Windows path
- `src/screens/Settings.cli.test.tsx` — the new states
- `CLAUDE.md` — the packaging convention

## Phases

### Phase 1 — the ownership contract in `cli.rs` (pure core + tests)

The whole change hangs off this, so it lands first and alone.

1. `SHIM_NAME` (`"pgit"` / `"pgit.cmd"`), `MAIN_BINARY` (`"platypusgit"`).
2. `CliShimSource { None, App, Package, Foreign }` and
   `CliPathState { OnPath, OffPath }`, both `Serialize` + `camelCase`.
3. Pure fns, each taking its inputs rather than reading the environment:
   - `app_shim_dirs_from(home: Option<&Path>, local_app_data: Option<&Path>) -> Vec<PathBuf>`
     — per-OS order from spec §D.
   - `path_dirs(path_var: Option<&OsStr>) -> Vec<PathBuf>` — split on the
     platform separator, drop empties.
   - `shim_scan_order(app_dirs, package_paths, path_dirs) -> Vec<PathBuf>` —
     app dirs' shims, then package paths, then `PATH` dirs' shims, deduplicated,
     order preserved.
   - `references_app(link: Option<&Path>, text: Option<&str>, exe: &Path, main_binary: &str) -> bool`
     — the three probes from spec §A.
   - `classify_sighting(path, app_dirs, link, text, exe, main_binary) -> CliShimSource`.
   - `dir_on_path(dir: &Path, path_dirs: &[PathBuf]) -> CliPathState`.
4. Thin impure wrappers that read the environment: `app_shim_dirs()`,
   `package_shim_paths(exe)`, `read_sighting(path) -> Option<(link, text)>` with
   the 4 KiB / UTF-8 cap.
5. Tests (no filesystem where avoidable):
   - the deb wrapper's text classifies `Package` from `/usr/bin/pgit`
   - a symlink to `exe` inside an app dir classifies `App`
   - a symlink to `exe` **outside** the app dirs classifies `Package`
   - a symlink to something else, and a script with no mention, classify `Foreign`
   - a non-UTF-8 / oversized file classifies `Foreign`, never panics
   - scan order: app dirs before package paths before `PATH`; duplicates collapse
   - `path_dirs` drops empty entries and honours the platform separator
   - `dir_on_path` is exact-dir, not prefix

**Verify:** `cargo test --manifest-path src-tauri/Cargo.toml`.

### Phase 2 — `shim_status` / `install_shim` on the new core

1. `shim_status()` walks `shim_scan_order`, takes the first sighting that
   `references_app`, and reports `source` + `pathState` + `shimPath`. First
   non-referencing sighting → `Foreign`. Nothing → `None`, with `shimPath` and
   `pathState` describing the first app shim dir.
2. `install_shim()`:
   - `Package` → early return `installed: true`, no write (the contract, enforced
     in the backend and not only by a hidden button).
   - `App` whose link already equals `exe` → early return, no write (the
     Homebrew-ambiguity guard).
   - otherwise try each app shim dir in order; first success wins; `pathState`
     from the dir that won.
   - all fail → the existing `sudo ln -sf` `manualCommand`, unchanged.
3. `#[cfg(windows)] install_shim_at` writes `pgit.cmd` (`"<exe>" %*`) instead of
   a symlink, and `#[cfg(windows)] add_user_path(dir)` shells out to PowerShell
   with the directory in `PGIT_BIN_DIR` (spec §F).
4. Integration tests in `src-tauri/tests/` where a temp dir is needed:
   a package-managed sighting makes `install_shim` a no-op; a stale `App` link is
   replaced; an identical `App` link is left byte-identical.

**Verify:** `cargo test`, `cargo check`.

### Phase 3 — deb packaging

1. `src-tauri/deb/pgit` + `src-tauri/deb/postinst`, both `chmod 755` and
   committed as `100755` (confirm with `git ls-files -s`).
2. `tauri.conf.json`: `linux.deb.files` + `postInstallScript`.
3. Verify what can be verified here: `dash -n` both files; run the postinst
   against a temp fixture (with the path parameterised for the test) and assert
   it chmods only when needed and exits 0 for a non-`configure` argument; assert
   the wrapper's text is classified `Package` by the Phase 1 predicate.

**Verify:** `dash -n`, the fixture run, `git ls-files -s`, and that
`pnpm tauri build --no-sign` still parses the config on macOS.

### Phase 4 — MSI packaging

1. `src-tauri/wix/pgit.cmd`.
2. `src-tauri/wix/pgit-cli.wxs` — the `<?if $(sys.BUILDARCH)?>` preamble copied
   from `main.wxs`, one `Component Id="PgitCli"` with a fixed GUID, the `File`
   via `$(sys.SOURCEFILEDIR)`, the `Environment` PATH entry.
3. `tauri.conf.json`: `fragmentPaths` + `componentRefs`.
4. Verify: `xmllint --noout`, `xmllint --schema` against WiX v3's `wix.xsd`, and
   a grep proving there is no `{{` anywhere in the fragment.

**Verify:** the two `xmllint` runs, the grep, and `pnpm tauri build --no-sign`.

### Phase 5 — the scripts

1. `scripts/install-pgit.sh` — spec §G. Structure it so every filesystem root is
   overridable (`PLATYPUSGIT_APP`, `PGIT_BIN_DIR`, `PGIT_PATH_HINT`) precisely so
   it is testable without an install.
2. `scripts/install-pgit.ps1` — spec §F/§G, with the PATH append factored into a
   pure `Get-UpdatedPath` so it can be exercised by `pwsh` on macOS.
3. Verify: `dash -n` + `bash -n`; real runs against fixtures for
   already-installed / fresh-install / package-managed-present / `--dry-run` /
   `--help`; `pwsh` parse check via `[Parser]::ParseFile`; `Get-UpdatedPath`
   driven through its cases under `pwsh`.

**Verify:** the runs above.

### Phase 6 — Settings

1. `src/lib/types.ts`: `source: CliShimSource`, `pathState: CliPathState` on
   `CliShimStatus`; `pathState` on `CliInstallOutcome`.
2. `Settings.tsx` `CliSection`: drop the `isWindows` dead branch entirely and
   render off `source` —
   - `package` → "Installed by your package manager at `<path>`", no button
   - `app` → "Installed at `<path>`" + Reinstall, plus the `offPath` line naming
     the directory to add
   - `foreign` → "A different `pgit` is on your PATH at `<path>`" + Install
   - `none` → Install, plus the pre-warning when the target dir is off `PATH`
3. Component tests for all four, plus a `pathState: "offPath"` render.

**Verify:** `pnpm tsc --noEmit`, `pnpm test`.

### Phase 7 — docs + wrap-up

1. `CLAUDE.md`: a "CLI packaging" convention paragraph — where `pgit` lands per
   channel, the ownership contract, the four WiX fragment traps, the deb exec-bit
   chain, and "do not touch `release.yml` for this".
2. Full verification sweep, then squash to focused Conventional Commits and open
   the draft PR.

**Verify:** `pnpm tsc --noEmit`, `pnpm test`, `cargo check`, `cargo test`.

## Risks

- **The WiX fragment is the only file here that can break a release for every
  platform's users**, because a candle/light failure fails the whole Windows job
  and the release ends up with no `.msi`. Mitigations: mirror `main.wxs`'s own
  patterns, define every preprocessor variable used, schema-validate locally, and
  state in the report that compilation is unproven.
- The `postinst` can fail `dpkg -i` for the whole package. Mitigation: it touches
  one path, guards on existence, and exits 0 for every non-`configure` argument.
- The Windows PATH write can damage a user's `PATH`. Mitigation: no `setx`,
  registry value kind preserved, idempotent, and a failure is reported rather
  than retried differently.
