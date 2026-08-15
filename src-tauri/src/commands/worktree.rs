//! Linked-worktree commands (#93). All thin — libgit2 is sync, so every call is
//! wrapped in `spawn_blocking`.

use std::path::PathBuf;

use tauri::State;

use crate::{
    error::{AppError, AppResult},
    git::types::{RepoId, WorktreeBranch, WorktreeInfo},
    state::AppState,
};

#[tauri::command]
pub async fn list_worktrees(
    state: State<'_, AppState>,
    repo_id: String,
) -> AppResult<Vec<WorktreeInfo>> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.worktrees(&repo_id))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn worktree_add(
    state: State<'_, AppState>,
    repo_id: String,
    path: String,
    branch: WorktreeBranch,
) -> AppResult<WorktreeInfo> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let path = PathBuf::from(path);
    tokio::task::spawn_blocking(move || backend.worktree_add(&repo_id, &path, branch))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

/// Remove a worktree. `force` is `git worktree remove --force`: only ever pass it
/// behind a SECOND, explicit confirmation — without it git refuses on uncommitted
/// work and that refusal arrives as `DirtyWorktree`, which is the point.
#[tauri::command]
pub async fn worktree_remove(
    state: State<'_, AppState>,
    repo_id: String,
    name: String,
    force: bool,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.worktree_remove(&repo_id, &name, force))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn worktree_lock(
    state: State<'_, AppState>,
    repo_id: String,
    name: String,
    reason: Option<String>,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.worktree_lock(&repo_id, &name, reason.as_deref()))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn worktree_unlock(
    state: State<'_, AppState>,
    repo_id: String,
    name: String,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.worktree_unlock(&repo_id, &name))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

/// Prune every prunable worktree, returning the names that went.
#[tauri::command]
pub async fn worktree_prune(
    state: State<'_, AppState>,
    repo_id: String,
) -> AppResult<Vec<String>> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.worktree_prune(&repo_id))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}
