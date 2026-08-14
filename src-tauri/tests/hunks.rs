mod support;

use std::path::PathBuf;

use platypusgit_lib::error::AppError;
use platypusgit_lib::git::GitBackend;

use support::{fs::write_file, TempRepo};

// ─── fixture helpers ─────────────────────────────────────────────────────────

/// Build a 20-line file with exactly two separable modifications:
/// line 3 and line 17.  With context_lines=3 the two hunks never merge
/// (they are 14 lines apart).
fn body_original() -> String {
    let mut s = String::new();
    for i in 1..=20 {
        s.push_str(&format!("line {}\n", i));
    }
    s
}

fn body_modified() -> String {
    let mut s = String::new();
    for i in 1..=20 {
        if i == 3 {
            s.push_str("line 3 MODIFIED\n");
        } else if i == 17 {
            s.push_str("line 17 MODIFIED\n");
        } else {
            s.push_str(&format!("line {}\n", i));
        }
    }
    s
}

/// Create a repo with an initial commit of the 20-line file, then modify it
/// so the worktree has two separate hunks relative to the index.
fn repo_with_two_worktree_hunks() -> (TempRepo, platypusgit_lib::git::libgit2::Libgit2Backend, platypusgit_lib::git::types::RepoHandle) {
    let tr = TempRepo::fresh();

    // Write and commit the original file.
    write_file(tr.path(), "data.txt", &body_original());
    let mut index = tr.repo.index().unwrap();
    index.add_path(std::path::Path::new("data.txt")).unwrap();
    index.write().unwrap();
    let tree_oid = index.write_tree().unwrap();
    {
        let tree = tr.repo.find_tree(tree_oid).unwrap();
        let sig = git2::Signature::now("Test User", "test@example.com").unwrap();
        tr.repo
            .commit(Some("HEAD"), &sig, &sig, "initial", &tree, &[])
            .unwrap();
    }

    // Now write the modified version (two hunks in worktree vs index).
    write_file(tr.path(), "data.txt", &body_modified());

    let (backend, handle) = tr.open_with_backend();
    (tr, backend, handle)
}

// ─── tests ───────────────────────────────────────────────────────────────────

#[test]
fn worktree_diff_has_exactly_two_hunks_before_staging() {
    let (_tr, backend, handle) = repo_with_two_worktree_hunks();
    let diff = backend
        .diff(
            &handle.id,
            &std::path::Path::new("data.txt"),
            platypusgit_lib::git::types::DiffKind::WorktreeToIndex,
            3,
            false,
        )
        .expect("diff");
    assert_eq!(
        diff.hunks.len(),
        2,
        "should have exactly 2 hunks before any staging"
    );
}

#[test]
fn stage_hunk_0_stages_only_first_region() {
    let (_tr, backend, handle) = repo_with_two_worktree_hunks();

    backend
        .stage_hunk(&handle.id, &std::path::Path::new("data.txt"), 0, 3)
        .expect("stage_hunk 0");

    // After staging hunk 0 the IndexToHead diff should have 1 hunk (line 3 change).
    let index_diff = backend
        .diff(
            &handle.id,
            &std::path::Path::new("data.txt"),
            platypusgit_lib::git::types::DiffKind::IndexToHead,
            3,
            false,
        )
        .expect("index diff");
    assert_eq!(
        index_diff.hunks.len(),
        1,
        "index should have exactly 1 hunk staged (line 3)"
    );

    // The WorktreeToIndex diff should still have 1 hunk (line 17 change unstaged).
    let wt_diff = backend
        .diff(
            &handle.id,
            &std::path::Path::new("data.txt"),
            platypusgit_lib::git::types::DiffKind::WorktreeToIndex,
            3,
            false,
        )
        .expect("worktree diff");
    assert_eq!(
        wt_diff.hunks.len(),
        1,
        "worktree should have exactly 1 hunk remaining (line 17)"
    );

    // Sanity-check: the remaining worktree hunk should be about line 17.
    let remaining = &wt_diff.hunks[0];
    assert!(
        remaining.header.contains("17") || remaining.lines.iter().any(|l| l.content.contains("17")),
        "remaining hunk should mention line 17, got: {:?}",
        remaining.header
    );
}

