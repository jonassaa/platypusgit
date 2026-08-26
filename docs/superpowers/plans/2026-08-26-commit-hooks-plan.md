# Commit-side git hooks — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run `pre-commit`, `prepare-commit-msg`, `commit-msg` and `post-commit`
when the app commits; give the user a visible per-invocation `--no-verify` on
commit and push; and make hooks that call `node`/`python`/`pnpm` work under a
Dock or `.desktop` launch.

**Architecture:** Keep the libgit2 commit and wrap it in hook calls, so the one
signing chain in `libgit2.rs::sign_payload` stays the only one. Hooks are
executed by `git hook run` — git's own hook resolution (`core.hooksPath`,
executable bit, Windows `sh`) — behind a cached, side-effect-free capability
probe, with a Unix-only direct-exec fallback for git older than 2.36. The
environment fix is a cached login-shell `PATH` probe applied by every `proc.rs`
constructor.

**Tech Stack:** Rust (`git2`, `tokio`, `thiserror`, `serde`), React + TypeScript,
Zustand, vitest, WebdriverIO.

**Spec:** `docs/superpowers/specs/2026-08-26-commit-hooks-spec.md`

## Global Constraints

- **One signing chain.** Never shell out to `git commit`. All signing stays in
  `libgit2.rs::sign_payload`. (CLAUDE.md)
- **Never `Command::new` outside `src-tauri/src/proc.rs`** —
  `src-tauri/tests/spawn_no_window.rs` fails the build otherwise. All hook
  spawning goes through a `proc.rs` constructor.
- **Every IPC-crossing fn returns `AppResult<T>`.** Add `AppError` variants;
  never stringify. The TS `AppError` union in `src/lib/errors.ts` stays 1:1 with
  the Rust enum, **updated in the same commit**.
- `AppError` serializes as `#[serde(tag = "kind", content = "message")]`, so a
  struct payload arrives as `{ kind, message: {…} }` — follow the existing
  `Auth(AuthChallenge)` newtype pattern, not named fields.
- **A new per-repo field must join `RepoSlice` AND `emptySlice`**, or tab
  switches leak it between repositories. (CLAUDE.md)
- **`git2::Repository` is `Send` not `Sync`** — all git2 work stays inside
  `tokio::task::spawn_blocking`.
- **No native `<select>`/`<option>`**; design system lives in `src/design/`,
  imported from `@/design`; never hardcode the accent hue.
- **A non-zero `pre-commit`, `prepare-commit-msg` or `commit-msg` creates no
  object and moves no reference.** `post-commit`'s exit code is ignored.
- **`no_verify` is never persisted** — no settings-store key, no default. It is
  per-invocation only.
- Register every new command name in `invoke_handler![…]` in
  `src-tauri/src/lib.rs`, and add it to the matching `commands/<area>.rs` entry
  in `docs/dev/architecture.md`, or `test/docs.test.ts` fails the build.
- Toolchain: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"` before
  any `pnpm`/`cargo`.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src-tauri/src/proc.rs` (modify) | Cached login-shell `PATH`; every constructor applies it |
| `src-tauri/src/git/hooks.rs` (create) | The only place a hook is spawned: `git hook run`, capability probe, direct-exec fallback |
| `src-tauri/src/error.rs` (modify) | `AppError::HookRejected(HookRejection)` |
| `src-tauri/src/git/types.rs` (modify) | `CommitOptions.no_verify`, `CommitResult` |
| `src-tauri/src/git/libgit2.rs` (modify) | `commit()` hook sequence; index read moves after `pre-commit` |
| `src-tauri/src/git/mod.rs` (modify) | `commit` returns `CommitResult` |
| `src-tauri/src/git/cli.rs` (modify) | `CliBackend` stub kept in shape |
| `src-tauri/src/commands/commits.rs` (modify) | `commit` takes `no_verify`, returns `CommitResult` |
| `src-tauri/src/commands/branches.rs` (modify) | `push_args` + `push` take `no_verify` |
| `src-tauri/tests/hooks.rs` (create) | The contract: real hook scripts against temp repos |
| `src/lib/errors.ts` (modify) | `HookRejected` union member + prose |
| `src/lib/types.ts` (modify) | `CommitResult`, `HookRejection` |
| `src/lib/tauri.ts` (modify) | `commit`/`push` wrappers take `noVerify` |
| `src/design/hook-output.tsx` (create) | The collapsible monospace output block |
| `src/features/repo/useRepoStore.ts` (modify) | `hookRejection` per-repo field; actions carry `noVerify` |
| `src/screens/CommitPanel.tsx` (modify) | Output block, checkbox, retry |
| `docs/dev/backend.md`, `docs/dev/architecture.md` (modify) | The hook chain; new module + command entries |
| `e2e/specs/commit.e2e.ts` (modify) | Rejecting `pre-commit` → block visible → retry succeeds |

---

## Task 1: Login-shell `PATH` resolution in `proc.rs`

Independent of every other task; land it first so hooks inherit a working
environment the moment they exist.

**Files:**
- Modify: `src-tauri/src/proc.rs`

**Interfaces:**
- Consumes: nothing.
- Produces: `pub fn login_path() -> Option<&'static str>` (cached);
  `fn apply_env(cmd: &mut std::process::Command)` /
  `fn apply_env_async(cmd: &mut tokio::process::Command)`, called by every
  existing constructor. `pub(crate) fn parse_probe_output(raw: &str) ->
  Option<String>` exposed for unit tests.

- [ ] **Step 1: Write the failing parser tests**

In `src-tauri/src/proc.rs`, inside `mod tests`:

```rust
const MARK: &str = "__PGIT_PATH__";

#[test]
fn parses_path_between_markers_ignoring_rc_noise() {
    let raw = format!(
        "Welcome to your shell!\nnvm: loaded\n{MARK}/opt/homebrew/bin:/usr/bin{MARK}\nbye\n"
    );
    assert_eq!(
        parse_probe_output(&raw).as_deref(),
        Some("/opt/homebrew/bin:/usr/bin")
    );
}

#[test]
fn rejects_output_with_no_markers() {
    assert_eq!(parse_probe_output("just noise\n"), None);
}

#[test]
fn rejects_a_single_unterminated_marker() {
    // A shell killed by the timeout mid-print must not yield a truncated PATH.
    assert_eq!(parse_probe_output(&format!("{MARK}/opt/homebrew/bin")), None);
}

#[test]
fn rejects_an_empty_path_between_markers() {
    assert_eq!(parse_probe_output(&format!("{MARK}{MARK}")), None);
}
```

- [ ] **Step 2: Run them and confirm they fail**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo test --manifest-path src-tauri/Cargo.toml proc:: 2>&1 | tail -20
```

Expected: FAIL — `cannot find function 'parse_probe_output'`.

- [ ] **Step 3: Implement the probe, the parser and the cache**

Add to `src-tauri/src/proc.rs`. Note the doc comment carries the *why*, matching
the file's existing style.

```rust
/// Marker wrapped around the probe's payload. An rc file is free to print
/// banners, version notices and nvm chatter; only what lies between two markers
/// is ours.
const PATH_MARK: &str = "__PGIT_PATH__";

/// How long the login shell gets. An rc file can block on a prompt or a slow
/// network mount, and a GUI app that hangs at startup is worse than one with a
/// short PATH.
const PROBE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

/// Extract the payload from a probe's stdout, or `None` if it is unusable.
///
/// Requires BOTH markers: a shell killed by the timeout mid-print would
/// otherwise yield a truncated PATH, which is worse than no PATH because it
/// looks like it worked.
pub(crate) fn parse_probe_output(raw: &str) -> Option<String> {
    let start = raw.find(PATH_MARK)? + PATH_MARK.len();
    let rest = &raw[start..];
    let end = rest.find(PATH_MARK)?;
    let path = rest[..end].trim();
    if path.is_empty() {
        return None;
    }
    Some(path.to_string())
}

/// The user's login-shell `PATH`, resolved once.
///
/// # Why this exists
///
/// A GUI launch (Dock, Finder, a `.desktop` file) inherits launchd's or the
/// session manager's minimal environment, not the login shell's. A launch
/// through our own `pgit` CLI inherits the terminal's. So a `pre-commit` hook
/// calling `node`, or a `gpg.program` that lives in `/opt/homebrew/bin`, works
/// or fails depending on **how the app was started** — which is the worst kind
/// of bug to debug from a report.
///
/// # Why a login shell rather than a list of likely directories
///
/// nvm, asdf, pyenv, rbenv and fnm all put their shims in version-specific
/// directories that cannot be guessed (`~/.nvm/versions/node/v22.3.0/bin`).
/// Asking the shell is the only way to find them. A static list is the fallback
/// when the probe fails, not the mechanism.
///
/// Returns `None` on Windows (a GUI process there inherits the user and machine
/// `PATH` from the registry, so there is nothing to fix) and whenever the probe
/// fails — in which case children inherit our environment exactly as they do
/// today, so a failure is never worse than the status quo.
pub fn login_path() -> Option<&'static str> {
    static CACHE: std::sync::OnceLock<Option<String>> = std::sync::OnceLock::new();
    CACHE.get_or_init(probe_login_path).as_deref()
}

