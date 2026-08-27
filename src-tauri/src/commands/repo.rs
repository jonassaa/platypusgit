use std::path::{Path, PathBuf};

use tauri::State;

use crate::{
    error::{AppError, AppResult},
    git::types::{FileContent, FileStatus, HeadInfo, RepoHandle, RepoId},
    state::AppState,
};

/// Open a repository at `path`.
///
/// # Why this one command logs, when its siblings do not
///
/// It is the gate every session goes through, and a failure here leaves the app
/// with nothing to show — so "it will not load my repository" is the report that
/// arrives with the least evidence attached. Logging the path on the way IN and
/// the outcome on the way out turns three indistinguishable silences into three
/// different logs (#274):
///
/// * **No `open_repo` line at all** — the command was never reached. The folder
///   picker returned nothing (on WSL, typically no `xdg-desktop-portal`), or the
///   frontend never dispatched. Look for the webview's own stall warning.
/// * **An `open_repo` line and nothing after it** — libgit2 is still working,
///   or wedged. Paired with the webview's "still pending" line, that is a hang,
///   and the path on this line says which filesystem it is hanging on.
/// * **An `open_repo` line and a failure** — an ordinary error with a reason,
///   which was always the easy case.
#[tauri::command]
pub async fn open_repo(
    state: State<'_, AppState>,
    path: String,
) -> AppResult<RepoHandle> {
    let backend = state.backend.clone();
    let path_buf = PathBuf::from(path);
    tokio::task::spawn_blocking(move || {
        // Before the open, not after: the value of this line is that it is
        // written even when the call below never returns.
        log::info!("open_repo {}", path_buf.display());
        if let Some(warning) = crate::diagnostics::mount_warning(
            &path_buf,
            crate::diagnostics::host_facts(),
        ) {
            log::warn!("{warning}");
        }
        let result = backend.open(&path_buf);
        match &result {
            Ok(handle) => log::info!("open_repo ok: {}", handle.id.0),
            // Logged backend-side as well as in the webview's invoke wrapper:
            // this side survives a webview that has already torn down, and it
            // is the only side that records the path the failure was about.
            Err(e) => log::error!("open_repo failed for {}: {e}", path_buf.display()),
        }
        result
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
}

/// Forget an opened repository (a closed repository tab).
///
/// Best-effort by contract: an unknown id succeeds, so the frontend can close a
/// tab whose open never completed without showing an error.
#[tauri::command]
pub async fn close_repo(state: State<'_, AppState>, repo_id: String) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.close(&repo_id))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

/// Add `path` to the user's global `safe.directory` list, so libgit2 stops
/// refusing it. Reached only from the confirmation an `AppError::DubiousOwnership`
/// raises in the UI — never call it without asking first.
#[tauri::command]
pub async fn trust_repo_path(state: State<'_, AppState>, path: String) -> AppResult<()> {
    let backend = state.backend.clone();
    let path_buf = PathBuf::from(path);
    tokio::task::spawn_blocking(move || backend.trust_path(&path_buf))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

/// HEAD's current branch/oid, meant to be re-polled on every refresh — unlike
/// `RepoHandle.head`, which `open_repo` sets once and the frontend must not
/// treat as live after a checkout (#217).
#[tauri::command]
pub async fn head_info(state: State<'_, AppState>, repo_id: String) -> AppResult<HeadInfo> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.head_info(&repo_id))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn get_status(
    state: State<'_, AppState>,
    repo_id: String,
) -> AppResult<Vec<FileStatus>> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.status(&repo_id))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn list_all_files(
    state: State<'_, AppState>,
    repo_id: String,
) -> AppResult<Vec<FileStatus>> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.list_all_files(&repo_id))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn read_file_content(
    state: State<'_, AppState>,
    repo_id: String,
    path: String,
) -> AppResult<Option<FileContent>> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let path_buf = PathBuf::from(path);
    tokio::task::spawn_blocking(move || backend.read_file_content(&repo_id, &path_buf))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn list_files_at_rev(
    state: State<'_, AppState>,
    repo_id: String,
    revspec: String,
) -> AppResult<Vec<FileStatus>> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.list_files_at_rev(&repo_id, &revspec))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn read_file_content_at_rev(
    state: State<'_, AppState>,
    repo_id: String,
    revspec: String,
    path: String,
) -> AppResult<Option<FileContent>> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let path_buf = PathBuf::from(path);
    tokio::task::spawn_blocking(move || {
        backend.read_file_content_at_rev(&repo_id, &revspec, &path_buf)
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn read_file_content_at_index(
    state: State<'_, AppState>,
    repo_id: String,
    path: String,
) -> AppResult<Option<FileContent>> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let path_buf = PathBuf::from(path);
    tokio::task::spawn_blocking(move || backend.read_file_content_at_index(&repo_id, &path_buf))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn append_gitignore(
    state: State<'_, AppState>,
    repo_id: String,
    pattern: String,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.append_gitignore(&repo_id, &pattern))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

/// Open `relative_path` (relative to the repo's worktree) in the user's editor.
/// Resolution order: $VISUAL, $EDITOR, then the platform default opener.
#[tauri::command]
pub async fn open_in_editor(
    state: State<'_, AppState>,
    repo_id: String,
    relative_path: String,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id_cloned = RepoId(repo_id);
    let workdir: PathBuf = tokio::task::spawn_blocking(move || {
        backend.repo_path(&repo_id_cloned)
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))??;
    let abs = crate::opener::safe_workdir_path(&workdir, &relative_path)?;

    let editor = std::env::var("VISUAL")
        .ok()
        .or_else(|| std::env::var("EDITOR").ok());

    if let Some(editor) = editor {
        let mut parts = editor.split_whitespace();
        let prog = parts.next().unwrap_or("");
        let args: Vec<&str> = parts.collect();
        // DELIBERATELY not silenced on Windows: `EDITOR=vim` names a console
        // program, and hiding its console leaves an invisible editor holding the
        // file with no way to reach it. See
        // `proc::program_async_keeping_console` (issue 172).
        let status = crate::proc::program_async_keeping_console(prog)
            .args(&args)
            .arg(&abs)
            .status()
            .await
            .map_err(|e| AppError::Io(e.to_string()))?;
        if !status.success() {
            return Err(AppError::Internal(format!(
                "editor '{editor}' exited with {status}"
            )));
        }
        return Ok(());
    }

    // No shell interpreter, and the exit status is checked — see opener.rs for
    // the `cmd /C start` injection this replaces.
    crate::opener::open_with_default_app(abs.as_os_str()).await
}

/// The repo's working directory, resolved via `backend.repo_path` the same
/// way `open_in_editor` does above.
async fn repo_workdir(state: &State<'_, AppState>, repo_id: String) -> AppResult<PathBuf> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.repo_path(&repo_id))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

/// Reveal `relative_path` (relative to the repo's worktree) in the OS file
/// manager, with the entry selected where the platform allows it. `None` (or
/// an empty string — the repo tab's menu has no relative path to give)
/// reveals the repo's ROOT directory instead, which is a directory target
/// rather than a file one (see `reveal::reveal_plan`'s `is_dir`).
#[tauri::command]
pub async fn reveal_in_file_manager(
    state: State<'_, AppState>,
    repo_id: String,
    relative_path: Option<String>,
) -> AppResult<()> {
    let workdir = repo_workdir(&state, repo_id).await?;
    match relative_path {
        Some(rel) if !rel.is_empty() => {
            let abs = crate::opener::safe_workdir_path(&workdir, &rel)?;
            crate::reveal::reveal(&abs, false).await
        }
        _ => crate::reveal::reveal(&workdir, true).await,
    }
}

/// Open a terminal at `relative_path`'s CONTAINING directory (a file reveals
/// where it lives, not itself), or at the repo's root when `relative_path` is
/// `None`/empty — the repo tab's case.
#[tauri::command]
pub async fn open_in_terminal(
    state: State<'_, AppState>,
    repo_id: String,
    relative_path: Option<String>,
) -> AppResult<()> {
    let workdir = repo_workdir(&state, repo_id).await?;
    let dir = match relative_path {
        Some(rel) if !rel.is_empty() => {
            let abs = crate::opener::safe_workdir_path(&workdir, &rel)?;
            abs.parent().map(Path::to_path_buf).unwrap_or(workdir)
        }
        _ => workdir,
    };
    crate::reveal::open_terminal(&dir).await
}
