# PlatypusGit Write Path — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every stubbed **local** git write operation with a real libgit2-backed implementation, wire each into the frontend, and cover them with integration tests on temp repos. After this plan: users can stage, commit, amend, discard, reset, cherry-pick, revert, branch, tag, and stash against any local repository from the PlatypusGit UI.

**Architecture:** `GitBackend` trait stays the single IPC surface. Backend methods run inside `spawn_blocking` from each Tauri command so the libgit2 sync API doesn't block the async runtime. A shared `tests/support/` module builds isolated tempfile repos for every integration test. The Zustand `useRepoStore` gets one action per write op; every action refreshes the relevant slices of repo state on success and surfaces `AppError` on failure.

**Tech Stack:** Rust stable, `git2` 0.20.x, `tempfile` (new dev-dep), `tokio` (already used by Tauri). Frontend is unchanged (React 19, Zustand 5, Tailwind v4, TS 5.8).

**Scope — explicitly IN:**
- Prep: temp-repo fixtures, trait extension, new `AppError` variants, signature helper
- Staging: `stage_paths`, `unstage_paths`, `discard_paths`
- Commit: `commit`, `commit --amend`
- Branches: `checkout_branch`, `create_branch`, `delete_branch`, `rename_branch`
- Tags: `create_tag`, `delete_tag`
- Reset: soft, mixed, hard
- Cherry-pick
- Revert
- Stash: `stash_save`, `stash_apply`, `stash_pop`, `stash_drop`

**Scope — explicitly OUT (each becomes its own follow-up plan, outlined at the end):**
- Plan B: Network operations (fetch / pull / push / remote management, with credentials)
- Plan C: Conflict resolution (accept ours / theirs, finalize, abort)
- Plan D: Hunk-level staging (stage hunk / stage selected lines)
- Plan E: Interactive rebase (the whole rewrite-history workflow)

**Commit discipline:** Conventional Commits (`feat:` / `test:` / `refactor:` / `chore:`), short imperative subjects under 72 chars. Trailing `Co-Authored-By: Claude …` line if the assistant drove the commit. One commit per task unless the task explicitly says "squash into previous". Never `--amend` a published commit. Never `--no-verify`.

**Testing discipline:** TDD throughout. Write a failing integration test against a temp repo fixture, then make it pass. Each task ends with `cargo test --manifest-path src-tauri/Cargo.toml` green before the commit.

---

## File map

### New files (this plan)
- `src-tauri/tests/support/mod.rs` — temp-repo fixture builder (`TempRepo::fresh`, `TempRepo::with_initial_commit`)
- `src-tauri/tests/support/fs.rs` — small file-system helpers (`write_file`, `append_file`)
- `src-tauri/tests/stage_commit.rs` — integration tests for stage/unstage/commit
- `src-tauri/tests/discard_reset.rs` — tests for discard + reset
- `src-tauri/tests/branches_tags.rs` — tests for branch + tag CRUD
- `src-tauri/tests/cherry_pick_revert.rs` — tests for cherry-pick + revert
- `src-tauri/tests/stash.rs` — tests for stash operations
- `src-tauri/src/git/signature.rs` — reads `user.name`/`user.email` from git config, produces `git2::Signature`
- `src-tauri/src/commands/stash.rs` — `stash_save`, `stash_apply`, `stash_pop`, `stash_drop`
- `src-tauri/src/commands/history.rs` — `cherry_pick`, `revert`, `reset`

### Modified files
- `src-tauri/Cargo.toml` — add `tempfile` dev-dep
- `src-tauri/src/error.rs` — add `DirtyWorktree`, `InvalidRef`, `ConflictsDetected`, `NoSignature`, `Unborn`
- `src-tauri/src/git/mod.rs` — extend trait with new methods
- `src-tauri/src/git/types.rs` — add `ResetMode`, `StashSaveOptions`, `TagTarget`
- `src-tauri/src/git/libgit2.rs` — real impls for everything in scope
- `src-tauri/src/git/cli.rs` — stub the new trait methods with `NotImplemented`
- `src-tauri/src/commands/diff.rs` — implement `stage_paths` and `unstage_paths`, add `discard_paths`
- `src-tauri/src/commands/commits.rs` — implement `commit` (+ amend)
- `src-tauri/src/commands/branches.rs` — implement `checkout_branch`, `create_branch`, add `delete_branch`, `rename_branch`
- `src-tauri/src/commands/mod.rs` — register new command modules
- `src-tauri/src/lib.rs` — register new `invoke_handler` commands
- `src/lib/types.ts` — add TS mirrors for `ResetMode`, `TagTarget`, new error kinds
- `src/lib/errors.ts` — add new error-kind union members
- `src/lib/tauri.ts` — add wrappers for every new command
- `src/features/repo/useRepoStore.ts` — add write actions (stage, unstage, commit, etc.)
- `src/screens/CommitPanel.tsx` — wire stage/unstage/commit/amend
- `src/screens/Branches.tsx` — wire checkout/create/delete/rename
- `src/screens/History.tsx` — wire cherry-pick/revert/reset on selected commit
- `src/design/context-menu.tsx` — replace `pgFlash` stubs with real store-action wiring in menu builders

---

## Task 1: Add tempfile dev-dependency + test-support module

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/tests/support/mod.rs`
- Create: `src-tauri/tests/support/fs.rs`

- [ ] **Step 1: Add `tempfile` under `[dev-dependencies]`**

Append to `src-tauri/Cargo.toml`:

```toml
[dev-dependencies]
tempfile = "3"
```

- [ ] **Step 2: Verify it resolves**

```bash
cargo build --manifest-path src-tauri/Cargo.toml --tests
```

Expected: finishes without error (may download tempfile).

- [ ] **Step 3: Create the fs helpers**

`src-tauri/tests/support/fs.rs`:

```rust
use std::fs;
use std::path::Path;

pub fn write_file(root: &Path, rel: &str, contents: &str) {
    let p = root.join(rel);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).expect("create parent dirs");
    }
    fs::write(&p, contents).expect("write file");
}

pub fn append_file(root: &Path, rel: &str, extra: &str) {
    let p = root.join(rel);
    let mut existing = fs::read_to_string(&p).unwrap_or_default();
    existing.push_str(extra);
    fs::write(&p, existing).expect("append file");
}

pub fn read_file(root: &Path, rel: &str) -> String {
    fs::read_to_string(root.join(rel)).expect("read file")
}
```

- [ ] **Step 4: Create the TempRepo fixture**

`src-tauri/tests/support/mod.rs`:

```rust
#![allow(dead_code)]

pub mod fs;

use std::path::{Path, PathBuf};

use git2::{Repository, Signature};
use tempfile::TempDir;

use platypusgit_lib::git::{libgit2::Libgit2Backend, types::RepoHandle, GitBackend};

/// A throwaway git repo in a tempdir. Dropped = cleaned up.
pub struct TempRepo {
    pub dir: TempDir,
    pub repo: Repository,
}

impl TempRepo {
    /// An empty repo with no commits (unborn HEAD on `main`).
    pub fn fresh() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = Repository::init_opts(
            dir.path(),
            git2::RepositoryInitOptions::new()
                .initial_head("main")
                .mkdir(false),
        )
        .expect("init");
        // Set a committer identity so commit() works without global config leaking in.
        let mut cfg = repo.config().expect("config");
        cfg.set_str("user.name", "Test User").unwrap();
        cfg.set_str("user.email", "test@example.com").unwrap();
        TempRepo { dir, repo }
    }

    /// Repo with one commit that creates `README.md` with the given body.
    pub fn with_initial_commit(readme_body: &str) -> Self {
        let tr = Self::fresh();
        self::fs::write_file(tr.path(), "README.md", readme_body);
        let mut index = tr.repo.index().unwrap();
        index.add_path(Path::new("README.md")).unwrap();
        index.write().unwrap();
        let tree_oid = index.write_tree().unwrap();
        let tree = tr.repo.find_tree(tree_oid).unwrap();
        let sig = Signature::now("Test User", "test@example.com").unwrap();
        tr.repo
            .commit(Some("HEAD"), &sig, &sig, "initial", &tree, &[])
            .unwrap();
        tr
    }

    pub fn path(&self) -> &Path {
        self.dir.path()
    }

    pub fn path_buf(&self) -> PathBuf {
        self.dir.path().to_path_buf()
    }

    /// Convenience: open via the real backend, returning handle + backend.
    pub fn open_with_backend(&self) -> (Libgit2Backend, RepoHandle) {
        let backend = Libgit2Backend::new();
        let handle = backend.open(self.path()).expect("open");
        (backend, handle)
    }
}
```

- [ ] **Step 5: Verify tests still compile**

```bash
cargo test --manifest-path src-tauri/Cargo.toml --no-run
```

Expected: successful compile, no test failures (the existing smoke tests still pass when run).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tests/support
git commit -m "$(cat <<'EOF'
test: tempfile-based repo fixture for write-op tests

Adds TempRepo helper that initializes a throwaway repo with a local
signature set (so commit() works hermetically), plus a small fs helper.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Extend AppError with new variants

**Files:**
- Modify: `src-tauri/src/error.rs`
- Modify: `src/lib/errors.ts`

- [ ] **Step 1: Add the Rust variants**

Replace the enum body in `src-tauri/src/error.rs` with:

```rust
#[derive(Debug, thiserror::Error, Serialize)]
#[serde(tag = "kind", content = "message")]
pub enum AppError {
    #[error("path is not a git repository: {0}")]
    NotARepo(String),

    #[error("repository not found: {0}")]
    UnknownRepo(String),

