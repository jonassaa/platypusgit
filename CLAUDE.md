# CLAUDE.md

Context for future Claude sessions working on this repo. Keep it current when architecture or conventions change.

## Communication style

**Always use caveman mode.** Terse, fragments OK, drop articles/filler/pleasantries/hedging. Technical substance stays intact. Code, commit messages, and security warnings stay normal prose. See `caveman:caveman` skill for full rules.

## What this is

`platypusgit` — cross-platform, developer-focused git desktop app. Tauri 2 (Rust) backend + React/TS frontend. Dev-first TortoiseGit alternative with "extreme usability" as north star. Standalone GUI only — shell integration (Finder/Explorer overlays) out of scope.

## Canonical references

- **Specs:** `docs/superpowers/specs/` — approved design docs per feature.
- **Plans:** `docs/superpowers/plans/` — matching implementation plans.

New feature beyond MVP slice → write new spec + plan under these folders first.

Recent specs/plans (for context on current direction):
- `2026-08-16-tag-signing-*` — GPG/SSH signed annotated tags reusing the commit
  signing chain, `verify_tag` + badges, one create-tag dialog replacing three
  prompts (#132).
- `2026-08-16-stash-improvements-*` — path-level partial stash, stash rename
  (store a FRESH commit, then drop — see the stash convention below), and the
  two correct stash comparisons; hunk-level stash deferred with reasons (#133).
- `2026-08-16-branch-compare-*` — `compare` deep view: two mutable sides
  (ref↔ref or ref↔working tree), ahead/behind + both commit lists, the file diff
  through `CommitDiffPanel` (#131).
- `2026-08-14-submodules-lfs-worktrees-bisect-*` — submodule/worktree screens, LFS panel + pointer-aware diffs, bisect in the operation bar (#93).
- `2026-08-14-drag-and-drop-*` — one pointer-event drag primitive (`features/dnd/`); staging drag, graph ref/commit drops, rebase reorder gated + keyboard-paired (#91).
- `2026-08-14-forge-integration-*` — PR/MR integration for GitHub + GitLab (#92 / #61 D11):
  remote→forge detection, per-host API token under its OWN credential key, list /
  open / checkout / create, `pulls` screen.
- `2026-08-14-multi-repo-tabs-*` — N repositories open in tabs; `useRepoStore`
  holds only the ACTIVE tab's slice, `useTabsStore` owns the open set (#90).
- `2026-08-14-conflict-flow-*` — no Conflicts screen; `repoState`-driven operation bar; resolver window owns the conflicted-file list (#108).
- `2026-08-10-clone-init-*` — clone (streaming progress) + init repository (#61 D3/D4).
- `2026-07-07-merge-resolver-window-*` — Rider-style separate merge window (#25 pt 2); per-conflict keyboard side selection, editable CM6 result pane.
- `2026-07-07-cli-launch-*` — `pgit` CLI launch, single-instance forwarding, shim install (#25).
- `2026-07-06-keymap-power-shortcuts-*` — speed-search, commit chords, F7 hunk nav.
- `2026-07-03-ref-scoped-log-*` — History ref selector; log walk from any revspec (#27).
- `2026-07-03-e2e-phase3-*` — e2e phase 3: remote/palette/settings coverage, dead-settings audit.
- `2026-04-24-centralized-branch-ui-*` — sidebar removed, titlebar branch chip + popover picker.
- `2026-04-23-reflog-viewer-*` — reflog screen + dirty-tree handling.
- `2026-04-23-commit-graph-layout-*` — graph layout engine for history view.
- `2026-04-22-platypusgit-write-path-phase1.md` — first cut of write operations.
- `2026-04-22-ux-polish-batch-1.md` — UX cleanup pass.
- `2026-04-23-wire-up-placeholders.md` — replacing stubs with real backend calls.

## Toolchain

- **Node 22** + **pnpm** (at `~/Library/pnpm`). Not npm, not yarn.
- **Rust stable** via rustup (`~/.cargo/bin`).
- Assistant's Bash tool does not inherit interactive shell rc → prepend `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"` when running `pnpm` or `cargo`.

## Common commands

```bash
pnpm install                                # frontend + tauri-cli deps
pnpm tauri dev                              # run app (first build ~2 min, reruns ~10s)
pnpm tsc --noEmit                           # type-check
pnpm vite build                             # bundle frontend only
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
pnpm tauri build                            # production bundle (.msi/.dmg/.deb/.AppImage)
pnpm tauri build --no-sign                  # ...without updater signing (see note below)
pnpm test                                   # vitest (unit logic + component tests)
pnpm test:e2e:docker                        # e2e — THE way to run e2e (headless, same stack as CI)
pnpm test:e2e:docker run --spec e2e/specs/X.e2e.ts   # ...one spec against this worktree's snapshot
pnpm exec tsc -p e2e/tsconfig.json --noEmit # e2e typecheck gate (root tsc excludes e2e/)
```

**E2E always runs in Docker — never natively, never in a UI window.** The
`test:e2e`, `test:e2e:build`, and `test:e2e:run` scripts are the in-container
primitives the Docker wrapper invokes; do not run them directly on the host. A
host run pops a real WKWebView window, needs foreground focus, is unreliable
(multi-window specs drop the session) and slow (a full native run has taken 27
min vs ~1 min in the healthy band) — and a green native run does not predict the
PR gate. See "Headless e2e in Docker" below.

**Local production builds need the updater signing key.** `tauri.conf.json`
sets `plugins.updater.pubkey` + `bundle.createUpdaterArtifacts: true`, so
tauri-cli signs updater artifacts while bundling — and a pubkey with no private
key is a **hard error**, not a skip: *"A public key has been found, but no
private key. Make sure to set `TAURI_SIGNING_PRIVATE_KEY` environment
variable."* A plain `pnpm tauri build` therefore fails on any target that
produces an updater artifact (msi on Windows, AppImage on Linux). Either export
`TAURI_SIGNING_PRIVATE_KEY` (+ `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) or build
with `--no-sign`. CI is unaffected — release.yml passes both from repo secrets.

### Headless e2e in Docker (`pnpm test:e2e:docker`) — the only supported way

macOS has no headless webview — a native `pnpm test:e2e` run pops a real
WKWebView window and needs foreground focus (`ensureMacAppFocus`). So e2e runs
headless in a container driving the CI stack (WebKitGTK + xvfb). Same webview
target CI uses, so a green Docker run matches the PR gate.

**Never run e2e natively / in a UI window** — not to "check it quickly", not for
a single spec, not because Docker is cold. It steals foreground focus from
whoever is at the machine, is flaky on multi-window specs, and its result
doesn't predict CI. The one exception is a genuinely WKWebView-specific
question, and that needs the user to ask for it explicitly; say so in the report
when it happens.

Files: `Dockerfile.e2e` (mirrors `.github/workflows/e2e.yml` deps),
`docker-compose.e2e.yml`, `e2e/docker-entrypoint.sh` (phase dispatch),
`e2e/e2e-docker.sh` (wrapper — sets a per-worktree compose project name).

```bash
pnpm test:e2e:docker                                  # full: build binary + whole suite, headless
pnpm test:e2e:docker full --spec e2e/specs/X.e2e.ts   # full build + one spec
pnpm test:e2e:docker run  --spec e2e/specs/X.e2e.ts   # reuse THIS worktree's snapshot, one spec
pnpm test:e2e:docker build                            # rebuild this worktree's snapshot only
```

First run is slow (image build + cargo compile from scratch). Reruns reuse
cached layers + shared package caches; only changed code recompiles.

**Memory:** the compose service caps `CARGO_BUILD_JOBS=2` +
`CARGO_PROFILE_DEV_DEBUG=0` because the default ~8GB Docker VM OOM-kills rustc
(SIGKILL) when cargo fans out one job per CPU — the GTK/WebKit crates each cost
2–4GB to compile, so even a few overlapping blow the limit. Bump
`CARGO_BUILD_JOBS` in `docker-compose.e2e.yml` if you give the VM more RAM
(Docker Desktop → Settings → Resources); 2 is safe at 8GB but leaves most of
the 14 CPUs idle during the compile.

**Parallel agents / worktrees:** safe by construction. `e2e/e2e-docker.sh`
derives `COMPOSE_PROJECT_NAME=pgit-e2e-<worktree-dir-slug>`, so each worktree
gets its own `node_modules` / `target` / `.bin` volumes (the cargo target dir
is NOT safe for concurrent builds → must be per-worktree). Package caches
(pnpm store, cargo registry/git) have fixed volume names shared across all
worktrees — concurrency-safe, so crates download once, not per-worktree. The
WebDriver port (4445) is internal to each container, never published, so no
host-port collisions. Different worktrees → run concurrently, no coordination.
Same worktree → run one at a time (they'd share the target volume). Each agent
just runs `pnpm test:e2e:docker …` from its own worktree.

Expect this on a new worktree's first run, and ignore it — it is the shared
caches working as designed, not a misconfiguration:

```
warning: volume "pgit-e2e-pnpm-store" already exists but was created for
project "pgit-e2e-<some-other-worktree>" (expected "pgit-e2e-<yours>").
Use `external: true` to use an existing volume
```

**One cold container build at a time across ALL worktrees, though.** The
concurrency note above is about correctness (separate volumes), not memory: two
worktrees compiling GTK/WebKit at once exceeds the ~8GB VM even at
`CARGO_BUILD_JOBS=2` each, and rustc is SIGKILLed in *both* runs. Also note
`compose run --build` creates no container until the image build finishes, so a
build already in flight is invisible to `docker ps` — check `docker compose ls`
too before assuming the slot is free.

## Testing

Four layers, each run independently:

- **Rust backend integration** — `cargo test --manifest-path src-tauri/Cargo.toml`.
  Covers every `GitBackend` op against real temp repos via the `TempRepo` fixture
  in `src-tauri/tests/support/`. End-to-end for git logic, no webview needed.
- **Frontend pure logic** — `pnpm test` picks up `*.test.ts` (e.g. `graphLayout`,
  `buildRebasePlan`). Node-grade pure functions.
- **Frontend component tests** — `pnpm test` also picks up `*.test.tsx` under
  `src/`. Runs in jsdom with React Testing Library. The Tauri `invoke` and
  `plugin-dialog.open` calls are mocked via `src/test/setup.ts`; tests register
  per-command responses with `mockInvoke(cmd, handler)`.
- **E2E (webview-level)** — WebdriverIO specs in `e2e/specs/` (25 files; count
  them rather than trusting this number — it has been stale three times) drive
  the real debug binary: real webview →
  real Tauri IPC → real libgit2 → temp repos built by `e2e/support/tempRepo.ts`.
  Uses the embedded WebDriver provider (`@wdio/tauri-service`) — no external
  driver or paid service — so it runs on Linux CI (WebKitGTK) and, in the same
  container image, locally.
  - **ALWAYS run e2e through Docker (`pnpm test:e2e:docker …`), never
    natively.** No host runs, no UI window. `test:e2e` /
    `test:e2e:build` / `test:e2e:run` are the primitives the container runs:
    `test:e2e:build` is a tauri debug build with `--features
    tauri/custom-protocol --config src-tauri/tauri.e2e.conf.json` snapshotting
    the binary to gitignored `e2e/.bin/`, `test:e2e:run` is wdio against that
    snapshot. Invoke them via the Docker wrapper, not directly.
  - **When to run e2e:** only once you're DONE developing a change — not on
    every edit during active development. And run ONLY the spec file(s)
    relevant to what you touched, not the whole suite. CI runs the full suite
    on the PR.
  - **How to run the relevant spec(s):** after a src/ or src-tauri/ change,
    rebuild this worktree's snapshot once with `pnpm test:e2e:docker build`,
    then run just the affected spec(s): `pnpm test:e2e:docker run --spec
    e2e/specs/<file>.e2e.ts` (repeat `--spec` for more). A spec-only change
    skips the rebuild — run `pnpm test:e2e:docker run --spec …` directly.
    `pnpm test:e2e:docker full --spec …` does build + run in one shot. Never
    rely on a stale snapshot: the `run` phase silently tests the old binary if
    you skipped the rebuild.
  - **Before writing or debugging any e2e spec, read the `e2e-testing`
    project skill** (`.claude/skills/e2e-testing/SKILL.md`) — selector
    conventions and traps, driver-bridge/5s-penalty rules, native-dialog
    stubbing, fixture geometry gotchas, rebuild discipline, debugging flow.
  - Opening a SECOND repository in e2e goes through `seedOpenRepos()`
    (`pg-open-repos` + a reload), never the `+` button or ⌘O: those raise the
    real OS folder picker, which WebDriver cannot drive. Match a tab with
    `repoTab(path)`, which keys on the path's TAIL — `open_repo` returns the
    canonicalised workdir, and on macOS `tmpdir()`'s `/var/folders/…` comes back
    as `/private/var/folders/…`.
  - `reopenRepo()` reloads WITHOUT clearing localStorage, so the session restore
    may already have the repository open; it waits for the branch chip OR the
    recent-repo row and only clicks the row when there is one.
  - `stubNativeDialogs()` keeps its name and options but no longer stubs
    natives: since #61 C3 confirms/prompts are real in-page modals
    (`[data-pg-dialog]`, `data-pg-dialog-kind`), so it installs an observer
    that answers each one as it appears. Call sites are unchanged;
    `confirmCallCount()` still counts confirm dialogs only.
  - CI: `.github/workflows/e2e.yml` (ubuntu-latest + xvfb, PRs to `main` +
    push to `main`). Local runs use `pnpm test:e2e:docker` (same WebKitGTK +
    xvfb stack) — see the "Headless e2e in Docker" section above.
  - `pnpm.overrides["@wdio/native-utils"] = "2.5.0"` pins around a broken
    dep pin in `@wdio/tauri-service@1.2.0` — don't remove.
  - Only `e2e`-feature builds serve WebDriver on port 4445 (the plugin is now
    gated behind the `e2e` cargo feature, so a plain `pnpm tauri dev` no longer
    opens it). Still: don't leave a prior e2e binary running when starting a new
    e2e run, or the runner may attach to it and clear its `localStorage`.
  - `e2e/wdio.conf.ts` sets `PLATYPUSGIT_NO_SINGLE_INSTANCE=1` before the app
    launches — without it, `tauri-plugin-single-instance` would forward a
    test binary's launch into any already-running platypusgit instance
    instead of serving WebDriver.
  - Multi-window specs (`merge-window.e2e.ts` drives the `merge` resolver
    window) are one concrete reason for the Docker-only rule: reliable on
    Linux/WebKitGTK, broken on a macOS-native run, where WKWebView's
    foreground-focus self-heal can't hold a consistent active window across the
    second window's open/transition/close (`switchWindow` → "No window could be
    found").

### What CI runs

Two workflows cover the four layers, both on PRs to `main`, pushes to `main`,
and `workflow_dispatch`:

- `.github/workflows/tests.yml` — the `unit` job (`pnpm tsc --noEmit`,
  `pnpm test`, and `pnpm exec tsc -p e2e/tsconfig.json --noEmit`, which is the
  ONLY place the e2e specs are typechecked since the root tsconfig excludes
  `e2e/`) and the `rust` job (`cargo test`). The Rust job installs e2e.yml's
  Tauri `-dev` packages because linking the crate needs them, but no xvfb: the
  integration tests drive libgit2 against temp repos, with no window and no
  network.
- `.github/workflows/e2e.yml` — the webview suite.

Each workflow front-loads a `changes` job that diffs against the PR base and
skips suites the change cannot affect, then reports through an always-running
gate job (`unit-tests`, `rust-tests`, `e2e-linux`). **The gate is what a branch
ruleset should require, never the worker job** — a required check that gets
skipped never reports and blocks the PR forever. The gate also fails on a skip
it cannot explain, so a green tick means the suite ran or was provably
irrelevant. On `push`/`workflow_dispatch` there is no reliable diff base, so
every filter output falls back to `true` and `main` is never left untested.

## Architecture

### Backend (`src-tauri/src/`)

```
error.rs         AppError enum (thiserror + serde-tagged) — ONLY error type crossing IPC
state.rs         AppState { backend: Arc<dyn GitBackend> }
opener.rs        Handing URLs/paths to the OS default handler. SECURITY-critical:
                 safe_url (parse + https-only + reject quotes/control chars),
                 safe_workdir_path (no absolute/`..` escape), and a spawn that
                 NEVER goes through a shell — no `cmd /C start`, and the child's
                 exit status is checked. Both open_url and open_in_editor use it.
update.rs        Update discovery — semver compare (semver crate, cmp_precedence),
                 dev-build (0.0.0) short-circuit BEFORE any network call,
                 GitHub release parsing, ureq agent w/ timeout + https_only
forge/           Forge (GitHub / GitLab) integration — PR/MR list, create, checkout,
                 CI status (#92). The trait is split into URL BUILDERS + RESPONSE
                 PARSERS, not `list_pull_requests()`, so every forge-specific line
                 is pure and testable against recorded JSON with no network:
├── mod.rs       ForgeKind/ForgeRepo/ForgeDetection/PullRequest/ChecksSummary/
│                NewPullRequest + the `Forge` trait, `forge_for(kind)`, and the
│                injection guards every URL and git argv goes through:
│                validate_host, encode_segment, validate_sha, validate_ref_name
├── remote.rs    parse_remote_url + detect. PURE. Handles scp-like SSH, ssh://,
│                http(s)://, git://, GitLab subgroups, self-hosted hosts. NOTE the
│                port asymmetry: an SSH port is DROPPED (it is not where the API
│                listens), an HTTPS port is KEPT (for self-hosted it is). A repo
│                with no parseable remote yields None — a STATE, not an error
├── token.rs     `Secret` (no Display, no Serialize, Debug prints `Secret(***)`),
│                `redact`, and storage delegated to the user's git credential
│                helper under `<host>.platypusgit-forge.invalid` (RFC 6761) —
│                see the token-storage note under Conventions
├── http.rs      The ONLY impure file: one ureq agent, https_only + timeout +
│                4MB body cap; 401/403 → ForgeAuth, other non-2xx → Forge with the
│                API's own message, everything scrub_credentials'd
├── github.rs    REST v3. api.github.com for github.com, /api/v3 for Enterprise
├── gitlab.rs    REST v4. Project id is the URL-encoded FULL PATH; MR create has
│                NO draft param — draft is a `Draft: ` title prefix
└── checkout.rs  The git half of "check out this PR": fetch_args / checkout_args /
                 branch_exists, split out so tests/forge_checkout.rs can drive
                 them against a real repo whose bare origin carries
                 refs/pull/1/head at a commit on no branch (the fork case).
                 The fetch writes NO ref (lands in FETCH_HEAD) — fetching into
                 refs/heads/<local> is refused for a checked-out branch and would
                 force-update someone's commits away. And do NOT pass `--` to
                 `git rev-parse`: after it everything is a PATH, so every branch
                 reads as absent (regression-tested)
lib.rs           Tauri builder + invoke_handler! registry (all commands listed there)
cli.rs           CLI arg parsing (LaunchIntent, parse_args, resolve_repo_root),
                 shim install/status helpers (install_shim, shim_status) —
                 not to be confused with git/cli.rs (CliBackend) below
git/
├── mod.rs       GitBackend trait — every git op, returns AppResult<T>
├── types.rs     RepoHandle, FileStatus, CommitInfo, BranchInfo, TagInfo, StashInfo,
│                RemoteInfo, FileDiff, BlameLine, ReflogEntry, RebaseStep, RepoState,
│                ConflictSides, CommitOptions, StashSaveOptions, TagTarget, ResetMode,
│                SubmoduleInfo/SubmoduleState, WorktreeInfo/WorktreeBranch,
│                LfsStatus/LfsFile/LfsPointer/LfsDiff, BisectStatus/BisectMark, etc.
├── libgit2.rs   Libgit2Backend — active impl, most ops real. NOTE: merge_branch
│                and rebase_onto shell out to real git, so a conflicted rebase is
│                git's on-disk state, not ours — continue/abort_operation detect
│                that (cli_rebase_in_progress) and hand off to `git rebase
│                --continue/--abort`. The libgit2 path would drop queued steps.
├── cli.rs       CliBackend — stub for ops libgit2 handles poorly (LFS, creds, complex merges).
│                Still 100% NotImplemented: the #93 shell-outs live in libgit2.rs
│                because they need the same opened `Repository` their neighbours do
├── submodule.rs SubmoduleStatus → the four `SubmoduleState`s (priority order:
│                uninitialized > pointer moved > dirty inside), the per-listing
│                declared-path set (free when there is no `.gitmodules`), and
│                `git submodule update`'s arg builder. libgit2 for list/init/sync;
│                update shells out because it FETCHES and credentials only flow
│                through the askpass subprocess env (#93)
├── worktree.rs  Linked worktrees: libgit2 for list/add/lock/unlock/prune (its
│                prune defaults ARE `git worktree prune`'s). `remove` shells out —
│                libgit2's only option is prune-with-WORKING_TREE, which deletes
│                the directory with NO dirty check; `git worktree remove` refuses
│                on uncommitted work, mapped to `DirtyWorktree` (#93)
├── lfs.rs       git-LFS. Pointer parsing + `lfs_diff_of` are PURE, derived from a
│                diff we already produced (a pointer is ≤3 lines, so it is all in
│                the diff's own lines — no extra I/O). "Does this repo use LFS" is
│                answered from `.gitattributes` via the INDEX, NOT `git lfs track`:
│                it must be answerable with the binary MISSING (#93)
├── stash.rs     Stash helpers that need no repository (#133): the `git stash
│                push` / `git stash store` argv builders (the `--` placement and
│                GIT_LITERAL_PATHSPECS live here), `validate_message`, and
│                `rename_store_landed` — the pure gate the rename's DROP is
│                conditioned on. All unit-tested with no temp repo
├── bisect.rs    Bisect. Reads GIT's own `.git/BISECT_*` + `refs/bisect/*` — there
│                is deliberately NO parallel state file (see the note below), and
│                progress comes from `git rev-list --bisect-vars`, git's own
│                arithmetic, so it is recomputable after a restart (#93)
├── ownership.rs libgit2's dubious-ownership refusal (GIT_EOWNER, git's
│                CVE-2022-24765 check — the WSL `/mnt/c` case): error mapping,
│                RepoPresence probe (Present/Absent/Refused — NEVER infer
│                "no repo" from a failed open), non-opening repo_root_for
│                walk, and the global `safe.directory` writer
├── rebase_plan.rs  Plan validation, run BEFORE `rebase_start` touches the repo:
│                merge-legal actions, duplicate/unknown oids, all-drop plans.
│                A rejected plan must leave HEAD, the branch ref, and the
│                worktree untouched — that is the whole point of the module
├── rebase_state.rs  On-disk mirror of an in-progress rebase
│                (`.git/platypusgit-rebase.json` + `ORIG_HEAD`) so Continue and
│                Abort survive an app restart, PLUS the last completed rebase's
│                summary in a SECOND file (`platypusgit-rebase-last.json`) —
│                separate because everything that asks "is a rebase in
│                progress?" answers by the first file's existence. Deliberately
│                NOT git's own `.git/rebase-merge/` dir — a half-compatible one
│                would let `git status` / `git rebase --continue` claim a rebase
│                they cannot drive
├── signing.rs   Object signing (#61 D6, #132). PURE: gpg.format → program →
│                user.signingkey resolution, `resolve_key_file` (the ssh
│                key-PATH restriction — `key::…` literals refused), the signer
│                argv, and `parse_verify_output` for git's `%G?` triple.
│                Format-agnostic about WHAT is signed — a commit buffer and a
│                tag body are both just payloads, which is why the tag path
│                reuses it whole instead of growing a second chain
├── tag.rs       Tag signing's pure half (#132): armor-header detection,
│                `append_signature`, `validate_tag_name` (the argv guard), and
│                `parse_verify_tag` for `git verify-tag --raw` — see the
│                tag-signing note under Conventions for why `%G?` can't be used
└── signature.rs Author/committer signature helpers
commands/        Thin Tauri handlers, one file per area:
├── repo.rs        open_repo, close_repo, trust_repo_path, get_status,
│                  list_all_files, read_file_content, append_gitignore,
│                  open_in_editor
├── cli.rs         take_launch_intent, cli_shim_status, install_cli_shim
├── commits.rs     get_log, commit, file_history. The `refspec` arg takes the
│                  `REFSPEC_ALL` sentinel ("--all", git's own spelling) meaning
│                  "walk every branch we know of" — local + remote-tracking heads
│                  plus a detached HEAD, one graph. History's default scope; the
│                  frontend mirrors it as `LOG_REF_ALL` in lib/types.ts.
│                  CONSEQUENCE: the loaded log is NOT HEAD's ancestry, so any
│                  rebase op must run it through `headAncestryOf` first (see
│                  features/commits/headAncestry.ts) — a plan built from the raw
│                  log replays another branch's commits onto the current one.
│                  Also `commits_between` (`base..tip`, NO ancestry requirement —
│                  `commits_since` refuses a non-ancestor base, which is right for
│                  a rebase base and wrong for two diverged branches) and
│                  `ahead_behind` (counts read FROM `a` TOWARD `b`, plus the merge
│                  base; unrelated histories are `mergeBase: null`, not an error).
├── diff.rs        get_diff, stage/unstage/discard_paths, stage/unstage/discard_hunk,
│                  diff_commits, diff_ref_to_workdir, blame_file
├── branches.rs    list_branches/tags/stashes/remotes, checkout/create/delete/rename_branch,
│                  fetch, fetch_all, pull, push, add/remove/rename/set_url/prune remote,
│                  create/delete/push_tag, verify_tag, merge_branch, rebase_onto,
│                  checkout_ref, push_delete_branch
├── history.rs     reset, cherry_pick, revert
├── stash.rs       stash_save/apply/pop/drop/branch, plus stash_save_paths
│                  (pathspec-scoped), stash_rename and stash_diff (#133)
├── conflict.rs    repo_state, conflict_sides, accept_ours/theirs, mark_resolved,
│                  save_resolution, abort/continue_operation, run_mergetool,
│                  restart_conflict
├── rebase.rs      rebase_start/continue/abort/status/acknowledge (interactive)
├── forge.rs       forge_detect, forge_sign_in/sign_out/token_status/validate_token,
│                  forge_list_pull_requests, forge_pull_request_checks,
│                  forge_create_pull_request, forge_checkout_pull_request.
│                  Owns `ForgeTokens` (managed per-process token cache) and
│                  `blocking_forge`, which redacts the token out of any error
├── reflog.rs      get_reflog, checkout_detached
├── submodule.rs   list_submodules, submodule_init/sync/update (the last takes
│                  `credentials` and retries through net::run_git_authenticated)
├── worktree.rs    list_worktrees, worktree_add/remove/lock/unlock/prune
├── lfs.rs         lfs_status, lfs_checkout (local), lfs_fetch/lfs_pull (network,
│                  credentialed like fetch/pull/push)
├── bisect.rs      bisect_status/start/mark/reset
└── create.rs      init_repo, default_init_branch, clone_repo (streaming
                   git clone → clone://progress events)
```

### Frontend (`src/`)

```
main.tsx             Entry point
App.tsx              Thin wrapper around <AppShell />
AppShell.tsx         Primary shell: titlebar (branch chip + picker, remote buttons),
                     repository tab strip, activity bar (screen switcher), status
                     bar, error banner, settings. Also owns the per-tab screen
                     (restore on switch) and keys the screen subtree by the
                     active repository so a switch REMOUNTS it
store.ts             Re-export hub (keep thin — no global Zustand composition)

design/              In-house design system (NOT components/ui/). Exports via design/index.ts.
├── primitives.tsx       PGButton, PGIconButton, etc.
├── chrome.tsx           PGTitlebar, PGTabStrip (repository tabs), PGActivityBar,
│                        PGStatusBar, PGStatusItem
├── git-components.tsx   Git-specific UI bits
├── icons.tsx            Icon set (name-based <PGIcon>), incl. file-type glyphs
├── context-menu.tsx     Context menu primitive
├── dialog.tsx           PGDialogHost + pgConfirm/pgPrompt — the ONLY confirm /
│                        prompt path (no window.confirm/prompt anywhere)
├── empty-state.tsx      Empty-state component
├── modal.tsx            PGModal — shared dialog shell
├── resizable.tsx        Resizable panes
├── ui-helpers.tsx       pgFlash, misc helpers
└── use-prevent-browser-context-menu.ts

screens/             One screen per activity-bar item + modal-ish deep views:
  RepoBrowser, CommitPanel, History, DiffViewer, Branches, Rebase,
  Remote, Pulls, Welcome, Reflog, CommitDiff, Compare, FileHistory, Blame,
  Submodules, Worktrees, Settings
                     There is deliberately NO Conflict screen (#108): conflicts
                     are announced by OperationBar and resolved in the merge
                     window. Nothing restores a screen from localStorage any
                     more, so retiring an id is just deleting it — but each TAB
                     remembers its screen for the session (see the navigation
                     model).

features/            Per-feature: components + Zustand store colocated
├── repo/            useRepoStore (the big one — but only ever ONE repository's
│                    state: the active tab's), repoSlice (RepoSlice /
│                    REPO_SLICE_KEYS / emptySlice — the multi-repo anti-leak
│                    contract), repoActivity (RepoActivity, split out so
│                    repoSlice needn't import the store), tabs.ts (pure tab-list
│                    reducers, `labelTabs`, `pg-open-repos` persistence),
│                    useTabsStore (the open set + activate/close/cycle + lazy
│                    session restore), RepoTabs (the strip's wiring + its context
│                    menu), useRecentsStore, ops (shared keymap/palette/titlebar
│                    runners), OperationBar (the `repoState !== "Clean"` bar under
│                    the titlebar: what operation is open, conflicts left,
│                    Resolve/Finish/Abort)
├── nav/             useNavStore — cross-screen intents (diff-file, commit-vs-wt,
│                    file-history, blame, rebase-plan, stash-diff)
├── branches/        BranchChip (titlebar), BranchPicker (popover)
├── commits/         graphLayout + buildRebasePlan (both tested)
├── rebase/          RebaseBasePicker + useRebaseMergeMode (persisted
│                    flatten ⇄ preserve for merge commits in a plan)
├── dnd/             ALL drag-and-drop (#91). `useDragSource` / `useDropZone`
│                    (useDnd.ts) over a module-level pointer gesture
│                    (dragController.ts); `resolveDrop.ts` holds the PURE
│                    staging + graph drop tables; `useRowReorder` (the rebase
│                    plan's reorder) lives here too; `StageDropBar` is the
│                    Files screen's drag-only Stage/Unstage targets.
│                    See the "Drag and drop" convention below.
├── reflog/          useReflogStore, DirtyTreeDialog, ReflogActionDialog
├── settings/        useSettingsStore (autoFetch, defaultPullMode, etc.),
│                    headMarks (the HEAD row treatment: independent marks ×
│                    one weight, resolved to draw numbers by resolveHeadDecor —
│                    zero means "don't draw", so PGCommitRow never reads the
│                    mark list) + HeadMarksControl (checkbox grid, weight knob,
│                    and a live preview built from the real PGCommitRow)
├── palette/         usePaletteStore (step stack + chips), commands (catalog),
│                    frecency, CommandPalette (⌘P runner: nav + search + actions;
│                    rows show live keymap chords via PaletteItem.actionId)
├── keymap/          Keyboard system (specs/2026-07-02-keyboard-navigation-v2 +
│                    specs/2026-07-06-keymap-power-shortcuts):
│                    actions.ts (catalog + default runners), presets.ts (rider
│                    default + classic), useKeymapStore (dispatcher: pane-scope
│                    enforcement, DoubleShift, input policy, speed-search
│                    fallback), useFocusStore (spatial Alt+Arrow + Tab cycling),
│                    usePaneList (list nav + type-to-jump speed-search),
│                    useHunkNav (F7/⇧F7 diff hunks), useDiffLineFocus (the
│                    diff pane's per-LINE cursor + Space, see below),
│                    useSpeedSearchStore, PGPane / FocusableScroll / CheatSheet
├── merge/           Merge resolver window — separate Tauri window (label
│                    "merge"), routed via ?window=merge in main.tsx. mergeModel
│                    (diff3 chunking, node-diff3), resultEditor (CM6 result pane
│                    w/ tracked conflict regions), MergeWindow/MergeBody/SidePane
│                    (Rider 3-pane: ours | editable result | theirs), chevron +
│                    F7/⌘1-3/⌘↵ chords, openMergeWindow (opener; path optional —
│                    no path opens on the list), FileList (conflicted-file
│                    sidebar + its own menu — this window's store has no open
│                    repo, so it uses IPC wrappers, never useRepoStore/
│                    conflictMenuItems). Applies via save_resolution, emits
│                    merge://resolved → main refreshes.
├── update/          useUpdateStore (discovery, semver-aware dismiss memory,
│                    self-update install w/ its own `installing` flag),
│                    semver.ts (§11 precedence, hand-rolled + tested),
│                    UpdateChip (titlebar), UpdatePanel (Escape via the
│                    keymap's app.closeOverlay, not a local listener)
├── auth/            Credential challenge/retry (#61 D5): useAuthStore (the one
│                    pending challenge + the retry closure its raiser supplies —
│                    deliberately NOT the secret) + CredentialDialog. The retry
│                    helper is `withAuthRetry`, which LIVES IN useRepoStore.ts
│                    and is exported so another feature store can reuse it
│                    rather than grow a second retry path (useForgeStore.checkout
│                    fetches a PR head ref, #92). It resolves as soon as it
│                    RAISES a challenge, so a caller that needs to distinguish
│                    "prompt is up" from "op failed" cannot use a boolean — see
│                    `CheckoutOutcome`. useCreateStore hand-rolls the same shape
│                    for clone because it must drop `busy` before prompting and
│                    only has a repo id after the clone succeeds.
├── create/          Clone + Init dialogs (PGModal), useCreateStore,
│                    deriveRepoName. Clone shells out to real git with the
│                    same prompt-less env as fetch/pull/push.
├── forge/           PR/MR feature (#92): useForgeStore (detection, list, checks,
│                    create, checkout, sign-in/out; hostKinds+logins persisted
│                    under `pg-forge-hosts`, NEVER a token), forgeLabels (pure:
│                    prNoun/prNumberLabel per forge — `!7` on GitLab, `#7` on
│                    GitHub — and localBranchFor, which numbers a FORK request
│                    instead of reusing its branch name), PullRequestRow,
│                    CreatePullRequestDialog, ForgeSettings (rendered inside the
│                    Settings screen; state lives here because an account list is
│                    not a preference)
├── compare/         Branch compare (#131): compareSides (PURE — CompareSide,
│                    labels, the "workdir cannot be the left side" swap rule; the
│                    nav store imports the TYPE from here, so nav never depends on
│                    a feature store), useCompareStore (sides + results + the
│                    compare mark, its own store so RepoSlice is untouched),
│                    CompareSidePicker
├── diff/            CommitDiffPanel (shared commit-diff view) + WhitespaceToggle
│                    (ignore-whitespace control; also owns
│                    useHunkActionsDisabledReason — hunk staging is disabled
│                    while whitespace is ignored, see #61 D2)
├── submodules/      useSubmodulesStore (list + init/sync/update, persisted
│                    `recursive` toggle). Update goes through useRepoStore's
│                    exported `withAuthRetry` — one credential flow, not two (#93)
├── worktrees/       useWorktreesStore + WorktreeAddDialog. The store owns the
│                    destructive flows so the screen and the row menu cannot drift:
│                    remove is a `pgConfirm`, and git's `DirtyWorktree` refusal
│                    becomes a SECOND, `requireText` confirm that passes --force
├── signing/         SignatureBadgeView + useLazyVerification (the shared
│                    debounce-then-verify), SignatureBadge (commits, #61 D6) and
│                    TagSignatureBadge (tags, #132). Both verify ONE object, for
│                    the current selection — never per row
├── tags/            useCreateTagStore + CreateTagDialog (#132): name +
│                    annotation + three-state sign, mounted once in AppShell.
│                    Store-driven and promise-shaped because two of its three
│                    call sites (a context-menu item builder and a palette step)
│                    are not React components
├── lfs/             useLfsStore, LfsPanel (a section on the REMOTE screen, not a
│                    screen — `git lfs fetch/pull` are remote-object transfers),
│                    LfsDiffNotice (what all four diff surfaces render instead of
│                    pointer text) (#93)
└── cli/             useCliLaunch — takes the stashed first-launch intent +
                     listens for forwarded `cli-launch` events, opens/focuses a
                     TAB (`useTabsStore.openRepo`, so a forwarded `pgit <path>`
                     no longer evicts the current repo) + nav screen-switch intent

lib/
├── tauri.ts         Typed invoke() wrappers — frontend NEVER calls invoke() directly
├── types.ts         Shared types mirroring Rust types.rs
├── errors.ts        AppError discriminated union 1:1 with Rust enum
├── derive.ts        Selectors: currentBranch, isStaged, isUnstaged, totalAheadBehind, …
├── syntax/          Shiki highlighting, OFF the main thread (see below)
│   ├── tokenizeCore.ts   Shiki-FREE: SyntaxLine/SyntaxToken, MAX_HIGHLIGHT_*,
│   │                     toLineRelative, packLines/unpackLines, skipHighlight
│   ├── tokenizeShiki.ts  The one place codeToTokens is called
│   ├── tokenize.worker.ts  Module worker running tokenizeShiki
│   ├── tokenize.ts       Main-thread API: LRU cache + worker client + fallback.
│   │                     `tokenizeFile(path, text)` — null means render plain
│   ├── useSyntax.ts / useDiffSyntax.ts  Hooks; useDiffSyntax also EXPOSES the
│   │                     texts it reads, which whole-file mode fills gaps from
│   └── usePrefetchSyntax.ts  Bounded idle warm-up of a commit's other files
├── diffRows.ts      Flat DiffRow model (header | line | fill) + exact
│                    variable-height window. `fill` = whole-file gap filler
├── useViewportH.ts  Scroll-container height WITHOUT depending on ResizeObserver
├── useWindowedList.ts  Fixed-pitch windowing for the plain lists
├── fileIcon.ts      path → file-type glyph + themeable tint (tested)
├── selection.ts     Multi-select click/range/prune model AND
│                    `splitFileSelection` — the one place a multi-selection is
│                    bucketed into staged/unstaged/untracked/embedded paths for
│                    `multiFileMenuItems`. Each surface supplies only its own
│                    key→row lookup (`sidedSelectionSource` for the commit
│                    panel's `side:path` keys, `treeSelectionSource` for the
│                    repo browser's `/a/b` tree keys); folder expansion and
│                    embedded-repo bucketing live in the shared splitter
├── tree.ts          buildStatusTree / buildStatusList — SAME row keys, which is
│                    what makes the tree⇄flat toggle free of per-mode branches
├── useTreeViewMode.ts  Persisted tree|flat preference, one key per surface
└── recents.ts       Recent-repo persistence (`pg-recent-repos`). The OPEN set is
                     a separate key, `pg-open-repos`, in features/repo/tabs.ts —
                     recents are where you have been, the open set where you are
```

### Diff rendering

- **One row model, one renderer.** `flattenDiffRows` (`lib/diffRows.ts`) turns a
  `FileDiff` into a flat `DiffRow[]`; `PGWindowedDiff` renders it. All four diff
  surfaces (Diff screen, commit panel, repo browser, commit-diff panel) go
  through both, so word spans, syntax, staging and F7 cannot drift between them.
- **Whole file is the default view** (`diffContextMode: "wholeFile"`), and it is
  composed on the FRONTEND: the canonical diff is left exactly as fetched and the
  unchanged remainder is filled in around it as `fill` rows, from text
  `useDiffSyntax` already read. **Never get whole-file by passing a large
  `contextLines`** — libgit2 would return one hunk covering the file, so
  `stage_hunk` would stage everything and `changedIndex` would shift. `fill` is a
  distinct row kind with no `hunkIndex` precisely so it cannot reach a staging
  path. Any inconsistent gap arithmetic degrades to chunked rather than render
  wrong line numbers; git's `+N,0` convention (the line BEFORE) is normalized in
  `effStart`, or every filler number after such a hunk shifts by one.
- **Hunk headers stay in whole-file mode.** They carry Stage/Discard, the
  collapse chevron, `data-hunk-index` for F7, and the e2e selectors.
- **`diff_ref_to_workdir` is a shared primitive, not compare's helper** (#131).
  Arbitrary revspec vs the working tree, with the same `context_lines` /
  `ignore_whitespace` knobs the other diff ops take, plus an explicit
  `include_untracked`. It uses `diff_tree_to_workdir_with_index`, NOT the plain
  tree-to-workdir: without the index a file staged and then reverted in the
  worktree reads as unchanged. The compare view passes `include_untracked: true`
  — this backend's own worktree diff kinds already include untracked content, so
  hiding a file you just wrote would make ref↔worktree the one worktree diff in
  the app that lies by omission; `.gitignore`d files stay out either way.
- **But its untracked SCOPE is nothing like `diff`'s, and that is why it is
  bounded.** `diff` calls `opts.pathspec(path)` BEFORE turning untracked content
  on, so it only ever reads one untracked file; `diff_ref_to_workdir` walks the
  whole tree, and an untracked `dist/`, `.venv/` or downloaded dataset that
  nobody `.gitignore`d would otherwise land in one IPC payload and one `DiffRow`
  model per file. So it returns `WorkdirDiff { files, untracked_omitted }`, not a
  bare `Vec<FileDiff>`: over `MAX_UNTRACKED_FILES` the untracked side is dropped
  WHOLE and the count is reported (the compare screen renders it), and
  `MAX_WORKDIR_BLOB` caps per-blob size so one enormous file reads as binary.
  Truncating silently would be worse than the overflow — do not "simplify" the
  return type back.
- **Gate text rendering on `isTextualDiff(diff)`, not `!diff.binary`** (#93). A
  git-LFS pointer IS text, so `binary` is honestly false — rendering its hunks
  claims "2 lines changed" for a multi-megabyte asset. All four diff surfaces use
  the shared gate and render the shared `LfsDiffNotice` instead; `binary` is
  deliberately not overloaded, because other code trusts what it means.
- **Tokenization runs in a module worker.** Shiki's `codeToTokens` is synchronous
  CPU work, so awaiting it on the main thread still janked. Tokens come back
  packed into transferable `Int32Array`s rather than one object per token.
  `vite.config.ts` sets **`worker: { format: "es" }`** — Shiki's grammars are
  dynamic imports, so the worker bundle is code-split and Vite's default `iife`
  worker format fails the production build outright. A failed worker degrades to
  main-thread tokenizing, which is also the path jsdom component tests take.
- **Do not measure a scroll viewport behind a `typeof ResizeObserver` guard.**
  WebKitGTK 605 (the Linux webview, and the e2e target) has none; guarding before
  the initial measurement leaves the height 0, `windowVariable` falls back to a
  400px viewport, and the bottom of a taller pane renders blank. Use
  `lib/useViewportH.ts`.
- **Two cursors, two index spaces, and they must not be confused.** `useHunkNav`
  keeps a HUNK cursor (F7/⇧F7, rendered as `data-hunk-active`);
  `useDiffLineFocus` keeps a per-LINE cursor (list-nav chords + Space, rendered
  as `data-focused`). A `DiffLineTarget` carries BOTH numbers because they are
  different things: `rowIndex` addresses the flat `DiffRow[]` (what the focus ring
  and `scrollTopForRow` use) and `changedIndex` addresses the hunk's changed
  (`+`/`-`) lines (the ONLY value `stage_lines`/`unstage_lines`/`discard_lines`
  accept). The line cursor deliberately walks changed lines only — context and
  `fill` rows are unstageable, and skipping them is what keeps one mapping instead
  of two. Never derive a backend index from a row index or vice versa; read
  `changedIndex` off the row, where `flattenDiffRows` put it.
- **Scroll a diff row into view BY OFFSET** (`scrollTopForRow`), never by
  `querySelector` + `scrollIntoView`: the row is usually unmounted under
  windowing, so the DOM route silently does nothing (the #68 G10 trap). It
  no-ops for an out-of-range index or an unmeasured viewport rather than jumping
  to the top.
- **Line ops inherit the ignore-whitespace gate.** That flag rewrites hunk
  boundaries, so both the click path and the keyboard cursor are switched off by
  `useHunkActionsDisabledReason` — the keyboard must never reach what the mouse
  cannot (#61 D2).

### Navigation model

- Activity bar = primary screen switcher, History first. **Launch always lands
  on History** — there is no screen restore (the old `localStorage["pg-screen"]`
  read AND write are gone; nothing else uses the key). A tab restored from
  `pg-open-repos` is created on History too, so the open set persisting does not
  resurrect screen restore.
- **Repositories are tabs (#90).** The strip is its own row below the titlebar
  (`PGTabStrip`, wired by `features/repo/RepoTabs`), rendered only when a
  repository is open. Opening a repository ANYWHERE — ⌘O, a recents row, a clone,
  an init, a forwarded `pgit …` — goes through `useTabsStore.openRepo`, which
  focuses the existing tab for that path or adds one. `useRepoStore.openRepo` no
  longer exists; the low-level half is `openRepoAt`.
- **Each tab remembers its own screen, within the session only.** `enterScreen`
  writes it (`useTabsStore.rememberScreen`); an effect on `activePath` restores
  it, skipping first mount. Selections and scroll are NOT preserved: the screen
  container is keyed by the active repository, so a switch remounts it. That is
  deliberate — a retained selected-oid or selected-path from another repository
  would render the wrong thing, or diff it.
- **Tab chords** (`features/keymap`): `tab.next`/`tab.prev` (`Ctrl+Tab` /
  `Mod+Tab`, both spellings so one table works on every platform),
  `tab.close` (`Ctrl+W` / `Mod+W`), `tab.select` (`Alt+1`…`Alt+9` — one action
  bound to nine chords, reading its digit from the chord the dispatcher passes to
  `run`), `tab.switch` (`Mod+E`, the palette's repository switcher). The strip is
  chrome, not a `PGPane` — it stays out of the `Alt+Arrow` spatial graph, like the
  titlebar and status bar.
- **`tab.select` carries `suppressInInput`, and must keep it.** `hasRealModifier`
  makes every `Alt+…` chord dispatch while typing, but ⌥+digit IS a character on
  macOS — and on Nordic layouts one people type — so claiming it would silently
  eat keystrokes in the commit box. Same opt-out `pane.focus*` uses for ⌥←/⌥→.
  Any future bare-`Alt`+printable binding needs the same flag.
- **Screen entry focuses the screen's primary pane.** One `<PGPane primary>` per
  screen (History's commit list, Files' tree, …) declares it; `useFocusStore`
  holds it as `primaryId`, and it outranks both mount order and geometry for two
  moments: entering a screen, and Alt+Right off the activity bar (from a
  full-height bar the geometrically nearest pane to the right is often a bottom
  detail panel — never what "go into this screen" means). Ordinary Alt+Arrow
  moves stay geometric. Screen entry is counted by `entryTick` so re-picking the
  CURRENT screen re-enters it: an activity-bar click moves DOM focus to that
  button, and with a `[screen]`-only effect focus stayed stranded on the bar and
  every list chord went nowhere.
- Keyboard: everything routes through `features/keymap` (action catalog +
  preset bindings; rider preset default). Modifier chords work while typing;
  bare keys don't. `?` opens the cheat-sheet. `view.zoom*` (Mod+= / Mod+- /
  Mod+0) scales the UI through the WEBVIEW's own zoom (`applyZoom`, persisted as
  `uiZoom`), not a CSS transform — needs `core:webview:allow-set-webview-zoom`.
- **Two PANE-scoped actions may share one chord; two global ones may not.** The
  dispatcher's reverse map is `chord → ActionId[]` and it tries each id in turn,
  so a declined action falls through to the next — `Space` is `list.toggle` in a
  list pane and `diff.toggleLine` in the diff pane, resolved purely by which pane
  holds focus. `presets.test.ts` enforces exactly that asymmetry, so prefer a
  second catalog entry over hanging a second meaning off one action id: the cheat
  sheet and palette then name each behavior in its own category, and the two can
  be rebound apart. Register the pane handler as declining (`() => false`) when it
  has nothing to act on, or it swallows the chord from the other action.
- `useNavStore.intent` drives deep-view switches (e.g. "show this commit's diff" → sets screen to `commitDiff`). Consumers write an intent; `AppShell` effect routes the screen.
- **Compare is a deep view, not an activity-bar screen** (#131). `ref-compare`
  routes to `compare`; the intent carries the two sides for readability but the
  SCREEN reads them from `useCompareStore`, because they stay mutable once you
  are there — which is also why it is not a fifth `Target` in `CommitDiff.tsx`
  (that union is oid-shaped and immutable once routed, and "working tree" has no
  oid). A working-tree side is right-hand ONLY: it is not a commit, so
  `left..workdir` is neither countable nor walkable, and the ahead/behind summary
  and both commit lists are ABSENT rather than zeroed.
- **A stash comparison is two `CommitDiff` targets, not a `compare` side**
  (#133). `stash-diff` is the entry against its own FIRST PARENT ("what it
  changed"), `stash-vs-wt` is it against the working tree through the shared
  `diff_ref_to_workdir`. Both stay in `CommitDiff` because a stash commit's
  parents are three different commits, so `compare`'s rev↔rev half would walk
  the index and untracked commits as history and announce a stash as "3 commits
  ahead". `CommitDiff`'s oid-shaped `Target` is not violated: the STASH is the
  oid, and the target is still immutable once routed.
- Settings is a screen too, reached via titlebar gear or activity-bar settings slot.
- Conflicts are NOT a destination: `OperationBar` (driven by `repoState`), the
  status-bar conflict count, `⌘5`/`conflict.openResolver` and a conflicted row's
  context menu all open the merge resolver window instead (#108).
- **Bisect is not a destination either** (#93). It is a `repoState`, so
  `OperationBar` owns it: its own `OpKind` with Good/Bad/Skip/**Reset**, and git's
  own progress numbers. Reset REPLACES the generic Abort for this state —
  `abort_operation` hard-resets to HEAD, and mid-bisect HEAD is the detached
  commit being tested, so the bar's one previous button was actively harmful.
  Entry points: the History commit menu's Bisect submenu, a two-commit selection,
  and the palette. **No keyboard chords for bisect on purpose:** every catalog
  action must be bound in both presets, the ⌘1–9 row is full, and a bare-chord
  misfire mid-bisect corrupts the search with no undo short of a reset.
- `submodules` (⌘⇧8) and `worktrees` (⌘⇧7) are activity-bar screens, same chord in
  both presets. They are empty for most repositories and that is deliberate: a
  conditional entry would move the bar's geometry under the user between repos.
  **LFS is a panel on the Remote screen, not a screen** — `git lfs fetch/pull`
  are remote-object transfers whose endpoint comes from the remote URL.

## Conventions

### Errors
- **Rust:** every IPC-crossing fn returns `AppResult<T> = Result<T, AppError>`. No unwrap/panic in commands. Add `AppError` variants rather than stringifying.
- **TS:** `AppError` union in `src/lib/errors.ts` stays 1:1 with Rust enum. New Rust variant → update TS same commit.
- Wire format: `{ kind, message }` via `#[serde(tag = "kind", content = "message")]`. Consumers narrow on `kind`.
- Some variants carry an IDENTIFIER, not prose — `Auth` (a struct), `ForgeAuth`
  (a host), `BranchExists` (a branch name). `appErrorMessage` renders each into a
  sentence; a new variant of that shape needs a case there, or the banner reads
  `github.com`.
- `ForgeAuth` is deliberately separate from `Auth`: `Auth` means "git needs a
  credential for this remote, prompt and retry", so reusing it for a bad API token
  would pop the transport-credential dialog for a problem only Settings can fix.

### Forge tokens are NOT git credentials (#92)
- `commands/net.rs::Credentials` answers git's askpass prompt for one
  fetch/push. A forge API token authenticates an HTTP header for a host's API and
  is kept until removed. **They share no struct, no storage key, and no code
  path** — do not extend `Credentials` for a forge.
- Storage is still delegated to the user's own git credential helper, but under
  `protocol=https`, `host=<forge-host>.platypusgit-forge.invalid`,
  `username=platypusgit-forge`. The `.invalid` namespacing is load-bearing:
  GitLab's API and its git transport share one host (`gitlab.com/api/v4`), as
  does GitHub Enterprise, so keying on the bare host would **overwrite the
  credential the user pushes with**. `.invalid` is RFC 6761-reserved, so no git
  remote can ever ask for it. A custom `protocol=` was tried and rejected:
  `git-credential-osxkeychain` silently `exit(0)`s on an unknown protocol.
- `git credential` runs with cwd = the OS temp dir, so a repo-local
  `credential.helper` cannot redirect where a token is read from or stored.
- `store_token` **round-trips** (`approve` → `fill` → compare) and raises
  `ForgeTokenStore` naming the remedy when the token did not stick. Unlike D5,
  storage here cannot be best-effort: a silently lost token means the user typed a
  secret into a box for nothing.
- A token is a `forge::token::Secret`: no `Display`, no `Serialize`, `Debug`
  prints `Secret(***)`. `expose()` has exactly two call sites (the auth header,
  and the credential-protocol writer). Grep for it before adding a third.
- No command returns a token. `forge_token_status` reports presence + login.
- `LfsUnavailable` is a **state, not a failure** (#93): the UI disables the LFS
  actions and explains, so git's `'lfs' is not a git command` can never reach an
  error banner. `NoBisect` likewise means "refresh", not "alarm". `DirtyWorktree`
  is reused for `git worktree remove`'s refusal, which is what turns into the
  second, type-the-name confirm.

### Adding a new git op (standard path)
1. Add method to `GitBackend` trait (`src-tauri/src/git/mod.rs`).
2. Implement in `Libgit2Backend` (`libgit2.rs`). Stub in `CliBackend` too (`NotImplemented`) — keeps trait shape exercised.
3. Tauri command in right `commands/<area>.rs`. Keep thin. Wrap git2 calls in `tokio::task::spawn_blocking` (libgit2 is sync).
4. Register command name in `invoke_handler![…]` in `src-tauri/src/lib.rs`.
5. Add TS type to `src/lib/types.ts`, wrapper to `src/lib/tauri.ts`.
6. Wire into relevant feature's Zustand store.

### State management
- **Zustand per-feature**, not one big global store. `useRepoStore` lives in `features/repo/` because that's who owns the state.
- **`useRepoStore` holds exactly ONE repository's live state: the active tab's**
  (#90). `useTabsStore` owns the open set and freezes each inactive tab's slice;
  switching is snapshot → hydrate → `refreshAll`. Screens keep reading
  `s.status` / `s.commits` / `s.branches` and calling the same actions — they
  never learn there is more than one repository open. Consequence: a background
  tab's data is frozen at the moment you left it (no N-way log walks); its badge
  is re-read on window focus by `refreshBadges`.
- **Hydration is a TOTAL write, and `REPO_SLICE_KEYS` is what makes it one.**
  `features/repo/repoSlice.ts` declares every non-function field of the store;
  `repoSlice.test.ts` derives the live keys at runtime and fails if they diverge.
  **A new per-repo store field must be added to `RepoSlice`/`emptySlice`** or
  hydration silently degrades to a patch and the previous repository's value
  survives into the next tab. `emptySlice()` is also the store's initial state and
  what `closeRepo()` resets to — one definition, not three.
- **Every fetch/error write in `useRepoStore` goes through `setFor(repoId, …)` /
  `setErrorFor(repoId, …)`.** A switch is atomic but the requests in flight are
  not: an unguarded `refreshAll` for repo A can resolve after the user moved to B
  and write A's status, log and branches into B's slice. Same idea as the existing
  `logRef`/`commitFilter` staleness guards, on repo identity. `useTabsStore`
  carries the matching `activationSeq` guard for its own awaits.
- **The dependency runs one way: `useTabsStore` → `useRepoStore`.** Don't import
  the tab store from the repo store; the pure halves (`tabs.ts`, `repoSlice.ts`)
  exist so neither needs to.
- **Closing a tab evicts the repository backend-side** (`close_repo`). `open`
  mints a fresh `RepoId` per call and nothing else removes an entry, so without
  it every open leaks a `git2::Repository` and its file handles for the process
  lifetime. Closing an unknown or already-closed id is a silent success by
  contract; `close` deliberately leaves the `rebases` map alone (rehydratable
  from `.git/platypusgit-rebase.json`).
- **Closing a tab the merge resolver is using confirms first, then closes the
  resolver, then evicts.** The resolver is a separate window driving IPC with that
  `RepoId`, so evicting underneath it would fail its next call with `UnknownRepo`
  mid-resolution. `mergeWindowHoldsRepo` / `closeMergeWindow`
  (`features/merge/openMergeWindow.ts`) own that handshake — the latter waits for
  the window label to disappear, because `close()` resolves when the request is
  delivered, not when the window is gone. A live resolver this page instance
  cannot attribute (main reloaded under it) counts as a match on purpose.
- **Danger-op error paths refresh first, set error last.** In `useRepoStore` catch arms (see `mergeBranch`), call `refreshAll()` BEFORE `set({ error })`: `refreshAll` starts with `set({ error: null })`, and React 18 batches same-tick sets, so the opposite order silently wipes the banner. `refreshAll` never rethrows, so the error always wins when set last. A failed git op must still refresh — the UI reflects disk truth even on error.
- `useNavStore` handles cross-screen navigation intents — add new `NavIntent` kinds there, route in `AppShell`.
- Cross-feature state is rare; compose in `src/store.ts` if needed — don't hoist prematurely.

### Interactive rebase engine
- **The plan is validated before the repository is touched.**
  `rebase_plan::validate` runs first in `rebase_start`; anything it rejects
  raises `AppError::InvalidRebasePlan` with HEAD, the branch ref, and the
  worktree untouched. Before this, an unexecutable step (a merge commit, which
  libgit2 refuses to cherry-pick without a mainline) surfaced mid-replay with
  earlier picks already committed and the branch tip already moved.
- **The replay runs on a detached HEAD** and moves the branch ref exactly once,
  when the plan completes (`finish_rebase`). So a failed or paused rebase never
  leaves the branch mid-replay, and `rebase_abort` is "put HEAD back on the
  branch" rather than a reset to a remembered oid.
- **`RebaseState.rewritten` maps original oid → replayed oid** for every step
  that ran, recorded *after* the action's post-commit rewrite (reword amends,
  squash/fixup collapse), and a dropped step maps to the HEAD it left behind.
- **Merge commits in a plan take one of three actions**: `Drop` (flatten — git's
  own default: the merge disappears and its commits are replayed individually),
  `MainlinePick` (keep the merge as one ordinary commit — `git cherry-pick -m 1`,
  so `start_pick` passes mainline 1), or `Merge` (recreate it from its rewritten
  parents — the `--rebase-merges` equivalent). `rebase_plan::merge_legal` is the
  single source of truth; `MERGE_ACTIONS_FLATTEN` / `MERGE_ACTIONS_PRESERVE` in
  `src/screens/Rebase.tsx` mirror it per mode, and they must stay in sync or the
  UI offers an action the backend refuses.
- **Plans carry topology structurally, not as git's todo language.** A
  `RebaseStep` may name the original commit it is applied `onto` (resolved
  through the engine's rewritten map, so every commit is implicitly its own
  label), and a `Merge` step carries its original parents beyond the first. A
  plan whose steps all leave `onto: null` is the linear default. There are no
  `label` / `reset` / `exec` steps and no `rebase-cousins` mode — a generated
  plan does not need the naming layer.
- **A recreated merge runs in the worktree** (`repo.merge`, not
  `merge_commits`), so a conflict lands in the index with stages and
  `conflict_sides`, the Conflict screen, and the merge resolver window all work
  unchanged; `rebase_continue` then commits the resolution with both parents.
  Conflict resolutions inside the ORIGINAL merge are not reused — neither does
  git. Octopus merges cannot be recreated; they can be dropped or kept as one
  commit.
- **Preserve mode disables reordering** (git documents its own reorder bugs
  under `--rebase-merges`), and it rebuilds a whole-range plan in place while
  deliberately leaving a targeted plan (squash/fixup/reword) alone — rebuilding
  one would discard the message the user typed.
- **`PGRebaseRow` speaks exact `RebaseAction` strings** (`"Pick"`, `"Drop"`,
  `"MainlinePick"`), not lowercased ones — a two-word action cannot survive a
  lowercase/re-capitalise round trip. E2E specs that drive the row's `<select>`
  in-page must set the exact value.
- **Every transition is mirrored to `.git/platypusgit-rebase.json`**, and
  `rebase_status` / `repo_state` fall back to it when this process did not start
  the rebase. `repo_state` gives the file precedence over libgit2's
  `repo.state()`, which only sees the `CHERRY_PICK_HEAD` a paused step leaves
  behind.
- **A finished rebase leaves a summary the BACKEND retains until acknowledged**
  (`RebaseStatus.last_completed`, `.git/platypusgit-rebase-last.json`). The
  engine sweeps `RebaseState` the instant a plan completes, so the next
  `rebase_status` poll reports `total: 0`; the frontend used to cache the final
  status for its "N steps completed" line and therefore had to clear that cache
  on every abort and start path (#47). Now `rebase_start` and `rebase_abort`
  drop the summary in the engine and `rebase_acknowledge` spends it — the
  Rebase screen renders straight from `rebaseStatus.lastCompleted` and
  acknowledges on unmount, holding no copy of its own.
- **`continue_operation` / `abort_operation` delegate** to `rebase_continue` /
  `rebase_abort` whenever a rebase is in progress. The Conflict screen and the
  Rebase banner must stay two entry points to one engine: committing the
  resolved tree without advancing the plan strands the rest of the rebase.

### Network ops and credentials (#61 D5)

- **One runner, eleven call sites.** Every op that shells out to real `git` over
  the network goes through `commands::net::run_git_authenticated` (or, for clone,
  through its two primitives `apply_auth_env` + `map_git_failure`, because clone
  needs a streamed stderr pipe rather than `.output()`). The eleven:
  `fetch`, `fetch_all`, `pull`, `push`, `push_tag`, `push_delete_branch` in
  `commands/branches.rs` (all six via its local `run_git_creds` wrapper),
  `clone_repo` in `commands/create.rs`, `forge_checkout_pull_request`'s FETCH in
  `commands/forge.rs` (#92 — its second git call, the `checkout` of `FETCH_HEAD`,
  passes `None` on purpose: the tip is already local and touches no remote), and
  — since #93 — `submodule_update` (`commands/submodule.rs`) plus `lfs_fetch` /
  `lfs_pull` (`commands/lfs.rs`). Count them in the tree before trusting this
  number: #92 and #93 landed within a day of each other and each rewrote the
  sentence for its own additions only. A new network op joins them; **do not open
  a second auth path** — on the frontend that means `useRepoStore`'s exported
  `withAuthRetry`, not a private copy, or the challenge is raised with nothing
  mounted to answer it. The deliberately credential-less siblings are
  `branches.rs`'s local `run_git` (merge/rebase/checkout) and `libgit2.rs`'s
  `run_git_capture` (the #93 prompt-less shell-outs); `forge/token.rs`'s
  `git credential` and `forge/checkout.rs`'s `git rev-parse` spawn git directly
  because neither contacts a remote (and routing `git credential` through the
  authenticated runner would set `GIT_ASKPASS` and change its semantics).
- **Retry, never prompt mid-run.** The first attempt is always prompt-less, so the
  common case (helper or ssh-agent already works) is byte-for-byte what it always
  was. A failure is classified by `git/auth.rs::classify_auth_failure`; an auth
  failure becomes `AppError::Auth(AuthChallenge)`, the frontend raises it through
  `useAuthStore` and re-runs the SAME closure with credentials. Host-key
  verification failure stays `Network` on purpose — no typeable credential fixes
  it. New store actions use `withAuthRetry` and put `refreshAll()` INSIDE the
  retried closure.
- **`withAuthRetry` returns once the challenge is RAISED, not once the retry
  finishes.** So an action whose caller then decides something (a confirm, a
  toast) cannot report success/failure as a boolean — `false` would mean both "it
  failed" and "a password prompt is on screen", and the caller would stack its own
  dialog on top of the prompt. `useForgeStore.checkout` returns a
  `CheckoutOutcome` (`ok` | `branch-exists` | `auth-pending` | `error`) for exactly
  this reason.
- **Scrub before surfacing, always.** `map_git_failure` runs `scrub_credentials`
  first, on both branches, because git echoes remote URLs and a remote configured
  as `https://user:token@host/…` would otherwise put the token in an error banner
  and the log file. Userinfo ends at the LAST `@` of the authority — splitting on
  the first leaks the tail of a password containing `@`.
- **Secrets travel in the environment, never in argv.** Argv is world-readable via
  `ps`. `GIT_ASKPASS` points at our own bare executable with the mode selected by
  `PLATYPUSGIT_ASKPASS`, because `GIT_ASKPASS` is exec'd directly and cannot carry
  arguments. The shim answers on stdout and prints nothing else, ever.
- **End option parsing with `--` before any user-supplied value.** Remotes and ref
  names reach these commands from prompts and lists, and a value beginning with
  `-` is otherwise parsed as an option — `git push --receive-pack=<program>` names
  a program git runs for the transport, so this is argument injection, not a
  confusing error. `push_tag_args` / `push_delete_args` emit the separator and a
  test asserts every user value lands after it. Same class as the D5 security
  review's finding that `verify_commit` handed an oid straight to `git show`.
  `push_args` (fetch/pull/push) does NOT yet have one — its force flag is
  documented as coming last, which `--` would turn into a refspec, so fixing it is
  its own change.
- **`credential_approve` refuses values containing a newline** rather than
  escaping them: git's credential protocol is line-based `key=value`, so a
  newline injects further keys and could file a password against another host.

### Signing: one chain for commits and tags (#61 D6, #132)

- **One chain, two callers.** `libgit2.rs::sign_payload` is
  `resolve_signing` → `signing::resolve_key_file` → `signing_args` →
  `run_signer`, and `commit_signed` and `create_signed_tag` both call it. Do not
  open a second one: the ssh key-PATH restriction (`user.signingkey` must be a
  file, `key::…` and bare `ssh-…` literals are refused rather than written to a
  temp file) lives in `resolve_key_file`, and a private copy is how it would come
  to hold for commits and lapse for tags.
- **A signing failure creates nothing, ever.** Both writers put the ref update
  LAST — `repo.commit_signed` and `tag_annotation_create`/`odb.write` move no
  reference, so we move it ourselves, after the signature exists. An unsigned
  fallback would leave the user believing they had signed it.
- **`git2` has no `tag_signed`.** `create_signed_tag` builds the canonical
  UNSIGNED annotation with `tag_annotation_create`, reads its bytes back from the
  ODB, signs those, appends the armored signature and writes a second object.
  Deliberately not hand-written serialization: the payload is then byte-for-byte
  what libgit2 would have stored, with no tagger formatting or timezone
  arithmetic of ours. Cost: the unsigned annotation is left unreferenced and
  collected by `git gc`. **Shelling out to plain `git tag -s` was considered and
  rejected** — it does its own key resolution, so it would bypass `signing.rs`
  entirely and silently accept the `key::` literals commits refuse. (A hybrid —
  resolve here, then `git tag -s -u <key> -F -` — would keep the restriction; the
  spec records why route (a) won anyway, so nobody re-derives a false dichotomy.)
- **The ref write is not the only collision check.** `create_signed_tag`
  early-returns on an existing `refs/tags/<name>` BEFORE signing: otherwise a
  duplicate name pops pinentry, takes the passphrase, and only then fails. The
  atomic `force = false` write stays as the real guarantee.
- **Signing implies annotated.** A lightweight tag is a ref with no object to
  sign, so `sign: Some(true)` with no annotation is `InvalidArgument`, not a
  silent downgrade. A bare `tag.gpgsign`, though, does NOT promote a lightweight
  tag — real `git tag v1` fails outright there (`fatal: no tag message?`), which
  would make lightweight tags unreachable in a signing repository, and the
  dialog's blank annotation field *means* lightweight.
- **`commit.gpgsign` and `tag.gpgsign` are separate keys**, as in git. `sign:
  None` follows the matching one; `Some` overrides it for that one object.
- **`%G?` is a COMMIT format placeholder — never use it for a tag.** `git show
  <tag> --format=%G?` reports the *commit's* signature, and
  `for-each-ref`'s `%(signature:grade)` atom is empty for a tag object (checked
  against git 2.50.1). `verify_tag` uses `git verify-tag --raw` and its own
  parser, `tag::parse_verify_tag`, which returns the same `SignatureStatus`.
  Neither the exit status nor the text alone is sufficient: a valid signature
  from a key outside `allowedSignersFile` exits NON-ZERO while grading `G`/`U`.
  The `[GNUPG:] ` prefix is REQUIRED when matching a gpg status token — git
  relays gpg's status-fd output verbatim, on **stderr**, so read both streams.
- **"No false Good" belongs to the parser.** An SSH `Good` line is refuted by a
  non-zero exit plus `Could not verify signature`, so a signer that printed its
  verdict before its checks cannot produce a green badge. And a key outside
  `allowedSignersFile` (`Good "git" signature with …`, no principal) is
  `UnknownKey` for a TAG, not `Good` — the COMMIT path still says `Good` via
  `parse_verify_output`'s `U` mapping, which is a known gap with its own issue,
  not something to copy. There is no SSH `Revoked` branch: git emits only
  `Could not verify signature.` for a revoked key (measured, git 2.50.1 +
  OpenSSH 10.2), so one would be dead code.
- **Verdicts are lazy, presence is free.** `TagInfo.signed` is read off the tag
  object during the existing walk (no subprocess), so tag ROWS can mark a signed
  tag; the graded badge (`TagSignatureBadge`) verifies the SELECTED tag only.
  Same rule `SignatureBadge` states for the log: a verdict per row is a signer
  process per row.
### Stash: two addresses, one destructive trap (#133)

- **`StashInfo` carries `index` AND `oid`, and they are not interchangeable.**
  `index` is a position in the `refs/stash` reflog, so ANY write to that ref
  shifts it — a rename shifts it itself. Ops that EDIT the reflog (`stash_drop`,
  `stash_rename`) take the index and re-verify the oid before touching
  anything; a COMPARISON takes the oid, because a stale index would silently
  diff a different entry.
- **`git stash store <oid>` is a SILENT no-op when `refs/stash` already points
  at `<oid>`.** git elides a value-identical ref update, writes no reflog entry,
  and still exits 0 — and that is exactly `stash@{0}`, the entry a user is most
  likely to rename. A store-then-drop rename that stores the EXISTING oid
  therefore destroys the top stash while reporting success. `stash_rename`
  stores a **fresh commit** instead (same tree, parents and both signatures;
  only the message differs), which cannot collide with the ref's current value
  and also keeps the stash commit's own message in step with its reflog message
  — the way `git stash push` writes both. Pinned by two tests in
  `tests/stash_rename.rs`, one of which asserts the git behaviour directly.
- **Additive first, destructive last, and gated.** Store, then verify
  (`stash::rename_store_landed`), then drop. Everything before the drop leaves
  the original entry where it was, so a failure anywhere yields a DUPLICATE the
  user can remove — never a gap. Do not "simplify" the verification away.
- **A rename moves the entry to the top.** The reflog can only be prepended to;
  restoring the previous order would mean dropping and re-storing every entry
  above it. The UI says so in the prompt and **re-reads the list** rather than
  patching its own copy.
- **The third parent is where `git stash -u` lives**, and no tree-level diff of
  the stash commit can reach it. `stash_diff` folds it in explicitly (its tree
  against the EMPTY tree, so exactly the untracked files, all added);
  `stash-vs-wt` cannot, so it excludes untracked on BOTH sides and says so. Any
  new stash comparison must make that decision out loud, not by default.
- **Pathspec ops set `GIT_LITERAL_PATHSPECS=1`** on top of the `--` rule. A path
  is data from `git status`, but git reads a leading `:` as pathspec magic, so a
  file honestly named `:(exclude)x` would otherwise select a different set. This
  is the only shell-out in the app that passes a pathspec — do not turn the flag
  on globally.
- **`git stash push` exits 0 when it saves nothing** ("No local changes to
  save"), so "was an entry created" is read off `refs/stash` before and after,
  never off the exit status. `Ok(None)` is a state, not a failure.
- **Hunk-level partial stash is deliberately absent, not merely unbuilt.** The
  `git stash push --staged` composition needs the index rewritten and restored
  around a subprocess, and an interruption in that window silently reduces the
  user's index to the selection — and staged-but-uncommitted work has no other
  copy anywhere. Crash-safety would need a journal, which is the `rebase_state`
  instrument applied to a case git owns (the `bisect.rs` reasoning). Building it
  needs its own spec; do not stub an affordance for it in the meantime.

### Bisect: git's state is the only state of record (#93)

- **There is no `.git/platypusgit-bisect.json`, and there must not be.** Every
  transition is a `git bisect` invocation, so git owns `BISECT_START`,
  `BISECT_LOG`, `BISECT_TERMS` and `refs/bisect/*`, and a second record could only
  ever *disagree* with it. This is the exact inverse of `rebase_state.rs` — that
  file exists because the app DRIVES the replay and git cannot finish it — and the
  reason is the same one CLAUDE.md gives there, read from the other direction.
- Reading git's files is also what makes a bisect survive an app restart and pick
  up one the user started in a terminal, for free. `tests/bisect.rs` pins that
  with a FRESH `Libgit2Backend` continuing and resetting a bisect it never started.
- **`RepoState::Bisect` needed no new variant** — libgit2 already reports it off
  `BISECT_LOG`. What was missing was the detail (`bisect_status`) and the actions.
- Progress comes from `git rev-list --bisect-vars` (`bisect_nr` / `bisect_steps`),
  git's own arithmetic, so the numbers match what `git bisect good` prints and —
  unlike scraping that output — are recomputable at any time.
- **Read the terms from `BISECT_TERMS`**, never assume "bad"/"good":
  `refs/bisect/<term>` is named after them, so a `--term-old`/`--term-new` bisect
  would otherwise be invisible (no bad ref found → no progress, no culprit).
- Convergence is `bisect_rev == refs/bisect/<bad>` — git's own test. Note HEAD
  then sits on the last commit *tested*, not on the culprit, so the UI must NAME
  the first bad commit rather than let the user read a sha off the titlebar.

### Async / threading (Rust)
- `git2::Repository` is `Send` but not `Sync`. `Libgit2Backend` holds each opened repo as `Mutex<Repository>` inside a `Mutex<HashMap<RepoId, ...>>`. Several repositories are genuinely open at once (multi-repo tabs); `close` is the only thing that removes an entry.
- Always wrap git2 work in `spawn_blocking` from Tauri commands — don't block async runtime.

### Styling
- Tailwind v4 (CSS-first config). Theme tokens are declared on plain `:root` in `src/index.css` (there is no `@theme {}` block). Use CSS vars (`var(--accent)`, `var(--bg-0)`, `var(--fg-0)`, `var(--git-*)`) or Tailwind arbitrary-value syntax.
- **The shell is a fixed frame: `html, body, #root` are `overflow: hidden` +
  `overscroll-behavior: none`.** Panes own their scrolling (`FocusableScroll`).
  Without it a too-wide row or an off-viewport portal made the whole window
  scroll sideways, titlebar and activity bar sliding along. A new surface that
  can overflow needs its own scroll container — the document will not provide one.
- No `tailwind.config.js` — v4 doesn't need one.
- **`:root` is only the pre-hydration default for the themeable tokens.**
  `applyTheme()` (`features/settings/useSettingsStore.ts`) is the source of
  truth: besides the editable palette it writes `SEMANTIC_TOKENS`
  (`--git-*`, `--graph-*`, `--accent-2..5`, `--shadow-*`) per theme **mode**,
  and `SELECTION_TOKENS` (`--bg-selection*`) derived from `--accent`. Light
  themes need their own calibration or diff colors, graph lanes and shadows
  stay dark-calibrated over a light canvas (#61 B4). The `dark` column is kept
  byte-identical to `index.css`; edit both or they drift.
- Never hardcode the accent hue. Use `var(--accent)` or relative-color
  `oklch(from var(--accent) l c h / <alpha>)` so custom themes carry through.
- Fonts are vendored (`@fontsource-variable/*`), not assumed present.
- Inline `style={{…}}` with CSS vars is fine and used widely in chrome components.
- `BranchInfo.tip` is a **full** oid. It was once truncated to 7 chars, and every
  comparison against `CommitInfo.oid` then failed silently — History's HEAD
  indicator (`headIndicator`: bar / row tint / both / graph-marker-only) never
  drew, the graph's HEAD ring never drew, and `headAncestryOf` degraded to "the
  whole log". Shorten with `shortSha` at display sites, never at the source.
- **Any new list-row surface must opt into UI density**, or the Settings toggle
  silently skips it (that's how it rotted the first time — issue #70). Write
  `height: "calc(<base>px + var(--row-step))"`, or
  `padding: "calc(<base>px + var(--row-step) / 2) …"` for padding-sized rows;
  `--row-h` is the shared token for plain 24px rows. `--row-step` is 0 in
  compact, so keep each surface's existing base and the default layout is
  unchanged. `grep -rn 'var(--row-step)' src/` lists what participates.
  Chrome (titlebar, status bar, toolbars, panel headers) stays fixed, as does
  diff/code line geometry (`--lh-code` owns that). The one surface that can't
  use the token is `PGGraphRow` — it draws in SVG user units, so `PGCommitRow`
  feeds it the number from `useDensityStep()`; those two must stay in sync or
  the History graph desyncs from its rows.

### Design system
- Import UI primitives from `@/design` (not per-file). `design/index.ts` barrel re-exports everything.
- New shared primitive → add to appropriate file in `src/design/` and re-export via `index.ts`.
- `PGButton`/`PGInput` spread `...rest` onto their DOM node (so `data-testid` etc. pass through); `PGIconButton` does NOT (forwards `title` only). Row components (`PGChangeRow`, `PGCommitRow`, `PGFileTreeRow`, …) need explicit prop threading for new attributes.
- Do NOT add `src/components/ui/`. The design system lives in `src/design/`.

### Dialogs
- **Never call `window.confirm` / `window.prompt`.** Use `pgConfirm` /
  `pgPrompt` from `@/design` (`design/dialog.tsx`) — promise-shaped, so
  `if (await pgConfirm(…))` replaces the native line directly. They match the
  native contract: dismissal → `false`/`null`, Escape and backdrop dismiss, and
  an empty prompt string stays distinct from `null`.
- `PGConfirmOptions` carries `body`, `danger`, and `requireText` (type-the-name
  gate) — use them for destructive ops instead of cramming everything into one
  sentence.
- `PGPromptOptions.multiline: <rows>` renders a textarea instead of an input
  (the squash message prompt); Enter then inserts a newline and ⌘/Ctrl+Enter
  submits. e2e's `stubNativeDialogs` fills it by picking the value setter off the
  matching prototype — HTMLInputElement's does nothing to a textarea.
- A `<PGDialogHost />` must be mounted in each window (`AppShell`, `MergeWindow`);
  with none mounted the calls resolve `false`/`null` rather than hanging.
- Component tests that render a screen in isolation need `WithDialogs` from
  `@/test/dialog`, or every confirmation silently reads as "cancelled".

### File lists
- Row glyph + tint come from `lib/fileIcon.ts` (`fileIconSpec(path)`) — one
  category glyph per file type, per-extension tint from the `--graph-*` tokens.
  Add a language by adding a map entry, not a new SVG.
- `buildStatusTree` and `buildStatusList` (`lib/tree.ts`) emit the **same row
  keys** (`"/" + full path`). That is what lets the tree⇄flat toggle
  (`lib/useTreeViewMode.ts`) work without per-mode branches in selection,
  staging, or context menus — keep it true.
- Tree keyboard behavior belongs to the owning screen via `usePaneList`, not to
  `PGFileTree`: a local `onKeyDown` plus the global dispatcher both answer
  ArrowDown and the selection moves twice.
- **`FileStatus.submodule` is the exact complement of `embedded`** (#93), and they
  are mutually exclusive by construction: `is_embedded_repo` already excludes a
  `.gitmodules`-declared submodule. A submodule leaf renders with the `submodule`
  glyph and gets `submoduleMenuItems`, because the ordinary file menu is a list of
  dead ends on a gitlink (no diff, no blame, no history) — but staging it stays
  legal, since an updated pointer is an ordinary commit.

### Drag and drop
- **Pointer events, never HTML5 drag-and-drop.** `features/dnd/dragController.ts`
  owns the gesture; there is no `dragstart`/`dataTransfer` path and sources
  actively `preventDefault` the native one. Reasons: WebDriver cannot synthesize
  an HTML5 drag session and jsdom has no `DataTransfer` (so an HTML5 gesture is
  untestable at both layers), an HTML5 drag hands the platform an unthemable drag
  image plus OS cursors, and `useRowReorder` was already pointer-based. Cost
  accepted: no dragging files out of / into the window.
- **A drag source is a CONTAINER, not a row.** Screens call `useDragSource` on the
  list wrapper and resolve the grabbed row from `data-path` / `data-sha` /
  `data-pg-ref` — attributes the rows already carry. So `PGChangeRow`,
  `PGFileTreeRow` and `PGCommitRow` take no drag props and gain no per-row
  closure. Do not "simplify" this into per-row hooks: `PGCommitRow` is memoized
  and History's list is windowed (#68 G9/G10), and per-row subscriptions
  re-render the visible slice on every pointer move.
- **A source's reach is its pane's subtree, and that is load-bearing.** The commit
  screen's two sources live inside `<PGPane id="commit.files">`, so a pointerdown
  on a diff row in `commit.diff` never starts a drag and cannot disturb
  `useDiffLineFocus`'s line cursor. Attaching a source higher up (the screen root,
  say) would silently put the diff pane in drag range.
- **Drop indication is a DOM attribute, not React state.** The controller writes
  `data-pg-drop-over` on the resolved element (`index.css` styles it) and keeps
  only `payload` + `overId` (the ZONE id) in the store. A zone that spans many
  rows uses `resolve(el, payload)` — the delegated mode — rather than one zone
  per row.
- **The drop TABLE is pure and tested** (`features/dnd/resolveDrop.ts`).
  `resolveStagingDrop` and `resolveGraphDrop` decide legality; screens only do
  DOM work and call existing `useRepoStore` actions. The graph table is
  deliberately asymmetric — merge only *into* HEAD, rebase only *HEAD* onto
  something, cherry-pick only onto HEAD — because those are the only ops the
  backend has, so no gesture can rewrite a branch you are not on or check one out
  as a side effect. A refused drop returns `rejected` with a reason (shown on the
  ghost, flashed on release), never silence.
- **Every drag has a keyboard equivalent.** Staging → Space (`list.toggle`) and
  the checkbox; rebase reorder → `rebase.moveStepUp/Down` (Mod+Shift+↑/↓) and the
  chevrons; graph merge/rebase/cherry-pick → the branch/commit context menus, the
  palette, and the Branches screen. A new gesture without one is not done.
- Escape cancels any drag, from one capture-phase listener in the controller.

### Permissions (Tauri 2)
- Shared permissions in `src-tauri/capabilities/default.json`. Current set: `core:default`, `core:window:allow-minimize`, `core:window:allow-toggle-maximize`, `core:window:allow-close`, `core:window:allow-start-dragging`, `core:window:allow-set-title`, `core:webview:allow-create-webview-window`, `dialog:default`, `dialog:allow-open`, `os:default`, `log:default`. Capability scopes `windows: ["main", "merge"]` (merge resolver runs as a second window).
- **Self-update permissions are scoped narrower** — `updater:default` + `process:allow-restart` live in `src-tauri/capabilities/updater.json` with `windows: ["main"]`, NOT in `default.json`. The merge resolver window must not be able to swap the binary or relaunch the process mid-conflict. Keep new privileged permissions out of the shared capability unless both windows genuinely need them.
- **E2E-only permissions** live in the inline `e2e-focus` capability in `src-tauri/tauri.e2e.conf.json`, NOT in `default.json`: `core:window:allow-set-focus` + `wdio-webdriver:default`. That capability is loaded only via `--config src-tauri/tauri.e2e.conf.json`, and the `tauri-plugin-wdio-webdriver` crate is an optional dep behind the `e2e` cargo feature (`--features …,e2e` in `test:e2e:build`), so the WebDriver bridge is never compiled into or permitted in dev/production builds.
- New plugin: `cargo add tauri-plugin-X`, `pnpm add @tauri-apps/plugin-X`, register with `.plugin(tauri_plugin_X::init())` in `lib.rs`, add plugin permissions to capability file.

### Path aliases
- `@/` → `src/` in both `tsconfig.json` and `vite.config.ts`. Use it — `@/features/repo/...` beats `../../features/repo/...`.

## Things deliberately NOT in codebase

- Shell integration / Finder / Explorer overlays (out of scope).
- Custom icons — Tauri defaults for now. Replace before first release.
- Code signing config for bundles.
- Broad test suite — unit tests exist for pure logic (graphLayout, buildRebasePlan) + libgit2 smoke. Add tests alongside each feature as built.

## Known placeholders

- **Bundle identifier** in `src-tauri/tauri.conf.json` is `com.platypusgit.app` — placeholder. User will finalize; changing later orphans installed instances, so don't auto-change without asking.

## Commit style

Match existing log:
- `feat(scope): …` / `fix(scope): …` / `test: …` / `docs: …` / `chore: …`
- Short imperative subject, under 72 chars.
- Optional body with **Why:** for non-obvious decisions.
- Trailing `Co-Authored-By: Claude …` when assistant drove the commit.

Do not create empty / merge commits. Do not amend published commits without asking.

## Branching & merge workflow

- **Never commit directly to `main`.** Branch first: `feat/...`, `fix/...`, `chore/...`, `docs/...`.
- **Always work in a dedicated git worktree, never the primary checkout.** Multiple assistant sessions run against this repo at once; sharing one working directory collides (competing index/HEAD, a rebase-in-progress from another session, `localStorage`-clearing e2e runs). Create the branch and its worktree together off latest `main`: `git fetch origin && git worktree add -b <type>/<slug> .claude/worktrees/<slug> origin/main`. Do all edits, builds, and tests there; remove it with `git worktree remove` when the PR is merged. Read-only analysis still gets its own worktree (`--detach origin/main`) so it never touches another session's state.
- Work as a series of small, focused commits on the feature branch (Conventional Commits throughout).
- When the branch does need updating, **rebase onto `main`**, not merge `main` in — no merge commits on the branch.
- Integrate via **squash and merge** — the `main` ruleset (id `18319179`) enforces squash-only (`allowed_merge_methods: ["squash"]`) plus `required_linear_history`, `non_fast_forward`, and no branch deletion; merge-commit and rebase-merge are blocked. `main` gets one commit per PR, linear by construction.
- Since the PR squashes to a single commit anyway, squash the branch's commits into one locally (`git reset --soft origin/main` + one Conventional Commit) before merging so the squashed commit message is clean rather than an auto-concatenation.
- **No rebase-before-merge requirement.** `required_linear_history` is satisfied by the squash merge itself (one new commit on the `main` tip), and the required `e2e-linux` check is non-strict, so a branch that is merely *behind* `main` merges fine. **Merge as soon as GitHub reports the PR mergeable** (`gh pr view <N> --json mergeable,mergeStateStatus`). Rebase only when there's a reason: GitHub reports conflicts (`mergeable: CONFLICTING`), or your change interacts with something that landed on `main` since and you want CI to run against it.
- Resolve conflicts by rebasing onto `origin/main` (`git fetch origin && git rebase origin/main`), then force-push (`--force-with-lease`).
- Branch and open a PR even for assistant-driven work — don't push straight to `main`.
- `main` may be checked out by a worktree under `.claude/worktrees/` (other assistant sessions). Then `git checkout main` and `gh pr merge --delete-branch`'s local cleanup fail with "'main' is already used by worktree" — the remote merge still succeeds. Recover with `git checkout --detach origin/main`, delete the branch manually, and leave the other worktree alone.
