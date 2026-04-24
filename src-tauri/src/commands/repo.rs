use std::path::PathBuf;

use tauri::State;

use crate::{
    error::{AppError, AppResult},
    git::types::{FileContent, FileStatus, RepoHandle, RepoId},
    state::AppState,
};

#[tauri::command]
pub async fn open_repo(
    state: State<'_, AppState>,
    path: String,
) -> AppResult<RepoHandle> {
    let backend = state.backend.clone();
    let path_buf = PathBuf::from(path);
    tokio::task::spawn_blocking(move || backend.open(&path_buf))
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
) -> AppResult<FileContent> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let path_buf = PathBuf::from(path);
    tokio::task::spawn_blocking(move || backend.read_file_content(&repo_id, &path_buf))
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
    let abs = workdir.join(&relative_path);

    let editor = std::env::var("VISUAL")
        .ok()
        .or_else(|| std::env::var("EDITOR").ok());

    if let Some(editor) = editor {
        let mut parts = editor.split_whitespace();
        let prog = parts.next().unwrap_or("");
        let args: Vec<&str> = parts.collect();
        let status = tokio::process::Command::new(prog)
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

    #[cfg(target_os = "macos")]
    let (prog, args): (&str, Vec<&str>) = ("open", vec![]);
    #[cfg(target_os = "linux")]
    let (prog, args): (&str, Vec<&str>) = ("xdg-open", vec![]);
    #[cfg(target_os = "windows")]
    let (prog, args): (&str, Vec<&str>) = ("cmd", vec!["/C", "start", ""]);

    tokio::process::Command::new(prog)
        .args(&args)
        .arg(&abs)
        .status()
        .await
        .map_err(|e| AppError::Io(e.to_string()))?;
    Ok(())
}
