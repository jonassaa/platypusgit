//! The git half of checking out a pull request (#92).
//!
//! Split out of `commands/forge.rs` so the argument vectors and the branch probe
//! are testable against a real temp repository — this is the part most likely to
//! be silently wrong, because a FORK request's source branch exists on no remote
//! we have.
//!
//! # How a fork request is reachable at all
//!
//! Both forges synthesise a ref for every open request **on the base repository**:
//! `refs/pull/<n>/head` (GitHub) and `refs/merge-requests/<n>/head` (GitLab). So
//! the fetch goes to the remote we already have and needs no knowledge of the
//! fork, its URL, or its credentials.
//!
//! # Why two commands rather than one refspec
//!
//! `git fetch <remote> +<ref>:refs/heads/<local>` looks shorter and is wrong
//! twice: git refuses to fetch into the branch that is currently checked out, and
//! force-updating a local branch behind the user's back is silent data loss. So
//! the fetch writes NO ref (it lands in `FETCH_HEAD`) and the branch decision is
//! explicit and confirmable.

use std::path::Path;
use std::process::Stdio;

use crate::error::{AppError, AppResult};

/// `git fetch` arguments for one request's head ref.
///
/// * `--no-tags` — a PR fetch has no business importing the remote's tags.
/// * `--` before the positional arguments, so neither the remote name nor the
///   refspec can be read as an option.
/// * No destination in the refspec, so nothing under `refs/` is written; the tip
///   lands in `FETCH_HEAD`.
pub fn fetch_args<'a>(remote: &'a str, head_ref: &'a str) -> Vec<&'a str> {
    vec!["fetch", "--no-tags", "--", remote, head_ref]
}

/// `git checkout` arguments for the fetched tip.
///
/// `-B` (reset an existing branch) only when the caller has already confirmed the
/// overwrite; `-b` otherwise, so an unconfirmed collision fails loudly instead of
/// discarding commits.
pub fn checkout_args(local: &str, exists: bool) -> Vec<&str> {
    vec!["checkout", if exists { "-B" } else { "-b" }, local, "FETCH_HEAD"]
}

/// Does `refs/heads/<name>` exist?
///
/// `git rev-parse --verify --quiet refs/heads/<name>` — the exit status IS the
/// answer, so a missing branch is not an error.
///
/// NOTE, and this cost a bug: **no `--` separator.** In `rev-parse`, everything
/// after `--` is a PATH, not a revision, so `rev-parse --verify --quiet --
/// refs/heads/main` exits 1 even when `main` exists — making every branch look
/// absent and turning a clean `BranchExists` into git's own "branch already
/// exists" failure. The argument is safe without it: it is always prefixed with
/// `refs/heads/`, so it can never begin with `-`, and the name has already been
/// through `validate_ref_name`.
pub async fn branch_exists(cwd: &Path, name: &str) -> AppResult<bool> {
    let status = tokio::process::Command::new("git")
        .arg("-C")
        .arg(cwd)
        .args([
            "rev-parse",
            "--verify",
            "--quiet",
            &format!("refs/heads/{name}"),
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await
        .map_err(|e| AppError::Io(format!("could not run `git rev-parse`: {e}")))?;
    Ok(status.success())
}