#[cfg(windows)]
fn probe_login_path() -> Option<String> {
    None
}

#[cfg(not(windows))]
fn probe_login_path() -> Option<String> {
    let shell = std::env::var("SHELL").ok().filter(|s| !s.is_empty())?;

    // `-l` so profile files run (that is where the version managers are); `-c`
    // with `printf` rather than `echo` because `echo` is a builtin whose
    // escape handling differs between shells.
    let script = format!("printf '%s%s%s' '{PATH_MARK}' \"$PATH\" '{PATH_MARK}'");

    // Deliberately NOT `program()`: this is the one child that must not inherit
    // the environment we are trying to replace, and it is never a console
    // program on Windows because it does not run there at all.
    let mut cmd = std::process::Command::new(&shell);
    cmd.arg("-l")
        .arg("-c")
        .arg(&script)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());

    let mut child = cmd.spawn().ok()?;

    // Poll rather than `wait_with_output`, which has no timeout. An rc file that
    // blocks must not hang the first spawn that needs a PATH.
    let deadline = std::time::Instant::now() + PROBE_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if std::time::Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
            Ok(None) => std::thread::sleep(std::time::Duration::from_millis(25)),
            Err(_) => return None,
        }
    }

    use std::io::Read;
    let mut raw = String::new();
    child.stdout.as_mut()?.read_to_string(&mut raw).ok()?;
    parse_probe_output(&raw)
}

/// Apply the resolved `PATH` to a child. No-op when the probe found nothing.
fn apply_env(cmd: &mut std::process::Command) {
    if let Some(p) = login_path() {
        cmd.env("PATH", p);
    }
}

fn apply_env_async(cmd: &mut tokio::process::Command) {
    if let Some(p) = login_path() {
        cmd.env("PATH", p);
    }
}
```

- [ ] **Step 4: Call `apply_env` from every constructor**

Add the call to `program`, `program_async`, `git`, `git_async`, `git_async_in`,
`git_async_keeping_console` and `program_async_keeping_console` — all seven, so
signing, `$EDITOR`, mergetool and the git-lfs probe are fixed alongside hooks.
In `program` for example:

```rust
pub fn program(prog: impl AsRef<OsStr>) -> std::process::Command {
    let mut cmd = std::process::Command::new(prog);
    silence(&mut cmd);
    apply_env(&mut cmd);
    cmd
}
```

- [ ] **Step 5: Warm the cache off the main thread at startup**

In `src-tauri/src/lib.rs`, in the setup hook, before any command can run:

```rust
// Resolve the login-shell PATH off the main thread: the probe spawns a shell
// that runs the user's rc files, which is slow enough to be visible at launch.
// Nothing awaits this — the first spawn that needs a PATH blocks on the same
// OnceLock and gets the answer.
std::thread::spawn(|| {
    let _ = crate::proc::login_path();
});
```

- [ ] **Step 6: Run the tests and the guard test**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo test --manifest-path src-tauri/Cargo.toml proc:: 2>&1 | tail -20
cargo test --manifest-path src-tauri/Cargo.toml --test spawn_no_window 2>&1 | tail -20
```

Expected: parser tests PASS. **The guard test may FAIL** on the new
`Command::new(&shell)` — it is inside `proc.rs`, which is allowed, so if it fails
read `src-tauri/tests/spawn_no_window.rs` and confirm it scopes to files other
than `proc.rs`; if it scopes by call *name*, add this site to its allow-list with
a comment saying why (the probe must not inherit the environment it replaces).

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/proc.rs src-tauri/src/lib.rs
git commit -m "fix(proc): resolve the login-shell PATH for every spawned child"
```

---

## Task 2: `git/hooks.rs` — the hook runner

**Files:**
- Create: `src-tauri/src/git/hooks.rs`
- Modify: `src-tauri/src/git/mod.rs` (add `pub mod hooks;`)

**Interfaces:**
- Consumes: `crate::proc::git` (Task 1).
- Produces:
  ```rust
  pub struct HookOutcome { pub ran: bool, pub code: i32, pub output: String }
  impl HookOutcome { pub fn rejected(&self) -> bool }
  pub fn run_hook(workdir: &Path, name: &str, args: &[&str]) -> AppResult<HookOutcome>;
  ```

- [ ] **Step 1: Write the failing tests**

Create `src-tauri/tests/hooks.rs`. The helpers here are reused by Task 4, so
write them once and well.

```rust
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

/// A temp repo with one commit, an identity, and a hooks dir.
pub fn temp_repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().expect("tempdir");
    let p = dir.path();
    run(p, &["init", "-q", "."]);
    run(p, &["config", "user.email", "t@example.com"]);
    run(p, &["config", "user.name", "T"]);
    fs::write(p.join("seed.txt"), "seed\n").unwrap();
    run(p, &["add", "seed.txt"]);
    run(p, &["commit", "-q", "-m", "seed"]);
    dir
}

fn run(cwd: &Path, args: &[&str]) {
    let out = Command::new("git").current_dir(cwd).args(args).output().unwrap();
    assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
}

/// Write an executable hook. On Unix sets the exec bit, which git requires.
pub fn write_hook(repo: &Path, name: &str, body: &str) -> PathBuf {
    let dir = repo.join(".git").join("hooks");
    fs::create_dir_all(&dir).unwrap();
    let path = dir.join(name);
    fs::write(&path, body).unwrap();
    set_executable(&path);
    path
}

pub fn set_executable(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(path).unwrap().permissions();
        perms.set_mode(0o755);
        fs::set_permissions(path, perms).unwrap();
    }
    #[cfg(not(unix))]
    let _ = path;
}

#[test]
fn a_rejecting_hook_reports_its_output_and_code() {
    let repo = temp_repo();
    write_hook(
        repo.path(),
        "pre-commit",
        "#!/bin/sh\necho 'lint failed on a.ts'\nexit 3\n",
    );
    let out = platypusgit_lib::git::hooks::run_hook(repo.path(), "pre-commit", &[]).unwrap();
    assert!(out.ran, "the hook exists and is executable, so it ran");
    assert_eq!(out.code, 3, "exit code propagates verbatim");
    assert!(out.rejected());
    assert!(
        out.output.contains("lint failed on a.ts"),
        "hook stdout must be captured — git hook run sends it to stderr: {}",
        out.output
    );
}

#[test]
fn a_passing_hook_is_not_a_rejection_but_its_output_is_still_captured() {
    let repo = temp_repo();
    write_hook(repo.path(), "pre-commit", "#!/bin/sh\necho 'reformatted 2 files'\nexit 0\n");
    let out = platypusgit_lib::git::hooks::run_hook(repo.path(), "pre-commit", &[]).unwrap();
    assert!(out.ran);
    assert!(!out.rejected());
    assert!(out.output.contains("reformatted 2 files"));
}

#[test]
fn a_missing_hook_is_not_an_error() {
    let repo = temp_repo();
    let out = platypusgit_lib::git::hooks::run_hook(repo.path(), "commit-msg", &[]).unwrap();
    assert!(!out.ran, "absent hook did not run");
    assert!(!out.rejected(), "absent is not a rejection");
}

#[test]
fn a_non_executable_hook_is_skipped_like_git_skips_it() {
    let repo = temp_repo();
    let path = write_hook(repo.path(), "pre-commit", "#!/bin/sh\nexit 1\n");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&path).unwrap().permissions();
        perms.set_mode(0o644);
        fs::set_permissions(&path, perms).unwrap();
    }
    let out = platypusgit_lib::git::hooks::run_hook(repo.path(), "pre-commit", &[]).unwrap();
    assert!(!out.rejected(), "a hook git would skip must not reject the commit");
}

#[test]
fn core_hooks_path_is_honoured() {
    let repo = temp_repo();
    let custom = repo.path().join("myhooks");
    fs::create_dir_all(&custom).unwrap();
    let path = custom.join("pre-commit");
    fs::write(&path, "#!/bin/sh\necho 'from myhooks'\nexit 7\n").unwrap();
    set_executable(&path);
    // The hook in the default location must lose.
    write_hook(repo.path(), "pre-commit", "#!/bin/sh\necho 'from .git/hooks'\nexit 0\n");
    run(repo.path(), &["config", "core.hooksPath", "myhooks"]);

    let out = platypusgit_lib::git::hooks::run_hook(repo.path(), "pre-commit", &[]).unwrap();
    assert_eq!(out.code, 7);
    assert!(out.output.contains("from myhooks"));
    assert!(!out.output.contains("from .git/hooks"));
}

