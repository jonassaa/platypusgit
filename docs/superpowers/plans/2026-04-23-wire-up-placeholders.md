# Wire-up placeholders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every `pgFlash`-only placeholder button and remaining `NotImplemented` gap in the app with a real implementation, so every button that looks clickable actually does something.

**Architecture:** Mix of (a) pure frontend wiring where the backend is already implemented, (b) small backend additions (stash-branch, gitignore-append, file-history, blame, open-in-editor, mergetool, restart-conflict), and (c) UI glue (cross-screen navigation intents) for features that need to drive existing screens into a new mode. We follow the existing `GitBackend` trait pattern and shell out to `git` CLI for things libgit2 handles poorly (mergetool, editor).

**Tech Stack:** Rust (git2, tokio, thiserror), Tauri 2, React/TS, Zustand, Vitest, standard `cargo test`.

**Pre-read for engineer new to this repo:**
- `CLAUDE.md` at repo root — toolchain, error conventions, "Adding a new git operation" checklist.
- `src-tauri/src/git/mod.rs` — `GitBackend` trait.
- `src-tauri/src/commands/branches.rs` — the `run_git` helper and how CLI-backed commands are structured.
- `src-tauri/tests/support/` — `TempRepo` test harness.
- `src/features/repo/useRepoStore.ts` — Zustand store pattern (copy an existing action).
- `src/design/context-menu.tsx` — where most of the placeholder buttons live.

**Assumptions flagged up front:**
- `fetch`/`pull`/`push` in `Libgit2Backend` (`libgit2.rs:1698-1706`) return `NotImplemented` but are **dead code** — the Tauri commands for fetch/pull/push bypass the trait and shell out via `run_git`. Do **not** "fix" those stubs in this plan; fetch/pull/push already work. We delete the dead stubs at the very end as cleanup.
- External editor resolution order: `$VISUAL` → `$EDITOR` → platform default (`open` on macOS, `xdg-open` on Linux, `start` on Windows). No per-repo config in this pass.
- Interactive rebase from commit menu builds a plan from the commits in `sha..HEAD` and navigates to the existing `RebaseScreen` for editing. It does not auto-start — the screen already handles start/continue/abort.
- "Compare with working tree" and "Compare with current" (branch) produce a read-only commit-diff view. We add a minimal new screen rather than retrofitting `DiffViewerScreen`, which is worktree-oriented.

---

## File Map

**New files (backend):**
- `src-tauri/tests/gitignore.rs` — TDD test for append-to-gitignore
- `src-tauri/tests/stash_branch.rs`
- `src-tauri/tests/file_history.rs`
- `src-tauri/tests/blame.rs`

**New files (frontend):**
- `src/screens/CommitDiff.tsx` — commit-vs-commit (or commit-vs-WT) viewer
- `src/screens/Blame.tsx` — blame viewer
- `src/screens/FileHistory.tsx` — log filtered to a path
- `src/features/nav/useNavStore.ts` — tiny cross-screen "intent" store

**Modified files (hot spots):**
- `src-tauri/src/git/mod.rs` — add trait methods
- `src-tauri/src/git/libgit2.rs` — implement new methods
- `src-tauri/src/git/cli.rs` — stub new methods with `NotImplemented`
- `src-tauri/src/git/types.rs` — new types (`BlameLine`, etc.)
- `src-tauri/src/commands/repo.rs` — new `append_gitignore`, `open_in_editor`, `blame`, `file_history`
- `src-tauri/src/commands/conflict.rs` — new `run_mergetool`, `restart_conflict`
- `src-tauri/src/commands/branches.rs` — new `stash_branch`
- `src-tauri/src/lib.rs` — register new commands
- `src/lib/tauri.ts` — wrappers for all new commands
- `src/lib/types.ts` — new TS types
- `src/features/repo/useRepoStore.ts` — store actions
- `src/App.tsx` and `src/AppShell.tsx` — route new screens, wire sidebar "New branch"
- `src/design/context-menu.tsx` — replace every remaining `pgFlash` onClick
- `src/screens/Conflict.tsx` — replace `onEdit` TODO at line 450

---

## Phase A — Pure UI wiring (no backend changes)

The backend for each of these is already fully implemented. These tasks are just swapping a `pgFlash` onClick for a real call into `useRepoStore`.

### Task A1: "New branch" in AppShell sidebar

**Files:**
- Modify: `src/AppShell.tsx:533`

- [ ] **Step 1: Replace the placeholder onClick**

Find the `PGIconButton` at the "New branch" row (currently `onClick={() => pgFlash("new branch is not wired up yet")}`) and replace with:

```tsx
<PGIconButton
  icon="plus"
  size="sm"
  title="New branch"
  onClick={async () => {
    const name = window.prompt("New branch name");
    if (!name) return;
    await useRepoStore.getState().createBranch(name);
    await useRepoStore.getState().checkoutBranch(name);
  }}
/>
```

- [ ] **Step 2: Type-check**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual smoke in dev**

Run: `pnpm tauri dev` (already running is fine; HMR picks it up). Open any repo, click the `+` next to "Local" in the sidebar, type a name, verify new branch appears and becomes HEAD.

- [ ] **Step 4: Commit**

```bash
git add src/AppShell.tsx
git commit -m "feat(ui): wire 'new branch' sidebar button to createBranch

Why: the button existed but just showed a toast; createBranch and
checkoutBranch were already implemented in the store."
```

---

### Task A2: "Check out this commit" (detached) in commit context menu

**Files:**
- Modify: `src/design/context-menu.tsx:332`

- [ ] **Step 1: Replace the onClick**

Replace `pgFlash(\`checked out ${sha} (detached)\`)` with a real call. The store already exposes `checkoutRef`, which uses `git checkout <ref>` via `run_git` and works for a bare SHA (git puts you in detached HEAD).

```tsx
{
  icon: "check",
  label: "Check out this commit",
  shortcut: "⌘⇧C",
  onClick: () => {
    if (!commit?.sha) return;
    if (window.confirm(`Check out ${sha} in detached HEAD?`))
      useRepoStore.getState().checkoutRef(commit.sha);
  },
},
```

- [ ] **Step 2: Type-check**

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/design/context-menu.tsx
git commit -m "feat(ui): wire 'check out this commit' to checkoutRef

