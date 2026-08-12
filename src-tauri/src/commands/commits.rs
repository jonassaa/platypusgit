use tauri::State;

use crate::{
    error::{AppError, AppResult},
    git::types::{AuthorOverride, CommitInfo, CommitOptions, LogFilter, LogPage, RepoId},
    state::AppState,
};

#[tauri::command]
pub async fn get_log(
    state: State<'_, AppState>,
    repo_id: String,
    limit: Option<usize>,
    refspec: Option<String>,
) -> AppResult<Vec<CommitInfo>> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let limit = limit.unwrap_or(500);
    tokio::task::spawn_blocking(move || backend.log(&repo_id, refspec.as_deref(), limit))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

/// One page of the log, resumable via `cursor` (#68 G11). `cursor` is the
/// `nextCursor` of the previous page; omit it for the first page. When a
/// cursor is given, `refspec` is ignored — the frontier already encodes the
/// walk it continues.
#[tauri::command]
pub async fn get_log_page(
    state: State<'_, AppState>,
    repo_id: String,
    cursor: Option<Vec<String>>,
    limit: Option<usize>,
    refspec: Option<String>,
) -> AppResult<LogPage> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let limit = limit.unwrap_or(500);
    tokio::task::spawn_blocking(move || {
        backend.log_page(&repo_id, refspec.as_deref(), cursor.as_deref(), limit)
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
}

/// Like `get_log_page`, but only commits matching `filter` count toward
/// `limit`.
#[tauri::command]
pub async fn get_log_filtered_page(
    state: State<'_, AppState>,
    repo_id: String,
    filter: LogFilter,
    cursor: Option<Vec<String>>,
    limit: Option<usize>,
    refspec: Option<String>,
) -> AppResult<LogPage> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let limit = limit.unwrap_or(500);
    tokio::task::spawn_blocking(move || {
        backend.log_filtered_page(
            &repo_id,
            &filter,
            refspec.as_deref(),
            cursor.as_deref(),
            limit,
        )
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn get_log_filtered(
    state: State<'_, AppState>,
    repo_id: String,
    filter: LogFilter,
    limit: Option<usize>,
    refspec: Option<String>,
) -> AppResult<Vec<CommitInfo>> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let limit = limit.unwrap_or(500);
    tokio::task::spawn_blocking(move || {
        backend.log_filtered(&repo_id, &filter, refspec.as_deref(), limit)
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn commits_since(
    state: State<'_, AppState>,
    repo_id: String,
    base: String,
) -> AppResult<Vec<CommitInfo>> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.commits_since(&repo_id, &base))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn commit(
    state: State<'_, AppState>,
    repo_id: String,
    message: String,
    amend: bool,
    signoff: Option<bool>,
    // "Commit as someone else" — the backend has honored this since the commit
    // op was written; nothing sent it until #61 D1. Absent means "use the repo
    // config identity", which is the overwhelmingly common case.
    author_override: Option<AuthorOverride>,
) -> AppResult<String> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let opts = CommitOptions {
        message,
        amend,
        author_override,
        signoff: signoff.unwrap_or(false),
    };
    tokio::task::spawn_blocking(move || backend.commit(&repo_id, opts))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn file_history(
    state: State<'_, AppState>,
    repo_id: String,
    path: String,
    limit: usize,
) -> AppResult<Vec<CommitInfo>> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let path = std::path::PathBuf::from(path);
    tokio::task::spawn_blocking(move || backend.file_history(&repo_id, &path, limit))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}
