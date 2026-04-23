use std::path::PathBuf;

use tauri::State;

use crate::{
    error::{AppError, AppResult},
    git::types::{ConflictSides, RepoId, RepoState},
    state::AppState,
};

#[tauri::command]
pub async fn repo_state(
    state: State<'_, AppState>,
    repo_id: String,
) -> AppResult<RepoState> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.repo_state(&repo_id))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn conflict_sides(
    state: State<'_, AppState>,
    repo_id: String,
    path: String,
) -> AppResult<ConflictSides> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let path = PathBuf::from(path);
    tokio::task::spawn_blocking(move || backend.conflict_sides(&repo_id, &path))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn accept_ours(
    state: State<'_, AppState>,
    repo_id: String,
    path: String,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let path = PathBuf::from(path);
    tokio::task::spawn_blocking(move || backend.accept_ours(&repo_id, &path))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn accept_theirs(
    state: State<'_, AppState>,
    repo_id: String,
    path: String,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let path = PathBuf::from(path);
    tokio::task::spawn_blocking(move || backend.accept_theirs(&repo_id, &path))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn mark_resolved(
    state: State<'_, AppState>,
    repo_id: String,
    paths: Vec<String>,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let paths: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    tokio::task::spawn_blocking(move || backend.mark_resolved(&repo_id, &paths))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn abort_operation(
    state: State<'_, AppState>,
    repo_id: String,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.abort_operation(&repo_id))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn continue_operation(
    state: State<'_, AppState>,
    repo_id: String,
) -> AppResult<String> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.continue_operation(&repo_id))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}
