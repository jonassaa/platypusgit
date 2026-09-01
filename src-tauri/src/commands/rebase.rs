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
/// `update_refs` moves dependent branches whose tips sit inside the replayed
/// range (#240). `None` — which is what an older webview sends — defers to the
/// repository's own `rebase.updateRefs`, so the app never turns it on for
/// someone who did not ask.
pub async fn rebase_start(
    app: AppHandle,
    state: State<'_, AppState>,
    repo_id: String,
    plan: Vec<RebaseStep>,
    update_refs: Option<bool>,
) -> AppResult<RebaseStatus> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    // The whole plan replays inside this one blocking call, so without the sink
    // the frontend learns nothing until it is over (#296).
    tokio::task::spawn_blocking(move || {
        backend.rebase_start_with_progress(&repo_id, plan, update_refs, &emit_progress(&app))
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
}

/// Which local branches an `--update-refs` rebase of `oids` would move (#240).
///
/// Read-only, and asked BEFORE the rebase: the valuable half of this feature is
/// telling the user "this will also move `feat/b` and `feat/c`" while they can
/// still say no.
#[tauri::command]
pub async fn stacked_refs(
    state: State<'_, AppState>,
    repo_id: String,
    oids: Vec<String>,
) -> AppResult<Vec<crate::git::update_refs::StackedRef>> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.stacked_refs(&repo_id, oids))
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