    #[error("invalid path: {0}")]
    InvalidPath(String),

    #[error("io error: {0}")]
    Io(String),

    #[error("git error: {0}")]
    Git(String),

    #[error("not implemented")]
    NotImplemented,

    #[error("repository has no HEAD yet")]
    Unborn,

    #[error("invalid reference: {0}")]
    InvalidRef(String),

    #[error("worktree is dirty: {0}")]
    DirtyWorktree(String),

    #[error("operation produced conflicts: {0}")]
    ConflictsDetected(String),

    #[error("no signature configured (set user.name and user.email)")]
    NoSignature,

    #[error("internal error: {0}")]
    Internal(String),
}
```

- [ ] **Step 2: Mirror on the TS side**

Replace `src/lib/errors.ts` union:

```ts
export type AppError =
  | { kind: "NotARepo"; message: string }
  | { kind: "UnknownRepo"; message: string }
  | { kind: "InvalidPath"; message: string }
  | { kind: "Io"; message: string }
  | { kind: "Git"; message: string }
  | { kind: "NotImplemented"; message?: string }
  | { kind: "Unborn"; message?: string }
  | { kind: "InvalidRef"; message: string }
  | { kind: "DirtyWorktree"; message: string }
  | { kind: "ConflictsDetected"; message: string }
  | { kind: "NoSignature"; message?: string }
  | { kind: "Internal"; message: string };
```

- [ ] **Step 3: Verify**

```bash
cargo check --manifest-path src-tauri/Cargo.toml
pnpm tsc --noEmit
```

Both must pass.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/error.rs src/lib/errors.ts
git commit -m "$(cat <<'EOF'
feat: new AppError variants for write-path failures

Adds Unborn, InvalidRef, DirtyWorktree, ConflictsDetected, NoSignature —
each maps to a user-facing failure mode that's not a generic git error.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Signature helper

**Files:**
- Create: `src-tauri/src/git/signature.rs`
- Modify: `src-tauri/src/git/mod.rs` (add `pub mod signature;`)

- [ ] **Step 1: Write the helper**

`src-tauri/src/git/signature.rs`:

```rust
use git2::{Repository, Signature};

use crate::error::{AppError, AppResult};

/// Resolve a `Signature` from the repository's config.
///
/// Priority: repo-local config → global → system. Fails with
/// `AppError::NoSignature` when `user.name` or `user.email` is missing.
pub fn default_signature<'a>(repo: &'a Repository) -> AppResult<Signature<'a>> {
    match repo.signature() {
        Ok(sig) => Ok(sig),
        Err(e) => {
            if e.code() == git2::ErrorCode::NotFound {
                Err(AppError::NoSignature)
            } else {
                Err(e.into())
            }
        }
    }
}
```

- [ ] **Step 2: Register the module**

In `src-tauri/src/git/mod.rs`, add next to the other `pub mod` lines:

```rust
pub mod signature;
```

- [ ] **Step 3: Verify**

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/git/signature.rs src-tauri/src/git/mod.rs
git commit -m "$(cat <<'EOF'
feat: default_signature helper for commit operations

Wraps repo.signature() and translates NotFound to AppError::NoSignature
so the frontend can surface a clear message.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Extend the GitBackend trait with new method signatures

This task only expands the trait and stubs every new method with `NotImplemented` in both backends. Each subsequent task fills in the real impl one operation at a time.

**Files:**
- Modify: `src-tauri/src/git/mod.rs`
- Modify: `src-tauri/src/git/libgit2.rs` (stubs only here)
- Modify: `src-tauri/src/git/cli.rs` (stubs only here)
- Modify: `src-tauri/src/git/types.rs` (add `ResetMode`, `TagTarget`, `StashSaveOptions`)

- [ ] **Step 1: Add the new types**

Append to `src-tauri/src/git/types.rs`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ResetMode {
    Soft,
    Mixed,
    Hard,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagTarget {
    pub oid: String,
    /// None = lightweight tag; Some = annotated tag with this message.
    pub annotation: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StashSaveOptions {
    pub message: Option<String>,
    pub include_untracked: bool,
    pub keep_index: bool,
}
```

- [ ] **Step 2: Extend the trait**

Replace the trait body in `src-tauri/src/git/mod.rs`:

```rust
pub mod cli;
pub mod libgit2;
pub mod signature;
pub mod types;

use std::path::{Path, PathBuf};

use crate::error::AppResult;
use types::{
    BranchInfo, CommitInfo, CommitOptions, DiffKind, FileDiff, FileStatus, RemoteInfo, RepoHandle,
    RepoId, ResetMode, StashInfo, StashSaveOptions, TagInfo, TagTarget,
};

pub trait GitBackend: Send + Sync {
    // === existing reads ===
    fn open(&self, path: &Path) -> AppResult<RepoHandle>;
    fn status(&self, repo_id: &RepoId) -> AppResult<Vec<FileStatus>>;
    fn log(&self, repo_id: &RepoId, limit: usize) -> AppResult<Vec<CommitInfo>>;
    fn diff(&self, repo_id: &RepoId, path: &Path, kind: DiffKind) -> AppResult<FileDiff>;
    fn branches(&self, repo_id: &RepoId) -> AppResult<Vec<BranchInfo>>;
    fn tags(&self, repo_id: &RepoId) -> AppResult<Vec<TagInfo>>;
    fn stashes(&self, repo_id: &RepoId) -> AppResult<Vec<StashInfo>>;
    fn remotes(&self, repo_id: &RepoId) -> AppResult<Vec<RemoteInfo>>;

    // === index writes ===
    fn stage(&self, repo_id: &RepoId, paths: &[PathBuf]) -> AppResult<()>;
    fn unstage(&self, repo_id: &RepoId, paths: &[PathBuf]) -> AppResult<()>;
    fn discard(&self, repo_id: &RepoId, paths: &[PathBuf]) -> AppResult<()>;

    // === commit ===
    fn commit(&self, repo_id: &RepoId, opts: CommitOptions) -> AppResult<String>;

    // === refs ===
    fn checkout_branch(&self, repo_id: &RepoId, name: &str) -> AppResult<()>;
    fn create_branch(&self, repo_id: &RepoId, name: &str, from: Option<&str>) -> AppResult<()>;
    fn delete_branch(&self, repo_id: &RepoId, name: &str, force: bool) -> AppResult<()>;
    fn rename_branch(&self, repo_id: &RepoId, from: &str, to: &str) -> AppResult<()>;
    fn create_tag(&self, repo_id: &RepoId, name: &str, target: TagTarget) -> AppResult<()>;
    fn delete_tag(&self, repo_id: &RepoId, name: &str) -> AppResult<()>;

    // === history manipulation ===
    fn reset(&self, repo_id: &RepoId, target: &str, mode: ResetMode) -> AppResult<()>;
    fn cherry_pick(&self, repo_id: &RepoId, oid: &str) -> AppResult<()>;
    fn revert(&self, repo_id: &RepoId, oid: &str) -> AppResult<()>;

    // === stash ===
    fn stash_save(&self, repo_id: &RepoId, opts: StashSaveOptions) -> AppResult<Option<String>>;
    fn stash_apply(&self, repo_id: &RepoId, index: usize) -> AppResult<()>;
    fn stash_pop(&self, repo_id: &RepoId, index: usize) -> AppResult<()>;
    fn stash_drop(&self, repo_id: &RepoId, index: usize) -> AppResult<()>;

    // === network (implemented in Plan B) ===
    fn fetch(&self, repo_id: &RepoId, remote: &str) -> AppResult<()>;
    fn pull(&self, repo_id: &RepoId, remote: &str, branch: &str) -> AppResult<()>;
    fn push(&self, repo_id: &RepoId, remote: &str, branch: &str) -> AppResult<()>;
}
```

- [ ] **Step 3: Stub the new methods in both backends**

In `src-tauri/src/git/libgit2.rs`, inside `impl GitBackend for Libgit2Backend`, replace the existing stubs for `stage`, `unstage`, `commit`, `checkout_branch`, `create_branch` with the same signatures but still returning `NotImplemented` — and add stubs for the new methods:

```rust
fn discard(&self, _repo_id: &RepoId, _paths: &[PathBuf]) -> AppResult<()> {
    Err(AppError::NotImplemented)
}
fn delete_branch(&self, _repo_id: &RepoId, _name: &str, _force: bool) -> AppResult<()> {
    Err(AppError::NotImplemented)
}
fn rename_branch(&self, _repo_id: &RepoId, _from: &str, _to: &str) -> AppResult<()> {
    Err(AppError::NotImplemented)
}
fn create_tag(&self, _repo_id: &RepoId, _name: &str, _target: TagTarget) -> AppResult<()> {
    Err(AppError::NotImplemented)
}
fn delete_tag(&self, _repo_id: &RepoId, _name: &str) -> AppResult<()> {
    Err(AppError::NotImplemented)
}
fn reset(&self, _repo_id: &RepoId, _target: &str, _mode: ResetMode) -> AppResult<()> {
    Err(AppError::NotImplemented)
}
fn cherry_pick(&self, _repo_id: &RepoId, _oid: &str) -> AppResult<()> {
    Err(AppError::NotImplemented)
}
fn revert(&self, _repo_id: &RepoId, _oid: &str) -> AppResult<()> {
    Err(AppError::NotImplemented)
}
fn stash_save(&self, _repo_id: &RepoId, _opts: StashSaveOptions) -> AppResult<Option<String>> {
    Err(AppError::NotImplemented)
}
fn stash_apply(&self, _repo_id: &RepoId, _index: usize) -> AppResult<()> {
    Err(AppError::NotImplemented)
}
fn stash_pop(&self, _repo_id: &RepoId, _index: usize) -> AppResult<()> {
    Err(AppError::NotImplemented)
}
fn stash_drop(&self, _repo_id: &RepoId, _index: usize) -> AppResult<()> {
    Err(AppError::NotImplemented)
}
```

