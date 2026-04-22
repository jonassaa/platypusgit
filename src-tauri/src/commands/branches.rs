use tauri::State;

use crate::{
    error::{AppError, AppResult},
    git::types::{BranchInfo, RemoteInfo, RepoId, StashInfo, TagInfo, TagTarget},
    state::AppState,
};

#[tauri::command]
pub async fn list_branches(
    state: State<'_, AppState>,
    repo_id: String,
) -> AppResult<Vec<BranchInfo>> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.branches(&repo_id))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn list_tags(state: State<'_, AppState>, repo_id: String) -> AppResult<Vec<TagInfo>> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.tags(&repo_id))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn list_stashes(
    state: State<'_, AppState>,
    repo_id: String,
) -> AppResult<Vec<StashInfo>> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.stashes(&repo_id))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn list_remotes(
    state: State<'_, AppState>,
    repo_id: String,
) -> AppResult<Vec<RemoteInfo>> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.remotes(&repo_id))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn checkout_branch(
    state: State<'_, AppState>,
    repo_id: String,
    name: String,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.checkout_branch(&repo_id, &name))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn create_branch(
    state: State<'_, AppState>,
    repo_id: String,
    name: String,
    from: Option<String>,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.create_branch(&repo_id, &name, from.as_deref()))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn delete_branch(
    state: State<'_, AppState>,
    repo_id: String,
    name: String,
    force: bool,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.delete_branch(&repo_id, &name, force))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn rename_branch(
    state: State<'_, AppState>,
    repo_id: String,
    from: String,
    to: String,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.rename_branch(&repo_id, &from, &to))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
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

#[tauri::command]
pub async fn create_tag(
    state: State<'_, AppState>,
    repo_id: String,
    name: String,
    target: TagTarget,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.create_tag(&repo_id, &name, target))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn delete_tag(
    state: State<'_, AppState>,
    repo_id: String,
    name: String,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.delete_tag(&repo_id, &name))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}
