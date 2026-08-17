pub mod cli;
pub mod commands;
pub mod error;
pub mod forge;
pub mod git;
pub mod opener;
pub mod state;
pub mod update;

use std::sync::{Arc, Mutex};

use crate::{git::libgit2::Libgit2Backend, state::AppState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let cwd = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("/"));
    // Askpass shim (#61 D5). Handled FIRST — before the single-instance plugin
    // and the Tauri builder — so it stays a fast plain process and never
    // forwards itself into a running app instance.
    //
    // Two ways in: the ASKPASS_MODE_ENV flag (what git actually uses, because
    // GIT_ASKPASS is exec'd directly and cannot carry arguments) and an explicit
    // `--askpass` argument. Both end here.
    //
    // stdout is read by git AS THE CREDENTIAL, so nothing else may be printed:
    // no logging, no diagnostics. An unrecognized prompt or a missing value
    // exits non-zero with no output rather than printing an empty string, which
    // git would treat as a real credential.
    let askpass_prompt = if std::env::var_os(cli::ASKPASS_MODE_ENV).is_some() {
        Some(args.first().cloned().unwrap_or_default())
    } else {
        match cli::parse_args(&args, &cwd) {
            cli::Parsed::Askpass(prompt) => Some(prompt),
            _ => None,
        }
    };
    if let Some(prompt) = askpass_prompt {
        let username = std::env::var(cli::ASKPASS_USERNAME_ENV).ok();
        let secret = std::env::var(cli::ASKPASS_SECRET_ENV).ok();
        match cli::askpass_answer(&prompt, username.as_deref(), secret.as_deref()) {
            Some(value) => {
                println!("{value}");
                return;
            }
            None => std::process::exit(1),
        }
    }

    let initial_intent = match cli::parse_args(&args, &cwd) {
        cli::Parsed::Help => {
            print!("{}", cli::USAGE);
            return;
        }
        // Already handled above; unreachable in practice.
        cli::Parsed::Askpass(_) => return,
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
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    // WebDriver server for E2E tests. Compiled + wired ONLY under the `e2e`
    // cargo feature (test:e2e:build) — never linked into dev/production
    // binaries, since it opens a WebDriver server (port 4445) with full IPC.
    #[cfg(feature = "e2e")]
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
        // Per-host forge API tokens, cached for this process only (#92). NOT the
        // git-transport credential path — see forge/token.rs for why the two
        // must never share storage.
        .manage(commands::forge::ForgeTokens::default())
        .manage(commands::cli::CliLaunchState(Mutex::new(initial_intent)))
        .invoke_handler(tauri::generate_handler![
            commands::repo::open_repo,
            commands::repo::close_repo,
            commands::repo::trust_repo_path,
            commands::repo::get_status,
            commands::repo::list_all_files,
            commands::repo::read_file_content,
            commands::repo::list_files_at_rev,
            commands::repo::read_file_content_at_rev,
            commands::repo::read_file_content_at_index,
            commands::repo::append_gitignore,
            commands::repo::open_in_editor,
            commands::commits::get_log,
            commands::commits::get_log_filtered,
            commands::commits::get_log_page,
            commands::commits::get_log_filtered_page,
            commands::commits::commits_since,
            commands::commits::commits_between,
            commands::commits::ahead_behind,
            commands::commits::commit,
            commands::commits::file_history,
            commands::commits::verify_commit,
            commands::create::init_repo,
            commands::create::default_init_branch,
            commands::create::clone_repo,
            commands::diff::get_diff,
            commands::diff::stage_paths,
            commands::diff::unstage_paths,
            commands::diff::discard_paths,
            commands::diff::stage_hunk,
            commands::diff::unstage_hunk,
            commands::diff::discard_hunk,
            commands::diff::stage_lines,
            commands::diff::unstage_lines,
            commands::diff::discard_lines,
            commands::diff::diff_commits,
            commands::diff::diff_commit,
            commands::diff::diff_ref_to_workdir,
            commands::diff::blame_file,
            commands::branches::list_branches,
            commands::branches::list_tags,
            commands::branches::list_stashes,
            commands::branches::list_remotes,
            commands::branches::checkout_branch,
            commands::branches::create_branch,
            commands::branches::delete_branch,
            commands::branches::rename_branch,
            commands::branches::set_upstream,
            commands::net::remember_credential,
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
            commands::branches::verify_tag,
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
            commands::rebase::rebase_acknowledge,
            commands::reflog::get_reflog,
            commands::reflog::checkout_detached,
            commands::submodule::list_submodules,
            commands::submodule::submodule_init,
            commands::submodule::submodule_sync,
            commands::submodule::submodule_update,
            commands::worktree::list_worktrees,
            commands::worktree::worktree_add,
            commands::worktree::worktree_remove,
            commands::worktree::worktree_lock,
            commands::worktree::worktree_unlock,
            commands::worktree::worktree_prune,
            commands::lfs::lfs_status,
            commands::lfs::lfs_checkout,
            commands::lfs::lfs_fetch,
            commands::lfs::lfs_pull,
            commands::bisect::bisect_status,
            commands::bisect::bisect_start,
            commands::bisect::bisect_mark,
            commands::bisect::bisect_reset,
            commands::cli::take_launch_intent,
            commands::cli::cli_shim_status,
            commands::cli::install_cli_shim,
            commands::update::check_for_update,
            commands::update::get_update_capability,
            commands::update::open_url,
            commands::forge::forge_detect,
            commands::forge::forge_sign_in,
            commands::forge::forge_sign_out,
            commands::forge::forge_token_status,
            commands::forge::forge_validate_token,
            commands::forge::forge_list_pull_requests,
            commands::forge::forge_pull_request_checks,
            commands::forge::forge_create_pull_request,
            commands::forge::forge_checkout_pull_request,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
