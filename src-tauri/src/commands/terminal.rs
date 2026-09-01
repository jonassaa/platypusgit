//! The built-in terminal's four handlers (#243).
//!
//! Thin, in the shape of `commands/watch.rs`: `crate::terminal::TerminalState`
//! owns every live pty and all of the lifetime management; this file resolves
//! the workdir, picks the shell, supplies the event sink, and logs the
//! lifecycle.
//!
//! The logging lives HERE and not in `terminal.rs` on purpose. This file sees
//! repository ids, sizes and exit codes; `terminal.rs` sees the bytes. A
//! terminal is where passwords get typed, so the module that handles traffic
//! logs nothing at all and `tests/terminal_privacy.rs` fails the build if that
//! stops being true.

use std::sync::Arc;

use tauri::{AppHandle, Emitter, State};

use crate::{
    error::{AppError, AppResult},
    git::types::RepoId,
    state::AppState,
    terminal::{TermEvent, TerminalState},
};

/// The event a `TermEvent::Data` is delivered on.
pub const TERM_DATA_EVENT: &str = "term://data";
/// The event a `TermEvent::Exit` is delivered on.
pub const TERM_EXIT_EVENT: &str = "term://exit";

/// Start a shell for `repo_id`, or adopt the one already running.
///
/// Returns the session's **epoch**. Every event carries one, and the frontend
/// drops the events whose epoch is not the one it opened — a reader still
/// mid-read when the user closed and reopened the terminal would otherwise
/// paint the dead shell's last line into the new one.
///
/// The workdir is resolved through the backend rather than taken from the
/// frontend: a path argument would be a second source of truth for where a
/// repository lives, and this one is about to become a shell's cwd.
#[tauri::command]
pub async fn term_open(
    app: AppHandle,
    state: State<'_, AppState>,
    terminals: State<'_, Arc<TerminalState>>,
    repo_id: String,
    rows: u16,
    cols: u16,
    shell: Option<String>,
) -> AppResult<u64> {
    let backend = state.backend.clone();
    let id = RepoId(repo_id.clone());
    let workdir = tokio::task::spawn_blocking(move || backend.repo_path(&id))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))??;

    // A blank setting means "use the default": the Settings field is a text
    // box, and an empty text box is not a shell named "".
    let shell = shell
        .filter(|s| !s.trim().is_empty())
        .map(std::ffi::OsString::from)
        .unwrap_or_else(crate::proc::default_shell);
    let shell_name = shell.to_string_lossy().to_string();

    let sink = {
        let app = app.clone();
        Arc::new(move |ev: TermEvent| {
            // The INNER struct goes on the wire, never the enum: serde tags an
            // enum externally, so emitting `ev` would wrap every payload in a
            // `data` / `exit` key the frontend does not look under, and every
            // event would be silently dropped by its repoId check. See the note
            // on `TermEvent`.
            // Nothing is logged in here: the payload is traffic.
            match ev {
                TermEvent::Data(p) => {
                    let _ = app.emit(TERM_DATA_EVENT, p);
                }
                TermEvent::Exit(p) => {
                    let _ = app.emit(TERM_EXIT_EVENT, p);
                }
            }
        })
    };

    let terminals = terminals.inner().clone();
    let epoch = terminals
        .open(sink, &repo_id, &shell, &workdir, rows, cols)
        .map_err(|e| AppError::TerminalUnavailable(format!("{shell_name}: {e}")))?;

    log::info!("terminal: session {epoch} open for {repo_id} ({shell_name})");
    Ok(epoch)
}

/// Send input to the shell.
///
/// The payload is what the user typed — a `sudo` password travels this way, so
/// it is never logged, and the guard test asserts as much.
#[tauri::command]
pub async fn term_write(
    terminals: State<'_, Arc<TerminalState>>,
    repo_id: String,
    data: String,
) -> AppResult<()> {
    terminals
        .write(&repo_id, data.as_bytes())
        .map_err(|e| AppError::Io(e.to_string()))
}

/// Tell the pty how big the renderer is, so the shell wraps where the user sees
/// the edge and a full-screen program (`vim`, `less`) fills the pane.
#[tauri::command]
pub async fn term_resize(
    terminals: State<'_, Arc<TerminalState>>,
    repo_id: String,
    rows: u16,
    cols: u16,
) -> AppResult<()> {
    terminals
        .resize(&repo_id, rows, cols)
        .map_err(|e| AppError::Io(e.to_string()))
}

/// Kill this repository's shell. Idempotent — the frontend calls it on tab
/// close without knowing whether a terminal was ever opened.
#[tauri::command]
pub async fn term_close(
    terminals: State<'_, Arc<TerminalState>>,
    repo_id: String,
) -> AppResult<()> {
    terminals.close(&repo_id);
    log::info!("terminal: session closed for {repo_id}");
    Ok(())
}
