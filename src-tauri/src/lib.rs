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
        .plugin(tauri_plugin_os::init())
        .manage(AppState::new(backend))
        .invoke_handler(tauri::generate_handler![
            commands::repo::open_repo,
            commands::repo::get_status,
            commands::repo::list_all_files,
            commands::repo::read_file_content,
            commands::repo::append_gitignore,
            commands::repo::open_in_editor,
            commands::commits::get_log,
            commands::commits::commit,
            commands::commits::file_history,
            commands::diff::get_diff,
            commands::diff::stage_paths,
            commands::diff::unstage_paths,
            commands::diff::discard_paths,
            commands::diff::stage_hunk,
            commands::diff::unstage_hunk,
            commands::diff::discard_hunk,
            commands::diff::diff_commits,
            commands::diff::blame_file,
            commands::branches::list_branches,
            commands::branches::list_tags,
            commands::branches::list_stashes,
            commands::branches::list_remotes,
            commands::branches::checkout_branch,
            commands::branches::create_branch,
            commands::branches::delete_branch,
            commands::branches::rename_branch,
            commands::branches::fetch,
            commands::branches::fetch_all,
            commands::branches::pull,
            commands::branches::push,
            commands::branches::add_remote,
            commands::branches::remove_remote,
            commands::branches::rename_remote,
            commands::branches::set_remote_url,
            commands::branches::prune_remote,
            commands::branches::create_tag,
            commands::branches::delete_tag,
            commands::branches::merge_branch,
            commands::branches::rebase_onto,
            commands::branches::checkout_ref,
            commands::branches::push_tag,
            commands::branches::push_delete_branch,
            commands::history::reset,
            commands::history::cherry_pick,
            commands::history::revert,
            commands::stash::stash_save,
            commands::stash::stash_apply,
            commands::stash::stash_pop,
            commands::stash::stash_drop,
            commands::stash::stash_branch,
            commands::conflict::repo_state,
            commands::conflict::conflict_sides,
            commands::conflict::accept_ours,
            commands::conflict::accept_theirs,
            commands::conflict::mark_resolved,
            commands::conflict::abort_operation,
            commands::conflict::continue_operation,
            commands::conflict::run_mergetool,
            commands::conflict::restart_conflict,
            commands::rebase::rebase_start,
            commands::rebase::rebase_continue,
            commands::rebase::rebase_abort,
            commands::rebase::rebase_status,
            commands::reflog::get_reflog,
            commands::reflog::checkout_detached,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
