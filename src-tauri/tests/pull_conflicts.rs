//! A conflicting pull is not a network failure (#212).
//!
//! `map_git_failure` has exactly two outcomes — `Auth` when
//! `classify_auth_failure` recognises the stderr, `Network` for everything
//! else — and `pull` goes through it. So the single most ordinary thing that
//! can happen to a pull, the remote and the local branch touching the same
//! lines, was reported in red as a **network** error. Everything the user
//! needs is already there (`refreshAll` has run, `OperationBar` offers
//! "Resolve conflicts"); only the label lied, and a label that lies about the
//! CATEGORY of a failure is worse than a vague one — it sends the user to
//! check their wifi.
//!
//! ## Why the classifier reads the index and not the stderr
//!
//! Measured against git 2.50, `git pull --no-rebase` writes ALL of its conflict
//! evidence to stdout:
//!
//! ```text
//! stdout: Auto-merging f.txt
//! stdout: CONFLICT (content): Merge conflict in f.txt
//! stdout: Automatic merge failed; fix conflicts and then commit the result.
//! stderr: From /tmp/origin
//! stderr:  * branch            main       -> FETCH_HEAD
//! ```
//!
//! and `run_git_authenticated_with_progress` sends stdout to `/dev/null` on
//! purpose — having exactly one pipe to drain by hand is what removes the
//! deadlock that `wait_with_output` was there to avoid. So the banner's text
//! was git's *fetch summary*, under the word "Network": the failure was not
//! merely mislabelled, it was undescribed. Grepping the stderr cannot fix that,
//! because the words are not in it.
//!
//! The index can. A conflicted entry is the ground truth for "this is a
//! conflict" — it is literally what the resolver operates on — and it is the
//! same answer for `--no-rebase` and for `--rebase`, whose stderr phrasings
//! have nothing in common.
//!
//! ## Why this cannot swallow a real network failure
//!
//! Two guards, and the first is git's own behaviour. `git pull` refuses BEFORE
//! it contacts the remote when the index has unmerged entries:
//!
//! ```text
//! $ git pull https://nonexistent.invalid/x.git main
//! error: Pulling is not possible because you have unmerged files.
//! fatal: Exiting because of an unresolved conflict.
//! ```
//!
//! (verified against git 2.50, exit 128, no network access attempted). So
//! "the pull failed AND the index has conflicts" cannot describe a fetch that
//! could not reach its remote — the fetch never ran.
//!
//! The second guard is in the function: only a `Network` verdict is
//! reconsidered. `Auth` keeps its identity or the credential prompt never
//! opens, and `Cancelled` keeps its identity or a user who pressed Cancel is
//! shown a failure they did not have.

mod support;

use platypusgit_lib::commands::net::map_conflicted_pull;
use platypusgit_lib::error::AppError;
use platypusgit_lib::git::auth::{AuthChallenge, AuthKind};
use platypusgit_lib::git::types::StatusFlag;
use platypusgit_lib::git::GitBackend;
use support::with_conflicting_merge;

/// The paths a real conflicted repository reports — not a hand-written list,
/// so the test breaks if `status` ever stops flagging a conflict.
fn conflicted_paths() -> Vec<String> {
    let tr = with_conflicting_merge();
    let (backend, handle) = tr.open_with_backend();
    let paths: Vec<String> = backend
        .status(&handle.id)
        .expect("status")
        .into_iter()
        .filter(|f| {
            matches!(f.worktree, StatusFlag::Conflicted)
                || matches!(f.index, StatusFlag::Conflicted)
        })
        .map(|f| f.path)
        .collect();
    assert_eq!(paths, vec!["README.md".to_string()], "fixture drifted");
    paths
}

/// The stderr a conflicting merge-pull actually leaves behind: the fetch
/// summary, and not one word about a conflict.
const FETCH_SUMMARY: &str =
    "From /tmp/origin\n * branch            main       -> FETCH_HEAD\n   23c3acd..b4fbbc1  main       -> origin/main";

#[test]
fn a_pull_that_left_conflicts_is_reported_as_conflicts() {
    let paths = conflicted_paths();
    let err = map_conflicted_pull(AppError::Network(FETCH_SUMMARY.into()), &paths);
    match err {
        AppError::ConflictsDetected(msg) => {
            // Names the file, because "there are conflicts" without a path is
            // one step short of useful in a repository of any size.
            assert!(msg.contains("README.md"), "{msg}");
        }
        other => panic!("expected ConflictsDetected, got {other:?}"),
    }
}

#[test]
fn the_conflict_message_never_carries_gits_fetch_summary() {
    // The old banner's entire text. It described the successful HALF of the
    // operation, which is why it read as nonsense next to the word "error".
    let paths = conflicted_paths();
    let err = map_conflicted_pull(AppError::Network(FETCH_SUMMARY.into()), &paths);
    let text = format!("{err}");
    assert!(!text.contains("FETCH_HEAD"), "{text}");
}

#[test]
fn a_clean_failure_stays_a_network_error() {
    // The genuine article: DNS did not resolve, nothing was merged, the index
    // is clean. Re-labelling this would be the mirror-image bug.
    let err = map_conflicted_pull(
        AppError::Network("fatal: unable to access 'https://x/y': Could not resolve host: x".into()),
        &[],
    );
    assert!(matches!(err, AppError::Network(_)), "got {err:?}");
}

#[test]
fn a_network_failure_mentioning_conflict_stays_a_network_error() {
    // The word means nothing here — only the index does. A remote is free to
    // print anything at all in a `remote:` banner.
    let err = map_conflicted_pull(
        AppError::Network("remote: merge conflict resolution service unavailable".into()),
        &[],
    );
    assert!(matches!(err, AppError::Network(_)), "got {err:?}");
}

#[test]
fn an_auth_failure_keeps_its_identity() {
    // `Auth` is what raises the credential prompt and re-runs the closure.
    // Re-labelling it would replace a retry with a dead end.
    let paths = conflicted_paths();
    let err = map_conflicted_pull(
        AppError::Auth(AuthChallenge {
            host: Some("github.com".into()),
            kind: AuthKind::Https,
        }),
        &paths,
    );
    assert!(matches!(err, AppError::Auth(_)), "got {err:?}");
}

#[test]
fn a_cancelled_pull_keeps_its_identity() {
    // `isCancelledError` suppresses the banner entirely — the outcome the user
    // asked for is not a failure to report.
    let paths = conflicted_paths();
    let err = map_conflicted_pull(AppError::Cancelled, &paths);
    assert!(matches!(err, AppError::Cancelled), "got {err:?}");
}

#[test]
fn many_conflicted_files_are_counted_rather_than_listed() {
    // A forty-path banner is a wall, and the resolver lists them all anyway.
    let many: Vec<String> = (0..40).map(|i| format!("src/f{i}.ts")).collect();
    let err = map_conflicted_pull(AppError::Network("whatever".into()), &many);
    match err {
        AppError::ConflictsDetected(msg) => {
            assert!(msg.contains("40"), "{msg}");
            assert!(!msg.contains("src/f39.ts"), "{msg}");
        }
        other => panic!("expected ConflictsDetected, got {other:?}"),
    }
}
