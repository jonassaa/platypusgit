//! Bisect (#93) — driven entirely through `git bisect`, read entirely from GIT's
//! own on-disk state.
//!
//! libgit2 has no bisect API whatsoever, so every transition is a subprocess. The
//! important consequence is the **state of record**: `.git/BISECT_START`,
//! `.git/BISECT_LOG`, `.git/BISECT_TERMS` and `refs/bisect/*` are git's, and this
//! module only reads them. There is deliberately no `.git/platypusgit-bisect.json`.
//!
//! That is the exact inverse of `rebase_state.rs`, and for the same reason. The
//! rebase engine keeps its own file because the app *drives* that replay and git
//! cannot finish it; a half-compatible `rebase-merge/` dir would let `git rebase
//! --continue` claim a rebase it cannot drive. Here git drives everything, so a
//! second record could only ever *disagree* with git — and then the app and
//! `git bisect` would be describing different searches over the same repository.
//! Reading git's files also means an in-progress bisect survives an app restart
//! for free, and a bisect the user started in a terminal is picked up unchanged.

use std::path::Path;
use std::process::{Command, Stdio};

use git2::Repository;

use crate::error::{AppError, AppResult};
use crate::git::types::{BisectMark, BisectStatus};

/// True when git says a bisect is open.
///
/// One `Path::exists()`, which is what makes it safe to poll `bisect_status`
/// alongside `repo_state` on every refresh: a repository with no bisect pays a
/// single stat and never spawns anything. `repo.path()` is the per-worktree gitdir,
/// so a linked worktree's own bisect is read (and not the main worktree's).
pub fn in_progress(repo: &Repository) -> bool {
    repo.path().join("BISECT_LOG").exists()
}

/// The bisect's terms, as `(bad, good)`.
///
/// `.git/BISECT_TERMS` holds the bad/new term on line 1 and the good/old term on
/// line 2. Reading it rather than assuming "bad"/"good" is what makes a bisect the
/// user started with `--term-old`/`--term-new` in a terminal readable instead of
/// invisible — `refs/bisect/<term>` is named after it too.
pub fn terms(repo: &Repository) -> (String, String) {
    let default = ("bad".to_string(), "good".to_string());
    let Ok(text) = std::fs::read_to_string(repo.path().join("BISECT_TERMS")) else {
        return default;
    };
    let mut lines = text.lines().map(str::trim).filter(|l| !l.is_empty());
    match (lines.next(), lines.next()) {
        (Some(bad), Some(good)) => (bad.to_string(), good.to_string()),
        _ => default,
    }
}

/// Where `git bisect reset` will return to (`.git/BISECT_START` — a branch name,
/// or a detached oid).
pub fn start_ref(repo: &Repository) -> Option<String> {
    std::fs::read_to_string(repo.path().join("BISECT_START"))
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// The `bisect_*` variables `git rev-list --bisect-vars` prints.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct BisectVars {
    /// The revision git would test next — or, once the search converges, the
    /// first bad commit itself.
    pub rev: Option<String>,
    /// Revisions left to test after this one.
    pub nr: Option<usize>,
    /// git's own log2 estimate of remaining steps.
    pub steps: Option<usize>,
    /// Total candidates still in the range.
    pub all: Option<usize>,
}

/// Parse `--bisect-vars`' shell-assignment output.
///
/// ```text
/// bisect_rev='9ab70c4…'
/// bisect_nr=4
/// bisect_steps=2
/// ```
pub fn parse_bisect_vars(stdout: &str) -> BisectVars {
    let mut v = BisectVars::default();
    for line in stdout.lines() {
        let Some((key, raw)) = line.trim().split_once('=') else {
            continue;
        };
        let value = raw.trim().trim_matches('\'');
        match key {
            "bisect_rev" => v.rev = Some(value.to_string()).filter(|s| !s.is_empty()),
            // `bisect_good` can be -1 once the search converges, so every count
            // here parses as a signed number first and negatives are dropped
            // rather than wrapping to a huge usize.
            "bisect_nr" => v.nr = non_negative(value),
            "bisect_steps" => v.steps = non_negative(value),
            "bisect_all" => v.all = non_negative(value),
            _ => {}
        }
    }
    v
}

fn non_negative(value: &str) -> Option<usize> {
    value.parse::<i64>().ok().and_then(|n| usize::try_from(n).ok())
}

/// Every `refs/bisect/<prefix>*` ref name.
fn bisect_refs(repo: &Repository, prefix: &str) -> Vec<String> {
    let glob = format!("refs/bisect/{prefix}*");
    let Ok(refs) = repo.references_glob(&glob) else {
        return Vec::new();
    };
    refs.filter_map(|r| r.ok().and_then(|r| r.name().map(str::to_string)))
        .collect()
}

