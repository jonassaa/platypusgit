use std::path::PathBuf;

use tauri::State;

use crate::{
    error::{AppError, AppResult},
    git::types::{BlameResult, DiffKind, DiffToolTarget, FileDiff, RepoId, WorkdirDiff},
    state::AppState,
};

#[tauri::command]
pub async fn stage_hunk(
    state: State<'_, AppState>,
    repo_id: String,
    path: String,
    hunk_index: usize,
    context_lines: u32,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let path = PathBuf::from(path);
    tokio::task::spawn_blocking(move || {
        backend.stage_hunk(&repo_id, &path, hunk_index, context_lines)
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn unstage_hunk(
    state: State<'_, AppState>,
    repo_id: String,
    path: String,
    hunk_index: usize,
    context_lines: u32,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let path = PathBuf::from(path);
    tokio::task::spawn_blocking(move || {
        backend.unstage_hunk(&repo_id, &path, hunk_index, context_lines)
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn discard_hunk(
    state: State<'_, AppState>,
    repo_id: String,
    path: String,
    hunk_index: usize,
    context_lines: u32,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let path = PathBuf::from(path);
    tokio::task::spawn_blocking(move || {
        backend.discard_hunk(&repo_id, &path, hunk_index, context_lines)
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
}

// Line-level staging (#61 D7). `selected` holds indices among the hunk's
// CHANGED (+/-) lines, counted in hunk order from 0 — see GitBackend's docs.

#[tauri::command]
pub async fn stage_lines(
    state: State<'_, AppState>,
    repo_id: String,
    path: String,
    hunk_index: usize,
    selected: Vec<usize>,
    context_lines: u32,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let path = PathBuf::from(path);
    tokio::task::spawn_blocking(move || {
        backend.stage_lines(&repo_id, &path, hunk_index, &selected, context_lines)
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn unstage_lines(
    state: State<'_, AppState>,
    repo_id: String,
    path: String,
    hunk_index: usize,
    selected: Vec<usize>,
    context_lines: u32,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let path = PathBuf::from(path);
    tokio::task::spawn_blocking(move || {
        backend.unstage_lines(&repo_id, &path, hunk_index, &selected, context_lines)
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn discard_lines(
    state: State<'_, AppState>,
    repo_id: String,
    path: String,
    hunk_index: usize,
    selected: Vec<usize>,
    context_lines: u32,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let path = PathBuf::from(path);
    tokio::task::spawn_blocking(move || {
        backend.discard_lines(&repo_id, &path, hunk_index, &selected, context_lines)
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn get_diff(
    state: State<'_, AppState>,
    repo_id: String,
    path: String,
    kind: DiffKind,
    context_lines: u32,
    // Viewing option only — see the `diff` doc on GitBackend. Optional so an
    // older caller (or a test) that omits it keeps the exact git default.
    ignore_whitespace: Option<bool>,
) -> AppResult<FileDiff> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let path = PathBuf::from(path);
    let iw = ignore_whitespace.unwrap_or(false);
    tokio::task::spawn_blocking(move || backend.diff(&repo_id, &path, kind, context_lines, iw))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn stage_paths(
    state: State<'_, AppState>,
    repo_id: String,
    paths: Vec<String>,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let paths: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    tokio::task::spawn_blocking(move || backend.stage(&repo_id, &paths))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn unstage_paths(
    state: State<'_, AppState>,
    repo_id: String,
    paths: Vec<String>,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let paths: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    tokio::task::spawn_blocking(move || backend.unstage(&repo_id, &paths))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn discard_paths(
    state: State<'_, AppState>,
    repo_id: String,
    paths: Vec<String>,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let paths: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    tokio::task::spawn_blocking(move || backend.discard(&repo_id, &paths))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn diff_commits(
    state: State<'_, AppState>,
    repo_id: String,
    from_oid: String,
    to_oid: String,
    context_lines: u32,
    ignore_whitespace: Option<bool>,
) -> AppResult<Vec<FileDiff>> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let iw = ignore_whitespace.unwrap_or(false);
    tokio::task::spawn_blocking(move || {
        backend.diff_commits(&repo_id, &from_oid, &to_oid, context_lines, iw)
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn diff_commit(
    state: State<'_, AppState>,
    repo_id: String,
    oid: String,
    context_lines: u32,
    ignore_whitespace: Option<bool>,
) -> AppResult<Vec<FileDiff>> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let iw = ignore_whitespace.unwrap_or(false);
    tokio::task::spawn_blocking(move || backend.diff_commit(&repo_id, &oid, context_lines, iw))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

/// Diff the tree at `revspec` against the working tree (#131).
///
/// `include_untracked` is optional so an older caller keeps git's own semantics;
/// the compare screen passes `true` — see the `GitBackend` doc for why.
#[tauri::command]
pub async fn diff_ref_to_workdir(
    state: State<'_, AppState>,
    repo_id: String,
    revspec: String,
    context_lines: u32,
    ignore_whitespace: Option<bool>,
    include_untracked: Option<bool>,
) -> AppResult<WorkdirDiff> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let iw = ignore_whitespace.unwrap_or(false);
    let untracked = include_untracked.unwrap_or(false);
    tokio::task::spawn_blocking(move || {
        backend.diff_ref_to_workdir(&repo_id, &revspec, context_lines, iw, untracked)
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
}

/// Blame one file as of HEAD (#253).
///
/// `ignore_revs` defaults to TRUE — git's own behaviour when the repository
/// configures `blame.ignoreRevsFile`. The Blame screen passes `false` for the
/// un-ignored view behind its toggle.
#[tauri::command]
pub async fn blame_file(
    state: State<'_, AppState>,
    repo_id: String,
    path: String,
    ignore_revs: Option<bool>,
) -> AppResult<BlameResult> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    let path = PathBuf::from(path);
    let ignore_revs = ignore_revs.unwrap_or(true);
    tokio::task::spawn_blocking(move || backend.blame_file(&repo_id, &path, ignore_revs))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

/// Hand one file's diff to the user's own diff tool (#235).
///
/// Thin over `GitBackend::difftool_plan`, which decides the argv under one
/// repository lock; everything here is the spawn.
///
/// # Two deliberate departures from the other git shell-outs
///
/// **The console is kept.** `crate::proc::git_async_keeping_console` is used for
/// the same reason `run_mergetool` uses it: `git difftool` launches the tool the
/// USER configured, and a console difftool (`vimdiff`, `nvimdiff`) *is* a
/// terminal program. Silencing it on Windows would leave an invisible process
/// holding the file with `status().await` never returning and no cancel button
/// in the UI, while a GUI tool is unaffected either way — `CREATE_NO_WINDOW`
/// does not apply to a non-console application. `tests/spawn_no_window.rs`
/// allow-lists this call site by name so it cannot be "fixed" into consistency.
///
/// **stderr is piped.** The failure this command has to report well is "no diff
/// tool resolved", and git's own stderr says it better than we could — in the
/// user's locale, and without us pattern-matching English to decide. Without the
/// pipe the banner would read `git difftool exited with exit status: 1`, which
/// sends the reader nowhere. stdin and stdout stay inherited so a console tool
/// still owns the terminal.
///
/// The exit code is git difftool's own: `difftool.trustExitCode` is left at its
/// default (off), so closing Beyond Compare with a non-zero status is not a
/// failure, and only git failing to run a tool at all is.
#[tauri::command]
pub async fn open_in_difftool(
    state: State<'_, AppState>,
    repo_id: String,
    target: DiffToolTarget,
    paths: Vec<String>,
    tool: Option<String>,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo = RepoId(repo_id);
    let plan = tokio::task::spawn_blocking(move || {
        backend.difftool_plan(&repo, &target, &paths, tool.as_deref())
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))??;

    log::info!(
        "difftool: {} arg(s), tool={}",
        plan.args.len(),
        plan.tool.as_deref().unwrap_or("<git decides>")
    );

    let mut cmd = crate::proc::git_async_keeping_console(&plan.workdir);
    cmd.args(&plan.args);
    // The pathspec-shaped sibling of the `--` the argv builder already put in:
    // a file honestly named `:(exclude)x` must select itself rather than be read
    // as pathspec magic. Same reasoning, and the same one constant, as the other
    // shell-out in the app that passes a pathspec.
    let (key, value) = crate::git::stash::LITERAL_PATHSPECS;
    cmd.env(key, value);
    cmd.stderr(std::process::Stdio::piped());

    let out = cmd
        .spawn()
        .map_err(|e| AppError::Io(e.to_string()))?
        .wait_with_output()
        .await
        .map_err(|e| AppError::Io(e.to_string()))?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(AppError::Git(difftool_failure(&stderr, out.status)));
    }
    Ok(())
}

/// What a failed `git difftool` should say.
///
/// git's own words, tail-first and bounded, because the useful sentence
/// ("This message is displayed because 'diff.tool' is not configured") is the
/// LAST thing it prints, after a block of instructions. A silent failure falls
/// back to the exit status, which is at least a fact.
fn difftool_failure(stderr: &str, status: std::process::ExitStatus) -> String {
    const MAX_LINES: usize = 6;
    let lines: Vec<&str> = stderr
        .lines()
        .map(str::trim_end)
        .filter(|l| !l.is_empty())
        .collect();
    if lines.is_empty() {
        return format!("git difftool exited with {status}");
    }
    let tail = &lines[lines.len().saturating_sub(MAX_LINES)..];
    tail.join(" ")
}

#[cfg(test)]
mod tests {
    use super::difftool_failure;

    /// The exact failure the zero-config user hits, and the one line of it worth
    /// putting in a banner.
    #[test]
    fn the_tail_of_gits_own_complaint_is_what_reaches_the_banner() {
        let stderr = "\nThis message is displayed because 'diff.tool' is not configured.\n\
                      See 'git difftool --tool-help' or 'git help config' for more details.\n";
        let text = difftool_failure(stderr, exit_status());
        assert!(text.contains("'diff.tool' is not configured"), "{text}");
        assert!(!text.starts_with('\n'), "{text}");
    }

    #[test]
    fn a_silent_failure_still_says_something() {
        let text = difftool_failure("   \n\n", exit_status());
        assert!(text.starts_with("git difftool exited with"), "{text}");
    }

    #[test]
    fn a_long_complaint_is_bounded() {
        let stderr = (0..40)
            .map(|i| format!("line {i}"))
            .collect::<Vec<_>>()
            .join("\n");
        let text = difftool_failure(&stderr, exit_status());
        assert!(text.contains("line 39"), "the tail is the useful end: {text}");
        assert!(!text.contains("line 0"), "unbounded: {text}");
    }

    /// A real `ExitStatus` with no platform-specific constructor in reach: run
    /// the shortest possible failing child through the sanctioned spawner.
    fn exit_status() -> std::process::ExitStatus {
        crate::proc::program("git")
            .arg("--this-flag-does-not-exist")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .expect("git is on PATH for the test suite")
    }
}
