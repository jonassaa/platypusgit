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
pnpm test                                   # vitest (unit logic + component tests)
pnpm test:e2e                               # e2e: debug build + wdio (REQUIRED after src/ changes)
pnpm test:e2e:run                           # e2e against existing binary (spec-only iterations)
pnpm exec tsc -p e2e/tsconfig.json --noEmit # e2e typecheck gate (root tsc excludes e2e/)
```

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
- **E2E (webview-level)** — WebdriverIO specs in `e2e/specs/` (14 files, 50
  tests, all passing) drive the real debug binary: real webview →
  real Tauri IPC → real libgit2 → temp repos built by `e2e/support/tempRepo.ts`.
  Uses the embedded WebDriver provider (`@wdio/tauri-service`) — no external
  driver or paid service — so it runs on macOS (WKWebView) and on Linux CI
  (WebKitGTK).
  - `pnpm test:e2e` = `test:e2e:build` (a tauri debug build with
    `--features tauri/custom-protocol --config src-tauri/tauri.e2e.conf.json`,
    snapshotting the binary to gitignored `e2e/.bin/`) followed by
    `test:e2e:run` (wdio against that snapshot). Any src/ or src-tauri/
    change requires the full `pnpm test:e2e` — `test:e2e:run` silently
    tests the old snapshot; spec-only change → `pnpm test:e2e:run`.
  - **Before writing or debugging any e2e spec, read the `e2e-testing`
    project skill** (`.claude/skills/e2e-testing/SKILL.md`) — selector
    conventions and traps, driver-bridge/5s-penalty rules, native-dialog
    stubbing, fixture geometry gotchas, rebuild discipline, debugging flow.
  - CI: `.github/workflows/e2e.yml` (ubuntu-latest + xvfb, PRs to `main` +
    push to `main`).
  - `pnpm.overrides["@wdio/native-utils"] = "2.5.0"` pins around a broken
    dep pin in `@wdio/tauri-service@1.2.0` — don't remove.
  - Debug builds serve WebDriver on port 4445: close any `pnpm tauri dev`
    instance before e2e runs or the runner may attach to it and clear its
    `localStorage`.

## Architecture

### Backend (`src-tauri/src/`)

```
error.rs         AppError enum (thiserror + serde-tagged) — ONLY error type crossing IPC
state.rs         AppState { backend: Arc<dyn GitBackend> }
lib.rs           Tauri builder + invoke_handler! registry (all commands listed there)
git/
├── mod.rs       GitBackend trait — every git op, returns AppResult<T>
├── types.rs     RepoHandle, FileStatus, CommitInfo, BranchInfo, TagInfo, StashInfo,
│                RemoteInfo, FileDiff, BlameLine, ReflogEntry, RebaseStep, RepoState,
│                ConflictSides, CommitOptions, StashSaveOptions, TagTarget, ResetMode, etc.
├── libgit2.rs   Libgit2Backend — active impl, most ops real
├── cli.rs       CliBackend — stub for ops libgit2 handles poorly (LFS, creds, complex merges)
└── signature.rs Author/committer signature helpers
commands/        Thin Tauri handlers, one file per area:
├── repo.rs        open_repo, get_status, list_all_files, read_file_content,
│                  append_gitignore, open_in_editor
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
│                  abort/continue_operation, run_mergetool, restart_conflict
├── rebase.rs      rebase_start/continue/abort/status (interactive)
└── reflog.rs      get_reflog, checkout_detached
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
├── icons.tsx            Icon set (name-based <PGIcon>)
├── context-menu.tsx     Context menu primitive
├── empty-state.tsx      Empty-state component
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
└── diff/            diff-specific components

lib/
├── tauri.ts         Typed invoke() wrappers — frontend NEVER calls invoke() directly
├── types.ts         Shared types mirroring Rust types.rs
├── errors.ts        AppError discriminated union 1:1 with Rust enum
├── derive.ts        Selectors: currentBranch, isStaged, isUnstaged, totalAheadBehind, …
├── highlight.ts     Syntax highlighting for preview/diff
├── tree.ts          Tree-building helpers (file tree from flat paths)
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

### Async / threading (Rust)
- `git2::Repository` is `Send` but not `Sync`. `Libgit2Backend` holds each opened repo as `Mutex<Repository>` inside a `Mutex<HashMap<RepoId, ...>>`.
- Always wrap git2 work in `spawn_blocking` from Tauri commands — don't block async runtime.

### Styling
- Tailwind v4 (CSS-first config). Theme tokens in `src/index.css` under `@theme { … }`. Use CSS vars (`var(--color-accent)`, `var(--bg-0)`, `var(--fg-0)`, `var(--git-*)`) or Tailwind arbitrary-value syntax.
- No `tailwind.config.js` — v4 doesn't need one.
- Inline `style={{…}}` with CSS vars is fine and used widely in chrome components.

### Design system
- Import UI primitives from `@/design` (not per-file). `design/index.ts` barrel re-exports everything.
- New shared primitive → add to appropriate file in `src/design/` and re-export via `index.ts`.
- `PGButton`/`PGInput` spread `...rest` onto their DOM node (so `data-testid` etc. pass through); `PGIconButton` does NOT (forwards `title` only). Row components (`PGChangeRow`, `PGCommitRow`, `PGFileTreeRow`, …) need explicit prop threading for new attributes.
- Do NOT add `src/components/ui/`. The design system lives in `src/design/`.

### Permissions (Tauri 2)
- All permissions in `src-tauri/capabilities/default.json`. Current set: `core:default`, `core:window:allow-minimize`, `core:window:allow-toggle-maximize`, `core:window:allow-close`, `core:window:allow-start-dragging`, `dialog:default`, `dialog:allow-open`, `os:default`.
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
- Work as a series of small, focused commits on the feature branch (Conventional Commits throughout).
- Keep the branch current by **rebasing onto `main`**, not merging `main` in — history stays linear, no merge commits on the branch.
- Integrate via **squash and merge** — a `main` ruleset enforces squash-only (`allowed_merge_methods: ["squash"]`); merge-commit and rebase-merge are blocked. `main` gets one commit per PR, linear history.
- Since the PR squashes to a single commit anyway, squash the branch's commits into one locally (`git reset --soft origin/main` + one Conventional Commit) before merging so the squashed commit message is clean rather than an auto-concatenation.
- **Always rebase onto the latest `main` right before merging** (`git fetch origin && git rebase origin/main`, then force-push). Never merge a PR whose branch is behind `main`.
- Resolve conflicts during rebase; force-push the branch (`--force-with-lease`) after rebasing.
- Branch and open a PR even for assistant-driven work — don't push straight to `main`.
- `main` may be checked out by a worktree under `.claude/worktrees/` (other assistant sessions). Then `git checkout main` and `gh pr merge --delete-branch`'s local cleanup fail with "'main' is already used by worktree" — the remote merge still succeeds. Recover with `git checkout --detach origin/main`, delete the branch manually, and leave the other worktree alone.