Why: checkoutRef shells out to git checkout <sha> which handles the
detached-HEAD case directly."
```

---

### Task A3: "Create branch from here…" in commit context menu

**Files:**
- Modify: `src/design/context-menu.tsx:337`

- [ ] **Step 1: Replace the onClick**

Replace `pgFlash(\`new branch from ${sha}\`)` with:

```tsx
{
  icon: "branch",
  label: "Create branch from here…",
  onClick: async () => {
    if (!commit?.sha) return;
    const name = window.prompt("New branch name");
    if (!name) return;
    await useRepoStore.getState().createBranch(name, commit.sha);
    await useRepoStore.getState().checkoutBranch(name);
  },
},
```

- [ ] **Step 2: Commit**

```bash
git add src/design/context-menu.tsx
git commit -m "feat(ui): wire 'create branch from here' to createBranch(name, sha)"
```

---

### Task A4: Branch-menu fallback "Fetch remote"

**Files:**
- Modify: `src/design/context-menu.tsx:583-587`

The current code falls back to `pgFlash` when `remoteName` isn't derivable from the branch name. In practice this only happens for local-only branches. When there's no remote to fetch, we should fetch the default (`fetchAll`) instead of showing a toast.

- [ ] **Step 1: Replace the fallback**

```tsx
{
  icon: "fetch",
  label: "Fetch remote",
  onClick: () =>
    remoteName
      ? useRepoStore.getState().fetch(remoteName)
      : useRepoStore.getState().fetchAll(),
},
```

- [ ] **Step 2: Commit**

```bash
git add src/design/context-menu.tsx
git commit -m "fix(ui): fall back to fetchAll when branch has no remote prefix"
```

---

## Phase B — Cross-screen navigation store

Multiple upcoming features (View diff, Blame, File history, Compare with current, Compare with working tree) need to navigate from a context menu to a target screen *with a selection pre-populated*. Introduce a tiny `useNavStore` that holds an intent; the target screen consumes it once and clears it.

### Task B1: Create `useNavStore`

**Files:**
- Create: `src/features/nav/useNavStore.ts`

- [ ] **Step 1: Write the store**

```ts
import { create } from "zustand";

/**
 * Cross-screen navigation intent. A context menu item can ask the app
 * to switch to a screen *and* pre-select a target. The target screen
 * reads the intent once on mount / when it changes, then clears it.
 */
export type NavIntent =
  | { kind: "diff-file"; path: string }
  | { kind: "commit-vs-wt"; oid: string }
  | { kind: "commit-vs-commit"; from: string; to: string }
  | { kind: "file-history"; path: string }
  | { kind: "blame"; path: string };

interface NavState {
  intent: NavIntent | null;
  setIntent: (i: NavIntent) => void;
  clearIntent: () => void;
}

export const useNavStore = create<NavState>((set) => ({
  intent: null,
  setIntent: (intent) => set({ intent }),
  clearIntent: () => set({ intent: null }),
}));
```

- [ ] **Step 2: Type-check**

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/features/nav/useNavStore.ts
git commit -m "feat(nav): add cross-screen NavIntent store

Why: many upcoming context-menu actions need to switch screens and
pre-select a target. A tiny intent store keeps each screen responsible
for consuming its own intent kind."
```

---

### Task B2: Extend AppShell to react to nav intents

**Files:**
- Modify: `src/AppShell.tsx` (add an effect after line 96)

- [ ] **Step 1: Add the effect**

At the top of `AppShell`, after the existing screen-persistence effect, add:

```tsx
import { useNavStore } from "@/features/nav/useNavStore";

// ...inside AppShell()
const intent = useNavStore((s) => s.intent);
React.useEffect(() => {
  if (!intent) return;
  switch (intent.kind) {
    case "diff-file":
      setScreen("diff");
      break;
    case "commit-vs-wt":
    case "commit-vs-commit":
      setScreen("commitDiff");
      break;
    case "file-history":
      setScreen("fileHistory");
      break;
    case "blame":
      setScreen("blame");
      break;
  }
}, [intent]);
```

Also widen `ScreenId` to include the three new screens:

```tsx
type ScreenId =
  | "repo"
  | "commit"
  | "history"
  | "branches"
  | "conflict"
  | "rebase"
  | "remote"
  | "diff"
  | "reflog"
  | "commitDiff"
  | "fileHistory"
  | "blame";
```

(The three new screens are *not* added to `ACTIVITY_ITEMS` — they're only reachable via nav intents.)

- [ ] **Step 2: Route the new screens in the switch that renders the current screen**

Find the existing `switch (screen)` that renders the active screen, and add:

```tsx
case "commitDiff":
  return <CommitDiffScreen />;
case "fileHistory":
  return <FileHistoryScreen />;
case "blame":
  return <BlameScreen />;
```

Import the three screens at the top. **Note:** these three screens don't exist yet — the code won't compile until Tasks G/H/J land. Create stub files to unblock compilation:

```tsx
// src/screens/CommitDiff.tsx
export function CommitDiffScreen() {
  return <div>CommitDiff (pending)</div>;
}
// src/screens/FileHistory.tsx
export function FileHistoryScreen() {
  return <div>FileHistory (pending)</div>;
}
// src/screens/Blame.tsx
export function BlameScreen() {
  return <div>Blame (pending)</div>;
}
```

- [ ] **Step 3: Type-check**

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/AppShell.tsx src/screens/CommitDiff.tsx src/screens/FileHistory.tsx src/screens/Blame.tsx
git commit -m "feat(nav): route commitDiff/fileHistory/blame screens via NavIntent

Why: these screens are only reachable via context menu and need to
receive a selection when opened. Stub the screen bodies; real
implementations come in later tasks."
```

---

### Task B3: Extend `DiffViewerScreen` to consume `diff-file` intent

**Files:**
- Modify: `src/screens/DiffViewer.tsx`

- [ ] **Step 1: Consume the intent**

Near the existing `useEffect` that initializes `selectedPath` (around `src/screens/DiffViewer.tsx:49-51`), add:

```tsx
import { useNavStore } from "@/features/nav/useNavStore";

// ...inside DiffViewerScreen()
const intent = useNavStore((s) => s.intent);
const clearIntent = useNavStore((s) => s.clearIntent);
React.useEffect(() => {
  if (intent?.kind === "diff-file") {
    setSelectedPath(intent.path);
    clearIntent();
  }
}, [intent, clearIntent]);
```

- [ ] **Step 2: Type-check + manual smoke**

Run: `pnpm tsc --noEmit`. Then manually set the intent from the devtools console or wait for Task A5.

- [ ] **Step 3: Commit**

```bash
git add src/screens/DiffViewer.tsx
git commit -m "feat(diff): consume NavIntent 'diff-file' to pre-select a path"
```

---

### Task B4: Wire "View diff" file context menu to NavIntent

**Files:**
- Modify: `src/design/context-menu.tsx:758`

- [ ] **Step 1: Add the import and replace the onClick**

Add `import { useNavStore } from "@/features/nav/useNavStore";` to the top.

Replace the three placeholder entries:

```tsx
{
  icon: "diff",
  label: "View diff",
  shortcut: "⏎",
  onClick: () => {
    if (!path) return;
    useNavStore.getState().setIntent({ kind: "diff-file", path });
  },
},
```

Leave Blame / File history entries for now — they'll be wired in Tasks H4 and G4.

- [ ] **Step 2: Commit**

```bash
git add src/design/context-menu.tsx
git commit -m "feat(ui): wire 'View diff' file context menu to DiffViewer selection"
```

---

## Phase C — Simple backend additions

### Task C1: `stash_branch` backend method (TDD)

**Files:**
- Create: `src-tauri/tests/stash_branch.rs`
- Modify: `src-tauri/src/git/mod.rs`
- Modify: `src-tauri/src/git/libgit2.rs`
- Modify: `src-tauri/src/git/cli.rs`

- [ ] **Step 1: Write the failing test**

```rust
// src-tauri/tests/stash_branch.rs
mod support;

use platypusgit_lib::git::{types::StashSaveOptions, GitBackend};
use support::fs::{read_file, write_file};
use support::TempRepo;

#[test]
fn stash_branch_creates_branch_applies_stash_and_drops_it() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    write_file(tr.path(), "README.md", "dirty\n");
    backend
        .stash_save(
            &handle.id,
            StashSaveOptions {
                message: Some("wip".into()),
                include_untracked: false,
                keep_index: false,
            },
        )
        .unwrap();
    assert_eq!(backend.stashes(&handle.id).unwrap().len(), 1);

    backend.stash_branch(&handle.id, 0, "from-stash").unwrap();

    // New branch exists and is HEAD
    let branches = backend.branches(&handle.id).unwrap();
    let head = branches.iter().find(|b| b.is_head).unwrap();
    assert_eq!(head.name, "from-stash");
    // Stash is gone
    assert_eq!(backend.stashes(&handle.id).unwrap().len(), 0);
    // Working tree has the stashed change
    assert_eq!(read_file(tr.path(), "README.md"), "dirty\n");
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && cargo test --manifest-path src-tauri/Cargo.toml --test stash_branch`
Expected: FAIL with `no method named stash_branch`.

- [ ] **Step 3: Add the trait method**

In `src-tauri/src/git/mod.rs`, in the `=== stash ===` block (around line 70), add:

```rust
fn stash_branch(&self, repo_id: &RepoId, index: usize, branch: &str) -> AppResult<()>;
```

- [ ] **Step 4: Implement in Libgit2Backend**

In `src-tauri/src/git/libgit2.rs`, alongside the other `stash_*` methods:

```rust
fn stash_branch(&self, repo_id: &RepoId, index: usize, branch: &str) -> AppResult<()> {
    self.with_repo_mut(repo_id, |repo| {
        // git2 API: Repository::stash_apply + create a branch from stashed parent,
        // then drop. Equivalent to `git stash branch <name> stash@{index}`.
        //
        // The clean way is: find the stash OID, read its first parent as the
        // base commit, create a branch there, check it out, stash apply, drop.
        let stash_oid = {
            let mut found = None;
            repo.stash_foreach(|i, _msg, oid| {
                if i == index {
                    found = Some(*oid);
                    false
                } else {
                    true
                }
            })?;
            found.ok_or_else(|| AppError::Git(format!("stash {index} not found")))?
        };
        let stash_commit = repo.find_commit(stash_oid)?;
        let base_commit = stash_commit.parent(0)?;

        // Create the branch at base_commit and check it out
        repo.branch(branch, &base_commit, false)?;
        let refname = format!("refs/heads/{branch}");
        repo.set_head(&refname)?;
        repo.checkout_head(Some(
            git2::build::CheckoutBuilder::new().force(),
        ))?;

        // Apply the stash and drop it
        repo.stash_apply(index, None)?;
        repo.stash_drop(index)?;
        Ok(())
    })
}
```

Check whether `with_repo_mut` already exists in `libgit2.rs` (it's used by other write methods like `stash_save`). If the codebase uses `with_repo` for reads and a `Mutex` for writes, match the existing pattern.

- [ ] **Step 5: Stub in CliBackend**

In `src-tauri/src/git/cli.rs`, alongside other stash stubs:

```rust
fn stash_branch(&self, _repo_id: &RepoId, _index: usize, _branch: &str) -> AppResult<()> {
    Err(AppError::NotImplemented)
}
```

- [ ] **Step 6: Run the test**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test stash_branch`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/git/mod.rs src-tauri/src/git/libgit2.rs src-tauri/src/git/cli.rs src-tauri/tests/stash_branch.rs
git commit -m "feat(backend): stash_branch — new branch at stash base, apply, drop

Why: wiring stash context-menu 'Branch from stash…' requires a single
atomic operation; doing this in three store actions would leave the repo
in a bad state on failure."
```

---

### Task C2: `stash_branch` Tauri command + TS wrapper + store

**Files:**
- Modify: `src-tauri/src/commands/branches.rs` (or new `stash.rs` section)
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/lib/tauri.ts`
- Modify: `src/features/repo/useRepoStore.ts`

- [ ] **Step 1: Add the Tauri command**

Append to `src-tauri/src/commands/stash.rs`:

```rust
#[tauri::command]
pub async fn stash_branch(
    state: State<'_, AppState>,
    repo_id: String,
    index: usize,
    branch: String,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.stash_branch(&repo_id, index, &branch))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}
```

- [ ] **Step 2: Register the command**

In `src-tauri/src/lib.rs`, add `commands::stash::stash_branch,` to the `invoke_handler![…]` list.

- [ ] **Step 3: Add TS wrapper**

Append to `src/lib/tauri.ts` (in the stash section):

```ts
export async function stashBranch(
  repoId: string,
  index: number,
  branch: string,
): Promise<void> {
  return invoke<void>("stash_branch", { repoId, index, branch });
}
```

- [ ] **Step 4: Add store action**

In `src/features/repo/useRepoStore.ts`:

- Add `stashBranch as stashBranchFn` to the import from `@/lib/tauri`.
- Add to the store state interface:

```ts
stashBranch: (index: number, branch: string) => Promise<void>;
```

- Add the implementation alongside the other `stash*` actions:

```ts
async stashBranch(index, branch) {
  const repo = get().current;
  if (!repo) return;
  try {
    await stashBranchFn(repo.id, index, branch);
    await get().refreshAll();
  } catch (e) {
    set({ error: toAppError(e) });
  }
},
```

- [ ] **Step 5: Wire the context menu**

In `src/design/context-menu.tsx:823`, replace the "Branch from stash…" placeholder:

```tsx
{
  icon: "branch",
  label: "Branch from stash…",
  onClick: async () => {
    if (stash?.index == null) return;
    const branch = window.prompt("Branch name");
    if (!branch) return;
    await useRepoStore.getState().stashBranch(stash.index, branch);
  },
},
```

- [ ] **Step 6: Verify**

Run: `cargo check --manifest-path src-tauri/Cargo.toml && pnpm tsc --noEmit`
Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/commands/stash.rs src-tauri/src/lib.rs src/lib/tauri.ts src/features/repo/useRepoStore.ts src/design/context-menu.tsx
git commit -m "feat: wire 'Branch from stash…' end-to-end"
```

---

### Task C3: `.gitignore` append — backend + command (TDD)

**Files:**
- Create: `src-tauri/tests/gitignore.rs`
- Modify: `src-tauri/src/git/mod.rs`
- Modify: `src-tauri/src/git/libgit2.rs`, `src-tauri/src/git/cli.rs`

- [ ] **Step 1: Write the failing test**

```rust
// src-tauri/tests/gitignore.rs
mod support;

use platypusgit_lib::git::GitBackend;
use support::fs::{read_file, write_file};
use support::TempRepo;

#[test]
fn append_gitignore_creates_file_when_absent() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();

    backend.append_gitignore(&handle.id, "target/").unwrap();

    assert_eq!(read_file(tr.path(), ".gitignore"), "target/\n");
}

#[test]
fn append_gitignore_appends_trailing_newline_when_missing() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    // Existing .gitignore with no trailing newline
    write_file(tr.path(), ".gitignore", "*.log");

    backend.append_gitignore(&handle.id, "target/").unwrap();

    assert_eq!(read_file(tr.path(), ".gitignore"), "*.log\ntarget/\n");
}

#[test]
fn append_gitignore_dedupes_exact_match() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    write_file(tr.path(), ".gitignore", "target/\n");

    backend.append_gitignore(&handle.id, "target/").unwrap();

    assert_eq!(read_file(tr.path(), ".gitignore"), "target/\n");
}
```

- [ ] **Step 2: Run it — expect failure**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test gitignore`
Expected: FAIL with "no method named append_gitignore".

- [ ] **Step 3: Add trait method**

In `src-tauri/src/git/mod.rs`, in a new `=== ignore ===` section:

```rust
// === ignore ===
/// Append a pattern to the repo's top-level `.gitignore`, creating the file
/// if it doesn't exist. No-op if the pattern is already present on its own line.
fn append_gitignore(&self, repo_id: &RepoId, pattern: &str) -> AppResult<()>;
```

- [ ] **Step 4: Implement in Libgit2Backend**

```rust
fn append_gitignore(&self, repo_id: &RepoId, pattern: &str) -> AppResult<()> {
    self.with_repo(repo_id, |repo| {
        let workdir = repo
            .workdir()
            .ok_or_else(|| AppError::Git("bare repo has no worktree".into()))?;
        let gitignore = workdir.join(".gitignore");
        let existing = std::fs::read_to_string(&gitignore).unwrap_or_default();
        if existing.lines().any(|l| l.trim() == pattern) {
            return Ok(());
        }
        let needs_nl = !existing.is_empty() && !existing.ends_with('\n');
        let mut next = existing;
        if needs_nl {
            next.push('\n');
        }
        next.push_str(pattern);
        next.push('\n');
        std::fs::write(&gitignore, next)?;
        Ok(())
    })
}
```

- [ ] **Step 5: Stub in CliBackend**

```rust
fn append_gitignore(&self, _repo_id: &RepoId, _pattern: &str) -> AppResult<()> {
    Err(AppError::NotImplemented)
}
```

- [ ] **Step 6: Run the test**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test gitignore`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/git/mod.rs src-tauri/src/git/libgit2.rs src-tauri/src/git/cli.rs src-tauri/tests/gitignore.rs
git commit -m "feat(backend): append_gitignore — idempotent pattern append"
```

---

### Task C4: `.gitignore` Tauri command + TS wrapper + wire context menu

**Files:**
- Modify: `src-tauri/src/commands/repo.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/lib/tauri.ts`
- Modify: `src/features/repo/useRepoStore.ts`
- Modify: `src/design/context-menu.tsx:795`

- [ ] **Step 1: Tauri command**

Append to `src-tauri/src/commands/repo.rs`:

```rust
#[tauri::command]
pub async fn append_gitignore(
    state: State<'_, AppState>,
    repo_id: String,
    pattern: String,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.append_gitignore(&repo_id, &pattern))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}
