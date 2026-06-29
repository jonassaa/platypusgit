use tauri::State;

use crate::{
    error::{AppError, AppResult},
    git::types::{CommitInfo, CommitOptions, RepoId},
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
pub async fn commits_since(
    state: State<'_, AppState>,
    repo_id: String,
    base: String,
) -> AppResult<Vec<CommitInfo>> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.commits_since(&repo_id, &base))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn commit(
    state: State<'_, AppState>,
    repo_id: String,
    message: String,
    amend: bool,
    signoff: Option<bool>,
) -> AppResult<String> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let opts = CommitOptions {
        message,
        amend,
        author_override: None,
        signoff: signoff.unwrap_or(false),
    };
    tokio::task::spawn_blocking(move || backend.commit(&repo_id, opts))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn file_history(
    state: State<'_, AppState>,
    repo_id: String,
    path: String,
    limit: usize,
) -> AppResult<Vec<CommitInfo>> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let path = std::path::PathBuf::from(path);
    tokio::task::spawn_blocking(move || backend.file_history(&repo_id, &path, limit))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}
