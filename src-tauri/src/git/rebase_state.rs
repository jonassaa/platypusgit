//! The on-disk mirror of an in-progress interactive rebase.
//!
//! The engine's `RebaseState` lives in a `HashMap` inside `Libgit2Backend`, so
//! before this existed, closing the app during a rebase left a detached HEAD
//! part-way through a replay with no way back but the reflog. This module keeps
//! a JSON mirror in the gitdir and writes `ORIG_HEAD` the way git does, so both
//! the app and the `git` CLI can recover.
//!
//! Deliberately NOT git's own `.git/rebase-merge/` directory: a
//! half-compatible one would make `git status` and `git rebase --continue`
//! claim authority over a rebase they cannot drive.

use std::{collections::BTreeMap, path::PathBuf};

use git2::Repository;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

use super::types::RebaseStep;

pub const FILE_NAME: &str = "platypusgit-rebase.json";
pub const VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedCurrent {
    pub step: RebaseStep,
    /// "conflict" | "edit" — mirrors `RebaseStatus.pause_reason`.
    pub phase: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedRebase {
    pub version: u32,
    /// Branch to move when the plan completes; `None` when the rebase started
    /// from a detached HEAD.
    pub head_name: Option<String>,
    pub orig_head: String,
    pub onto: String,
    pub total: usize,
    pub completed: usize,
    pub remaining: Vec<RebaseStep>,
    /// Why the rebase is paused — "conflict" | "edit" | absent. Persisted
    /// separately from `current` because an edit pause has no held-back step:
    /// its commit already landed.
    pub pause_reason: Option<String>,
    /// The step whose apply conflicted and is awaiting resolution, if any.
    pub current: Option<PersistedCurrent>,
    pub rewritten: BTreeMap<String, String>,
}

pub fn path(repo: &Repository) -> PathBuf {
    repo.path().join(FILE_NAME)
}

/// Write via temp file + rename so a crash mid-write cannot leave a truncated
/// state file that would read as "no rebase in progress".
pub fn save(repo: &Repository, state: &PersistedRebase) -> AppResult<()> {
    let target = path(repo);
    let tmp = target.with_extension("json.tmp");
    let json = serde_json::to_vec_pretty(state)
        .map_err(|e| AppError::Internal(format!("serialising rebase state: {e}")))?;
    std::fs::write(&tmp, json)?;
    std::fs::rename(&tmp, &target)?;
    Ok(())
}

/// `Ok(None)` when there is no file. A file we cannot parse is an error, not a
/// silent "no rebase": guessing here is how a half-replayed branch would lose
/// its way back.
pub fn load(repo: &Repository) -> AppResult<Option<PersistedRebase>> {
    let target = path(repo);
    match std::fs::read(&target) {
        Ok(bytes) => {
            let state: PersistedRebase = serde_json::from_slice(&bytes).map_err(|e| {
                AppError::Internal(format!("unreadable rebase state in {FILE_NAME}: {e}"))
            })?;
            if state.version != VERSION {
                return Err(AppError::Internal(format!(
                    "{FILE_NAME} was written by another version ({}), refusing to guess",
                    state.version
                )));
            }
            Ok(Some(state))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

pub fn clear(repo: &Repository) -> AppResult<()> {
    match std::fs::remove_file(path(repo)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}

/// `ORIG_HEAD`, written the way git writes it before a history-rewriting
/// operation, so `git reset --hard ORIG_HEAD` works from the CLI.
pub fn write_orig_head(repo: &Repository, oid: &str) -> AppResult<()> {
    let target = repo.path().join("ORIG_HEAD");
    std::fs::write(target, format!("{oid}\n"))?;
    Ok(())
}