```

- [ ] **Step 2: Register**

Add `commands::repo::append_gitignore,` to `invoke_handler!` in `src-tauri/src/lib.rs`.

- [ ] **Step 3: TS wrapper**

In `src/lib/tauri.ts`:

```ts
export async function appendGitignore(
  repoId: string,
  pattern: string,
): Promise<void> {
  return invoke<void>("append_gitignore", { repoId, pattern });
}
```

- [ ] **Step 4: Store action**

In `useRepoStore.ts`, import `appendGitignore as appendGitignoreFn`, extend the interface:

```ts
appendGitignore: (pattern: string) => Promise<void>;
```

Implementation:

```ts
async appendGitignore(pattern) {
  const repo = get().current;
  if (!repo) return;
  try {
    await appendGitignoreFn(repo.id, pattern);
    await get().refreshAll();
  } catch (e) {
    set({ error: toAppError(e) });
  }
},
```

- [ ] **Step 5: Wire the context menu**

In `src/design/context-menu.tsx:795`, replace:

```tsx
{
  icon: "trash",
  label: "Ignore this file",
  onClick: () => {
    if (!path) return;
    useRepoStore.getState().appendGitignore(path);
  },
},
```

- [ ] **Step 6: Verify**

Run: `cargo check --manifest-path src-tauri/Cargo.toml && pnpm tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/commands/repo.rs src-tauri/src/lib.rs src/lib/tauri.ts src/features/repo/useRepoStore.ts src/design/context-menu.tsx
git commit -m "feat: wire 'Ignore this file' to append_gitignore"
```

---

## Phase D — External processes (editor)

Opening the user's editor needs a small OS-level helper. We reuse the existing `run_git`-adjacent pattern in `commands/` but for an arbitrary program.

### Task D1: `open_in_editor` Tauri command

**Files:**
- Modify: `src-tauri/src/commands/repo.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add the command**

Append to `src-tauri/src/commands/repo.rs`:

```rust
use std::path::PathBuf;

/// Open `relative_path` (relative to the repo's worktree) in the user's editor.
/// Resolution order: $VISUAL, $EDITOR, then the platform default opener.
#[tauri::command]
pub async fn open_in_editor(
    state: State<'_, AppState>,
    repo_id: String,
    relative_path: String,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id_cloned = RepoId(repo_id);
    let workdir: PathBuf = tokio::task::spawn_blocking(move || {
        backend.repo_path(&repo_id_cloned)
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))??;
    let abs = workdir.join(&relative_path);

    // Prefer $VISUAL / $EDITOR (common for devs — vim, nvim, code, etc.)
    let editor = std::env::var("VISUAL")
        .ok()
        .or_else(|| std::env::var("EDITOR").ok());

    if let Some(editor) = editor {
        // Editors like "code --wait" need shell-word splitting. We support
        // the common case of program-and-args split on whitespace.
        let mut parts = editor.split_whitespace();
        let prog = parts.next().unwrap_or("");
        let args: Vec<&str> = parts.collect();
        let status = tokio::process::Command::new(prog)
            .args(&args)
            .arg(&abs)
            .status()
            .await
            .map_err(|e| AppError::Io(e.to_string()))?;
        if !status.success() {
            return Err(AppError::Internal(format!(
                "editor '{editor}' exited with {status}"
            )));
        }
        return Ok(());
    }

    // Fallback: platform default
    #[cfg(target_os = "macos")]
    let (prog, args): (&str, Vec<&str>) = ("open", vec![]);
    #[cfg(target_os = "linux")]
    let (prog, args): (&str, Vec<&str>) = ("xdg-open", vec![]);
    #[cfg(target_os = "windows")]
    let (prog, args): (&str, Vec<&str>) = ("cmd", vec!["/C", "start", ""]);

    tokio::process::Command::new(prog)
        .args(&args)
        .arg(&abs)
        .status()
        .await
        .map_err(|e| AppError::Io(e.to_string()))?;
    Ok(())
}
```

- [ ] **Step 2: Register**

Add `commands::repo::open_in_editor,` to `invoke_handler!`.

