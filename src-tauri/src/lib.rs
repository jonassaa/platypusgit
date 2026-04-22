pub mod commands;
pub mod error;
pub mod git;
pub mod state;

use std::sync::Arc;

use crate::{git::libgit2::Libgit2Backend, state::AppState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let backend = Arc::new(Libgit2Backend::new());

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::new(backend))
        .invoke_handler(tauri::generate_handler![
            commands::repo::open_repo,
            commands::repo::get_status,
            commands::commits::get_log,
            commands::commits::commit,
            commands::diff::get_diff,
            commands::diff::stage_paths,
            commands::diff::unstage_paths,
            commands::diff::discard_paths,
            commands::branches::list_branches,
            commands::branches::list_tags,
            commands::branches::list_stashes,
            commands::branches::list_remotes,
            commands::branches::checkout_branch,
            commands::branches::create_branch,
            commands::branches::delete_branch,
            commands::branches::rename_branch,
            commands::branches::fetch,
            commands::branches::pull,
            commands::branches::push,
            commands::branches::create_tag,
            commands::branches::delete_tag,
            commands::history::reset,
            commands::history::cherry_pick,
            commands::history::revert,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
