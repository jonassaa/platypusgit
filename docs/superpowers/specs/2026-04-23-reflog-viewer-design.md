# Reflog viewer + easy revert — design

**Status:** approved
**Date:** 2026-04-23
**Owner:** jonas
**Related:** `docs/superpowers/specs/2026-04-21-platypusgit-scaffold-design.md`

## Why

Most users treat git's destructive operations (`reset`, rebase, amend, checkout over dirty work) as terrifying because the undo path is hidden. The reflog makes almost all of these recoverable, but the CLI surface is arcane — `git reflog`, then `git reset --hard HEAD@{7}`, is fluent-user territory.

platypusgit's north star is "extreme usability" for developers. A first-class reflog UI with one-click recovery turns git's strongest safety net into a visible, teachable feature. The goal is not just recovery — it is **building user comfort with git's power**, by making "nothing is ever really deleted" an observable fact.

## Scope

### In scope (MVP)

- Read and display the HEAD reflog as a browsable list.
- Preview the state at any reflog entry (diff vs current HEAD + commit metadata).
- Move to any reflog entry via one of three user-chosen semantics (hard reset / detached checkout / new branch from this point).
- Detect and handle uncommitted work before any of those actions.

### Out of scope (future specs)

- Per-branch reflogs (`refs/heads/*@{n}`).
- Stash reflog (including dropped stashes).
- Dangling-commit recovery via `git fsck --lost-found`.
- Live file-watching of `.git/logs/HEAD`.
- Search / filter / grouping on reflog entries.
- A global "undo last action" keyboard shortcut that skips the sidebar.

## Primary use cases

The UI must serve all three through the same surface:

1. **Undo my last action** — user did something they regret. Flow: open Reflog sidebar → click top entry → "Go to this point" → pick "Reset branch here" → confirm.
2. **Time-travel browse** — user wants to see "where was HEAD 20 minutes ago". Flow: open Reflog sidebar → click entries → inspect preview pane. No action required.
3. **Recovery** — user suspects they've lost work. Flow: open Reflog sidebar → find the entry whose commit contains their work → "Go to this point" → "Create a new branch here".

## Architecture

Reuses the existing `GitBackend` trait + command-per-area pattern. Most of the git surface the feature needs already exists; only a small amount of new backend code is required.

### Backend — new work

Only two new trait methods are needed; the rest of the feature reuses what's already there.

- New `GitBackend` trait methods in `src-tauri/src/git/mod.rs`:

  ```rust
  fn read_reflog(&self, repo_id: &RepoId) -> AppResult<Vec<ReflogEntry>>;
  fn checkout_detached(&self, repo_id: &RepoId, oid: &str) -> AppResult<()>;
  ```

- `Libgit2Backend` implements both. `CliBackend` stubs with `AppError::NotImplemented`.

- libgit2 mappings:
  - `read_reflog`: `Repository::reflog("HEAD")`; iterate newest-first; for each, build `ReflogEntry`; parse the leading `"<op>: "` token into `ReflogOp`. Unrecognized prefixes become `Other(prefix)`.
  - `checkout_detached`: `Repository::set_head_detached(oid)` then `Repository::checkout_head(Some(CheckoutBuilder::new().force()))`.

- New module `src-tauri/src/commands/reflog.rs` with two thin commands, both using `tokio::task::spawn_blocking`:
  - `get_reflog(state, repo_id) -> AppResult<Vec<ReflogEntry>>`
  - `checkout_detached(state, repo_id, oid: String) -> AppResult<()>`

- Register both in `invoke_handler![…]` in `src-tauri/src/lib.rs`.

### Backend — reuse

- **"Reset branch here"** → existing `commands::history::reset` with `ResetMode::Hard` and the target oid as the ref.
- **"Create a new branch here"** → existing `commands::branches::create_branch(name, Some(oid))`.
- **Dirty-tree detection** → frontend calls existing `get_status` before dispatching an action; if any entries have non-clean flags, show the dirty-tree dialog.
- **Stash the dirty tree** → existing `commands::stash::stash_save` with a generated message.
- **Discard the dirty tree** → existing `reset` with `ResetMode::Hard` targeted at `HEAD` (no oid jump).

