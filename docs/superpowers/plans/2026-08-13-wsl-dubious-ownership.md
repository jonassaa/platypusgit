# Dubious repository ownership (WSL / `/mnt/c`) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a repository on a filesystem libgit2 reports as owned by another user (the WSL `/mnt/c` case) openable from inside the app, via a per-repository `safe.directory` exception the user explicitly confirms.

**Architecture:** A new `AppError::DubiousOwnership` names the condition so the frontend can narrow on it; a new `git/ownership.rs` module owns everything about it (error mapping, repository-presence probing, root discovery, the `safe.directory` writer); `useRepoStore.openRepo` catches the variant, confirms with the user, writes the exception, and retries — which covers every entry point (Welcome, recents, CLI launch, palette) in one place. Four existing call sites that infer "no repository here" from a failed open are corrected to distinguish "refused" from "absent".

**Tech Stack:** Rust + git2 0.20.4 (libgit2 1.9.2), Tauri 2 commands, React + Zustand, vitest/RTL, `cargo test`.

**Design doc:** `docs/superpowers/specs/2026-08-13-wsl-dubious-ownership-design.md`
**Issue:** [#83](https://github.com/jonassaa/platypusgit/issues/83)

## Global Constraints

- Every IPC-crossing fn returns `AppResult<T>`; no `unwrap`/`panic` in commands. Add `AppError` variants rather than stringifying.
- A new Rust `AppError` variant updates `src/lib/errors.ts` **in the same commit**. Wire format is `{ kind, message }`.
- libgit2 1.9.2 matches `safe.directory` **exactly** (or the literal `*`); no `dir/*` glob. The key is the **working directory**, read from **global** config only.
- Never call `git2::opts::set_verify_owner_validation(false)` in app code. It is process-global and disables CVE-2022-24765 protection for every repository.
- Never call `window.confirm`/`window.prompt` — use `pgConfirm` from `@/design`.
- git2 work inside Tauri commands goes through `tokio::task::spawn_blocking`.
- Frontend never calls `invoke()` directly — add a typed wrapper in `src/lib/tauri.ts`.
- New `GitBackend` trait method gets a `CliBackend` stub returning `AppError::NotImplemented`.
- Run cargo/pnpm with `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"`.

## File Structure

**Create:**
- `src-tauri/src/git/ownership.rs` — the whole ownership concern: `map_open_error`, `RepoPresence`/`repo_presence`, `repo_root_for`, `add_safe_directory`, `trust_path`.
- `src-tauri/tests/dubious_ownership.rs` — its integration tests (own binary, because two of them redirect libgit2's global-config search path, which is process-global).
- `src/features/repo/ownership.ts` — the frontend half: `confirmTrust` (the `pgConfirm` wrapper) plus the user-facing copy.
- `src/features/repo/useRepoStore.ownership.test.ts` — store trust-and-retry tests.

**Modify:**
- `src-tauri/src/error.rs` — `DubiousOwnership(String)` variant.
- `src-tauri/src/git/mod.rs` — declare `ownership`, add `trust_path` to the trait.
- `src-tauri/src/git/libgit2.rs` — use `map_open_error` in `open`/`init`; fix the nested-repo probe and the init guard; implement `trust_path`.
- `src-tauri/src/git/cli.rs` — `trust_path` stub.
- `src-tauri/src/commands/repo.rs` — `trust_repo_path` command.
- `src-tauri/src/commands/create.rs` — clone-target guard.
- `src-tauri/src/cli.rs` — `resolve_repo_root` ancestor fallback.
- `src-tauri/src/lib.rs` — register `trust_repo_path`.
- `src/lib/errors.ts` — union member, `isDubiousOwnershipError`, `DUBIOUS_OWNERSHIP_HELP`.
- `src/lib/tauri.ts` — `trustRepoPath` wrapper.
- `src/features/repo/useRepoStore.ts` — trust-and-retry in `openRepo`.
- `src/AppShell.tsx` — banner help text for the new kind.

---

### Task 1: Name the condition — `DubiousOwnership` + open/init mapping

**Files:**
- Modify: `src-tauri/src/error.rs`
- Create: `src-tauri/src/git/ownership.rs`
- Modify: `src-tauri/src/git/mod.rs` (add `pub mod ownership;`)
- Modify: `src-tauri/src/git/libgit2.rs` (`open`, `init`)
- Create: `src-tauri/tests/dubious_ownership.rs`

**Interfaces:**
- Produces: `AppError::DubiousOwnership(String)`; `ownership::map_open_error(path: &Path, e: &git2::Error) -> AppError`; `ownership::canonical_string(path: &Path) -> String`.

- [ ] **Step 1: Write the failing test**

Create `src-tauri/tests/dubious_ownership.rs`:

```rust
//! libgit2 refuses to open a repository whose workdir is owned by another
//! user (CVE-2022-24765's check, `GIT_EOWNER`). Under WSL every repo on a
//! `/mnt/c` drvfs mount can trip it. These tests pin the error mapping, the
//! `safe.directory` writer that remedies it, and the presence probe that
//! keeps "refused" from reading as "absent".
//!
//! The refusal itself cannot be provoked here — it needs a directory owned by
//! a different uid. So the mapping is tested against a synthetic `GIT_EOWNER`
//! error, which is exactly the shape libgit2 returns.

mod support;

use std::path::Path;

use git2::{ErrorClass, ErrorCode};
use platypusgit_lib::error::AppError;
use platypusgit_lib::git::ownership;

#[test]
fn eowner_maps_to_dubious_ownership() {
    let err = git2::Error::new(
        ErrorCode::Owner,
        ErrorClass::Config,
        "repository path '/mnt/c/dev/reponame' is not owned by current user",
    );
    let mapped = ownership::map_open_error(Path::new("/mnt/c/dev/reponame"), &err);
    match mapped {
        AppError::DubiousOwnership(p) => assert!(p.ends_with("reponame"), "got {p}"),
        other => panic!("expected DubiousOwnership, got {other:?}"),
    }
}

#[test]
fn missing_repo_still_maps_to_not_a_repo() {
    let err = git2::Error::new(ErrorCode::NotFound, ErrorClass::Repository, "not found");
    assert!(matches!(
        ownership::map_open_error(Path::new("/tmp/nope"), &err),
        AppError::NotARepo(_)
    ));
}

#[test]
fn other_failures_stay_generic() {
    let err = git2::Error::new(ErrorCode::Invalid, ErrorClass::Repository, "broken");
    assert!(matches!(
        ownership::map_open_error(Path::new("/tmp/x"), &err),
        AppError::Git(_)
    ));
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo test --manifest-path src-tauri/Cargo.toml --test dubious_ownership
```

Expected: FAIL — `unresolved import platypusgit_lib::git::ownership`.

- [ ] **Step 3: Add the error variant**

In `src-tauri/src/error.rs`, after `EmbeddedRepo`:

```rust
    /// libgit2 refused to open a repository because its working directory is
    /// owned by a different user (`GIT_EOWNER`, the CVE-2022-24765 check).
    /// Carries the canonicalised path, which is the exact string a
    /// `safe.directory` exception must contain.
    #[error("repository is owned by another user: {0}")]
    DubiousOwnership(String),
```

- [ ] **Step 4: Write the module**

Create `src-tauri/src/git/ownership.rs`:

```rust
//! Everything about libgit2's "dubious ownership" refusal.
//!
//! libgit2 1.9.2 validates that a repository's workdir (and gitdir, and any
//! gitlink) is owned by the current user before opening it — git's
//! CVE-2022-24765 check. On a WSL `/mnt/c` drvfs mount the reported owner
//! routinely disagrees with the WSL uid even for the user's own repository,
//! so the refusal is a normal condition here, not an attack.

use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};

/// The path as libgit2 would spell it: symlinks resolved, no trailing slash,
/// no `.` or `..`. `safe.directory` matching is exact, so the string we hand
/// the user to trust must be the resolved one. Falls back to the input when
/// the path cannot be canonicalised (it may not exist).
pub fn canonical_string(path: &Path) -> String {
    std::fs::canonicalize(path)
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .to_string()
}

/// Classify a failure from `Repository::open`.
///
/// `ErrorCode::Owner` is the one that must not fall through to the generic
/// arm: it is remediable, and only a distinct variant lets the frontend offer
/// the remedy instead of printing libgit2's sentence.
pub fn map_open_error(path: &Path, e: &git2::Error) -> AppError {
    match e.code() {
        git2::ErrorCode::Owner => AppError::DubiousOwnership(canonical_string(path)),
        git2::ErrorCode::NotFound => AppError::NotARepo(path.display().to_string()),
        _ => AppError::Git(e.message().to_string()),
    }
}
```

In `src-tauri/src/git/mod.rs`, next to the other `pub mod` lines:

```rust
pub mod ownership;
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test dubious_ownership
```

Expected: 3 passed.

- [ ] **Step 6: Route `open` and `init` through it**

In `src-tauri/src/git/libgit2.rs`, replace the inline mapping in `GitBackend::open`:

```rust
        let repo = Repository::open(path).map_err(|e| ownership::map_open_error(path, &e))?;
```

`Repository::init` finishes by opening what it created, so it can return
`GIT_EOWNER` too. In `GitBackend::init`, wherever `Repository::init_opts`/
`Repository::init` results are mapped, use the same helper so a WSL init
reports the actionable variant rather than a raw git string. Add the import:

```rust
use crate::git::ownership;
```

- [ ] **Step 7: Verify nothing regressed**

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: all existing suites pass (`libgit2_smoke`, `clone_init`, `embedded_repo`, …).

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/error.rs src-tauri/src/git/ownership.rs src-tauri/src/git/mod.rs src-tauri/src/git/libgit2.rs src-tauri/tests/dubious_ownership.rs
git commit -m "feat(git): name libgit2's dubious-ownership refusal as its own error"
```

---

### Task 2: The remedy — `safe.directory` writer + `trust_repo_path` command

**Files:**
- Modify: `src-tauri/src/git/ownership.rs`
- Modify: `src-tauri/src/git/mod.rs` (trait method)
- Modify: `src-tauri/src/git/libgit2.rs` (impl), `src-tauri/src/git/cli.rs` (stub)
- Modify: `src-tauri/src/commands/repo.rs`, `src-tauri/src/lib.rs`
- Test: `src-tauri/tests/dubious_ownership.rs`

**Interfaces:**
- Consumes: `ownership::canonical_string` (Task 1).
- Produces: `ownership::add_safe_directory(cfg: &mut git2::Config, path: &str) -> AppResult<bool>` (true = written, false = already trusted); `ownership::trust_path(path: &Path) -> AppResult<()>`; `GitBackend::trust_path(&self, path: &Path) -> AppResult<()>`; command `trust_repo_path { path: String } -> ()`.

- [ ] **Step 1: Write the failing tests**

Append to `src-tauri/tests/dubious_ownership.rs`:

```rust
use std::sync::Mutex;

/// libgit2's config search path is process-global; serialise the tests that
/// move it so they cannot see each other's temp home.
static SEARCH_PATH: Mutex<()> = Mutex::new(());

/// Values of every `safe.directory` entry in `file`, in order.
fn safe_dirs(file: &Path) -> Vec<String> {
    let cfg = git2::Config::open(file).unwrap();
    let mut out = Vec::new();
    let mut entries = cfg.entries(Some("safe.directory")).unwrap();
    while let Some(entry) = entries.next() {
        let entry = entry.unwrap();
        out.push(entry.value().unwrap_or_default().to_string());
    }
    out
}

#[test]
fn add_safe_directory_writes_the_exact_path() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("gitconfig");
    std::fs::write(&file, "").unwrap();
    let mut cfg = git2::Config::open(&file).unwrap();

    assert!(ownership::add_safe_directory(&mut cfg, "/mnt/c/dev/reponame").unwrap());

    assert_eq!(safe_dirs(&file), vec!["/mnt/c/dev/reponame".to_string()]);
}

#[test]
fn add_safe_directory_is_idempotent() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("gitconfig");
    std::fs::write(&file, "").unwrap();
    let mut cfg = git2::Config::open(&file).unwrap();

    assert!(ownership::add_safe_directory(&mut cfg, "/mnt/c/dev/reponame").unwrap());
    // Second call reports "already trusted" and writes nothing.
    assert!(!ownership::add_safe_directory(&mut cfg, "/mnt/c/dev/reponame").unwrap());

    assert_eq!(safe_dirs(&file).len(), 1);
}