#[test]
fn args_reach_the_hook_and_a_rewrite_of_arg_one_survives() {
    let repo = temp_repo();
    write_hook(
        repo.path(),
        "prepare-commit-msg",
        "#!/bin/sh\nprintf 'source=%s\\n' \"$2\"\necho 'appended' >> \"$1\"\n",
    );
    let msg = repo.path().join(".git").join("COMMIT_EDITMSG");
    fs::write(&msg, "original\n").unwrap();

    let out = platypusgit_lib::git::hooks::run_hook(
        repo.path(),
        "prepare-commit-msg",
        &[msg.to_str().unwrap(), "message"],
    )
    .unwrap();

    assert!(!out.rejected());
    assert!(out.output.contains("source=message"));
    let after = fs::read_to_string(&msg).unwrap();
    assert!(after.contains("appended"), "the hook's rewrite must persist: {after}");
}
```

- [ ] **Step 2: Run and confirm they fail**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo test --manifest-path src-tauri/Cargo.toml --test hooks 2>&1 | tail -20
```

Expected: FAIL to compile — `hooks` module does not exist. If `tempfile` is not
already a dev-dependency, add it (`cargo add --dev tempfile --manifest-path
src-tauri/Cargo.toml`); check first, other integration tests likely use it.

- [ ] **Step 3: Implement `hooks.rs`**

```rust
//! The one place a git hook is executed (issue 232).
//!
//! # Why `git hook run` and not the script directly
//!
//! Executing `.git/hooks/pre-commit` ourselves means re-implementing git's
//! contract: resolve `core.hooksPath`, honour the executable bit, and — the one
//! that silently breaks Windows — run the script through git's bundled `sh`,
//! because a hook is a shell script and Windows has no shebang. Getting that
//! last part wrong means hooks quietly do not run on Windows, which is the
//! exact bug this module exists to fix.
//!
//! `git hook run` is git doing all of it. Verified in a scratch repo: it
//! propagates the hook's exit code, respects `core.hooksPath`, skips a
//! non-executable hook with git's own advice hint, and passes arguments after
//! `--`.
//!
//! # The one surprise worth knowing
//!
//! **`git hook run` redirects the hook's stdout to stderr**, so a hook's output
//! arrives on stderr whether it succeeded or failed. We capture stderr and
//! ignore stdout; the reverse captures nothing at all.

use std::path::Path;
use std::sync::OnceLock;

use crate::error::{AppError, AppResult};

/// What running one hook did.
#[derive(Debug, Clone)]
pub struct HookOutcome {
    /// False when no hook by that name exists, or git skipped it as
    /// non-executable. Not an error: most repos have no hooks.
    pub ran: bool,
    /// The hook's exit status. 0 when it did not run.
    pub code: i32,
    /// Everything the hook printed, stdout and stderr interleaved as git
    /// delivers them.
    pub output: String,
}

impl HookOutcome {
    /// A hook that ran and refused. The only condition that must stop a commit.
    pub fn rejected(&self) -> bool {
        self.ran && self.code != 0
    }
}

/// A hook name that cannot exist, used to ask git whether it has the
/// `hook` subcommand at all. Side-effect-free by construction: with
/// `--ignore-missing` there is nothing to run, so a supporting git exits 0
/// silently and an older one exits non-zero with
/// `git: 'hook' is not a git command`.
const PROBE_HOOK: &str = "pg-capability-probe";

/// Does this git have `git hook run`? Probed once, cached.
///
/// Deliberately not `git --version` parsing: comparing version strings is a bug
/// waiting to happen, and the capability is directly askable. `git hook run`
/// arrived in git 2.36; Ubuntu 22.04 LTS is supported into 2027 and ships 2.34,
/// so the fallback is not hypothetical.
fn has_hook_subcommand(workdir: &Path) -> bool {
    static CACHE: OnceLock<bool> = OnceLock::new();
    *CACHE.get_or_init(|| {
        crate::proc::git(workdir)
            .args(["hook", "run", "--ignore-missing", PROBE_HOOK])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    })
}

/// Run hook `name` with `args`, if it exists.
///
/// Never returns `Err` for a hook that merely refused — that is
/// `HookOutcome::rejected`, which the caller turns into
/// `AppError::HookRejected` with the hook's own output. `Err` here means we
/// could not run git at all.
pub fn run_hook(workdir: &Path, name: &str, args: &[&str]) -> AppResult<HookOutcome> {
    if has_hook_subcommand(workdir) {
        run_via_git_hook(workdir, name, args)
    } else {
        fallback::run_direct(workdir, name, args)
    }
}

fn run_via_git_hook(workdir: &Path, name: &str, args: &[&str]) -> AppResult<HookOutcome> {
    let mut cmd = crate::proc::git(workdir);
    cmd.args(["hook", "run", "--ignore-missing", name]);
    if !args.is_empty() {
        cmd.arg("--");
        cmd.args(args);
    }
    let out = cmd.output().map_err(|e| AppError::Io(e.to_string()))?;

    // Hook output arrives on stderr — including its stdout. See the module note.
    let output = String::from_utf8_lossy(&out.stderr).trim().to_string();
    let code = out.status.code().unwrap_or(-1);

    // `--ignore-missing` exits 0 with nothing printed when the hook is absent.
    // A hook that ran and passed also exits 0, and may or may not print. Both
    // are `rejected() == false`, so distinguishing them only affects `ran`,
    // which is reported for logging rather than branched on.
    Ok(HookOutcome {
        ran: code != 0 || !output.is_empty(),
        code,
        output,
    })
}

/// Direct execution, for a git without `git hook run`.
///
/// Unix only in practice: Windows always has a current Git for Windows, so this
/// path never needs git's `sh` shim. A shebang'd executable script runs itself.
mod fallback {
    use super::*;

    pub fn run_direct(workdir: &Path, name: &str, args: &[&str]) -> AppResult<HookOutcome> {
        let Some(path) = resolve(workdir, name) else {
            return Ok(HookOutcome { ran: false, code: 0, output: String::new() });
        };
        if !is_executable(&path) {
            // Exactly what git does, and why the guard matters: a hook checked
            // out without its exec bit must not silently block every commit.
            return Ok(HookOutcome { ran: false, code: 0, output: String::new() });
        }

        let mut cmd = crate::proc::program(&path);
        cmd.current_dir(workdir).args(args);
        let out = cmd.output().map_err(|e| AppError::Io(e.to_string()))?;

        // Direct execution keeps the streams separate, so join them in the
        // order a terminal would show them.
        let mut output = String::from_utf8_lossy(&out.stdout).to_string();
        output.push_str(&String::from_utf8_lossy(&out.stderr));

        Ok(HookOutcome {
            ran: true,
            code: out.status.code().unwrap_or(-1),
            output: output.trim().to_string(),
        })
    }

    /// `core.hooksPath` if set (relative resolves against the worktree), else
    /// `.git/hooks`.
    fn resolve(workdir: &Path, name: &str) -> Option<std::path::PathBuf> {
        let configured = crate::proc::git(workdir)
            .args(["config", "--get", "core.hooksPath"])
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .filter(|s| !s.is_empty());

        let dir = match configured {
            Some(c) => {
                let p = std::path::PathBuf::from(&c);
                if p.is_absolute() { p } else { workdir.join(p) }
            }
            None => workdir.join(".git").join("hooks"),
        };
        let path = dir.join(name);
        path.is_file().then_some(path)
    }

    fn is_executable(path: &Path) -> bool {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::metadata(path)
                .map(|m| m.permissions().mode() & 0o111 != 0)
                .unwrap_or(false)
        }
        #[cfg(not(unix))]
        {
            path.is_file()
        }
    }
}
```

Add `pub mod hooks;` to `src-tauri/src/git/mod.rs` beside the other submodules.

