pub mod cli;
pub mod commands;
pub mod error;
pub mod git;
pub mod state;

use std::sync::{Arc, Mutex};

use crate::{git::libgit2::Libgit2Backend, state::AppState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let cwd = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("/"));
    let initial_intent = match cli::parse_args(&args, &cwd) {
        cli::Parsed::Help => {
            print!("{}", cli::USAGE);
            return;
        }
        cli::Parsed::Launch(intent) => intent.map(cli::resolve_repo_root),
    };

    let backend = Arc::new(Libgit2Backend::new());

    let mut builder = tauri::Builder::default();

    // Single-instance must be the first registered plugin. A later `pgit …`
    // invocation lands here in the ALREADY-RUNNING process: forward the
    // parsed intent to the webview and surface the window. Opt-out env var
    // for e2e runs and parallel dev instances, which must not
    // forward-and-exit into each other.
    if std::env::var("PLATYPUSGIT_NO_SINGLE_INSTANCE").is_err() {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            use tauri::{Emitter, Manager};
            let args: Vec<String> = argv.into_iter().skip(1).collect();
            if let cli::Parsed::Launch(Some(intent)) =
                cli::parse_args(&args, std::path::Path::new(&cwd))
            {
                let intent = cli::resolve_repo_root(intent);
                if let Err(e) = app.emit("cli-launch", &intent) {
                    log::error!("failed to emit cli-launch: {e}");
                }
            }
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }));
    }

    let builder = builder
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .level_for("platypusgit_lib", log::LevelFilter::Debug)
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("platypusgit".into()),
                    }),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Webview),
                ])
                .max_file_size(5_000_000)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepAll)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init());

    // WebDriver server for E2E tests. Debug builds only.
    #[cfg(debug_assertions)]
    let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());

    builder
        .setup(|_app| {
            log::info!(
                "platypusgit starting v{}",
                env!("CARGO_PKG_VERSION")
            );
            // macOS uses titleBarStyle: Overlay (set in tauri.conf.json) to keep native
            // traffic lights while letting our content extend under them. On Windows /
            // Linux we hide the OS frame entirely and render PGWindowControls ourselves.
            #[cfg(not(target_os = "macos"))]
            {
                use tauri::Manager;
                if let Some(win) = _app.get_webview_window("main") {
                    if let Err(e) = win.set_decorations(false) {
                        log::error!("failed to disable window decorations: {e}");
                    }
                }
            }
            Ok(())
        })
        .manage(AppState::new(backend))
        .manage(commands::cli::CliLaunchState(Mutex::new(initial_intent)))
        .invoke_handler(tauri::generate_handler![
            commands::repo::open_repo,
            commands::repo::get_status,
            commands::repo::list_all_files,
            commands::repo::read_file_content,
            commands::repo::list_files_at_rev,
            commands::repo::read_file_content_at_rev,
            commands::repo::append_gitignore,
            commands::repo::open_in_editor,
            commands::commits::get_log,
            commands::commits::get_log_filtered,
            commands::commits::commits_since,
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
            commands::diff::diff_commit,
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
            commands::conflict::save_resolution,
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
            commands::cli::take_launch_intent,
            commands::cli::cli_shim_status,
            commands::cli::install_cli_shim,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
