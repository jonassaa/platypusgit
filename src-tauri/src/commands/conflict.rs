use std::path::PathBuf;

use tauri::State;

use crate::{
    error::{AppError, AppResult},
    git::types::{ConflictSides, RepoId, RepoState},
    state::AppState,
};

#[tauri::command]
pub async fn repo_state(
    state: State<'_, AppState>,
    repo_id: String,
) -> AppResult<RepoState> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.repo_state(&repo_id))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn conflict_sides(
    state: State<'_, AppState>,
    repo_id: String,
    path: String,
) -> AppResult<ConflictSides> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let path = PathBuf::from(path);
    tokio::task::spawn_blocking(move || backend.conflict_sides(&repo_id, &path))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn accept_ours(
    state: State<'_, AppState>,
    repo_id: String,
    path: String,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let path = PathBuf::from(path);
    tokio::task::spawn_blocking(move || backend.accept_ours(&repo_id, &path))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn accept_theirs(
    state: State<'_, AppState>,
    repo_id: String,
    path: String,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let path = PathBuf::from(path);
    tokio::task::spawn_blocking(move || backend.accept_theirs(&repo_id, &path))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn mark_resolved(
    state: State<'_, AppState>,
    repo_id: String,
    paths: Vec<String>,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let paths: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    tokio::task::spawn_blocking(move || backend.mark_resolved(&repo_id, &paths))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

/// Write an in-app merge resolution to the worktree and stage it.
#[tauri::command]
pub async fn save_resolution(
    state: State<'_, AppState>,
    repo_id: String,
    path: String,
    content: String,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let path = PathBuf::from(path);
    tokio::task::spawn_blocking(move || backend.save_resolution(&repo_id, &path, &content))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn abort_operation(
    state: State<'_, AppState>,
    repo_id: String,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.abort_operation(&repo_id))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn continue_operation(
    state: State<'_, AppState>,
    repo_id: String,
) -> AppResult<String> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.continue_operation(&repo_id))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

/// Run `git mergetool -- <path>` in the worktree to launch the user's
/// configured mergetool.
#[tauri::command]
pub async fn run_mergetool(
    state: State<'_, AppState>,
    repo_id: String,
    path: String,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id_cloned = RepoId(repo_id);
    let workdir: PathBuf = tokio::task::spawn_blocking(move || {
        backend.repo_path(&repo_id_cloned)
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))??;

    let status = tokio::process::Command::new("git")
        .arg("-C")
        .arg(&workdir)
        .arg("mergetool")
        .arg("--no-prompt")
        .arg("--")
        .arg(&path)
        .status()
        .await
        .map_err(|e| AppError::Io(e.to_string()))?;
    if !status.success() {
        return Err(AppError::Network(format!(
            "git mergetool exited with {status}"
        )));
    }
    Ok(())
}

#[tauri::command]
pub async fn restart_conflict(
    state: State<'_, AppState>,
    repo_id: String,
    path: String,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id_cloned = RepoId(repo_id);
    let workdir: PathBuf = tokio::task::spawn_blocking(move || {
        backend.repo_path(&repo_id_cloned)
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))??;

    let status = tokio::process::Command::new("git")
        .arg("-C")
        .arg(&workdir)
        .arg("checkout")
        .arg("--merge")
        .arg("--")
        .arg(&path)
        .status()
        .await
        .map_err(|e| AppError::Io(e.to_string()))?;
    if !status.success() {
        return Err(AppError::Git(format!(
            "git checkout --merge exited with {status}"
        )));
    }
    Ok(())
}
