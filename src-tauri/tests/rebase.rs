mod support;

use platypusgit_lib::git::{
    types::{RebaseAction, RebaseStep},
    GitBackend,
};

use support::{linear_history, TempRepo};

// ─── helpers ─────────────────────────────────────────────────────────────────

fn step(oid: &str, action: RebaseAction) -> RebaseStep {
    RebaseStep { oid: oid.to_string(), action, message: None }
}

fn step_msg(oid: &str, action: RebaseAction, msg: &str) -> RebaseStep {
    RebaseStep { oid: oid.to_string(), action, message: Some(msg.to_string()) }
}

// ─── 1. drop ─────────────────────────────────────────────────────────────────

#[test]
fn rebase_drop_commit_removes_it() {
    let tr = TempRepo::with_initial_commit("root\n");
    let oids = linear_history(&tr, 3); // commits 0, 1, 2

    let (backend, handle) = tr.open_with_backend();

    let plan = vec![
        step(&oids[0], RebaseAction::Pick),
        step(&oids[1], RebaseAction::Drop),
        step(&oids[2], RebaseAction::Pick),
    ];

    let status = backend.rebase_start(&handle.id, plan).unwrap();
    assert!(!status.in_progress, "rebase should be complete");
    assert_eq!(status.total, 3);

    // The final log should have 3 commits: root + file0 + file2 (file1 dropped).
    let log = backend.log(&handle.id, None, 20).unwrap();
    // log is newest-first; index 0 is HEAD
    let messages: Vec<&str> = log.iter().map(|c| c.summary.as_str()).collect();
    assert!(messages.contains(&"commit 2"), "commit 2 should be present");
    assert!(!messages.contains(&"commit 1"), "commit 1 should be dropped");
    assert!(messages.contains(&"commit 0"), "commit 0 should be present");
}

// ─── 2. reword ───────────────────────────────────────────────────────────────

#[test]
fn rebase_reword_changes_message() {
    let tr = TempRepo::with_initial_commit("root\n");
    let oids = linear_history(&tr, 2); // commits 0, 1

    let (backend, handle) = tr.open_with_backend();

    let plan = vec![
        step(&oids[0], RebaseAction::Pick),
        step_msg(&oids[1], RebaseAction::Reword, "reworded message"),
    ];

    let status = backend.rebase_start(&handle.id, plan).unwrap();
    assert!(!status.in_progress);

    let log = backend.log(&handle.id, None, 10).unwrap();
    assert_eq!(log[0].summary, "reworded message");
}

// ─── 3. squash ───────────────────────────────────────────────────────────────

#[test]
fn rebase_squash_combines_two_commits() {
    let tr = TempRepo::with_initial_commit("root\n");
    let oids = linear_history(&tr, 3); // commits 0, 1, 2

    let (backend, handle) = tr.open_with_backend();

    // pick 0, pick 1, squash 2 into 1 → 2 commits after root
    let plan = vec![
        step(&oids[0], RebaseAction::Pick),
        step(&oids[1], RebaseAction::Pick),
        step_msg(&oids[2], RebaseAction::Squash, "combined message"),
    ];

    let status = backend.rebase_start(&handle.id, plan).unwrap();
    assert!(!status.in_progress);

    let log = backend.log(&handle.id, None, 10).unwrap();
    // root + commit 0 + squashed (1+2) = 3 total
    assert_eq!(log.len(), 3, "expected 3 commits (root + c0 + squash)");
    assert_eq!(log[0].summary, "combined message", "squash commit uses supplied message");
}

// ─── 4. fixup ────────────────────────────────────────────────────────────────

#[test]
fn rebase_fixup_discards_message() {
    let tr = TempRepo::with_initial_commit("root\n");
    let oids = linear_history(&tr, 2); // commits 0, 1

    let (backend, handle) = tr.open_with_backend();

    // pick 0, fixup 1 → 1 commit after root with commit 0's message
    let plan = vec![
        step(&oids[0], RebaseAction::Pick),
        step(&oids[1], RebaseAction::Fixup),
    ];

    let status = backend.rebase_start(&handle.id, plan).unwrap();
    assert!(!status.in_progress);

    let log = backend.log(&handle.id, None, 10).unwrap();
    // root + fixup-squash = 2 total
    assert_eq!(log.len(), 2);
    assert_eq!(log[0].summary, "commit 0", "fixup keeps the first commit's message");
}

