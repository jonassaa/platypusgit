//! Start and stop the filesystem watcher (#239).
//!
//! Two commands and no state of their own — [`crate::watcher::WatchState`] owns
//! the single live watch. The frontend calls `watch_repo` when a repository
//! becomes the active tab and `watch_stop` when the setting is turned off or
//! the last repository closes; a second `watch_repo` replaces rather than
//! stacks, so a tab switch needs no matching stop.

use std::path::PathBuf;

use tauri::{AppHandle, State};

use crate::{
    error::{AppError, AppResult},
    git::types::RepoId,
    state::AppState,
    watcher::WatchState,
};

/// Watch this repository's working directory, replacing any existing watch.
///
/// The workdir is resolved through the backend rather than taken from the
/// frontend: a path argument would be a second source of truth for where a
/// repository lives, and this one registers an OS-level recursive watch on
/// whatever it is handed.
#[tauri::command]
pub async fn watch_repo(
    app: AppHandle,
    state: State<'_, AppState>,
    watch: State<'_, WatchState>,
    repo_id: String,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let id = RepoId(repo_id.clone());
    let workdir: PathBuf = tokio::task::spawn_blocking(move || backend.repo_path(&id))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))??;
    // `start` opens a libgit2 handle and registers the watch — both blocking,
    // both fast, and neither touching the shared per-repo mutex. See the
    // module note in `watcher.rs` for why this does not go through it.
    watch.inner().start(app, repo_id, workdir)
}

/// Stop watching. Idempotent — the frontend calls this on a setting change
/// without knowing whether anything was running.
#[tauri::command]
pub async fn watch_stop(watch: State<'_, WatchState>) -> AppResult<()> {
    watch.inner().stop();
    Ok(())
}
