//! Bisect commands (#93). Thin — the backend owns every `git bisect` invocation,
//! and git's own `.git/BISECT_*` files are the state of record (see `git/bisect.rs`).

use tauri::State;

use crate::{
    error::{AppError, AppResult},
    git::types::{BisectMark, BisectStatus, RepoId},
    state::AppState,
};

#[tauri::command]
pub async fn bisect_status(
    state: State<'_, AppState>,
    repo_id: String,
) -> AppResult<BisectStatus> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.bisect_status(&repo_id))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

/// `good` may be empty — git then waits for a good revision, which is what
/// "this commit is broken, I'll find a working one as I go" needs.
#[tauri::command]
pub async fn bisect_start(
    state: State<'_, AppState>,
    repo_id: String,
    bad: String,
    good: Vec<String>,
) -> AppResult<BisectStatus> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.bisect_start(&repo_id, &bad, &good))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

/// Mark `rev` (or HEAD when omitted) and let git pick the next revision to test.
#[tauri::command]
pub async fn bisect_mark(
    state: State<'_, AppState>,
    repo_id: String,
    mark: BisectMark,
    rev: Option<String>,
) -> AppResult<BisectStatus> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.bisect_mark(&repo_id, mark, rev.as_deref()))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

/// `git bisect reset` — return to where the bisect started. NOT
/// `abort_operation`, which hard-resets to HEAD; mid-bisect HEAD is a detached
/// test commit, so that would strand the user instead of taking them home.
#[tauri::command]
pub async fn bisect_reset(state: State<'_, AppState>, repo_id: String) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.bisect_reset(&repo_id))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}
