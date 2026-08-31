use std::ffi::OsStr;

use crate::{
    error::{AppError, AppResult},
    opener,
    update::{self, UpdateCapability, UpdateChannel, UpdateInfo},
};

/// Query GitHub for the newest release on `channel` and compare to the running
/// version. Drives the update prompt only — never installs anything.
///
/// `update::discover` short-circuits dev/e2e builds (`0.0.0`) BEFORE the fetch,
/// so no network request leaves a `pnpm tauri dev` or e2e process.
///
/// The channel is a PARAMETER rather than something the backend reads for
/// itself: the preference lives in the frontend's persisted settings, which is
/// also where the "should this check happen at all" gate lives
/// (`useUpdateStore.check`). Keeping both on the same side of the IPC boundary
/// means there is one place to read to know what any given check will do.
#[tauri::command]
pub async fn check_for_update(channel: Option<UpdateChannel>) -> AppResult<UpdateInfo> {
    let current = env!("CARGO_PKG_VERSION").to_string();
    // Absent means stable. The frontend always sends one; the default is here so
    // that a caller which does not — an older webview against a newer binary, or
    // a hand-issued invoke — gets the conservative channel rather than an error.
    let channel = channel.unwrap_or_default();
    tokio::task::spawn_blocking(move || {
        update::discover(&current, || update::fetch_for_channel(channel))
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
}

/// Whether this install can self-update or should notify + defer to a package
/// manager. Computed from the build's OS, the `APPIMAGE` env var, and — per
/// platform — whether a package manager owns this install: the apt repository
/// from #187 on Linux, Scoop or the Microsoft Store on Windows.
///
/// Every probe is cheap and synchronous — a `Path::exists` or a single API call,
/// never a process spawn — so there is nothing to route through `proc.rs`,
/// nothing to mock, and no reason for this command to stop being synchronous.
/// Each is skipped entirely off its own platform rather than relying on a path
/// simply not existing there.
///
/// The Scoop probe is two cheap checks that must BOTH hold: the exe sits in
/// Scoop's `apps/<name>/<version>` layout, and Scoop's own `manifest.json` is
/// beside it. The layout alone would also match a hand-made directory tree that
/// happened to be shaped like one, and the file alone says nothing about which
/// app it describes.
///
/// The MSIX probe is an API call rather than a filesystem check, because package
/// identity is a property of the PROCESS and not of a path — see
/// `update::is_msix_packaged` for why the tempting `WindowsApps` path test is
/// wrong. It is guarded by `os == "windows"` for the same reason the others are:
/// the answer is meaningless elsewhere.
#[tauri::command]
pub fn get_update_capability() -> AppResult<UpdateCapability> {
    let os = std::env::consts::OS;
    let apt_managed = os == "linux" && std::path::Path::new(update::APT_SOURCES_PATH).exists();
    let scoop_managed = os == "windows"
        && std::env::current_exe().is_ok_and(|exe| {
            update::is_scoop_layout(&exe)
                && exe
                    .parent()
                    .is_some_and(|dir| dir.join(update::SCOOP_MANIFEST_FILE).exists())
        });
    let msix_packaged = os == "windows" && update::is_msix_packaged();
    Ok(update::capability(update::InstallEnv {
        // `APPIMAGE=` (set but empty) is not an AppImage install.
        is_appimage: std::env::var("APPIMAGE").is_ok_and(|v| !v.is_empty()),
        apt_managed,
        scoop_managed,
        msix_packaged,
        ..update::InstallEnv::new(os)
    }))
}

/// Open an https URL in the user's default browser (notify-path "View release").
/// Validation + the shell-free spawn both live in `opener`.
#[tauri::command]
pub async fn open_url(url: String) -> AppResult<()> {
    let safe = opener::safe_url(&url)?;
    opener::open_with_default_app(OsStr::new(&safe)).await
}
