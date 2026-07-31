use std::ffi::OsStr;

use crate::{
    error::{AppError, AppResult},
    opener,
    update::{self, UpdateCapability, UpdateInfo},
};

/// Query GitHub for the latest release and compare to the running version.
/// Drives the update prompt only — never installs anything.
///
/// `update::discover` short-circuits dev/e2e builds (`0.0.0`) BEFORE the fetch,
/// so no network request leaves a `pnpm tauri dev` or e2e process.
#[tauri::command]
pub async fn check_for_update() -> AppResult<UpdateInfo> {
    let current = env!("CARGO_PKG_VERSION").to_string();
    tokio::task::spawn_blocking(move || update::discover(&current, update::fetch_latest_release))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

/// Whether this install can self-update or should notify + defer to a package
/// manager. Computed from the build's OS + the `APPIMAGE` env var.
#[tauri::command]
pub fn get_update_capability() -> AppResult<UpdateCapability> {
    Ok(update::capability(
        std::env::consts::OS,
        // `APPIMAGE=` (set but empty) is not an AppImage install.
        std::env::var("APPIMAGE").is_ok_and(|v| !v.is_empty()),
    ))
}

/// Open an https URL in the user's default browser (notify-path "View release").
/// Validation + the shell-free spawn both live in `opener`.
#[tauri::command]
pub async fn open_url(url: String) -> AppResult<()> {
    let safe = opener::safe_url(&url)?;
    opener::open_with_default_app(OsStr::new(&safe)).await
}