- [ ] **Step 4: Run the tests**

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test hooks 2>&1 | tail -30
```

Expected: all PASS. If `platypusgit_lib::` is the wrong crate path, check what
another file in `src-tauri/tests/` uses and match it.

- [ ] **Step 5: Force the fallback path under test**

The fallback ships untested on every machine whose git is modern. Add a test that
calls it directly:

```rust
#[test]
fn the_direct_exec_fallback_matches_git_hook_run_semantics() {
    // Called directly, because `has_hook_subcommand` short-circuits to
    // `git hook run` on any modern git — which is every CI machine.
    let repo = temp_repo();
    write_hook(repo.path(), "pre-commit", "#!/bin/sh\necho 'fallback ran'\nexit 4\n");
    let out = platypusgit_lib::git::hooks::run_direct_for_test(repo.path(), "pre-commit", &[]).unwrap();
    assert_eq!(out.code, 4);
    assert!(out.output.contains("fallback ran"));
}
```

Expose it in `hooks.rs`:

```rust
/// Test-only door onto the fallback, which `run_hook` reaches only on a git too
/// old to be on any CI machine.
#[doc(hidden)]
pub fn run_direct_for_test(workdir: &Path, name: &str, args: &[&str]) -> AppResult<HookOutcome> {
    fallback::run_direct(workdir, name, args)
}
```

- [ ] **Step 6: Run, then commit**

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test hooks 2>&1 | tail -30
git add src-tauri/src/git/hooks.rs src-tauri/src/git/mod.rs src-tauri/tests/hooks.rs
git commit -m "feat(git): run git hooks through git hook run, with a fallback"
```

---

## Task 3: `AppError::HookRejected` on both sides of the IPC boundary

**Files:**
- Modify: `src-tauri/src/error.rs`
- Modify: `src/lib/errors.ts`
- Test: `src/lib/errors.test.ts` (extend; create if absent)

**Interfaces:**
- Produces (Rust): `AppError::HookRejected(HookRejection)` where
  `pub struct HookRejection { pub hook: String, pub output: String }`, `Serialize`,
  `#[serde(rename_all = "camelCase")]`.
- Produces (TS): `{ kind: "HookRejected"; message: HookRejection }` and
  `export interface HookRejection { hook: string; output: string }`.

- [ ] **Step 1: Add the Rust variant**

In `src-tauri/src/error.rs`, beside the other struct-carrying variant (`Auth`):

```rust
/// A git hook ran and refused (issue 232). Carries the hook's NAME and its
/// OUTPUT as separate fields, not a formatted sentence: the output is the whole
/// point of the feature and needs to render as output — monospace, scrollable,
/// forty lines of eslint — not as a one-line banner.
///
/// Distinct from `Io`, which is a hook we could not launch: that is a broken
/// environment, not a policy decision by the repository.
#[error("the {} hook rejected this commit", .0.hook)]
HookRejected(HookRejection),
```

And the payload struct, next to the enum:

```rust
/// A hook's refusal. `output` is whatever the hook printed, verbatim.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HookRejection {
    pub hook: String,
    pub output: String,
}
```

- [ ] **Step 2: Write the failing TS test**

In `src/lib/errors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { appErrorMessage, type AppError } from "./errors";

describe("HookRejected", () => {
  it("names the hook rather than rendering the struct", () => {
    const e: AppError = {
      kind: "HookRejected",
      message: { hook: "pre-commit", output: "eslint: 2 problems" },
    };
    const text = appErrorMessage(e);
    expect(text).toContain("pre-commit");
    // The struct must never reach a banner as an object.
    expect(text).not.toContain("[object Object]");
  });

  it("keeps the output out of the one-line message", () => {
    // The output belongs in the dedicated block, not the banner: a 40-line
    // eslint dump inside a toast is the bug this feature is fixing.
    const e: AppError = {
      kind: "HookRejected",
      message: { hook: "commit-msg", output: "line1\nline2\nline3" },
    };
    expect(appErrorMessage(e)).not.toContain("line2");
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test -- src/lib/errors.test.ts 2>&1 | tail -20
```

Expected: FAIL — either a type error on the unknown `kind`, or
`[object Object]` in the output.

- [ ] **Step 4: Add the TS union member and the prose case**

In `src/lib/errors.ts`, in the union:

```ts
  /**
   * A git hook ran and refused (#232). The payload is a STRUCT: the output is
   * rendered by the dedicated block in the commit panel, never pasted into a
   * banner, so `appErrorDetail` deliberately drops it here.
   */
  | { kind: "HookRejected"; message: HookRejection }
```

and the interface beside `AuthChallenge`:

```ts
/** A hook's refusal (#232). `output` is whatever the hook printed, verbatim. */
export interface HookRejection {
  hook: string;
  output: string;
}
```

and in `appErrorDetail`, beside the `Auth` case (which is the precedent for a
struct payload):

```ts
  // HookRejected's payload is a struct, and its `output` is deliberately NOT
  // included: it goes to the output block, which can scroll. A banner gets the
  // sentence that tells the user which hook to look at.
  if (
    e.kind === "HookRejected" &&
    typeof message === "object" &&
    message !== null &&
    typeof (message as HookRejection).hook === "string"
  ) {
    return `The ${(message as HookRejection).hook} hook rejected this commit.`;
  }
```

- [ ] **Step 5: Run the tests and type-check**

```bash
pnpm test -- src/lib/errors.test.ts 2>&1 | tail -20
pnpm tsc --noEmit
cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -20
```

Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/error.rs src/lib/errors.ts src/lib/errors.test.ts
git commit -m "feat(error): add HookRejected, carrying the hook name and its output"
```

---

## Task 4: The commit sequence in `libgit2.rs`

The load-bearing task. Everything here is pinned by tests, because the failure
mode — a half-applied commit — is unrecoverable from the user's side.

**Files:**
- Modify: `src-tauri/src/git/types.rs`, `src-tauri/src/git/mod.rs`,
  `src-tauri/src/git/libgit2.rs`, `src-tauri/src/git/cli.rs`
- Test: `src-tauri/tests/hooks.rs` (extend)

**Interfaces:**
- Consumes: `git::hooks::run_hook` / `HookOutcome` (Task 2),
  `AppError::HookRejected` / `HookRejection` (Task 3).
- Produces: `CommitOptions.no_verify: bool`;
  `pub struct CommitResult { pub oid: String, pub message: String }`;
  `GitBackend::commit(&self, &RepoId, CommitOptions) -> AppResult<CommitResult>`.

- [ ] **Step 1: Add the types**

`src-tauri/src/git/types.rs` — on `CommitOptions`:

```rust
    /// Skip every commit-side hook for this one commit (#232), matching
    /// `git commit --no-verify`. `#[serde(default)]` so an existing caller that
    /// omits it keeps hooks on, which is the safe default.
    ///
    /// Deliberately not a persisted setting: "skip once" that becomes "never
    /// run hooks again" is the bug this feature exists to fix.
    #[serde(default)]
    pub no_verify: bool,
```

and the result type:

```rust
/// What a commit produced (#232).
///
/// The message is returned because `commit-msg` may REWRITE it, so what landed
/// is not necessarily what the user typed — and a panel that keeps showing the
/// typed version is lying about the repository.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitResult {
    pub oid: String,
    pub message: String,
}
```

- [ ] **Step 2: Write the failing contract tests**

Append to `src-tauri/tests/hooks.rs`. These call the backend, so build one the
way the other integration tests in `src-tauri/tests/` do — read a neighbouring
test file for the exact constructor and `RepoId` registration, then reuse it.

```rust
/// The four that must create nothing, and the two that must not interfere.
#[test]
fn a_rejecting_pre_commit_creates_nothing() {
    let repo = temp_repo();
    write_hook(repo.path(), "pre-commit", "#!/bin/sh\necho 'NOPE'\nexit 1\n");
    fs::write(repo.path().join("a.txt"), "a\n").unwrap();
    run(repo.path(), &["add", "a.txt"]);

    let before = head_oid(repo.path());
    let err = commit_via_backend(repo.path(), "subject", Default::default()).unwrap_err();

    match err {
        AppError::HookRejected(r) => {
            assert_eq!(r.hook, "pre-commit");
            assert!(r.output.contains("NOPE"), "the hook's own words reach the user");
        }
        other => panic!("expected HookRejected, got {other:?}"),
    }
    assert_eq!(head_oid(repo.path()), before, "HEAD must not move");
    assert_eq!(count_commits(repo.path()), 1, "no object was created");
}

#[test]
fn a_rejecting_commit_msg_creates_nothing() {
    let repo = temp_repo();
    write_hook(repo.path(), "commit-msg", "#!/bin/sh\necho 'bad subject'\nexit 1\n");
    fs::write(repo.path().join("a.txt"), "a\n").unwrap();
    run(repo.path(), &["add", "a.txt"]);
    let before = head_oid(repo.path());

    let err = commit_via_backend(repo.path(), "nope", Default::default()).unwrap_err();
    assert!(matches!(err, AppError::HookRejected(ref r) if r.hook == "commit-msg"));
    assert_eq!(head_oid(repo.path()), before);
}

