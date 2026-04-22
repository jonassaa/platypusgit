use tauri::State;

use crate::{
    error::{AppError, AppResult},
    git::types::{CommitInfo, RepoId},
    state::AppState,
};

#[tauri::command]
pub async fn get_log(
    state: State<'_, AppState>,
    repo_id: String,
    limit: Option<usize>,
) -> AppResult<Vec<CommitInfo>> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let limit = limit.unwrap_or(500);
    tokio::task::spawn_blocking(move || backend.log(&repo_id, limit))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn commit(
    _state: State<'_, AppState>,
    _repo_id: String,
    _message: String,
    _amend: bool,
) -> AppResult<String> {
    Err(AppError::NotImplemented)
}
