//! Validation of an interactive-rebase plan against the repository it will run
//! against. Every check here runs *before* `rebase_start` mutates anything: the
//! engine used to discover an unexecutable step mid-replay, with earlier picks
//! already committed and the branch tip already moved.

use std::collections::HashSet;

use git2::Repository;

use crate::error::{AppError, AppResult};

use super::types::{RebaseAction, RebaseStep};

/// First seven hex characters, for messages.
pub fn short(oid: &str) -> &str {
    &oid[..oid.len().min(7)]
}

/// Actions that mean something for a commit with more than one parent.
///
/// Only `Drop` for now — git's own default, which drops merges and flattens the
/// branch. Keeping a merge as one commit and recreating it are separate actions
/// added later; this function is the single source of truth the UI mirrors.
pub fn merge_legal(action: RebaseAction) -> bool {
    matches!(action, RebaseAction::Drop)
}

pub fn validate(repo: &Repository, plan: &[RebaseStep]) -> AppResult<()> {
    if plan.is_empty() {
        return Err(AppError::InvalidRebasePlan("the plan is empty".into()));
    }

    let mut seen: HashSet<&str> = HashSet::new();
    for step in plan {
        if !seen.insert(step.oid.as_str()) {
            return Err(AppError::InvalidRebasePlan(format!(
                "{} appears twice in the plan",
                short(&step.oid)
            )));
        }

        let commit = repo
            .revparse_single(&step.oid)
            .and_then(|o| o.peel_to_commit())
            .map_err(|_| {
                AppError::InvalidRebasePlan(format!("unknown commit {}", short(&step.oid)))
            })?;

        if commit.parent_count() > 1 && !merge_legal(step.action) {
            return Err(AppError::InvalidRebasePlan(format!(
                "{} is a merge commit — it can only be dropped, which flattens \
                 the branch, or left out of the plan",
                short(&step.oid)
            )));
        }
    }

    if !plan.iter().any(|s| s.action != RebaseAction::Drop) {
        return Err(AppError::InvalidRebasePlan(
            "the plan drops every commit — nothing would be replayed".into(),
        ));
    }

    Ok(())
}