// ─── 5. edit ─────────────────────────────────────────────────────────────────

#[test]
fn rebase_edit_pauses_and_continue_resumes() {
    let tr = TempRepo::with_initial_commit("root\n");
    let oids = linear_history(&tr, 2); // commits 0, 1

    let (backend, handle) = tr.open_with_backend();

    // pick 0 (edit), then pick 1
    let plan = vec![
        step(&oids[0], RebaseAction::Edit),
        step(&oids[1], RebaseAction::Pick),
    ];

    let status = backend.rebase_start(&handle.id, plan).unwrap();
    assert!(status.in_progress, "should be paused after edit");
    assert_eq!(status.pause_reason.as_deref(), Some("edit"));

    // Simulate user done amending — just continue.
    let status2 = backend.rebase_continue(&handle.id).unwrap();
    assert!(!status2.in_progress, "rebase should finish after continue");

    let log = backend.log(&handle.id, None, 10).unwrap();
    // root + c0 + c1
    assert_eq!(log.len(), 3);
}

// ─── 6. conflict pauses ──────────────────────────────────────────────────────

#[test]
fn rebase_conflict_pauses() {
    use support::fs::write_file;

    // Build: initial → branch_a → branch_b, where both modify the same file.
    let tr = TempRepo::with_initial_commit("line1\n");
    // branch_a modifies file.txt
    write_file(tr.path(), "conflict.txt", "version A\n");
    {
        let mut index = tr.repo.index().unwrap();
        index.add_path(std::path::Path::new("conflict.txt")).unwrap();
        index.write().unwrap();
        let tree_oid = index.write_tree().unwrap();
        let tree = tr.repo.find_tree(tree_oid).unwrap();
        let sig = git2::Signature::now("T", "t@t").unwrap();
        let parent = tr.repo.head().unwrap().peel_to_commit().unwrap();
        tr.repo.commit(Some("HEAD"), &sig, &sig, "commit A", &tree, &[&parent]).unwrap();
    }
    let oid_a = tr.repo.head().unwrap().peel_to_commit().unwrap().id().to_string();

    // Write a conflicting version (we'll rebase oid_a onto itself by resetting back
    // and then trying to apply a patch that touches the same line).
    // Simpler approach: create two commits that each write to the same file differently.
    write_file(tr.path(), "conflict.txt", "version B\n");
    {
        let mut index = tr.repo.index().unwrap();
        index.add_path(std::path::Path::new("conflict.txt")).unwrap();
        index.write().unwrap();
        let tree_oid = index.write_tree().unwrap();
        let tree = tr.repo.find_tree(tree_oid).unwrap();
        let sig = git2::Signature::now("T", "t@t").unwrap();
        let parent = tr.repo.head().unwrap().peel_to_commit().unwrap();
        tr.repo.commit(Some("HEAD"), &sig, &sig, "commit B", &tree, &[&parent]).unwrap();
    }
    let oid_b = tr.repo.head().unwrap().peel_to_commit().unwrap().id().to_string();


    let (backend, handle) = tr.open_with_backend();

    // Rebase: pick A, then pick B. They both modify the same file, but since
    // A is already on the tree and B is cherry-picked on top, B will apply cleanly
    // (it's a direct edit, not a conflict). We need a true conflict scenario.
    //
    // Better: reset to root, then pick B (which starts from A's parent, not from B's
    // actual parent). That means cherry-pick B onto root's state, which *does* conflict
    // because conflict.txt doesn't exist yet in root, so B applies cleanly.
    //
    // The simplest reliable conflict: pick B (against root) then pick A.
    // Both write conflict.txt with different content starting from root.
    // Actually both just write — cherry-pick won't conflict unless both modify the same
    // hunk differently from the base.
    //
    // Use a different approach: rebase B onto root (skip A), then pick A on top —
    // both write the same file from the same base, producing conflict.
    // This means rebase_start will reset to root, then pick B, then pick A.
    // pick B on root: conflict.txt doesn't exist → add, no conflict.
    // pick A on (root+B): B wrote "version B", A wrote "version A" starting from root
    //   (which had no conflict.txt). Cherry-pick A on top of B means the diff is
    //   "add conflict.txt with version A", but B already added conflict.txt with version B.
    //   That's a conflict!

    // Plan: pick B (so base is root), then pick A on top → conflict.
    let plan = vec![
        RebaseStep { oid: oid_b.clone(), action: RebaseAction::Pick, message: None },
        RebaseStep { oid: oid_a.clone(), action: RebaseAction::Pick, message: None },
    ];

    let status = backend.rebase_start(&handle.id, plan).unwrap();
    // First pick (B onto root) should succeed. Second pick (A onto root+B) should conflict.
    assert!(status.in_progress, "should be paused after conflict");
    assert_eq!(status.pause_reason.as_deref(), Some("conflict"));
}