#[test]
fn add_safe_directory_keeps_existing_entries() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("gitconfig");
    std::fs::write(&file, "[safe]\n\tdirectory = /home/me/other\n").unwrap();
    let mut cfg = git2::Config::open(&file).unwrap();

    ownership::add_safe_directory(&mut cfg, "/mnt/c/dev/reponame").unwrap();

    assert_eq!(
        safe_dirs(&file),
        vec![
            "/home/me/other".to_string(),
            "/mnt/c/dev/reponame".to_string()
        ]
    );
}

#[test]
fn add_safe_directory_accepts_a_trailing_slash_match() {
    // libgit2 normalises config values to a trailing slash before comparing,
    // so `/x/y/` already trusts `/x/y` — do not add a duplicate.
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("gitconfig");
    std::fs::write(&file, "[safe]\n\tdirectory = /mnt/c/dev/reponame/\n").unwrap();
    let mut cfg = git2::Config::open(&file).unwrap();

    assert!(!ownership::add_safe_directory(&mut cfg, "/mnt/c/dev/reponame").unwrap());
    assert_eq!(safe_dirs(&file).len(), 1);
}

#[test]
fn add_safe_directory_respects_a_wildcard() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("gitconfig");
    std::fs::write(&file, "[safe]\n\tdirectory = *\n").unwrap();
    let mut cfg = git2::Config::open(&file).unwrap();

    assert!(!ownership::add_safe_directory(&mut cfg, "/mnt/c/dev/reponame").unwrap());
}

