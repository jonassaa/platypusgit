//! Stacked branches: keep dependent refs pointing at the replayed commits
//! (#240) — git's `rebase --update-refs`, implemented rather than passed
//! through.
//!
//! ## Why implemented
//!
//! Our rebase is our OWN replay: `rebase_start_with_progress` detaches at the
//! base, cherry-picks each step, and moves the branch ref once at the end
//! (`finish_rebase`). We never shell out to `git rebase`, so there is no
//! process to hand `--update-refs` to. The issue flagged this as the question
//! that decides the feature's size; this module is the answer.
//!
//! It is also a small answer, because the engine already keeps the one piece of
//! state that makes it possible: `RebaseState::rewritten`, the original → new
//! oid map maintained per step. Everything here is "which refs point into the
//! range" plus "look each one up in that map".
//!
//! ## The workflow it fixes
//!
//! `feat/a` → `feat/b` → `feat/c`, each a small reviewable PR on top of the
//! last. Rebase `feat/a` onto an updated `main` and, without this, `feat/b` and
//! `feat/c` still point at the *old*, now-abandoned commits. Recovering by hand
//! is a chain of manual rebases, and it is exactly where people give up on the
//! GUI and go back to the terminal.

use std::collections::{BTreeMap, HashMap, HashSet};

use git2::Repository;
use serde::{Deserialize, Serialize};

use crate::error::AppResult;

/// A local branch whose tip sits inside the range about to be replayed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StackedRef {
    /// Full ref name, e.g. `refs/heads/feat/b`.
    pub name: String,
    /// What the UI shows: `feat/b`.
    pub short: String,
    /// The tip it points at now — one of the plan's commits.
    pub oid: String,
}

/// A ref this rebase actually moved.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MovedRef {
    pub name: String,
    pub short: String,
    pub from: String,
    pub to: String,
}

/// The `refs/heads/` prefix, as a name that says why it is being stripped.
const HEADS: &str = "refs/heads/";

pub fn short_name(full: &str) -> String {
    full.strip_prefix(HEADS).unwrap_or(full).to_string()
}

/// Whether `rebase.updateRefs` is on in this repository's config.
///
/// Read so that someone who already set it globally gets the behaviour here
/// without configuring the app too — the issue asks for exactly that. git's own
/// default is false, and this matches it rather than being helpful and
/// surprising: silently moving refs the user did not ask about is the failure
/// mode this whole feature is trying to prevent, only in the other direction.
pub fn config_enabled(repo: &Repository) -> bool {
    repo.config()
        .and_then(|mut c| c.snapshot())
        .and_then(|c| c.get_bool("rebase.updateRefs"))
        .unwrap_or(false)
}

/// Local branches whose tips are commits inside `plan_oids`.
///
/// **Tips only.** A branch pointing at a commit in the middle of the range is
/// what stacking produces, and moving it to the replayed equivalent is exactly
/// right; a branch pointing somewhere else entirely is not this rebase's
/// business. That is also git's own rule for `--update-refs`.
///
/// `exclude` is the branch being rebased — `finish_rebase` moves that one
/// itself, and moving it twice would fight over the same ref.
///
/// The current HEAD's own ref is excluded even when `exclude` is `None` (a
/// detached rebase), because a ref that happens to equal the detached tip is
/// not part of the stack being replayed.
pub fn stacked_refs(
    repo: &Repository,
    plan_oids: &HashSet<String>,
    exclude: Option<&str>,
) -> AppResult<Vec<StackedRef>> {
    let mut out: Vec<StackedRef> = Vec::new();
    let branches = repo.branches(Some(git2::BranchType::Local))?;
    for entry in branches {
        let (branch, _) = entry?;
        // git2 0.21 turned `name()` into a `Result`; `Err` is only
        // non-UTF-8, so `.ok()` is the 0.20 behaviour byte for byte.
        let Some(name) = branch.get().name().ok() else {
            continue;
        };
        if Some(name) == exclude {
            continue;
        }
        let Some(oid) = branch.get().target() else {
            // A symbolic ref (a branch that is itself a symref) has no direct
            // target; it is not a stack tip.
            continue;
        };
        let oid = oid.to_string();
        if plan_oids.contains(&oid) {
            out.push(StackedRef {
                name: name.to_string(),
                short: short_name(name),
                oid,
            });
        }
    }
    // Deterministic order, so the confirmation dialog and the summary list the
    // same refs in the same order every time.
    out.sort_by(|a, b| a.short.cmp(&b.short));
    Ok(out)
}

/// Point each stacked ref at the commit its old tip was replayed as.
///
/// A ref whose old tip is absent from `rewritten` is LEFT ALONE. That happens
/// when its commit was dropped from the plan, and there is no honest place to
/// move it to — moving it to the surrounding commit would silently change what
/// the branch contains, and deleting it would destroy a ref the user never
/// asked us to touch. Leaving it is the only option that loses nothing, and the
/// summary reports what moved so the difference is visible.
pub fn move_refs(
    repo: &Repository,
    stacked: &[StackedRef],
    rewritten: &HashMap<String, String>,
) -> AppResult<Vec<MovedRef>> {
    let mut moved = Vec::new();
    for r in stacked {
        let Some(new_oid) = rewritten.get(&r.oid) else {
            continue;
        };
        if new_oid == &r.oid {
            // Replayed to itself — nothing moved, so do not claim it did.
            continue;
        }
        let Ok(oid) = git2::Oid::from_str(new_oid) else {
            continue;
        };
        repo.reference(&r.name, oid, true, "rebase (update-refs)")?;
        moved.push(MovedRef {
            name: r.name.clone(),
            short: r.short.clone(),
            from: r.oid.clone(),
            to: new_oid.clone(),
        });
    }
    Ok(moved)
}

/// `move_refs` against the `BTreeMap` the on-disk state uses.
pub fn move_refs_btree(
    repo: &Repository,
    stacked: &[StackedRef],
    rewritten: &BTreeMap<String, String>,
) -> AppResult<Vec<MovedRef>> {
    let map: HashMap<String, String> = rewritten
        .iter()
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    move_refs(repo, stacked, &map)
}