// ─── 7. abort resets to pre-rebase HEAD ──────────────────────────────────────

#[test]
fn rebase_abort_resets_to_pre_rebase_head() {
    let tr = TempRepo::with_initial_commit("root\n");
    let oids = linear_history(&tr, 2);

    let (backend, handle) = tr.open_with_backend();

    // Record HEAD before the rebase.
    let head_before = backend.log(&handle.id, None, 1).unwrap()[0].oid.clone();

    // Start a rebase but immediately abort.
    let plan = vec![step(&oids[0], RebaseAction::Edit)];
    let status = backend.rebase_start(&handle.id, plan).unwrap();
    assert!(status.in_progress);

    backend.rebase_abort(&handle.id).unwrap();

    let status_after = backend.rebase_status(&handle.id).unwrap();
    assert!(!status_after.in_progress, "status should show no rebase in progress");

    // HEAD should be restored to the tip of the original history — not left
    // wherever the in-progress rebase happened to stop. `rebase_start` moves
    // the branch tip forward commit-by-commit as picks land, so "current
    // HEAD" at abort time is mid-rebase progress, not the pre-rebase
    // position; `rebase_abort` must restore the recorded pre-rebase tip
    // (mirrors `git rebase --abort` restoring ORIG_HEAD).
    let head_after = backend.log(&handle.id, None, 1).unwrap()[0].oid.clone();
    assert_eq!(head_after, head_before, "abort should restore the pre-rebase HEAD");
}

// ─── 8. generic abort_operation converges with rebase_abort ─────────────────
//
// `abort_operation` is the generic conflict-screen/palette abort — it's not
// rebase-specific and historically just hard-reset to current HEAD +
// cleanup_state(), without touching the `RebaseState` map. During a paused
// rebase, "current HEAD" is wherever the in-progress rebase happened to
// stop, not the pre-rebase tip, and the stale `RebaseState` entry left
// behind kept `rebase_status` reporting `in_progress`. Worse, a later
// `rebase_abort` would then use that stale entry's `orig_head` to hard-reset
// again — discarding any commits made since this abort.

