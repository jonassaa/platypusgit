//! git-LFS commands (#93).
//!
//! `lfs_status` and `lfs_checkout` are local, so they are thin wrappers over the
//! backend. `lfs_fetch` and `lfs_pull` transfer objects from the LFS endpoint, so
//! they follow fetch/pull/push exactly: `net::run_git_authenticated` applies the
//! prompt-less-or-askpass environment and maps an auth failure to `AppError::Auth`,
//! which the frontend's existing credential retry already knows how to answer.
//!
//! Both network ops call `lfs::require` first, so a missing binary is
//! `LfsUnavailable` — never git's `'lfs' is not a git command` in an error banner.

use std::path::PathBuf;

use tauri::State;

use crate::{
    commands::net::Credentials,
    error::{AppError, AppResult},
    git::types::{LfsStatus, RepoId},
    state::AppState,
};

async fn workdir_of(state: &State<'_, AppState>, repo_id: &RepoId) -> AppResult<PathBuf> {
    let backend = state.backend.clone();
    let id = repo_id.clone();
    tokio::task::spawn_blocking(move || backend.repo_path(&id))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn lfs_status(state: State<'_, AppState>, repo_id: String) -> AppResult<LfsStatus> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.lfs_status(&repo_id))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn lfs_checkout(state: State<'_, AppState>, repo_id: String) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.lfs_checkout(&repo_id))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

/// Download LFS objects into `.git/lfs` without touching the worktree.
#[tauri::command]
pub async fn lfs_fetch(
    state: State<'_, AppState>,
    repo_id: String,
    remote: Option<String>,
    credentials: Option<Credentials>,
) -> AppResult<()> {
    let workdir = workdir_of(&state, &RepoId(repo_id)).await?;
    crate::git::lfs::require(&workdir)?;
    let args = crate::git::lfs::fetch_args(remote.as_deref());
    let borrowed: Vec<&str> = args.iter().map(String::as_str).collect();
    crate::commands::net::run_git_authenticated(&workdir, &borrowed, credentials.as_ref()).await
}

/// Fetch AND materialize — `git lfs pull` is fetch + checkout.
#[tauri::command]
pub async fn lfs_pull(
    state: State<'_, AppState>,
    repo_id: String,
    remote: Option<String>,
    credentials: Option<Credentials>,
) -> AppResult<()> {
    let workdir = workdir_of(&state, &RepoId(repo_id)).await?;
    crate::git::lfs::require(&workdir)?;
    let args = crate::git::lfs::pull_args(remote.as_deref());
    let borrowed: Vec<&str> = args.iter().map(String::as_str).collect();
    crate::commands::net::run_git_authenticated(&workdir, &borrowed, credentials.as_ref()).await
}
