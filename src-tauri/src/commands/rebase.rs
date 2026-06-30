use tauri::State;

use crate::{
    error::{AppError, AppResult},
    git::types::{RebaseStatus, RebaseStep, RepoId},
    state::AppState,
};

#[tauri::command]
pub async fn rebase_start(
    state: State<'_, AppState>,
    repo_id: String,
    plan: Vec<RebaseStep>,
) -> AppResult<RebaseStatus> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.rebase_start(&repo_id, plan))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn rebase_continue(
    state: State<'_, AppState>,
    repo_id: String,
) -> AppResult<RebaseStatus> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.rebase_continue(&repo_id))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn rebase_abort(state: State<'_, AppState>, repo_id: String) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.rebase_abort(&repo_id))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn rebase_status(
    state: State<'_, AppState>,
    repo_id: String,
) -> AppResult<RebaseStatus> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.rebase_status(&repo_id))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}
