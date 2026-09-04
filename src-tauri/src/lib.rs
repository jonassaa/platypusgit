pub mod cancel;
pub mod cli;
pub mod custom_action;
pub mod commands;
pub mod detach;
pub mod diagnostics;
pub mod error;
pub mod forge;
pub mod git;
pub mod opener;
pub mod proc;
pub mod progress;
pub mod reveal;
pub mod ssh;
pub mod state;
pub mod terminal;
pub mod update;
pub mod watcher;

use std::sync::{Arc, Mutex};

use crate::{git::libgit2::Libgit2Backend, state::AppState};

/// How long to wait for the frontend to show the main window before doing it
/// here instead. See the backstop in `setup` for what this is defending
/// against; `src/lib/revealWindow.tsx` is the code expected to win the race.
///
/// Unrelated to `reveal.rs`, which reveals FILES in the OS file manager.
const SHOW_WINDOW_FALLBACK_MS: u64 = 4000;

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

    let parsed = cli::parse_args(&args, &cwd);

    // Hand the terminal back on a `pgit …` launch (#163) — the ONE fork site.
    //
    // ⚠️ Gated on `Parsed::Launch` and nothing else, because git runs THIS
    // BINARY as its `GIT_ASKPASS` (see commands/net.rs::apply_auth_env) and
    // reads the credential from its stdout, synchronously. A process that
    // spawned a child and exited would hand git an empty credential, and every
    // authenticated fetch, pull and push would fail with nothing to trace it
    // back to. `Parsed::Help` and `Parsed::Version` must stay synchronous for
    // the same reason at a lower stake: their output printed by a detached
    // child goes to /dev/null.
    //
    // ⚠️ And this is why `GIT_ASKPASS` points at the BARE EXECUTABLE rather than
    // at the installed `pgit` shim, which on every Unix channel is a symlink to
    // this same binary: `pgit` now detaches. Pointing the askpass at it — an
    // otherwise reasonable-looking simplification — reintroduces exactly the
    // failure above. (The original reason is that `GIT_ASKPASS` is exec'd
    // directly and cannot carry arguments; both reasons must hold.)
    if detach::should_detach(&parsed, detach::LaunchEnv::current())
        && detach::detach(&cwd) == detach::Detached::Yes
    {
        return;
    }

    // `--debug` (#344). `should_detach` above named `Parsed::Launch` and nothing
    // else, so this variant already stayed in the foreground; what is left is to
    // raise the log filter and say what is happening.
    //
    // The notice is printed unconditionally for a debug launch, and names the
    // already-running case, because that case cannot be detected from here: the
    // single-instance plugin forwards this invocation's intent and exits inside
    // the builder below (`build()`, then `run()`), so a `pgit --debug` against a
    // running app would otherwise return an immediate, silent, log-free 0.
    // stderr, not stdout — stdout is where the log itself is about to go.
    let debug_launch = matches!(parsed, cli::Parsed::DebugLaunch(_));
    if debug_launch {
        eprintln!(
            "platypusgit: debug launch — log level raised to debug, streaming to this terminal."
        );
        eprintln!(
            "platypusgit: Ctrl+C quits the app. If no log lines follow, an instance was already \
             running and was focused instead — quit it and retry."
        );
    }

    let initial_intent = match parsed {
        cli::Parsed::Help => {
            print!("{}", cli::USAGE);
            return;
        }
        cli::Parsed::Version => {
            print!("{}", cli::version_line());
            return;
        }
        // Already handled above; unreachable in practice.
        cli::Parsed::Askpass(_) => return,
        cli::Parsed::Launch(intent) | cli::Parsed::DebugLaunch(intent) => {
            intent.map(cli::resolve_repo_root)
        }
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
            if let cli::Parsed::Launch(Some(intent)) | cli::Parsed::DebugLaunch(Some(intent)) =
                cli::parse_args(&args, std::path::Path::new(&cwd))
            {
                let intent = cli::resolve_repo_root(intent);
                if let Err(e) = app.emit("cli-launch", &intent) {
                    log::error!("failed to emit cli-launch: {e}");
                }
            }
            if let Some(win) = app.get_webview_window("main") {
                // `show()` first: the window is created hidden (see the setup
                // hook) and neither unminimize nor set_focus reveals a hidden
                // window. Without this, a `pgit …` landing in the sub-second gap
                // before the frontend's own reveal would focus a window that is
                // not on screen — the user's second launch would look like it
                // did nothing. A no-op once the window is up, which is the
                // normal case.
                let _ = win.show();
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }));
    }

    let builder = builder
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(cli::log_filter(debug_launch))
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
        .setup(|app| {
            log::info!(
                "platypusgit starting v{}",
                env!("CARGO_PKG_VERSION")
            );
            // Resolve the login-shell PATH off the main thread (issue 232). The
            // probe spawns a shell that runs the user's rc files, which is slow
            // enough to be visible at launch.
            //
            // This is the ONLY place that resolves it. `child_path()` is a
            // non-blocking cache read, so a spawn landing before this finishes
            // inherits our environment exactly as it did before the feature
            // existed — rather than waiting on someone's `.zshrc`. See
            // `proc::warm_child_path`.
            std::thread::spawn(|| {
                crate::proc::warm_child_path();
                match crate::proc::child_path() {
                    Some(p) => log::debug!("resolved child PATH ({} chars)", p.len()),
                    None => log::debug!("no login-shell PATH; children inherit ours"),
                }
                // Which machine wrote this log. Emitted here — on this thread,
                // AFTER the PATH probe — for two reasons: `read_host_facts`
                // spawns `git --version`, which has no business on the main
                // thread; and `git=` has to report the git the app will
                // actually spawn, which resolves against the child PATH. Read
                // before the probe, a user whose git lives only on the login
                // PATH would be told `git=UNAVAILABLE` by an app that then
                // proceeds to run git perfectly well.
                //
                // INFO, not DEBUG: the log file's filter is pinned at `Info`,
                // and a header nobody receives is the problem this line was
                // added to solve (#274).
                log::info!(
                    "{}",
                    crate::diagnostics::environment_line(crate::diagnostics::host_facts())
                );
            });
            // macOS uses titleBarStyle: Overlay (set in tauri.conf.json) to keep native
            // traffic lights while letting our content extend under them. On Windows /
            // Linux we hide the OS frame entirely and render PGWindowControls ourselves.
            //
            // Stripping the frame HERE, at runtime, rather than declaring
            // `"decorations": false` in the config, used to be visible: the window
            // was created decorated and shown immediately, so Windows users saw a
            // native title bar appear and then vanish. It is invisible now only
            // because the window is created hidden (`"visible": false`) and nothing
            // reveals it until the frontend says so — this runs long before that.
            // Do not make the window visible at creation again without moving this
            // into the config first; per-platform config files cannot do it cleanly,
            // because Tauri merges them with RFC 7396 semantics, which REPLACE the
            // `windows` array rather than merging into it.
            #[cfg(not(target_os = "macos"))]
            {
                use tauri::Manager;
                if let Some(win) = app.get_webview_window("main") {
                    if let Err(e) = win.set_decorations(false) {
                        log::error!("failed to disable window decorations: {e}");
                    }
                }
            }

            // Show-the-window backstop for the hidden window
            // (see src/lib/revealWindow.tsx).
            //
            // The frontend reveals the window on React's first commit, which is what
            // makes the app open already-drawn instead of flashing white. The failure
            // mode of that trade is severe and silent: if the bundle throws at module
            // scope, or fails to load at all, nothing ever calls `show()` and
            // platypusgit becomes a process with no window — no UI, no error, just a
            // dock icon. Showing it anyway after a timeout turns that into the far
            // better bug: a visible window that is empty or carries the error
            // boundary's screen.
            //
            // Firing this on a healthy-but-slow start is harmless — `show()` on an
            // already-visible window is a no-op, and the frontend's own reveal is
            // whichever comes first.
            {
                use tauri::Manager;
                if let Some(win) = app.get_webview_window("main") {
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_millis(
                            SHOW_WINDOW_FALLBACK_MS,
                        ));
                        // Err (rather than Ok(true)) counts as "not known to be
                        // visible" on purpose: the whole point is to err towards a
                        // window the user can see.
                        if !matches!(win.is_visible(), Ok(true)) {
                            log::warn!(
                                "frontend did not reveal the window within {SHOW_WINDOW_FALLBACK_MS}ms; showing it anyway"
                            );
                            if let Err(e) = win.show() {
                                log::error!("failed to reveal the window: {e}");
                            }
                        }
                    });
                }
            }
            Ok(())
        })
        .manage(AppState::new(backend))
        // Per-host forge API tokens, cached for this process only (#92). NOT the
        // git-transport credential path — see forge/token.rs for why the two
        // must never share storage.
        .manage(commands::forge::ForgeTokens::default())
        // One live filesystem watch, on the active repository (#239).
        .manage(watcher::WatchState::default())
        // Every live pty, keyed by repository (#243). Behind an `Arc` because
        // each session's reader thread holds one to retire itself on EOF.
        .manage(Arc::new(terminal::TerminalState::default()))
        .manage(commands::cli::CliLaunchState(Mutex::new(initial_intent)))
        .invoke_handler(tauri::generate_handler![
            commands::repo::open_repo,
            commands::repo::close_repo,
            commands::repo::trust_repo_path,
            commands::repo::get_status,
            commands::repo::head_info,
            commands::repo::list_all_files,
            commands::repo::read_file_content,
            commands::repo::list_files_at_rev,
            commands::repo::read_file_content_at_rev,
            commands::repo::read_file_content_at_index,
            commands::repo::read_image_preview,
            commands::repo::shallow_info,
            commands::repo::append_gitignore,
            commands::repo::delete_untracked_files,
            commands::repo::open_in_editor,
            commands::repo::reveal_in_file_manager,
            commands::repo::open_in_terminal,
            commands::diagnostics::diagnostics_report,
            commands::diagnostics::read_log_tail,
            commands::diagnostics::reveal_log_file,
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
            commands::commits::commit_notes,
            commands::commits::get_commit_template,
            commands::commits::get_identity,
            commands::commits::set_identity,
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
            commands::diff::open_in_difftool,
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
            commands::net::cancel_network_op,
            commands::branches::fetch,
            commands::branches::fetch_all,
            commands::branches::unshallow,
            commands::branches::pull,
            commands::branches::fast_forward_branch,
            commands::branches::fast_forward_all_branches,
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
            commands::stash::stash_save_paths,
            commands::stash::stash_rename,
            commands::stash::stash_diff,
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
            commands::rebase::stacked_refs,
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
            commands::ssh::ssh_key_status,
            commands::ssh::ssh_key_generate,
            commands::update::check_for_update,
            commands::update::get_update_capability,
            commands::custom_action::run_custom_action,
            commands::watch::watch_repo,
            commands::watch::watch_stop,
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
            commands::terminal::term_open,
            commands::terminal::term_write,
            commands::terminal::term_resize,
            commands::terminal::term_close,
        ])
        // Nothing the user started may outlive the window they started it from.
        //
        // Both arms below are cleanups the app must perform ITSELF, because the
        // way this process ends runs no destructors: `tao::EventLoop::run` is
        // `-> !` and finishes with `std::process::exit`, on every platform. A
        // `Drop` impl, a `kill_on_drop` child, an in-flight future — none of
        // them unwind.
        .on_window_event(|window, event| {
            // A shell must not outlive the window that hosts it (#243). Called
            // explicitly rather than left to a `Drop`: the state is behind an
            // `Arc` that every reader thread holds, so its drop runs at a time
            // nobody controls — and an orphaned interactive shell is not a leak
            // the user can see, only one their process list can.
            if matches!(event, tauri::WindowEvent::Destroyed) {
                use tauri::Manager as _;
                if let Some(terminals) =
                    window.app_handle().try_state::<Arc<terminal::TerminalState>>()
                {
                    terminals.close_all();
                }
            }
            // Neither may a network op (#263). `kill_on_drop(true)` is the
            // documented backstop for a DROPPED future, and quitting drops
            // nothing: measured, a `kill_on_drop` child was still alive 500 ms
            // after its parent's `process::exit(0)`. So a `git clone` escaped
            // the app and carried on populating the destination the Clone
            // dialog had already reported as never created.
            //
            // `CloseRequested`, not `Destroyed`: it fires while the process is
            // still alive and there is still something that can signal git.
            //
            // Gated on the label because this handler is app-global — the merge
            // resolver is a second window, and closing it must not stop a fetch
            // running behind it. `cancel_all` sends SIGTERM only, so git gets to
            // run its own lock-file and clone-junk cleanup on the way out; see
            // `cancel.rs`.
            if matches!(event, tauri::WindowEvent::CloseRequested { .. })
                && cancel::close_cancels_everything(window.label())
            {
                let signalled = cancel::cancel_all();
                if signalled > 0 {
                    log::info!("window closing — cancelled {signalled} network op(s) in flight");
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        // The OTHER ways out (#263). `CloseRequested` above is emitted from
        // tao's `windowShouldClose:` and nowhere else, so it covers the window's
        // own close button and NOT ⌘Q: on macOS `applicationWillTerminate` goes
        // straight to `LoopDestroyed`, which arrives here as `RunEvent::Exit`.
        // Without this, quitting with a keystroke still leaves a `git clone`
        // running against a destination the app has already forgotten.
        //
        // Being reached twice on the ordinary close path costs nothing:
        // `cancel_all` is always the polite SIGTERM, never the escalation, and a
        // registration that has already unwound is no longer in the registry.
        //
        // `Builder::run(context)` is documented as `build(context)?` followed by
        // `App::run(|_, _| {})`, so this is the same call with a callback.
        .run(|_app, event| {
            if matches!(
                event,
                tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }
            ) {
                let signalled = cancel::cancel_all();
                if signalled > 0 {
                    log::info!("app exiting — cancelled {signalled} network op(s) in flight");
                }
            }
        });
}
