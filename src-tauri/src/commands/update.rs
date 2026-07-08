use crate::{
    error::{AppError, AppResult},
    update::{self, UpdateCapability, UpdateInfo},
};

/// Query GitHub for the latest release and compare to the running version.
/// Drives the update prompt only — never installs anything.
#[tauri::command]
pub async fn check_for_update() -> AppResult<UpdateInfo> {
    let current = env!("CARGO_PKG_VERSION").to_string();
    let rel = tokio::task::spawn_blocking(update::fetch_latest_release)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))??;
    let available = update::compute_available(&current, &rel.version);
    Ok(UpdateInfo {
        available,
        current_version: current,
        latest_version: rel.version,
        notes: rel.notes,
        release_url: rel.url,
        published_at: rel.published_at,
    })
}

/// Whether this install can self-update or should notify + defer to a package
/// manager. Computed from the build's OS + the `APPIMAGE` env var.
#[tauri::command]
pub fn get_update_capability() -> AppResult<UpdateCapability> {
    Ok(update::capability(
        std::env::consts::OS,
        std::env::var("APPIMAGE").is_ok(),
    ))
}

/// Open an https URL in the user's default browser (notify-path "View release").
#[tauri::command]
pub async fn open_url(url: String) -> AppResult<()> {
    if !update::is_safe_url(&url) {
        return Err(AppError::InvalidPath(format!(
            "refusing to open non-https url: {url}"
        )));
    }
    #[cfg(target_os = "macos")]
    let (prog, pre): (&str, Vec<&str>) = ("open", vec![]);
    #[cfg(target_os = "linux")]
    let (prog, pre): (&str, Vec<&str>) = ("xdg-open", vec![]);
    #[cfg(target_os = "windows")]
    let (prog, pre): (&str, Vec<&str>) = ("cmd", vec!["/C", "start", ""]);

    tokio::process::Command::new(prog)
        .args(&pre)
        .arg(&url)
        .status()
        .await
        .map_err(|e| AppError::Io(e.to_string()))?;
    Ok(())
}