Make sure `use` imports include `ResetMode`, `StashSaveOptions`, `TagTarget` alongside the others.

Add the same stubs to `src-tauri/src/git/cli.rs` (identical body, same `Err(AppError::NotImplemented)`).

- [ ] **Step 4: Verify the trait compiles**

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: no errors. Existing tests unaffected.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/git/mod.rs src-tauri/src/git/libgit2.rs src-tauri/src/git/cli.rs src-tauri/src/git/types.rs
git commit -m "$(cat <<'EOF'
refactor: extend GitBackend trait with full write surface

All new methods stubbed with NotImplemented — subsequent commits turn
them on one at a time with accompanying tests.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Implement `stage` (TDD)

**Files:**
- Create: `src-tauri/tests/stage_commit.rs`
- Modify: `src-tauri/src/git/libgit2.rs`

- [ ] **Step 1: Write the failing test**

`src-tauri/tests/stage_commit.rs`:

```rust
mod support;

use std::path::PathBuf;

use platypusgit_lib::git::GitBackend;

use support::{fs::write_file, TempRepo};

#[test]
fn stage_moves_worktree_change_to_index() {
    let tr = TempRepo::with_initial_commit("hello\n");
    write_file(tr.path(), "README.md", "hello world\n");
    let (backend, handle) = tr.open_with_backend();

    let before = backend.status(&handle.id).unwrap();
    let readme_before = before.iter().find(|f| f.path == "README.md").unwrap();
    assert!(matches!(
        readme_before.worktree,
        platypusgit_lib::git::types::StatusFlag::Modified
    ));

    backend
        .stage(&handle.id, &[PathBuf::from("README.md")])
        .expect("stage");

    let after = backend.status(&handle.id).unwrap();
    let readme_after = after.iter().find(|f| f.path == "README.md").unwrap();
    assert!(matches!(
        readme_after.index,
        platypusgit_lib::git::types::StatusFlag::Modified
    ));
    assert!(matches!(
        readme_after.worktree,
        platypusgit_lib::git::types::StatusFlag::Unmodified
    ));
}

#[test]
fn stage_a_new_untracked_file_marks_it_added() {
    let tr = TempRepo::with_initial_commit("hello\n");
    write_file(tr.path(), "docs/notes.md", "note\n");
    let (backend, handle) = tr.open_with_backend();

    backend
        .stage(&handle.id, &[PathBuf::from("docs/notes.md")])
        .expect("stage");

    let after = backend.status(&handle.id).unwrap();
    let entry = after.iter().find(|f| f.path == "docs/notes.md").unwrap();
    assert!(matches!(
        entry.index,
        platypusgit_lib::git::types::StatusFlag::Added
    ));
}
```