#[test]
fn a_pre_commit_that_restages_is_honoured() {
    // THE ordering test. `lint-staged`'s shape: reformat a file, `git add` it,
    // exit 0 — and the commit must contain the reformatted content. It only
    // works if the index is read AFTER pre-commit; if someone moves the read
    // back to the top of `commit()`, this fails.
    let repo = temp_repo();
    write_hook(
        repo.path(),
        "pre-commit",
        "#!/bin/sh\necho 'fixed' > a.txt\ngit add a.txt\nexit 0\n",
    );
    fs::write(repo.path().join("a.txt"), "unfixed\n").unwrap();
    run(repo.path(), &["add", "a.txt"]);

    let res = commit_via_backend(repo.path(), "subject", Default::default()).unwrap();
    let blob = show_file_at(repo.path(), &res.oid, "a.txt");
    assert_eq!(blob.trim(), "fixed", "the hook's restaged content must be what landed");
}

#[test]
fn a_rewriting_commit_msg_decides_the_final_message() {
    let repo = temp_repo();
    write_hook(
        repo.path(),
        "commit-msg",
        "#!/bin/sh\nprintf 'REWRITTEN\\n' > \"$1\"\n",
    );
    fs::write(repo.path().join("a.txt"), "a\n").unwrap();
    run(repo.path(), &["add", "a.txt"]);

    let res = commit_via_backend(repo.path(), "typed by the user", Default::default()).unwrap();
    assert_eq!(res.message.trim(), "REWRITTEN", "the returned message is what landed");
    assert_eq!(
        message_of(repo.path(), &res.oid).trim(),
        "REWRITTEN",
        "and the object agrees"
    );
}

#[test]
fn no_verify_skips_a_rejecting_hook_and_a_rewriting_one() {
    let repo = temp_repo();
    write_hook(repo.path(), "pre-commit", "#!/bin/sh\nexit 1\n");
    write_hook(repo.path(), "commit-msg", "#!/bin/sh\nprintf 'REWRITTEN\\n' > \"$1\"\n");
    fs::write(repo.path().join("a.txt"), "a\n").unwrap();
    run(repo.path(), &["add", "a.txt"]);

    let opts = CommitOptions { no_verify: true, ..Default::default() };
    let res = commit_via_backend(repo.path(), "verbatim subject", opts).unwrap();
    assert_eq!(res.message.trim(), "verbatim subject", "no hook touched the message");
}

#[test]
fn a_failing_post_commit_does_not_fail_the_commit() {
    // git ignores post-commit's exit code, and so must we: reporting a commit
    // that EXISTS as failed sends the user looking for work that already landed.
    let repo = temp_repo();
    write_hook(repo.path(), "post-commit", "#!/bin/sh\nexit 9\n");
    fs::write(repo.path().join("a.txt"), "a\n").unwrap();
    run(repo.path(), &["add", "a.txt"]);

    let res = commit_via_backend(repo.path(), "subject", Default::default()).unwrap();
    assert_eq!(count_commits(repo.path()), 2);
    assert!(!res.oid.is_empty());
}

#[test]
fn a_repo_with_no_hooks_commits_exactly_as_before() {
    let repo = temp_repo();
    fs::write(repo.path().join("a.txt"), "a\n").unwrap();
    run(repo.path(), &["add", "a.txt"]);
    let res = commit_via_backend(repo.path(), "plain subject", Default::default()).unwrap();
    assert_eq!(res.message.trim(), "plain subject");
    assert_eq!(count_commits(repo.path()), 2);
}
```

Helpers to add alongside (all plumbing, no cleverness):

```rust
fn head_oid(cwd: &Path) -> String { capture(cwd, &["rev-parse", "HEAD"]) }
fn count_commits(cwd: &Path) -> usize {
    capture(cwd, &["rev-list", "--count", "HEAD"]).parse().unwrap()
}
fn message_of(cwd: &Path, oid: &str) -> String {
    capture(cwd, &["log", "-1", "--format=%B", oid])
}
fn show_file_at(cwd: &Path, oid: &str, path: &str) -> String {
    capture(cwd, &["show", &format!("{oid}:{path}")])
}
fn capture(cwd: &Path, args: &[&str]) -> String {
    let out = Command::new("git").current_dir(cwd).args(args).output().unwrap();
    assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}
```

`CommitOptions` needs `#[derive(Default)]` for `..Default::default()` — add it
in Task 4 Step 1 if it is not already there.

- [ ] **Step 3: Run and confirm they fail**

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test hooks 2>&1 | tail -30
```

Expected: FAIL — `commit` returns `String`, not `CommitResult`; `no_verify`
unknown; no hooks run.

- [ ] **Step 4: Rewrite `commit()`**

Replace the body of `Libgit2Backend::commit` (`src-tauri/src/git/libgit2.rs`,
around line 3752). Ordering is the whole point — read the comments before
changing anything.

```rust
    fn commit(&self, repo_id: &RepoId, opts: CommitOptions) -> AppResult<CommitResult> {
        use crate::git::hooks;
        use crate::git::signature::{apply_signoff, default_signature};

        let repo_path = self.repo_path(repo_id)?;

        // pre-commit runs BEFORE the index is read, and outside `with_repo`.
        // Both matter: a hook that runs `git add` (the lint-staged shape:
        // reformat, restage) mutates the on-disk index, and only a read that
        // happens afterwards sees it. `with_repo` also holds the per-repo mutex,
        // and a hook shelling out to git must not deadlock against it.
        if !opts.no_verify {
            let out = hooks::run_hook(&repo_path, "pre-commit", &[])?;
            if out.rejected() {
                return Err(AppError::HookRejected(crate::error::HookRejection {
                    hook: "pre-commit".into(),
                    output: out.output,
                }));
            }
        }

        // Sign-off goes on before any hook sees the message, matching
        // `git commit -s`: verified that git has already appended the trailer by
        // the time commit-msg reads the file, so a hook validating trailers
        // must see it here too.
        //
        // This takes the per-repo lock a second time, which the stash TOCTOU
        // rule would normally forbid. It is allowed here because it is a READ of
        // the config identity, not a verify-then-mutate: the worst a race can do
        // is trail a `Signed-off-by` for the identity the user had a millisecond
        // ago. Merging it into the commit's own `with_repo` is impossible —
        // sign-off must be applied before the hooks run, and the hooks must run
        // outside the lock.
        let message_in = if opts.signoff {
            let committer = self.with_repo(repo_id, |repo| {
                let c = default_signature(repo)?;
                Ok((
                    c.name().unwrap_or("").to_string(),
                    c.email().unwrap_or("").to_string(),
                ))
            })?;
            apply_signoff(&opts.message, &committer.0, &committer.1)
        } else {
            opts.message.clone()
        };

        // The message file is $GIT_DIR/COMMIT_EDITMSG, where git puts it — so a
        // hook that ignores $1 and hardcodes the path still works.
        let message = if opts.no_verify {
            message_in
        } else {
            let msg_path = self.git_dir(repo_id)?.join("COMMIT_EDITMSG");
            std::fs::write(&msg_path, &message_in).map_err(|e| AppError::Io(e.to_string()))?;
            let msg_arg = msg_path
                .to_str()
                .ok_or_else(|| AppError::InvalidPath(msg_path.display().to_string()))?;

            // Our source is always `message`, with no third argument — amend
            // included. Verified: the source is `commit` (with the object as $3)
            // only when the message is taken FROM a commit, as with -c/-C or a
            // bare --amend. We always supply it as text, so git's equivalent is
            // `commit --amend -m <msg>`, which reports `message` and passes two.
            for (hook, args) in [
                ("prepare-commit-msg", vec![msg_arg, "message"]),
                ("commit-msg", vec![msg_arg]),
            ] {
                let out = hooks::run_hook(&repo_path, hook, &args)?;
                if out.rejected() {
                    return Err(AppError::HookRejected(crate::error::HookRejection {
                        hook: hook.into(),
                        output: out.output,
                    }));
                }
            }

            // Re-read: either hook may have rewritten the file, and what it left
            // there is what git would commit.
            std::fs::read_to_string(&msg_path).map_err(|e| AppError::Io(e.to_string()))?
        };

        let oid = self.with_repo(repo_id, |repo| {
            let sig = match &opts.author_override {
                Some(o) => git2::Signature::now(&o.name, &o.email)?,
                None => default_signature(repo)?,
            };

            // Read the index HERE, after pre-commit — see the note above.
            let mut index = repo.index()?;
            let tree_oid = index.write_tree()?;
            let tree = repo.find_tree(tree_oid)?;

            let head = match repo.head() {
                Ok(h) => Some(h),
                Err(e) if e.code() == git2::ErrorCode::UnbornBranch => None,
                Err(e) => return Err(e.into()),
            };

            // `None` follows commit.gpgsign; `Some` overrides it (#61 D6).
            let wants_sign = opts
                .sign
                .unwrap_or_else(|| crate::git::signing::config_wants_signing(repo));

            if wants_sign {
                return commit_signed(repo, &sig, &message, &tree, head.as_ref(), opts.amend);
            }

            if opts.amend {
                let head_ref = head.ok_or(AppError::Unborn)?;
                let tip = head_ref.peel_to_commit()?;
                let new_oid = tip.amend(
                    Some("HEAD"),
                    Some(&sig),
                    Some(&sig),
                    None,
                    Some(&message),
                    Some(&tree),
                )?;
                return Ok(new_oid.to_string());
            }

            let parents: Vec<git2::Commit> = match head {
                Some(h) => vec![h.peel_to_commit()?],
                None => Vec::new(),
            };
            let parent_refs: Vec<&git2::Commit> = parents.iter().collect();

            let oid = repo.commit(Some("HEAD"), &sig, &sig, &message, &tree, &parent_refs)?;
            Ok(oid.to_string())
        })?;

        // post-commit runs after the ref moved, and its exit code is DISCARDED
        // because git discards it. A failing post-commit must never report a
        // commit that exists as failed.
        if !opts.no_verify {
            let _ = hooks::run_hook(&repo_path, "post-commit", &[]);
        }

        Ok(CommitResult { oid, message })
    }
