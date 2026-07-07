use std::sync::Mutex;

use tauri::State;

use crate::{
    cli::{self, CliInstallOutcome, CliShimStatus, LaunchIntent},
    error::{AppError, AppResult},
};

/// First-launch CLI intent, stashed by `run()` before the webview exists.
/// Take-once: a webview reload must not replay it.
pub struct CliLaunchState(pub Mutex<Option<LaunchIntent>>);

#[tauri::command]
pub fn take_launch_intent(
    state: State<'_, CliLaunchState>,
) -> AppResult<Option<LaunchIntent>> {
    Ok(state
        .0
        .lock()
        .map_err(|e| AppError::Internal(e.to_string()))?
        .take())
}

#[tauri::command]
pub async fn cli_shim_status() -> AppResult<CliShimStatus> {
    tokio::task::spawn_blocking(cli::shim_status)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))
}

#[tauri::command]
pub async fn install_cli_shim() -> AppResult<CliInstallOutcome> {
    tokio::task::spawn_blocking(cli::install_shim)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))
}