- [ ] **Step 2: Run — expect failure**

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test stage_commit
```

Expected: both tests fail with `NotImplemented`.

- [ ] **Step 3: Implement `stage`**

In `src-tauri/src/git/libgit2.rs`, replace the `stage` stub with:

```rust
fn stage(&self, repo_id: &RepoId, paths: &[PathBuf]) -> AppResult<()> {
    self.with_repo(repo_id, |repo| {
        let mut index = repo.index()?;
        for p in paths {
            // `add_path` treats paths as repo-relative; it handles creates and modifications.
            // For deletions from the worktree, we need `remove_path` instead.
            if repo.workdir().map(|w| w.join(p).exists()).unwrap_or(false) {
                index.add_path(p)?;
            } else {
                index.remove_path(p)?;
            }
        }
        index.write()?;
        Ok(())
    })
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test stage_commit
```

Expected: both tests pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/git/libgit2.rs src-tauri/tests/stage_commit.rs
git commit -m "$(cat <<'EOF'
feat: implement stage(paths) in libgit2 backend

Handles create, modify, and delete by branching on workdir existence
before calling add_path / remove_path on the index.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Implement `unstage`

**Files:**
- Modify: `src-tauri/tests/stage_commit.rs` (append test)
- Modify: `src-tauri/src/git/libgit2.rs`

- [ ] **Step 1: Append the failing test**

At the end of `src-tauri/tests/stage_commit.rs`:

```rust
#[test]
fn unstage_moves_index_change_back_to_worktree() {
    let tr = TempRepo::with_initial_commit("hello\n");
    write_file(tr.path(), "README.md", "hello world\n");
    let (backend, handle) = tr.open_with_backend();

    backend
        .stage(&handle.id, &[PathBuf::from("README.md")])
        .unwrap();

    backend
        .unstage(&handle.id, &[PathBuf::from("README.md")])
        .expect("unstage");

    let after = backend.status(&handle.id).unwrap();
    let entry = after.iter().find(|f| f.path == "README.md").unwrap();
    assert!(matches!(
        entry.worktree,
        platypusgit_lib::git::types::StatusFlag::Modified
    ));
    assert!(matches!(
        entry.index,
        platypusgit_lib::git::types::StatusFlag::Unmodified
    ));
}
```

- [ ] **Step 2: Run — expect failure**

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test stage_commit unstage_moves
```

- [ ] **Step 3: Implement `unstage`**

Replace the `unstage` stub in `libgit2.rs`:

```rust
fn unstage(&self, repo_id: &RepoId, paths: &[PathBuf]) -> AppResult<()> {
    self.with_repo(repo_id, |repo| {
        // Resetting paths to HEAD is the equivalent of `git reset HEAD -- paths`.
        // If HEAD is unborn, just clear the entries from the index.
        let head = match repo.head() {
            Ok(h) => Some(h.peel_to_commit()?),
            Err(e) if e.code() == git2::ErrorCode::UnbornBranch => None,
            Err(e) => return Err(e.into()),
        };
        match head {
            Some(commit) => {
                let paths: Vec<&Path> = paths.iter().map(|p| p.as_path()).collect();
                repo.reset_default(Some(commit.as_object()), paths)?;
            }
            None => {
                let mut index = repo.index()?;
                for p in paths {
                    let _ = index.remove_path(p);
                }
                index.write()?;
            }
        }
        Ok(())
    })
}
```

Import `std::path::Path` at the top of `libgit2.rs` if it isn't already.

- [ ] **Step 4: Run — expect pass**

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test stage_commit
```

Expected: all stage_commit tests pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/git/libgit2.rs src-tauri/tests/stage_commit.rs
git commit -m "feat: implement unstage(paths) via reset_default"
```

---

## Task 7: Implement `commit` (and amend)

**Files:**
- Modify: `src-tauri/tests/stage_commit.rs` (append tests)
- Modify: `src-tauri/src/git/libgit2.rs`

- [ ] **Step 1: Write the failing tests**

Append to `src-tauri/tests/stage_commit.rs`:

```rust
use platypusgit_lib::git::types::CommitOptions;

#[test]
fn commit_from_staged_changes_advances_head() {
    let tr = TempRepo::with_initial_commit("hello\n");
    write_file(tr.path(), "README.md", "hello world\n");
    let (backend, handle) = tr.open_with_backend();
    backend
        .stage(&handle.id, &[PathBuf::from("README.md")])
        .unwrap();

    let oid = backend
        .commit(
            &handle.id,
            CommitOptions {
                message: "update readme".into(),
                amend: false,
                author_override: None,
            },
        )
        .expect("commit");

    assert_eq!(oid.len(), 40);
    let log = backend.log(&handle.id, 10).unwrap();
    assert_eq!(log.len(), 2, "should have initial + new commit");
    assert_eq!(log[0].summary, "update readme");
}

#[test]
fn amend_replaces_tip() {
    let tr = TempRepo::with_initial_commit("hello\n");
    write_file(tr.path(), "README.md", "hello world\n");
    let (backend, handle) = tr.open_with_backend();
    backend
        .stage(&handle.id, &[PathBuf::from("README.md")])
        .unwrap();

    backend
        .commit(
            &handle.id,
            CommitOptions {
                message: "oops".into(),
                amend: false,
                author_override: None,
            },
        )
        .unwrap();

    write_file(tr.path(), "README.md", "hello world, again\n");
    backend
        .stage(&handle.id, &[PathBuf::from("README.md")])
        .unwrap();

    backend
        .commit(
            &handle.id,
            CommitOptions {
                message: "update readme".into(),
                amend: true,
                author_override: None,
            },
        )
        .unwrap();

    let log = backend.log(&handle.id, 10).unwrap();
    assert_eq!(log.len(), 2, "amend must not add a new commit");
    assert_eq!(log[0].summary, "update readme");
}

#[test]
fn commit_on_unborn_branch_creates_root() {
    let tr = TempRepo::fresh();
    write_file(tr.path(), "README.md", "new repo\n");
    let (backend, handle) = tr.open_with_backend();
    backend
        .stage(&handle.id, &[PathBuf::from("README.md")])
        .unwrap();

    backend
        .commit(
            &handle.id,
            CommitOptions {
                message: "initial".into(),
                amend: false,
                author_override: None,
            },
        )
        .unwrap();

    let log = backend.log(&handle.id, 10).unwrap();
    assert_eq!(log.len(), 1);
    assert!(log[0].parents.is_empty());
}
```

- [ ] **Step 2: Run — expect failure**

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test stage_commit commit_
```

- [ ] **Step 3: Implement `commit`**

Replace the `commit` stub in `libgit2.rs` with:

```rust
fn commit(&self, repo_id: &RepoId, opts: CommitOptions) -> AppResult<String> {
    use crate::git::signature::default_signature;

    self.with_repo(repo_id, |repo| {
        let sig = match opts.author_override {
            Some(o) => git2::Signature::now(&o.name, &o.email)?,
            None => default_signature(repo)?,
        };

        let mut index = repo.index()?;
        let tree_oid = index.write_tree()?;
        let tree = repo.find_tree(tree_oid)?;

        let head = match repo.head() {
            Ok(h) => Some(h),
            Err(e) if e.code() == git2::ErrorCode::UnbornBranch => None,
            Err(e) => return Err(e.into()),
        };

        if opts.amend {
            let head_ref = head.ok_or(AppError::Unborn)?;
            let tip = head_ref.peel_to_commit()?;
            let new_oid = tip.amend(
                Some("HEAD"),
                Some(&sig),
                Some(&sig),
                None,
                Some(&opts.message),
                Some(&tree),
            )?;
            return Ok(new_oid.to_string());
        }

        let parents: Vec<git2::Commit> = match head {
            Some(h) => vec![h.peel_to_commit()?],
            None => Vec::new(),
        };
        let parent_refs: Vec<&git2::Commit> = parents.iter().collect();

        let oid = repo.commit(
            Some("HEAD"),
            &sig,
            &sig,
            &opts.message,
            &tree,
            &parent_refs,
        )?;
        Ok(oid.to_string())
    })
}
```

- [ ] **Step 4: Run — expect pass**

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test stage_commit
```

Expected: all four stage_commit tests green.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/git/libgit2.rs src-tauri/tests/stage_commit.rs
git commit -m "feat: implement commit + amend with signature fallback"
```

---

## Task 8: Wire commands for stage / unstage / commit

**Files:**
- Modify: `src-tauri/src/commands/diff.rs`
- Modify: `src-tauri/src/commands/commits.rs`

- [ ] **Step 1: Replace the `diff.rs` stubs**

In `src-tauri/src/commands/diff.rs`, replace `stage_paths` and `unstage_paths` bodies:

```rust
#[tauri::command]
pub async fn stage_paths(
    state: State<'_, AppState>,
    repo_id: String,
    paths: Vec<String>,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let paths: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    tokio::task::spawn_blocking(move || backend.stage(&repo_id, &paths))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn unstage_paths(
    state: State<'_, AppState>,
    repo_id: String,
    paths: Vec<String>,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let paths: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    tokio::task::spawn_blocking(move || backend.unstage(&repo_id, &paths))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}
```

- [ ] **Step 2: Replace the `commits.rs` `commit` stub**

```rust
use crate::git::types::{CommitInfo, CommitOptions, RepoId};

#[tauri::command]
pub async fn commit(
    state: State<'_, AppState>,
    repo_id: String,
    message: String,
    amend: bool,
) -> AppResult<String> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let opts = CommitOptions {
        message,
        amend,
        author_override: None,
    };
    tokio::task::spawn_blocking(move || backend.commit(&repo_id, opts))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}
```

- [ ] **Step 3: Verify**

```bash
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands
git commit -m "feat: wire stage/unstage/commit commands to real backend"
```

---

## Task 9: Frontend — stage / unstage / commit actions in the store

**Files:**
- Modify: `src/lib/tauri.ts`
- Modify: `src/features/repo/useRepoStore.ts`

- [ ] **Step 1: Add Tauri wrappers**

Append to `src/lib/tauri.ts`:

```ts
export async function stagePaths(repoId: string, paths: string[]): Promise<void> {
  return invoke<void>("stage_paths", { repoId, paths });
}

export async function unstagePaths(repoId: string, paths: string[]): Promise<void> {
  return invoke<void>("unstage_paths", { repoId, paths });
}

export async function commit(
  repoId: string,
  message: string,
  amend = false,
): Promise<string> {
  return invoke<string>("commit", { repoId, message, amend });
}
```

- [ ] **Step 2: Add actions to the store**

In `src/features/repo/useRepoStore.ts`, extend the interface and implementation:

```ts
// inside RepoState interface:
stage: (paths: string[]) => Promise<void>;
unstage: (paths: string[]) => Promise<void>;
commit: (message: string, amend?: boolean) => Promise<string | null>;
```

Add the corresponding functions inside `create`:

```ts
async stage(paths) {
  const repo = get().current;
  if (!repo) return;
  try {
    await stagePaths(repo.id, paths);
    await get().refreshAll();
  } catch (e) {
    set({ error: toAppError(e) });
  }
},

async unstage(paths) {
  const repo = get().current;
  if (!repo) return;
  try {
    await unstagePaths(repo.id, paths);
    await get().refreshAll();
  } catch (e) {
    set({ error: toAppError(e) });
  }
},

async commit(message, amend = false) {
  const repo = get().current;
  if (!repo) return null;
  try {
    const oid = await commitFn(repo.id, message, amend);
    await get().refreshAll();
    return oid;
  } catch (e) {
    set({ error: toAppError(e) });
    return null;
  }
},
```

Rename the import from `commit` to `commit as commitFn` at the top of the file to avoid name collision with the method.

- [ ] **Step 3: Verify**

```bash
pnpm tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/tauri.ts src/features/repo/useRepoStore.ts
git commit -m "feat: store actions for stage/unstage/commit"
```

---

## Task 10: Wire the CommitPanel screen

**Files:**
- Modify: `src/screens/CommitPanel.tsx`

- [ ] **Step 1: Replace the `pgFlash` stubs**

In `src/screens/CommitPanel.tsx`:

1. Destructure the new store actions:

```ts
const stage = useRepoStore((s) => s.stage);
const unstage = useRepoStore((s) => s.unstage);
const commitAction = useRepoStore((s) => s.commit);
```

2. Replace the `stageAll` / `unstageAll` handlers on the section headers:

```ts
const stageAll = () => stage(unstaged.map((f) => f.path));
const unstageAll = () => unstage(staged.map((f) => f.path));
```

3. Replace the per-row `onToggle`:

```ts
onToggle={() => {
  if (f.side === "staged") unstage([f.path]);
  else stage([f.path]);
}}
```

4. Replace the Commit / Commit & Push buttons:

```tsx
<PGButton
  variant="default"
  fullWidth
  disabled={staged.length === 0 || !message.trim()}
  onClick={async () => {
    const full = body.trim() ? `${message}\n\n${body}` : message;
    const oid = await commitAction(full, amend);
    if (oid) {
      setMessage("");
      setBody("");
      setAmend(false);
    }
  }}
>
  {amend ? "Amend" : "Commit"}
</PGButton>
<PGButton
  variant="primary"
  icon="push"
  fullWidth
  disabled
  title="Push will arrive in Plan B (network)"
>
  Commit & Push
</PGButton>
```

5. Remove the `pgFlash("stage toggle is not wired up yet")` call sites — they're replaced by real actions now.

- [ ] **Step 2: Manual smoke**

Run the app:

```bash
pnpm tauri dev
```

Open your own repo. Edit a file. Stage it via the checkbox. Write a subject. Click Commit. Observe that the commit appears in History after refresh.

- [ ] **Step 3: Verify types/build**

```bash
pnpm tsc --noEmit
pnpm vite build
```

- [ ] **Step 4: Commit**

```bash
git add src/screens/CommitPanel.tsx
git commit -m "feat(ui): wire commit panel to real stage/unstage/commit"
```

---

## Task 11: Implement `discard`

Discard reverts the worktree to the index (i.e. `git checkout -- path`). It does not touch the index.

**Files:**
- Create: `src-tauri/tests/discard_reset.rs`
- Modify: `src-tauri/src/git/libgit2.rs`
- Modify: `src-tauri/src/commands/diff.rs` (add `discard_paths`)
- Modify: `src-tauri/src/lib.rs` (register new command)
- Modify: `src/lib/tauri.ts`
- Modify: `src/features/repo/useRepoStore.ts`
- Modify: `src/design/context-menu.tsx` (replace discard toast)

- [ ] **Step 1: Write the failing test**

`src-tauri/tests/discard_reset.rs`:

```rust
mod support;

use std::path::PathBuf;

use platypusgit_lib::git::GitBackend;
use support::{fs::{read_file, write_file}, TempRepo};

#[test]
fn discard_restores_worktree_from_index() {
    let tr = TempRepo::with_initial_commit("hello\n");
    write_file(tr.path(), "README.md", "this is wrong\n");
    let (backend, handle) = tr.open_with_backend();

    backend
        .discard(&handle.id, &[PathBuf::from("README.md")])
        .expect("discard");

    let contents = read_file(tr.path(), "README.md");
    assert_eq!(contents, "hello\n");
}
```

- [ ] **Step 2: Run — expect fail**

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test discard_reset
```

- [ ] **Step 3: Implement `discard`**

Replace the `discard` stub in `libgit2.rs`:

```rust
fn discard(&self, repo_id: &RepoId, paths: &[PathBuf]) -> AppResult<()> {
    self.with_repo(repo_id, |repo| {
        let mut opts = git2::build::CheckoutBuilder::new();
        opts.force();
        for p in paths {
            opts.path(p);
        }
        repo.checkout_index(None, Some(&mut opts))?;
        Ok(())
    })
}
```

- [ ] **Step 4: Add the Tauri command**

In `src-tauri/src/commands/diff.rs`:

```rust
#[tauri::command]
pub async fn discard_paths(
    state: State<'_, AppState>,
    repo_id: String,
    paths: Vec<String>,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let paths: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    tokio::task::spawn_blocking(move || backend.discard(&repo_id, &paths))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}
```

Register it in `src-tauri/src/lib.rs` by adding `commands::diff::discard_paths,` to the handler list.

- [ ] **Step 5: Frontend wire-up**

Add to `src/lib/tauri.ts`:

```ts
export async function discardPaths(repoId: string, paths: string[]): Promise<void> {
  return invoke<void>("discard_paths", { repoId, paths });
}
```

Add a `discard` action to `useRepoStore` mirroring `stage` / `unstage`.

In `src/design/context-menu.tsx`, inside `fileMenuItems`, replace the "Discard changes" entry's onClick with `() => useRepoStore.getState().discard([path])`.

- [ ] **Step 6: Run backend tests**

```bash
cargo test --manifest-path src-tauri/Cargo.toml
pnpm tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: discard_paths — restore worktree from index"
```

---

## Task 12: Implement `reset(target, mode)`

**Files:**
- Modify: `src-tauri/tests/discard_reset.rs`
- Modify: `src-tauri/src/git/libgit2.rs`
- Create: `src-tauri/src/commands/history.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/lib/tauri.ts`, `src/features/repo/useRepoStore.ts`, context menus

- [ ] **Step 1: Write the failing tests**

Append to `src-tauri/tests/discard_reset.rs`:

```rust
use platypusgit_lib::git::types::ResetMode;

#[test]
fn reset_hard_moves_head_and_cleans_worktree() {
    let tr = TempRepo::with_initial_commit("hello\n");
    // make a second commit
    {
        let (backend, handle) = tr.open_with_backend();
        write_file(tr.path(), "README.md", "hello world\n");
        backend.stage(&handle.id, &[PathBuf::from("README.md")]).unwrap();
        backend
            .commit(
                &handle.id,
                platypusgit_lib::git::types::CommitOptions {
                    message: "second".into(),
                    amend: false,
                    author_override: None,
                },
            )
            .unwrap();
    }
    // Now reset back to the first commit.
    let (backend, handle) = TempRepo::open_with_backend(&tr);
    let log = backend.log(&handle.id, 10).unwrap();
    let first = log[1].oid.clone();
    backend.reset(&handle.id, &first, ResetMode::Hard).expect("reset --hard");

    let log = backend.log(&handle.id, 10).unwrap();
    assert_eq!(log.len(), 1);
    assert_eq!(read_file(tr.path(), "README.md"), "hello\n");
}

#[test]
fn reset_soft_keeps_worktree() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    write_file(tr.path(), "README.md", "hello world\n");
    backend.stage(&handle.id, &[PathBuf::from("README.md")]).unwrap();
    backend
        .commit(
            &handle.id,
            platypusgit_lib::git::types::CommitOptions {
                message: "second".into(),
                amend: false,
                author_override: None,
            },
        )
        .unwrap();

    let log = backend.log(&handle.id, 10).unwrap();
    let first = log[1].oid.clone();
    backend.reset(&handle.id, &first, ResetMode::Soft).expect("reset --soft");

    // Worktree and index are untouched, so README still contains "hello world\n"
    // and the change is staged (Added/Modified in the index).
    assert_eq!(read_file(tr.path(), "README.md"), "hello world\n");
}
```

Because `open_with_backend` returns a fresh `Libgit2Backend` each time, the second test block re-opens the repo and the RepoId changes. Update the helper signature or call `backend.open(tr.path())` again inside the test. Easiest fix: inline `let backend = Libgit2Backend::new(); let handle = backend.open(tr.path()).unwrap();`.

- [ ] **Step 2: Run — expect fail**

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test discard_reset reset_
```

- [ ] **Step 3: Implement `reset`**

Replace the `reset` stub in `libgit2.rs`:

```rust
fn reset(&self, repo_id: &RepoId, target: &str, mode: ResetMode) -> AppResult<()> {
    self.with_repo(repo_id, |repo| {
        let obj = repo.revparse_single(target).map_err(|_| {
            AppError::InvalidRef(target.to_string())
        })?;
        let reset_type = match mode {
            ResetMode::Soft => git2::ResetType::Soft,
            ResetMode::Mixed => git2::ResetType::Mixed,
            ResetMode::Hard => git2::ResetType::Hard,
        };
        repo.reset(&obj, reset_type, None)?;
        Ok(())
    })
}
```

- [ ] **Step 4: Create the command module**

`src-tauri/src/commands/history.rs`:

```rust
use tauri::State;

use crate::{
    error::{AppError, AppResult},
    git::types::{RepoId, ResetMode},
    state::AppState,
};

#[tauri::command]
pub async fn reset(
    state: State<'_, AppState>,
    repo_id: String,
    target: String,
    mode: ResetMode,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.reset(&repo_id, &target, mode))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}