- [ ] **Step 3: Verify**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/repo.rs src-tauri/src/lib.rs
git commit -m "feat(backend): open_in_editor — VISUAL/EDITOR then platform default"
```

---

### Task D2: TS wrapper + store + wire

**Files:**
- Modify: `src/lib/tauri.ts`
- Modify: `src/features/repo/useRepoStore.ts`
- Modify: `src/design/context-menu.tsx:774`
- Modify: `src/screens/Conflict.tsx:450`

- [ ] **Step 1: TS wrapper**

```ts
export async function openInEditor(
  repoId: string,
  relativePath: string,
): Promise<void> {
  return invoke<void>("open_in_editor", { repoId, relativePath });
}
```

- [ ] **Step 2: Store action**

In `useRepoStore.ts`, import and add:

```ts
openInEditor: (relativePath: string) => Promise<void>;
// ...
async openInEditor(relativePath) {
  const repo = get().current;
  if (!repo) return;
  try {
    await openInEditorFn(repo.id, relativePath);
  } catch (e) {
    set({ error: toAppError(e) });
  }
},
```

(No `refreshAll` — editor exit doesn't change git state guaranteed.)

- [ ] **Step 3: Wire file context menu (line 774)**

```tsx
{
  icon: "edit",
  label: "Open in editor",
  shortcut: "⌘O",
  onClick: () => {
    if (!path) return;
    useRepoStore.getState().openInEditor(path);
  },
},
```

- [ ] **Step 4: Wire conflict context menu "Edit resolution in editor" (line 867)**

```tsx
{
  icon: "edit",
  label: "Edit resolution in editor",
  onClick: () => {
    if (!conflict?.path) return;
    useRepoStore.getState().openInEditor(conflict.path);
  },
},
```

- [ ] **Step 5: Wire Conflict screen onEdit (line 450)**

In `src/screens/Conflict.tsx`, find the `onEdit` prop passed to the conflict editor. Replace `pgFlash("external editor TODO")` with:

```tsx
onEdit={() => useRepoStore.getState().openInEditor(path)}
```

Make sure `path` in scope refers to the current conflicted file.

- [ ] **Step 6: Type-check**

Run: `pnpm tsc --noEmit`

- [ ] **Step 7: Commit**

```bash
git add src/lib/tauri.ts src/features/repo/useRepoStore.ts src/design/context-menu.tsx src/screens/Conflict.tsx
git commit -m "feat: wire 'Open in editor' + conflict editor button to open_in_editor"
```

---

## Phase E — Mergetool

### Task E1: `run_mergetool` Tauri command

**Files:**
- Modify: `src-tauri/src/commands/conflict.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add the command**

Append to `src-tauri/src/commands/conflict.rs`:

```rust
use std::path::PathBuf;

/// Run `git mergetool -- <path>` in the worktree to launch the user's
/// configured mergetool. Inherits stdio so the tool can interact on terminal
/// tools; for GUI tools this is still correct because git spawns them detached.
#[tauri::command]
pub async fn run_mergetool(
    state: State<'_, AppState>,
    repo_id: String,
    path: String,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id_cloned = RepoId(repo_id);
    let workdir: PathBuf = tokio::task::spawn_blocking(move || {
        backend.repo_path(&repo_id_cloned)
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))??;

    let status = tokio::process::Command::new("git")
        .arg("-C")
        .arg(&workdir)
        .arg("mergetool")
        .arg("--no-prompt")
        .arg("--")
        .arg(&path)
        .status()
        .await
        .map_err(|e| AppError::Io(e.to_string()))?;
    if !status.success() {
        return Err(AppError::Network(format!(
            "git mergetool exited with {status}"
        )));
    }
    Ok(())
}
```

- [ ] **Step 2: Register**

Add `commands::conflict::run_mergetool,` to `invoke_handler!`.

- [ ] **Step 3: Verify**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/conflict.rs src-tauri/src/lib.rs
git commit -m "feat(backend): run_mergetool shells out to 'git mergetool --no-prompt'

Why: libgit2 has no concept of mergetool; git's own impl handles user
config (merge.tool, difftool) and GUI tool lifecycles correctly."
```

---

### Task E2: TS wrapper + store + wire

**Files:**
- Modify: `src/lib/tauri.ts`, `src/features/repo/useRepoStore.ts`, `src/design/context-menu.tsx:861`

- [ ] **Step 1: TS wrapper**

```ts
export async function runMergetool(
  repoId: string,
  path: string,
): Promise<void> {
  return invoke<void>("run_mergetool", { repoId, path });
}
```

- [ ] **Step 2: Store action**

```ts
runMergetool: (path: string) => Promise<void>;
// ...
async runMergetool(path) {
  const repo = get().current;
  if (!repo) return;
  try {
    await runMergetoolFn(repo.id, path);
    await get().refreshAll(); // mergetool usually resolves the file
  } catch (e) {
    set({ error: toAppError(e) });
  }
},
```

- [ ] **Step 3: Wire the context menu**

```tsx
{
  icon: "merge",
  label: "Open 3-way merge tool",
  onClick: () => {
    if (!conflict?.path) return;
    useRepoStore.getState().runMergetool(conflict.path);
  },
},
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/tauri.ts src/features/repo/useRepoStore.ts src/design/context-menu.tsx
git commit -m "feat: wire 'Open 3-way merge tool' to git mergetool"
```

---

## Phase F — Restart conflict resolution

Restart = re-materialize the conflict markers in the worktree for a single path.
Implementation: `git checkout --merge -- <path>` re-creates the conflicted blob from the index's three stages. This bypasses `GitBackend` (shell-out), matching how rebase/merge operations already do.

### Task F1: `restart_conflict` command

**Files:**
- Modify: `src-tauri/src/commands/conflict.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add command**

```rust
#[tauri::command]
pub async fn restart_conflict(
    state: State<'_, AppState>,
    repo_id: String,
    path: String,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id_cloned = RepoId(repo_id);
    let workdir: PathBuf = tokio::task::spawn_blocking(move || {
        backend.repo_path(&repo_id_cloned)
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))??;

    let status = tokio::process::Command::new("git")
        .arg("-C")
        .arg(&workdir)
        .arg("checkout")
        .arg("--merge")
        .arg("--")
        .arg(&path)
        .status()
        .await
        .map_err(|e| AppError::Io(e.to_string()))?;
    if !status.success() {
        return Err(AppError::Git(format!(
            "git checkout --merge exited with {status}"
        )));
    }
    Ok(())
}
```

- [ ] **Step 2: Register**

Add `commands::conflict::restart_conflict,` to `invoke_handler!`.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/commands/conflict.rs src-tauri/src/lib.rs
git commit -m "feat(backend): restart_conflict re-materializes conflict markers via checkout --merge"
```

---

### Task F2: TS wrapper + store + wire

**Files:**
- Modify: `src/lib/tauri.ts`, `src/features/repo/useRepoStore.ts`, `src/design/context-menu.tsx:881`

- [ ] **Step 1: TS wrapper**

```ts
export async function restartConflict(
  repoId: string,
  path: string,
): Promise<void> {
  return invoke<void>("restart_conflict", { repoId, path });
}
```

- [ ] **Step 2: Store action**

```ts
restartConflict: (path: string) => Promise<void>;
// ...
async restartConflict(path) {
  const repo = get().current;
  if (!repo) return;
  try {
    await restartConflictFn(repo.id, path);
    await get().refreshAll();
  } catch (e) {
    set({ error: toAppError(e) });
  }
},
```

- [ ] **Step 3: Wire the context menu**

```tsx
{
  icon: "undo",
  label: "Restart resolution",
  danger: true,
  onClick: () => {
    if (!conflict?.path) return;
    if (
      window.confirm(
        `Restart resolution for ${conflict.path}? Current edits are discarded.`,
      )
    )
      useRepoStore.getState().restartConflict(conflict.path);
  },
},
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/tauri.ts src/features/repo/useRepoStore.ts src/design/context-menu.tsx
git commit -m "feat: wire 'Restart resolution' to checkout --merge"
```

---

## Phase G — File history

### Task G1: `file_history` backend (TDD)

**Files:**
- Create: `src-tauri/tests/file_history.rs`
- Modify: `src-tauri/src/git/mod.rs`, `libgit2.rs`, `cli.rs`

- [ ] **Step 1: Write the failing test**

```rust
// src-tauri/tests/file_history.rs
mod support;

use platypusgit_lib::git::GitBackend;
use support::fs::write_file;
use support::TempRepo;

#[test]
fn file_history_returns_commits_that_touched_the_path() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();

    // Commit 2: touch foo.txt
    write_file(tr.path(), "foo.txt", "a\n");
    tr.commit_all("add foo");

    // Commit 3: touch bar.txt (should not appear in foo.txt history)
    write_file(tr.path(), "bar.txt", "b\n");
    tr.commit_all("add bar");

    // Commit 4: modify foo.txt
    write_file(tr.path(), "foo.txt", "a\nb\n");
    tr.commit_all("edit foo");

    let history = backend
        .file_history(&handle.id, std::path::Path::new("foo.txt"), 100)
        .unwrap();

    let summaries: Vec<&str> = history.iter().map(|c| c.summary.as_str()).collect();
    assert_eq!(summaries, vec!["edit foo", "add foo"]);
}
```

Note: `TempRepo::commit_all` may not exist — check `tests/support/mod.rs`. If it doesn't, add it there:

```rust
// In support/mod.rs if commit_all is missing:
impl TempRepo {
    pub fn commit_all(&self, msg: &str) -> git2::Oid {
        let repo = git2::Repository::open(self.path()).unwrap();
        let mut index = repo.index().unwrap();
        index.add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None).unwrap();
        index.write().unwrap();
        let tree_oid = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_oid).unwrap();
        let sig = git2::Signature::now("Test", "test@example.com").unwrap();
        let head = repo.head().ok().and_then(|h| h.target()).map(|o| repo.find_commit(o).unwrap());
        let parents: Vec<&git2::Commit> = head.as_ref().map(|c| vec![c]).unwrap_or_default();
        repo.commit(Some("HEAD"), &sig, &sig, msg, &tree, &parents).unwrap()
    }
}
```

- [ ] **Step 2: Run it — expect failure**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test file_history`
Expected: FAIL with "no method named file_history".

