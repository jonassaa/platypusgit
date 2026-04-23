use std::path::PathBuf;

use tauri::State;

use crate::{
    error::{AppError, AppResult},
    git::types::{FileStatus, RepoHandle, RepoId},
    state::AppState,
};

#[tauri::command]
pub async fn open_repo(
    state: State<'_, AppState>,
    path: String,
) -> AppResult<RepoHandle> {
    let backend = state.backend.clone();
    let path_buf = PathBuf::from(path);
    tokio::task::spawn_blocking(move || backend.open(&path_buf))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn get_status(
    state: State<'_, AppState>,
    repo_id: String,
) -> AppResult<Vec<FileStatus>> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.status(&repo_id))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn list_all_files(
    state: State<'_, AppState>,
    repo_id: String,
) -> AppResult<Vec<FileStatus>> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.list_all_files(&repo_id))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn append_gitignore(
    state: State<'_, AppState>,
    repo_id: String,
    pattern: String,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.append_gitignore(&repo_id, &pattern))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}
