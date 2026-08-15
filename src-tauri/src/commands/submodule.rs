//! Submodule commands (#93).
//!
//! Three are thin wrappers over libgit2 work. `submodule_update` is the one that
//! can hit the network, so it follows the fetch/pull/push shape exactly: the first
//! attempt is prompt-less (the backend's own shell-out), and only a retry carries a
//! credential, which then goes through `net::run_git_authenticated` so the askpass
//! shim can answer. Both paths build their arguments with the SAME
//! `submodule::update_args`, so they cannot drift into updating different things.

use tauri::State;

use crate::{
    commands::net::Credentials,
    error::{AppError, AppResult},
    git::types::{RepoId, SubmoduleInfo},
    state::AppState,
};

#[tauri::command]
pub async fn list_submodules(
    state: State<'_, AppState>,
    repo_id: String,
) -> AppResult<Vec<SubmoduleInfo>> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.submodules(&repo_id))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn submodule_init(
    state: State<'_, AppState>,
    repo_id: String,
    path: Option<String>,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.submodule_init(&repo_id, path.as_deref()))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn submodule_sync(
    state: State<'_, AppState>,
    repo_id: String,
    path: Option<String>,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.submodule_sync(&repo_id, path.as_deref()))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn submodule_update(
    state: State<'_, AppState>,
    repo_id: String,
    path: Option<String>,
    recursive: bool,
    init: bool,
    // Optional so the common case behaves exactly like every other network op:
    // prompt-less first, credential only on the retry (#61 D5).
    credentials: Option<Credentials>,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let id = RepoId(repo_id);

    match credentials {
        None => {
            let id = id.clone();
            tokio::task::spawn_blocking(move || {
                backend.submodule_update(&id, path.as_deref(), recursive, init)
            })
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
        }
        Some(creds) => {
            let workdir = {
                let backend = state.backend.clone();
                let id = id.clone();
                tokio::task::spawn_blocking(move || backend.repo_path(&id))
                    .await
                    .map_err(|e| AppError::Internal(e.to_string()))??
            };
            let args = crate::git::submodule::update_args(path.as_deref(), recursive, init);
            let borrowed: Vec<&str> = args.iter().map(String::as_str).collect();
            crate::commands::net::run_git_authenticated(&workdir, &borrowed, Some(&creds)).await
        }
    }
}