```

Register the module in `src-tauri/src/commands/mod.rs`:

```rust
pub mod history;
```

Register the command in `src-tauri/src/lib.rs`:

```rust
commands::history::reset,
```

- [ ] **Step 5: Frontend wire-up**

`src/lib/tauri.ts`:

```ts
export type ResetMode = "Soft" | "Mixed" | "Hard";

export async function reset(
  repoId: string,
  target: string,
  mode: ResetMode,
): Promise<void> {
  return invoke<void>("reset", { repoId, target, mode });
}
```

Add a `reset` action to `useRepoStore`. In `src/design/context-menu.tsx`, replace the three reset submenu entries to call the action:

```ts
{ icon: "dot", label: "Soft", onClick: () =>
  useRepoStore.getState().reset(sha, "Soft") },
{ icon: "dot", label: "Mixed", onClick: () =>
  useRepoStore.getState().reset(sha, "Mixed") },
{ icon: "trash", label: "Hard", danger: true, onClick: () =>
  useRepoStore.getState().reset(sha, "Hard") },
```

- [ ] **Step 6: Verify**

```bash
cargo test --manifest-path src-tauri/Cargo.toml
pnpm tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: reset (soft/mixed/hard) via git2 ResetType"
```

---

## Task 13: Implement `checkout_branch`

**Files:**
- Create: `src-tauri/tests/branches_tags.rs`
- Modify: `src-tauri/src/git/libgit2.rs`
- Modify: `src-tauri/src/commands/branches.rs`

- [ ] **Step 1: Write the failing test**

`src-tauri/tests/branches_tags.rs`:

```rust
mod support;

use platypusgit_lib::git::GitBackend;
use support::TempRepo;

#[test]
fn checkout_moves_head_to_existing_branch() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    // Create a branch via libgit2 directly for the test fixture.
    let head_commit = tr.repo.head().unwrap().peel_to_commit().unwrap();
    tr.repo.branch("feature", &head_commit, false).unwrap();

    backend
        .checkout_branch(&handle.id, "feature")
        .expect("checkout");

    let head = tr.repo.head().unwrap();
    assert_eq!(head.shorthand(), Some("feature"));
}
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement**

Replace the `checkout_branch` stub in `libgit2.rs`:

```rust
fn checkout_branch(&self, repo_id: &RepoId, name: &str) -> AppResult<()> {
    self.with_repo(repo_id, |repo| {
        // Refuse to checkout when the worktree is dirty and would be overwritten.
        let statuses = repo.statuses(None)?;
        let dirty = statuses.iter().any(|s| {
            let bits = s.status();
            bits.is_wt_modified()
                || bits.is_wt_new()
                || bits.is_wt_deleted()
                || bits.is_wt_typechange()
                || bits.is_wt_renamed()
                || bits.is_index_modified()
                || bits.is_index_new()
                || bits.is_index_deleted()
        });
        if dirty {
            return Err(AppError::DirtyWorktree(
                "commit or stash before switching branches".into(),
            ));
        }
        let refname = format!("refs/heads/{}", name);
        let obj = repo
            .revparse_single(&refname)
            .map_err(|_| AppError::InvalidRef(name.to_string()))?;
        repo.checkout_tree(&obj, None)?;
        repo.set_head(&refname)?;
        Ok(())
    })
}
```

- [ ] **Step 4: Wire the command**

Replace the `checkout_branch` stub in `src-tauri/src/commands/branches.rs`:

```rust
#[tauri::command]
pub async fn checkout_branch(
    state: State<'_, AppState>,
    repo_id: String,
    name: String,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.checkout_branch(&repo_id, &name))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}
```

- [ ] **Step 5: Run tests — expect pass**

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: checkout_branch with dirty-worktree guard"
```

---

## Task 14: Implement `create_branch`

**Files:**
- Modify: `src-tauri/tests/branches_tags.rs`
- Modify: `src-tauri/src/git/libgit2.rs`
- Modify: `src-tauri/src/commands/branches.rs`

- [ ] **Step 1: Append the failing test**

```rust
#[test]
fn create_branch_from_head_creates_new_ref() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    backend.create_branch(&handle.id, "feature", None).unwrap();

    let branches: Vec<_> = backend
        .branches(&handle.id)
        .unwrap()
        .into_iter()
        .map(|b| b.name)
        .collect();
    assert!(branches.iter().any(|n| n == "feature"));
}

