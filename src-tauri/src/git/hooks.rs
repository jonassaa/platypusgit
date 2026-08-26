//! The one place a git hook is executed (issue 232).
//!
//! # Why hooks are run at all
//!
//! libgit2 runs none, ever. So committing through [`crate::git::libgit2`] used
//! to run no `pre-commit`, `prepare-commit-msg`, `commit-msg` or `post-commit`,
//! while pushing — which shells out to real `git push` — ran `pre-push` because
//! git does. A repository with husky, lefthook, `pre-commit` or commitlint was
//! therefore enforced on push and silently bypassed on commit.
//!
//! # Why `git hook run` and not the script directly
//!
//! Executing `.git/hooks/pre-commit` ourselves means re-implementing git's
//! contract: resolve `core.hooksPath`, honour the executable bit, and — the one
//! that silently breaks Windows — run the script through git's bundled `sh`,
//! because a hook is a shell script and Windows has no shebang. Getting that
//! last part wrong means hooks quietly do not run on Windows, which is the exact
//! bug this module exists to fix.
//!
//! `git hook run` is git doing all of it. Verified in a scratch repo rather than
//! trusted from the docs: it propagates the hook's exit code, respects
//! `core.hooksPath`, skips a non-executable hook with git's own
//! `advice.ignoredHook` hint, and passes arguments through after `--`.
//!
//! # The one surprise worth knowing
//!
//! **`git hook run` redirects the hook's stdout to stderr.** A hook's output
//! arrives on stderr whether it succeeded or failed, so this module captures
//! stderr and ignores stdout. Capturing the other way round collects nothing.
//!
//! # Why signing is untouched by any of this
//!
//! The alternative design was to shell out to `git commit`, which would have run
//! the hooks for free — and signed through git's own `gpg.program`, standing up a
//! second signing chain beside `libgit2.rs::sign_payload`. Two chains drift, and
//! the failure mode is a commit the user believes is signed. So the commit stays
//! libgit2's and the hooks are wrapped around it.

use std::path::Path;
use std::sync::OnceLock;

use crate::error::{AppError, AppResult};

/// What running one hook did.
#[derive(Debug, Clone)]
pub struct HookOutcome {
    /// False when no hook by that name exists, or git skipped it as
    /// non-executable. Not an error: most repositories have no hooks at all.
    pub ran: bool,
    /// The hook's exit status, or 0 when it did not run.
    pub code: i32,
    /// Everything the hook printed — its stdout and stderr both, as git
    /// delivers them.
    pub output: String,
}

impl HookOutcome {
    /// A hook that ran and refused. The only condition that stops a commit.
    ///
    /// **What actually protects the skip cases is `code`, not `ran`.** A hook
    /// that is absent or non-executable comes back with `code: 0` — git's own
    /// choice in the `git hook run` path, and ours in the fallback — so the
    /// `ran &&` here is belt-and-braces, and a mutation test confirms removing
    /// it changes no behaviour today.
    ///
    /// The invariant that carries real weight is therefore in the constructors:
    /// **a skipped hook must report `code: 0`.** Reporting non-zero for "I
    /// didn't run it" would block every commit in a repository whose hooks were
    /// checked out without their executable bit. `tests/hooks.rs` pins that
    /// directly rather than pinning this expression.
    pub fn rejected(&self) -> bool {
        self.ran && self.code != 0
    }
}

/// A hook name that cannot exist, used to ask git whether it has the `hook`
/// subcommand at all.
///
/// Side-effect-free by construction: with `--ignore-missing` there is nothing to
/// run, so a supporting git exits 0 silently.
const PROBE_HOOK: &str = "pg-capability-probe";

/// Does this git have `git hook run`? Probed once, cached for the process.
///
/// Deliberately **not** `git --version` parsing: comparing version strings is a
/// bug waiting to happen, and the capability is directly askable. `git hook run`
/// arrived in git 2.36; Ubuntu 22.04 LTS is supported into 2027 and ships 2.34,
/// so the fallback below is not hypothetical.
///
/// The probe cannot be confused with a hook rejection, because the hook it names
/// never exists — a supporting git exits 0, an older one exits non-zero with
/// `git: 'hook' is not a git command`.
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

/// Run hook `name` with `args`, if the repository has one.
///
/// `Err` means git itself could not be run — a broken environment. A hook that
/// ran and *refused* is a successful call returning
/// [`HookOutcome::rejected`], which the caller turns into
/// [`AppError::HookRejected`] carrying the hook's own output.
pub fn run_hook(workdir: &Path, name: &str, args: &[&str]) -> AppResult<HookOutcome> {
    if has_hook_subcommand(workdir) {
        run_via_git_hook(workdir, name, args)
    } else {
        run_direct(workdir, name, args)
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

    // Hook output arrives on stderr — including the hook's stdout. See the
    // module note; capturing stdout here collects nothing.
    let output = String::from_utf8_lossy(&out.stderr).trim().to_string();
    let code = out.status.code().unwrap_or(-1);

    // `--ignore-missing` exits 0 and prints nothing for an absent hook, and so
    // does a hook that ran, passed and said nothing. The two are
    // indistinguishable from out here — and it does not matter, because both are
    // `rejected() == false`. `ran` is reported for logging, never branched on
    // for correctness.
    Ok(HookOutcome {
        ran: code != 0 || !output.is_empty(),
        code,
        output,
    })
}

/// Direct execution, for a git without `git hook run`.
///
/// Unix in practice: Windows always has a current Git for Windows, so this path
/// never needs git's `sh` shim, and a shebang'd executable script runs itself.
fn run_direct(workdir: &Path, name: &str, args: &[&str]) -> AppResult<HookOutcome> {
    let skipped = HookOutcome {
        ran: false,
        code: 0,
        output: String::new(),
    };

    let Some(path) = resolve_hook(workdir, name) else {
        return Ok(skipped);
    };
    if !is_executable(&path) {
        // Exactly what git does, and why it matters: a hook checked out without
        // its executable bit must not silently block every commit.
        return Ok(skipped);
    }

    let out = crate::proc::program(&path)
        .current_dir(workdir)
        .args(args)
        .output()
        .map_err(|e| AppError::Io(e.to_string()))?;

    // Direct execution keeps the two streams separate, so join them in the order
    // a terminal would have shown them.
    let mut output = String::from_utf8_lossy(&out.stdout).into_owned();
    output.push_str(&String::from_utf8_lossy(&out.stderr));

    Ok(HookOutcome {
        ran: true,
        code: out.status.code().unwrap_or(-1),
        output: output.trim().to_string(),
    })
}

/// `core.hooksPath` if set (a relative value resolves against the worktree),
/// else `$GIT_DIR/hooks`.
fn resolve_hook(workdir: &Path, name: &str) -> Option<std::path::PathBuf> {
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
            if p.is_absolute() {
                p
            } else {
                workdir.join(p)
            }
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

/// Test-only door onto the direct-exec fallback.
///
/// [`run_hook`] reaches it only on a git older than 2.36, which is no CI machine
/// and no developer machine here — so without this the fallback would ship
/// exercised on Ubuntu 22.04 and nowhere else.
#[doc(hidden)]
pub fn run_direct_for_test(workdir: &Path, name: &str, args: &[&str]) -> AppResult<HookOutcome> {
    run_direct(workdir, name, args)
}
