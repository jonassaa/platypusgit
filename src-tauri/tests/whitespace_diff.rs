//! `ignore_whitespace` on the diff read paths (#61 D2).
//!
//! The flag is a VIEWING option: it turns lines that differ only in whitespace
//! into context lines, so reviewing a reformatted file shows only the real
//! edits. That same rewriting is why hunk indices from such a diff must never
//! reach `stage_hunk`/`discard_hunk` — the last test here pins the divergence
//! that makes the UI disable hunk staging while the toggle is on.

mod support;

use std::path::Path;

use platypusgit_lib::git::types::DiffKind;
use platypusgit_lib::git::GitBackend;

use support::{fs::write_file, TempRepo};

const ORIGINAL: &str = "alpha\nbeta\ngamma\ndelta\nepsilon\nzeta\neta\ntheta\n";
/// `beta` gains trailing whitespace and `eta` gains leading indent — no real
/// change. `delta` is genuinely rewritten.
const REFORMATTED: &str = "alpha\nbeta   \ngamma\nDELTA\nepsilon\nzeta\n    eta\ntheta\n";

fn repo_with_reformatting() -> (
    TempRepo,
    platypusgit_lib::git::libgit2::Libgit2Backend,
    platypusgit_lib::git::types::RepoHandle,
) {
    let tr = TempRepo::fresh();
    write_file(tr.path(), "data.txt", ORIGINAL);
    tr.commit_all("initial");
    write_file(tr.path(), "data.txt", REFORMATTED);
    let (backend, handle) = tr.open_with_backend();
    (tr, backend, handle)
}

fn changed_lines(diff: &platypusgit_lib::git::types::FileDiff) -> Vec<String> {
    diff.hunks
        .iter()
        .flat_map(|h| h.lines.iter())
        .filter(|l| !matches!(l.kind, platypusgit_lib::git::types::DiffLineKind::Context))
        .map(|l| l.content.trim_end_matches('\n').to_string())
        .collect()
}

#[test]
fn whitespace_only_changes_disappear_when_ignored() {
    let (_tr, backend, handle) = repo_with_reformatting();

    let plain = backend
        .diff(
            &handle.id,
            Path::new("data.txt"),
            DiffKind::WorktreeToHead,
            3,
            false,
        )
        .expect("plain diff");
    let ignored = backend
        .diff(
            &handle.id,
            Path::new("data.txt"),
            DiffKind::WorktreeToHead,
            3,
            true,
        )
        .expect("whitespace-ignoring diff");

    // Plain: all three edits show. Ignoring: only the real one.
    let plain_lines = changed_lines(&plain);
    assert!(
        plain_lines.iter().any(|l| l.contains("beta")),
        "plain diff should show the whitespace-only beta change: {plain_lines:?}",
    );
    assert!(
        plain_lines.iter().any(|l| l.contains("eta")),
        "plain diff should show the re-indented eta line: {plain_lines:?}",
    );

    let ignored_lines = changed_lines(&ignored);
    assert!(
        ignored_lines.iter().any(|l| l.contains("DELTA")),
        "real edit must survive the whitespace filter: {ignored_lines:?}",
    );
    assert!(
        !ignored_lines.iter().any(|l| l.trim() == "beta"),
        "whitespace-only beta change should be gone: {ignored_lines:?}",
    );
    assert!(
        ignored.additions < plain.additions,
        "ignoring whitespace must reduce the counted additions ({} vs {})",
        ignored.additions,
        plain.additions,
    );
}

#[test]
fn flag_is_off_by_default_for_commit_diffs() {
    let tr = TempRepo::fresh();
    write_file(tr.path(), "data.txt", ORIGINAL);
    let first = tr.commit_all("initial");
    write_file(tr.path(), "data.txt", REFORMATTED);
    let second = tr.commit_all("reformat");
    let (backend, handle) = tr.open_with_backend();

    let plain = backend
        .diff_commits(
            &handle.id,
            &first.to_string(),
            &second.to_string(),
            3,
            false,
        )
        .expect("plain commit diff");
    let ignored = backend
        .diff_commits(
            &handle.id,
            &first.to_string(),
            &second.to_string(),
            3,
            true,
        )
        .expect("ignoring commit diff");

    assert!(
        ignored[0].additions < plain[0].additions,
        "diff_commits must honor the flag ({} vs {})",
        ignored[0].additions,
        plain[0].additions,
    );

    // diff_commit (against first parent) honors it too.
    let plain_one = backend
        .diff_commit(&handle.id, &second.to_string(), 3, false)
        .expect("plain diff_commit");
    let ignored_one = backend
        .diff_commit(&handle.id, &second.to_string(), 3, true)
        .expect("ignoring diff_commit");
    assert!(ignored_one[0].additions < plain_one[0].additions);
}

#[test]
fn hunk_indices_diverge_from_the_ignoring_view() {
    // This is WHY hunk staging is disabled while the toggle is on: the two
    // views do not agree on how many hunks the file has, so an index taken
    // from the ignoring view would apply a different hunk (or none).
    let (_tr, backend, handle) = repo_with_reformatting();

    let plain = backend
        .diff(
            &handle.id,
            Path::new("data.txt"),
            DiffKind::WorktreeToIndex,
            0,
            false,
        )
        .expect("plain diff");
    let ignored = backend
        .diff(
            &handle.id,
            Path::new("data.txt"),
            DiffKind::WorktreeToIndex,
            0,
            true,
        )
        .expect("ignoring diff");

    assert!(
        plain.hunks.len() > ignored.hunks.len(),
        "expected the ignoring view to collapse hunks ({} vs {})",
        plain.hunks.len(),
        ignored.hunks.len(),
    );
}