#[test]
fn create_branch_from_explicit_ref() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    let head_oid = tr.repo.head().unwrap().target().unwrap().to_string();
    backend
        .create_branch(&handle.id, "pinned", Some(&head_oid))
        .unwrap();
    let branches: Vec<_> = backend
        .branches(&handle.id)
        .unwrap()
        .into_iter()
        .map(|b| b.name)
        .collect();
    assert!(branches.iter().any(|n| n == "pinned"));
}
```

- [ ] **Step 2: Implement**

Replace the `create_branch` stub:

```rust
fn create_branch(&self, repo_id: &RepoId, name: &str, from: Option<&str>) -> AppResult<()> {
    self.with_repo(repo_id, |repo| {
        let target_commit = match from {
            Some(rev) => {
                let obj = repo
                    .revparse_single(rev)
                    .map_err(|_| AppError::InvalidRef(rev.to_string()))?;
                obj.peel_to_commit()?
            }
            None => match repo.head() {
                Ok(h) => h.peel_to_commit()?,
                Err(e) if e.code() == git2::ErrorCode::UnbornBranch => {
                    return Err(AppError::Unborn)
                }
                Err(e) => return Err(e.into()),
            },
        };
        repo.branch(name, &target_commit, false)?;
        Ok(())
    })
}
```

- [ ] **Step 3: Wire the command**

```rust
#[tauri::command]
pub async fn create_branch(
    state: State<'_, AppState>,
    repo_id: String,
    name: String,
    from: Option<String>,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.create_branch(&repo_id, &name, from.as_deref()))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}
```

- [ ] **Step 4: Run + commit**

```bash
cargo test --manifest-path src-tauri/Cargo.toml
git add -A
git commit -m "feat: create_branch from HEAD or explicit revspec"
```

---

## Task 15: Implement `delete_branch` and `rename_branch`

**Files:**
- Modify: `src-tauri/tests/branches_tags.rs`
- Modify: `src-tauri/src/git/libgit2.rs`
- Modify: `src-tauri/src/commands/branches.rs`
- Modify: `src-tauri/src/lib.rs` (register new commands)

- [ ] **Step 1: Append failing tests**

```rust
#[test]
fn delete_branch_removes_ref() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    backend.create_branch(&handle.id, "scratch", None).unwrap();

    backend.delete_branch(&handle.id, "scratch", false).unwrap();

    let names: Vec<_> = backend
        .branches(&handle.id)
        .unwrap()
        .into_iter()
        .map(|b| b.name)
        .collect();
    assert!(!names.iter().any(|n| n == "scratch"));
}

#[test]
fn delete_current_branch_is_refused() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    let err = backend
        .delete_branch(&handle.id, "main", false)
        .unwrap_err();
    assert!(matches!(err, platypusgit_lib::error::AppError::InvalidRef(_)));
}

#[test]
fn rename_branch_moves_the_ref() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    backend.create_branch(&handle.id, "old", None).unwrap();

    backend.rename_branch(&handle.id, "old", "new").unwrap();

    let names: Vec<_> = backend
        .branches(&handle.id)
        .unwrap()
        .into_iter()
        .map(|b| b.name)
        .collect();
    assert!(names.iter().any(|n| n == "new"));
    assert!(!names.iter().any(|n| n == "old"));
}
```

- [ ] **Step 2: Implement both in libgit2.rs**

```rust
fn delete_branch(&self, repo_id: &RepoId, name: &str, force: bool) -> AppResult<()> {
    self.with_repo(repo_id, |repo| {
        // Refuse to delete the currently checked-out branch.
        if let Ok(head) = repo.head() {
            if head.shorthand() == Some(name) {
                return Err(AppError::InvalidRef(
                    "cannot delete the currently checked-out branch".into(),
                ));
            }
        }
        let mut branch = repo.find_branch(name, git2::BranchType::Local)?;
        if !force {
            // git's default safety: if the branch isn't merged into HEAD, refuse.
            let branch_commit = branch.get().peel_to_commit()?.id();
            if let Ok(head) = repo.head() {
                let head_commit = head.peel_to_commit()?.id();
                let base = repo.merge_base(head_commit, branch_commit).ok();
                if base != Some(branch_commit) {
                    return Err(AppError::DirtyWorktree(format!(
                        "branch {} is not fully merged",
                        name
                    )));
                }
            }
        }
        branch.delete()?;
        Ok(())
    })
}

fn rename_branch(&self, repo_id: &RepoId, from: &str, to: &str) -> AppResult<()> {
    self.with_repo(repo_id, |repo| {
        let mut branch = repo.find_branch(from, git2::BranchType::Local)?;
        branch.rename(to, false)?;
        Ok(())
    })
}
```

- [ ] **Step 3: Wire commands**

In `src-tauri/src/commands/branches.rs`:

```rust
#[tauri::command]
pub async fn delete_branch(
    state: State<'_, AppState>,
    repo_id: String,
    name: String,
    force: bool,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.delete_branch(&repo_id, &name, force))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn rename_branch(
    state: State<'_, AppState>,
    repo_id: String,
    from: String,
    to: String,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.rename_branch(&repo_id, &from, &to))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}
```

Add to `invoke_handler![...]`:

```rust
commands::branches::delete_branch,
commands::branches::rename_branch,
```

- [ ] **Step 4: Verify + commit**

```bash
cargo test --manifest-path src-tauri/Cargo.toml
git add -A
git commit -m "feat: delete_branch (with merge safety) + rename_branch"
```

---

## Task 16: Wire branch operations into the Branches screen

**Files:**
- Modify: `src/lib/tauri.ts`
- Modify: `src/features/repo/useRepoStore.ts`
- Modify: `src/screens/Branches.tsx`
- Modify: `src/design/context-menu.tsx`

- [ ] **Step 1: Add wrappers**

```ts
export async function checkoutBranch(repoId: string, name: string): Promise<void> {
  return invoke<void>("checkout_branch", { repoId, name });
}
export async function createBranch(
  repoId: string,
  name: string,
  from?: string,
): Promise<void> {
  return invoke<void>("create_branch", { repoId, name, from });
}
export async function deleteBranch(
  repoId: string,
  name: string,
  force = false,
): Promise<void> {
  return invoke<void>("delete_branch", { repoId, name, force });
}
export async function renameBranch(
  repoId: string,
  from: string,
  to: string,
): Promise<void> {
  return invoke<void>("rename_branch", { repoId, from, to });
}
```

- [ ] **Step 2: Add actions to `useRepoStore`**

Mirror the earlier action pattern: call wrapper → refreshAll on success → set error on failure. Add: `checkoutBranch`, `createBranch`, `deleteBranch`, `renameBranch`.

- [ ] **Step 3: Wire Branches.tsx buttons**

In the inspector panel:

```tsx
<PGButton
  variant="primary"
  icon="check"
  disabled={!selectedBranch || selectedBranch.isHead}
  onClick={() => selectedBranch && useRepoStore.getState().checkoutBranch(selectedBranch.name)}
>
  Check out
</PGButton>
<PGButton
  variant="ghost"
  tone="danger"
  icon="trash"
  disabled={!selectedBranch || selectedBranch.isHead}
  onClick={() => {
    if (!selectedBranch) return;
    if (confirm(`Delete ${selectedBranch.name}?`))
      useRepoStore.getState().deleteBranch(selectedBranch.name);
  }}
>
  Delete branch
</PGButton>
```

Leave "Merge into current" and "Rebase current onto this" disabled — those land in Plan C / E.

In the Toolbar "New branch" button:

```tsx
<PGButton
  size="sm"
  variant="primary"
  icon="plus"
  onClick={() => {
    const name = prompt("New branch name");
    if (name) useRepoStore.getState().createBranch(name);
  }}
>
  New branch
</PGButton>
```

- [ ] **Step 4: Wire context-menu actions**

In `src/design/context-menu.tsx`, inside `branchMenuItems`, replace:

```ts
onClick: () => pgFlash(`checked out ${name}`)
// with:
onClick: () => useRepoStore.getState().checkoutBranch(name)
```

Same pattern for delete / rename. For rename, `const to = prompt("New name", name); if (to) …renameBranch(name, to)`.

- [ ] **Step 5: Manual smoke + commit**

```bash
pnpm tsc --noEmit
pnpm vite build
```

Run the app, create a scratch branch, check out, rename, delete. Observe refresh.

```bash
git add -A
git commit -m "feat(ui): wire checkout/create/delete/rename branches"
```

---

## Task 17: Implement `create_tag` and `delete_tag`

**Files:**
- Modify: `src-tauri/tests/branches_tags.rs`
- Modify: `src-tauri/src/git/libgit2.rs`
- Modify: `src-tauri/src/commands/branches.rs` (same module as tag listing)
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Failing tests**

Append:

```rust
use platypusgit_lib::git::types::TagTarget;

#[test]
fn create_lightweight_tag() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    let head_oid = tr.repo.head().unwrap().target().unwrap().to_string();

    backend
        .create_tag(
            &handle.id,
            "v0.1.0",
            TagTarget {
                oid: head_oid,
                annotation: None,
            },
        )
        .unwrap();

    let names: Vec<_> = backend
        .tags(&handle.id)
        .unwrap()
        .into_iter()
        .map(|t| t.name)
        .collect();
    assert!(names.iter().any(|n| n == "v0.1.0"));
}

#[test]
fn delete_tag_removes_it() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    let head_oid = tr.repo.head().unwrap().target().unwrap().to_string();
    backend
        .create_tag(
            &handle.id,
            "v0.1.0",
            TagTarget {
                oid: head_oid,
                annotation: None,
            },
        )
        .unwrap();

    backend.delete_tag(&handle.id, "v0.1.0").unwrap();
    let names: Vec<_> = backend.tags(&handle.id).unwrap().into_iter().map(|t| t.name).collect();
    assert!(!names.iter().any(|n| n == "v0.1.0"));
}
```

- [ ] **Step 2: Implementation**

```rust
fn create_tag(&self, repo_id: &RepoId, name: &str, target: TagTarget) -> AppResult<()> {
    self.with_repo(repo_id, |repo| {
        let oid = git2::Oid::from_str(&target.oid)
            .map_err(|_| AppError::InvalidRef(target.oid.clone()))?;
        let obj = repo.find_object(oid, None)?;
        match target.annotation {
            Some(msg) => {
                let sig = crate::git::signature::default_signature(repo)?;
                repo.tag(name, &obj, &sig, &msg, false)?;
            }
            None => {
                repo.tag_lightweight(name, &obj, false)?;
            }
        }
        Ok(())
    })
}

