use tauri::State;

use crate::{
    error::{AppError, AppResult},
    git::types::{RepoId, StashSaveOptions},
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
pub async fn stash_drop(
    state: State<'_, AppState>,
    repo_id: String,
    index: usize,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.stash_drop(&repo_id, index))
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
