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
- **E2E (webview-level)** — WebdriverIO specs in `e2e/specs/` (17 files, 86
  tests, all passing) drive the real debug binary: real webview →
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
lib.rs           Tauri builder + invoke_handler! registry (all commands listed there)
cli.rs           CLI arg parsing (LaunchIntent, parse_args, resolve_repo_root),
                 shim install/status helpers (install_shim, shim_status) —
                 not to be confused with git/cli.rs (CliBackend) below
git/
├── mod.rs       GitBackend trait — every git op, returns AppResult<T>
├── types.rs     RepoHandle, FileStatus, CommitInfo, BranchInfo, TagInfo, StashInfo,
│                RemoteInfo, FileDiff, BlameLine, ReflogEntry, RebaseStep, RepoState,
│                ConflictSides, CommitOptions, StashSaveOptions, TagTarget, ResetMode, etc.
├── libgit2.rs   Libgit2Backend — active impl, most ops real
├── cli.rs       CliBackend — stub for ops libgit2 handles poorly (LFS, creds, complex merges)
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
│                Abort survive an app restart. Deliberately NOT git's own
│                `.git/rebase-merge/` dir — a half-compatible one would let
│                `git status` / `git rebase --continue` claim a rebase they
│                cannot drive
└── signature.rs Author/committer signature helpers
commands/        Thin Tauri handlers, one file per area:
├── repo.rs        open_repo, trust_repo_path, get_status, list_all_files,
│                  read_file_content, append_gitignore, open_in_editor
├── cli.rs         take_launch_intent, cli_shim_status, install_cli_shim
├── commits.rs     get_log, commit, file_history
├── diff.rs        get_diff, stage/unstage/discard_paths, stage/unstage/discard_hunk,
│                  diff_commits, blame_file
├── branches.rs    list_branches/tags/stashes/remotes, checkout/create/delete/rename_branch,
│                  fetch, fetch_all, pull, push, add/remove/rename/set_url/prune remote,
│                  create/delete/push_tag, merge_branch, rebase_onto, checkout_ref,
│                  push_delete_branch
├── history.rs     reset, cherry_pick, revert
├── stash.rs       stash_save/apply/pop/drop/branch
├── conflict.rs    repo_state, conflict_sides, accept_ours/theirs, mark_resolved,
│                  save_resolution, abort/continue_operation, run_mergetool,
│                  restart_conflict
├── rebase.rs      rebase_start/continue/abort/status (interactive)
├── reflog.rs      get_reflog, checkout_detached
└── create.rs      init_repo, default_init_branch, clone_repo (streaming
                   git clone → clone://progress events)
```

### Frontend (`src/`)

```
main.tsx             Entry point
App.tsx              Thin wrapper around <AppShell />
AppShell.tsx         Primary shell: titlebar (branch chip + picker, remote buttons),
                     activity bar (screen switcher), status bar, error banner, settings
store.ts             Re-export hub (keep thin — no global Zustand composition)

design/              In-house design system (NOT components/ui/). Exports via design/index.ts.
├── primitives.tsx       PGButton, PGIconButton, etc.
├── chrome.tsx           PGTitlebar, PGActivityBar, PGStatusBar, PGStatusItem
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
  RepoBrowser, CommitPanel, History, DiffViewer, Branches, Conflict, Rebase,
  Remote, Welcome, Reflog, CommitDiff, FileHistory, Blame, Settings

features/            Per-feature: components + Zustand store colocated
├── repo/            useRepoStore (the big one), useRecentsStore
├── nav/             useNavStore — cross-screen intents (diff-file, commit-vs-wt,
│                    file-history, blame, rebase-plan, stash-diff)
├── branches/        BranchChip (titlebar), BranchPicker (popover)
├── commits/         graphLayout + buildRebasePlan (both tested)
├── reflog/          useReflogStore, DirtyTreeDialog, ReflogActionDialog
├── settings/        useSettingsStore (autoFetch, defaultPullMode, etc.)
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
│                    useHunkNav (F7/⇧F7 diff hunks), useSpeedSearchStore,
│                    PGPane / FocusableScroll / CheatSheet
├── merge/           Merge resolver window — separate Tauri window (label
│                    "merge"), routed via ?window=merge in main.tsx. mergeModel
│                    (diff3 chunking, node-diff3), resultEditor (CM6 result pane
│                    w/ tracked conflict regions), MergeWindow/MergeBody/SidePane
│                    (Rider 3-pane: ours | editable result | theirs), chevron +
│                    F7/⌘1-3/⌘↵ chords, openMergeWindow (opener). Applies via
│                    save_resolution, emits merge://resolved → main refreshes.
├── update/          useUpdateStore (discovery, semver-aware dismiss memory,
│                    self-update install w/ its own `installing` flag),
│                    semver.ts (§11 precedence, hand-rolled + tested),
│                    UpdateChip (titlebar), UpdatePanel (Escape via the
│                    keymap's app.closeOverlay, not a local listener)
├── create/          Clone + Init dialogs (PGModal), useCreateStore,
│                    deriveRepoName. Clone shells out to real git with the
│                    same prompt-less env as fetch/pull/push.
├── diff/            CommitDiffPanel (shared commit-diff view) + WhitespaceToggle
│                    (ignore-whitespace control; also owns
│                    useHunkActionsDisabledReason — hunk staging is disabled
│                    while whitespace is ignored, see #61 D2)
└── cli/             useCliLaunch — takes the stashed first-launch intent +
                     listens for forwarded `cli-launch` events, drives
                     openRepo + nav screen-switch intent

lib/
├── tauri.ts         Typed invoke() wrappers — frontend NEVER calls invoke() directly
├── types.ts         Shared types mirroring Rust types.rs
├── errors.ts        AppError discriminated union 1:1 with Rust enum
├── derive.ts        Selectors: currentBranch, isStaged, isUnstaged, totalAheadBehind, …
├── highlight.ts     Syntax highlighting for preview/diff
├── fileIcon.ts      path → file-type glyph + themeable tint (tested)
├── tree.ts          buildStatusTree / buildStatusList — SAME row keys, which is
│                    what makes the tree⇄flat toggle free of per-mode branches
├── useTreeViewMode.ts  Persisted tree|flat preference, one key per surface
└── recents.ts       Recent-repo persistence
```

### Navigation model

- Activity bar = primary screen switcher, persisted to `localStorage["pg-screen"]`.
- Keyboard: everything routes through `features/keymap` (action catalog +
  preset bindings; rider preset default). Modifier chords work while typing;
  bare keys don't. `?` opens the cheat-sheet.
- `useNavStore.intent` drives deep-view switches (e.g. "show this commit's diff" → sets screen to `commitDiff`). Consumers write an intent; `AppShell` effect routes the screen.
- Settings is a screen too, reached via titlebar gear or activity-bar settings slot.

## Conventions

### Errors
- **Rust:** every IPC-crossing fn returns `AppResult<T> = Result<T, AppError>`. No unwrap/panic in commands. Add `AppError` variants rather than stringifying.
- **TS:** `AppError` union in `src/lib/errors.ts` stays 1:1 with Rust enum. New Rust variant → update TS same commit.
- Wire format: `{ kind, message }` via `#[serde(tag = "kind", content = "message")]`. Consumers narrow on `kind`.

### Adding a new git op (standard path)
1. Add method to `GitBackend` trait (`src-tauri/src/git/mod.rs`).
2. Implement in `Libgit2Backend` (`libgit2.rs`). Stub in `CliBackend` too (`NotImplemented`) — keeps trait shape exercised.
3. Tauri command in right `commands/<area>.rs`. Keep thin. Wrap git2 calls in `tokio::task::spawn_blocking` (libgit2 is sync).
4. Register command name in `invoke_handler![…]` in `src-tauri/src/lib.rs`.
5. Add TS type to `src/lib/types.ts`, wrapper to `src/lib/tauri.ts`.
6. Wire into relevant feature's Zustand store.

### State management
- **Zustand per-feature**, not one big global store. `useRepoStore` lives in `features/repo/` because that's who owns the state.
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
- **Merge commits in a plan may only be dropped** (git's own default: the merge
  disappears and its commits are replayed individually). `rebase_plan::merge_legal`
  is the single source of truth; any UI that offers merge-row actions mirrors it.
- **Every transition is mirrored to `.git/platypusgit-rebase.json`**, and
  `rebase_status` / `repo_state` fall back to it when this process did not start
  the rebase. `repo_state` gives the file precedence over libgit2's
  `repo.state()`, which only sees the `CHERRY_PICK_HEAD` a paused step leaves
  behind.
- **`continue_operation` / `abort_operation` delegate** to `rebase_continue` /
  `rebase_abort` whenever a rebase is in progress. The Conflict screen and the
  Rebase banner must stay two entry points to one engine: committing the
  resolved tree without advancing the plan strands the rest of the rebase.

### Async / threading (Rust)
- `git2::Repository` is `Send` but not `Sync`. `Libgit2Backend` holds each opened repo as `Mutex<Repository>` inside a `Mutex<HashMap<RepoId, ...>>`.
- Always wrap git2 work in `spawn_blocking` from Tauri commands — don't block async runtime.

### Styling
- Tailwind v4 (CSS-first config). Theme tokens are declared on plain `:root` in `src/index.css` (there is no `@theme {}` block). Use CSS vars (`var(--accent)`, `var(--bg-0)`, `var(--fg-0)`, `var(--git-*)`) or Tailwind arbitrary-value syntax.
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

### Permissions (Tauri 2)
- Shared permissions in `src-tauri/capabilities/default.json`. Current set: `core:default`, `core:window:allow-minimize`, `core:window:allow-toggle-maximize`, `core:window:allow-close`, `core:window:allow-start-dragging`, `core:window:allow-set-title`, `core:webview:allow-create-webview-window`, `dialog:default`, `dialog:allow-open`, `os:default`, `log:default`. Capability scopes `windows: ["main", "merge"]` (merge resolver runs as a second window).
- **Self-update permissions are scoped narrower** — `updater:default` + `process:allow-restart` live in `src-tauri/capabilities/updater.json` with `windows: ["main"]`, NOT in `default.json`. The merge resolver window must not be able to swap the binary or relaunch the process mid-conflict. Keep new privileged permissions out of the shared capability unless both windows genuinely need them.
- **E2E-only permissions** live in the inline `e2e-focus` capability in `src-tauri/tauri.e2e.conf.json`, NOT in `default.json`: `core:window:allow-set-focus` + `wdio-webdriver:default`. That capability is loaded only via `--config src-tauri/tauri.e2e.conf.json`, and the `tauri-plugin-wdio-webdriver` crate is an optional dep behind the `e2e` cargo feature (`--features …,e2e` in `test:e2e:build`), so the WebDriver bridge is never compiled into or permitted in dev/production builds.
- New plugin: `cargo add tauri-plugin-X`, `pnpm add @tauri-apps/plugin-X`, register with `.plugin(tauri_plugin_X::init())` in `lib.rs`, add plugin permissions to capability file.

### Path aliases
- `@/` → `src/` in both `tsconfig.json` and `vite.config.ts`. Use it — `@/features/repo/...` beats `../../features/repo/...`.

## Things deliberately NOT in codebase

- Shell integration / Finder / Explorer overlays (out of scope).
- CI config.
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