#[test]
fn stage_hunk_1_stages_only_second_region() {
    let (_tr, backend, handle) = repo_with_two_worktree_hunks();

    backend
        .stage_hunk(&handle.id, &std::path::Path::new("data.txt"), 1, 3)
        .expect("stage_hunk 1");

    // IndexToHead diff: 1 hunk staged (line 17 change).
    let index_diff = backend
        .diff(
            &handle.id,
            &std::path::Path::new("data.txt"),
            platypusgit_lib::git::types::DiffKind::IndexToHead,
            3,
            false,
        )
        .expect("index diff");
    assert_eq!(index_diff.hunks.len(), 1, "index should have 1 hunk (line 17)");

    // WorktreeToIndex: 1 hunk remaining (line 3).
    let wt_diff = backend
        .diff(
            &handle.id,
            &std::path::Path::new("data.txt"),
            platypusgit_lib::git::types::DiffKind::WorktreeToIndex,
            3,
            false,
        )
        .expect("worktree diff");
    assert_eq!(wt_diff.hunks.len(), 1, "worktree should have 1 hunk remaining (line 3)");

    let remaining = &wt_diff.hunks[0];
    assert!(
        remaining.header.contains("3") || remaining.lines.iter().any(|l| l.content.contains("3 MODIFIED")),
        "remaining hunk should mention line 3, got: {:?}",
        remaining.header
    );
}

#[test]
fn unstage_hunk_0_removes_only_first_region_from_index() {
    let (_tr, backend, handle) = repo_with_two_worktree_hunks();

    // Stage everything first.
    backend
        .stage(&handle.id, &[PathBuf::from("data.txt")])
        .expect("stage all");

    // Both hunks should now be staged.
    let index_diff = backend
        .diff(
            &handle.id,
            &std::path::Path::new("data.txt"),
            platypusgit_lib::git::types::DiffKind::IndexToHead,
            3,
            false,
        )
        .expect("index diff before unstage");
    assert_eq!(
        index_diff.hunks.len(),
        2,
        "both hunks should be staged before unstaging"
    );

    // Unstage hunk 0 (line 3 change).
    backend
        .unstage_hunk(&handle.id, &std::path::Path::new("data.txt"), 0, 3)
        .expect("unstage_hunk 0");

    // Only 1 hunk should remain staged.
    let index_after = backend
        .diff(
            &handle.id,
            &std::path::Path::new("data.txt"),
            platypusgit_lib::git::types::DiffKind::IndexToHead,
            3,
            false,
        )
        .expect("index diff after unstage");
    assert_eq!(
        index_after.hunks.len(),
        1,
        "only 1 hunk should remain staged after unstaging hunk 0"
    );
}

#[test]
fn discard_hunk_0_reverts_only_first_region_in_worktree() {
    let (_tr, backend, handle) = repo_with_two_worktree_hunks();

    // Discard hunk 0 (line 3 change) from the worktree.
    backend
        .discard_hunk(&handle.id, &std::path::Path::new("data.txt"), 0, 3)
        .expect("discard_hunk 0");

    // WorktreeToIndex diff: only 1 hunk should remain (line 17).
    let wt_diff = backend
        .diff(
            &handle.id,
            &std::path::Path::new("data.txt"),
            platypusgit_lib::git::types::DiffKind::WorktreeToIndex,
            3,
            false,
        )
        .expect("worktree diff after discard");
    assert_eq!(
        wt_diff.hunks.len(),
        1,
        "worktree should have 1 hunk remaining after discarding hunk 0"
    );

    // The remaining hunk should be for line 17.
    let remaining = &wt_diff.hunks[0];
    assert!(
        remaining.header.contains("17") || remaining.lines.iter().any(|l| l.content.contains("17")),
        "remaining hunk should be the line-17 change, got header: {:?}",
        remaining.header
    );

    // Line 3 in the worktree should now be back to original.
    let content = support::fs::read_file(_tr.path(), "data.txt");
    assert!(
        content.contains("line 3\n"),
        "line 3 should be reverted to original, got: {}",
        &content
    );
    assert!(
        content.contains("line 17 MODIFIED"),
        "line 17 should still be modified, got: {}",
        &content
    );
}