#[test]
fn abort_operation_clears_rebase_state_and_restores_pre_rebase_head() {
    use support::fs::write_file;

    // Same "pick B onto root, then pick A" conflict setup as
    // `rebase_conflict_pauses` above.
    let tr = TempRepo::with_initial_commit("line1\n");
    write_file(tr.path(), "conflict.txt", "version A\n");
    {
        let mut index = tr.repo.index().unwrap();
        index.add_path(std::path::Path::new("conflict.txt")).unwrap();
        index.write().unwrap();
        let tree_oid = index.write_tree().unwrap();
        let tree = tr.repo.find_tree(tree_oid).unwrap();
        let sig = git2::Signature::now("T", "t@t").unwrap();
        let parent = tr.repo.head().unwrap().peel_to_commit().unwrap();
        tr.repo.commit(Some("HEAD"), &sig, &sig, "commit A", &tree, &[&parent]).unwrap();
    }
    let oid_a = tr.repo.head().unwrap().peel_to_commit().unwrap().id().to_string();

    write_file(tr.path(), "conflict.txt", "version B\n");
    {
        let mut index = tr.repo.index().unwrap();
        index.add_path(std::path::Path::new("conflict.txt")).unwrap();
        index.write().unwrap();
        let tree_oid = index.write_tree().unwrap();
        let tree = tr.repo.find_tree(tree_oid).unwrap();
        let sig = git2::Signature::now("T", "t@t").unwrap();
        let parent = tr.repo.head().unwrap().peel_to_commit().unwrap();
        tr.repo.commit(Some("HEAD"), &sig, &sig, "commit B", &tree, &[&parent]).unwrap();
    }
    let oid_b = tr.repo.head().unwrap().peel_to_commit().unwrap().id().to_string();

    let (backend, handle) = tr.open_with_backend();

    // Pre-rebase tip — current HEAD (commit B) before `rebase_start` moves it.
    let head_before = backend.log(&handle.id, None, 1).unwrap()[0].oid.clone();

    let plan = vec![
        RebaseStep { oid: oid_b.clone(), action: RebaseAction::Pick, message: None },
        RebaseStep { oid: oid_a.clone(), action: RebaseAction::Pick, message: None },
    ];
    let status = backend.rebase_start(&handle.id, plan).unwrap();
    assert!(status.in_progress, "should be paused after conflict");

    // The Conflict screen / palette abort path — NOT `rebase_abort`.
    backend.abort_operation(&handle.id).unwrap();

    let status_after = backend.rebase_status(&handle.id).unwrap();
    assert!(
        !status_after.in_progress,
        "abort_operation must remove the RebaseState entry, not just reset the worktree"
    );

    let head_after = backend.log(&handle.id, None, 1).unwrap()[0].oid.clone();
    assert_eq!(
        head_after, head_before,
        "abort_operation should restore the pre-rebase HEAD (converging with rebase_abort), \
         not wherever the in-progress rebase happened to stop"
    );
}

// ─── 9. sweeping RebaseState on successful completion ────────────────────────

#[test]
fn rebase_completion_clears_rebase_state() {
    let tr = TempRepo::with_initial_commit("root\n");
    let oids = linear_history(&tr, 3); // commits 0, 1, 2

    let (backend, handle) = tr.open_with_backend();

    // Pre-rebase tip — recorded by `rebase_start` as `orig_head`.
    let head_before = backend.log(&handle.id, None, 1).unwrap()[0].oid.clone();

    // Drop the middle commit so the post-rebase tip is structurally
    // different from the pre-rebase tip (a plan that reproduces the exact
    // same history can cherry-pick to byte-identical commits, which would
    // make this test pass by coincidence rather than by actually exercising
    // state removal).
    let plan = vec![
        step(&oids[0], RebaseAction::Pick),
        step(&oids[1], RebaseAction::Drop),
        step(&oids[2], RebaseAction::Pick),
    ];
    let status = backend.rebase_start(&handle.id, plan).unwrap();
    assert!(!status.in_progress, "no conflicts expected, rebase should finish");

    let status_after = backend.rebase_status(&handle.id).unwrap();
    assert!(!status_after.in_progress, "no rebase in progress after completion");

    let head_after_rebase = backend.log(&handle.id, None, 1).unwrap()[0].oid.clone();
    assert_ne!(head_after_rebase, head_before, "sanity: dropping a commit must move the tip");

    // Prove the in-memory RebaseState entry itself is gone, not just that
    // in_progress happens to read false because completed == total: calling
    // abort_operation on a finished rebase must be a no-op that leaves HEAD
    // alone, not a hard reset back to the pre-rebase tip using a stale
    // orig_head (which would silently discard the completed rebase).
    backend.abort_operation(&handle.id).unwrap();
    let head_after_abort = backend.log(&handle.id, None, 1).unwrap()[0].oid.clone();
    assert_eq!(
        head_after_abort, head_after_rebase,
        "abort_operation after a completed rebase must not discard it"
    );
}