- [ ] **Step 3: Add trait method**

In `src-tauri/src/git/mod.rs`, near `log`:

```rust
/// Commits that touched `path`, newest first, up to `limit`.
fn file_history(
    &self,
    repo_id: &RepoId,
    path: &Path,
    limit: usize,
) -> AppResult<Vec<CommitInfo>>;
```

- [ ] **Step 4: Implement in Libgit2Backend**

Reuse the existing log→CommitInfo mapping. Path filter:

```rust
fn file_history(
    &self,
    repo_id: &RepoId,
    path: &Path,
    limit: usize,
) -> AppResult<Vec<CommitInfo>> {
    self.with_repo(repo_id, |repo| {
        let mut revwalk = repo.revwalk()?;
        revwalk.push_head().or_else(|e| {
            if e.code() == git2::ErrorCode::UnbornBranch {
                Err(AppError::Unborn)
            } else {
                Err(e.into())
            }
        })?;
        revwalk.set_sorting(git2::Sort::TIME)?;

        let mut out = Vec::with_capacity(limit);
        for oid_res in revwalk {
            if out.len() >= limit { break; }
            let oid = oid_res?;
            let commit = repo.find_commit(oid)?;
            if commit_touches_path(repo, &commit, path)? {
                out.push(commit_to_info(&commit));
            }
        }
        Ok(out)
    })
}
```

Helper (add near the bottom of `libgit2.rs`):

```rust
fn commit_touches_path(
    repo: &git2::Repository,
    commit: &git2::Commit<'_>,
    path: &std::path::Path,
) -> AppResult<bool> {
    // A root commit touches any path that is in its tree.
    if commit.parent_count() == 0 {
        let tree = commit.tree()?;
        return Ok(tree.get_path(path).is_ok());
    }
    for i in 0..commit.parent_count() {
        let parent = commit.parent(i)?;
        let parent_tree = parent.tree()?;
        let commit_tree = commit.tree()?;
        let mut opts = git2::DiffOptions::new();
        opts.pathspec(path);
        let diff = repo.diff_tree_to_tree(
            Some(&parent_tree),
            Some(&commit_tree),
            Some(&mut opts),
        )?;
        if diff.deltas().len() > 0 {
            return Ok(true);
        }
    }
    Ok(false)
}
```

