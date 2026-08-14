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
/// `Drop` flattens (git's own default: the merge disappears and its commits are
/// replayed individually); `MainlinePick` keeps the merge as one ordinary
/// commit; `Merge` recreates it from its rewritten parents. This function is the
/// single source of truth the UI mirrors.
pub fn merge_legal(action: RebaseAction) -> bool {
    matches!(
        action,
        RebaseAction::Drop | RebaseAction::MainlinePick | RebaseAction::Merge
    )
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

        if let Some(onto) = &step.onto {
            // Either an earlier step (whose replayed copy the engine will have
            // recorded by then) or a commit that already exists below the range.
            let known_earlier = plan
                .iter()
                .take_while(|s| s.oid != step.oid)
                .any(|s| &s.oid == onto);
            let exists = repo
                .revparse_single(onto)
                .and_then(|o| o.peel_to_commit())
                .is_ok();
            if !known_earlier && !exists {
                return Err(AppError::InvalidRebasePlan(format!(
                    "{} is applied onto {}, which is neither an earlier step nor \
                     an existing commit",
                    short(&step.oid),
                    short(onto)
                )));
            }
        }

        if commit.parent_count() > 1 && !merge_legal(step.action) {
            return Err(AppError::InvalidRebasePlan(format!(
                "{} is a merge commit — it can be dropped (which flattens the \
                 branch) or kept as one commit, but not {:?}ed",
                short(&step.oid),
                step.action
            )));
        }

        if step.action == RebaseAction::Merge {
            if commit.parent_count() < 2 {
                return Err(AppError::InvalidRebasePlan(format!(
                    "{} is not a merge commit, so it cannot be recreated as one",
                    short(&step.oid)
                )));
            }
            if commit.parent_count() > 2 {
                return Err(AppError::InvalidRebasePlan(format!(
                    "{} is an octopus merge ({} parents) — recreating one is not \
                     supported yet; drop it or keep it as one commit",
                    short(&step.oid),
                    commit.parent_count()
                )));
            }
            if step.merge_parents.is_empty() {
                return Err(AppError::InvalidRebasePlan(format!(
                    "{} is a merge step with no parents to merge",
                    short(&step.oid)
                )));
            }
        } else if !step.merge_parents.is_empty() {
            return Err(AppError::InvalidRebasePlan(format!(
                "{} carries merge parents but its action is {:?}",
                short(&step.oid),
                step.action
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