#[test]
fn stage_hunk_out_of_range_returns_error() {
    let (_tr, backend, handle) = repo_with_two_worktree_hunks();

    let result = backend.stage_hunk(
        &handle.id,
        &std::path::Path::new("data.txt"),
        99,
        3,
    );
    assert!(result.is_err(), "out-of-range hunk index should return an error");
}

#[test]
fn worktree_diff_includes_untracked_file_content() {
    // Untracked files have no entry in the index, so libgit2's index→workdir diff
    // skips them by default. We pass include_untracked + show_untracked_content so
    // the commit panel can show the file body when an untracked file is selected.
    let tr = TempRepo::fresh();

    // Need at least one commit so HEAD resolves.
    write_file(tr.path(), "seed.txt", "seed\n");
    let mut index = tr.repo.index().unwrap();
    index.add_path(std::path::Path::new("seed.txt")).unwrap();
    index.write().unwrap();
    let tree_oid = index.write_tree().unwrap();
    {
        let tree = tr.repo.find_tree(tree_oid).unwrap();
        let sig = git2::Signature::now("Test User", "test@example.com").unwrap();
        tr.repo
            .commit(Some("HEAD"), &sig, &sig, "initial", &tree, &[])
            .unwrap();
    }

    // Drop a brand-new untracked file with three lines.
    write_file(tr.path(), "new.txt", "alpha\nbeta\ngamma\n");

    let (backend, handle) = tr.open_with_backend();
    let diff = backend
        .diff(
            &handle.id,
            &std::path::Path::new("new.txt"),
            platypusgit_lib::git::types::DiffKind::WorktreeToIndex,
            3,
            false,
        )
        .expect("diff");

    assert!(!diff.hunks.is_empty(), "untracked file diff should produce hunks");
    let added: Vec<&str> = diff
        .hunks
        .iter()
        .flat_map(|h| h.lines.iter())
        .filter(|l| matches!(l.kind, platypusgit_lib::git::types::DiffLineKind::Addition))
        .map(|l| l.content.as_str())
        .collect();
    assert_eq!(added, vec!["alpha", "beta", "gamma"]);
    assert_eq!(diff.additions, 3);
}

#[test]
fn context_lines_widens_hunks_and_merges_nearby_changes() {
    // The two edits (lines 3 and 17) are 13 unchanged lines apart. With the
    // default context of 3 they form two separate hunks; with a context of 10
    // the context regions overlap and libgit2 merges them into one hunk.
    let (_tr, backend, handle) = repo_with_two_worktree_hunks();

    let narrow = backend
        .diff(
            &handle.id,
            &std::path::Path::new("data.txt"),
            platypusgit_lib::git::types::DiffKind::WorktreeToIndex,
            3,
            false,
        )
        .expect("diff context=3");
    assert_eq!(narrow.hunks.len(), 2, "context=3 should keep 2 separate hunks");

    let wide = backend
        .diff(
            &handle.id,
            &std::path::Path::new("data.txt"),
            platypusgit_lib::git::types::DiffKind::WorktreeToIndex,
            10,
            false,
        )
        .expect("diff context=10");
    assert_eq!(wide.hunks.len(), 1, "context=10 should merge into 1 hunk");

    // Zero context: hunks shrink to just the changed lines.
    let zero = backend
        .diff(
            &handle.id,
            &std::path::Path::new("data.txt"),
            platypusgit_lib::git::types::DiffKind::WorktreeToIndex,
            0,
            false,
        )
        .expect("diff context=0");
    assert_eq!(zero.hunks.len(), 2, "context=0 keeps 2 hunks");
    let ctx_lines = zero
        .hunks
        .iter()
        .flat_map(|h| h.lines.iter())
        .filter(|l| matches!(l.kind, platypusgit_lib::git::types::DiffLineKind::Context))
        .count();
    assert_eq!(ctx_lines, 0, "context=0 should include no context lines");
}

