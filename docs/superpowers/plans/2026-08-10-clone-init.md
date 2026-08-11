# Clone & Init Repository Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user clone a repository from a URL (with live progress) and initialize a new one, from the Welcome screen, the command palette, or the keymap.

**Architecture:** `init` joins the `GitBackend` trait next to `open` (path in, `RepoHandle` out, no `RepoId`). `clone` stays outside the trait in a new `commands/create.rs`, shelling out to real `git` through a streaming sibling of `run_git` that parses `--progress` stderr into `clone://progress` events. Frontend gets two modals built on a `PGModal` promoted out of `ReflogActionDialog`.

**Tech Stack:** Rust + Tauri 2 + git2 (libgit2) backend; React 18 + TypeScript + Zustand frontend; vitest + React Testing Library; WebdriverIO for e2e.

**Spec:** `docs/superpowers/specs/2026-08-10-clone-init-design.md`

## Global Constraints

- **Worktree:** all work happens in `.claude/worktrees/clone-init` on branch `feat/clone-init`. Never commit to `main`.
- **PATH:** the Bash tool does not inherit the interactive shell rc. Prepend `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"` before any `pnpm` or `cargo` command.
- **Auth policy:** clone inherits the prompt-less env used by every existing network op — `GIT_TERMINAL_PROMPT=0`, `GIT_ASKPASS=true`, `SSH_ASKPASS=true`. Do NOT add interactive credential entry.
- **No new `AppError` variants.** Clone failures → `AppError::Network`; validation failures → `AppError::InvalidPath`. `src/lib/errors.ts` stays unchanged.
- **Serde:** every Rust type crossing IPC derives `Serialize` with `#[serde(rename_all = "camelCase")]`. `src/lib/types.ts` stays 1:1 with `src-tauri/src/git/types.rs` **in the same commit**.
- **Frontend never calls `invoke()` directly** — always through a typed wrapper in `src/lib/tauri.ts`.
- **libgit2 is sync.** Every git2 call from a Tauri command is wrapped in `tokio::task::spawn_blocking`.
- **Design system imports come from `@/design`**, never per-file. New primitives are re-exported through `src/design/index.ts`.
- **No cancellation.** Out of scope; the clone dialog is non-dismissable while running.
- **Commit style:** Conventional Commits, imperative subject under 72 chars, trailing `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

---

## File Structure

**Backend — create:**
- `src-tauri/src/commands/create.rs` — `init_repo`, `default_init_branch`, `clone_repo` commands; `run_git_streaming`; `parse_progress`; destination validation.
- `src-tauri/tests/clone_init.rs` — integration tests for init + clone.

**Backend — modify:**
- `src-tauri/src/git/mod.rs` — add `init` to the `GitBackend` trait.
- `src-tauri/src/git/libgit2.rs` — implement `init`; add `default_branch_name`.
- `src-tauri/src/git/cli.rs` — `NotImplemented` stub for `init`.
- `src-tauri/src/git/types.rs` — `CloneProgress`, `CloneOptions`.
- `src-tauri/src/commands/mod.rs` — `pub mod create;`.
- `src-tauri/src/lib.rs` — register the three new commands.

**Frontend — create:**
- `src/design/modal.tsx` — `PGModal`.
- `src/features/create/useCreateStore.ts` — dialog state, form state, progress, error.
- `src/features/create/deriveRepoName.ts` + `.test.ts` — URL → folder name.
- `src/features/create/CloneDialog.tsx` + `.test.tsx`.
- `src/features/create/InitDialog.tsx` + `.test.tsx`.
- `e2e/specs/create.e2e.ts`.

**Frontend — modify:**
- `src/design/index.ts` — export `./modal`.
- `src/features/reflog/ReflogActionDialog.tsx`, `src/features/reflog/DirtyTreeDialog.tsx` — adopt `PGModal`.
- `src/lib/types.ts`, `src/lib/tauri.ts` — types + wrappers.
- `src/screens/Welcome.tsx` — two buttons.
- `src/AppShell.tsx` — mount the dialogs.
- `src/features/palette/commands.ts` — two palette commands.
- `src/features/keymap/actions.ts`, `presets.ts` — two actions + bindings.
- `src/features/repo/ops.ts` — keymap runner ops.
- `src/features/settings/useSettingsStore.ts` — `lastCreateDir`.

---

### Task 1: Clone progress parsing

Pure function, no process, no repo. Doing it first means the streaming runner in Task 4 has something tested to call.

**Files:**
- Create: `src-tauri/src/commands/create.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/git/types.rs`

**Interfaces:**
- Consumes: nothing.
- Produces: `pub struct CloneProgress { pub phase: String, pub percent: u8 }` (in `git/types.rs`); `pub fn parse_progress(line: &str) -> Option<CloneProgress>` (in `commands/create.rs`).

- [ ] **Step 1: Add the wire type**

In `src-tauri/src/git/types.rs`, at the end of the file:

```rust
/// One progress tick from `git clone --progress`, as emitted on
/// `clone://progress`. `phase` is git's own label ("Receiving objects"),
/// `percent` is 0–100.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloneProgress {
    pub phase: String,
    pub percent: u8,
}
```

- [ ] **Step 2: Create the module with a failing test**

Create `src-tauri/src/commands/create.rs`:

```rust
use crate::git::types::CloneProgress;

