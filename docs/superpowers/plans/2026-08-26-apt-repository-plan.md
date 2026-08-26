# APT repository + one-line Linux install — implementation plan

**Goal:** `curl -fsSL https://www.platypusgit.com/install-platypusgit.sh | sh`
installs platypusgit on any amd64 Debian/Ubuntu box, `sudo apt upgrade
platypus-git` upgrades it for every release after, the app's update panel says so
instead of pointing at a browser download, and a sideloaded `.deb` is told how to
get onto that path.

**Architecture:** a new artifact-only repo (`jonassaa/apt-platypusgit`) served by
GitHub Pages holds a stateless `apt-ftparchive`-generated, GPG-signed index over
a pruned pool. All logic stays in `jonassaa/platypusgit`: three new shell scripts
under `scripts/` (publish, smoke, install) and one new `apt-publish` job in
`release.yml` shaped exactly like `bump-cask`. In-app, `update::capability` gains
a third variant rather than a new IPC command. The `.deb` gains three additive
`DebConfig` keys.

**Tech Stack:** POSIX `sh`, `apt-ftparchive` / `dpkg` / `gpg`, Docker
(`debian:bookworm`), GitHub Actions, Tauri 2 bundler config, Rust (no new
crates), TypeScript + Astro, vitest/RTL.

