//! Handing the app's own log to the person who needs to read it.
//!
//! The log has always been written; it was simply unreachable. Diagnosing a
//! report meant telling the reporter an undocumented per-platform path
//! (`~/Library/Logs/<id>/` on macOS, `$XDG_DATA_HOME/<id>/logs/` on Linux,
//! `%LOCALAPPDATA%\<id>\logs\` on Windows) and hoping they found it — which is
//! how #274 reached a state where the only available evidence was a log nobody
//! could place. These commands let Settings show the path, open it, and copy the
//! tail, so "send me your log" is one click rather than a support conversation.

use tauri::{AppHandle, Manager};

use crate::{
    diagnostics::{self, TAIL_CAP_BYTES},
    error::{AppError, AppResult},
};

/// The log file's name on disk.
///
/// `tauri_plugin_log` appends `.log` to the `file_name` configured in `lib.rs`,
/// so these two must be changed together — the plugin does not tell us what it
/// picked, and a wrong name here shows the user a path that does not exist.
const LOG_FILE: &str = "platypusgit.log";

/// How many lines the copy action returns.
///
/// Enough to cover several launches and the whole failing session, small enough
/// to paste into an issue without collapsing it.
const TAIL_LINES: usize = 500;

/// Where the log is and what the machine looks like, for the Settings panel.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsReport {
    /// Absolute path to the current log file, shown verbatim so a user on any
    /// platform can reach it without being told where to look.
    pub log_path: String,
    /// Whether that file exists yet. A fresh install that has not flushed has
    /// no file, and a panel that offers to open a nonexistent path is worse
    /// than one that says so.
    pub log_exists: bool,
    /// Size in bytes, `None` when the file is absent. Renders as a hint that
    /// the copy action returns a tail rather than the whole thing.
    pub log_size_bytes: Option<u64>,
    /// The same `host …` line that `environment_line` writes at startup, so the
    /// panel can show it without the user reading the file at all — and so it
    /// travels with a copied report even if the copy is only the tail.
    pub environment: String,
    /// The running version, so a pasted report identifies its build.
    pub version: String,
}

/// Resolve the log file's path, wherever this platform puts it.
fn log_path(app: &AppHandle) -> AppResult<std::path::PathBuf> {
    app.path()
        .app_log_dir()
        .map(|dir| dir.join(LOG_FILE))
        .map_err(|e| AppError::Io(format!("cannot resolve the log directory: {e}")))
}

/// The log's location plus the environment facts, for the Settings panel.
#[tauri::command]
pub async fn diagnostics_report(app: AppHandle) -> AppResult<DiagnosticsReport> {
    let path = log_path(&app)?;
    // `host_facts` may spawn git on the first call, so it does not belong on
    // the main thread.
    let environment = tokio::task::spawn_blocking(|| {
        diagnostics::environment_line(diagnostics::host_facts())
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;
    let meta = std::fs::metadata(&path).ok();
    Ok(DiagnosticsReport {
        log_path: path.to_string_lossy().into_owned(),
        log_exists: meta.is_some(),
        log_size_bytes: meta.as_ref().map(|m| m.len()),
        environment,
        version: env!("CARGO_PKG_VERSION").to_string(),
    })
}

/// The tail of the log, ready to paste into an issue.
///
/// Reads at most [`TAIL_CAP_BYTES`] from the END of the file rather than the
/// whole of it: the file rotates at 5 MB, and shipping five megabytes across IPC
/// to render a few hundred lines is waste with a latency cost on exactly the
/// machine most likely to be struggling already.
#[tauri::command]
pub async fn read_log_tail(app: AppHandle) -> AppResult<String> {
    use std::io::{Read, Seek, SeekFrom};

    let path = log_path(&app)?;
    tokio::task::spawn_blocking(move || {
        let mut file = std::fs::File::open(&path).map_err(|e| {
            AppError::Io(format!("cannot read the log at {}: {e}", path.display()))
        })?;
        let len = file
            .metadata()
            .map_err(|e| AppError::Io(format!("cannot size the log: {e}")))?
            .len();
        let truncated = len > TAIL_CAP_BYTES;
        if truncated {
            file.seek(SeekFrom::End(-(TAIL_CAP_BYTES as i64)))
                .map_err(|e| AppError::Io(format!("cannot seek the log: {e}")))?;
        }
        let mut buf = Vec::new();
        file.read_to_end(&mut buf)
            .map_err(|e| AppError::Io(format!("cannot read the log: {e}")))?;
        // Lossy on purpose: a log is not required to be valid UTF-8 (a hook's
        // output reaches it verbatim), and refusing to show a log because one
        // byte is malformed would defeat the only reason this command exists.
        let text = String::from_utf8_lossy(&buf);
        Ok(diagnostics::tail_lines(&text, TAIL_LINES, truncated))
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
}

/// Reveal the log file in the platform's file manager.
///
/// Reuses `crate::reveal`, which already knows the per-platform verbs and the
/// traps in them (`explorer.exe` exiting 1 on success, `xdg-open` exiting 3 with
/// no handler). `false` because the target is a FILE: the user gets its folder
/// with the log selected, which is what "show me this" means.
#[tauri::command]
pub async fn reveal_log_file(app: AppHandle) -> AppResult<()> {
    let path = log_path(&app)?;
    if !path.exists() {
        return Err(AppError::Io(format!(
            "no log file at {} yet",
            path.display()
        )));
    }
    crate::reveal::reveal(&path, false).await
}
