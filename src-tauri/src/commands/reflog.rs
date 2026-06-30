use tauri::State;

use crate::{
    error::{AppError, AppResult},
    git::types::{ReflogEntry, RepoId},
    state::AppState,
};

#[tauri::command]
pub async fn get_reflog(
    state: State<'_, AppState>,
    repo_id: String,
) -> AppResult<Vec<ReflogEntry>> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.read_reflog(&repo_id))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn checkout_detached(
    state: State<'_, AppState>,
    repo_id: String,
    oid: String,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.checkout_detached(&repo_id, &oid))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}
