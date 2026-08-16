use std::path::PathBuf;

use tauri::State;

use crate::{
    error::{AppError, AppResult},
    git::types::{FileDiff, RepoId, StashSaveOptions},
    state::AppState,
};

#[tauri::command]
pub async fn stash_save(
    state: State<'_, AppState>,
    repo_id: String,
    opts: StashSaveOptions,
) -> AppResult<Option<String>> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.stash_save(&repo_id, opts))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn stash_apply(
    state: State<'_, AppState>,
    repo_id: String,
    index: usize,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.stash_apply(&repo_id, index))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn stash_pop(
    state: State<'_, AppState>,
    repo_id: String,
    index: usize,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.stash_pop(&repo_id, index))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
/// `oid` is REQUIRED: an index is a position in the `refs/stash` reflog, so any
/// write to that ref shifts it and dropping whatever moved into the slot
/// destroys a stash the user never selected (#133). The backend re-reads and
/// compares under the same lock it drops from.
pub async fn stash_drop(
    state: State<'_, AppState>,
    repo_id: String,
    index: usize,
    oid: String,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.stash_drop(&repo_id, index, &oid))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn stash_branch(
    state: State<'_, AppState>,
    repo_id: String,
    index: usize,
    branch: String,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.stash_branch(&repo_id, index, &branch))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

/// Stash only the given paths (#133). `Ok(None)` means git found nothing to
/// save under that pathspec — a state, not a failure.
#[tauri::command]
pub async fn stash_save_paths(
    state: State<'_, AppState>,
    repo_id: String,
    opts: StashSaveOptions,
    paths: Vec<PathBuf>,
) -> AppResult<Option<String>> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.stash_save_paths(&repo_id, opts, &paths))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

/// Rename the entry at `index` (#133). The caller must RE-READ the stash list
/// afterwards rather than patching its own copy: the rename is a store followed
/// by a drop, so the list is rewritten under it even though the net count is
/// unchanged.
#[tauri::command]
pub async fn stash_rename(
    state: State<'_, AppState>,
    repo_id: String,
    index: usize,
    oid: String,
    message: String,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.stash_rename(&repo_id, index, &oid, &message))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

/// What this stash changed — its first parent's tree against its own (#133).
/// Addressed by OID, not index: an index goes stale the moment anything writes
/// to `refs/stash`, and a stale one would diff a different entry.
#[tauri::command]
pub async fn stash_diff(
    state: State<'_, AppState>,
    repo_id: String,
    oid: String,
    context_lines: u32,
    ignore_whitespace: bool,
    include_untracked: bool,
) -> AppResult<Vec<FileDiff>> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || {
        backend.stash_diff(
            &repo_id,
            &oid,
            context_lines,
            ignore_whitespace,
            include_untracked,
        )
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
}
