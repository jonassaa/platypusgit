use tauri::State;

use crate::{
    error::{AppError, AppResult},
    git::types::CommitInfo,
    state::AppState,
};

#[tauri::command]
pub async fn get_log(
    _state: State<'_, AppState>,
    _repo_id: String,
    _limit: usize,
) -> AppResult<Vec<CommitInfo>> {
    Err(AppError::NotImplemented)
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
