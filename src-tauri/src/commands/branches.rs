use tauri::State;

use crate::{
    error::{AppError, AppResult},
    git::types::BranchInfo,
    state::AppState,
};

#[tauri::command]
pub async fn list_branches(
    _state: State<'_, AppState>,
    _repo_id: String,
) -> AppResult<Vec<BranchInfo>> {
    Err(AppError::NotImplemented)
}

#[tauri::command]
pub async fn checkout_branch(
    _state: State<'_, AppState>,
    _repo_id: String,
    _name: String,
) -> AppResult<()> {
    Err(AppError::NotImplemented)
}

#[tauri::command]
pub async fn create_branch(
    _state: State<'_, AppState>,
    _repo_id: String,
    _name: String,
    _from: Option<String>,
) -> AppResult<()> {
    Err(AppError::NotImplemented)
}

#[tauri::command]
pub async fn fetch(
    _state: State<'_, AppState>,
    _repo_id: String,
    _remote: String,
) -> AppResult<()> {
    Err(AppError::NotImplemented)
}

#[tauri::command]
pub async fn pull(
    _state: State<'_, AppState>,
    _repo_id: String,
    _remote: String,
    _branch: String,
) -> AppResult<()> {
    Err(AppError::NotImplemented)
}

#[tauri::command]
pub async fn push(
    _state: State<'_, AppState>,
    _repo_id: String,
    _remote: String,
    _branch: String,
) -> AppResult<()> {
    Err(AppError::NotImplemented)
}