**Design doc:** `docs/superpowers/specs/2026-08-26-apt-repository-spec.md`
**Issue:** [#187](https://github.com/jonassaa/platypusgit/issues/187)

## Global Constraints

- **No new Tauri command.** `capability` gains a parameter and `UpdateCapability`
  gains a variant; `invoke_handler!` is untouched. `test/docs.test.ts` gates
  commands, backend modules and frontend feature directories — this work adds
  none of the three, so the doc invariants are unaffected. Do not add a command
  "for symmetry".
- `UpdateCapability` in `src/lib/types.ts` widens in the **same commit** as the
  Rust enum, per the 1:1 rule.
- Frontend never calls `invoke()` directly — `lib/tauri.ts` wrappers only. (No
  new wrapper is needed here; `getUpdateCapability` already exists.)
- Every IPC-crossing fn returns `AppResult<T>`. No new `AppError` variant is
  expected; if one appears, `src/lib/errors.ts` changes in the same commit.
- **Both new user-facing shell scripts must be safe under `curl … | sh`:** POSIX
  `sh`, `set -eu`, no bashisms, **never read stdin**, every choice a flag or an
  environment variable. Same rules `scripts/install-pgit.sh` already follows.
- **Secrets travel in the environment, never argv.** The GPG passphrase reaches
  `gpg` on stdin via `--passphrase-fd 0`. End option parsing with `--` before any
  user-supplied value.
- **`release.yml`'s existing jobs, gates and comments are not restructured.**
  `apt-publish` is additive, and it reuses the `prerelease == false ||
  workflow_dispatch` gate verbatim. Do not widen the `version` job's
  `published`/dispatch gate — the runbook comment there explains why.
- **`bundle.targets`, `createUpdaterArtifacts`, the updater `pubkey`, the
  stable-named release assets and the Homebrew cask are untouched.** The pool
  gets a *copy* under a versioned name; `PlatypusGit_amd64.deb` keeps its name so
  the cask and `latest.json` keep resolving.
- `/etc/apt/sources.list.d/platypusgit.sources` appears in exactly two places —
  `scripts/install-platypusgit.sh` and `src-tauri/src/update.rs`. Each carries a
  comment naming the other; a Rust test pins the constant.
- No `window.confirm` / `window.prompt`; no native `<select>`.
- Run pnpm/cargo with `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"`.
- **Do not run e2e.** Nothing here touches a webview flow any spec covers, and
  the Docker slot is shared across worktrees — which matters more than usual,
  because Phases 1–2 want Docker for `debian:bookworm`. Those containers are
  seconds-long and tiny; do not start a cold e2e image build alongside them.
- Do not touch the Homebrew tap. Do not create the apt repo by hand mid-plan —
  Phase 7 owns that, through the wizard.

## File Structure

**Create:**
- `scripts/install-platypusgit.sh` — the one-liner (spec §G)
- `scripts/apt-repo-publish.sh` — pool add + prune + index + sign (spec §E, §F)
- `scripts/apt-repo-smoke.sh` — serve a repo dir, install it in a container,
  assert (spec §H); used by both a developer and the release job
- `scripts/apt-repo-wizard.sh` — walks the human through spec §L
- `scripts/apt-repo-seed/index.html` — the landing page for `apt.platypusgit.com`
- `scripts/apt-repo-seed/CNAME`
- `scripts/apt-repo-seed/.nojekyll`
- `docs/superpowers/specs/2026-08-26-apt-repository-spec.md`
- `docs/superpowers/plans/2026-08-26-apt-repository-plan.md`

**Modify:**
- `src-tauri/tauri.conf.json` — `linux.deb`: `depends`, `provides`, `section`
- `src-tauri/src/update.rs` — `NotifyApt`, `capability`'s third parameter, the
  sources-path constant, tests
- `src-tauri/src/commands/update.rs` — the Linux-only `Path::exists` probe
- `src/lib/types.ts` — `UpdateCapability` gains `"notify-apt"`
- `src/features/update/packageHint.ts` — the widened guard + the new arm
- `src/features/update/packageHint.test.ts` — both notify arms
- `.github/workflows/release.yml` — the `apt-publish` job
- `.github/workflows/site.yml` — `scripts/install-platypusgit.sh` in `paths:`
- `site/scripts/copy-installers.mjs` — the new name in `INSTALLERS`
- `site/src/pages/download.astro` — the Linux section (spec §K)
- `docs/dev/distribution.md` — a new section

## Phases

### Phase 1 — the local proving ground

Nothing here depends on the apt repo existing, on DNS, or on the production key.
This phase is the test harness the rest of the plan is written against, so it
comes first.

1. Fixture pool: download the real published `PlatypusGit_amd64.deb` (v0.0.17)
   and place it as `platypus-git_0.0.17_amd64.deb` in a scratch pool. A real
   package, not a synthesised one — the point is to exercise `apt-ftparchive`
   against genuine control metadata.
2. `scripts/apt-repo-publish.sh`, taking a repo dir, a `.deb`, a version, and the
   key id / passphrase from the environment. Spec §E, including all three traps:
   delete `Release`/`Release.gpg`/`InRelease` before regenerating, `gzip -n`, and
   the `Packages`-byte-comparison short-circuit that makes a re-run a true no-op.
   Prune to the last 10 with `sort -V` and log what was dropped (spec §F).
3. `scripts/apt-repo-smoke.sh`: serve a repo dir with `python3 -m http.server`,
   `docker run --network host debian:bookworm`, install, assert. Assertions:
   `apt-get update` clean (no `NO_PUBKEY`, no `not signed`), `dpkg -s
   platypus-git` reports the expected `Version:`, and `/usr/bin/pgit` is
   executable.
4. Generate a throwaway RSA key in a scratch GNUPGHOME to drive both scripts.

**Verify:** `dash -n` + `bash -n` on both scripts; a full
publish→serve→container→install run that passes; a second `apt-repo-publish.sh`
run against the same version that prints "already up to date" and leaves
`git status` clean; a run with the signature deliberately corrupted that fails
`apt-get update` (proving the assertion can fail).

### Phase 2 — the installer

The smoke harness from Phase 1 is the test; the installer is the code under test.

1. `scripts/install-platypusgit.sh` — spec §G. Structure so the whole behaviour
   table is reachable without a real install: `PLATYPUSGIT_APT_URL` for the base
   URL, and the `apt-get`-present and architecture probes factored so they can be
   forced. `--dry-run`, `--help`, `set -eu`, never reads stdin.
2. Rewire `apt-repo-smoke.sh` to install by running the **real script** with
   `PLATYPUSGIT_APT_URL` pointed at the local server, replacing Phase 1's
   hand-written sources file. From here the gate exercises shipped code.

**Verify:** `dash -n` + `bash -n`; the smoke run now driving the real installer;
the no-`apt-get` refusal and the wrong-architecture refusal (both non-zero, both
naming the AppImage); `--dry-run` printing the three commands and changing
nothing (`dpkg -s` still absent afterwards); `--help`.

### Phase 3 — `.deb` metadata

1. `src-tauri/tauri.conf.json`, `bundle.linux.deb`: `"depends": ["git"]`,
   `"provides": ["platypusgit"]`, `"section": "vcs"`. Additive keys only —
   `files` and `postInstallScript` keep their values.
2. Add the `Depends: git` / `Provides:` / `Section:` assertions to
   `apt-repo-smoke.sh`, guarded so they are skipped for the v0.0.17 fixture
   (which predates them) and enforced for a freshly built package.

**Verify:** `pnpm tauri build --no-sign` gets far enough to prove the config
parses (macOS bundles, so it does not produce a `.deb`). The control-field
assertions are **unproven locally** — spec's verification-reality table — and are
proved by Phase 4's gate at release time, or by a one-off `tauri build --bundles
deb` inside the `Dockerfile.e2e` image if that proof is wanted before a release.
State which of those happened in the report; never claim the fields landed
without one.

### Phase 4 — the `apt-publish` job

1. New job in `release.yml`: `needs: [version, linux]`, gated `if: (release &&
   prerelease == false) || workflow_dispatch`, mirroring `bump-cask` — including
   its comment style, which is what makes that file readable.
2. Mint the App token with `repositories: apt-platypusgit`, reusing
   `vars.TAP_APP_ID` / `secrets.TAP_APP_PRIVATE_KEY`, with a comment recording
   that the `TAP_*` names now cover two repos on purpose.
3. Download the release's `.deb` (or reuse the `linux` job's artifact), run
   `apt-repo-publish.sh`, then **`apt-repo-smoke.sh` as a hard gate**, then
   commit and push. Short-circuit to "already up to date" when `Packages` is
   unchanged.
4. A second post-push job: retry-looped smoke against
   `https://apt.platypusgit.com`, because Pages publishes asynchronously.

**Verify:** run every step's shell body locally against a fixture checkout with
`act`-style env stubs — the token mint and the cross-repo push cannot be
exercised here and are reported unproven. `actionlint` if available. Re-read the
gate expression character by character against `bump-cask`'s; a gate typo here
publishes a prerelease to stable.

### Phase 5 — capability, and what the panel says

1. `src-tauri/src/update.rs`: `UpdateCapability::NotifyApt`, `capability(os,
   is_appimage, apt_managed)`, and a `pub const APT_SOURCES_PATH` carrying the
   contract path with a comment naming `scripts/install-platypusgit.sh`. Tests
   for the full matrix, including that macOS and Windows ignore `apt_managed`.
2. `src-tauri/src/commands/update.rs`: compute `apt_managed` as
   `Path::new(APT_SOURCES_PATH).exists()` on Linux only, `false` elsewhere.
3. `src/lib/types.ts`: `"self-update" | "notify" | "notify-apt"`.
4. `packageHint.ts`: widen the early return to admit `"notify-apt"`, add the
   `notify-apt` arm, and rewrite the sideloaded `notify` arm plus its now-stale
   comment (it currently reasons "we only publish .deb + AppImage for Linux, so
   apt is the right advice"). The `notify-apt` command string must match the
   download page's character for character.
5. `packageHint.test.ts`: both Linux arms, macOS unchanged, and the null cases
   (loading, Windows).
6. Confirm `UpdatePanel.tsx` needs no change — it branches only on `capability
   === "self-update"` — and add a component test rendering the `notify-apt` hint
   so that stays true.

**Verify:** `cargo test`, `cargo check`, `pnpm tsc --noEmit`, `pnpm test`.

### Phase 6 — the site

1. `site/scripts/copy-installers.mjs`: add `install-platypusgit.sh` to
   `INSTALLERS`. Nothing else — it is a byte copy, never a template.
2. `.github/workflows/site.yml`: add `scripts/install-platypusgit.sh` to
   `paths:`, so editing the installer redeploys the served copy.
3. `site/src/pages/download.astro`: the Linux section per spec §K — one-line
   install (Recommended), updating with apt, the expanded three commands with the
   key fingerprint, the demoted `.deb`, and the reframed AppImage that says it
   self-updates. Add the new script to the "read it before you run it" section's
   links. Build the URL from `Astro.site` the way `installShUrl` already is —
   never hardcode the origin.

**Verify:** `pnpm build` in `site/`, then confirm
`site/dist/install-platypusgit.sh` is byte-identical to `scripts/`'s copy; serve
`site/dist` and read the Linux tab in a browser at narrow and wide widths.

### Phase 7 — the apt repo, and the human-only steps

1. `scripts/apt-repo-seed/` — `CNAME`, `.nojekyll`, and an `index.html` that says
   what the host is, shows the three commands, and prints the key fingerprint.
2. `scripts/apt-repo-wizard.sh` — walks spec §L in order, refusing to advance
   past a step it cannot verify: repo created, seed pushed, DNS record resolving,
   Pages enabled with the custom domain and HTTPS, key generated with a
   revocation cert, the three secrets set, the App installed. It checks with `gh`
   and `dig` where it can and asks where it cannot. Ordering is enforced: Pages
   rejects a custom domain whose DNS does not resolve yet, so step 4 cannot
   precede step 3.

**Verify:** `dash -n` + `bash -n`; a dry run that prints every step and mutates
nothing. The wizard is **run by the user**, not by the assistant — it creates a
public repository, edits DNS, and installs a GitHub App.

### Phase 8 — docs and wrap-up

1. `docs/dev/distribution.md`: a new section covering the repo layout, the three
   `apt-ftparchive` traps, why there is no key expiry and no `Valid-Until`, the
   retention cap, the sources-path contract between the script and Rust, and the
   two-repo publish path. This is where the lessons live — **not** CLAUDE.md,
   which gets no new section (a pointer already serves: `docs/dev/distribution.md`
   is listed there).
2. Add the release runbook line: a prerelease attaches a `.deb` to the GitHub
   release and is deliberately invisible to apt.
3. File the follow-up issues from the spec: Scoop, winget, `.rpm`/dnf, AUR,
   arm64, and a `beta` suite.
4. Full sweep, squash to focused Conventional Commits, open the PR.

**Verify:** `pnpm tsc --noEmit`, `pnpm test`, `cargo check`, `cargo test`, `pnpm
exec tsc -p e2e/tsconfig.json --noEmit`, `pnpm build` in `site/`.

## Risks

- **A gate typo publishes a prerelease to the stable suite.** `apt-publish`'s
  `if:` must match `bump-cask`'s exactly. Unlike a bad cask bump, this one lands
  in a signed index that clients auto-discover on their next `apt update`.
  Mitigation: copy the expression rather than retype it, and diff the two.
- **The `.deb` control fields are the one thing this machine cannot prove.** If
  Tauri's `depends` turned out to *replace* rather than append the auto-detected
  `libwebkit2gtk-4.1-0, libgtk-3-0`, the published package would be
  uninstallable — and the smoke gate would catch it, but only at release time,
  after the build. Mitigation: run the one-off `--bundles deb` build in the e2e
  image before the first real release, and put the dependency assertion in the
  gate so a regression cannot reach a push.
- **A wrong `Release` file breaks `apt update` for everyone at once**, and unlike
  a bad app build there is no per-user opt-out. Mitigation: the pre-push
  container gate, plus the deliberate absence of `Valid-Until` so a stale index
  degrades to "no new version" rather than to a hard failure.
- **`pgit --version` as a smoke assertion assumes the binary parses argv before
  touching a display.** `cli.rs:153` handles `--help`/`--version` in `parse_args`
  and returns `Parsed::Help` before any window is built, so it should hold in a
  headless container — but GTK initialisation order is not something to bet the
  gate on. Mitigation: assert `dpkg -s` and `test -x /usr/bin/pgit`
  unconditionally, and treat `pgit --version` as an additional check that may be
  dropped if it proves display-dependent.
- **Phase 1–2 want Docker while the shared e2e slot exists.** These containers
  are seconds long and small, but a cold e2e image build in a sibling worktree
  will contend for memory. Mitigation: do not run e2e in this work at all (it is
  not needed), and check no sibling build is running before the first `docker
  run`.
- **The manual state in spec §L is the likeliest thing to be half-done.** A DNS
  record without Pages, or secrets without the App installation, produces a
  release-time failure far from its cause. Mitigation: the wizard verifies each
  step before advancing, and the spec's table is the written record for the next
  session.
- **The one-liner in the sideloaded update hint is a `curl | sh` shown inside the
  app.** Defensible — it is the same script the download page serves, and it is
  the only single line that both upgrades and fixes the situation permanently —
  but if it reads as too aggressive in review, the fallback is the current
  download-the-deb wording plus a link, and that is a copy change, not a design
  change.