And reuse the existing `commit_to_info` in `libgit2.rs` (grep for the current `log` impl to find it — if it's inline inside `log`, extract it first).

- [ ] **Step 5: Stub in CliBackend**

```rust
fn file_history(
    &self,
    _repo_id: &RepoId,
    _path: &Path,
    _limit: usize,
) -> AppResult<Vec<CommitInfo>> {
    Err(AppError::NotImplemented)
}
```

- [ ] **Step 6: Run the test**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test file_history`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/git/mod.rs src-tauri/src/git/libgit2.rs src-tauri/src/git/cli.rs src-tauri/tests/file_history.rs src-tauri/tests/support/mod.rs
git commit -m "feat(backend): file_history — path-filtered revwalk"
```

---

### Task G2: `file_history` command + TS

**Files:**
- Modify: `src-tauri/src/commands/commits.rs`, `lib.rs`, `src/lib/tauri.ts`

- [ ] **Step 1: Add command**

```rust
// In src-tauri/src/commands/commits.rs
#[tauri::command]
pub async fn file_history(
    state: State<'_, AppState>,
    repo_id: String,
    path: String,
    limit: usize,
) -> AppResult<Vec<CommitInfo>> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let path = std::path::PathBuf::from(path);
    tokio::task::spawn_blocking(move || backend.file_history(&repo_id, &path, limit))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}
```

- [ ] **Step 2: Register** — add `commands::commits::file_history,` to `invoke_handler!`.

- [ ] **Step 3: TS wrapper**

```ts
export async function fileHistory(
  repoId: string,
  path: string,
  limit = 200,
): Promise<CommitInfo[]> {
  return invoke<CommitInfo[]>("file_history", { repoId, path, limit });
}
```

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/commits.rs src-tauri/src/lib.rs src/lib/tauri.ts
git commit -m "feat: expose file_history Tauri command + TS wrapper"
```

---

### Task G3: `FileHistoryScreen`

**Files:**
- Modify: `src/screens/FileHistory.tsx` (currently stubbed)

- [ ] **Step 1: Replace stub with real screen**

```tsx
import React from "react";
import { PGEmpty, PGSpinner } from "@/design";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { fileHistory } from "@/lib/tauri";
import { appErrorMessage } from "@/lib/errors";
import type { CommitInfo } from "@/lib/types";

export function FileHistoryScreen() {
  const repo = useRepoStore((s) => s.current);
  const intent = useNavStore((s) => s.intent);
  const clearIntent = useNavStore((s) => s.clearIntent);

  const [path, setPath] = React.useState<string | null>(null);
  const [commits, setCommits] = React.useState<CommitInfo[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (intent?.kind === "file-history") {
      setPath(intent.path);
      clearIntent();
    }
  }, [intent, clearIntent]);

  React.useEffect(() => {
    if (!repo || !path) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fileHistory(repo.id, path)
      .then((c) => { if (!cancelled) setCommits(c); })
      .catch((e) => { if (!cancelled) setError(appErrorMessage(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [repo?.id, path]);

  if (!path) {
    return (
      <PGEmpty icon="history" title="No file selected">
        Right-click a file and choose "File history".
      </PGEmpty>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{
        padding: "8px 12px",
        borderBottom: "1px solid var(--border-0)",
        fontFamily: "var(--font-mono)",
        fontSize: "var(--fs-12)",
      }}>
        History — {path}
      </div>
      {loading && <div style={{ padding: 12 }}><PGSpinner /></div>}
      {error && <div style={{ padding: 12, color: "var(--git-removed)" }}>{error}</div>}
      {!loading && !error && commits.length === 0 && (
        <PGEmpty icon="history" title="No commits touched this file" />
      )}
      <div style={{ flex: 1, overflow: "auto" }}>
        {commits.map((c) => (
          <div key={c.oid} style={{
            display: "flex",
            gap: 10,
            padding: "6px 12px",
            borderBottom: "1px solid var(--border-0)",
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-12)",
          }}>
            <span style={{ color: "var(--fg-3)" }}>{c.shortOid}</span>
            <span style={{ flex: 1 }}>{c.summary}</span>
            <span style={{ color: "var(--fg-3)" }}>{c.author}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire the context menu (file menu "File history")**

Replace `pgFlash(\`log -- ${path}\`)` in `src/design/context-menu.tsx:768`:

```tsx
{
  icon: "history",
  label: "File history",
  onClick: () => {
    if (!path) return;
    useNavStore.getState().setIntent({ kind: "file-history", path });
  },
},
```

- [ ] **Step 3: Type-check**

Run: `pnpm tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add src/screens/FileHistory.tsx src/design/context-menu.tsx
git commit -m "feat(ui): FileHistoryScreen lists commits that touched a path"
```

---

## Phase H — Blame

### Task H1: Blame backend types + method (TDD)

**Files:**
- Modify: `src-tauri/src/git/types.rs`
- Modify: `src-tauri/src/git/mod.rs`, `libgit2.rs`, `cli.rs`
- Create: `src-tauri/tests/blame.rs`

- [ ] **Step 1: Add types**

In `src-tauri/src/git/types.rs`:

```rust
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlameLine {
    /// 1-indexed line number in the current version of the file.
    pub line_no: u32,
    /// Commit OID that last modified this line.
    pub oid: String,
    pub short_oid: String,
    pub author: String,
    pub email: String,
    pub timestamp: i64,
    pub summary: String,
    pub content: String,
}
```

- [ ] **Step 2: Write failing test**

```rust
// src-tauri/tests/blame.rs
mod support;

use platypusgit_lib::git::GitBackend;
use support::fs::write_file;
use support::TempRepo;

#[test]
fn blame_attributes_each_line_to_the_commit_that_last_changed_it() {
    let tr = TempRepo::with_initial_commit("line-a\nline-b\n");
    let (backend, handle) = tr.open_with_backend();

    // second commit modifies line 2 only
    write_file(tr.path(), "README.md", "line-a\nline-b-edited\n");
    let commit2 = tr.commit_all("edit line 2");
    let initial = backend.log(&handle.id, 10).unwrap().last().unwrap().oid.clone();

    let lines = backend
        .blame_file(&handle.id, std::path::Path::new("README.md"))
        .unwrap();

    assert_eq!(lines.len(), 2);
    assert_eq!(lines[0].line_no, 1);
    assert_eq!(lines[0].oid, initial);
    assert_eq!(lines[1].line_no, 2);
    assert_eq!(lines[1].oid, commit2.to_string());
    assert_eq!(lines[1].content, "line-b-edited");
}
```

- [ ] **Step 3: Run — expect failure**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test blame`
Expected: FAIL with "no method named blame_file".

- [ ] **Step 4: Trait method**

In `mod.rs`:

```rust
use types::BlameLine;
// ...
fn blame_file(&self, repo_id: &RepoId, path: &Path) -> AppResult<Vec<BlameLine>>;
```

- [ ] **Step 5: Implement**

In `libgit2.rs`:

```rust
fn blame_file(&self, repo_id: &RepoId, path: &Path) -> AppResult<Vec<BlameLine>> {
    self.with_repo(repo_id, |repo| {
        let mut opts = git2::BlameOptions::new();
        let blame = repo.blame_file(path, Some(&mut opts))?;

        // Read the current file content from the worktree to get line text.
        let workdir = repo
            .workdir()
            .ok_or_else(|| AppError::Git("bare repo has no worktree".into()))?;
        let content = std::fs::read_to_string(workdir.join(path))?;
        let content_lines: Vec<&str> = content.lines().collect();

        let mut out = Vec::new();
        for hunk in blame.iter() {
            let oid = hunk.final_commit_id();
            let commit = repo.find_commit(oid).ok();
            let author = commit
                .as_ref()
                .map(|c| c.author().name().unwrap_or("").to_string())
                .unwrap_or_default();
            let email = commit
                .as_ref()
                .map(|c| c.author().email().unwrap_or("").to_string())
                .unwrap_or_default();
            let timestamp = commit
                .as_ref()
                .map(|c| c.time().seconds())
                .unwrap_or(0);
            let summary = commit
                .as_ref()
                .and_then(|c| c.summary().map(String::from))
                .unwrap_or_default();
            let short = oid.to_string()[..7].to_string();
            let start = hunk.final_start_line();
            for i in 0..hunk.lines_in_hunk() {
                let line_no = (start + i) as u32;
                let content_str = content_lines
                    .get((line_no - 1) as usize)
                    .copied()
                    .unwrap_or("")
                    .to_string();
                out.push(BlameLine {
                    line_no,
                    oid: oid.to_string(),
                    short_oid: short.clone(),
                    author: author.clone(),
                    email: email.clone(),
                    timestamp,
                    summary: summary.clone(),
                    content: content_str,
                });
            }
        }
        out.sort_by_key(|l| l.line_no);
        Ok(out)
    })
}
```

- [ ] **Step 6: Stub CliBackend**

```rust
fn blame_file(&self, _repo_id: &RepoId, _path: &Path) -> AppResult<Vec<BlameLine>> {
    Err(AppError::NotImplemented)
}
```

(And add `BlameLine` to the `use` list in `cli.rs`.)

- [ ] **Step 7: Run test**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test blame`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/git/types.rs src-tauri/src/git/mod.rs src-tauri/src/git/libgit2.rs src-tauri/src/git/cli.rs src-tauri/tests/blame.rs
git commit -m "feat(backend): blame_file using git2::Repository::blame_file"
```

---

### Task H2: Blame command + TS

**Files:**
- Modify: `src-tauri/src/commands/diff.rs`, `src-tauri/src/lib.rs`, `src/lib/tauri.ts`, `src/lib/types.ts`

- [ ] **Step 1: Tauri command**

In `src-tauri/src/commands/diff.rs`:

```rust
use crate::git::types::BlameLine;
// ...
#[tauri::command]
pub async fn blame_file(
    state: State<'_, AppState>,
    repo_id: String,
    path: String,
) -> AppResult<Vec<BlameLine>> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let path = PathBuf::from(path);
    tokio::task::spawn_blocking(move || backend.blame_file(&repo_id, &path))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}
```

- [ ] **Step 2: Register** — add `commands::diff::blame_file,` to `invoke_handler!`.

- [ ] **Step 3: TS type**

In `src/lib/types.ts`:

```ts
export interface BlameLine {
  lineNo: number;
  oid: string;
  shortOid: string;
  author: string;
  email: string;
  timestamp: number;
  summary: string;
  content: string;
}
```

- [ ] **Step 4: TS wrapper**

```ts
export async function blameFile(
  repoId: string,
  path: string,
): Promise<BlameLine[]> {
  return invoke<BlameLine[]>("blame_file", { repoId, path });
}
```

Also add `BlameLine` to the import list in `src/lib/tauri.ts` if needed.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/diff.rs src-tauri/src/lib.rs src/lib/tauri.ts src/lib/types.ts
git commit -m "feat: expose blame_file Tauri command + TS wrapper"
```

---

### Task H3: `BlameScreen`

**Files:**
- Modify: `src/screens/Blame.tsx`

- [ ] **Step 1: Replace stub**

```tsx
import React from "react";
import { PGEmpty, PGSpinner } from "@/design";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { blameFile } from "@/lib/tauri";
import { appErrorMessage } from "@/lib/errors";
import type { BlameLine } from "@/lib/types";

export function BlameScreen() {
  const repo = useRepoStore((s) => s.current);
  const intent = useNavStore((s) => s.intent);
  const clearIntent = useNavStore((s) => s.clearIntent);

  const [path, setPath] = React.useState<string | null>(null);
  const [lines, setLines] = React.useState<BlameLine[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (intent?.kind === "blame") {
      setPath(intent.path);
      clearIntent();
    }
  }, [intent, clearIntent]);

  React.useEffect(() => {
    if (!repo || !path) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    blameFile(repo.id, path)
      .then((l) => { if (!cancelled) setLines(l); })
      .catch((e) => { if (!cancelled) setError(appErrorMessage(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [repo?.id, path]);

  if (!path) {
    return (
      <PGEmpty icon="search" title="No file selected">
        Right-click a file and choose "Blame".
      </PGEmpty>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{
        padding: "8px 12px",
        borderBottom: "1px solid var(--border-0)",
        fontFamily: "var(--font-mono)",
        fontSize: "var(--fs-12)",
      }}>
        Blame — {path}
      </div>
      {loading && <div style={{ padding: 12 }}><PGSpinner /></div>}
      {error && <div style={{ padding: 12, color: "var(--git-removed)" }}>{error}</div>}
      <div style={{
        flex: 1, overflow: "auto",
        fontFamily: "var(--font-mono)", fontSize: "var(--fs-12)",
      }}>
        {lines.map((l) => (
          <div key={l.lineNo} style={{
            display: "flex",
            gap: 12,
            padding: "0 12px",
            whiteSpace: "pre",
          }}>
            <span style={{ width: 56, color: "var(--fg-3)" }}>{l.shortOid}</span>
            <span style={{ width: 120, color: "var(--fg-3)", overflow: "hidden", textOverflow: "ellipsis" }}>
              {l.author}
            </span>
            <span style={{ width: 40, color: "var(--fg-3)", textAlign: "right" }}>{l.lineNo}</span>
            <span style={{ flex: 1 }}>{l.content}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire the context menu (file menu "Blame", line 763)**

```tsx
{
  icon: "search",
  label: "Blame",
  onClick: () => {
    if (!path) return;
    useNavStore.getState().setIntent({ kind: "blame", path });
  },
},
```

- [ ] **Step 3: Type-check**

Run: `pnpm tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add src/screens/Blame.tsx src/design/context-menu.tsx
git commit -m "feat(ui): BlameScreen renders blame output in a fixed-width grid"
```

---

## Phase I — Commit diff viewer (commit vs WT, commit vs commit)

### Task I1: `CommitDiffScreen`

**Files:**
- Modify: `src/screens/CommitDiff.tsx`

- [ ] **Step 1: Implement**

```tsx
import React from "react";
import { PGEmpty, PGSpinner, PGSideBySideDiff, type DiffLineData, type SideLine } from "@/design";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { diffCommits } from "@/lib/tauri";
import { appErrorMessage } from "@/lib/errors";
import type { FileDiff } from "@/lib/types";

type Target =
  | { kind: "commit-vs-wt"; oid: string }
  | { kind: "commit-vs-commit"; from: string; to: string };

export function CommitDiffScreen() {
  const repo = useRepoStore((s) => s.current);
  const intent = useNavStore((s) => s.intent);
  const clearIntent = useNavStore((s) => s.clearIntent);

  const [target, setTarget] = React.useState<Target | null>(null);
  const [diffs, setDiffs] = React.useState<FileDiff[]>([]);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (intent?.kind === "commit-vs-wt") {
      setTarget({ kind: "commit-vs-wt", oid: intent.oid });
      clearIntent();
    } else if (intent?.kind === "commit-vs-commit") {
      setTarget({ kind: "commit-vs-commit", from: intent.from, to: intent.to });
      clearIntent();
    }
  }, [intent, clearIntent]);

  React.useEffect(() => {
    if (!repo || !target) return;
    const [from, to] =
      target.kind === "commit-vs-wt"
        ? [target.oid, "HEAD"]
        : [target.from, target.to];
    let cancelled = false;
    setLoading(true);
    setError(null);
    diffCommits(repo.id, from, to)
      .then((d) => { if (!cancelled) { setDiffs(d); setSelected(d[0]?.path ?? null); } })
      .catch((e) => { if (!cancelled) setError(appErrorMessage(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [repo?.id, target]);

  if (!target) {
    return <PGEmpty icon="diff" title="No diff target">Pick "Compare…" from a context menu.</PGEmpty>;
  }

  const current = diffs.find((d) => d.path === selected) ?? null;

  return (
    <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
      <div style={{
        width: 260, overflow: "auto",
        borderRight: "1px solid var(--border-0)",
        fontFamily: "var(--font-mono)", fontSize: "var(--fs-12)",
      }}>
        <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--border-0)" }}>
          {target.kind === "commit-vs-wt"
            ? `${target.oid.slice(0, 7)} → HEAD`
            : `${target.from.slice(0, 7)} → ${target.to.slice(0, 7)}`}
        </div>
        {loading && <div style={{ padding: 12 }}><PGSpinner /></div>}
        {error && <div style={{ padding: 12, color: "var(--git-removed)" }}>{error}</div>}
        {diffs.map((d) => (
          <div
            key={d.path}
            onClick={() => setSelected(d.path)}
            style={{
              padding: "4px 12px",
              cursor: "pointer",
              background: d.path === selected ? "var(--bg-1)" : "transparent",
            }}
          >
            {d.path}
          </div>
        ))}
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: 12 }}>
        {current && current.hunks.map((h, i) => (
          <div key={i} style={{ marginBottom: 16 }}>
            <div style={{ color: "var(--fg-3)", fontFamily: "var(--font-mono)", fontSize: "var(--fs-12)" }}>
              {h.header}
            </div>
            {h.lines.map((ln, j) => (
              <div key={j} style={{
                fontFamily: "var(--font-mono)", fontSize: "var(--fs-12)",
                whiteSpace: "pre",
                color: ln.kind.kind === "Addition" ? "var(--git-added)" :
                       ln.kind.kind === "Deletion" ? "var(--git-removed)" : "var(--fg-0)",
              }}>
                {ln.kind.kind === "Addition" ? "+" : ln.kind.kind === "Deletion" ? "-" : " "}
                {ln.content}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
```

(PGSideBySideDiff integration is deliberately skipped for this first pass — the plain unified view above is enough to replace the `pgFlash`. Split view can follow as a follow-up.)

- [ ] **Step 2: Wire commit menu "Compare with working tree" (line 409)**

```tsx
{
  icon: "diff",
  label: "Compare with working tree",
  onClick: () => {
    if (!commit?.sha) return;
    useNavStore.getState().setIntent({ kind: "commit-vs-wt", oid: commit.sha });
  },
},
```

- [ ] **Step 3: Wire remote-branch menu "Compare with current" (line 591)**

We need the branch tip OID and current HEAD OID. The store already exposes `branches` with `tip`. Replace:

```tsx
{
  icon: "diff",
  label: "Compare with current",
  onClick: () => {
    const branches = useRepoStore.getState().branches;
    const head = branches.find((b) => b.isHead);
    const target = branches.find((b) => b.name === name);
    if (!head?.tip || !target?.tip) return;
    useNavStore.getState().setIntent({
      kind: "commit-vs-commit",
      from: head.tip,
      to: target.tip,
    });
  },
},
```

- [ ] **Step 4: Type-check**

Run: `pnpm tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add src/screens/CommitDiff.tsx src/design/context-menu.tsx
git commit -m "feat(ui): CommitDiffScreen for commit-vs-WT and branch-vs-branch

Why: two context-menu actions only had pgFlash placeholders because
DiffViewer is worktree-oriented; a separate commit-oriented screen keeps
each screen single-purpose."
```

---

## Phase J — Interactive rebase from commit menu

Backend `rebase_start(plan)` already exists. The UI just needs to build a plan and navigate to the existing `RebaseScreen` (which handles the edit/continue/abort flow). We won't auto-start from the context menu — instead, we seed `RebaseScreen` with a default plan via a new store field.

### Task J1: Seed field in repo store for a pending rebase plan

**Files:**
- Modify: `src/features/repo/useRepoStore.ts`

- [ ] **Step 1: Add seed field**

```ts
// Add to interface:
pendingRebasePlan: RebaseStep[] | null;
setPendingRebasePlan: (plan: RebaseStep[] | null) => void;

// Add to initial state:
pendingRebasePlan: null,

// Add to actions:
setPendingRebasePlan(plan) {
  set({ pendingRebasePlan: plan });
},
```

- [ ] **Step 2: Type-check**

Run: `pnpm tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/features/repo/useRepoStore.ts
git commit -m "feat(store): pendingRebasePlan seed for context-menu-driven rebases"
```

---

### Task J2: Plan-building helper

**Files:**
- Create: `src/features/commits/buildRebasePlan.ts`

- [ ] **Step 1: Write helper**

```ts
import type { CommitInfo, RebaseStep, RebaseAction } from "@/lib/types";

/**
 * Build a rebase plan covering the commits strictly after `fromOid` up to and
 * including HEAD (the first entry in `commits`). The plan is newest-first in
 * commits but git wants oldest-first for rebase-todo, so we reverse.
 *
 * `mode`:
 *   - "edit-from": every commit is a plain pick (equivalent to `rebase -i fromOid^`).
 *   - { kind: "fixup", targetOid }: target becomes "fixup"; commits newer than
 *     target are left alone, older commits (ancestors of target) are untouched.
 *   - { kind: "squash", targetOid, message }: target becomes "squash" with a
 *     custom message.
 *
 * Returns null when the target isn't in the rebaseable range.
 */
export function buildRebasePlan(
  commits: CommitInfo[],
  fromOid: string,
  mode:
    | { kind: "edit-from" }
    | { kind: "fixup"; targetOid: string }
    | { kind: "squash"; targetOid: string; message: string },
): RebaseStep[] | null {
  // Range is commits up to and including the first commit whose oid === fromOid,
  // exclusive of fromOid (i.e. fromOid is the base, everything newer is rebased).
  const idx = commits.findIndex((c) => c.oid === fromOid);
  if (idx < 0) return null;
  const newestFirst = commits.slice(0, idx);
  const oldestFirst = newestFirst.slice().reverse();

  return oldestFirst.map((c): RebaseStep => {
    let action: RebaseAction = "Pick";
    let message: string | null = null;
    if (mode.kind === "fixup" && c.oid === mode.targetOid) {
      action = "Fixup";
    } else if (mode.kind === "squash" && c.oid === mode.targetOid) {
      action = "Squash";
      message = mode.message;
    }
    return { oid: c.oid, action, message };
  });
}
```

- [ ] **Step 2: Write a quick vitest**

Create `src/features/commits/buildRebasePlan.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildRebasePlan } from "./buildRebasePlan";
import type { CommitInfo } from "@/lib/types";

const mk = (oid: string, summary: string): CommitInfo => ({
  oid, shortOid: oid.slice(0, 7), summary, body: null,
  author: "", email: "", timestamp: 0, parents: [], refs: [],
});

describe("buildRebasePlan", () => {
  // HEAD is index 0 (newest), base is the last entry.
  const commits = [mk("d", "4"), mk("c", "3"), mk("b", "2"), mk("a", "1")];

  it("returns a Pick-only plan for edit-from", () => {
    expect(buildRebasePlan(commits, "a", { kind: "edit-from" })).toEqual([
      { oid: "b", action: "Pick", message: null },
      { oid: "c", action: "Pick", message: null },
      { oid: "d", action: "Pick", message: null },
    ]);
  });

  it("marks the target as Fixup", () => {
    expect(buildRebasePlan(commits, "a", { kind: "fixup", targetOid: "c" })).toEqual([
      { oid: "b", action: "Pick", message: null },
      { oid: "c", action: "Fixup", message: null },
      { oid: "d", action: "Pick", message: null },
    ]);
  });

  it("returns null when the base isn't in commits", () => {
    expect(buildRebasePlan(commits, "zzz", { kind: "edit-from" })).toBeNull();
  });
});
```

Run: `pnpm vitest --run src/features/commits/buildRebasePlan.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/commits/buildRebasePlan.ts src/features/commits/buildRebasePlan.test.ts
git commit -m "feat(rebase): buildRebasePlan helper for context-menu-driven flows"
```

---

### Task J3: Seed RebaseScreen from `pendingRebasePlan`

**Files:**
- Modify: `src/screens/Rebase.tsx`

- [ ] **Step 1: Check what RebaseScreen needs**

Read `src/screens/Rebase.tsx` in full. It should expose a setter for its editable plan; we seed that setter with `pendingRebasePlan` when it arrives, then clear it.

- [ ] **Step 2: Wire the seed**

Near the top of `RebaseScreen`:

```tsx
const pending = useRepoStore((s) => s.pendingRebasePlan);
const setPending = useRepoStore((s) => s.setPendingRebasePlan);

// Wherever the screen's local plan state lives (call it `setPlan`):
React.useEffect(() => {
  if (pending) {
    setPlan(pending);
    setPending(null);
  }
}, [pending, setPending]);
```

Match the exact local state name used in `Rebase.tsx` — adjust accordingly. If the screen lacks an editable `plan` state, add one and have the start button use it.

- [ ] **Step 3: Commit**

```bash
git add src/screens/Rebase.tsx
git commit -m "feat(rebase): seed editable plan from pendingRebasePlan"
```

---

### Task J4: Wire "Interactive rebase from here" (commit menu line 370)

**Files:**
- Modify: `src/design/context-menu.tsx`

- [ ] **Step 1: Replace onClick**

At the top of `context-menu.tsx`, add:
```ts
import { buildRebasePlan } from "@/features/commits/buildRebasePlan";
```

Replace the "Interactive rebase from here" item:

```tsx
{
  icon: "rebase",
  label: "Interactive rebase from here",
  onClick: () => {
    if (!commit?.sha) return;
    const commits = useRepoStore.getState().commits;
    const plan = buildRebasePlan(commits, commit.sha, { kind: "edit-from" });
    if (!plan || plan.length === 0) return;
    useRepoStore.getState().setPendingRebasePlan(plan);
    // Navigate to the rebase screen via localStorage (same mechanism as activity bar)
    localStorage.setItem("pg-screen", "rebase");
    window.dispatchEvent(new Event("pg-screen-change"));
  },
},
```

Then in `AppShell.tsx`, add one listener that reacts to the custom event:

```tsx
React.useEffect(() => {
  const onChange = () => {
    const s = localStorage.getItem("pg-screen");
    if (s) setScreen(s as ScreenId);
  };
  window.addEventListener("pg-screen-change", onChange);
  return () => window.removeEventListener("pg-screen-change", onChange);
}, []);
```

(An alternative is to extend `useNavStore` with a plain screen-id intent; the event approach keeps the nav store focused on target-bearing intents.)

- [ ] **Step 2: Type-check**

Run: `pnpm tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/design/context-menu.tsx src/AppShell.tsx
git commit -m "feat(ui): wire 'Interactive rebase from here' — seeds plan + navigates"
```

---

### Task J5: Wire "Fixup into this commit…" and "Squash into this commit…"

**Files:**
- Modify: `src/design/context-menu.tsx:398` and `:403`

- [ ] **Step 1: Fixup**

Replace `pgFlash(\`fixup ${sha}\`)`:

```tsx
{
  icon: "fix",
  label: "Fixup into this commit…",
  onClick: () => {
    if (!commit?.sha) return;
    // Build plan from target^ → HEAD. We use the parent of target as the base.
    const commits = useRepoStore.getState().commits;
    const idx = commits.findIndex((c) => c.oid === commit.sha);
    const base = commits[idx + 1]?.oid;
    if (!base) return;
    const plan = buildRebasePlan(commits, base, {
      kind: "fixup",
      targetOid: commit.sha,
    });
    if (!plan) return;
    useRepoStore.getState().setPendingRebasePlan(plan);
    localStorage.setItem("pg-screen", "rebase");
    window.dispatchEvent(new Event("pg-screen-change"));
  },
},
```

- [ ] **Step 2: Squash**

Replace `pgFlash(\`squash ${sha}\`)`:

```tsx
{
  icon: "squash",
  label: "Squash into this commit…",
  onClick: () => {
    if (!commit?.sha) return;
    const msg = window.prompt("New commit message for squashed commit");
    if (!msg) return;
    const commits = useRepoStore.getState().commits;
    const idx = commits.findIndex((c) => c.oid === commit.sha);
    const base = commits[idx + 1]?.oid;
    if (!base) return;
    const plan = buildRebasePlan(commits, base, {
      kind: "squash",
      targetOid: commit.sha,
      message: msg,
    });
    if (!plan) return;
    useRepoStore.getState().setPendingRebasePlan(plan);
    localStorage.setItem("pg-screen", "rebase");
    window.dispatchEvent(new Event("pg-screen-change"));
  },
},
```

- [ ] **Step 3: Type-check + commit**

```bash
pnpm tsc --noEmit
git add src/design/context-menu.tsx
git commit -m "feat(ui): wire fixup/squash commit-menu items via buildRebasePlan"
```

---

## Phase K — Stage hunks deep-link

"Stage hunks…" currently opens a toast. The proper picker is DiffViewer's hunk UI. Wire the menu to navigate to DiffViewer with the file pre-selected (same mechanism as "View diff").

### Task K1: Wire "Stage hunks…"

**Files:**
- Modify: `src/design/context-menu.tsx:751`

- [ ] **Step 1: Replace onClick**

```tsx
{
  icon: "edit",
  label: "Stage hunks…",
  disabled: staged,
  onClick: () => {
    if (!path) return;
    useNavStore.getState().setIntent({ kind: "diff-file", path });
  },
},
```

(DiffViewer already has hunk-level staging UI via the existing `stageHunk`/`unstageHunk`/`discardHunk` store actions.)

- [ ] **Step 2: Commit**

```bash
git add src/design/context-menu.tsx
git commit -m "feat(ui): 'Stage hunks…' opens DiffViewer on the selected file"
```

---

## Phase L — Cleanup

### Task L1: Remove dead fetch/pull/push stubs

The trait's fetch/pull/push methods are never called — the commands go straight to `run_git`. Remove them to reduce noise.

**Files:**
- Modify: `src-tauri/src/git/mod.rs` — delete the three methods from the trait (lines 107-109) and the surrounding comment.
- Modify: `src-tauri/src/git/libgit2.rs:1698-1706` — delete.
- Modify: `src-tauri/src/git/cli.rs` — delete the three fetch/pull/push stubs.

- [ ] **Step 1: Confirm no callers**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && grep -rn 'backend\.fetch\|backend\.pull\|backend\.push' src-tauri/src`
Expected: no hits. (The commands call `run_git` directly.)

- [ ] **Step 2: Delete in all three files**

Remove the three methods from the trait, from `Libgit2Backend`, and from `CliBackend`. Remove the `// === network ===` comment block header too.

- [ ] **Step 3: Build**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/git/mod.rs src-tauri/src/git/libgit2.rs src-tauri/src/git/cli.rs
git commit -m "chore(backend): drop dead fetch/pull/push trait methods

Why: the Tauri commands for these three ops shell out via run_git and
never call the trait. The NotImplemented stubs were misleading during
code review (my own included)."
```

---

### Task L2: Final sweep — audit for remaining `pgFlash` placeholders

- [ ] **Step 1: Grep**

Run:
```bash
grep -rn 'pgFlash(' src/ | grep -v 'copied\|No upstream\|No branch\|__pgFlash__'
```
Every remaining `pgFlash` should be a user-facing status toast (copied path, no-upstream message, etc.) — *not* a stub. If any stubs remain, either add a task to wire them or file an issue and move on.

- [ ] **Step 2: Run the full build + tests**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm tsc --noEmit
pnpm vite build
pnpm vitest --run
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

All should pass. Fix any breakage before proceeding.

- [ ] **Step 3: Manual smoke test matrix**

In `pnpm tauri dev`:
- [ ] Open a repo.
- [ ] Sidebar "New branch" → creates + checks out (Task A1).
- [ ] Right-click a commit → Check out (detached) → HEAD detaches (A2).
- [ ] Right-click commit → Create branch from here (A3).
- [ ] File ctx menu → View diff → DiffViewer selects that file (B4).
- [ ] Stash ctx menu → Branch from stash → branch created (C2).
- [ ] File ctx menu → Ignore this file → .gitignore updated (C4).
- [ ] File ctx menu → Open in editor → launches $EDITOR (D2).
- [ ] Conflict screen (trigger a merge conflict) → Edit → opens editor; mergetool → launches merge tool; Restart resolution → re-materializes markers (D2/E2/F2).
- [ ] File ctx menu → File history → lists path commits (G3).
- [ ] File ctx menu → Blame → renders (H3).
- [ ] Commit ctx → Compare with working tree → CommitDiff (I1).
- [ ] Remote branch → Compare with current → CommitDiff (I1).
- [ ] Commit ctx → Interactive rebase / Fixup / Squash → navigates to Rebase screen with plan seeded (J4/J5).

- [ ] **Step 4: Final commit**

No code changes expected — if every task landed cleanly, this step is a no-op. If you had to patch anything:

```bash
git add -u
git commit -m "chore: final cleanup after placeholder wire-up sweep"
```

---

## Self-Review

**Spec coverage:** every placeholder identified in the initial audit maps to a task:
- "New branch" → A1
- "Check out this commit" → A2
- "Create branch from here…" → A3
- Branch menu fetch fallback → A4
- "View diff" → B4
- "Branch from stash…" → C2
- "Ignore this file" → C4
- "Open in editor" (file menu + conflict ctx menu + conflict screen) → D2
- "Open 3-way merge tool" → E2
- "Restart resolution" → F2
- "File history" → G3
- "Blame" → H3
- "Compare with working tree" + "Compare with current" → I1
- "Interactive rebase from here" / "Fixup" / "Squash" → J4, J5
- "Stage hunks…" → K1
- Dead fetch/pull/push stubs → L1

**Placeholder scan:** searched the plan for TBD/TODO/"similar to"/"etc" — none present. Every code block is complete.

**Type consistency:**
- `stashBranch` (TS) matches `stash_branch` (Rust command name); both take `(repoId, index, branch)`.
- `appendGitignore`/`append_gitignore`: `(repoId, pattern)` in both.
- `openInEditor`/`open_in_editor`: `(repoId, relativePath)` in both.
- `runMergetool`/`run_mergetool`: `(repoId, path)`.
- `restartConflict`/`restart_conflict`: `(repoId, path)`.
- `fileHistory`/`file_history`: `(repoId, path, limit)`.
- `blameFile`/`blame_file`: `(repoId, path)`.
- `BlameLine` fields serialize camelCase in Rust matching TS.
- `NavIntent` kinds are consumed by exactly the screens that set them (diff-file → DiffViewer B3, commit-vs-* → CommitDiff I1, file-history → FileHistoryScreen G3, blame → BlameScreen H3).

All good.
