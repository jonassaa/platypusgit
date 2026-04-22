use tauri::State;

use crate::{
    error::{AppError, AppResult},
    git::types::{RepoId, ResetMode},
    state::AppState,
};

#[tauri::command]
pub async fn reset(
    state: State<'_, AppState>,
    repo_id: String,
    target: String,
    mode: ResetMode,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.reset(&repo_id, &target, mode))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}