#[test]
fn stage_hunk_with_wide_context_stages_merged_hunk() {
    // With context=10 the two edits form ONE hunk; staging index 0 with the
    // same context must stage both regions — proving the context width used
    // for display is the one used for application.
    let (_tr, backend, handle) = repo_with_two_worktree_hunks();

    backend
        .stage_hunk(&handle.id, &std::path::Path::new("data.txt"), 0, 10)
        .expect("stage_hunk 0 with context=10");

    let wt_diff = backend
        .diff(
            &handle.id,
            &std::path::Path::new("data.txt"),
            platypusgit_lib::git::types::DiffKind::WorktreeToIndex,
            10,
            false,
        )
        .expect("worktree diff after staging");
    assert_eq!(
        wt_diff.hunks.len(),
        0,
        "staging the merged hunk should leave nothing unstaged"
    );
}

// ─── line-level staging (#61 D7) ──────────────────────────────────────────────
//
// `selected` holds indices among the hunk's CHANGED (+/-) lines, counted in
// hunk order from 0 — NOT indices into DiffHunk::lines, which also carries
// header and context entries. These tests assert the resulting index and
// worktree CONTENTS rather than patch text: a malformed partial patch could
// otherwise look plausible while staging the wrong lines.

/// The staged (index) content of `path`, as a string.
fn staged_content(tr: &TempRepo, path: &str) -> String {
    let repo = git2::Repository::open(tr.path()).unwrap();
    let index = repo.index().unwrap();
    let entry = index
        .get_path(std::path::Path::new(path), 0)
        .expect("path is in the index");
    let blob = repo.find_blob(entry.id).unwrap();
    String::from_utf8(blob.content().to_vec()).unwrap()
}

/// Repo whose worktree adds three lines after a one-line base, so the single
/// hunk has three '+' changed lines at indices 0, 1, 2.
fn repo_with_three_additions() -> (TempRepo, platypusgit_lib::git::libgit2::Libgit2Backend, platypusgit_lib::git::types::RepoHandle) {
    let tr = TempRepo::with_initial_commit("base\n");
    write_file(tr.path(), "README.md", "base\nadd1\nadd2\nadd3\n");
    let (backend, handle) = tr.open_with_backend();
    (tr, backend, handle)
}

#[test]
fn stage_lines_stages_only_the_selected_addition() {
    let (tr, backend, handle) = repo_with_three_additions();

    backend
        .stage_lines(&handle.id, &PathBuf::from("README.md"), 0, &[1], 3)
        .expect("stage_lines");

    assert_eq!(
        staged_content(&tr, "README.md"),
        "base\nadd2\n",
        "only the selected line should be staged"
    );
    assert_eq!(
        std::fs::read_to_string(tr.path().join("README.md")).unwrap(),
        "base\nadd1\nadd2\nadd3\n",
        "worktree must be untouched by staging"
    );
}

#[test]
fn stage_lines_turns_unselected_removals_into_context() {
    // Base has three lines and the worktree deletes all three. Staging only
    // the first deletion must leave the other two lines in the index — that is
    // only true if unselected '-' lines became context rather than applying.
    let tr = TempRepo::with_initial_commit("one\ntwo\nthree\n");
    write_file(tr.path(), "README.md", "");
    let (backend, handle) = tr.open_with_backend();

    backend
        .stage_lines(&handle.id, &PathBuf::from("README.md"), 0, &[0], 3)
        .expect("stage_lines");

    assert_eq!(
        staged_content(&tr, "README.md"),
        "two\nthree\n",
        "unselected deletions must have become context, not been applied"
    );
}

#[test]
fn stage_lines_with_every_index_matches_staging_the_hunk() {
    let (tr, backend, handle) = repo_with_three_additions();

    backend
        .stage_lines(&handle.id, &PathBuf::from("README.md"), 0, &[0, 1, 2], 3)
        .expect("stage_lines");

    assert_eq!(
        staged_content(&tr, "README.md"),
        "base\nadd1\nadd2\nadd3\n",
        "selecting every changed line equals staging the whole hunk"
    );
}

#[test]
fn stage_lines_empty_selection_is_invalid_argument() {
    let (_tr, backend, handle) = repo_with_three_additions();

    let err = backend
        .stage_lines(&handle.id, &PathBuf::from("README.md"), 0, &[], 3)
        .expect_err("an empty selection must be rejected, not silently succeed");
    assert!(
        matches!(err, platypusgit_lib::error::AppError::InvalidArgument(_)),
        "expected InvalidArgument, got {err:?}"
    );
}

