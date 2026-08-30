use tauri::{AppHandle, Emitter, State};

use crate::{
    error::{AppError, AppResult},
    git::types::{RebaseStatus, RebaseStep, RepoId},
    state::AppState,
};

/// Publish one replay step to `rebase://progress` (#296).
///
/// A dropped event costs one tick of the counter, never the rebase — the same
/// policy `clone://progress` and `net://progress` take.
fn emit_progress(app: &AppHandle) -> impl Fn(crate::git::types::RebaseProgress) + Send + Sync + '_ {
    move |p| {
        let _ = app.emit("rebase://progress", &p);
    }
}

#[tauri::command]
pub async fn rebase_start(
    app: AppHandle,
    state: State<'_, AppState>,
    repo_id: String,
    plan: Vec<RebaseStep>,
) -> AppResult<RebaseStatus> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    // The whole plan replays inside this one blocking call, so without the sink
    // the frontend learns nothing until it is over (#296).
    tokio::task::spawn_blocking(move || {
        backend.rebase_start_with_progress(&repo_id, plan, &emit_progress(&app))
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn rebase_continue(
    app: AppHandle,
    state: State<'_, AppState>,
    repo_id: String,
) -> AppResult<RebaseStatus> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || {
        backend.rebase_continue_with_progress(&repo_id, &emit_progress(&app))
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn rebase_abort(state: State<'_, AppState>, repo_id: String) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.rebase_abort(&repo_id))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn rebase_status(
    state: State<'_, AppState>,
    repo_id: String,
) -> AppResult<RebaseStatus> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.rebase_status(&repo_id))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

/// Drop `RebaseStatus.last_completed` once the UI has shown it.
#[tauri::command]
pub async fn rebase_acknowledge(state: State<'_, AppState>, repo_id: String) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.rebase_acknowledge(&repo_id))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}
