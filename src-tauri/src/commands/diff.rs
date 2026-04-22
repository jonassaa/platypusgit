use std::path::PathBuf;

use tauri::State;

use crate::{
    error::{AppError, AppResult},
    git::types::{DiffKind, FileDiff, RepoId},
    state::AppState,
};

#[tauri::command]
pub async fn get_diff(
    state: State<'_, AppState>,
    repo_id: String,
    path: String,
    kind: DiffKind,
) -> AppResult<FileDiff> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let path = PathBuf::from(path);
    tokio::task::spawn_blocking(move || backend.diff(&repo_id, &path, kind))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn stage_paths(
    state: State<'_, AppState>,
    repo_id: String,
    paths: Vec<String>,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let paths: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    tokio::task::spawn_blocking(move || backend.stage(&repo_id, &paths))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn unstage_paths(
    state: State<'_, AppState>,
    repo_id: String,
    paths: Vec<String>,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let paths: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    tokio::task::spawn_blocking(move || backend.unstage(&repo_id, &paths))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn discard_paths(
    state: State<'_, AppState>,
    repo_id: String,
    paths: Vec<String>,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let paths: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    tokio::task::spawn_blocking(move || backend.discard(&repo_id, &paths))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}
