//! Submodule reading and the one submodule op that has to shell out (#93).
//!
//! libgit2 handles submodules well for everything local: `Repository::submodules`
//! parses `.gitmodules`, `submodule_status` combines config + index + workdir into
//! one bitset, `Submodule::init` writes `submodule.<name>.url` into `.git/config`
//! and `Submodule::sync` copies URLs the other way. All of that stays on libgit2.
//!
//! `update` does not, and the reason is credentials rather than capability:
//! updating fetches from the submodule's own remote whenever the recorded commit
//! is missing locally, and this app's entire credential story is the askpass shim
//! (`GIT_ASKPASS` → our own executable, secret passed in the environment — see
//! `commands/net.rs`), which only exists for a **subprocess** git. Driving
//! libgit2's fetch here would add a second, credential-blind network path.
//! `git submodule update` also gets `--recursive` right in one call.

use std::collections::HashSet;

use git2::{Repository, SubmoduleIgnore, SubmoduleStatus};

use crate::error::AppResult;
use crate::git::types::{SubmoduleInfo, SubmoduleState};

/// Collapse libgit2's status bitset into the four states the UI acts on.
///
/// The order is the whole point. A submodule with no checkout reports
/// `WD_UNINITIALIZED` *and* often `WD_MODIFIED` (the workdir oid is missing, so it
/// differs from the recorded one); reporting that as "out of sync" would offer
/// Update on a submodule whose real problem is that it was never initialized. And
/// a submodule can be simultaneously at the wrong commit and dirty inside — the
/// pointer mismatch is the actionable half, so it wins.
pub fn state_from_status(s: SubmoduleStatus) -> SubmoduleState {
    if s.contains(SubmoduleStatus::WD_UNINITIALIZED) {
        return SubmoduleState::Uninitialized;
    }
    let pointer_moved = SubmoduleStatus::INDEX_MODIFIED
        | SubmoduleStatus::INDEX_ADDED
        | SubmoduleStatus::INDEX_DELETED
        | SubmoduleStatus::WD_MODIFIED
        | SubmoduleStatus::WD_ADDED
        | SubmoduleStatus::WD_DELETED;
    if s.intersects(pointer_moved) {
        return SubmoduleState::OutOfSync;
    }
    let dirty_inside = SubmoduleStatus::WD_INDEX_MODIFIED
        | SubmoduleStatus::WD_WD_MODIFIED
        | SubmoduleStatus::WD_UNTRACKED;
    if s.intersects(dirty_inside) {
        return SubmoduleState::Modified;
    }
    SubmoduleState::UpToDate
}

/// Every submodule the repository DECLARES, as worktree-relative paths.
///
/// Empty — and free — when there is no `.gitmodules`, which is the case for almost
/// every repository. That guard matters: this feeds `status()`, which runs after
/// every stage, unstage, discard and hunk op, and `list_all_files()`, which
/// enumerates the entire worktree. A declared submodule needs a URL to be
/// resolvable by a clone, which is the same test `is_registered_submodule` applies
/// — a bare `160000` index entry with no `.gitmodules` line stays an *embedded*
/// repo, and the two flags must not both be set on one row.
pub fn declared_submodule_paths(repo: &Repository) -> HashSet<String> {
    let Some(workdir) = repo.workdir() else {
        return HashSet::new();
    };
    if !workdir.join(".gitmodules").exists() {
        return HashSet::new();
    }
    let Ok(subs) = repo.submodules() else {
        return HashSet::new();
    };
    subs.iter()
        .filter(|sm| sm.url().is_some_and(|u| !u.is_empty()))
        .map(|sm| sm.path().to_string_lossy().to_string())
        .collect()
}

/// Read every declared submodule with its state.
pub fn list(repo: &Repository) -> AppResult<Vec<SubmoduleInfo>> {
    let mut out = Vec::new();
    for sm in repo.submodules()? {
        let name = sm
            .name()
            .map(str::to_string)
            .unwrap_or_else(|| String::from_utf8_lossy(sm.name_bytes()).to_string());
        let path = sm.path().to_string_lossy().to_string();
        // `submodule_status` wants the NAME. Ignore::None so the dirty-inside
        // bits are actually computed — Ignore::Dirty (a common config default)
        // would suppress exactly the difference between UpToDate and Modified.
        let status = repo
            .submodule_status(&name, SubmoduleIgnore::None)
            .unwrap_or_else(|_| SubmoduleStatus::empty());
        out.push(SubmoduleInfo {
            name,
            path,
            url: sm.url().map(str::to_string),
            branch: sm.branch().map(str::to_string),
            head_oid: sm.head_id().map(|o| o.to_string()),
            workdir_oid: sm.workdir_id().map(|o| o.to_string()),
            state: state_from_status(status),
        });
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(out)
}

/// Argument list for `git submodule update`.
///
/// Shared by the trait method (prompt-less, no credentials) and the command's
/// credentialed retry, so the two can never drift into updating different things.
/// `--init` rather than a separate `submodule init` call: git's own recommended
/// one-shot, and it is idempotent on an already-initialized submodule.
pub fn update_args(path: Option<&str>, recursive: bool, init: bool) -> Vec<String> {
    let mut args: Vec<String> = vec!["submodule".into(), "update".into()];
    if init {
        args.push("--init".into());
    }
    if recursive {
        args.push("--recursive".into());
    }
    if let Some(p) = path {
        // `--` so a submodule path that looks like an option cannot be read as
        // one.
        args.push("--".into());
        args.push(p.to_string());
    }
    args
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uninitialized_outranks_a_pointer_mismatch() {
        // Exactly what libgit2 reports for a declared-but-never-checked-out
        // submodule: no workdir oid, so the pointer "differs" too.
        let s = SubmoduleStatus::IN_HEAD
            | SubmoduleStatus::IN_INDEX
            | SubmoduleStatus::IN_CONFIG
            | SubmoduleStatus::WD_UNINITIALIZED
            | SubmoduleStatus::WD_MODIFIED;
        assert_eq!(state_from_status(s), SubmoduleState::Uninitialized);
    }

    #[test]
    fn pointer_mismatch_outranks_dirt_inside() {
        let s = SubmoduleStatus::IN_HEAD
            | SubmoduleStatus::IN_WD
            | SubmoduleStatus::WD_MODIFIED
            | SubmoduleStatus::WD_WD_MODIFIED;
        assert_eq!(state_from_status(s), SubmoduleState::OutOfSync);
    }

    #[test]
    fn dirt_inside_alone_is_modified() {
        let s = SubmoduleStatus::IN_HEAD
            | SubmoduleStatus::IN_WD
            | SubmoduleStatus::WD_WD_MODIFIED;
        assert_eq!(state_from_status(s), SubmoduleState::Modified);
    }

    #[test]
    fn clean_and_present_is_up_to_date() {
        let s = SubmoduleStatus::IN_HEAD
            | SubmoduleStatus::IN_INDEX
            | SubmoduleStatus::IN_CONFIG
            | SubmoduleStatus::IN_WD;
        assert_eq!(state_from_status(s), SubmoduleState::UpToDate);
    }

    #[test]
    fn update_args_shapes() {
        assert_eq!(update_args(None, false, false), ["submodule", "update"]);
        assert_eq!(
            update_args(None, true, true),
            ["submodule", "update", "--init", "--recursive"]
        );
        assert_eq!(
            update_args(Some("vendor/lib"), false, true),
            ["submodule", "update", "--init", "--", "vendor/lib"]
        );
    }
}
