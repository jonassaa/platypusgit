mod support;

use std::path::PathBuf;

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
        .stage_hunk(&handle.id, &std::path::Path::new("data.txt"), 0)
        .expect("stage_hunk 0");

    // After staging hunk 0 the IndexToHead diff should have 1 hunk (line 3 change).
    let index_diff = backend
        .diff(
            &handle.id,
            &std::path::Path::new("data.txt"),
            platypusgit_lib::git::types::DiffKind::IndexToHead,
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
        .stage_hunk(&handle.id, &std::path::Path::new("data.txt"), 1)
        .expect("stage_hunk 1");

    // IndexToHead diff: 1 hunk staged (line 17 change).
    let index_diff = backend
        .diff(
            &handle.id,
            &std::path::Path::new("data.txt"),
            platypusgit_lib::git::types::DiffKind::IndexToHead,
        )
        .expect("index diff");
    assert_eq!(index_diff.hunks.len(), 1, "index should have 1 hunk (line 17)");

    // WorktreeToIndex: 1 hunk remaining (line 3).
    let wt_diff = backend
        .diff(
            &handle.id,
            &std::path::Path::new("data.txt"),
            platypusgit_lib::git::types::DiffKind::WorktreeToIndex,
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
        )
        .expect("index diff before unstage");
    assert_eq!(
        index_diff.hunks.len(),
        2,
        "both hunks should be staged before unstaging"
    );

    // Unstage hunk 0 (line 3 change).
    backend
        .unstage_hunk(&handle.id, &std::path::Path::new("data.txt"), 0)
        .expect("unstage_hunk 0");

    // Only 1 hunk should remain staged.
    let index_after = backend
        .diff(
            &handle.id,
            &std::path::Path::new("data.txt"),
            platypusgit_lib::git::types::DiffKind::IndexToHead,
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
        .discard_hunk(&handle.id, &std::path::Path::new("data.txt"), 0)
        .expect("discard_hunk 0");

    // WorktreeToIndex diff: only 1 hunk should remain (line 17).
    let wt_diff = backend
        .diff(
            &handle.id,
            &std::path::Path::new("data.txt"),
            platypusgit_lib::git::types::DiffKind::WorktreeToIndex,
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
