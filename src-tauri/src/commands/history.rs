use tauri::State;

use crate::{
    error::{AppError, AppResult},
    git::types::{RepoId, ResetMode},
    state::AppState,
};

#[tauri::command]
pub async fn reset(
    state: State<'_, AppState>,
    repo_id: String,
    target: String,
    mode: ResetMode,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.reset(&repo_id, &target, mode))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn cherry_pick(
    state: State<'_, AppState>,
    repo_id: String,
    oid: String,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.cherry_pick(&repo_id, &oid))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn revert(
    state: State<'_, AppState>,
    repo_id: String,
    oid: String,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.revert(&repo_id, &oid))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}
