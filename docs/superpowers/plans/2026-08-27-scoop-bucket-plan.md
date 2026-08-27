# Scoop bucket + one-line Windows install — implementation plan

Spec: `docs/superpowers/specs/2026-08-27-scoop-bucket-spec.md`
Issue: [#187](https://github.com/jonassaa/platypusgit/issues/187), Windows half.

## Global Constraints

- **No new secret and no new host.** The bucket push reuses
  `vars.TAP_APP_ID` / `secrets.TAP_APP_PRIVATE_KEY`, scoped to one more
  repository. `test/privacy.test.ts`'s `ALLOWED_HOSTS` must not need a new
  entry: the Scoop upgrade hint is `scoop update platypusgit`, with no URL in
  it. If a URL ever creeps into `packageHint`, the guard is right and the
  change is wrong.
- **`prerelease == false` or `workflow_dispatch`**, same `if:` expression as
  `bump-cask` and `apt-publish`, character for character. A prerelease must
  attach assets and touch no channel.
- **Fail loudly on an empty input.** `bump-scoop` refuses an empty `sha256`
  exactly as `bump-cask` does; a manifest with an empty `hash` fails every
  install and must never be pushed.
- **The Rust IPC rules are unchanged.** No new command, no new `AppError`
  variant. `UpdateCapability` gains one variant and `src/lib/types.ts` gains
  the matching union member **in the same commit** (the 1:1 rule).
- **The detection probe stays one `Path::exists`.** No process spawn, so
  nothing new goes through `proc.rs` and `get_update_capability` stays
  synchronous.
- **Nothing here may make `pgit` fight itself.** A Scoop install must classify
  as `CliShimSource::Package`, so Settings offers no install (spec §C).

## File Structure

New:

- `scripts/scoop-manifest.sh` — renders `bucket/platypusgit.json`.
- `scripts/scoop-bucket-wizard.sh` — the one-time human-only steps.
- `scripts/scoop-bucket-seed/README.md` — the bucket repo's landing text.
- `scripts/scoop-bucket-seed/bucket/.gitkeep` — so the seed creates the
  directory the first `bump-scoop` writes into.
- `src-tauri/windows/pgit-portable.cmd` — the relative-path `pgit.cmd` that
  ships inside the zip.
- `docs/superpowers/specs/2026-08-27-scoop-bucket-spec.md` (this change's spec).

Changed:

- `.github/workflows/release.yml` — `windows` builds + smokes + attaches the
  zip and outputs its `sha256`; new `bump-scoop` and `scoop-verify-live` jobs.
- `src-tauri/src/update.rs` — `InstallEnv`, `NotifyScoop`, `is_scoop_layout`,
  `SCOOP_MANIFEST_FILE`.
- `src-tauri/src/commands/update.rs` — the Windows probe.
- `src-tauri/tests/update.rs` — rewrite the `capability` calls onto
  `InstallEnv`; layout tests.
- `src-tauri/src/cli.rs` — `PORTABLE_SHIM_CMD` (`include_str!` of the shipped
  bytes) and, in its inline `mod tests`, that both Scoop shim shapes classify as
  `Package`.
- `src/lib/types.ts` — `"notify-scoop"`.
- `src/features/update/packageHint.ts` (+ tests) — the Scoop arm.
- `src/features/update/UpdatePanel.test.tsx` — the panel renders it.
- `site/src/data/site.ts` — `scoop`, `assets.windowsPortableZip`.
- `site/src/pages/download.astro` — the Windows card, `pgitMatrix`.
- `README.md` — the Windows install lines and the stale Status bullet.
- `docs/dev/distribution.md` — the Scoop section.

## Phases

Each phase ends green (`cargo test`, `pnpm test`, `pnpm tsc --noEmit`) and is
its own commit; the branch is squashed before merge.

### Phase 1 — the manifest generator

1. `scripts/scoop-manifest.sh`: POSIX `sh`, `set -eu`, `jq -n`. Flags
   `--version`, `--hash`, `--url` (defaulted from the version), `--out`.
   Rejects an empty version or hash, and a hash that is not 64 hex characters —
   the one error a reviewer cannot see and Scoop reports as a corrupt download.
2. Run it locally, read the JSON, and check it against Scoop's documented
   manifest keys by eye. This is the only verification available off Windows.

### Phase 2 — the portable asset

1. `src-tauri/windows/pgit-portable.cmd` — `@"%~dp0platypusgit.exe" %*`, CRLF,
   with a header comment saying why it is relative where
   `cli.rs::shim_cmd_body` is absolute.
2. `release.yml`'s `windows` job: after the stable-name `cp`, stage
   `platypusgit.exe`, that `.cmd` and `LICENSE` into a directory and
   `Compress-Archive` it to `PlatypusGit_x64_portable.zip`.
3. **Smoke it on the runner**: expand the zip to a temp directory, assert the
   three entries exist and that the `.cmd` names the exe. Fail the job if not.
4. `sha256` via `Get-FileHash` → job output `portable_sha256`. Attach the zip
   in the existing "Attach installer" step, still before the signature read.

### Phase 3 — capability, and what the panel says

1. `update.rs`: `InstallEnv { os, is_appimage, apt_managed, scoop_managed }` +
   `InstallEnv::new(os)`; `capability(InstallEnv) -> UpdateCapability`;
   `UpdateCapability::NotifyScoop`; `is_scoop_layout(&Path)`;
   `SCOOP_MANIFEST_FILE` as the documented contract constant.
   Windows order: AppImage cannot occur, so `scoop_managed` is the only thing
   that can turn Windows off `SelfUpdate`.
2. `commands/update.rs`: `os == "windows" && is_scoop_layout(exe) &&
   exe_dir.join(SCOOP_MANIFEST_FILE).exists()`, skipped entirely off Windows.
3. `tests/update.rs`: rewrite existing calls; add — Windows + Scoop is
   `NotifyScoop`; Windows without it stays `SelfUpdate`; a stray
   `scoop_managed` off Windows changes nothing; `is_scoop_layout` accepts
   `…/apps/platypusgit/1.2.3/` and `…/apps/platypusgit/current/`, rejects
   `…/apps/other/…`, a Program Files path, and a bare filename.
4. `src/lib/types.ts`: `"self-update" | "notify" | "notify-apt" | "notify-scoop"`.
5. `packageHint.ts`: a `notify-scoop` arm returning `scoop update platypusgit`,
   handled with `notify-apt` before the platform switch (the backend already
   decided; the platform cannot contradict it). Amend the module doc — "Windows
   is never `notify`" stops being true in spirit — and keep
   `packageHint("notify", "windows") === null`.
6. Tests: `packageHint.test.ts` for the new arm and for the unchanged bare
   `notify` on Windows; `UpdatePanel.test.tsx` renders the hint and no install
   button under `notify-scoop`.

### Phase 4 — `bump-scoop` and `scoop-verify-live`

1. `bump-scoop`: `needs: [version, windows]`, the shared `if:`, App token for
   `scoop-platypusgit`, checkout, empty-hash guard, `scripts/scoop-manifest.sh`
   into `bucket/platypusgit.json`, commit + push with the bump-cask
   "already up to date" early exit.
2. `scoop-verify-live`: `needs: [version, bump-scoop]`, `windows-latest`,
   install Scoop non-interactively, add the bucket **from the pushed repo**,
   install, then assert the four things in spec §E. No `--version` invocation.

### Phase 5 — the bucket, and the human-only steps

1. `scripts/scoop-bucket-seed/` — README naming the bucket, the package, and
   the fact that CI owns `bucket/platypusgit.json`; `bucket/.gitkeep`.
2. `scripts/scoop-bucket-wizard.sh` — idempotent, `--dry-run`, interactive:
   create the repo, seed it **through `gh api`** (never a `git push` — the repo
   has no local clone, so a git remote would fall through to the user's own
   credential setup), install the App on it, and verify the first `bump-scoop`
   populated the manifest.

### Phase 6 — the site and the README

1. `site/src/data/site.ts`: `scoop` block + `assets.windowsPortableZip`.
2. `download.astro`: Windows card leads with `scoop bucket add` +
   `scoop install`, keeps the `.msi` button, fixes the winget/Chocolatey note,
   adds the `pgitMatrix` row, updates the Windows `specs`.
3. `README.md`: the Windows install block gains the Scoop lines; the Status
   bullet stops claiming there is no scoop/apt repository.
4. `docs/dev/distribution.md`: the Scoop section — what Scoop installs and why
   not the `.msi`, the `pgit.cmd`-in-`bin` contract, the layout probe, and the
   two gates.

## Risks

- **The manifest is unverifiable off Windows.** Mitigated by keeping it to
  conventional keys, by `scoop-verify-live`, and by seeding the bucket empty so
  a wrong manifest never becomes the only manifest.
- **`Compress-Archive` path shape.** It is easy to zip a wrapper directory
  instead of the files; Scoop would then find no `platypusgit.exe` at the root.
  The Phase 2 smoke expands the zip and asserts the entries, on the runner.
- **The Scoop shim classification is a substring match.** `references_app`
  matches `MAIN_BINARY` inside the shim text, which works because the app
  directory is named after the package. Pinned by a test with a real shim body,
  and by requiring the same name in `is_scoop_layout`.
- **The page promises a bucket that does not exist yet** until the wizard runs.
  Same accepted window as #267; called out in the PR body, not left implicit.
