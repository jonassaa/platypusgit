# platypusgit Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold a Tauri 2 + React + TS + Tailwind v4 desktop app with a trait-backed Rust git module, wire one working end-to-end slice (open repo → list working-tree status), and configure cross-platform bundlers.

**Architecture:** Rust backend exposes typed Tauri commands that dispatch through a `GitBackend` trait (libgit2 impl now, CLI impl stubbed). Frontend is React with Zustand per-feature stores and a typed IPC layer in `src/lib/tauri.ts`. Errors are a `thiserror` enum on the Rust side, serialized as a discriminated union on the TS side.

**Tech Stack:** Tauri 2, Rust (git2, thiserror, tokio, uuid), React 18, TypeScript 5, Vite 5, Tailwind v4, Zustand, lucide-react, pnpm.

**Reference spec:** `docs/superpowers/specs/2026-04-21-platypusgit-scaffold-design.md`

---

## File inventory

**New (Rust):**
- `src-tauri/Cargo.toml` (generated, then modified)
- `src-tauri/tauri.conf.json` (generated, then modified)
- `src-tauri/capabilities/default.json` (generated, then modified)
- `src-tauri/src/main.rs` (generated, replaced)
- `src-tauri/src/lib.rs` (generated, replaced)
- `src-tauri/src/error.rs`
- `src-tauri/src/state.rs`
- `src-tauri/src/git/mod.rs`
- `src-tauri/src/git/types.rs`
- `src-tauri/src/git/libgit2.rs`
- `src-tauri/src/git/cli.rs`
- `src-tauri/src/commands/mod.rs`
- `src-tauri/src/commands/repo.rs`
- `src-tauri/src/commands/commits.rs`
- `src-tauri/src/commands/diff.rs`
- `src-tauri/src/commands/branches.rs`

**New (Frontend):**
- `package.json` (generated, then modified)
- `vite.config.ts` (generated, replaced)
- `tsconfig.json`, `tsconfig.node.json` (generated)
- `index.html` (generated, modified)
- `src/main.tsx` (generated, replaced)
- `src/App.tsx` (generated, replaced)
- `src/index.css` (generated, replaced)
- `src/lib/tauri.ts`
- `src/lib/errors.ts`
- `src/lib/types.ts`
- `src/components/ui/Button.tsx`
- `src/features/repo/OpenRepoButton.tsx`
- `src/features/repo/StatusList.tsx`
- `src/features/repo/useRepoStore.ts`
- `src/features/commits/.gitkeep`
- `src/features/diff/.gitkeep`
- `src/features/branches/.gitkeep`
- `src/store.ts`

---

## Task 1: Scaffold the Tauri 2 template via create-tauri-app

**Files:**
- Generates: all baseline files listed above in a temp dir, then copies into project.

- [ ] **Step 1: Run create-tauri-app non-interactively in a temp dir**

```bash
TMPDIR_SCAFFOLD=$(mktemp -d)
cd "$TMPDIR_SCAFFOLD"
pnpm dlx create-tauri-app@latest platypusgit \
  --template react-ts \
  --manager pnpm \
  --identifier com.platypusgit.app \
  -y
ls platypusgit
```

Expected: directory `platypusgit/` containing `package.json`, `src/`, `src-tauri/`, `vite.config.ts`, `tsconfig.json`, `index.html`, `.gitignore`, etc.

- [ ] **Step 2: Copy generated files into the project root, preserving our docs/ and .gitignore**

```bash
cd /Users/jonas/dev/fun/platypusgit
# Back up our gitignore (we'll merge with Tauri's)
cp .gitignore .gitignore.ours
# Copy everything except the template's .gitignore and .git
rsync -a --exclude '.git' --exclude '.gitignore' "$TMPDIR_SCAFFOLD/platypusgit/" ./
# Merge gitignores: union of the two, dedup
cat .gitignore.ours "$TMPDIR_SCAFFOLD/platypusgit/.gitignore" 2>/dev/null | awk '!seen[$0]++' > .gitignore
rm .gitignore.ours
ls -la
```

Expected: `package.json`, `src/`, `src-tauri/`, `vite.config.ts`, `tsconfig.json`, `index.html`, `pnpm-lock.yaml` (may be absent if template skips install), `.gitignore` (merged), `docs/` (preserved).

- [ ] **Step 3: Sanity-check the generated Tauri version**

```bash
grep '"@tauri-apps/api"' package.json
grep 'tauri = ' src-tauri/Cargo.toml
```