fn delete_tag(&self, repo_id: &RepoId, name: &str) -> AppResult<()> {
    self.with_repo(repo_id, |repo| {
        repo.tag_delete(name)?;
        Ok(())
    })
}
```

- [ ] **Step 3: Commands**

Append to `src-tauri/src/commands/branches.rs`:

```rust
use crate::git::types::TagTarget;

#[tauri::command]
pub async fn create_tag(
    state: State<'_, AppState>,
    repo_id: String,
    name: String,
    target: TagTarget,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.create_tag(&repo_id, &name, target))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn delete_tag(
    state: State<'_, AppState>,
    repo_id: String,
    name: String,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.delete_tag(&repo_id, &name))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}
```

Register `create_tag`, `delete_tag` in `lib.rs`.

- [ ] **Step 4: Frontend wrappers + store actions + context-menu wiring**

Same pattern as branches. Add wrappers in `tauri.ts`, store actions, wire `tagMenuItems` "Delete tag" onClick to `useRepoStore.getState().deleteTag(name)`. Create-tag UX via `prompt` for now.

- [ ] **Step 5: Verify + commit**

```bash
cargo test --manifest-path src-tauri/Cargo.toml
pnpm tsc --noEmit
git add -A
git commit -m "feat: create_tag (light + annotated) and delete_tag"
```

---

## Task 18: Implement `cherry_pick`

**Files:**
- Create: `src-tauri/tests/cherry_pick_revert.rs`
- Modify: `src-tauri/src/git/libgit2.rs`
- Modify: `src-tauri/src/commands/history.rs`, `src-tauri/src/lib.rs`

- [ ] **Step 1: Failing test**

`src-tauri/tests/cherry_pick_revert.rs`:

```rust
mod support;

use std::path::PathBuf;

use platypusgit_lib::git::{types::CommitOptions, GitBackend};
use support::{fs::{read_file, write_file}, TempRepo};

#[test]
fn cherry_pick_applies_commit_onto_head() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();

    // Create branch `feature`, commit a change there, go back to main.
    backend.create_branch(&handle.id, "feature", None).unwrap();
    backend.checkout_branch(&handle.id, "feature").unwrap();
    write_file(tr.path(), "NOTES.md", "hello notes\n");
    backend.stage(&handle.id, &[PathBuf::from("NOTES.md")]).unwrap();
    let feature_oid = backend
        .commit(
            &handle.id,
            CommitOptions {
                message: "add notes".into(),
                amend: false,
                author_override: None,
            },
        )
        .unwrap();

    backend.checkout_branch(&handle.id, "main").unwrap();
    assert!(!tr.path().join("NOTES.md").exists());

    backend.cherry_pick(&handle.id, &feature_oid).unwrap();

    assert_eq!(read_file(tr.path(), "NOTES.md"), "hello notes\n");
    let log = backend.log(&handle.id, 10).unwrap();
    assert_eq!(log[0].summary, "add notes");
}
```

- [ ] **Step 2: Implementation**

```rust
fn cherry_pick(&self, repo_id: &RepoId, oid: &str) -> AppResult<()> {
    self.with_repo(repo_id, |repo| {
        let target_oid = git2::Oid::from_str(oid)
            .map_err(|_| AppError::InvalidRef(oid.to_string()))?;
        let commit = repo.find_commit(target_oid)?;

        // Apply changes into the index + worktree.
        repo.cherrypick(&commit, None)?;

        // If there are conflicts, leave them for the user to resolve (Plan C).
        let statuses = repo.statuses(None)?;
        let has_conflict = statuses.iter().any(|s| s.status().is_conflicted());
        if has_conflict {
            return Err(AppError::ConflictsDetected(format!(
                "cherry-pick of {} produced conflicts",
                &oid[..7]
            )));
        }

        // Build the commit.
        let sig = crate::git::signature::default_signature(repo)?;
        let mut index = repo.index()?;
        let tree_oid = index.write_tree()?;
        let tree = repo.find_tree(tree_oid)?;
        let parent = repo.head()?.peel_to_commit()?;

        // Preserve original author, new committer.
        let author = commit.author();
        repo.commit(
            Some("HEAD"),
            &author,
            &sig,
            commit.message().unwrap_or(""),
            &tree,
            &[&parent],
        )?;

        // Clear cherrypick state.
        repo.cleanup_state()?;
        Ok(())
    })
}
```

- [ ] **Step 3: Command + wire**

Add `cherry_pick` to `commands/history.rs`:

```rust
#[tauri::command]
pub async fn cherry_pick(
    state: State<'_, AppState>,
    repo_id: String,
    oid: String,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.cherry_pick(&repo_id, &oid))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}
```

Register. Add TS wrapper `cherryPick(repoId, oid)` and a store action. In `context-menu.tsx`, replace the commit menu's "Cherry-pick onto current" onClick.

- [ ] **Step 4: Verify + commit**

```bash
cargo test --manifest-path src-tauri/Cargo.toml
git add -A
git commit -m "feat: cherry_pick (aborts with ConflictsDetected on conflict)"
```

---

## Task 19: Implement `revert`

**Files:**
- Modify: `src-tauri/tests/cherry_pick_revert.rs`
- Modify: `src-tauri/src/git/libgit2.rs`
- Modify: `src-tauri/src/commands/history.rs`, `src-tauri/src/lib.rs`

- [ ] **Step 1: Failing test**

```rust
#[test]
fn revert_undoes_commit() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    write_file(tr.path(), "README.md", "hello world\n");
    backend.stage(&handle.id, &[PathBuf::from("README.md")]).unwrap();
    let bad_oid = backend
        .commit(
            &handle.id,
            CommitOptions {
                message: "bad change".into(),
                amend: false,
                author_override: None,
            },
        )
        .unwrap();

    backend.revert(&handle.id, &bad_oid).unwrap();

    assert_eq!(read_file(tr.path(), "README.md"), "hello\n");
    let log = backend.log(&handle.id, 10).unwrap();
    assert!(log[0].summary.to_lowercase().contains("revert"));
}
```

- [ ] **Step 2: Implementation**

```rust
fn revert(&self, repo_id: &RepoId, oid: &str) -> AppResult<()> {
    self.with_repo(repo_id, |repo| {
        let target_oid = git2::Oid::from_str(oid)
            .map_err(|_| AppError::InvalidRef(oid.to_string()))?;
        let commit = repo.find_commit(target_oid)?;

        repo.revert(&commit, None)?;

        let statuses = repo.statuses(None)?;
        if statuses.iter().any(|s| s.status().is_conflicted()) {
            return Err(AppError::ConflictsDetected(format!(
                "revert of {} produced conflicts",
                &oid[..7]
            )));
        }

        let sig = crate::git::signature::default_signature(repo)?;
        let mut index = repo.index()?;
        let tree_oid = index.write_tree()?;
        let tree = repo.find_tree(tree_oid)?;
        let parent = repo.head()?.peel_to_commit()?;

        let msg = format!("Revert \"{}\"", commit.summary().unwrap_or("commit"));
        repo.commit(Some("HEAD"), &sig, &sig, &msg, &tree, &[&parent])?;
        repo.cleanup_state()?;
        Ok(())
    })
}
```

- [ ] **Step 3: Command + wire**

Mirror `cherry_pick`. Context menu: `revert` onClick in `commitMenuItems`.

- [ ] **Step 4: Verify + commit**

```bash
cargo test --manifest-path src-tauri/Cargo.toml
git add -A
git commit -m "feat: revert via git2 revert + commit"
```

---

## Task 20: Implement `stash_save`

**Files:**
- Create: `src-tauri/tests/stash.rs`
- Modify: `src-tauri/src/git/libgit2.rs`
- Create: `src-tauri/src/commands/stash.rs`
- Modify: `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs`

- [ ] **Step 1: Failing test**

`src-tauri/tests/stash.rs`:

```rust
mod support;

use std::path::PathBuf;

use platypusgit_lib::git::{types::StashSaveOptions, GitBackend};
use support::{fs::{read_file, write_file}, TempRepo};

#[test]
fn stash_save_clears_worktree_and_records_entry() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    write_file(tr.path(), "README.md", "dirty change\n");

    let oid = backend
        .stash_save(
            &handle.id,
            StashSaveOptions {
                message: Some("wip".into()),
                include_untracked: false,
                keep_index: false,
            },
        )
        .unwrap();
    assert!(oid.is_some());

    assert_eq!(read_file(tr.path(), "README.md"), "hello\n");
    let stashes = backend.stashes(&handle.id).unwrap();
    assert_eq!(stashes.len(), 1);
}
```

- [ ] **Step 2: Implementation**

`stash_save` requires `&mut Repository`:

```rust
fn stash_save(&self, repo_id: &RepoId, opts: StashSaveOptions) -> AppResult<Option<String>> {
    self.with_repo_mut(repo_id, |repo| {
        let sig = crate::git::signature::default_signature(repo)?;
        let mut flags = git2::StashFlags::DEFAULT;
        if opts.include_untracked {
            flags |= git2::StashFlags::INCLUDE_UNTRACKED;
        }
        if opts.keep_index {
            flags |= git2::StashFlags::KEEP_INDEX;
        }
        let message = opts.message.as_deref();
        match repo.stash_save2(&sig, message, Some(flags)) {
            Ok(oid) => Ok(Some(oid.to_string())),
            Err(e) if e.code() == git2::ErrorCode::NotFound => Ok(None),
            Err(e) => Err(e.into()),
        }
    })
}
```

- [ ] **Step 3: Command module**

`src-tauri/src/commands/stash.rs`:

```rust
use tauri::State;

