use std::path::PathBuf;

use tauri::State;

use crate::{
    error::{AppError, AppResult},
    git::types::{
        BlobSource, DeleteFailure, FileContent, FileStatus, HeadInfo, ImagePreview, RepoHandle,
        RepoId, ShallowInfo,
    },
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
        // `wsl_facts`, NOT `host_facts`: this is the repository-open path, and
        // the WSL question needs no `git --version`. e2e opens a repo about a
        // second after launch, while the login-shell PATH probe still holds the
        // startup thread — so a `host_facts` call here would lose that race and
        // pay for the spawn itself on every cold open.
        if let Some(warning) =
            crate::diagnostics::mount_warning(&path_buf, crate::diagnostics::wsl_facts())
        {
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

/// How much of this repository is actually here (#255).
///
/// Read on every `refreshAll` rather than remembered, because git owns the
/// answer: `.git/shallow` and the remotes' fetch refspecs. An `--unshallow` run
/// in a terminal, or in another window of this app, shows up on the next
/// refresh with nothing to invalidate.
#[tauri::command]
pub async fn shallow_info(
    state: State<'_, AppState>,
    repo_id: String,
) -> AppResult<ShallowInfo> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.shallow_info(&repo_id))
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

/// Bytes of an image at `path` on one side, for the preview surfaces (#224).
///
/// The fourth file reader, and the only one that can answer with BYTES — the
/// other three carry `FileContent.text`, which is `None` for a binary blob by
/// contract, so none of them can feed an `<img>`.
///
/// **Why base64 in the ordinary JSON payload.** Tauri's IPC serialises a
/// `Vec<u8>` as a JSON array of decimal numbers — roughly five bytes on the wire
/// per byte of image — so raw bytes were never the cheap option they look like.
/// The two alternatives were a raw `tauri::ipc::Response`, which cannot also
/// carry the sniffed media type and steps outside the `AppResult<T>` contract
/// every other command keeps, and a custom URI scheme, which would need a
/// protocol registration, a scope and a CSP the app deliberately does not have —
/// for bytes that are capped at a few MB anyway. Base64 costs ~1.33x, keeps the
/// one error type crossing IPC, and lands as the exact string a `data:` URL
/// wants, so the frontend concatenates it into an `src` with no decode.
///
/// The cap (`git::image::MAX_PREVIEW_BYTES`) is applied to the blob's DECLARED
/// size inside the backend, so an oversized asset is never read, never encoded
/// and never crosses IPC — it comes back as `TooLarge` instead. And nothing here
/// runs speculatively: the frontend asks only for the file the user selected.
#[tauri::command]
pub async fn read_image_preview(
    state: State<'_, AppState>,
    repo_id: String,
    source: BlobSource,
    path: String,
) -> AppResult<Option<ImagePreview>> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let path_buf = PathBuf::from(path);
    tokio::task::spawn_blocking(move || backend.read_image_preview(&repo_id, &source, &path_buf))
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

/// Delete untracked files from the working tree (#245).
///
/// Thin, like every handler here: every rule — untracked-only, inside the
/// worktree, no directories, no embedded repositories — is enforced by
/// `GitBackend::delete_untracked` under the per-repo lock, because each of them
/// is a question only the repository can answer and a check taken in a
/// different lock acquisition than the unlink is a TOCTOU.
///
/// Returns one entry per path the OS refused to remove; an empty vector means
/// the whole selection is gone. A refusal on validation grounds is an `Err` and
/// deletes NOTHING — see the trait doc for why the two are split.
#[tauri::command]
pub async fn delete_untracked_files(
    state: State<'_, AppState>,
    repo_id: String,
    paths: Vec<String>,
) -> AppResult<Vec<DeleteFailure>> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let paths: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    tokio::task::spawn_blocking(move || backend.delete_untracked(&repo_id, &paths))
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
/// reveals the repo's ROOT directory instead.
///
/// Which of `reveal_plan`'s two jobs this is — select a FILE in its parent, or
/// open a window ON a directory — is decided by `reveal::reveal_target` from
/// the filesystem, not by a parameter. That is what makes a directory row
/// reveal the folder rather than selecting it in its parent (#245).
///
/// Note there is deliberately no separate "open containing folder" command:
/// on all three platforms revealing a FILE already opens its containing folder
/// (`open -R`, `explorer /select,`, and xdg-open on the parent). See
/// `docs/dev/frontend.md`.
#[tauri::command]
pub async fn reveal_in_file_manager(
    state: State<'_, AppState>,
    repo_id: String,
    relative_path: Option<String>,
) -> AppResult<()> {
    let workdir = repo_workdir(&state, repo_id).await?;
    let (target, is_dir) = crate::reveal::reveal_target(&workdir, relative_path.as_deref())?;
    crate::reveal::reveal(&target, is_dir).await
}

/// Open a terminal at `relative_path`'s CONTAINING directory (a file reveals
/// where it lives, not itself) — or IN it when `relative_path` is itself a
/// directory, or at the repo's root when it is `None`/empty (the repo tab's
/// case). See `reveal::terminal_target`.
#[tauri::command]
pub async fn open_in_terminal(
    state: State<'_, AppState>,
    repo_id: String,
    relative_path: Option<String>,
) -> AppResult<()> {
    let workdir = repo_workdir(&state, repo_id).await?;
    let dir = crate::reveal::terminal_target(&workdir, relative_path.as_deref())?;
    crate::reveal::open_terminal(&dir).await
}