/// Parse one stderr line from `git clone --progress`.
///
/// Git writes progress as `Receiving objects:  62% (620/1000)`, separated by
/// carriage returns rather than newlines, and interleaves non-progress chatter
/// ("Cloning into 'foo'...", "remote: Enumerating objects: 1000, done.").
/// Unrecognized lines return `None` — a guess here would render a bogus bar.
pub fn parse_progress(line: &str) -> Option<CloneProgress> {
    let line = line.trim();
    let (phase, rest) = line.split_once(':')?;
    let phase = phase.trim();
    if phase.is_empty() || phase.contains(' ') && phase.starts_with("remote") {
        return None;
    }
    let percent_token = rest.trim().split('%').next()?.trim();
    let percent: u8 = percent_token.parse().ok()?;
    if percent > 100 {
        return None;
    }
    Some(CloneProgress {
        phase: phase.to_string(),
        percent,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_receiving_objects_line() {
        assert_eq!(
            parse_progress("Receiving objects:  62% (620/1000)"),
            Some(CloneProgress { phase: "Receiving objects".into(), percent: 62 })
        );
    }

    #[test]
    fn parses_every_phase_git_reports() {
        for (line, phase, pct) in [
            ("Counting objects: 100% (10/10), done.", "Counting objects", 100),
            ("Compressing objects:   5% (1/20)", "Compressing objects", 5),
            ("Resolving deltas: 100% (3/3), done.", "Resolving deltas", 100),
        ] {
            assert_eq!(
                parse_progress(line),
                Some(CloneProgress { phase: phase.into(), percent: pct }),
                "failed on {line}"
            );
        }
    }

    #[test]
    fn ignores_lines_that_are_not_progress() {
        for line in [
            "Cloning into 'foo'...",
            "remote: Enumerating objects: 1000, done.",
            "",
            "warning: redirecting to https://example.com/repo.git/",
            "fatal: repository 'https://example.com/nope.git/' not found",
        ] {
            assert_eq!(parse_progress(line), None, "should ignore {line}");
        }
    }
}
```

Register the module — in `src-tauri/src/commands/mod.rs`, add in alphabetical position (after `pub mod commits;`):

```rust
pub mod create;
```

- [ ] **Step 3: Run the tests and watch them fail**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo test --manifest-path src-tauri/Cargo.toml parse_progress
```

Expected: `ignores_lines_that_are_not_progress` FAILS on `remote: Enumerating objects: 1000, done.` — that line splits to phase `remote`, and `Enumerating objects: 1000, done.` has no `%`, so `percent_token.parse()` should reject it. Confirm which assertions fail before changing anything; the point of this step is to see the guard actually exercised rather than trust it.

- [ ] **Step 4: Fix the parser until all three tests pass**

The `phase.contains(' ') && phase.starts_with("remote")` condition is wrong — `remote` has no space, so it never fires. Replace the guard:

```rust
    if phase.is_empty() || phase == "remote" || phase == "fatal" || phase == "warning" {
        return None;
    }
```

- [ ] **Step 5: Run the tests and verify they pass**

```bash
cargo test --manifest-path src-tauri/Cargo.toml parse_progress
```

Expected: 3 passed, 0 failed.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/create.rs src-tauri/src/commands/mod.rs src-tauri/src/git/types.rs
git commit -m "feat(clone): parse git clone --progress lines

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `init` on the GitBackend trait

**Files:**
- Modify: `src-tauri/src/git/mod.rs:17` (next to `open`)
- Modify: `src-tauri/src/git/libgit2.rs`
- Modify: `src-tauri/src/git/cli.rs`
- Create: `src-tauri/tests/clone_init.rs`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `fn init(&self, path: &Path, initial_branch: Option<&str>) -> AppResult<RepoHandle>` on `GitBackend`; `fn default_branch_name() -> String` (free function in `libgit2.rs`, `pub` so commands can call it).

- [ ] **Step 1: Write the failing tests**

Create `src-tauri/tests/clone_init.rs`:

```rust
mod support;

use platypusgit_lib::error::AppError;
use platypusgit_lib::git::{libgit2::Libgit2Backend, GitBackend};

use support::TempRepo;

#[test]
fn init_creates_a_repo_on_the_requested_branch() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("fresh");
    let backend = Libgit2Backend::new();

    let handle = backend.init(&target, Some("trunk")).expect("init");

    assert_eq!(handle.path, target);
    let repo = git2::Repository::open(&target).expect("the new repo opens");
    // HEAD is unborn until the first commit, so read the symbolic target.
    assert_eq!(
        repo.find_reference("HEAD").unwrap().symbolic_target().unwrap(),
        "refs/heads/trunk"
    );
}

#[test]
fn init_defaults_to_main_when_no_branch_is_given() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("fresh");
    let backend = Libgit2Backend::new();

    backend.init(&target, None).expect("init");

    let repo = git2::Repository::open(&target).unwrap();
    assert_eq!(
        repo.find_reference("HEAD").unwrap().symbolic_target().unwrap(),
        "refs/heads/main"
    );
}

#[test]
fn init_creates_missing_parent_directories() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("a/b/fresh");
    let backend = Libgit2Backend::new();

    backend.init(&target, None).expect("init");

    assert!(target.join(".git").exists());
}

#[test]
fn init_refuses_a_directory_that_is_already_a_repo() {
    // Re-initializing silently reuses the existing repo, which looks like
    // success while doing nothing — and would drop the user into a repo they
    // did not think they were creating.
    let tr = TempRepo::with_initial_commit("hello\n");
    let backend = Libgit2Backend::new();

    let err = backend.init(tr.path(), None).unwrap_err();

    assert!(matches!(err, AppError::InvalidPath(_)), "got {err:?}");
}

#[test]
fn the_handle_init_returns_is_usable() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("fresh");
    let backend = Libgit2Backend::new();

    let handle = backend.init(&target, None).expect("init");

    // The handle must be registered in the backend's repo map, not just
    // returned — otherwise the very next call 404s with UnknownRepo.
    assert!(backend.status(&handle.id).is_ok());
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo test --manifest-path src-tauri/Cargo.toml --test clone_init
```

Expected: compile error — `no method named 'init' found for struct 'Libgit2Backend'`.

- [ ] **Step 3: Add the trait method**

In `src-tauri/src/git/mod.rs`, immediately after the `open` declaration on line 17:

```rust
    /// Create a new repository at `path` and register it, returning its handle.
    ///
    /// Shaped like `open` rather than the `repo_id` methods below: there is no
    /// repository to address yet. `initial_branch` overrides the configured
    /// default; `None` resolves `init.defaultBranch`, falling back to `main`.
    fn init(&self, path: &Path, initial_branch: Option<&str>) -> AppResult<RepoHandle>;
```

- [ ] **Step 4: Implement it in Libgit2Backend**

In `src-tauri/src/git/libgit2.rs`, add this free function next to the other helpers (above the `impl GitBackend for Libgit2Backend` block):

```rust
/// The branch name a fresh repository should start on: the user's
/// `init.defaultBranch` if they set one, otherwise `main`.
///
/// Reads the default config chain (global + system) rather than a repository's
/// config — there is no repository yet when this is called.
pub fn default_branch_name() -> String {
    git2::Config::open_default()
        .ok()
        .and_then(|cfg| cfg.get_string("init.defaultBranch").ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "main".to_string())
}
```

Then add the trait method inside `impl GitBackend for Libgit2Backend`, directly after `fn open`:

```rust
    fn init(&self, path: &Path, initial_branch: Option<&str>) -> AppResult<RepoHandle> {
        // `Repository::init` on an existing repo silently reopens it. That
        // reads as success while creating nothing, so refuse up front.
        if Repository::open(path).is_ok() {
            return Err(AppError::InvalidPath(format!(
                "{} is already a git repository",
                path.display()
            )));
        }
        std::fs::create_dir_all(path)
            .map_err(|e| AppError::Io(format!("failed to create {}: {e}", path.display())))?;

        let branch = match initial_branch {
            Some(b) if !b.trim().is_empty() => b.trim().to_string(),
            _ => default_branch_name(),
        };
        let mut opts = git2::RepositoryInitOptions::new();
        opts.initial_head(&branch).mkdir(false);
        Repository::init_opts(path, &opts)?;

        // Go through `open` so the repo lands in the backend's map with a real
        // RepoId — a handle that isn't registered 404s on the next call.
        self.open(path)
    }
```

- [ ] **Step 5: Add the CliBackend stub**

In `src-tauri/src/git/cli.rs`, directly after the `open` stub:

```rust
    fn init(&self, _path: &Path, _initial_branch: Option<&str>) -> AppResult<RepoHandle> {
        Err(AppError::NotImplemented)
    }
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test clone_init
```

Expected: 5 passed, 0 failed.

If `init_defaults_to_main_when_no_branch_is_given` fails on a machine whose git config sets `init.defaultBranch` to something else, that is the test catching real environment leakage — the assertion is about the fallback. Change the test to assert against `default_branch_name()`'s own result rather than hardcoding `main`, and keep the hardcoded `main` assertion only in a case that clears the config.

- [ ] **Step 7: Verify nothing else broke**

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: all tests pass (191 existing + 5 new + 3 from Task 1).

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/git/mod.rs src-tauri/src/git/libgit2.rs src-tauri/src/git/cli.rs src-tauri/tests/clone_init.rs
git commit -m "feat(init): add init to GitBackend

Shaped like open — path in, RepoHandle out, no RepoId, since there is no
repository to address yet. Refuses an existing repo rather than silently
reopening it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Init commands

**Files:**
- Modify: `src-tauri/src/commands/create.rs`
- Modify: `src-tauri/src/lib.rs:102-142` (the `generate_handler!` list)

**Interfaces:**
- Consumes: `GitBackend::init` and `default_branch_name` from Task 2.
- Produces: Tauri commands `init_repo(path: String, initialBranch: Option<String>) -> RepoHandle` and `default_init_branch() -> String`.

- [ ] **Step 1: Add the commands**

At the top of `src-tauri/src/commands/create.rs`, replace the single `use` line with:

```rust
use std::path::PathBuf;

use tauri::State;

use crate::{
    error::{AppError, AppResult},
    git::libgit2::default_branch_name,
    git::types::{CloneProgress, RepoHandle},
    state::AppState,
};
```

Then add below `parse_progress` (but above the `#[cfg(test)] mod tests`):

```rust
/// The branch name the Init dialog should prefill.
#[tauri::command]
pub async fn default_init_branch() -> AppResult<String> {
    Ok(tokio::task::spawn_blocking(default_branch_name)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?)
}

#[tauri::command]
pub async fn init_repo(
    state: State<'_, AppState>,
    path: String,
    initial_branch: Option<String>,
) -> AppResult<RepoHandle> {
    let backend = state.backend.clone();
    let path_buf = PathBuf::from(path);
    tokio::task::spawn_blocking(move || backend.init(&path_buf, initial_branch.as_deref()))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}
```

- [ ] **Step 2: Register the commands**

In `src-tauri/src/lib.rs`, inside `generate_handler![…]`, after the `commands::commits::*` block:

```rust
            commands::create::init_repo,
            commands::create::default_init_branch,
```

- [ ] **Step 3: Verify it compiles**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: no errors, no warnings.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/create.rs src-tauri/src/lib.rs
git commit -m "feat(init): init_repo and default_init_branch commands

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Streaming clone

**Files:**
- Modify: `src-tauri/src/commands/create.rs`
- Modify: `src-tauri/src/git/types.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/tests/clone_init.rs`

**Interfaces:**
- Consumes: `parse_progress` (Task 1).
- Produces: Tauri command `clone_repo(url: String, parentDir: String, name: String, recurseSubmodules: bool) -> String` (returns the destination path); `pub fn validate_clone_target(parent: &Path, name: &str) -> AppResult<PathBuf>`; `pub fn clone_args(url, name, recurse) -> Vec<String>`; event `clone://progress` carrying `CloneProgress`.

- [ ] **Step 1: Write the failing tests**

Append to `src-tauri/tests/clone_init.rs`:

```rust
use platypusgit_lib::commands::create::{clone_args, validate_clone_target};
use std::path::PathBuf;
use support::BareTempRepo;

#[test]
fn clone_args_are_shell_free_and_option_terminated() {
    let args = clone_args("https://example.com/repo.git", "repo", true);
    assert_eq!(
        args,
        vec![
            "clone".to_string(),
            "--progress".to_string(),
            "--recurse-submodules".to_string(),
            "--".to_string(),
            "https://example.com/repo.git".to_string(),
            "repo".to_string(),
        ]
    );

    let plain = clone_args("https://example.com/repo.git", "repo", false);
    assert!(!plain.contains(&"--recurse-submodules".to_string()));
    // `--` must come immediately before the URL, so a URL starting with a dash
    // can never be read as a flag.
    let dashdash = plain.iter().position(|a| a == "--").unwrap();
    assert_eq!(plain[dashdash + 1], "https://example.com/repo.git");
}

#[test]
fn validate_clone_target_accepts_an_absent_destination() {
    let dir = tempfile::tempdir().unwrap();
    let target = validate_clone_target(dir.path(), "repo").expect("absent target is fine");
    assert_eq!(target, dir.path().join("repo"));
}

#[test]
fn validate_clone_target_accepts_an_existing_empty_directory() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir(dir.path().join("repo")).unwrap();
    assert!(validate_clone_target(dir.path(), "repo").is_ok());
}

#[test]
fn validate_clone_target_rejects_a_non_empty_destination() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir(dir.path().join("repo")).unwrap();
    std::fs::write(dir.path().join("repo/keep.txt"), "mine\n").unwrap();

    let err = validate_clone_target(dir.path(), "repo").unwrap_err();

    assert!(matches!(err, AppError::InvalidPath(_)), "got {err:?}");
}

#[test]
fn validate_clone_target_rejects_names_that_escape_the_parent() {
    let dir = tempfile::tempdir().unwrap();
    for name in ["../escape", "/absolute", "", "a/b"] {
        let err = validate_clone_target(dir.path(), name).unwrap_err();
        assert!(matches!(err, AppError::InvalidPath(_)), "{name} should be rejected");
    }
}

#[tokio::test]
async fn clone_from_a_local_bare_repo_lands_the_files() {
    // No network, no credentials: a local bare repo exercises the whole real
    // path — spawn, stream stderr, exit status, destination handling.
    let bare = BareTempRepo::new();
    let source = TempRepo::with_initial_commit("hello\n");
    std::process::Command::new("git")
        .args(["remote", "add", "origin", bare.path.to_str().unwrap()])
        .current_dir(source.path())
        .status()
        .unwrap();
    std::process::Command::new("git")
        .args(["push", "origin", "HEAD:refs/heads/main"])
        .current_dir(source.path())
        .status()
        .unwrap();

    let dest_parent = tempfile::tempdir().unwrap();
    // No progress assertion here: a repo this small can legitimately finish
    // without git emitting a single progress line. Parsing is covered by the
    // parse_progress unit tests; this test is about the files landing.
    let dest = platypusgit_lib::commands::create::run_clone(
        bare.path.to_str().unwrap(),
        dest_parent.path(),
        "cloned",
        false,
        |_| {},
    )
    .await
    .expect("clone from a local bare repo");

    assert_eq!(dest, dest_parent.path().join("cloned"));
    assert_eq!(std::fs::read_to_string(dest.join("README.md")).unwrap(), "hello\n");
    // origin points back at the source
    let cloned = git2::Repository::open(&dest).unwrap();
    assert_eq!(
        cloned.find_remote("origin").unwrap().url().unwrap(),
        bare.path.to_str().unwrap()
    );
}

#[tokio::test]
async fn a_failed_clone_reports_git_stderr_and_leaves_nothing_behind() {
    let dest_parent = tempfile::tempdir().unwrap();
    let missing = dest_parent.path().join("no-such-source");

    let err = platypusgit_lib::commands::create::run_clone(
        missing.to_str().unwrap(),
        dest_parent.path(),
        "cloned",
        false,
        |_| {},
    )
    .await
    .unwrap_err();

    assert!(matches!(err, AppError::Network(_)), "got {err:?}");
    assert!(
        !dest_parent.path().join("cloned").exists(),
        "a failed clone must not leave a partial destination"
    );
}
```

`tokio::test` needs the macro available to integration tests. Check `src-tauri/Cargo.toml` for `tokio` under `[dev-dependencies]`; if it is only a normal dependency, add:

```toml
[dev-dependencies]
tokio = { version = "1", features = ["macros", "rt-multi-thread"] }
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo test --manifest-path src-tauri/Cargo.toml --test clone_init
```

Expected: compile error — `clone_args`, `validate_clone_target`, `run_clone` are not found.

- [ ] **Step 3: Implement validation and argument building**

Add to `src-tauri/src/commands/create.rs`:

```rust
use std::path::Path;

/// Resolve and check the clone destination.
///
/// `name` must be a single path segment: it is joined onto a directory the
/// user picked, and `Path::join` silently replaces the base when handed an
/// absolute path, so `/etc` as a "name" would otherwise clone into `/etc`.
pub fn validate_clone_target(parent: &Path, name: &str) -> AppResult<PathBuf> {
    let name = name.trim();
    if name.is_empty()
        || name.contains('/')
        || name.contains('\\')
        || name == "."
        || name == ".."
    {
        return Err(AppError::InvalidPath(format!(
            "'{name}' is not a valid folder name"
        )));
    }
    let target = parent.join(name);
    if target.exists() {
        if !target.is_dir() {
            return Err(AppError::InvalidPath(format!(
                "{} already exists and is not a directory",
                target.display()
            )));
        }
        let mut entries = std::fs::read_dir(&target)
            .map_err(|e| AppError::Io(format!("failed to read {}: {e}", target.display())))?;
        if entries.next().is_some() {
            return Err(AppError::InvalidPath(format!(
                "{} already exists and is not empty",
                target.display()
            )));
        }
    }
    Ok(target)
}

/// Build the `git clone` argument list.
///
/// `--` terminates option parsing before the URL, so a URL beginning with a
/// dash is treated as a URL rather than a flag. Nothing here is ever handed to
/// a shell — these become argv elements of a directly-spawned `git`.
pub fn clone_args(url: &str, name: &str, recurse_submodules: bool) -> Vec<String> {
    let mut args = vec!["clone".to_string(), "--progress".to_string()];
    if recurse_submodules {
        args.push("--recurse-submodules".to_string());
    }
    args.push("--".to_string());
    args.push(url.to_string());
    args.push(name.to_string());
    args
}
```

- [ ] **Step 4: Implement the streaming runner**

Add to `src-tauri/src/commands/create.rs`:

```rust
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

/// Spawn `git clone` in `parent`, streaming progress to `on_progress`.
///
/// Keeps `run_git`'s environment exactly (`commands/branches.rs`): prompts are
/// hard-disabled, so a private repo works only when the user's credential
/// helper or SSH agent answers without a TTY. Returns the destination path.
pub async fn run_clone(
    url: &str,
    parent: &Path,
    name: &str,
    recurse_submodules: bool,
    mut on_progress: impl FnMut(CloneProgress),
) -> AppResult<PathBuf> {
    let target = validate_clone_target(parent, name)?;
    let args = clone_args(url, name, recurse_submodules);

    let mut child = Command::new("git")
        .current_dir(parent)
        .args(&args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_ASKPASS", "true")
        .env("SSH_ASKPASS", "true")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| AppError::Io(format!("failed to run git clone: {e}")))?;

    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| AppError::Internal("git clone produced no stderr pipe".into()))?;

    // Git separates progress updates with \r, not \n, so split on both.
    let mut reader = BufReader::new(stderr);
    let mut buf = Vec::new();
    let mut tail: Vec<String> = Vec::new();
    loop {
        buf.clear();
        let read = reader
            .read_until(b'\n', &mut buf)
            .await
            .map_err(|e| AppError::Io(format!("reading git clone output: {e}")))?;
        if read == 0 {
            break;
        }
        let chunk = String::from_utf8_lossy(&buf).to_string();
        for line in chunk.split('\r') {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            match parse_progress(line) {
                Some(p) => on_progress(p),
                // Keep non-progress lines: git's failure message is in here,
                // and the exit status alone would say nothing useful.
                None => {
                    tail.push(line.to_string());
                    if tail.len() > 20 {
                        tail.remove(0);
                    }
                }
            }
        }
    }

    let status = child
        .wait()
        .await
        .map_err(|e| AppError::Io(format!("waiting for git clone: {e}")))?;
    if !status.success() {
        return Err(AppError::Network(tail.join("\n")));
    }
    Ok(target)
}
```

- [ ] **Step 5: Add the Tauri command**

Add to `src-tauri/src/commands/create.rs`:

```rust
use tauri::{AppHandle, Emitter};

/// Clone `url` into `parent_dir/name`, emitting `clone://progress` as it goes.
#[tauri::command]
pub async fn clone_repo(
    app: AppHandle,
    url: String,
    parent_dir: String,
    name: String,
    recurse_submodules: bool,
) -> AppResult<String> {
    let url = url.trim().to_string();
    if url.is_empty() {
        return Err(AppError::InvalidPath("no repository URL given".into()));
    }
    let parent = PathBuf::from(parent_dir);
    let dest = run_clone(&url, &parent, &name, recurse_submodules, |p| {
        // A dropped event only costs a progress tick, never the clone.
        let _ = app.emit("clone://progress", &p);
    })
    .await?;
    Ok(dest.to_string_lossy().to_string())
}
```

Register it in `src-tauri/src/lib.rs` next to the other two:

```rust
            commands::create::clone_repo,
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test clone_init
```

Expected: 11 passed, 0 failed.

- [ ] **Step 7: Run the whole Rust suite**

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: 0 failures. Do NOT pipe this through `tail` — a pipeline's exit code comes from the last command, so `cargo test | tail` reports success even when tests fail. Redirect to a file and grep instead.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/commands/create.rs src-tauri/src/lib.rs src-tauri/tests/clone_init.rs src-tauri/Cargo.toml
git commit -m "feat(clone): streaming git clone with progress events

Sibling of run_git that pipes stderr and parses --progress into
clone://progress events. Same hard-disabled prompt env as every other
network op; URL passed as argv after -- so it can never be read as a
flag, and never through a shell.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: TypeScript types and invoke wrappers

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/tauri.ts`

**Interfaces:**
- Consumes: the three commands from Tasks 3–4.
- Produces: `CloneProgress` type; `initRepo`, `defaultInitBranch`, `cloneRepo` wrappers.

- [ ] **Step 1: Add the type**

At the end of `src/lib/types.ts`:

```ts
/** One tick of `clone://progress`. Mirrors `CloneProgress` in types.rs. */
export interface CloneProgress {
  phase: string;
  percent: number;
}
```

- [ ] **Step 2: Add the wrappers**

In `src/lib/tauri.ts`, add `CloneProgress` to the type import block, then append:

```ts
export async function initRepo(
  path: string,
  initialBranch?: string,
): Promise<RepoHandle> {
  return invoke<RepoHandle>("init_repo", { path, initialBranch });
}

export async function defaultInitBranch(): Promise<string> {
  return invoke<string>("default_init_branch");
}

/**
 * Clone `url` into `parentDir/name`, resolving with the destination path.
 * Progress arrives out of band on the `clone://progress` event — listen before
 * calling, since the first tick can land before this promise settles.
 */
export async function cloneRepo(
  url: string,
  parentDir: string,
  name: string,
  recurseSubmodules: boolean,
): Promise<string> {
  return invoke<string>("clone_repo", {
    url,
    parentDir,
    name,
    recurseSubmodules,
  });
}
```

- [ ] **Step 3: Typecheck**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm tsc --noEmit
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/lib/types.ts src/lib/tauri.ts
git commit -m "feat(clone): typed wrappers for clone_repo, init_repo, default_init_branch

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Promote `PGModal` into the design system

Pure refactor, no behaviour change — done before the new dialogs so they build on it rather than adding a fourth copy.

**Files:**
- Create: `src/design/modal.tsx`
- Modify: `src/design/index.ts`
- Modify: `src/features/reflog/ReflogActionDialog.tsx:154-193`
- Modify: `src/features/reflog/DirtyTreeDialog.tsx`

**Interfaces:**
- Produces: `PGModal({ children, onCancel, width?, dismissable? })`.

- [ ] **Step 1: Create the component**

Create `src/design/modal.tsx`:

```tsx
import React from "react";

interface Props {
  children: React.ReactNode;
  /** Backdrop click and Escape. Ignored entirely when `dismissable` is false. */
  onCancel: () => void;
  width?: number;
  /**
   * False while an operation the dialog owns is running and cannot be
   * cancelled — a clone in flight, for example. Dismissing then would orphan
   * the work with no way to reach it again.
   */
  dismissable?: boolean;
}

export function PGModal({
  children,
  onCancel,
  width = 480,
  dismissable = true,
}: Props) {
  React.useEffect(() => {
    if (!dismissable) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCancel();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [dismissable, onCancel]);

  return (
    <div
      role="dialog"
      aria-modal
      onClick={(e) => {
        if (dismissable && e.currentTarget === e.target) onCancel();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "oklch(0 0 0 / 0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
    >
      <div
        style={{
          background: "var(--bg-0)",
          color: "var(--fg-0)",
          border: "1px solid var(--border-0)",
          borderRadius: 6,
          padding: 16,
          width,
          maxWidth: "90vw",
        }}
      >
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Export it**

In `src/design/index.ts`, after `export * from "./empty-state";`:

```ts
export * from "./modal";
```

- [ ] **Step 3: Adopt it in the two existing dialogs**

In `src/features/reflog/ReflogActionDialog.tsx`: delete the local `ModalShell` function (lines 154-193), replace `<ModalShell onCancel={onCancel}>` with `<PGModal onCancel={onCancel}>` and the closing tag to match, and add `PGModal` to the existing `@/design` import.

In `src/features/reflog/DirtyTreeDialog.tsx`: replace the hand-rolled `role="dialog"` wrapper and its inner panel div with `<PGModal onCancel={…}>`, keeping the dialog's own content untouched. Add `PGModal` to its `@/design` import.

- [ ] **Step 4: Run the frontend suite**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test && pnpm tsc --noEmit
```

Expected: 404 passed, no type errors. Existing reflog component tests cover both dialogs — if any fails, the refactor changed behaviour and must be corrected, not the test.

- [ ] **Step 5: Commit**

```bash
git add src/design/modal.tsx src/design/index.ts src/features/reflog/ReflogActionDialog.tsx src/features/reflog/DirtyTreeDialog.tsx
git commit -m "refactor(design): promote ModalShell to a shared PGModal

Two dialogs hand-rolled the same backdrop; two more are about to. Adds a
dismissable flag for dialogs that own uncancellable work.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: `deriveRepoName`

**Files:**
- Create: `src/features/create/deriveRepoName.ts`
- Create: `src/features/create/deriveRepoName.test.ts`

**Interfaces:**
- Produces: `deriveRepoName(url: string): string`.

- [ ] **Step 1: Write the failing test**

Create `src/features/create/deriveRepoName.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { deriveRepoName } from "./deriveRepoName";

describe("deriveRepoName", () => {
  it("takes the last path segment and strips .git", () => {
    expect(deriveRepoName("https://github.com/org/repo.git")).toBe("repo");
    expect(deriveRepoName("https://github.com/org/repo")).toBe("repo");
  });

  it("handles the scp-like SSH form", () => {
    expect(deriveRepoName("git@github.com:org/repo.git")).toBe("repo");
    expect(deriveRepoName("ssh://git@github.com/org/repo.git")).toBe("repo");
  });

  it("ignores trailing slashes", () => {
    expect(deriveRepoName("https://github.com/org/repo.git/")).toBe("repo");
    expect(deriveRepoName("https://github.com/org/repo//")).toBe("repo");
  });

  it("ignores query strings and fragments", () => {
    expect(deriveRepoName("https://github.com/org/repo.git?ref=x")).toBe("repo");
    expect(deriveRepoName("https://github.com/org/repo#readme")).toBe("repo");
  });

  it("handles local paths", () => {
    expect(deriveRepoName("/srv/git/repo.git")).toBe("repo");
    expect(deriveRepoName("file:///srv/git/repo.git")).toBe("repo");
  });

  it("returns empty string when there is nothing to derive", () => {
    expect(deriveRepoName("")).toBe("");
    expect(deriveRepoName("   ")).toBe("");
    expect(deriveRepoName("https://github.com/")).toBe("");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm vitest run src/features/create/deriveRepoName.test.ts
```

Expected: FAIL — cannot resolve `./deriveRepoName`.

- [ ] **Step 3: Implement**

Create `src/features/create/deriveRepoName.ts`:

```ts
/**
 * Folder name to prefill from a clone URL: the last path segment, minus a
 * trailing `.git`.
 *
 * Deliberately string-based rather than `new URL()` — git's scp-like SSH form
 * (`git@host:org/repo.git`) is not a parseable URL, and it is the form most
 * hosting providers hand you by default.
 */
export function deriveRepoName(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  const withoutTail = trimmed.split("?")[0].split("#")[0];
  const segments = withoutTail
    .replace(/:/g, "/")
    .split("/")
    .filter((s) => s.length > 0);
  const last = segments[segments.length - 1] ?? "";
  return last.replace(/\.git$/i, "");
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
pnpm vitest run src/features/create/deriveRepoName.test.ts
```

Expected: 6 passed.

Note: `replace(/:/g, "/")` also flattens `https://` into `https///`, which the `filter` then discards — that is why the scheme never becomes the derived name. Confirm the "local paths" and "SSH form" cases both pass before moving on.

- [ ] **Step 5: Commit**

```bash
git add src/features/create/deriveRepoName.ts src/features/create/deriveRepoName.test.ts
git commit -m "feat(clone): derive the destination folder name from a clone URL

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: `useCreateStore`

**Files:**
- Create: `src/features/create/useCreateStore.ts`
- Modify: `src/features/settings/useSettingsStore.ts:359-371` (`PersistedState`) and its `DEFAULTS`

**Interfaces:**
- Consumes: `cloneRepo`, `initRepo`, `defaultInitBranch` (Task 5); `deriveRepoName` (Task 7).
- Produces: `useCreateStore` with `{ open: "none" | "clone" | "init", progress: CloneProgress | null, busy: boolean, error: string | null, openClone(), openInit(), close(), runClone(args), runInit(args) }`.

- [ ] **Step 1: Add the persisted setting**

In `src/features/settings/useSettingsStore.ts`, add to `PersistedState`:

```ts
  /** Parent directory last used for Clone/Init, prefilled next time. */
  lastCreateDir: string;
```

and to `DEFAULTS`:

```ts
  lastCreateDir: "",
```

- [ ] **Step 2: Write the store**

Create `src/features/create/useCreateStore.ts`:

```ts
import { create } from "zustand";

import { useRepoStore } from "@/features/repo/useRepoStore";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { cloneRepo, initRepo } from "@/lib/tauri";
import type { CloneProgress } from "@/lib/types";
import { toAppError } from "@/lib/errors";

type OpenDialog = "none" | "clone" | "init";

interface CreateState {
  open: OpenDialog;
  busy: boolean;
  progress: CloneProgress | null;
  error: string | null;
  openClone: () => void;
  openInit: () => void;
  close: () => void;
  setProgress: (p: CloneProgress) => void;
  runClone: (args: {
    url: string;
    parentDir: string;
    name: string;
    recurseSubmodules: boolean;
  }) => Promise<void>;
  runInit: (args: {
    parentDir: string;
    name: string;
    branch: string;
  }) => Promise<void>;
}

export const useCreateStore = create<CreateState>((set, get) => ({
  open: "none",
  busy: false,
  progress: null,
  error: null,

  openClone: () => set({ open: "clone", error: null, progress: null }),
  openInit: () => set({ open: "init", error: null, progress: null }),
  // Never closes mid-run: a clone in flight has no cancel, so dropping the
  // dialog would leave a git process with no UI attached to it.
  close: () => {
    if (get().busy) return;
    set({ open: "none", error: null, progress: null });
  },
  setProgress: (p) => set({ progress: p }),

  async runClone({ url, parentDir, name, recurseSubmodules }) {
    set({ busy: true, error: null, progress: null });
    try {
      const dest = await cloneRepo(url, parentDir, name, recurseSubmodules);
      useSettingsStore.getState().set("lastCreateDir", parentDir);
      // busy false BEFORE close(), which refuses to close while busy.
      set({ busy: false, progress: null });
      set({ open: "none" });
      await useRepoStore.getState().openRepo(dest);
    } catch (e) {
      // Error stays in the dialog: the user needs the form still populated to
      // fix a bad URL and retry.
      set({ busy: false, progress: null, error: toAppError(e).message });
    }
  },

  async runInit({ parentDir, name, branch }) {
    set({ busy: true, error: null });
    try {
      const path = `${parentDir}/${name}`;
      const handle = await initRepo(path, branch);
      useSettingsStore.getState().set("lastCreateDir", parentDir);
      set({ busy: false, open: "none" });
      await useRepoStore.getState().openRepo(handle.path);
    } catch (e) {
      set({ busy: false, error: toAppError(e).message });
    }
  },
}));
```

- [ ] **Step 3: Verify `toAppError` exposes `.message`**

```bash
grep -n "export function toAppError" -A 12 src/lib/errors.ts
```

If the returned `AppError` union does not carry a plain `message` string on every variant, use whatever field the union actually exposes and adjust both `catch` arms. Do not stringify the whole object into the UI.

- [ ] **Step 4: Typecheck**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm tsc --noEmit
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/features/create/useCreateStore.ts src/features/settings/useSettingsStore.ts
git commit -m "feat(create): store for the clone and init dialogs

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: The two dialogs

**Files:**
- Create: `src/features/create/CloneDialog.tsx`, `src/features/create/CloneDialog.test.tsx`
- Create: `src/features/create/InitDialog.tsx`, `src/features/create/InitDialog.test.tsx`
- Modify: `src/AppShell.tsx`

**Interfaces:**
- Consumes: `PGModal` (Task 6), `useCreateStore` (Task 8), `deriveRepoName` (Task 7), `defaultInitBranch` (Task 5).
- Produces: `<CloneDialog />`, `<InitDialog />`, both self-gating on `useCreateStore.open`.

- [ ] **Step 1: Write the failing CloneDialog test**

Create `src/features/create/CloneDialog.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { CloneDialog } from "./CloneDialog";
import { useCreateStore } from "./useCreateStore";
import { mockInvoke } from "@/test/invokeMock";

describe("CloneDialog", () => {
  beforeEach(() => {
    useCreateStore.setState({
      open: "clone",
      busy: false,
      progress: null,
      error: null,
    });
    mockInvoke("clone_repo", () => "/tmp/dest/repo");
    mockInvoke("open_repo", () => ({
      id: "r1",
      path: "/tmp/dest/repo",
      head: "refs/heads/main",
    }));
  });

  it("derives the folder name from the URL as you type", async () => {
    render(<CloneDialog />);

    fireEvent.change(screen.getByTestId("clone-url"), {
      target: { value: "https://github.com/org/my-repo.git" },
    });

    await waitFor(() =>
      expect(screen.getByTestId("clone-name")).toHaveValue("my-repo"),
    );
  });

  it("keeps a name the user edited instead of overwriting it", async () => {
    render(<CloneDialog />);
    fireEvent.change(screen.getByTestId("clone-url"), {
      target: { value: "https://github.com/org/my-repo.git" },
    });
    fireEvent.change(screen.getByTestId("clone-name"), {
      target: { value: "custom" },
    });

    fireEvent.change(screen.getByTestId("clone-url"), {
      target: { value: "https://github.com/org/other.git" },
    });

    expect(screen.getByTestId("clone-name")).toHaveValue("custom");
  });

  it("shows the resolved destination path", () => {
    render(<CloneDialog />);
    fireEvent.change(screen.getByTestId("clone-parent"), {
      target: { value: "/tmp/dest" },
    });
    fireEvent.change(screen.getByTestId("clone-name"), {
      target: { value: "repo" },
    });

    expect(screen.getByTestId("clone-resolved")).toHaveTextContent(
      "/tmp/dest/repo",
    );
  });

  it("disables Clone until URL, parent and name are all present", () => {
    render(<CloneDialog />);
    const button = screen.getByTestId("clone-submit");
    expect(button).toBeDisabled();

    fireEvent.change(screen.getByTestId("clone-url"), {
      target: { value: "https://github.com/org/repo.git" },
    });
    fireEvent.change(screen.getByTestId("clone-parent"), {
      target: { value: "/tmp/dest" },
    });

    expect(button).not.toBeDisabled();
  });

  it("renders progress while cloning", () => {
    useCreateStore.setState({
      open: "clone",
      busy: true,
      progress: { phase: "Receiving objects", percent: 62 },
    });
    render(<CloneDialog />);

    expect(screen.getByTestId("clone-progress")).toHaveTextContent(
      "Receiving objects",
    );
    expect(screen.getByTestId("clone-progress")).toHaveTextContent("62%");
  });

  it("renders a failure inside the dialog and keeps the form populated", () => {
    useCreateStore.setState({
      open: "clone",
      busy: false,
      error: "fatal: repository not found",
    });
    render(<CloneDialog />);

    expect(screen.getByTestId("clone-error")).toHaveTextContent(
      "repository not found",
    );
    // Still open — the user fixes the URL and retries.
    expect(screen.getByTestId("clone-url")).toBeInTheDocument();
  });

  it("renders nothing when another dialog is open", () => {
    useCreateStore.setState({ open: "init" });
    const { container } = render(<CloneDialog />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm vitest run src/features/create/CloneDialog.test.tsx
```

Expected: FAIL — cannot resolve `./CloneDialog`.

- [ ] **Step 3: Implement CloneDialog**

Create `src/features/create/CloneDialog.tsx`:

```tsx
import React from "react";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

import { PGButton, PGCheckbox, PGInput, PGModal } from "@/design";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import type { CloneProgress } from "@/lib/types";
import { deriveRepoName } from "./deriveRepoName";
import { useCreateStore } from "./useCreateStore";

export function CloneDialog() {
  const open = useCreateStore((s) => s.open);
  const busy = useCreateStore((s) => s.busy);
  const progress = useCreateStore((s) => s.progress);
  const error = useCreateStore((s) => s.error);
  const close = useCreateStore((s) => s.close);
  const runClone = useCreateStore((s) => s.runClone);
  const setProgress = useCreateStore((s) => s.setProgress);

  const [url, setUrl] = React.useState("");
  const [parentDir, setParentDir] = React.useState(
    () => useSettingsStore.getState().lastCreateDir,
  );
  const [name, setName] = React.useState("");
  const [nameEdited, setNameEdited] = React.useState(false);
  const [recurse, setRecurse] = React.useState(true);

  // Listen before the first clone starts: the first progress tick can land
  // before the invoke promise settles.
  React.useEffect(() => {
    const un = listen<CloneProgress>("clone://progress", (e) =>
      setProgress(e.payload),
    );
    return () => {
      void un.then((f) => f());
    };
  }, [setProgress]);

  if (open !== "clone") return null;

  function onUrlChange(next: string) {
    setUrl(next);
    // Only track the URL while the user hasn't taken over the name field.
    if (!nameEdited) setName(deriveRepoName(next));
  }

  async function pickParent() {
    const picked = await openDialog({
      directory: true,
      multiple: false,
      title: "Clone into",
    });
    if (typeof picked === "string") setParentDir(picked);
  }

  const resolved = parentDir && name ? `${parentDir}/${name}` : "";
  const canClone = !busy && url.trim() !== "" && parentDir !== "" && name !== "";

  return (
    <PGModal onCancel={close} dismissable={!busy}>
      <div style={{ fontWeight: 600, marginBottom: 12 }}>Clone repository</div>

      <Field label="Repository URL">
        <PGInput
          data-testid="clone-url"
          value={url}
          disabled={busy}
          placeholder="https://github.com/org/repo.git"
          onChange={(e) => onUrlChange(e.target.value)}
        />
      </Field>

      <Field label="Clone into">
        <div style={{ display: "flex", gap: 6 }}>
          <PGInput
            data-testid="clone-parent"
            value={parentDir}
            disabled={busy}
            onChange={(e) => setParentDir(e.target.value)}
          />
          <PGButton size="sm" disabled={busy} onClick={() => void pickParent()}>
            Browse…
          </PGButton>
        </div>
      </Field>

      <Field label="Folder name">
        <PGInput
          data-testid="clone-name"
          value={name}
          disabled={busy}
          onChange={(e) => {
            setNameEdited(true);
            setName(e.target.value);
          }}
        />
      </Field>

      <PGCheckbox
        checked={recurse}
        disabled={busy}
        onChange={() => setRecurse((v) => !v)}
        label="Initialize submodules"
      />

      {resolved && (
        <div
          data-testid="clone-resolved"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-11)",
            color: "var(--fg-3)",
            marginTop: 10,
          }}
        >
          → {resolved}
        </div>
      )}

      {busy && (
        <div
          data-testid="clone-progress"
          style={{ marginTop: 12, fontSize: "var(--fs-12)" }}
        >
          {progress ? `${progress.phase} — ${progress.percent}%` : "Cloning…"}
          <div
            style={{
              height: 4,
              marginTop: 6,
              background: "var(--bg-2)",
              borderRadius: 2,
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${progress?.percent ?? 0}%`,
                background: "var(--accent)",
                borderRadius: 2,
              }}
            />
          </div>
        </div>
      )}

      {error && (
        <div
          data-testid="clone-error"
          style={{
            marginTop: 12,
            fontSize: "var(--fs-12)",
            color: "var(--git-deleted)",
            whiteSpace: "pre-wrap",
          }}
        >
          {error}
        </div>
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
          marginTop: 16,
        }}
      >
        <PGButton onClick={close} disabled={busy}>
          Cancel
        </PGButton>
        <PGButton
          variant="primary"
          data-testid="clone-submit"
          disabled={!canClone}
          onClick={() =>
            void runClone({
              url: url.trim(),
              parentDir,
              name,
              recurseSubmodules: recurse,
            })
          }
        >
          {busy ? "Cloning…" : "Clone"}
        </PGButton>
      </div>
    </PGModal>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div
        style={{
          fontSize: "var(--fs-11)",
          color: "var(--fg-2)",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}
```

Check `PGCheckbox`'s actual prop names before relying on `label` — `grep -n "export function PGCheckbox" -A 15 src/design/primitives.tsx`. If it takes children rather than a `label` prop, adjust the call.

- [ ] **Step 4: Run the CloneDialog test to verify it passes**

```bash
pnpm vitest run src/features/create/CloneDialog.test.tsx
```

Expected: 7 passed.

- [ ] **Step 5: Write the failing InitDialog test**

Create `src/features/create/InitDialog.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { InitDialog } from "./InitDialog";
import { useCreateStore } from "./useCreateStore";
import { mockInvoke } from "@/test/invokeMock";

describe("InitDialog", () => {
  beforeEach(() => {
    useCreateStore.setState({
      open: "init",
      busy: false,
      progress: null,
      error: null,
    });
    mockInvoke("default_init_branch", () => "trunk");
    mockInvoke("init_repo", () => ({
      id: "r1",
      path: "/tmp/dest/fresh",
      head: "refs/heads/trunk",
    }));
    mockInvoke("open_repo", () => ({
      id: "r1",
      path: "/tmp/dest/fresh",
      head: "refs/heads/trunk",
    }));
  });

  it("prefills the branch from the user's init.defaultBranch", async () => {
    render(<InitDialog />);
    await waitFor(() =>
      expect(screen.getByTestId("init-branch")).toHaveValue("trunk"),
    );
  });

  it("shows the resolved destination path", () => {
    render(<InitDialog />);
    fireEvent.change(screen.getByTestId("init-parent"), {
      target: { value: "/tmp/dest" },
    });
    fireEvent.change(screen.getByTestId("init-name"), {
      target: { value: "fresh" },
    });

    expect(screen.getByTestId("init-resolved")).toHaveTextContent(
      "/tmp/dest/fresh",
    );
  });

  it("disables Create until parent and name are present", () => {
    render(<InitDialog />);
    const button = screen.getByTestId("init-submit");
    expect(button).toBeDisabled();

    fireEvent.change(screen.getByTestId("init-parent"), {
      target: { value: "/tmp/dest" },
    });
    fireEvent.change(screen.getByTestId("init-name"), {
      target: { value: "fresh" },
    });

    expect(button).not.toBeDisabled();
  });

  it("renders a failure inside the dialog", () => {
    useCreateStore.setState({
      open: "init",
      error: "/tmp/dest/fresh is already a git repository",
    });
    render(<InitDialog />);

    expect(screen.getByTestId("init-error")).toHaveTextContent(
      "already a git repository",
    );
  });

  it("renders nothing when another dialog is open", () => {
    useCreateStore.setState({ open: "clone" });
    const { container } = render(<InitDialog />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

```bash
pnpm vitest run src/features/create/InitDialog.test.tsx
```

Expected: FAIL — cannot resolve `./InitDialog`.

- [ ] **Step 7: Implement InitDialog**

Create `src/features/create/InitDialog.tsx`. Same shape as `CloneDialog` — reuse its `Field` helper by exporting it from `CloneDialog.tsx` and importing it here rather than copying it:

```tsx
import React from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

import { PGButton, PGInput, PGModal } from "@/design";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { defaultInitBranch } from "@/lib/tauri";
import { Field } from "./CloneDialog";
import { useCreateStore } from "./useCreateStore";

export function InitDialog() {
  const open = useCreateStore((s) => s.open);
  const busy = useCreateStore((s) => s.busy);
  const error = useCreateStore((s) => s.error);
  const close = useCreateStore((s) => s.close);
  const runInit = useCreateStore((s) => s.runInit);

  const [parentDir, setParentDir] = React.useState(
    () => useSettingsStore.getState().lastCreateDir,
  );
  const [name, setName] = React.useState("");
  const [branch, setBranch] = React.useState("");

  React.useEffect(() => {
    if (open !== "init") return;
    let live = true;
    void defaultInitBranch().then((b) => {
      // Don't clobber a value the user already typed.
      if (live) setBranch((cur) => (cur === "" ? b : cur));
    });
    return () => {
      live = false;
    };
  }, [open]);

  if (open !== "init") return null;

  async function pickParent() {
    const picked = await openDialog({
      directory: true,
      multiple: false,
      title: "Create repository in",
    });
    if (typeof picked === "string") setParentDir(picked);
  }

  const resolved = parentDir && name ? `${parentDir}/${name}` : "";
  const canCreate = !busy && parentDir !== "" && name !== "";

  return (
    <PGModal onCancel={close} dismissable={!busy}>
      <div style={{ fontWeight: 600, marginBottom: 12 }}>New repository</div>

      <Field label="Create in">
        <div style={{ display: "flex", gap: 6 }}>
          <PGInput
            data-testid="init-parent"
            value={parentDir}
            disabled={busy}
            onChange={(e) => setParentDir(e.target.value)}
          />
          <PGButton size="sm" disabled={busy} onClick={() => void pickParent()}>
            Browse…
          </PGButton>
        </div>
      </Field>

      <Field label="Folder name">
        <PGInput
          data-testid="init-name"
          value={name}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>

      <Field label="Initial branch">
        <PGInput
          data-testid="init-branch"
          value={branch}
          disabled={busy}
          onChange={(e) => setBranch(e.target.value)}
        />
      </Field>

      {resolved && (
        <div
          data-testid="init-resolved"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-11)",
            color: "var(--fg-3)",
            marginTop: 10,
          }}
        >
          → {resolved}
        </div>
      )}

      {error && (
        <div
          data-testid="init-error"
          style={{
            marginTop: 12,
            fontSize: "var(--fs-12)",
            color: "var(--git-deleted)",
            whiteSpace: "pre-wrap",
          }}
        >
          {error}
        </div>
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
          marginTop: 16,
        }}
      >
        <PGButton onClick={close} disabled={busy}>
          Cancel
        </PGButton>
        <PGButton
          variant="primary"
          data-testid="init-submit"
          disabled={!canCreate}
          onClick={() => void runInit({ parentDir, name, branch: branch.trim() })}
        >
          {busy ? "Creating…" : "Create"}
        </PGButton>
      </div>
    </PGModal>
  );
}
```

Change `function Field(` to `export function Field(` in `CloneDialog.tsx`.

- [ ] **Step 8: Run the InitDialog test to verify it passes**

```bash
pnpm vitest run src/features/create/InitDialog.test.tsx
```

Expected: 5 passed.

- [ ] **Step 9: Mount both dialogs**

In `src/AppShell.tsx`, import them from `@/features/create/CloneDialog` and `@/features/create/InitDialog`, and render `<CloneDialog />` and `<InitDialog />` beside the other overlay-level components (near where the settings screen and error banner are rendered). Both self-gate on `useCreateStore.open`, so mounting them unconditionally is correct.

- [ ] **Step 10: Run the whole frontend suite**

```bash
pnpm test && pnpm tsc --noEmit
```

Expected: all pass, no type errors.

- [ ] **Step 11: Commit**

```bash
git add src/features/create src/AppShell.tsx
git commit -m "feat(create): clone and init dialogs

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Entry points

**Files:**
- Modify: `src/features/repo/ops.ts`
- Modify: `src/features/keymap/actions.ts:76-82` (the `ActionId` union) and `:213` (the Repository block)
- Modify: `src/features/keymap/presets.ts:37-39` (`COMMON`)
- Modify: `src/features/palette/commands.ts:163-174`
- Modify: `src/screens/Welcome.tsx`

**Interfaces:**
- Consumes: `useCreateStore` (Task 8).
- Produces: `cloneRepoOp()`, `initRepoOp()`; action ids `repo.clone`, `repo.init`; palette items `action:clone`, `action:init`.

- [ ] **Step 1: Add the keymap runner ops**

In `src/features/repo/ops.ts`, after `openRepoOp`:

```ts
/** Keymap runners for the create dialogs. Always claim the chord — the
 *  dialogs are global and need no open repository. */
export function cloneRepoOp(): boolean {
  useCreateStore.getState().openClone();
  return true;
}

export function initRepoOp(): boolean {
  useCreateStore.getState().openInit();
  return true;
}
```

with `import { useCreateStore } from "@/features/create/useCreateStore";` at the top.

- [ ] **Step 2: Register the actions**

In `src/features/keymap/actions.ts`: add `| "repo.clone"` and `| "repo.init"` to the `ActionId` union next to `"repo.open"`, import `cloneRepoOp, initRepoOp` from `@/features/repo/ops`, and add beneath the `repo.open` entry:

```ts
  "repo.clone": { id: "repo.clone", title: "Clone repository…", category: "Repository", scope: "global", run: cloneRepoOp },
  "repo.init": { id: "repo.init", title: "New repository…", category: "Repository", scope: "global", run: initRepoOp },
```

- [ ] **Step 3: Bind them**

In `src/features/keymap/presets.ts`, in `COMMON` beside `"repo.open": ["Mod+O"]`:

```ts
  "repo.clone": ["Mod+Shift+O"],
  "repo.init": ["Mod+Alt+N"],
```

Before committing, confirm neither chord is already bound in either preset:

```bash
grep -n "Mod+Shift+O\|Mod+Alt+N" src/features/keymap/presets.ts
```

If either collides, pick a free chord — the existing `presets.test.ts` has a duplicate-binding assertion that will fail otherwise.

- [ ] **Step 4: Add the palette commands**

In `src/features/palette/commands.ts`, in the "direct actions" `items.push(…)` block:

```ts
    {
      type: "command", id: "action:clone", search: "Clone repository git url",
      label: "Clone repository…", icon: "download", actionId: "repo.clone",
      run: direct(() => useCreateStore.getState().openClone()),
    },
    {
      type: "command", id: "action:init", search: "New repository init create",
      label: "New repository…", icon: "plus", actionId: "repo.init",
      run: direct(() => useCreateStore.getState().openInit()),
    },
```

with the `useCreateStore` import added. Verify the icon names exist:

```bash
grep -n "download\|\"plus\"" src/design/icons.tsx | head
```

Substitute existing names if either is missing — Task `fa398c9` added a visible fallback glyph, so a wrong name renders a placeholder rather than nothing, but it still looks wrong.

- [ ] **Step 5: Add the Welcome buttons**

In `src/screens/Welcome.tsx`, below the existing "Open repository…" `PGButton`, add two buttons in a row calling `useCreateStore.getState().openClone()` and `.openInit()`, labelled "Clone repository…" and "New repository…". Give them `data-testid="welcome-clone"` and `data-testid="welcome-init"` — the e2e spec in Task 11 needs them, and `PGButton` spreads `...rest` so the attribute reaches the DOM.

Update the subtitle text from "Open a local repository to get started." to "Open, clone, or create a repository to get started."

- [ ] **Step 6: Run the frontend gates**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test && pnpm tsc --noEmit
```

Expected: all pass. `actions.test.ts` and `presets.test.ts` assert every action has a binding and every binding a unique chord — both must stay green.

- [ ] **Step 7: Commit**

```bash
git add src/features/repo/ops.ts src/features/keymap src/features/palette/commands.ts src/screens/Welcome.tsx
git commit -m "feat(create): Welcome buttons, palette commands, keymap chords

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: E2E coverage

**Files:**
- Create: `e2e/specs/create.e2e.ts`
- Modify: `e2e/support/tempRepo.ts` (add a bare-source fixture helper if one is missing)

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Read the e2e playbook**

Read `.claude/skills/e2e-testing/SKILL.md` in full before writing the spec. It is mandatory per CLAUDE.md, and the selector rules, native-dialog stubbing, and `executeOnce` discipline below all come from it.

- [ ] **Step 2: Write the spec**

Create `e2e/specs/create.e2e.ts`:

```ts
import { existsSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { browser, $, expect } from "@wdio/globals";
import { basicRepo, TempRepo } from "../support/tempRepo";
import { resetApp, waitRepoLoaded } from "../support/app";

describe("clone & init", () => {
  let dest: string;

  beforeEach(() => {
    dest = mkdtempSync(join(tmpdir(), "pgit-create-"));
  });

  afterEach(async () => {
    await resetApp();
  });

  it("initializes a new repository and opens it", async () => {
    await $('[data-testid="welcome-init"]').waitForDisplayed({
      timeout: 30_000,
      timeoutMsg: "Welcome screen never showed the New repository button",
    });
    await $('[data-testid="welcome-init"]').click();

    await $('[data-testid="init-parent"]').waitForDisplayed({
      timeout: 30_000,
      timeoutMsg: "Init dialog never opened",
    });
    await $('[data-testid="init-parent"]').setValue(dest);
    await $('[data-testid="init-name"]').setValue("fresh");
    await $('[data-testid="init-submit"]').click();

    await waitRepoLoaded();

    // repo truth: a real repository on disk, on the branch we asked for
    expect(existsSync(join(dest, "fresh/.git"))).toBe(true);
    const head = execFileSync("git", ["symbolic-ref", "HEAD"], {
      cwd: join(dest, "fresh"),
      encoding: "utf8",
    }).trim();
    expect(head.startsWith("refs/heads/")).toBe(true);
  });

  it("clones from a local bare repository and opens it", async () => {
    // No network: a local bare repo drives the real clone path end to end.
    const source: TempRepo = basicRepo();
    const bare = mkdtempSync(join(tmpdir(), "pgit-bare-"));
    execFileSync("git", ["init", "--bare", bare]);
    execFileSync("git", ["push", bare, "HEAD:refs/heads/main"], {
      cwd: source.path,
    });

    await $('[data-testid="welcome-clone"]').waitForDisplayed({
      timeout: 30_000,
      timeoutMsg: "Welcome screen never showed the Clone button",
    });
    await $('[data-testid="welcome-clone"]').click();

    await $('[data-testid="clone-url"]').waitForDisplayed({
      timeout: 30_000,
      timeoutMsg: "Clone dialog never opened",
    });
    await $('[data-testid="clone-url"]').setValue(bare);
    await $('[data-testid="clone-parent"]').setValue(dest);
    await $('[data-testid="clone-name"]').setValue("cloned");
    await $('[data-testid="clone-submit"]').click();

    await waitRepoLoaded();

    // repo truth: the files actually landed
    expect(existsSync(join(dest, "cloned/.git"))).toBe(true);
    const files = execFileSync("git", ["ls-files"], {
      cwd: join(dest, "cloned"),
      encoding: "utf8",
    });
    expect(files.trim().length).toBeGreaterThan(0);

    source.dispose();
  });
});
```

`waitRepoLoaded` may not be exported from `e2e/support/app.ts` under that name — check with `grep -n "export" e2e/support/app.ts` and use whatever the existing specs use to wait for a repo to finish opening. Do not invent a new helper if one exists.

- [ ] **Step 3: Typecheck the spec**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm exec tsc -p e2e/tsconfig.json --noEmit
```

Expected: clean. The root `tsc` excludes `e2e/`, so this gate is separate and must be run.

- [ ] **Step 4: Rebuild the e2e binary and run the spec**

```bash
pnpm test:e2e:build
pnpm test:e2e:run --spec e2e/specs/create.e2e.ts
```

Expected: 2 passing. `test:e2e:run` silently tests a stale binary if the build is skipped — both `src/` and `src-tauri/` changed, so the rebuild is mandatory.

- [ ] **Step 5: Run the other specs this could have broken**

The Welcome screen and `AppShell` both changed:

```bash
pnpm test:e2e:run --spec e2e/specs/smoke.e2e.ts --spec e2e/specs/keymap.e2e.ts
```

Expected: all passing. `keymap.e2e.ts` exercises the cheat sheet, which now lists two more actions.

- [ ] **Step 6: Commit**

```bash
git add e2e/specs/create.e2e.ts
git commit -m "test(e2e): clone from a local bare repo and init a new repo

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Documentation and final verification

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the architecture notes**

In `CLAUDE.md`, under the backend `commands/` tree, add:

```
├── create.rs      init_repo, default_init_branch, clone_repo (streaming
│                  git clone → clone://progress events)
```

Under the frontend `features/` tree, add:

```
├── create/          Clone + Init dialogs (PGModal), useCreateStore,
│                    deriveRepoName. Clone shells out to real git with the
│                    same prompt-less env as fetch/pull/push.
```

Add `modal.tsx  PGModal — shared dialog shell` to the `design/` listing.

Add to the recent specs/plans list at the top:

```
- `2026-08-10-clone-init-*` — clone (streaming progress) + init repository (#61 D3/D4).
```

- [ ] **Step 2: Run every gate**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo test --manifest-path src-tauri/Cargo.toml > /tmp/cargo.txt 2>&1; echo "cargo EXIT=$?"
grep "^test result" /tmp/cargo.txt | awk '{p+=$4; f+=$6} END {print "passed:",p,"failed:",f}'
pnpm test
pnpm tsc --noEmit
pnpm exec tsc -p e2e/tsconfig.json --noEmit
```

Every one must be green. Redirect `cargo test` to a file rather than piping to `tail` — a pipeline reports the exit code of its last command, not of cargo.

- [ ] **Step 3: Commit and open the PR**

```bash
git add CLAUDE.md
git commit -m "docs: record clone/init architecture in CLAUDE.md

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"

git fetch origin && git rebase origin/main
git reset --soft origin/main
git commit -m "feat(create): clone and init repository (#61 D3/D4)

<full body summarizing the change>

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push -u origin feat/clone-init
gh pr create --title "feat(create): clone and init repository (#61 D3/D4)" --body "<body>"
```

The squash into one commit before merging is required by CLAUDE.md — `main` enforces squash-only merges, and squashing locally keeps the message clean rather than an auto-concatenation.

---

## Self-review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| `init` on the trait, shaped like `open` | 2 |
| `init.defaultBranch` → `main` fallback | 2, 3 |
| Refuse init on an existing repo | 2 |
| `clone` outside the trait, in `commands/create.rs` | 4 |
| `run_git_streaming` keeping run_git's env | 4 |
| `--progress` parsing as a pure function | 1 |
| `clone://progress` events | 4, 9 |
| Validation: URL non-empty, no leading dash, destination absent-or-empty | 4 |
| `--` before the URL; no shell | 4 |
| Failure leaves nothing behind | 4 (test), 8 (only opens on success) |
| No new AppError variants | Global Constraints |
| `PGModal` promotion, three call sites | 6 |
| `src/features/create/` store + two dialogs | 8, 9 |
| Welcome + palette + keymap entry points | 10 |
| Destination picker, persisted parent dir, live resolved path | 8, 9 |
| Name auto-derivation, editable | 7, 9 |
| Errors inside the dialog | 9 |
| Non-dismissable while cloning | 6 (`dismissable`), 9 |
| Rust tests: init, clone-from-bare, parse_progress | 1, 2, 4 |
| Frontend tests: deriveRepoName, both dialogs | 7, 9 |
| E2E: init + clone from local bare | 11 |

No gaps.

**Type consistency:** `CloneProgress { phase, percent }` is defined in Task 1 (Rust) and Task 5 (TS) with identical fields; consumed in Tasks 4, 8, 9. `validate_clone_target`, `clone_args`, `run_clone`, `parse_progress`, `default_branch_name` are each defined once and referenced with the same signature everywhere. `useCreateStore`'s surface is declared in Task 8 and used unchanged in Tasks 9 and 10. `deriveRepoName` is Task 7, used in Task 9.

**Known verification points deliberately left for the implementer** (each has an explicit check step rather than an assumption): `tokio` in dev-dependencies (Task 4 Step 1), `toAppError`'s message field (Task 8 Step 3), `PGCheckbox`'s prop shape (Task 9 Step 3), icon names (Task 10 Step 4), chord collisions (Task 10 Step 3), and the e2e repo-loaded helper's real name (Task 11 Step 2).

---

## Corrections (post-implementation, Task 12)

This plan is a canonical reference (see `CLAUDE.md`), so the snippets below
are errata, not narrative — each entry is what was wrong here and what the
shipped code does instead, so a future reader does not reintroduce a fixed
bug by following this document literally.

- **Task 4, `run_clone` stderr reading.** The plan's snippet used
  `read_until(b'\n', …)`, which buffers an entire phase because git delimits
  progress with `\r`, not `\n` — measured 404 `\r` vs 7 `\n` on a real clone.
  The shipped code reads raw chunks and splits on both, carrying a bounded
  remainder across reads. *Why:* `\n`-only reads made progress arrive in one
  lump at the end instead of live.

- **Task 4, destination-inside-a-repo check.** The plan's validation list
  omitted the spec's requirement that the destination must not be inside an
  existing repository. Shipped code checks whether the chosen *parent* is
  itself a repository working-tree root — deliberately bounded to the parent,
  not an ancestor walk. *Why:* an ancestor-walking version was tried and
  reverted because a dotfiles-tracking `$HOME` made every destination
  underneath it unusable.

- **Task 7, `deriveRepoName`.** The plan's regex-based implementation
  (`replace(/:/g, "/")` then split) left the hostname as a path segment, so
  `https://github.com/` returned `github.com` instead of `""`. The shipped
  version parses in URL-grammar order — scheme, then userinfo, then
  port-vs-scp-like colon, then path. *Why:* the regex collapse couldn't tell
  a host-only URL from a URL with a real path segment.

- **Task 8, `useCreateStore` error handling.** The plan called a
  non-existent `toAppError(e).message`; the codebase's helper is
  `appErrorMessage(e)`, and `AppError`'s `message` field is optional on
  several variants. *Why:* `toAppError` was never a real export — Step 3's
  own verification grep would have caught it.

- **Task 8, persisted setting registration.** The plan listed two places to
  register `lastCreateDir` (`PersistedState` and `DEFAULTS`). Shipped code
  needed a third: `useSettingsStore.snapshot()`. *Why:* without it, the
  value is computed for persistence but never included in what actually gets
  written, so it's silently dropped on reload.

- **Task 9, `PGInput.onChange`.** The plan's dialog snippets wrote
  `onChange={(e) => onUrlChange(e.target.value)}`, but `PGInput`'s `onChange`
  prop is `(v: string) => void`, not a DOM event handler — there is no
  `e.target`. Shipped dialogs call the handler with the string directly.

- **Task 9, CSS token.** The plan referenced a `--git-deleted` token that
  does not exist. The real token is `--git-removed`.

- **Task 9, `PGModal` Escape handling.** The plan's `PGModal` snippet
  included a local `keydown` listener for Escape. That contradicts the
  convention already established by `UpdatePanel.tsx` and documented in
  `CLAUDE.md`: Escape is handled by the keymap's `app.closeOverlay` action.
  The shipped `PGModal` has no key listener; a branch was added to that
  action's chain instead.

- **Task 10, `repo.init` chord.** The plan proposed `Mod+Alt+N`, which
  violates the documented rule against new `Mod+Alt+<letter>` chords
  (Ctrl+Alt is AltGr on Windows; `AltGr+N` types `ń` on Polish layouts, and
  the dispatcher passes real-modifier chords through inside text inputs).
  Shipped chord is `Mod+Shift+N`. `presets.test.ts` now enforces the rule
  going forward, with `Mod+Alt+Y` (`repo.refresh`) allowlisted as the one
  grandfathered exception.

- **Task 11, init e2e assertion.** The plan's assertion
  `head.startsWith("refs/heads/")` passes for any branch and never actually
  typed a branch name into the dialog. The shipped test types `trunk` and
  asserts the exact ref `refs/heads/trunk`.