```

If `Libgit2Backend` has no `git_dir` helper, add one beside `repo_path`:

```rust
/// `$GIT_DIR` for this repo — not `workdir/.git`, which is wrong for a
/// worktree, where `.git` is a file pointing elsewhere.
fn git_dir(&self, repo_id: &RepoId) -> AppResult<std::path::PathBuf> {
    self.with_repo(repo_id, |repo| Ok(repo.path().to_path_buf()))
}
```

- [ ] **Step 5: Update the trait and the CLI stub**

`src-tauri/src/git/mod.rs`:

```rust
    fn commit(&self, repo_id: &RepoId, opts: CommitOptions) -> AppResult<CommitResult>;
```

`src-tauri/src/git/cli.rs` — keep the stub in shape:

```rust
    fn commit(&self, _repo_id: &RepoId, _opts: CommitOptions) -> AppResult<CommitResult> {
        Err(AppError::NotImplemented)
    }
```

- [ ] **Step 6: Run the tests**

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test hooks 2>&1 | tail -40
cargo test --manifest-path src-tauri/Cargo.toml 2>&1 | tail -20
```

Expected: the new tests PASS and the existing suite stays green. Existing callers
of `commit` will not compile until Task 5 — if the whole-suite run fails only on
those, proceed and re-run at the end of Task 5.

- [ ] **Step 7: Add the signing interaction test**

```rust
#[test]
fn a_rejecting_pre_commit_with_signing_on_signs_nothing() {
    // Both guarantees at once: the hook creates nothing, and the signing chain
    // is never reached, so there is no signed-but-unreferenced object either.
    let repo = temp_repo();
    run(repo.path(), &["config", "commit.gpgsign", "true"]);
    write_hook(repo.path(), "pre-commit", "#!/bin/sh\nexit 1\n");
    fs::write(repo.path().join("a.txt"), "a\n").unwrap();
    run(repo.path(), &["add", "a.txt"]);

    let before = head_oid(repo.path());
    let err = commit_via_backend(repo.path(), "subject", Default::default()).unwrap_err();
    assert!(matches!(err, AppError::HookRejected(_)));
    assert_eq!(head_oid(repo.path()), before);
    assert_eq!(count_commits(repo.path()), 1);
}
```

- [ ] **Step 8: Run and commit**

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test hooks 2>&1 | tail -40
git add src-tauri/src/git/ src-tauri/tests/hooks.rs
git commit -m "feat(commit): run the commit-side hooks around the libgit2 commit"
```

---

## Task 5: Commands — `no_verify` on commit and push

**Files:**
- Modify: `src-tauri/src/commands/commits.rs`, `src-tauri/src/commands/branches.rs`

**Interfaces:**
- Consumes: `CommitResult`, `CommitOptions.no_verify` (Task 4).
- Produces: `commit(..., no_verify: Option<bool>) -> AppResult<CommitResult>`;
  `push(..., no_verify: Option<bool>)`;
  `push_args(remote, branch, force, set_upstream, no_verify)`.

- [ ] **Step 1: Write the failing `push_args` tests**

In `src-tauri/src/commands/branches.rs`, in `mod push_args_tests`:

```rust
    #[test]
    fn no_verify_is_added_only_when_asked() {
        assert_eq!(
            push_args("origin", "main", PushForce::None, false, false),
            vec!["push", "origin", "main"]
        );
        assert_eq!(
            push_args("origin", "main", PushForce::None, false, true),
            vec!["push", "origin", "main", "--no-verify"]
        );
    }

    #[test]
    fn no_verify_composes_with_upstream_and_force() {
        assert_eq!(
            push_args("origin", "feat/x", PushForce::WithLease, true, true),
            vec!["push", "-u", "origin", "feat/x", "--force-with-lease", "--no-verify"]
        );
    }
```

The existing tests call `push_args` with four arguments and will not compile —
add `false` as the fifth to each. That is the point of a required parameter over
an `Option`: the compiler finds every call site.

- [ ] **Step 2: Run and confirm failure**

```bash
cargo test --manifest-path src-tauri/Cargo.toml push_args 2>&1 | tail -20
```

Expected: FAIL — arity mismatch.

- [ ] **Step 3: Implement**

`push_args`:

```rust
fn push_args(
    remote: &str,
    branch: &str,
    force: PushForce,
    set_upstream: bool,
    no_verify: bool,
) -> Vec<String> {
    let mut args: Vec<String> = vec!["push".to_string()];
    if set_upstream {
        args.push("-u".to_string());
    }
    args.push(remote.to_string());
    args.push(branch.to_string());
    match force {
        PushForce::None => {}
        PushForce::WithLease => args.push("--force-with-lease".to_string()),
        PushForce::Force => args.push("--force".to_string()),
    }
    // Skips pre-push (#232). Last, so the option list reads the way a user
    // would type it.
    if no_verify {
        args.push("--no-verify".to_string());
    }
    args
}
```

`push` gains `no_verify: Option<bool>` and passes
`no_verify.unwrap_or(false)`. `commit` gains the same and returns
`CommitResult`:

```rust
pub async fn commit(
    state: State<'_, AppState>,
    repo_id: String,
    message: String,
    amend: bool,
    signoff: Option<bool>,
    author_override: Option<AuthorOverride>,
    sign: Option<bool>,
    // Skip every commit-side hook for this commit only (#232). Optional so an
    // existing caller that omits it keeps hooks ON — the safe default.
    no_verify: Option<bool>,
) -> AppResult<CommitResult> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let opts = CommitOptions {
        message,
        amend,
        author_override,
        signoff: signoff.unwrap_or(false),
        sign,
        no_verify: no_verify.unwrap_or(false),
    };
    tokio::task::spawn_blocking(move || backend.commit(&repo_id, opts))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}
```

- [ ] **Step 4: Fix every other `commit` call site**

```bash
cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | grep -E "^error" -A 5 | head -40
```

Work through what it names — `.oid` where a `String` was expected.

- [ ] **Step 5: Run the whole Rust suite**

```bash
cargo test --manifest-path src-tauri/Cargo.toml 2>&1 | tail -25
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/
git commit -m "feat(commands): thread no-verify through commit and push"
```

---

## Task 6: TS types, invoke wrappers, store

**Files:**
- Modify: `src/lib/types.ts`, `src/lib/tauri.ts`,
  `src/features/repo/useRepoStore.ts`

**Interfaces:**
- Consumes: the Rust command signatures from Task 5, `HookRejection` (Task 3).
- Produces: `CommitResult` in `types.ts`; wrappers
  `commit(repoId, message, amend, signoff, authorOverride, sign, noVerify) =>
  Promise<CommitResult>` and `push(repoId, remote, branch, force, credentials,
  noVerify)`; store `commit(message, amend, signoff, authorOverride, sign,
  noVerify) => Promise<CommitResult | null>`, `push(remote, branch, force,
  noVerify)`, and per-repo state `hookRejection: HookRejection | null` with
  `clearHookRejection()`.

- [ ] **Step 1: Add `CommitResult` to `src/lib/types.ts`**

```ts
/**
 * What a commit produced (#232). The message is returned because `commit-msg`
 * may REWRITE it — what landed is not necessarily what was typed.
 */
export interface CommitResult {
  oid: string;
  message: string;
}
```

- [ ] **Step 2: Update the invoke wrappers in `src/lib/tauri.ts`**

Follow the file's existing style exactly; `noVerify` is last and optional so no
existing call site changes.

```ts
export const commit = (
  repoId: string,
  message: string,
  amend: boolean,
  signoff?: boolean,
  authorOverride?: AuthorOverride | null,
  sign?: boolean | null,
  noVerify?: boolean,
) =>
  invoke<CommitResult>("commit", {
    repoId,
    message,
    amend,
    signoff,
    authorOverride,
    sign,
    noVerify,
  });