### Backend — new types

In `src-tauri/src/git/types.rs`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReflogEntry {
    pub oid: String,        // full hex
    pub short_oid: String,  // 7-char abbrev for display
    pub message: String,    // reflog message with prefix stripped
    pub op: ReflogOp,
    pub timestamp: i64,     // unix seconds
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", content = "detail")]
pub enum ReflogOp {
    Commit,
    Amend,
    Reset,
    Checkout,
    Merge,
    Rebase,
    Pull,
    Clone,
    Other(String),
}
```

### Diff preview pane — backend consideration

The preview pane shows the diff between current HEAD and the selected reflog entry's oid. The existing `GitBackend::diff` is per-file (takes a `Path` + `DiffKind`), which is not sufficient for "show the full diff between two commits".

Two options, listed but not decided here (the plan picks one):

- **Option P1 — widen `DiffKind`:** add a variant `DiffKind::CommitRange { from: String, to: String }` handled in `Libgit2Backend::diff` + `commands::diff::get_diff`. Minimal surface change; reuses the `FileDiff` type.
- **Option P2 — new method:** add `fn diff_commits(repo_id, from_oid, to_oid) -> AppResult<Vec<FileDiff>>` to the trait + a new `commands::diff::diff_commits` command.

Both produce the same data; P1 is smaller. This is an implementation choice, not a design choice — resolve it in the plan.

### Frontend

- New feature folder `src/features/reflog/` containing:
  - `store.ts` — `useReflogStore` (Zustand).
  - `ReflogView.tsx` — the sidebar panel; composes list + preview pane + action dialog.
  - `ReflogList.tsx` — vertical list rendered with `CommitRow`.
  - `ReflogActionDialog.tsx` — three-choice "go to this point" dialog.
  - `DirtyTreeDialog.tsx` — secondary dialog for uncommitted-changes handling.
- New shared primitives in `src/components/`:
  - `CommitRow.tsx` — one-line row: op icon, short hash, subject, relative timestamp. Reused later by the commit-log view.
  - `DiffPreviewPane.tsx` — right-side pane: commit metadata header + unified diff between two oids. Reused later by commit-log and diff review flows.
- New sidebar entry "Reflog" in the app shell navigation.
- `src/lib/tauri.ts` gains two new wrappers matching the new commands (`getReflog`, `checkoutDetached`) plus one wrapper for the preview-pane diff (naming depends on P1 vs P2). Reuses the existing wrappers for `reset`, `createBranch`, `getStatus`, `stashSave`.
- `src/lib/types.ts` gains `ReflogEntry` and `ReflogOp` matching the Rust types 1:1.

## UI / UX

### Sidebar

A new top-level sidebar nav item labeled "Reflog" with a clock/undo icon. Selecting it renders `<ReflogView>` in the main content area.

### Layout

Two-pane within the main content area:

- **Left (≈35% width):** vertical scroll list of entries, newest at top. Each row is a single line (`CommitRow`): op-type icon, short hash, subject (reflog message after the prefix), relative timestamp.
- **Right (≈65% width):** `DiffPreviewPane` for the selected entry. Shows op type, full hash, absolute timestamp, raw message, then a unified diff of `HEAD..entry_oid`. Empty-state text when nothing selected.

Above the right pane, a primary button: **"Go to this point"** (disabled when no row selected). Above the left pane, a refresh icon button.

### "Go to this point" dialog — `ReflogActionDialog`

Modal with:

- Header: "Go to `<short_hash>` — `<subject>`"
- Three radio options, each with a one-sentence plain-English explanation:
  1. **Reset branch here** — "Moves your current branch to this point. Commits after this point stay recoverable from the reflog."
  2. **Check out (detached)** — "Lets you look around at this point without moving any branch. You can create a branch later if you want to keep changes."
  3. **Create a new branch here** — "Makes a new branch starting at this point and switches to it. Your current branch is unchanged." (Shows a text input for the branch name when this option is selected.)
- Checkbox: **"Remember my choice for this session."** Persisted in the reflog store; cleared on app restart.
- Buttons: **Cancel** / **Go**.

### Detached-HEAD case

If HEAD is currently detached when the user opens the action dialog, the **"Reset branch here"** option is disabled with a tooltip: "You're on a detached HEAD — there's no branch to reset. Use 'Check out' or 'Create a new branch here'." This keeps the UI honest without forcing a second dialog.

### Dirty-tree dialog — `DirtyTreeDialog`

Triggered if `get_status` reports uncommitted changes when the user confirms "Go". Modal with:

- Message: "You have uncommitted changes. What should I do with them?"
- Buttons:
  - **Stash them** — calls `stash_save` with message `platypus: auto-stash before reflog jump <iso-timestamp>`. On success, proceeds with the original action.
  - **Commit first** — closes both dialogs; user commits manually then retries.
  - **Discard them** — requires explicit second click ("Really discard?"); calls `reset` with `ResetMode::Hard` targeted at `HEAD`, then proceeds with the original action.
  - **Cancel** — closes everything, no-op.

### Refresh

- `loadReflog` runs when the Reflog sidebar first opens, and whenever the active repo changes.
- After any reflog-altering action completes (reset / detached checkout / new branch), the store re-fetches.
- Manual refresh button always available.
- No `.git/logs/HEAD` file-watcher in MVP.

## State

`useReflogStore` (Zustand, colocated in `src/features/reflog/`):

```ts
interface ReflogState {
  entries: ReflogEntry[]
  selectedOid: string | null
  loading: boolean
  error: AppError | null
  rememberedAction: 'reset' | 'checkout' | 'branch' | null   // session-scoped

  loadReflog: (repoId: string) => Promise<void>
  selectEntry: (oid: string | null) => void
  resetHard: (repoId: string, oid: string) => Promise<void>       // wraps existing `reset` command
  checkoutDetached: (repoId: string, oid: string) => Promise<void> // new command
  createBranchAt: (repoId: string, oid: string, name: string) => Promise<void> // wraps existing `create_branch`
  rememberAction: (a: 'reset' | 'checkout' | 'branch') => void
  clearRememberedAction: () => void
}
```

No cross-feature state; composes cleanly per CLAUDE.md conventions.

## Errors

All existing `AppError` variants are sufficient — no new variants required:

- Empty reflog is a non-error (render empty-state text in the list, not an error banner).
- Invalid branch name → existing `AppError::InvalidRef`.
- Dirty-tree detection is a UI-level check via `get_status`; not a new error variant.
- libgit2 errors map to `AppError::Git` as usual.

## Testing

- **Rust unit tests** in `src-tauri/src/git/libgit2.rs` using the existing temp-repo fixture pattern:
  - `read_reflog` returns entries newest-first after several commits.
  - `read_reflog` correctly classifies at least `Commit`, `Amend`, `Reset`, `Checkout`, `Merge` ops; unknown prefixes yield `Other`.
  - `checkout_detached` leaves HEAD detached at the target oid.
  - Reset-via-reflog flow (using the existing `reset` method) leaves the abandoned commit reachable via reflog.
  - Branch-at-oid flow (using the existing `create_branch`) creates a branch at the target oid and switches to it; original branch unchanged.
- **No frontend tests** for MVP (matches current project state).

## Conventions touched

- Per-feature Zustand store colocated in `src/features/reflog/` — matches existing pattern.
- First two truly shared UI primitives (`CommitRow`, `DiffPreviewPane`) land in `src/components/`, setting the precedent for future extractions.
- New trait methods follow the standard-path checklist from CLAUDE.md (trait method → libgit2 impl → CLI stub → command handler → `invoke_handler!` → TS type → TS wrapper → Zustand action). Reused backend surface skips steps 1–4.

## Open questions

- **Diff source for preview pane** — P1 (widen `DiffKind`) vs P2 (new `diff_commits` method). Decide in the plan.

No other open questions at spec time.
