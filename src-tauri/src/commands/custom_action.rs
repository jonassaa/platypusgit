//! Run a user-defined command (#225).
//!
//! Thin: everything that decides WHAT runs is in `custom_action.rs`, which is
//! pure and heavily tested, because that is where the security properties live.
//! This file only spawns what that module produced.

use std::process::Stdio;

use tauri::State;

use crate::{
    custom_action::{build_argv, truncate_output, ActionContext, ActionOutput},
    error::{AppError, AppResult},
    git::types::RepoId,
    state::AppState,
};

/// Run `command` with the placeholders in `context` substituted.
///
/// The working directory is the repository's, resolved through the backend
/// rather than taken from the frontend — a path argument would be a second
/// source of truth for where a repository lives, and this one is about to
/// become a child process's cwd.
///
/// **Nothing from the auth path goes near this.** A custom action is a user
/// program, not a trusted one: no forge token, no git credential, no askpass.
/// It gets the ordinary child environment `proc.rs` builds and nothing else.
#[tauri::command]
pub async fn run_custom_action(
    state: State<'_, AppState>,
    repo_id: String,
    command: String,
    context: ActionContext,
) -> AppResult<ActionOutput> {
    let backend = state.backend.clone();
    let id = RepoId(repo_id);
    let workdir = tokio::task::spawn_blocking(move || backend.repo_path(&id))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))??;

    // The repo path the child actually gets, so `$REPO` and the cwd cannot
    // disagree — the frontend never supplies it.
    let ctx = ActionContext {
        repo: workdir.to_string_lossy().to_string(),
        ..context
    };
    let argv = build_argv(&command, &ctx)?;
    let (program, args) = argv.split_first().expect("build_argv rejects empty argv");

    // `proc::program_async` is the ONLY sanctioned constructor (a guard test
    // fails the build on a bare `Command::new`), and it carries the
    // CREATE_NO_WINDOW treatment from #172 so this never flashes a console.
    let mut cmd = crate::proc::program_async(program);
    cmd.args(args)
        .current_dir(&workdir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let out = cmd.output().await.map_err(|e| {
        // The overwhelmingly common failure, and the one worth naming: the
        // program is not on PATH. The raw io::Error says "No such file or
        // directory" without saying which file.
        AppError::Io(format!("could not run `{program}`: {e}"))
    })?;

    Ok(ActionOutput {
        code: out.status.code(),
        stdout: truncate_output(String::from_utf8_lossy(&out.stdout).to_string()),
        stderr: truncate_output(String::from_utf8_lossy(&out.stderr).to_string()),
        argv: argv.clone(),
    })
}
