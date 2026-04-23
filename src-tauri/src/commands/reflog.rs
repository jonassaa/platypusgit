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