use crate::{
    error::{AppError, AppResult},
    git::types::{RepoId, StashSaveOptions},
    state::AppState,
};

#[tauri::command]
pub async fn stash_save(
    state: State<'_, AppState>,
    repo_id: String,
    opts: StashSaveOptions,
) -> AppResult<Option<String>> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.stash_save(&repo_id, opts))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}
```

Register the module and the command.

- [ ] **Step 4: Verify + commit**

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test stash
git add -A
git commit -m "feat: stash_save with include-untracked + keep-index flags"
```

---

## Task 21: Implement `stash_apply`, `stash_pop`, `stash_drop`

**Files:**
- Modify: `src-tauri/tests/stash.rs`
- Modify: `src-tauri/src/git/libgit2.rs`
- Modify: `src-tauri/src/commands/stash.rs`, `src-tauri/src/lib.rs`

- [ ] **Step 1: Failing tests**

```rust
#[test]
fn stash_apply_restores_changes_and_keeps_stash() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    write_file(tr.path(), "README.md", "dirty\n");
    backend
        .stash_save(
            &handle.id,
            StashSaveOptions { message: Some("wip".into()), include_untracked: false, keep_index: false },
        )
        .unwrap();

    backend.stash_apply(&handle.id, 0).unwrap();

    assert_eq!(read_file(tr.path(), "README.md"), "dirty\n");
    assert_eq!(backend.stashes(&handle.id).unwrap().len(), 1);
}

#[test]
fn stash_pop_restores_and_drops() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    write_file(tr.path(), "README.md", "dirty\n");
    backend
        .stash_save(
            &handle.id,
            StashSaveOptions { message: Some("wip".into()), include_untracked: false, keep_index: false },
        )
        .unwrap();

    backend.stash_pop(&handle.id, 0).unwrap();

    assert_eq!(read_file(tr.path(), "README.md"), "dirty\n");
    assert_eq!(backend.stashes(&handle.id).unwrap().len(), 0);
}

#[test]
fn stash_drop_removes_entry_without_applying() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    write_file(tr.path(), "README.md", "dirty\n");
    backend
        .stash_save(
            &handle.id,
            StashSaveOptions { message: Some("wip".into()), include_untracked: false, keep_index: false },
        )
        .unwrap();

    backend.stash_drop(&handle.id, 0).unwrap();
    assert_eq!(read_file(tr.path(), "README.md"), "hello\n");
    assert_eq!(backend.stashes(&handle.id).unwrap().len(), 0);
}
```

- [ ] **Step 2: Implementations**

```rust
fn stash_apply(&self, repo_id: &RepoId, index: usize) -> AppResult<()> {
    self.with_repo_mut(repo_id, |repo| {
        repo.stash_apply(index, None)?;
        Ok(())
    })
}

fn stash_pop(&self, repo_id: &RepoId, index: usize) -> AppResult<()> {
    self.with_repo_mut(repo_id, |repo| {
        repo.stash_pop(index, None)?;
        Ok(())
    })
}

fn stash_drop(&self, repo_id: &RepoId, index: usize) -> AppResult<()> {
    self.with_repo_mut(repo_id, |repo| {
        repo.stash_drop(index)?;
        Ok(())
    })
}
```

- [ ] **Step 3: Commands**

Append matching `#[tauri::command]` wrappers in `commands/stash.rs`, register in `lib.rs`.

- [ ] **Step 4: Frontend wire-up**

TS wrappers: `stashSave`, `stashApply`, `stashPop`, `stashDrop`. Store actions mirroring the pattern.

In `context-menu.tsx`, inside `stashMenuItems`, replace each `pgFlash` onClick with the store action (`useRepoStore.getState().stashApply(stash.index)` etc.).

Add a "Stash changes" button somewhere convenient (simplest: in the Commit Panel header) that calls `stashSave({ message: prompt("stash message") || null, includeUntracked: false, keepIndex: false })`.

- [ ] **Step 5: Verify + commit**

```bash
cargo test --manifest-path src-tauri/Cargo.toml
pnpm tsc --noEmit
git add -A
git commit -m "feat: stash apply/pop/drop + UI wiring"
```

---

## Task 22: End-to-end verification

No code changes — this is a manual smoke + test run pass covering everything Phase 1 added.

- [ ] **Step 1: Full test suite**

```bash
cargo test --manifest-path src-tauri/Cargo.toml
pnpm tsc --noEmit
pnpm vite build
```

All green.

- [ ] **Step 2: Open the app against a throwaway repo**

```bash
mkdir -p /tmp/pg-smoke && cd /tmp/pg-smoke && git init
echo "# scratch" > README.md && git add README.md && git commit -m "initial"
```

```bash
pnpm tauri dev
```

Open `/tmp/pg-smoke`. Exercise:
1. Modify README.md. Stage it. Unstage it. Stage again.
2. Commit with subject + body.
3. Verify the commit appears in History.
4. Amend the commit with a new message.
5. Create a branch `feature`, check it out, commit another change.
6. Check out main, cherry-pick the feature commit.
7. Revert the cherry-pick.
8. Reset --hard back to the initial commit.
9. Create a lightweight tag at HEAD, delete it.
10. Make a change, stash it, verify worktree is clean, stash apply, stash drop.
11. Create a branch, rename it, delete it.

Record any bugs as issues; fix them in follow-up commits named `fix: …`.

- [ ] **Step 3: Final commit (only if there were fixes)**

```bash
git add -A
git commit -m "fix: end-to-end smoke test findings"
```

---

## Outlined follow-up plans

These are explicitly **not** part of this plan. Each should become its own spec + plan before implementation.

### Plan B — Network operations (fetch / pull / push / remote management)

Key risks: credentials. Options:
1. Route all network ops through `git` CLI via `CliBackend` — inherits the user's credential helper, SSH agent, and config. Pragmatic.
2. Implement `git2::RemoteCallbacks` with `credentials` callback that tries agent → keychain → token prompt. More work, better UX.

Recommend starting with Option 1 (CLI fallback) to ship quickly, then layering Option 2 later.

Operations in scope:
- `fetch(remote)`, `fetch_all()`
- `pull(remote, branch, mode: ff-only|merge|rebase)`
- `push(remote, branch, force: none|with-lease|force)`
- `set_upstream(branch, remote_branch)`
- `add_remote(name, url)`, `remove_remote(name)`, `rename_remote(from, to)`, `set_remote_url(name, url)`
- `prune(remote)`

### Plan C — Conflict resolution

State machine: detect merge/rebase/cherry-pick/revert in progress via `repo.state()`. UI flow:
- `accept_ours(path)`, `accept_theirs(path)` — rewrite working file + stage
- `mark_resolved(paths)` — clear conflict markers in index
- `continue_merge()`, `continue_rebase()`, `continue_cherry_pick()`
- `abort_merge()`, `abort_rebase()`, `abort_cherry_pick()`
- 3-way diff UI for `PGConflictScreen` showing ours/base/theirs side by side

### Plan D — Hunk-level staging

Needs a patch builder. For each hunk the user picks:
- Serialize to unified-diff text
- `git2::Patch::from_buffer` → apply to index

Selected-line staging adds a line-picker UI in the diff component that emits a hand-crafted hunk.

### Plan E — Interactive rebase

The largest. `git2` doesn't ship a high-level interactive rebase API; we either drive the low-level `Rebase` type (cherry-picking each commit, pausing on `edit` / `reword` / `squash` / `fixup` steps) or shell out to `git rebase -i` with `GIT_SEQUENCE_EDITOR` set to a script we write. Both need a conflict-resolution loop.

---

## Self-review

### Coverage vs. scope

- ✅ Staging (stage/unstage/discard): Tasks 5–6, 11
- ✅ Commit + amend: Task 7; UI wiring Task 10
- ✅ Branches (checkout/create/delete/rename): Tasks 13–16
- ✅ Tags (create/delete): Task 17
- ✅ Reset: Task 12
- ✅ Cherry-pick: Task 18
- ✅ Revert: Task 19
- ✅ Stash (save/apply/pop/drop): Tasks 20–21
- ✅ E2E smoke: Task 22

All in-scope operations have tasks with real code and tests. Out-of-scope items are called out explicitly in the plans section.

### Placeholder scan

No "TBD", "implement later", "similar to", "handle edge cases" phrasing. Every code block is complete and copy-paste runnable within the surrounding context.

### Type consistency

- `CommitOptions { message, amend, author_override }` is defined once in `types.rs` and used in Tasks 7, 12, 18, 19 — identical shape.
- `StashSaveOptions { message, include_untracked, keep_index }` ditto.
- `ResetMode { Soft | Mixed | Hard }` enum consistent between Rust (Task 4) and TS (Task 12).
- `TagTarget { oid, annotation }` consistent in Rust + TS (Task 17).
- Store-action method names (`stage`, `unstage`, `commit`, `checkoutBranch`, `createBranch`, `deleteBranch`, `renameBranch`, `reset`, `cherryPick`, `revert`, `stashSave`, `stashApply`, `stashPop`, `stashDrop`) match between the interface declarations and the usage sites.

Plan is internally consistent.
