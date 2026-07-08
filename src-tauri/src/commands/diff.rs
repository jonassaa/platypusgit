use std::path::PathBuf;

use tauri::State;

use crate::{
    error::{AppError, AppResult},
    git::types::{BlameLine, DiffKind, FileDiff, RepoId},
    state::AppState,
};

#[tauri::command]
pub async fn stage_hunk(
    state: State<'_, AppState>,
    repo_id: String,
    path: String,
    hunk_index: usize,
    context_lines: u32,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let path = PathBuf::from(path);
    tokio::task::spawn_blocking(move || {
        backend.stage_hunk(&repo_id, &path, hunk_index, context_lines)
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn unstage_hunk(
    state: State<'_, AppState>,
    repo_id: String,
    path: String,
    hunk_index: usize,
    context_lines: u32,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let path = PathBuf::from(path);
    tokio::task::spawn_blocking(move || {
        backend.unstage_hunk(&repo_id, &path, hunk_index, context_lines)
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn discard_hunk(
    state: State<'_, AppState>,
    repo_id: String,
    path: String,
    hunk_index: usize,
    context_lines: u32,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let path = PathBuf::from(path);
    tokio::task::spawn_blocking(move || {
        backend.discard_hunk(&repo_id, &path, hunk_index, context_lines)
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn get_diff(
    state: State<'_, AppState>,
    repo_id: String,
    path: String,
    kind: DiffKind,
    context_lines: u32,
) -> AppResult<FileDiff> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let path = PathBuf::from(path);
    tokio::task::spawn_blocking(move || backend.diff(&repo_id, &path, kind, context_lines))
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

#[tauri::command]
pub async fn diff_commits(
    state: State<'_, AppState>,
    repo_id: String,
    from_oid: String,
    to_oid: String,
    context_lines: u32,
) -> AppResult<Vec<FileDiff>> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || {
        backend.diff_commits(&repo_id, &from_oid, &to_oid, context_lines)
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn diff_commit(
    state: State<'_, AppState>,
    repo_id: String,
    oid: String,
    context_lines: u32,
) -> AppResult<Vec<FileDiff>> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.diff_commit(&repo_id, &oid, context_lines))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn blame_file(
    state: State<'_, AppState>,
    repo_id: String,
    path: String,
) -> AppResult<Vec<BlameLine>> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let path = PathBuf::from(path);
    tokio::task::spawn_blocking(move || backend.blame_file(&repo_id, &path))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}