```

- [ ] **Step 3: Add the per-repo field**

In `useRepoStore.ts`, add to **both** `RepoSlice` and `emptySlice` — a per-repo
field in only one of them leaks across tab switches (CLAUDE.md):

```ts
  /**
   * The hook refusal to display, or null (#232). Per-repo, so switching tabs
   * does not carry one repository's rejected commit into another's panel.
   */
  hookRejection: HookRejection | null;
```

`emptySlice`: `hookRejection: null,`.

- [ ] **Step 4: Route the rejection into state rather than the error banner**

```ts
  async commit(
    message,
    amend = false,
    signoff = false,
    authorOverride = null,
    sign = null,
    noVerify = false,
  ) {
    const repo = get().current;
    if (!repo) return null;
    // Clear the previous refusal first: a stale block above a fresh attempt
    // reads as though the new attempt failed too.
    patchRepo(repo.id, { hookRejection: null });
    try {
      const result = await commitFn(
        repo.id, message, amend, signoff, authorOverride, sign, noVerify,
      );
      await get().refreshAll();
      return result;
    } catch (e) {
      // A hook refusal is not a banner error: its output needs a surface that
      // scrolls, and the user is about to act on it in the panel. Everything
      // else keeps the existing path.
      if (isAppError(e) && e.kind === "HookRejected") {
        patchRepo(repo.id, { hookRejection: e.message as HookRejection });
        // refreshAll anyway: a pre-commit hook may have restaged files before
        // refusing, so the file lists on screen can already be stale.
        await get().refreshAll();
        return null;
      }
      setErrorFor(repo.id, e);
      return null;
    }
  },

  clearHookRejection() {
    const repo = get().current;
    if (!repo) return;
    patchRepo(repo.id, { hookRejection: null });
  },
```

Use whatever the file's existing per-repo patch helper is called — read how
`setErrorFor` writes to a specific repo's slice and mirror it exactly rather than
introducing a second mechanism.

- [ ] **Step 5: Type-check**

```bash
pnpm tsc --noEmit
```

Expected: clean. Fix the `commit` return-type change at its call sites — the
compiler names them.

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts src/lib/tauri.ts src/features/repo/useRepoStore.ts
git commit -m "feat(store): carry the hook rejection as per-repo state"
```

---

## Task 7: The hook-output block

**Files:**
- Create: `src/design/hook-output.tsx`
- Modify: `src/design/index.ts`
- Test: `src/design/hook-output.test.tsx`

**Interfaces:**
- Consumes: `HookRejection` (Task 3).
- Produces: `HookOutput` with props
  `{ rejection: HookRejection; onDismiss: () => void; onCommitAnyway: () => void }`,
  exported from `@/design`.

- [ ] **Step 1: Write the failing component test**

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HookOutput } from "./hook-output";

const rejection = {
  hook: "pre-commit",
  output: "eslint: src/a.ts:12  no-unused-vars\neslint: src/b.ts:40  eqeqeq\n2 problems",
};

