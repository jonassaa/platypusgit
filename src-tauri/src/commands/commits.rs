use tauri::State;

use crate::{
    error::{AppError, AppResult},
    git::types::{
        AheadBehind, AuthorOverride, CommitInfo, CommitNote, CommitOptions, CommitResult, LogFilter,
        LogPage, RepoId,
    },
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

/// `base..tip`, newest-first (#131). Unlike `commits_since`, neither side has to
/// be an ancestor of the other — two diverged branches is the case this exists
/// for.
#[tauri::command]
pub async fn commits_between(
    state: State<'_, AppState>,
    repo_id: String,
    base: String,
    tip: String,
    limit: Option<usize>,
) -> AppResult<Vec<CommitInfo>> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let limit = limit.unwrap_or(200);
    tokio::task::spawn_blocking(move || backend.commits_between(&repo_id, &base, &tip, limit))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

/// How `b` stands relative to `a`, plus their merge base (#131).
#[tauri::command]
pub async fn ahead_behind(
    state: State<'_, AppState>,
    repo_id: String,
    a: String,
    b: String,
) -> AppResult<AheadBehind> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.ahead_behind(&repo_id, &a, &b))
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
    // None = follow `commit.gpgsign`; Some overrides it for this commit (#61 D6).
    sign: Option<bool>,
    // Skip every commit-side hook for this commit only (#232). Optional so a
    // caller that omits it keeps hooks ON, which is the safe default.
    no_verify: Option<bool>,
) -> AppResult<CommitResult> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let opts = CommitOptions {
        message,
        amend,
        author_override,
        signoff: signoff.unwrap_or(false),
        sign,
        no_verify: no_verify.unwrap_or(false),
    };
    tokio::task::spawn_blocking(move || backend.commit(&repo_id, opts))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

/// The repository's `commit.template` + comment prefix (#252).
///
/// Called once per commit-screen visit. A configured template that cannot be
/// read comes back FLAGGED, not as an error: a stale `commit.template` line
/// must not stop the commit screen from opening, and the composer names the
/// path on screen instead of failing silently.
#[tauri::command]
pub async fn get_commit_template(
    state: State<'_, AppState>,
    repo_id: String,
) -> AppResult<crate::git::commit_template::CommitTemplate> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.commit_template(&repo_id))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

/// Signature status of one commit (#61 D6). Called lazily for the selected
/// commit, never per log row.
#[tauri::command]
pub async fn verify_commit(
    state: State<'_, AppState>,
    repo_id: String,
    oid: String,
) -> AppResult<crate::git::signing::SignatureStatus> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.verify_commit(&repo_id, &oid))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

/// Every `refs/notes/*` note on ONE commit (#253).
///
/// Read-only, and lazy for the SELECTED commit — the same shape (and the same
/// reason) as `verify_commit` beside it: the paged log walk is the hot path,
/// and a per-row notes lookup would put a fanout-tree descent on every page.
#[tauri::command]
pub async fn commit_notes(
    state: State<'_, AppState>,
    repo_id: String,
    oid: String,
) -> AppResult<Vec<CommitNote>> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.commit_notes(&repo_id, &oid))
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