Expected: both show version `^2` / `"2"` (Tauri 2). If the template generated Tauri 1 (shouldn't in 2026 but verify), abort and report.

- [ ] **Step 4: Commit the vanilla scaffold**

```bash
git add -A
git commit -m "feat: scaffold Tauri 2 + React + TS template via create-tauri-app

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Add Tailwind v4

**Files:**
- Modify: `package.json` (deps)
- Modify: `vite.config.ts` (add plugin)
- Replace: `src/index.css` (Tailwind import)
- Remove: `src/App.css` (no longer needed; Tailwind replaces it)

- [ ] **Step 1: Install Tailwind v4 and Vite plugin**

```bash
pnpm add -D tailwindcss@^4 @tailwindcss/vite@^4
```

Expected: both packages added to `devDependencies` in `package.json`.

- [ ] **Step 2: Update vite.config.ts**

Replace entire file contents with:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 1421 }
      : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
}));
```

- [ ] **Step 3: Replace src/index.css with Tailwind import + base styles**

```css
@import "tailwindcss";

@theme {
  --color-bg: #0f1115;
  --color-bg-elev: #171a20;
  --color-border: #262a33;
  --color-text: #e6e8ec;
  --color-text-dim: #9aa0a6;
  --color-accent: #6aa9ff;
}

html, body, #root { height: 100%; }

body {
  margin: 0;
  background: var(--color-bg);
  color: var(--color-text);
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-feature-settings: "cv02", "cv03", "cv04", "cv11";
}
```

- [ ] **Step 4: Delete src/App.css if present**

```bash
rm -f src/App.css
```

- [ ] **Step 5: Verify Tailwind plugin registers**

```bash
pnpm install
pnpm vite build --mode development 2>&1 | tail -20
```

Expected: build succeeds OR fails only because `App.tsx` still imports `./App.css` (we'll replace `App.tsx` in a later task). Tailwind errors would say "plugin not found" or "invalid @import".

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add Tailwind v4 with Vite plugin

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Add Rust dependencies

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add deps via cargo add**

```bash
cd src-tauri
cargo add git2@0.19 --no-default-features --features https
cargo add thiserror@1
cargo add uuid@1 --features v4,serde
cargo add tokio@1 --features rt-multi-thread,macros,sync
cargo add tauri-plugin-dialog@2
cd ..
```

Expected: four `cargo add` calls succeed (tauri-plugin-dialog may already be in the template; `cargo add` is idempotent on version bumps). `src-tauri/Cargo.toml` `[dependencies]` now contains git2, thiserror, uuid, tokio, tauri-plugin-dialog. `serde` and `serde_json` are already present from the template.

- [ ] **Step 2: Verify**

```bash
cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -5
```

Expected: compile succeeds (main.rs/lib.rs from template still there and valid). If `git2` fails to build due to missing libssh2/openssl on macOS, add `CARGO_NET_GIT_FETCH_WITH_CLI=true` to env and retry. git2 0.19 bundles libssh2 by default with `vendored-libssh2` feature — if the build complains, enable that feature.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat: add git2, thiserror, tokio, uuid, dialog plugin deps

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Rust error module

**Files:**
- Create: `src-tauri/src/error.rs`

- [ ] **Step 1: Write the error module**

Create `src-tauri/src/error.rs`:

```rust
use serde::Serialize;

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

    #[error("internal error: {0}")]
    Internal(String),
}

impl From<git2::Error> for AppError {
    fn from(e: git2::Error) -> Self {
        AppError::Git(e.message().to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Io(e.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
```

Note: the `Serialize` derive on an enum with `#[error(transparent)]`-style sources would need custom handling; the variants above store `String` so derive works directly.

- [ ] **Step 2: Wire into lib.rs (temporarily, just to compile)**

Add to the top of `src-tauri/src/lib.rs`:

```rust
pub mod error;
```

- [ ] **Step 3: Verify compile**

```bash
cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -5
```

Expected: compiles cleanly.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/error.rs src-tauri/src/lib.rs
git commit -m "feat: AppError enum with serde-tagged serialization

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Rust git types module

**Files:**
- Create: `src-tauri/src/git/mod.rs` (module declarations only for now)
- Create: `src-tauri/src/git/types.rs`

- [ ] **Step 1: Create the types module**

Create `src-tauri/src/git/types.rs`:

```rust
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(transparent)]
pub struct RepoId(pub String);

#[derive(Debug, Clone, Serialize)]
pub struct RepoHandle {
    pub id: RepoId,
    pub path: PathBuf,
    pub head: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind")]
pub enum StatusFlag {
    Unmodified,
    Modified,
    Added,
    Deleted,
    Renamed,
    Typechange,
    Untracked,
    Ignored,
    Conflicted,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileStatus {
    pub path: String,
    pub worktree: StatusFlag,
    pub index: StatusFlag,
}

#[derive(Debug, Clone, Serialize)]
pub struct CommitInfo {
    pub oid: String,
    pub summary: String,
    pub author: String,
    pub email: String,
    pub timestamp: i64,
    pub parents: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BranchInfo {
    pub name: String,
    pub is_head: bool,
    pub upstream: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DiffKind {
    WorktreeToIndex,
    IndexToHead,
    WorktreeToHead,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiffHunks {
    pub path: String,
    pub hunks: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitOptions {
    pub message: String,
    pub amend: bool,
    pub author_override: Option<AuthorOverride>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthorOverride {
    pub name: String,
    pub email: String,
}
```

- [ ] **Step 2: Create the git module root**

Create `src-tauri/src/git/mod.rs`:

```rust
pub mod types;
// trait and impls added in subsequent tasks
```

- [ ] **Step 3: Register module in lib.rs**

Add to `src-tauri/src/lib.rs` (after the `pub mod error;` line):

```rust
pub mod git;
```

- [ ] **Step 4: Verify compile**

```bash
cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -5
```

Expected: compiles cleanly.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/git src-tauri/src/lib.rs
git commit -m "feat: git types (RepoHandle, FileStatus, CommitInfo, etc.)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: GitBackend trait

**Files:**
- Modify: `src-tauri/src/git/mod.rs`

- [ ] **Step 1: Add the trait declaration**

Replace `src-tauri/src/git/mod.rs` with:

```rust
pub mod types;
pub mod libgit2;
pub mod cli;

use std::path::{Path, PathBuf};

use crate::error::AppResult;
use types::{
    BranchInfo, CommitInfo, CommitOptions, DiffHunks, DiffKind, FileStatus, RepoHandle, RepoId,
};

pub trait GitBackend: Send + Sync {
    fn open(&self, path: &Path) -> AppResult<RepoHandle>;
    fn status(&self, repo_id: &RepoId) -> AppResult<Vec<FileStatus>>;
    fn log(&self, repo_id: &RepoId, limit: usize) -> AppResult<Vec<CommitInfo>>;
    fn diff(&self, repo_id: &RepoId, path: &Path, kind: DiffKind) -> AppResult<DiffHunks>;
    fn stage(&self, repo_id: &RepoId, paths: &[PathBuf]) -> AppResult<()>;
    fn unstage(&self, repo_id: &RepoId, paths: &[PathBuf]) -> AppResult<()>;
    fn commit(&self, repo_id: &RepoId, opts: CommitOptions) -> AppResult<String>;
    fn branches(&self, repo_id: &RepoId) -> AppResult<Vec<BranchInfo>>;
    fn checkout_branch(&self, repo_id: &RepoId, name: &str) -> AppResult<()>;
    fn create_branch(&self, repo_id: &RepoId, name: &str, from: Option<&str>) -> AppResult<()>;
    fn fetch(&self, repo_id: &RepoId, remote: &str) -> AppResult<()>;
    fn pull(&self, repo_id: &RepoId, remote: &str, branch: &str) -> AppResult<()>;
    fn push(&self, repo_id: &RepoId, remote: &str, branch: &str) -> AppResult<()>;
}
```

Note: the file now references `libgit2` and `cli` submodules — they'll be added in the next two tasks. Compile will fail until then; that's expected.

- [ ] **Step 2: Skip verify (compile fails intentionally)**

---

## Task 7: libgit2 backend implementation

**Files:**
- Create: `src-tauri/src/git/libgit2.rs`

- [ ] **Step 1: Write the libgit2 backend**

Create `src-tauri/src/git/libgit2.rs`:

```rust
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Mutex,
};

use git2::{Repository, Status, StatusOptions};
use uuid::Uuid;

use crate::error::{AppError, AppResult};

use super::{
    types::{
        BranchInfo, CommitInfo, CommitOptions, DiffHunks, DiffKind, FileStatus, RepoHandle,
        RepoId, StatusFlag,
    },
    GitBackend,
};

pub struct Libgit2Backend {
    repos: Mutex<HashMap<RepoId, Mutex<Repository>>>,
}

impl Libgit2Backend {
    pub fn new() -> Self {
        Self { repos: Mutex::new(HashMap::new()) }
    }

    fn with_repo<F, T>(&self, repo_id: &RepoId, f: F) -> AppResult<T>
    where
        F: FnOnce(&Repository) -> AppResult<T>,
    {
        let map = self.repos.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let repo_cell = map
            .get(repo_id)
            .ok_or_else(|| AppError::UnknownRepo(repo_id.0.clone()))?;
        let repo = repo_cell.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        f(&repo)
    }
}

impl Default for Libgit2Backend {
    fn default() -> Self { Self::new() }
}

fn map_status_flag(s: Status, side: StatusSide) -> StatusFlag {
    use StatusSide::*;
    match side {
        Worktree => {
            if s.contains(Status::WT_NEW) { StatusFlag::Untracked }
            else if s.contains(Status::WT_MODIFIED) { StatusFlag::Modified }
            else if s.contains(Status::WT_DELETED) { StatusFlag::Deleted }
            else if s.contains(Status::WT_RENAMED) { StatusFlag::Renamed }
            else if s.contains(Status::WT_TYPECHANGE) { StatusFlag::Typechange }
            else if s.contains(Status::CONFLICTED) { StatusFlag::Conflicted }
            else if s.contains(Status::IGNORED) { StatusFlag::Ignored }
            else { StatusFlag::Unmodified }
        }
        Index => {
            if s.contains(Status::INDEX_NEW) { StatusFlag::Added }
            else if s.contains(Status::INDEX_MODIFIED) { StatusFlag::Modified }
            else if s.contains(Status::INDEX_DELETED) { StatusFlag::Deleted }
            else if s.contains(Status::INDEX_RENAMED) { StatusFlag::Renamed }
            else if s.contains(Status::INDEX_TYPECHANGE) { StatusFlag::Typechange }
            else { StatusFlag::Unmodified }
        }
    }
}

enum StatusSide { Worktree, Index }

impl GitBackend for Libgit2Backend {
    fn open(&self, path: &Path) -> AppResult<RepoHandle> {
        if !path.exists() {
            return Err(AppError::InvalidPath(path.display().to_string()));
        }
        let repo = Repository::open(path).map_err(|e| {
            if e.code() == git2::ErrorCode::NotFound {
                AppError::NotARepo(path.display().to_string())
            } else {
                AppError::from(e)
            }
        })?;

        let head = match repo.head() {
            Ok(r) => r.shorthand().map(|s| s.to_string()),
            Err(e) if e.code() == git2::ErrorCode::UnbornBranch
                   || e.code() == git2::ErrorCode::NotFound => None,
            Err(e) => return Err(e.into()),
        };

        let id = RepoId(Uuid::new_v4().to_string());
        let workdir = repo.workdir().map(PathBuf::from).unwrap_or_else(|| path.to_path_buf());

        let mut map = self.repos.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        map.insert(id.clone(), Mutex::new(repo));

        Ok(RepoHandle { id, path: workdir, head })
    }

    fn status(&self, repo_id: &RepoId) -> AppResult<Vec<FileStatus>> {
        self.with_repo(repo_id, |repo| {
            let mut opts = StatusOptions::new();
            opts.include_untracked(true)
                .recurse_untracked_dirs(true)
                .include_ignored(false);
            let statuses = repo.statuses(Some(&mut opts))?;
            let mut out = Vec::with_capacity(statuses.len());
            for entry in statuses.iter() {
                let path = entry.path().unwrap_or("").to_string();
                let s = entry.status();
                out.push(FileStatus {
                    path,
                    worktree: map_status_flag(s, StatusSide::Worktree),
                    index: map_status_flag(s, StatusSide::Index),
                });
            }
            Ok(out)
        })
    }

    fn log(&self, _repo_id: &RepoId, _limit: usize) -> AppResult<Vec<CommitInfo>> {
        Err(AppError::NotImplemented)
    }
    fn diff(&self, _repo_id: &RepoId, _path: &Path, _kind: DiffKind) -> AppResult<DiffHunks> {
        Err(AppError::NotImplemented)
    }
    fn stage(&self, _repo_id: &RepoId, _paths: &[PathBuf]) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn unstage(&self, _repo_id: &RepoId, _paths: &[PathBuf]) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn commit(&self, _repo_id: &RepoId, _opts: CommitOptions) -> AppResult<String> {
        Err(AppError::NotImplemented)
    }
    fn branches(&self, _repo_id: &RepoId) -> AppResult<Vec<BranchInfo>> {
        Err(AppError::NotImplemented)
    }
    fn checkout_branch(&self, _repo_id: &RepoId, _name: &str) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn create_branch(&self, _repo_id: &RepoId, _name: &str, _from: Option<&str>) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn fetch(&self, _repo_id: &RepoId, _remote: &str) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn pull(&self, _repo_id: &RepoId, _remote: &str, _branch: &str) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn push(&self, _repo_id: &RepoId, _remote: &str, _branch: &str) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
}
```

- [ ] **Step 2: Skip verify (compile still fails — `cli.rs` missing)**

---

## Task 8: CLI backend stub

**Files:**
- Create: `src-tauri/src/git/cli.rs`

- [ ] **Step 1: Write a stub CLI backend**

Create `src-tauri/src/git/cli.rs`:

```rust
use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};

use super::{
    types::{
        BranchInfo, CommitInfo, CommitOptions, DiffHunks, DiffKind, FileStatus, RepoHandle,
        RepoId,
    },
    GitBackend,
};

/// Shells out to the `git` CLI for operations libgit2 handles poorly
/// (complex merges, LFS, credential helpers). Stub for now.
pub struct CliBackend;

impl CliBackend {
    pub fn new() -> Self { Self }
}

impl Default for CliBackend {
    fn default() -> Self { Self::new() }
}

impl GitBackend for CliBackend {
    fn open(&self, _path: &Path) -> AppResult<RepoHandle> { Err(AppError::NotImplemented) }
    fn status(&self, _repo_id: &RepoId) -> AppResult<Vec<FileStatus>> { Err(AppError::NotImplemented) }
    fn log(&self, _repo_id: &RepoId, _limit: usize) -> AppResult<Vec<CommitInfo>> { Err(AppError::NotImplemented) }
    fn diff(&self, _repo_id: &RepoId, _path: &Path, _kind: DiffKind) -> AppResult<DiffHunks> { Err(AppError::NotImplemented) }
    fn stage(&self, _repo_id: &RepoId, _paths: &[PathBuf]) -> AppResult<()> { Err(AppError::NotImplemented) }
    fn unstage(&self, _repo_id: &RepoId, _paths: &[PathBuf]) -> AppResult<()> { Err(AppError::NotImplemented) }
    fn commit(&self, _repo_id: &RepoId, _opts: CommitOptions) -> AppResult<String> { Err(AppError::NotImplemented) }
    fn branches(&self, _repo_id: &RepoId) -> AppResult<Vec<BranchInfo>> { Err(AppError::NotImplemented) }
    fn checkout_branch(&self, _repo_id: &RepoId, _name: &str) -> AppResult<()> { Err(AppError::NotImplemented) }
    fn create_branch(&self, _repo_id: &RepoId, _name: &str, _from: Option<&str>) -> AppResult<()> { Err(AppError::NotImplemented) }
    fn fetch(&self, _repo_id: &RepoId, _remote: &str) -> AppResult<()> { Err(AppError::NotImplemented) }
    fn pull(&self, _repo_id: &RepoId, _remote: &str, _branch: &str) -> AppResult<()> { Err(AppError::NotImplemented) }
    fn push(&self, _repo_id: &RepoId, _remote: &str, _branch: &str) -> AppResult<()> { Err(AppError::NotImplemented) }
}
```

- [ ] **Step 2: Verify compile**

```bash
cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -10
```

Expected: compiles cleanly. If errors: check that `git/mod.rs` exports all types referenced here.

- [ ] **Step 3: Commit (git trait + both backends together)**

```bash
git add src-tauri/src/git/mod.rs src-tauri/src/git/libgit2.rs src-tauri/src/git/cli.rs
git commit -m "feat: GitBackend trait + libgit2 impl (open, status) + CLI stub

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: AppState

**Files:**
- Create: `src-tauri/src/state.rs`

- [ ] **Step 1: Write the app state module**

Create `src-tauri/src/state.rs`:

```rust
use std::sync::Arc;

use crate::git::GitBackend;

pub struct AppState {
    pub backend: Arc<dyn GitBackend>,
}

impl AppState {
    pub fn new(backend: Arc<dyn GitBackend>) -> Self {
        Self { backend }
    }
}
```

- [ ] **Step 2: Register in lib.rs**

Add `pub mod state;` to `src-tauri/src/lib.rs` (after `pub mod git;`).

- [ ] **Step 3: Verify compile**

```bash
cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -5
```

Expected: compiles cleanly.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/state.rs src-tauri/src/lib.rs
git commit -m "feat: AppState holding shared GitBackend

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Commands module — repo

**Files:**
- Create: `src-tauri/src/commands/mod.rs`
- Create: `src-tauri/src/commands/repo.rs`

- [ ] **Step 1: Create commands/mod.rs**

Create `src-tauri/src/commands/mod.rs`:

```rust
pub mod repo;
pub mod commits;
pub mod diff;
pub mod branches;
```

- [ ] **Step 2: Create commands/repo.rs**

```rust
use std::path::PathBuf;

use tauri::State;

use crate::{
    error::AppResult,
    git::types::{FileStatus, RepoHandle, RepoId},
    state::AppState,
};

#[tauri::command]
pub async fn open_repo(
    state: State<'_, AppState>,
    path: String,
) -> AppResult<RepoHandle> {
    let backend = state.backend.clone();
    let path_buf = PathBuf::from(path);
    tokio::task::spawn_blocking(move || backend.open(&path_buf))
        .await
        .map_err(|e| crate::error::AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn get_status(
    state: State<'_, AppState>,
    repo_id: String,
) -> AppResult<Vec<FileStatus>> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.status(&repo_id))
        .await
        .map_err(|e| crate::error::AppError::Internal(e.to_string()))?
}
```

- [ ] **Step 3: Skip verify — still need stubs for other command modules**

---

## Task 11: Command stubs — commits, diff, branches

**Files:**
- Create: `src-tauri/src/commands/commits.rs`
- Create: `src-tauri/src/commands/diff.rs`
- Create: `src-tauri/src/commands/branches.rs`

- [ ] **Step 1: commits.rs**

```rust
use tauri::State;

use crate::{
    error::{AppError, AppResult},
    git::types::CommitInfo,
    state::AppState,
};

#[tauri::command]
pub async fn get_log(
    _state: State<'_, AppState>,
    _repo_id: String,
    _limit: usize,
) -> AppResult<Vec<CommitInfo>> {
    Err(AppError::NotImplemented)
}

#[tauri::command]
pub async fn commit(
    _state: State<'_, AppState>,
    _repo_id: String,
    _message: String,
    _amend: bool,
) -> AppResult<String> {
    Err(AppError::NotImplemented)
}
```

- [ ] **Step 2: diff.rs**

```rust
use tauri::State;

use crate::{
    error::{AppError, AppResult},
    git::types::{DiffHunks, DiffKind},
    state::AppState,
};

#[tauri::command]
pub async fn get_diff(
    _state: State<'_, AppState>,
    _repo_id: String,
    _path: String,
    _kind: DiffKind,
) -> AppResult<DiffHunks> {
    Err(AppError::NotImplemented)
}

#[tauri::command]
pub async fn stage_paths(
    _state: State<'_, AppState>,
    _repo_id: String,
    _paths: Vec<String>,
) -> AppResult<()> {
    Err(AppError::NotImplemented)
}

#[tauri::command]
pub async fn unstage_paths(
    _state: State<'_, AppState>,
    _repo_id: String,
    _paths: Vec<String>,
) -> AppResult<()> {
    Err(AppError::NotImplemented)
}
```

- [ ] **Step 3: branches.rs**

```rust
use tauri::State;

use crate::{
    error::{AppError, AppResult},
    git::types::BranchInfo,
    state::AppState,
};

#[tauri::command]
pub async fn list_branches(
    _state: State<'_, AppState>,
    _repo_id: String,
) -> AppResult<Vec<BranchInfo>> {
    Err(AppError::NotImplemented)
}

#[tauri::command]
pub async fn checkout_branch(
    _state: State<'_, AppState>,
    _repo_id: String,
    _name: String,
) -> AppResult<()> {
    Err(AppError::NotImplemented)
}

#[tauri::command]
pub async fn create_branch(
    _state: State<'_, AppState>,
    _repo_id: String,
    _name: String,
    _from: Option<String>,
) -> AppResult<()> {
    Err(AppError::NotImplemented)
}

#[tauri::command]
pub async fn fetch(
    _state: State<'_, AppState>,
    _repo_id: String,
    _remote: String,
) -> AppResult<()> {
    Err(AppError::NotImplemented)
}

#[tauri::command]
pub async fn pull(
    _state: State<'_, AppState>,
    _repo_id: String,
    _remote: String,
    _branch: String,
) -> AppResult<()> {
    Err(AppError::NotImplemented)
}

#[tauri::command]
pub async fn push(
    _state: State<'_, AppState>,
    _repo_id: String,
    _remote: String,
    _branch: String,
) -> AppResult<()> {
    Err(AppError::NotImplemented)
}
```

- [ ] **Step 4: Register commands module in lib.rs**

Add `pub mod commands;` to `src-tauri/src/lib.rs` after `pub mod state;`.

- [ ] **Step 5: Verify compile**

```bash
cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -10
```

Expected: compiles cleanly.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands src-tauri/src/lib.rs
git commit -m "feat: Tauri command handlers (repo real, others NotImplemented)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Wire everything in lib.rs + main.rs

**Files:**
- Replace: `src-tauri/src/lib.rs`
- Replace: `src-tauri/src/main.rs`

- [ ] **Step 1: Replace lib.rs**

```rust
pub mod commands;
pub mod error;
pub mod git;
pub mod state;

use std::sync::Arc;

use crate::{git::libgit2::Libgit2Backend, state::AppState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let backend = Arc::new(Libgit2Backend::new());

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::new(backend))
        .invoke_handler(tauri::generate_handler![
            commands::repo::open_repo,
            commands::repo::get_status,
            commands::commits::get_log,
            commands::commits::commit,
            commands::diff::get_diff,
            commands::diff::stage_paths,
            commands::diff::unstage_paths,
            commands::branches::list_branches,
            commands::branches::checkout_branch,
            commands::branches::create_branch,
            commands::branches::fetch,
            commands::branches::pull,
            commands::branches::push,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 2: Replace main.rs**

```rust
// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    platypusgit_lib::run();
}
```

Note: the lib crate name depends on `src-tauri/Cargo.toml` `[lib] name` — the template defaults to `<package_name>_lib`. Verify with:

```bash
grep -A1 '^\[lib\]' src-tauri/Cargo.toml
```

If `name = "platypusgit_lib"` — good. If different, adjust `main.rs` to match.

- [ ] **Step 3: Verify compile**

```bash
cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -10
```

Expected: compiles cleanly.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/src/main.rs
git commit -m "feat: wire AppState, dialog plugin, command handlers

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Tauri permissions — allow dialog

**Files:**
- Modify: `src-tauri/capabilities/default.json`

- [ ] **Step 1: Update the default capability**

Replace `src-tauri/capabilities/default.json` with:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Default permissions for platypusgit",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "dialog:default",
    "dialog:allow-open"
  ]
}
```

- [ ] **Step 2: Verify compile (permissions are validated at build time)**

```bash
cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -5
```

Expected: compiles cleanly. Permission file errors appear here.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/capabilities/default.json
git commit -m "feat: allow dialog plugin permissions

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: Bundle config for all 3 platforms

**Files:**
- Modify: `src-tauri/tauri.conf.json`

- [ ] **Step 1: Read current tauri.conf.json**

```bash
cat src-tauri/tauri.conf.json
```

Note the template's version of top-level keys: `productName`, `version`, `identifier`, `build`, `app.windows[0]`, `bundle`.

- [ ] **Step 2: Update bundle and window sections**

Replace `src-tauri/tauri.conf.json` entirely with:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "platypusgit",
  "version": "0.1.0",
  "identifier": "com.platypusgit.app",
  "build": {
    "beforeDevCommand": "pnpm dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "pnpm build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "title": "platypusgit",
        "width": 1200,
        "height": 800,
        "minWidth": 800,
        "minHeight": 600,
        "resizable": true,
        "fullscreen": false
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": ["msi", "dmg", "deb", "appimage"],
    "category": "DeveloperTool",
    "shortDescription": "A developer-focused git client",
    "longDescription": "platypusgit — a cross-platform, developer-focused git client.",
    "copyright": "Copyright (c) 2026 Jonas Aasberg",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ],
    "macOS": {
      "minimumSystemVersion": "10.15",
      "dmg": {
        "appPosition": { "x": 180, "y": 170 },
        "applicationFolderPosition": { "x": 480, "y": 170 },
        "windowSize": { "width": 660, "height": 400 }
      }
    },
    "windows": {
      "wix": {
        "language": ["en-US"]
      }
    },
    "linux": {
      "deb": {
        "depends": []
      },
      "appimage": {
        "bundleMediaFramework": false
      }
    }
  }
}
```

Note: `identifier` — TODO, user will finalize. Keep the inline comment below for future reference (JSON doesn't support comments, so note lives in the spec).

- [ ] **Step 3: Verify config**

```bash
cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -5
```

Expected: compiles. Tauri validates the config at build time.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/tauri.conf.json
git commit -m "feat: bundle config for msi, dmg, deb, appimage

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: Frontend runtime deps

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install runtime deps**

```bash
pnpm add @tauri-apps/plugin-dialog@^2 zustand@^5 lucide-react@^0.400
```

Expected: three packages added to `dependencies`.

- [ ] **Step 2: Verify install**

```bash
pnpm list --depth 0 | grep -E 'zustand|lucide|dialog'
```

Expected: all three listed.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "feat: add zustand, lucide-react, dialog plugin

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 16: Frontend shared types + error module

**Files:**
- Create: `src/lib/types.ts`
- Create: `src/lib/errors.ts`

- [ ] **Step 1: Create src/lib/types.ts**

```ts
export type RepoId = string;

export interface RepoHandle {
  id: RepoId;
  path: string;
  head: string | null;
}

export type StatusFlag =
  | { kind: "Unmodified" }
  | { kind: "Modified" }
  | { kind: "Added" }
  | { kind: "Deleted" }
  | { kind: "Renamed" }
  | { kind: "Typechange" }
  | { kind: "Untracked" }
  | { kind: "Ignored" }
  | { kind: "Conflicted" };

export interface FileStatus {
  path: string;
  worktree: StatusFlag;
  index: StatusFlag;
}
```

- [ ] **Step 2: Create src/lib/errors.ts**

```ts
export type AppError =
  | { kind: "NotARepo"; message: string }
  | { kind: "UnknownRepo"; message: string }
  | { kind: "InvalidPath"; message: string }
  | { kind: "Io"; message: string }
  | { kind: "Git"; message: string }
  | { kind: "NotImplemented"; message?: string }
  | { kind: "Internal"; message: string };

export function isAppError(e: unknown): e is AppError {
  return (
    typeof e === "object" &&
    e !== null &&
    "kind" in e &&
    typeof (e as { kind: unknown }).kind === "string"
  );
}

export function appErrorMessage(e: unknown): string {
  if (isAppError(e)) {
    return e.message ?? e.kind;
  }
  if (e instanceof Error) return e.message;
  return String(e);
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/types.ts src/lib/errors.ts
git commit -m "feat: frontend shared types + AppError discriminated union

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 17: Frontend IPC wrapper

**Files:**
- Create: `src/lib/tauri.ts`

- [ ] **Step 1: Write typed invoke wrappers**

```ts
import { invoke } from "@tauri-apps/api/core";
import type { FileStatus, RepoHandle } from "./types";

export async function openRepo(path: string): Promise<RepoHandle> {
  return invoke<RepoHandle>("open_repo", { path });
}

export async function getStatus(repoId: string): Promise<FileStatus[]> {
  return invoke<FileStatus[]>("get_status", { repoId });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/tauri.ts
git commit -m "feat: typed invoke() wrappers for open_repo and get_status

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 18: Zustand repo store

**Files:**
- Create: `src/features/repo/useRepoStore.ts`

- [ ] **Step 1: Write the store**

```ts
import { create } from "zustand";
import type { FileStatus, RepoHandle } from "@/lib/types";
import type { AppError } from "@/lib/errors";
import { getStatus, openRepo } from "@/lib/tauri";
import { isAppError } from "@/lib/errors";

interface RepoState {
  current: RepoHandle | null;
  status: FileStatus[];
  loading: boolean;
  error: AppError | null;
  openRepo: (path: string) => Promise<void>;
  refreshStatus: () => Promise<void>;
  clearError: () => void;
}

export const useRepoStore = create<RepoState>((set, get) => ({
  current: null,
  status: [],
  loading: false,
  error: null,

  async openRepo(path: string) {
    set({ loading: true, error: null });
    try {
      const handle = await openRepo(path);
      set({ current: handle });
      const status = await getStatus(handle.id);
      set({ status, loading: false });
    } catch (e) {
      set({
        loading: false,
        error: isAppError(e)
          ? e
          : { kind: "Internal", message: String(e) },
      });
    }
  },

  async refreshStatus() {
    const repo = get().current;
    if (!repo) return;
    set({ loading: true, error: null });
    try {
      const status = await getStatus(repo.id);
      set({ status, loading: false });
    } catch (e) {
      set({
        loading: false,
        error: isAppError(e)
          ? e
          : { kind: "Internal", message: String(e) },
      });
    }
  },

  clearError() { set({ error: null }); },
}));
```

Note: this file uses `@/lib/*` path alias — needs TS + Vite config below.

- [ ] **Step 2: Add `@` path alias**

Edit `tsconfig.json` — add to `compilerOptions`:

```json
"baseUrl": ".",
"paths": { "@/*": ["src/*"] }
```

Full `tsconfig.json` after edit (preserve other generated keys; if template differs, merge):

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] }
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

Edit `vite.config.ts` — add to imports and config:

```ts
import path from "node:path";
// ...
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  clearScreen: false,
  server: { /* unchanged */ },
}));
```

Full vite.config.ts after edit:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 1421 }
      : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
}));
```

- [ ] **Step 3: Commit**

```bash
git add src/features/repo/useRepoStore.ts tsconfig.json vite.config.ts
git commit -m "feat: useRepoStore (Zustand) + @/ path alias

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 19: Button UI primitive

