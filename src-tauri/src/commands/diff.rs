use tauri::State;

use crate::{
    error::{AppError, AppResult},
    git::types::{DiffHunks, DiffKind},
    state::AppState,
};

#[tauri::command]
pub async fn get_diff(
    _state: State<'_, AppState>,
    _repo_id: String,
    _path: String,
    _kind: DiffKind,
) -> AppResult<DiffHunks> {
    Err(AppError::NotImplemented)
}

#[tauri::command]
pub async fn stage_paths(
    _state: State<'_, AppState>,
    _repo_id: String,
    _paths: Vec<String>,
) -> AppResult<()> {
    Err(AppError::NotImplemented)
}

#[tauri::command]
pub async fn unstage_paths(
    _state: State<'_, AppState>,
    _repo_id: String,
    _paths: Vec<String>,
) -> AppResult<()> {
    Err(AppError::NotImplemented)
}
