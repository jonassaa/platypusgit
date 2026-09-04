//! Multiple windows (#256) — the two questions a webview cannot answer about
//! itself. The registry and the reasoning live in [`crate::windows`].

use tauri::Window;

use crate::{
    error::AppResult,
    windows::{self, WindowRegistry, WindowRepo},
};

/// Tell the backend which repositories this window's tab strip holds.
///
/// Called on every persist of the tab strip — the same moment the frontend
/// writes its own session — because both answers this feeds are only as fresh as
/// their last write: routing a `pgit <path>` to the window that has it open, and
/// evicting the right repositories when the window goes away.
///
/// The window argument is injected by Tauri; a label passed from the frontend
/// would let one window register another's holdings.
#[tauri::command]
pub fn register_window_repos(
    window: Window,
    registry: tauri::State<'_, WindowRegistry>,
    repos: Vec<WindowRepo>,
) -> AppResult<()> {
    registry.register(window.label(), repos);
    Ok(())
}

/// The label the next sibling window should use — the lowest free `pg-<n>`.
///
/// Handed out by the backend rather than computed in the webview because it has
/// to be free across ALL windows, and only the app knows which labels are live.
/// Racy by nature (two clicks in two windows in the same tick), and cheap to
/// make safe: `WebviewWindow` creation fails on a duplicate label, and the
/// caller asks again.
#[tauri::command]
pub fn next_window_label(app: tauri::AppHandle) -> AppResult<String> {
    Ok(windows::next_label(&windows::live_repo_windows(&app)))
}