describe("HookOutput", () => {
  it("names the hook and shows every line of its output", () => {
    render(<HookOutput rejection={rejection} onDismiss={() => {}} onCommitAnyway={() => {}} />);
    expect(screen.getByText(/pre-commit/)).toBeTruthy();
    // Every line matters: a hook's output is the diagnostic, not a preview.
    expect(screen.getByTestId("hook-output-body").textContent).toContain("no-unused-vars");
    expect(screen.getByTestId("hook-output-body").textContent).toContain("2 problems");
  });

  it("calls onDismiss when dismissed", async () => {
    const onDismiss = vi.fn();
    render(<HookOutput rejection={rejection} onDismiss={onDismiss} onCommitAnyway={() => {}} />);
    await userEvent.click(screen.getByTestId("hook-output-dismiss"));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("offers committing without hooks", async () => {
    const onCommitAnyway = vi.fn();
    render(<HookOutput rejection={rejection} onDismiss={() => {}} onCommitAnyway={onCommitAnyway} />);
    await userEvent.click(screen.getByTestId("hook-output-skip"));
    expect(onCommitAnyway).toHaveBeenCalledOnce();
  });

  it("renders an empty output without crashing", () => {
    // A hook can refuse silently — exit 1, print nothing. The block must still
    // say which hook, because that is the only clue the user gets.
    render(
      <HookOutput
        rejection={{ hook: "commit-msg", output: "" }}
        onDismiss={() => {}}
        onCommitAnyway={() => {}}
      />,
    );
    expect(screen.getByText(/commit-msg/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
pnpm test -- src/design/hook-output.test.tsx 2>&1 | tail -20
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Read a neighbouring `src/design/` component first and match its conventions —
theme tokens (never a hardcoded accent), `PGButton`, icon usage. Then:

```tsx
/**
 * A git hook's refusal, rendered as output (#232).
 *
 * Inline and persistent rather than a modal or a toast: the user is about to
 * edit the message or the files the hook objected to, so the complaint has to
 * stay readable *while* they do it. A modal blocks the panel it is asking them
 * to fix, and the existing flash auto-dismisses — losing a forty-line eslint
 * dump before a slow reader clicks anything.
 */
export function HookOutput({
  rejection,
  onDismiss,
  onCommitAnyway,
}: {
  rejection: HookRejection;
  onDismiss: () => void;
  onCommitAnyway: () => void;
}) {
  const [collapsed, setCollapsed] = React.useState(false);
  return (
    <div
      data-testid="hook-output"
      style={{
        border: "1px solid var(--border-1)",
        borderRadius: 4,
        background: "var(--surface-1)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px" }}>
        <PGIcon name="alert" />
        <span style={{ flex: 1, fontWeight: 600 }}>
          The {rejection.hook} hook rejected this commit
        </span>
        <PGButton
          size="sm"
          variant="ghost"
          onClick={() => setCollapsed((c) => !c)}
          data-testid="hook-output-toggle"
        >
          {collapsed ? "Show" : "Hide"}
        </PGButton>
        <PGButton size="sm" variant="ghost" onClick={onDismiss} data-testid="hook-output-dismiss">
          Dismiss
        </PGButton>
      </div>
      {!collapsed && (
        <pre
          data-testid="hook-output-body"
          style={{
            margin: 0,
            padding: "6px 8px",
            maxHeight: 200,
            overflow: "auto",
            fontFamily: "var(--font-mono)",
            fontSize: "0.85em",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            borderTop: "1px solid var(--border-0)",
          }}
        >
          {rejection.output || "(the hook printed nothing)"}
        </pre>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", padding: "6px 8px" }}>
        <PGButton size="sm" onClick={onCommitAnyway} data-testid="hook-output-skip">
          Commit without hooks
        </PGButton>
      </div>
    </div>
  );
}
```

Export it from `src/design/index.ts`.

- [ ] **Step 4: Run, type-check, commit**

```bash
pnpm test -- src/design/hook-output.test.tsx 2>&1 | tail -20
pnpm tsc --noEmit
git add src/design/hook-output.tsx src/design/hook-output.test.tsx src/design/index.ts
git commit -m "feat(design): a hook-output block for a hook's refusal"
```

---

## Task 8: Wire the commit panel

**Files:**
- Modify: `src/screens/CommitPanel.tsx`

**Interfaces:**
- Consumes: `HookOutput` (Task 7), store `hookRejection` /
  `clearHookRejection` / `commit(..., noVerify)` (Task 6).
- Produces: no new exports.

- [ ] **Step 1: Add the state and the checkbox**

Beside the existing `signOverride` state (around line 152):

```tsx
  // Skip hooks for this commit only (#232). Never persisted: "skip once" that
  // silently becomes "never run hooks" is the bug this feature fixes.
  const [noVerify, setNoVerify] = React.useState(false);
```

In the toggle block (after the signing checkbox, around line 1607):

```tsx
            <PGCheckbox
              checked={noVerify}
              onChange={setNoVerify}
              label="Skip hooks for this commit"
              title="Run no pre-commit, prepare-commit-msg, commit-msg or post-commit hook. Equivalent to `git commit --no-verify`."
              data-testid="commit-no-verify"
            />
```

- [ ] **Step 2: Thread it through `doCommit` and reset it after success**

```tsx
  const doCommit = async (skipHooks = noVerify): Promise<string | null> => {
    if (committingRef.current) return null;
    committingRef.current = true;
    try {
      const full = buildMessage(message, coAuthorTrailers(coAuthors));
      const result = await commitAction(
        full, amend, signoff, authorIdentity, signForCommit, skipHooks,
      );
      if (result) {
        setMessage("");
        setAmend(false);
        draftRef.current = null;
        setSignOverride(null);
        // Same reasoning as the signing override: an override must not ride
        // silently into the next commit.
        setNoVerify(false);
      }
      return result?.oid ?? null;
    } finally {
      committingRef.current = false;
    }
  };
```

Add `noVerify` to the `useAction` dependency arrays for `commit.commit` and
`commit.commitAndPush` alongside `amend` and `signoff`, or a stale closure will
commit with the previous value.

- [ ] **Step 3: Render the block**

Read `hookRejection` and `clearHookRejection` from the store, and render just
above the toggle block so it sits between the message box and the checkboxes:

```tsx
          {hookRejection && (
            <HookOutput
              rejection={hookRejection}
              onDismiss={clearHookRejection}
              // Retry immediately with hooks off — the in-the-moment half of
              // the escape hatch. Does not tick the checkbox: this is one
              // commit, not a new default.
              onCommitAnyway={() => void doCommit(true)}
            />
          )}
```

- [ ] **Step 4: Handle the empty-panel early return**

`CommitPanel` returns early when there is nothing staged and no amend
(around line 1125). A `pre-commit` hook that restages can leave the panel in
that state with a rejection to show, so the rejection must not be hidden by the
early return — render the block above it too, or add `!hookRejection` to the
early-return condition. Prefer the latter; it is one condition rather than
duplicated markup.

- [ ] **Step 5: Type-check and run the unit suite**

```bash
pnpm tsc --noEmit
pnpm test 2>&1 | tail -25
```

Expected: clean, all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/screens/CommitPanel.tsx
git commit -m "feat(commit): show hook output and offer committing without hooks"
```

---

## Task 9: Docs — required by `test/docs.test.ts`

**Files:**
- Modify: `docs/dev/backend.md`, `docs/dev/architecture.md`

- [ ] **Step 1: Confirm what the invariant test wants**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test -- test/docs.test.ts 2>&1 | tail -30
```

Expected: FAIL, naming `git/hooks.rs` as undocumented. Let the failure tell you
the exact required shape rather than guessing.

- [ ] **Step 2: Add `git/hooks.rs` to the backend tree in `docs/dev/architecture.md`**

Match the surrounding entries' format:

```markdown
- `git/hooks.rs` — the ONE place a git hook is executed (#232). `git hook run`
  behind a cached capability probe, with a Unix-only direct-exec fallback for a
  git older than 2.36. Note that `git hook run` sends the hook's **stdout to
  stderr**, so the captured stream is stderr.
```

Update the `commands/commits.rs` and `commands/branches.rs` entries to mention
`no_verify` and the `CommitResult` return.

- [ ] **Step 3: Add the hook chain to `docs/dev/backend.md`**

Place it next to the signing chain and the credential path — it is the same kind
of rule:

```markdown
## The hook chain

Commit-side hooks run in `Libgit2Backend::commit`, one per name, through
`git/hooks.rs` — the only place a hook is spawned. Order is load-bearing:

    pre-commit → read index → write tree → prepare-commit-msg → commit-msg
    → build/sign/move ref → post-commit

- **`pre-commit` runs before the index is read.** A hook that runs `git add`
  (lint-staged: reformat, restage) mutates the on-disk index, and only a read
  that happens afterwards sees it. `tests/hooks.rs::a_pre_commit_that_restages_is_honoured`
  fails if that read moves back.
- **`pre-commit` runs outside `with_repo`.** It holds no per-repo mutex, so a
  hook shelling out to git cannot deadlock against us.
- **A non-zero `pre-commit`, `prepare-commit-msg` or `commit-msg` creates
  nothing** — no object, no ref move — the same guarantee the signing chain
  makes, for the same reason. The index is deliberately NOT rolled back: a hook
  that restaged did work the user wants, and git does not undo it either.
- **`post-commit`'s exit code is discarded**, because git discards it. Reporting
  a commit that exists as failed sends the user hunting for work that landed.
- **The final message is the hook's, not the user's.** `commit-msg` may rewrite
  `$GIT_DIR/COMMIT_EDITMSG`; `commit` returns `CommitResult { oid, message }` so
  the panel can show what actually landed.
- **`no_verify` skips all four.** Per-invocation, never persisted.
- `AppError::HookRejected` carries the hook name and its output as separate
  fields, because the output renders as output — not as a banner.
```

- [ ] **Step 4: Run the invariant test and commit**

```bash
pnpm test -- test/docs.test.ts 2>&1 | tail -20
git add docs/dev/
git commit -m "docs(dev): document the hook chain and git/hooks.rs"
```

---

## Task 10: One e2e spec

**Files:**
- Modify: `e2e/specs/commit.e2e.ts`

- [ ] **Step 1: Read the e2e skill first — this is not optional**

```bash
cat .claude/skills/e2e-testing/SKILL.md
```

It carries the selector conventions, the temp-repo fixture helpers and the
timing traps. Write nothing before reading it.

- [ ] **Step 2: Add the spec**

One case, because the Rust tests carry the matrix and this carries the wiring:

```ts
it("shows a rejecting pre-commit hook's output and can commit without hooks", async () => {
  // Fixture: use whatever helper the other specs in this file use to make a
  // temp repo, then install an executable pre-commit that refuses.
  // The hook must be chmod +x — git skips a non-executable hook, and the test
  // would then pass for the wrong reason.
  await installHook(repoPath, "pre-commit", "#!/bin/sh\necho 'HOOK SAYS NO'\nexit 1\n");

  await stageAFile();
  await typeCommitMessage("subject");
  await clickCommit();

  const block = await $('[data-testid="hook-output"]');
  await expect(block).toBeDisplayed();
  await expect(await $('[data-testid="hook-output-body"]')).toHaveTextContaining("HOOK SAYS NO");

  await (await $('[data-testid="hook-output-skip"]')).click();
  // The commit landed: the message box cleared and the block went away.
  await expect(block).not.toBeDisplayed();
});
```

- [ ] **Step 3: Typecheck, rebuild the snapshot, run only this spec**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm exec tsc -p e2e/tsconfig.json --noEmit
pnpm test:e2e:docker build
pnpm test:e2e:docker run --spec e2e/specs/commit.e2e.ts
```

The rebuild is mandatory: `src/` and `src-tauri/` both changed, and a stale
snapshot tests the old binary. One cold container build at a time across all
worktrees.

- [ ] **Step 4: Commit**

```bash
git add e2e/specs/commit.e2e.ts
git commit -m "test(e2e): a rejecting pre-commit hook, and committing past it"
```

---

## Deviations from this plan, as built

- **Push's escape hatch became a palette command** (`action:push-current-no-verify`),
  not just a backend flag. The plan stopped at `push_args`; the issue asks for the
  hatch to be visible on push too, and there is no push dialog — force-push is
  already a `danger: true` palette command behind a confirm, so this follows it.
  Tested in `commands.test.ts` (the decline path, which needs no mock because
  `pgConfirm` resolves false with no dialog host) and
  `commands.noVerifyPush.test.ts` (the accept path, with `@/design` stubbed in
  its own file so the mock cannot affect other palette tests).
- **`index.read(false)` was needed** on top of moving the index read. See the
  spec's correction note; `a_pre_commit_that_restages_is_honoured` caught it.
- **The output block's child testids do not share its stem** (`hook-body`, not
  `hook-output-body`) — the e2e attr+text selector trap in
  `.claude/skills/e2e-testing/SKILL.md`.
- **`TempRepo.writeHook`** was added to `e2e/support/tempRepo.ts`; `write` alone
  does not chmod, and git silently skips a non-executable hook.
- **`tests/verify_commit_no_spawn.rs` needed a change** — it stubs `git` through
  the process `PATH`, which no longer reaches children.

## Final verification

- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` — all green
- [ ] `cargo check --manifest-path src-tauri/Cargo.toml` — no warnings introduced
- [ ] `pnpm tsc --noEmit` — clean
- [ ] `pnpm test` — unit + component + docs invariants green
- [ ] `pnpm exec tsc -p e2e/tsconfig.json --noEmit` — clean
- [ ] `pnpm test:e2e:docker run --spec e2e/specs/commit.e2e.ts` — green
- [ ] **Manual, and it cannot be skipped:** launch the bundled app from the Dock
      (not a terminal, not `pnpm tauri dev`) in a repo whose `pre-commit` calls a
      version-managed `node`, and commit. This is the failure the issue
      describes, and no automated layer here reproduces it — every test harness
      already has a terminal's environment. Confirm the hook finds `node`.
- [ ] Squash to one Conventional Commit against the pinned `origin/main` SHA,
      open the PR, and let it close #232.