#[test]
fn trust_path_writes_to_the_global_config() {
    let _lock = SEARCH_PATH.lock().unwrap();
    let home = tempfile::tempdir().unwrap();
    // Redirect libgit2's *global* config search at this temp home so the test
    // cannot touch the developer's real ~/.gitconfig.
    unsafe {
        git2::opts::set_search_path(git2::ConfigLevel::Global, home.path()).unwrap();
    }

    let repo = tempfile::tempdir().unwrap();
    ownership::trust_path(repo.path()).unwrap();

    let written = safe_dirs(&home.path().join(".gitconfig"));
    let expected = ownership::canonical_string(repo.path());
    assert_eq!(written, vec![expected]);

    unsafe {
        git2::opts::reset_search_path(git2::ConfigLevel::Global).unwrap();
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test dubious_ownership
```

Expected: FAIL — `add_safe_directory` / `trust_path` not found.

- [ ] **Step 3: Implement the writer**

Append to `src-tauri/src/git/ownership.rs`:

```rust
/// True when `value` (a raw `safe.directory` config value) already trusts
/// `path`. Mirrors libgit2's `validate_ownership_cb`: the literal `*` trusts
/// everything, and a path is compared after normalising to a trailing slash.
fn value_trusts(value: &str, path: &str) -> bool {
    if value == "*" {
        return true;
    }
    let strip = |s: &str| s.trim_end_matches('/').to_string();
    !value.is_empty() && strip(value) == strip(path)
}

/// Add `path` to `cfg`'s `safe.directory` multivar, exactly as
/// `git config --global --add safe.directory <path>` would.
///
/// Returns `false` when an entry already covers the path — re-trusting is a
/// no-op rather than a growing pile of duplicates, because the user can reach
/// this from any entry point and the same repo may be opened many times.
pub fn add_safe_directory(cfg: &mut git2::Config, path: &str) -> AppResult<bool> {
    let mut entries = cfg.entries(Some("safe.directory"))?;
    while let Some(entry) = entries.next() {
        let entry = entry?;
        if value_trusts(entry.value().unwrap_or_default(), path) {
            return Ok(false);
        }
    }
    // `set_multivar` with a regexp that matches nothing appends rather than
    // replacing — the multivar equivalent of `--add`.
    cfg.set_multivar("safe.directory", "^$", path)?;
    Ok(true)
}

/// The global config file, creating it when the user has none yet.
///
/// Writes must land in the *global* level specifically: libgit2 reads
/// `safe.directory` from global config only, never from the repository's own
/// config (it cannot — the repository is not open yet).
fn global_config() -> AppResult<git2::Config> {
    if let Ok(cfg) = git2::Config::open_default().and_then(|c| c.open_level(git2::ConfigLevel::Global))
    {
        return Ok(cfg);
    }
    let path = git2::Config::find_global().or_else(|_| {
        let home = std::env::var_os("HOME")
            .or_else(|| std::env::var_os("USERPROFILE"))
            .ok_or_else(|| AppError::Internal("no home directory to write git config to".into()))?;
        Ok::<PathBuf, AppError>(PathBuf::from(home).join(".gitconfig"))
    })?;
    if !path.exists() {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&path, "")?;
    }
    Ok(git2::Config::open(&path)?)
}

/// Trust `path` for this user, so libgit2 will open it despite the ownership
/// mismatch. The user-facing half of the CVE-2022-24765 escape hatch — always
/// call it behind an explicit confirmation.
pub fn trust_path(path: &Path) -> AppResult<()> {
    let canonical = canonical_string(path);
    let mut cfg = global_config()?;
    add_safe_directory(&mut cfg, &canonical)?;
    Ok(())
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test dubious_ownership
```

Expected: 9 passed.

- [ ] **Step 5: Expose it through the backend trait and a command**

`src-tauri/src/git/mod.rs`, in the trait next to `init`:

```rust
    /// Record `path` in the user's global `safe.directory` list so libgit2
    /// will open it despite an ownership mismatch. Call only after the user
    /// has explicitly confirmed — this is a security exception.
    fn trust_path(&self, path: &Path) -> AppResult<()>;
```

`src-tauri/src/git/libgit2.rs`, in `impl GitBackend for Libgit2Backend`:

```rust
    fn trust_path(&self, path: &Path) -> AppResult<()> {
        ownership::trust_path(path)
    }
```

`src-tauri/src/git/cli.rs`, in `impl GitBackend for CliBackend`:

```rust
    fn trust_path(&self, _path: &Path) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
```

`src-tauri/src/commands/repo.rs`:

```rust
/// Add `path` to the user's global `safe.directory` list. Invoked only from
/// the confirmation the `DubiousOwnership` error raises.
#[tauri::command]
pub async fn trust_repo_path(state: State<'_, AppState>, path: String) -> AppResult<()> {
    let backend = state.backend.clone();
    let path_buf = PathBuf::from(path);
    tokio::task::spawn_blocking(move || backend.trust_path(&path_buf))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}
```

`src-tauri/src/lib.rs`, in `invoke_handler![…]`, next to `open_repo`:

```rust
            commands::repo::trust_repo_path,
```

- [ ] **Step 6: Verify it compiles and the suite is green**

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src src-tauri/tests/dubious_ownership.rs
git commit -m "feat(git): add a confirmed safe.directory exception for refused repos"
```

---

### Task 3: Stop mistaking "refused" for "absent"

**Files:**
- Modify: `src-tauri/src/git/ownership.rs`, `src-tauri/src/git/libgit2.rs`, `src-tauri/src/commands/create.rs`, `src-tauri/src/cli.rs`
- Test: `src-tauri/tests/dubious_ownership.rs`

**Interfaces:**
- Consumes: `ownership::map_open_error` (Task 1).
- Produces: `ownership::RepoPresence { Present, Absent, Refused }`; `ownership::repo_presence(path: &Path) -> RepoPresence`; `ownership::repo_root_for(path: &Path) -> Option<PathBuf>`.

- [ ] **Step 1: Write the failing tests**

Append to `src-tauri/tests/dubious_ownership.rs`:

```rust
use platypusgit_lib::git::ownership::RepoPresence;
use support::TempRepo;

#[test]
fn repo_presence_finds_a_real_repo() {
    let tr = TempRepo::with_initial_commit("hi\n");
    assert_eq!(ownership::repo_presence(tr.path()), RepoPresence::Present);
}

#[test]
fn repo_presence_reports_a_plain_directory_absent() {
    let dir = tempfile::tempdir().unwrap();
    assert_eq!(ownership::repo_presence(dir.path()), RepoPresence::Absent);
}

#[test]
fn repo_root_for_walks_up_from_a_subdirectory() {
    let tr = TempRepo::with_initial_commit("hi\n");
    let nested = tr.path().join("a/b/c");
    std::fs::create_dir_all(&nested).unwrap();

    let found = ownership::repo_root_for(&nested).expect("root");
    assert_eq!(
        ownership::canonical_string(&found),
        ownership::canonical_string(tr.path())
    );
}

#[test]
fn repo_root_for_returns_none_outside_a_repo() {
    let dir = tempfile::tempdir().unwrap();
    assert!(ownership::repo_root_for(dir.path()).is_none());
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test dubious_ownership
```

Expected: FAIL — `RepoPresence` / `repo_presence` / `repo_root_for` not found.

- [ ] **Step 3: Implement the probe and the walk**

Append to `src-tauri/src/git/ownership.rs`:

```rust
/// What is actually at a path, for the call sites that only need to know
/// whether a repository is there.
///
/// The distinction matters: `Repository::open(p).is_ok()` answers "no" both
/// when there is no repository *and* when there is one we are not allowed to
/// open. Collapsing those is what makes an ownership refusal quietly disable
/// the embedded-repo and clone-target guards.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RepoPresence {
    /// A repository is there and openable.
    Present,
    /// Nothing repository-shaped is there.
    Absent,
    /// A repository is there, but libgit2 refused it on ownership grounds.
    Refused,
}

impl RepoPresence {
    /// True when a repository exists at the path, openable or not. Guards
    /// that refuse to act on top of an existing repository want this, not
    /// `Present` — a refused repository is still a repository.
    pub fn exists(self) -> bool {
        matches!(self, RepoPresence::Present | RepoPresence::Refused)
    }
}

/// Probe `path` for a repository without walking up to its ancestors.
pub fn repo_presence(path: &Path) -> RepoPresence {
    match git2::Repository::open(path) {
        Ok(_) => RepoPresence::Present,
        Err(e) if e.code() == git2::ErrorCode::Owner => RepoPresence::Refused,
        Err(_) => RepoPresence::Absent,
    }
}

/// The repository root at or above `path`, found without opening anything.
///
/// `Repository::discover` would be the obvious tool, but it opens what it
/// finds and therefore fails on exactly the repositories this module exists
/// for. Looking for `.git` (a directory for a normal repo, a file for a
/// worktree or submodule) needs no open at all.
pub fn repo_root_for(path: &Path) -> Option<PathBuf> {
    let start = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    start
        .ancestors()
        .find(|dir| dir.join(".git").exists())
        .map(PathBuf::from)
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test dubious_ownership
```

Expected: 13 passed.

- [ ] **Step 5: Fix the nested-repo probe**

In `src-tauri/src/git/libgit2.rs`, the embedded-repo detection currently reads:

```rust
    if Repository::open(&full).is_err() {
        return false;
    }
```

Replace with:

```rust
    // A repository we are not allowed to open is still a repository. Reading
    // `Refused` as "ordinary directory" would silently retire the
    // embedded-repo guard on any filesystem that trips the ownership check,
    // and staging would then write an unresolvable `160000` gitlink.
    if !ownership::repo_presence(&full).exists() {
        return false;
    }
```

- [ ] **Step 6: Fix the init guard**

In `src-tauri/src/git/libgit2.rs`, `GitBackend::init`, replace:

```rust
        if Repository::open(path).is_ok() {
            return Err(AppError::InvalidPath(format!(
                "{} is already a git repository",
                path.display()
            )));
        }
```

with:

```rust
        match ownership::repo_presence(path) {
            ownership::RepoPresence::Present => {
                return Err(AppError::InvalidPath(format!(
                    "{} is already a git repository",
                    path.display()
                )));
            }
            // Refusing to open is not permission to initialise over the top:
            // say what is actually wrong so the user can trust it and retry.
            ownership::RepoPresence::Refused => {
                return Err(AppError::DubiousOwnership(ownership::canonical_string(path)));
            }
            ownership::RepoPresence::Absent => {}
        }
```

- [ ] **Step 7: Fix the clone-target guard**

In `src-tauri/src/commands/create.rs`, replace the `if let Ok(repo) = git2::Repository::open(parent)` block's condition so an ownership refusal still counts. Keep the existing message and the existing comment block above it, and append to that comment:

```rust
    // An ownership-refused directory counts too — it is a repository, we just
    // cannot read its workdir path for the message.
    match git2::Repository::open(parent) {
        Ok(repo) => {
            let enclosing = repo.workdir().unwrap_or_else(|| repo.path()).to_path_buf();
            return Err(AppError::InvalidPath(format!(
                "{} is already a git repository — choose a different folder to clone into",
                enclosing.display()
            )));
        }
        Err(e) if e.code() == git2::ErrorCode::Owner => {
            return Err(AppError::InvalidPath(format!(
                "{} is already a git repository — choose a different folder to clone into",
                parent.display()
            )));
        }
        Err(_) => {}
    }
```

- [ ] **Step 8: Fix the CLI root resolution**

In `src-tauri/src/cli.rs`, `resolve_repo_root` currently drops to the raw path
when `discover` fails — and `discover` opens what it finds, so it fails on an
ownership-refused repository. A subdirectory then reaches `open` and reports
`NotARepo`, and trusting a subdirectory would not help anyway (matching is
exact). Fall back to the non-opening walk:

```rust
pub fn resolve_repo_root(intent: LaunchIntent) -> LaunchIntent {
    let path = intent.path.map(|p| {
        git2::Repository::discover(&p)
            .ok()
            .and_then(|r| r.workdir().map(PathBuf::from))
            // `discover` opens what it finds, so it fails on a repository
            // refused for ownership. The walk does not open anything, which
            // is what lets a `pgit` launch from a subdirectory of such a repo
            // still name the root — the only path a `safe.directory` entry
            // can match.
            .or_else(|| crate::git::ownership::repo_root_for(&p))
            .unwrap_or(p)
    });
    LaunchIntent { path, ..intent }
}
```

- [ ] **Step 9: Run the full backend suite**

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: all pass — `embedded_repo`, `clone_init` and the CLI tests cover the
three guards' normal paths, so they are the regression net for this refactor.

- [ ] **Step 10: Commit**

```bash
git add src-tauri/src src-tauri/tests/dubious_ownership.rs
git commit -m "fix(git): treat an ownership-refused directory as a repository"
```

---

### Task 4: Frontend contract — error mirror, wrapper, confirmation copy

**Files:**
- Modify: `src/lib/errors.ts`, `src/lib/tauri.ts`
- Create: `src/features/repo/ownership.ts`

**Interfaces:**
- Consumes: command `trust_repo_path` (Task 2), `AppError::DubiousOwnership` (Task 1).
- Produces: `isDubiousOwnershipError(e)`, `dubiousOwnershipPath(e)`, `DUBIOUS_OWNERSHIP_HELP`, `trustRepoPath(path)`, `confirmTrust(path)`.

- [ ] **Step 1: Mirror the variant**

In `src/lib/errors.ts`, add to the union (keeping it 1:1 with the Rust enum):

```ts
  | { kind: "DubiousOwnership"; message: string }
```

and below the embedded-repo helpers:

```ts
export function isDubiousOwnershipError(e: unknown): boolean {
  return isAppError(e) && e.kind === "DubiousOwnership";
}

/**
 * The path the backend refused. The Rust message is
 * `repository is owned by another user: <path>` — the prefix is stripped here
 * for the same reason the embedded-repo prose lives here: the backend enum
 * stays terse, the UI owns the words.
 */
export function dubiousOwnershipPath(e: unknown): string | null {
  if (!isDubiousOwnershipError(e)) return null;
  return appErrorMessage(e).replace(/^repository is owned by another user: /, "");
}

/**
 * Why this happens and what trusting it means. git refuses to open a
 * repository owned by someone else because that repository's own config can
 * run commands (`core.pager`, `core.fsmonitor`) the moment it is opened. On a
 * WSL `/mnt/c` mount the owner mismatch is an artefact of the mount, not a
 * threat — but the app cannot tell those apart, so the user does.
 */
export const DUBIOUS_OWNERSHIP_HELP =
  "git refuses to open a repository owned by another user, because opening one can run commands from its config. This is common for repositories on a Windows drive under WSL. Trusting it adds a safe.directory entry to your global git config.";
```

- [ ] **Step 2: Add the typed wrapper**

In `src/lib/tauri.ts`, next to `openRepo`:

```ts
export async function trustRepoPath(path: string): Promise<void> {
  return invoke<void>("trust_repo_path", { path });
}
```

- [ ] **Step 3: Add the confirmation**

Create `src/features/repo/ownership.ts`:

```ts
import { pgConfirm } from "@/design";
import { DUBIOUS_OWNERSHIP_HELP } from "@/lib/errors";

/**
 * Ask before writing a `safe.directory` exception.
 *
 * Kept out of the store so the store's own tests can decide the answer
 * without mounting a dialog host, and so the copy sits next to the help text
 * rather than inside a state machine.
 */
export async function confirmTrust(path: string): Promise<boolean> {
  return pgConfirm({
    title: "Trust this repository?",
    body: `${path}\n\n${DUBIOUS_OWNERSHIP_HELP}`,
    confirmLabel: "Trust and open",
  });
}
```

- [ ] **Step 4: Type-check**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm tsc --noEmit
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/errors.ts src/lib/tauri.ts src/features/repo/ownership.ts
git commit -m "feat(errors): mirror DubiousOwnership and its remedy into the frontend"
```

---

### Task 5: Trust-and-retry in the store

**Files:**
- Modify: `src/features/repo/useRepoStore.ts`
- Test: `src/features/repo/useRepoStore.ownership.test.ts`

**Interfaces:**
- Consumes: `confirmTrust` (Task 4), `trustRepoPath` (Task 4), `dubiousOwnershipPath` (Task 4).

- [ ] **Step 1: Write the failing test**

Create `src/features/repo/useRepoStore.ownership.test.ts`:

```ts
// Opening a repo on a filesystem libgit2 says is owned by someone else (the
// WSL /mnt/c case) must offer the safe.directory remedy and retry — from the
// store, so every entry point (Welcome, recents, CLI launch, palette) gets it.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useRepoStore } from "@/features/repo/useRepoStore";
import { getInvokeCalls, mockInvoke } from "@/test/invokeMock";

const confirmTrust = vi.hoisted(() => vi.fn());
vi.mock("@/features/repo/ownership", () => ({ confirmTrust }));

const REFUSED = {
  kind: "DubiousOwnership",
  message: "repository is owned by another user: /mnt/c/dev/reponame",
};
const HANDLE = { id: "repo-1", path: "/mnt/c/dev/reponame", head: "main" };

const initial = useRepoStore.getState();

/** `open_repo` refuses `failures` times, then succeeds. */
function armOpen(failures: number) {
  let seen = 0;
  mockInvoke("open_repo", () => {
    if (seen++ < failures) throw REFUSED;
    return HANDLE;
  });
}

beforeEach(() => {
  useRepoStore.setState(initial, true);
  useRepoStore.setState({ refreshAll: async () => {} });
  confirmTrust.mockReset();
  mockInvoke("trust_repo_path", () => null);
});

const calls = (cmd: string) => getInvokeCalls().filter((c) => c.cmd === cmd);

describe("useRepoStore.openRepo — dubious ownership", () => {
  it("trusts the path and retries when the user accepts", async () => {
    armOpen(1);
    confirmTrust.mockResolvedValue(true);

    await useRepoStore.getState().openRepo("/mnt/c/dev/reponame");

    expect(confirmTrust).toHaveBeenCalledWith("/mnt/c/dev/reponame");
    expect(calls("trust_repo_path")).toHaveLength(1);
    expect(useRepoStore.getState().current).toEqual(HANDLE);
    expect(useRepoStore.getState().error).toBeNull();
  });

  it("leaves the error banner alone when the user declines", async () => {
    armOpen(1);
    confirmTrust.mockResolvedValue(false);

    await useRepoStore.getState().openRepo("/mnt/c/dev/reponame");

    expect(calls("trust_repo_path")).toHaveLength(0);
    expect(useRepoStore.getState().error?.kind).toBe("DubiousOwnership");
    expect(useRepoStore.getState().current).toBeNull();
  });

  it("does not loop when trusting fails to help", async () => {
    armOpen(99);
    confirmTrust.mockResolvedValue(true);

    await useRepoStore.getState().openRepo("/mnt/c/dev/reponame");

    // One prompt, one retry — never a second round.
    expect(confirmTrust).toHaveBeenCalledTimes(1);
    expect(calls("open_repo")).toHaveLength(2);
    expect(useRepoStore.getState().error?.kind).toBe("DubiousOwnership");
  });

  it("leaves other open failures untouched", async () => {
    mockInvoke("open_repo", () => {
      throw { kind: "NotARepo", message: "path is not a git repository: /tmp/x" };
    });

    await useRepoStore.getState().openRepo("/tmp/x");

    expect(confirmTrust).not.toHaveBeenCalled();
    expect(useRepoStore.getState().error?.kind).toBe("NotARepo");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test -- src/features/repo/useRepoStore.ownership.test.ts
```

Expected: FAIL — no prompt, `trust_repo_path` never invoked.

- [ ] **Step 3: Implement**

In `src/features/repo/useRepoStore.ts`, add imports:

```ts
import { confirmTrust } from "@/features/repo/ownership";
import { dubiousOwnershipPath, isDubiousOwnershipError } from "@/lib/errors";
import { trustRepoPath } from "@/lib/tauri";
```

Rewrite the `openRepo` action so the success path is shared and the retry is
bounded by an argument rather than by store state:

```ts
  async openRepo(path) {
    set({ loading: true, error: null });
    try {
      await applyOpenedRepo(set, get, path);
    } catch (e) {
      // A repository libgit2 refuses on ownership grounds is remediable, and
      // handling it here rather than per-screen covers Welcome, recents, the
      // CLI launch and the palette at once. `mayTrust` is spent by the retry,
      // so a trust that does not help surfaces the error instead of looping.
      if (isDubiousOwnershipError(e)) {
        const target = dubiousOwnershipPath(e) ?? path;
        if (await confirmTrust(target)) {
          try {
            await trustRepoPath(target);
            await applyOpenedRepo(set, get, path);
            return;
          } catch (retryError) {
            set({ loading: false, error: toAppError(retryError) });
            return;
          }
        }
      }
      set({ loading: false, error: toAppError(e) });
    }
  },
```

with the shared success path lifted to module scope, above `useRepoStore`:

```ts
/** Open `path` and reset the per-repo slices. Throws on failure. */
async function applyOpenedRepo(
  set: (partial: Partial<RepoStore>) => void,
  get: () => RepoStore,
  path: string,
): Promise<void> {
  const handle = await openRepo(path);
  useRecentsStore.getState().addRecent(handle.path);
  set({
    current: handle,
    status: [],
    allFiles: [],
    branches: [],
    tags: [],
    stashes: [],
    remotes: [],
    commits: [],
    searchResults: null,
    commitFilter: {},
    lastRebaseSummary: null,
    logRef: null,
    commitCursor: null,
    searchCursor: null,
  });
  await get().refreshAll();
}
```

(Use the store's real state type in place of `RepoStore` if it is named
differently in this file, and match the existing `set` signature.)

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm test -- src/features/repo/useRepoStore.ownership.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: Run the whole frontend suite**

```bash
pnpm test
pnpm tsc --noEmit
```

Expected: green — the other `useRepoStore.*` tests are the regression net for
the `applyOpenedRepo` extraction.

- [ ] **Step 6: Commit**

```bash
git add src/features/repo/useRepoStore.ts src/features/repo/useRepoStore.ownership.test.ts
git commit -m "feat(repo): offer the safe.directory remedy when a repo is refused"
```

---

### Task 6: Say it plainly in the error banner

**Files:**
- Modify: `src/AppShell.tsx`

**Interfaces:**
- Consumes: `DUBIOUS_OWNERSHIP_HELP`, `dubiousOwnershipPath` (Task 4).

- [ ] **Step 1: Extend the banner**

`AppShell` already special-cases `EmbeddedRepo` to swap the enum name for a
readable label and append help text. Give the new kind the same treatment —
a dismissed trust prompt must not leave the user staring at libgit2's
sentence with no idea what to do. Update the label expression:

```tsx
            {error.kind === "EmbeddedRepo"
              ? "Embedded repository"
              : error.kind === "DubiousOwnership"
                ? "Repository owned by another user"
                : error.kind}
            :
```

and the body expression, keeping the existing embedded-repo arm:

```tsx
            {error.kind === "DubiousOwnership"
              ? `${dubiousOwnershipPath(error)} — ${DUBIOUS_OWNERSHIP_HELP}`
              : error.kind === "EmbeddedRepo"
                ? `${appErrorMessage(error).replace(/^embedded repository: /, "")} — ${EMBEDDED_REPO_HELP}`
                : appErrorMessage(error)}
```

Add `DUBIOUS_OWNERSHIP_HELP` and `dubiousOwnershipPath` to the existing
`@/lib/errors` import.

- [ ] **Step 2: Verify**

```bash
pnpm tsc --noEmit
pnpm test
```

Expected: green.

- [ ] **Step 3: Commit**

```bash
git add src/AppShell.tsx
git commit -m "feat(shell): explain a dubious-ownership refusal in the error banner"
```

---

### Task 7: Full verification and PR

- [ ] **Step 1: Run every layer**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo test --manifest-path src-tauri/Cargo.toml
pnpm test
pnpm tsc --noEmit
pnpm exec tsc -p e2e/tsconfig.json --noEmit
```

Expected: all green. Record the actual counts — do not claim a pass without them.

- [ ] **Step 2: Run the e2e specs the change can touch**

Only `open`-path specs are affected, and only through code that is unchanged
on a normally-owned repository. Rebuild this worktree's snapshot first,
because `run` silently tests a stale binary:

```bash
pnpm test:e2e:docker build
pnpm test:e2e:docker run --spec e2e/specs/smoke.e2e.ts --spec e2e/specs/create.e2e.ts
```

`smoke` covers the open path end to end; `create.e2e.ts` covers init and
clone, whose guards Task 3 rewrites. Nothing else touches changed code.

- [ ] **Step 3: Squash and open the PR**

```bash
git fetch origin
git rebase origin/main
git reset --soft origin/main
git commit -m "$(cat <<'EOF'
fix(git): make WSL /mnt/c repositories openable (#83)

Why: libgit2 1.9.2 enforces git's CVE-2022-24765 ownership check, and a
drvfs /mnt/c mount routinely reports an owner that differs from the WSL
uid. The refusal stringified into a generic error with no way forward.

Adds AppError::DubiousOwnership, a confirmed per-repository
safe.directory exception, and corrects four call sites that read an
ownership refusal as "no repository here" — two of which silently
disabled a guard.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
git push -u origin fix/wsl-dubious-ownership
```

Then open the PR with a body that states: the libgit2 behaviour and why WSL
trips it; what the user now sees (confirmation, then the repo opens); the two
guards that were silently disabled by the old `is_ok()` probes; that
`set_verify_owner_validation(false)` was considered and rejected; and the
verification actually run (test counts per layer, plus which e2e specs).
Close with `Closes #83`.
