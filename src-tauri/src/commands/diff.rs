use std::path::PathBuf;

use tauri::State;

use crate::{
    error::{AppError, AppResult},
    git::types::{BlameLine, DiffKind, FileDiff, RepoId},
    state::AppState,
};

#[tauri::command]
pub async fn stage_hunk(
    state: State<'_, AppState>,
    repo_id: String,
    path: String,
    hunk_index: usize,
    context_lines: u32,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let path = PathBuf::from(path);
    tokio::task::spawn_blocking(move || {
        backend.stage_hunk(&repo_id, &path, hunk_index, context_lines)
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn unstage_hunk(
    state: State<'_, AppState>,
    repo_id: String,
    path: String,
    hunk_index: usize,
    context_lines: u32,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let path = PathBuf::from(path);
    tokio::task::spawn_blocking(move || {
        backend.unstage_hunk(&repo_id, &path, hunk_index, context_lines)
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn discard_hunk(
    state: State<'_, AppState>,
    repo_id: String,
    path: String,
    hunk_index: usize,
    context_lines: u32,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let path = PathBuf::from(path);
    tokio::task::spawn_blocking(move || {
        backend.discard_hunk(&repo_id, &path, hunk_index, context_lines)
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
}

// Line-level staging (#61 D7). `selected` holds indices among the hunk's
// CHANGED (+/-) lines, counted in hunk order from 0 — see GitBackend's docs.

#[tauri::command]
pub async fn stage_lines(
    state: State<'_, AppState>,
    repo_id: String,
    path: String,
    hunk_index: usize,
    selected: Vec<usize>,
    context_lines: u32,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let path = PathBuf::from(path);
    tokio::task::spawn_blocking(move || {
        backend.stage_lines(&repo_id, &path, hunk_index, &selected, context_lines)
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn unstage_lines(
    state: State<'_, AppState>,
    repo_id: String,
    path: String,
    hunk_index: usize,
    selected: Vec<usize>,
    context_lines: u32,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let path = PathBuf::from(path);
    tokio::task::spawn_blocking(move || {
        backend.unstage_lines(&repo_id, &path, hunk_index, &selected, context_lines)
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn discard_lines(
    state: State<'_, AppState>,
    repo_id: String,
    path: String,
    hunk_index: usize,
    selected: Vec<usize>,
    context_lines: u32,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let path = PathBuf::from(path);
    tokio::task::spawn_blocking(move || {
        backend.discard_lines(&repo_id, &path, hunk_index, &selected, context_lines)
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn get_diff(
    state: State<'_, AppState>,
    repo_id: String,
    path: String,
    kind: DiffKind,
    context_lines: u32,
    // Viewing option only — see the `diff` doc on GitBackend. Optional so an
    // older caller (or a test) that omits it keeps the exact git default.
    ignore_whitespace: Option<bool>,
) -> AppResult<FileDiff> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let path = PathBuf::from(path);
    let iw = ignore_whitespace.unwrap_or(false);
    tokio::task::spawn_blocking(move || backend.diff(&repo_id, &path, kind, context_lines, iw))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn stage_paths(
    state: State<'_, AppState>,
    repo_id: String,
    paths: Vec<String>,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let paths: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    tokio::task::spawn_blocking(move || backend.stage(&repo_id, &paths))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn unstage_paths(
    state: State<'_, AppState>,
    repo_id: String,
    paths: Vec<String>,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let paths: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    tokio::task::spawn_blocking(move || backend.unstage(&repo_id, &paths))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn discard_paths(
    state: State<'_, AppState>,
    repo_id: String,
    paths: Vec<String>,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let paths: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    tokio::task::spawn_blocking(move || backend.discard(&repo_id, &paths))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn diff_commits(
    state: State<'_, AppState>,
    repo_id: String,
    from_oid: String,
    to_oid: String,
    context_lines: u32,
    ignore_whitespace: Option<bool>,
) -> AppResult<Vec<FileDiff>> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let iw = ignore_whitespace.unwrap_or(false);
    tokio::task::spawn_blocking(move || {
        backend.diff_commits(&repo_id, &from_oid, &to_oid, context_lines, iw)
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn diff_commit(
    state: State<'_, AppState>,
    repo_id: String,
    oid: String,
    context_lines: u32,
    ignore_whitespace: Option<bool>,
) -> AppResult<Vec<FileDiff>> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let iw = ignore_whitespace.unwrap_or(false);
    tokio::task::spawn_blocking(move || backend.diff_commit(&repo_id, &oid, context_lines, iw))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

/// Diff the tree at `revspec` against the working tree (#131).
///
/// `include_untracked` is optional so an older caller keeps git's own semantics;
/// the compare screen passes `true` — see the `GitBackend` doc for why.
#[tauri::command]
pub async fn diff_ref_to_workdir(
    state: State<'_, AppState>,
    repo_id: String,
    revspec: String,
    context_lines: u32,
    ignore_whitespace: Option<bool>,
    include_untracked: Option<bool>,
) -> AppResult<Vec<FileDiff>> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let iw = ignore_whitespace.unwrap_or(false);
    let untracked = include_untracked.unwrap_or(false);
    tokio::task::spawn_blocking(move || {
        backend.diff_ref_to_workdir(&repo_id, &revspec, context_lines, iw, untracked)
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn blame_file(
    state: State<'_, AppState>,
    repo_id: String,
    path: String,
) -> AppResult<Vec<BlameLine>> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let path = PathBuf::from(path);
    tokio::task::spawn_blocking(move || backend.blame_file(&repo_id, &path))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}
