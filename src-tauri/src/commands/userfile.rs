//! Reading and writing one file the user picked in a native dialog (#435).
//!
//! Export used to be a browser trick: a `Blob`, an `<a download>` and a
//! synthetic click. WebKitGTK ignores the `download` attribute on a blob URL,
//! so on Linux "Export theme" did nothing — no file, no error, no log line. A
//! webview is not a browser, and nothing about `<a download>` is contracted to
//! work in one, so the fix is a real native path rather than a patch to the
//! click.
//!
//! **The trust model, stated plainly:** these take an absolute path the USER
//! chose in a native save or open dialog (`@tauri-apps/plugin-dialog`, behind
//! `src/lib/userFile.ts`). Nothing in the frontend may synthesise a path for
//! them. That is why `write_user_file` refuses to create parent directories:
//! a dialog's path always has a parent that exists, so a request to invent one
//! is a request that did not come from a dialog.
//!
//! No `tauri-plugin-fs`. Two thin commands match how every other backend
//! capability here is exposed, and the plugin's scope config would be a second,
//! parallel answer to "may the webview touch this path".

use crate::error::{AppError, AppResult};

/// The largest file `read_user_file` will hand to the webview.
///
/// A settings bundle with every custom theme is a few tens of kilobytes. The cap
/// exists because the path comes from a file picker and a mis-picked disk image
/// should be a refusal, not a webview that swallows a gigabyte of bytes.
pub const MAX_USER_FILE_BYTES: u64 = 4 * 1024 * 1024;

/// Write `contents` to `path`, creating or truncating it.
#[tauri::command]
pub async fn write_user_file(path: String, contents: String) -> AppResult<()> {
    if path.trim().is_empty() {
        return Err(AppError::InvalidPath("no file was chosen".into()));
    }
    // libgit2 is not involved here, but the reason for spawn_blocking is the
    // same: std::fs is sync, and blocking the async runtime's worker on a slow
    // network volume would stall every other command with it.
    tokio::task::spawn_blocking(move || {
        std::fs::write(&path, contents.as_bytes())
            .map_err(|e| AppError::Io(format!("cannot write {path}: {e}")))
    })
    .await
    .map_err(|e| AppError::Internal(format!("write task failed: {e}")))?
}

/// Read `path` as UTF-8 text, refusing anything that is not a file we can hand
/// to the webview whole.
#[tauri::command]
pub async fn read_user_file(path: String) -> AppResult<String> {
    if path.trim().is_empty() {
        return Err(AppError::InvalidPath("no file was chosen".into()));
    }
    tokio::task::spawn_blocking(move || {
        let meta = std::fs::metadata(&path)
            .map_err(|e| AppError::Io(format!("cannot read {path}: {e}")))?;
        if meta.is_dir() {
            return Err(AppError::InvalidPath(format!(
                "{path} is a folder, not a file"
            )));
        }
        if meta.len() > MAX_USER_FILE_BYTES {
            return Err(AppError::InvalidPath(format!(
                "{path} is too large to read ({} bytes; the limit is {MAX_USER_FILE_BYTES})",
                meta.len()
            )));
        }
        std::fs::read_to_string(&path)
            .map_err(|e| AppError::Io(format!("cannot read {path}: {e}")))
    })
    .await
    .map_err(|e| AppError::Internal(format!("read task failed: {e}")))?
}
