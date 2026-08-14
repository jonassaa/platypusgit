//! Linked worktrees (#93).
//!
//! libgit2 covers list / add / lock / unlock / prune exactly, so those stay on
//! libgit2: `git_worktree_list` returns precisely the LINKED worktrees (the main
//! worktree is the repository itself), `git_worktree_add` writes the same admin
//! files git does, and `git_worktree_prune`'s defaults ARE `git worktree prune`'s
//! (only invalid, only unlocked, never touching a working tree).
//!
//! **`remove` is the one exception, and it is about data loss, not capability.**
//! libgit2 has no `remove`; the nearest thing is `git_worktree_prune` with
//! `WORKING_TREE`, which recursively deletes the directory with **no dirty check
//! at all**. `git worktree remove` refuses when the worktree holds modified or
//! untracked files unless `--force`. Losing somebody's uncommitted work to a
//! "remove" button is not a trade worth making, so this one shells out and git's
//! refusal is surfaced as `DirtyWorktree` with an explicit force path.

use std::path::Path;

use git2::{Repository, WorktreeLockStatus};

use crate::error::{AppError, AppResult};
use crate::git::types::WorktreeInfo;

/// Describe one linked worktree by name.
///
/// `current` is the open repository's workdir, so the row for the worktree the
/// user is actually standing in can say so.
pub fn info(repo: &Repository, name: &str, current: Option<&Path>) -> AppResult<WorktreeInfo> {
    let wt = repo
        .find_worktree(name)
        .map_err(|e| AppError::InvalidArgument(format!("worktree {name}: {}", e.message())))?;
    let path = wt.path().to_path_buf();

    let (locked, lock_reason) = match wt.is_locked() {
        Ok(WorktreeLockStatus::Locked(reason)) => (true, reason),
        // An unreadable lock file is not a reason to fail the whole listing.
        Ok(WorktreeLockStatus::Unlocked) | Err(_) => (false, None),
    };
    // libgit2 reports "not prunable" as an Err carrying the reason, not as
    // Ok(false) — so a plain `?` here would fail the listing for every healthy
    // worktree.
    let prunable = wt.is_prunable(None).unwrap_or(false);

    // Only reachable when the directory still exists; a prunable worktree has no
    // HEAD to read, which is not an error for this listing.
    let (branch, head_oid) = match Repository::open_from_worktree(&wt) {
        Ok(wrepo) => {
            let head = wrepo.head().ok();
            let branch = head
                .as_ref()
                .filter(|h| h.is_branch())
                .and_then(|h| h.shorthand().map(str::to_string));
            let oid = head
                .and_then(|h| h.peel_to_commit().ok())
                .map(|c| c.id().to_string());
            (branch, oid)
        }
        Err(_) => (None, None),
    };

    let is_current = current.is_some_and(|c| same_path(c, &path));

    Ok(WorktreeInfo {
        name: wt.name().unwrap_or(name).to_string(),
        path: path.to_string_lossy().to_string(),
        branch,
        head_oid,
        locked,
        lock_reason,
        prunable,
        is_current,
    })
}

/// Path equality that survives the symlink indirection macOS puts on `/tmp`.
///
/// git records the worktree path as given, while the app's open-repo path has been
/// through `canonicalize` — so a plain `==` reports `is_current: false` for the
/// very worktree the user is standing in on every macOS temp-dir fixture.
/// Canonicalization can fail (a pruned worktree's directory is gone), so fall back
/// to the literal comparison rather than to "not current".
fn same_path(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(x), Ok(y)) => x == y,
        _ => a == b,
    }
}

/// `git worktree remove` arguments. `--force` twice is git's own spelling for
/// "remove it even though it is locked"; one `--force` only covers dirt.
pub fn remove_args(path: &str, force: bool) -> Vec<String> {
    let mut args: Vec<String> = vec!["worktree".into(), "remove".into()];
    if force {
        args.push("--force".into());
    }
    args.push(path.to_string());
    args
}

/// Map `git worktree remove`'s stderr to the error the UI can act on.
///
/// The dirty refusal is the only one worth distinguishing: it is the case where a
/// second, explicit confirmation may legitimately pass `--force`. Everything else
/// stays a plain `Git` error.
pub fn classify_remove_failure(path: &str, stderr: &str) -> AppError {
    let s = stderr.to_ascii_lowercase();
    if s.contains("contains modified or untracked files") || s.contains("is dirty") {
        return AppError::DirtyWorktree(path.to_string());
    }
    AppError::Git(format!("git worktree remove: {}", stderr.trim()))
}

/// The git-visible name for a worktree at `path` — its directory basename, which
/// is what `git worktree add` itself derives.
pub fn name_for_path(path: &Path) -> AppResult<String> {
    path.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .filter(|n| !n.is_empty() && n != "." && n != "..")
        .ok_or_else(|| {
            AppError::InvalidArgument(format!(
                "cannot derive a worktree name from {}",
                path.display()
            ))
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remove_args_shapes() {
        assert_eq!(remove_args("/tmp/wt", false), ["worktree", "remove", "/tmp/wt"]);
        assert_eq!(
            remove_args("/tmp/wt", true),
            ["worktree", "remove", "--force", "/tmp/wt"]
        );
    }

    #[test]
    fn dirty_refusal_is_its_own_error() {
        let e = classify_remove_failure(
            "/tmp/wt",
            "fatal: '/tmp/wt' contains modified or untracked files, use --force to delete it",
        );
        assert!(matches!(e, AppError::DirtyWorktree(p) if p == "/tmp/wt"));
    }

    #[test]
    fn other_failures_stay_git_errors() {
        let e = classify_remove_failure("/tmp/wt", "fatal: '/tmp/wt' is not a working tree");
        assert!(matches!(e, AppError::Git(_)));
    }

    #[test]
    fn name_comes_from_the_basename() {
        assert_eq!(name_for_path(Path::new("/a/b/feature-x")).unwrap(), "feature-x");
        assert!(name_for_path(Path::new("/")).is_err());
    }
}