**Files:**
- Create: `src/components/ui/Button.tsx`

- [ ] **Step 1: Write a minimal button**

```tsx
import { forwardRef, type ButtonHTMLAttributes } from "react";

type Variant = "primary" | "ghost";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

const base =
  "inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

const variants: Record<Variant, string> = {
  primary:
    "bg-[var(--color-accent)] text-black hover:brightness-110 active:brightness-95",
  ghost:
    "bg-transparent text-[var(--color-text)] hover:bg-[var(--color-bg-elev)] border border-[var(--color-border)]",
};

export const Button = forwardRef<HTMLButtonElement, Props>(
  ({ variant = "primary", className = "", ...props }, ref) => (
    <button
      ref={ref}
      className={`${base} ${variants[variant]} ${className}`}
      {...props}
    />
  ),
);
Button.displayName = "Button";
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ui/Button.tsx
git commit -m "feat: Button primitive with primary/ghost variants

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 20: OpenRepoButton

**Files:**
- Create: `src/features/repo/OpenRepoButton.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useRepoStore } from "./useRepoStore";

export function OpenRepoButton() {
  const openRepo = useRepoStore((s) => s.openRepo);
  const loading = useRepoStore((s) => s.loading);

  async function handleClick() {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Open repository",
    });
    if (typeof selected === "string") {
      await openRepo(selected);
    }
  }

  return (
    <Button onClick={handleClick} disabled={loading}>
      <FolderOpen size={16} />
      {loading ? "Opening…" : "Open repository"}
    </Button>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/features/repo/OpenRepoButton.tsx
git commit -m "feat: OpenRepoButton triggers folder picker + store update

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 21: StatusList

**Files:**
- Create: `src/features/repo/StatusList.tsx`

- [ ] **Step 1: Write the component**

```tsx
import {
  CircleAlert, CircleDot, FileDiff, FileMinus, FilePlus,
  FileQuestion, FileX, HelpCircle, ArrowRightLeft,
} from "lucide-react";
import type { ComponentType } from "react";
import type { FileStatus, StatusFlag } from "@/lib/types";
import { useRepoStore } from "./useRepoStore";

type IconC = ComponentType<{ size?: number; className?: string }>;

const FLAG_META: Record<StatusFlag["kind"], { icon: IconC; label: string; color: string }> = {
  Unmodified:  { icon: CircleDot,      label: "unmodified", color: "text-[var(--color-text-dim)]" },
  Modified:    { icon: FileDiff,       label: "modified",   color: "text-yellow-400" },
  Added:       { icon: FilePlus,       label: "added",      color: "text-green-400" },
  Deleted:     { icon: FileMinus,      label: "deleted",    color: "text-red-400" },
  Renamed:     { icon: ArrowRightLeft, label: "renamed",    color: "text-blue-400" },
  Typechange:  { icon: HelpCircle,     label: "typechange", color: "text-purple-400" },
  Untracked:   { icon: FileQuestion,   label: "untracked",  color: "text-[var(--color-accent)]" },
  Ignored:     { icon: FileX,          label: "ignored",    color: "text-[var(--color-text-dim)]" },
  Conflicted:  { icon: CircleAlert,    label: "conflicted", color: "text-red-500" },
};

function StatusRow({ entry }: { entry: FileStatus }) {
  const primary = entry.worktree.kind !== "Unmodified" ? entry.worktree : entry.index;
  const meta = FLAG_META[primary.kind];
  const Icon = meta.icon;
  return (
    <li className="flex items-center gap-3 px-3 py-1.5 border-b border-[var(--color-border)] text-sm hover:bg-[var(--color-bg-elev)]">
      <Icon size={14} className={meta.color} />
      <span className="font-mono text-[var(--color-text)] truncate flex-1">{entry.path}</span>
      <span className={`text-xs ${meta.color}`}>{meta.label}</span>
    </li>
  );
}

export function StatusList() {
  const status = useRepoStore((s) => s.status);
  const loading = useRepoStore((s) => s.loading);
  const current = useRepoStore((s) => s.current);

  if (!current) return null;

  if (loading && status.length === 0) {
    return <div className="p-4 text-[var(--color-text-dim)]">Loading…</div>;
  }

  if (status.length === 0) {
    return <div className="p-4 text-[var(--color-text-dim)]">Working tree clean.</div>;
  }

  return (
    <ul className="border border-[var(--color-border)] rounded-md overflow-hidden">
      {status.map((entry) => (
        <StatusRow key={entry.path} entry={entry} />
      ))}
    </ul>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/features/repo/StatusList.tsx
git commit -m "feat: StatusList renders working-tree + index status

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 22: App shell + entrypoint

**Files:**
- Replace: `src/App.tsx`
- Replace: `src/main.tsx`
- Modify: `index.html` (title)
- Create: `src/store.ts`
- Create: `src/features/commits/.gitkeep`
- Create: `src/features/diff/.gitkeep`
- Create: `src/features/branches/.gitkeep`

- [ ] **Step 1: Replace src/App.tsx**

```tsx
import { GitBranch } from "lucide-react";
import { OpenRepoButton } from "@/features/repo/OpenRepoButton";
import { StatusList } from "@/features/repo/StatusList";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { appErrorMessage } from "@/lib/errors";

export default function App() {
  const current = useRepoStore((s) => s.current);
  const error = useRepoStore((s) => s.error);
  const clearError = useRepoStore((s) => s.clearError);

  return (
    <div className="min-h-full flex flex-col">
      <header className="flex items-center gap-3 px-4 py-3 border-b border-[var(--color-border)]">
        <GitBranch size={18} className="text-[var(--color-accent)]" />
        <span className="font-semibold">platypusgit</span>
        <span className="text-[var(--color-text-dim)] text-sm font-mono truncate flex-1">
          {current?.path ?? "no repository open"}
        </span>
        <OpenRepoButton />
      </header>

      <main className="flex-1 p-4 overflow-auto">
        {error && (
          <div
            className="mb-3 px-3 py-2 rounded-md border border-red-500/40 bg-red-500/10 text-red-200 text-sm flex items-center justify-between"
            role="alert"
          >
            <span>
              <strong>{error.kind}:</strong> {appErrorMessage(error)}
            </span>
            <button
              className="text-red-200/70 hover:text-red-100 text-xs"
              onClick={clearError}
            >
              dismiss
            </button>
          </div>
        )}

        {!current && !error && (
          <div className="flex items-center justify-center h-full text-[var(--color-text-dim)]">
            Open a repository to get started.
          </div>
        )}

        {current && <StatusList />}
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Replace src/main.tsx**

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 3: Update index.html title**

Change the `<title>` tag in `index.html` to:

```html
<title>platypusgit</title>
```

(Leave other generated content as-is.)

- [ ] **Step 4: Create src/store.ts (re-export hub)**

```ts
export { useRepoStore } from "@/features/repo/useRepoStore";
```

- [ ] **Step 5: Create feature stub folders**

```bash
mkdir -p src/features/commits src/features/diff src/features/branches
touch src/features/commits/.gitkeep src/features/diff/.gitkeep src/features/branches/.gitkeep
```

- [ ] **Step 6: Verify TS compile**

```bash
pnpm tsc --noEmit 2>&1 | tail -20
```

Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx src/main.tsx src/store.ts src/features index.html
git commit -m "feat: App shell with header, empty state, error banner, status list

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 23: Full verification (user choice C)

- [ ] **Step 1: Clean install**

```bash
pnpm install
```

Expected: completes without errors.

- [ ] **Step 2: Cargo check**

```bash
cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -10
```

Expected: no warnings/errors.

- [ ] **Step 3: TypeScript compile**

```bash
pnpm tsc --noEmit 2>&1 | tail -10
```

Expected: zero errors.

- [ ] **Step 4: Launch tauri dev (background)**

```bash
pnpm tauri dev > /tmp/tauri-dev.log 2>&1 &
```

Monitor log for "App listening" / window-open messages. First build can take 2-10 minutes on macOS.

- [ ] **Step 5: Smoke test the vertical slice**

Once the window is open:
1. Click "Open repository"
2. In the native folder picker, choose `/Users/jonas/dev/fun/platypusgit` (this repo itself)
3. Confirm: header shows the path, main pane shows at least one row — and if the working tree is clean, the "Working tree clean." message.
4. Try opening a non-repo directory (e.g. `/tmp`): red `NotARepo` banner appears.

Capture the window visually (screenshot or describe contents) before declaring success.

- [ ] **Step 6: Stop the dev process**

```bash
pkill -f 'tauri dev' || true
```

- [ ] **Step 7: Final commit (lockfile drift if any)**

```bash
git status
git add -A
git diff --cached --stat
# If anything to commit:
git commit -m "chore: final lockfile/formatting from verification run

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>" || true
```

---

## Self-review

- **Spec coverage:** every section of the spec maps to at least one task (directory layout: T1–T22, Rust backend: T4–T12, frontend: T15–T22, Tauri config: T13–T14, verification: T23). ✓
- **Placeholders:** none. Every code block is complete. `com.platypusgit.app` is a known placeholder per user request, tracked in the spec. ✓
- **Type consistency:** `RepoId` is `string` on TS side and newtype on Rust side (serialized as string via `#[serde(transparent)]`). `StatusFlag` variants match (9 variants, same names). Command names match `open_repo` / `get_status` in Rust and `openRepo` / `getStatus` TS wrappers (Tauri does camelCase↔snake_case automatically). ✓