/// Read the whole bisect state. `BisectStatus::idle()` when there is none.
pub fn status(repo: &Repository) -> AppResult<BisectStatus> {
    if !in_progress(repo) {
        return Ok(BisectStatus::idle());
    }
    let (bad_term, good_term) = terms(repo);
    let bad_ref = format!("refs/bisect/{bad_term}");
    let bad_oid = repo
        .find_reference(&bad_ref)
        .ok()
        .and_then(|r| r.peel_to_commit().ok())
        .map(|c| c.id().to_string());

    let good_refs = bisect_refs(repo, &format!("{good_term}-"));
    let skip_refs = bisect_refs(repo, "skip-");

    let current_oid = repo
        .head()
        .ok()
        .and_then(|h| h.peel_to_commit().ok())
        .map(|c| c.id().to_string());

    // No bad ref yet — `git bisect start` with only a good rev is legal, and git
    // is then waiting for a bad one. There is nothing to count until it has one.
    let vars = match (&bad_oid, repo.workdir()) {
        (Some(_), Some(workdir)) => run_bisect_vars(workdir, &bad_ref, &good_refs),
        _ => BisectVars::default(),
    };

    // git's own convergence test (`bisect_next`): when the revision it would test
    // next IS the bad ref, there is nothing left below it — that commit is the
    // culprit. Note HEAD stays on the last *tested* commit, so the UI has to name
    // this one rather than let the user assume it is checked out.
    let first_bad_oid = match (&vars.rev, &bad_oid) {
        (Some(rev), Some(bad)) if rev == bad => Some(bad.clone()),
        _ => None,
    };

    Ok(BisectStatus {
        in_progress: true,
        start_ref: start_ref(repo),
        bad_term,
        good_term,
        current_oid,
        remaining: if first_bad_oid.is_some() { None } else { vars.nr },
        steps: if first_bad_oid.is_some() { None } else { vars.steps },
        first_bad_oid,
        good_count: good_refs.len(),
        bad_count: usize::from(bad_oid.is_some()),
        skipped_count: skip_refs.len(),
    })
}

/// `git rev-list --bisect-vars <bad> --not <good…>` — git's own arithmetic, so the
/// numbers match what `git bisect good` prints. Unlike scraping that output this is
/// recomputable at any time, which is what makes the progress survive a restart.
///
/// Skipped commits stay inside the counted range (git only excludes them from
/// selection, via `--bisect-all`), so `remaining` can be slightly pessimistic on a
/// bisect with skips — the same way git's own printed estimate is.
fn run_bisect_vars(workdir: &Path, bad_ref: &str, good_refs: &[String]) -> BisectVars {
    let mut args: Vec<String> = vec![
        "rev-list".into(),
        "--bisect-vars".into(),
        bad_ref.to_string(),
    ];
    if !good_refs.is_empty() {
        args.push("--not".into());
        args.extend(good_refs.iter().cloned());
    }
    let Ok(out) = Command::new("git")
        .arg("-C")
        .arg(workdir)
        .args(&args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null())
        .output()
    else {
        return BisectVars::default();
    };
    if !out.status.success() {
        return BisectVars::default();
    }
    parse_bisect_vars(&String::from_utf8_lossy(&out.stdout))
}

/// Resolve a revspec to a full oid before it reaches argv.
///
/// Two jobs: an unresolvable rev becomes `InvalidRef` instead of a git error, and
/// a caller-supplied string can never reach `git bisect` as something that starts
/// with `-` and is read as an option.
pub fn resolve(repo: &Repository, rev: &str) -> AppResult<String> {
    Ok(repo
        .revparse_single(rev)
        .map_err(|_| AppError::InvalidRef(rev.to_string()))?
        .peel_to_commit()
        .map_err(|_| AppError::InvalidRef(rev.to_string()))?
        .id()
        .to_string())
}

/// The subcommand word for a mark, using this bisect's own terms.
pub fn mark_word(mark: BisectMark, bad_term: &str, good_term: &str) -> String {
    match mark {
        BisectMark::Good => good_term.to_string(),
        BisectMark::Bad => bad_term.to_string(),
        // `skip` is not a term — it is the same word for every bisect.
        BisectMark::Skip => "skip".to_string(),
    }
}

/// Run `git bisect <args…>` in `workdir`.
///
/// stdout matters: a mark that converges prints *"<sha> is the first bad commit"*
/// there and exits 0, so callers re-read the state afterwards rather than trying to
/// infer anything from the exit code.
pub fn run(workdir: &Path, args: &[String]) -> AppResult<String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(workdir)
        .arg("bisect")
        .args(args)
        // No tty here, and `git bisect` can want a pager for the culprit's diff.
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_PAGER", "cat")
        .env("PAGER", "cat")
        .stdin(Stdio::null())
        .output()
        .map_err(|e| AppError::Io(e.to_string()))?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        let detail = if stderr.is_empty() {
            String::from_utf8_lossy(&out.stdout).trim().to_string()
        } else {
            stderr
        };
        return Err(AppError::Git(format!(
            "git bisect {}: {detail}",
            args.first().map(String::as_str).unwrap_or("")
        )));
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_vars_git_prints() {
        let out = "bisect_rev='9ab70c49e3fa'\n\
                   bisect_nr=4\n\
                   bisect_good=4\n\
                   bisect_bad=3\n\
                   bisect_all=9\n\
                   bisect_steps=2\n";
        let v = parse_bisect_vars(out);
        assert_eq!(v.rev.as_deref(), Some("9ab70c49e3fa"));
        assert_eq!(v.nr, Some(4));
        assert_eq!(v.steps, Some(2));
        assert_eq!(v.all, Some(9));
    }

    #[test]
    fn a_negative_count_is_dropped_not_wrapped() {
        // git prints bisect_good=-1 once the search converges.
        let v = parse_bisect_vars("bisect_nr=-1\nbisect_all=1\n");
        assert_eq!(v.nr, None);
        assert_eq!(v.all, Some(1));
    }

    #[test]
    fn mark_words_follow_the_repository_terms() {
        assert_eq!(mark_word(BisectMark::Good, "bad", "good"), "good");
        assert_eq!(mark_word(BisectMark::Bad, "new", "old"), "new");
        assert_eq!(mark_word(BisectMark::Good, "new", "old"), "old");
        // `skip` is never a term.
        assert_eq!(mark_word(BisectMark::Skip, "new", "old"), "skip");
    }
}