#[test]
fn stage_lines_out_of_range_index_is_invalid_argument() {
    let (_tr, backend, handle) = repo_with_three_additions();

    let err = backend
        .stage_lines(&handle.id, &PathBuf::from("README.md"), 0, &[99], 3)
        .expect_err("an out-of-range index must be rejected");
    assert!(
        matches!(err, platypusgit_lib::error::AppError::InvalidArgument(_)),
        "expected InvalidArgument, got {err:?}"
    );
}

#[test]
fn discard_lines_reverts_only_the_selected_line() {
    let (tr, backend, handle) = repo_with_three_additions();

    backend
        .discard_lines(&handle.id, &PathBuf::from("README.md"), 0, &[0], 3)
        .expect("discard_lines");

    assert_eq!(
        std::fs::read_to_string(tr.path().join("README.md")).unwrap(),
        "base\nadd2\nadd3\n",
        "only the selected added line should be discarded"
    );
}

#[test]
fn unstage_lines_removes_only_the_selected_line_from_the_index() {
    let (tr, backend, handle) = repo_with_three_additions();
    // Stage the whole hunk first, so there is something to unstage.
    backend
        .stage_hunk(&handle.id, &std::path::Path::new("README.md"), 0, 3)
        .expect("stage_hunk");
    assert_eq!(staged_content(&tr, "README.md"), "base\nadd1\nadd2\nadd3\n");

    backend
        .unstage_lines(&handle.id, &PathBuf::from("README.md"), 0, &[0], 3)
        .expect("unstage_lines");

    assert_eq!(
        staged_content(&tr, "README.md"),
        "base\nadd2\nadd3\n",
        "only the selected line should be unstaged"
    );
}

// ─── newly created (untracked) files ─────────────────────────────────────────
//
// `diff()` includes untracked content so the viewer can show a new file's
// contents, and the UI offers hunk/line staging on what it shows. The staging
// ops used to rebuild their diff WITHOUT the untracked options, so a new file had
// no delta at all and every one of them failed with InvalidPath.

/// Repo with one committed file plus a brand-new untracked file whose single
/// hunk has three '+' changed lines at indices 0, 1, 2.
fn repo_with_untracked_file() -> (TempRepo, platypusgit_lib::git::libgit2::Libgit2Backend, platypusgit_lib::git::types::RepoHandle) {
    let tr = TempRepo::with_initial_commit("base\n");
    write_file(tr.path(), "new.txt", "a\nb\nc\n");
    let (backend, handle) = tr.open_with_backend();
    (tr, backend, handle)
}

#[test]
fn stage_lines_stages_only_the_selected_lines_of_an_untracked_file() {
    let (tr, backend, handle) = repo_with_untracked_file();

    backend
        .stage_lines(&handle.id, &PathBuf::from("new.txt"), 0, &[0, 1], 3)
        .expect("stage_lines on an untracked file");

    assert_eq!(
        staged_content(&tr, "new.txt"),
        "a\nb\n",
        "only the selected lines should reach the index"
    );
    // The worktree keeps the whole file.
    assert_eq!(
        std::fs::read_to_string(tr.path().join("new.txt")).unwrap(),
        "a\nb\nc\n"
    );
}

#[test]
fn stage_hunk_stages_a_whole_untracked_file() {
    let (tr, backend, handle) = repo_with_untracked_file();

    backend
        .stage_hunk(&handle.id, &std::path::Path::new("new.txt"), 0, 3)
        .expect("stage_hunk on an untracked file");

    assert_eq!(staged_content(&tr, "new.txt"), "a\nb\nc\n");
}

#[test]
fn discard_lines_refuses_an_untracked_file_with_a_clear_error() {
    // Reversing a creation patch cannot express "drop some of the lines", so this
    // is refused rather than misapplied. Whole-file `discard` deletes an
    // untracked path, which is the operation that actually makes sense here.
    let (_tr, backend, handle) = repo_with_untracked_file();

    let err = backend
        .discard_lines(&handle.id, &PathBuf::from("new.txt"), 0, &[0], 3)
        .expect_err("partial discard of an untracked file is refused");

    assert!(
        matches!(err, AppError::InvalidArgument(ref m) if m.contains("not tracked yet")),
        "got {err:?}"
    );
}
