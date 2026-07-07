mod support;

use std::path::PathBuf;

use platypusgit_lib::git::{types::RepoState, GitBackend};
use support::{fs::read_file, with_conflicting_merge};

#[test]
fn repo_state_reports_merge_during_merge() {
    let tr = with_conflicting_merge();
    let (backend, handle) = tr.open_with_backend();
    assert!(matches!(
        backend.repo_state(&handle.id).unwrap(),
        RepoState::Merge
    ));
}

#[test]
fn conflict_sides_returns_ours_base_theirs() {
    let tr = with_conflicting_merge();
    let (backend, handle) = tr.open_with_backend();
    let sides = backend
        .conflict_sides(&handle.id, &PathBuf::from("README.md"))
        .expect("conflict_sides");
    assert!(!sides.binary);
    assert_eq!(sides.base.as_deref(), Some("hello\n"));
    assert_eq!(sides.ours.as_deref(), Some("main branch content\n"));
    assert_eq!(sides.theirs.as_deref(), Some("feature branch content\n"));
}

#[test]
fn accept_ours_writes_stage_2_and_clears_conflict() {
    let tr = with_conflicting_merge();
    let (backend, handle) = tr.open_with_backend();
    backend
        .accept_ours(&handle.id, &PathBuf::from("README.md"))
        .expect("accept_ours");
    assert_eq!(read_file(tr.path(), "README.md"), "main branch content\n");
    let status = backend.status(&handle.id).unwrap();
    // If README.md is absent from status, the file is clean (not conflicted).
    // If it is present, its worktree flag must not be Conflicted.
    if let Some(entry) = status.iter().find(|f| f.path == "README.md") {
        assert!(!matches!(
            entry.worktree,
            platypusgit_lib::git::types::StatusFlag::Conflicted
        ));
    }
}

#[test]
fn accept_theirs_writes_stage_3() {
    let tr = with_conflicting_merge();
    let (backend, handle) = tr.open_with_backend();
    backend
        .accept_theirs(&handle.id, &PathBuf::from("README.md"))
        .expect("accept_theirs");
    assert_eq!(
        read_file(tr.path(), "README.md"),
        "feature branch content\n"
    );
}

#[test]
fn mark_resolved_clears_conflict_for_custom_resolution() {
    let tr = with_conflicting_merge();
    // User writes their own resolution.
    support::fs::write_file(tr.path(), "README.md", "reconciled content\n");
    let (backend, handle) = tr.open_with_backend();
    backend
        .mark_resolved(&handle.id, &[PathBuf::from("README.md")])
        .expect("mark_resolved");
    let status = backend.status(&handle.id).unwrap();
    // If README.md is absent from status, the file is clean (not conflicted).
    // If it is present, its worktree flag must not be Conflicted.
    if let Some(entry) = status.iter().find(|f| f.path == "README.md") {
        assert!(!matches!(
            entry.worktree,
            platypusgit_lib::git::types::StatusFlag::Conflicted
        ));
    }
}

#[test]
fn abort_operation_resets_state() {
    let tr = with_conflicting_merge();
    let (backend, handle) = tr.open_with_backend();
    backend.abort_operation(&handle.id).expect("abort");
    assert!(matches!(
        backend.repo_state(&handle.id).unwrap(),
        RepoState::Clean
    ));
    assert_eq!(read_file(tr.path(), "README.md"), "main branch content\n");
}

#[test]
fn continue_operation_refuses_when_conflicts_remain() {
    let tr = with_conflicting_merge();
    let (backend, handle) = tr.open_with_backend();
    let err = backend.continue_operation(&handle.id).unwrap_err();
    assert!(matches!(
        err,
        platypusgit_lib::error::AppError::ConflictsDetected(_)
    ));
}

#[test]
fn save_resolution_writes_content_and_clears_conflict() {
    let tr = with_conflicting_merge();
    let (backend, handle) = tr.open_with_backend();
    backend
        .save_resolution(
            &handle.id,
            &PathBuf::from("README.md"),
            "merged content\n",
        )
        .expect("save_resolution");
    assert_eq!(read_file(tr.path(), "README.md"), "merged content\n");
    // The conflict must be genuinely cleared, not merely absent from status:
    // no remaining Conflicted stage on either side for the path.
    let status = backend.status(&handle.id).unwrap();
    let still_conflicted = status.iter().any(|f| {
        f.path == "README.md"
            && (matches!(f.worktree, platypusgit_lib::git::types::StatusFlag::Conflicted)
                || matches!(f.index, platypusgit_lib::git::types::StatusFlag::Conflicted))
    });
    assert!(
        !still_conflicted,
        "README.md conflict not cleared after save_resolution"
    );
}

#[test]
fn save_resolution_rejects_absolute_and_parent_paths() {
    let tr = with_conflicting_merge();
    let (backend, handle) = tr.open_with_backend();

    // Absolute path — rejected before any write. Point it inside the repo's
    // own (unique) temp dir so we can assert the file was NOT created.
    let abs = tr.path().join("guarded.txt");
    assert!(abs.is_absolute());
    let err = backend
        .save_resolution(&handle.id, &abs, "pwned\n")
        .unwrap_err();
    assert!(matches!(
        err,
        platypusgit_lib::error::AppError::InvalidPath(_)
    ));
    assert!(!abs.exists(), "absolute path must be rejected before writing");

    // Parent-dir traversal (`..`) — rejected.
    let err = backend
        .save_resolution(&handle.id, &PathBuf::from("../escape.txt"), "pwned\n")
        .unwrap_err();
    assert!(matches!(
        err,
        platypusgit_lib::error::AppError::InvalidPath(_)
    ));
}

#[test]
fn save_resolution_then_continue_creates_merge_commit() {
    let tr = with_conflicting_merge();
    let (backend, handle) = tr.open_with_backend();
    backend
        .save_resolution(&handle.id, &PathBuf::from("README.md"), "reconciled\n")
        .unwrap();
    // Conflict truly cleared in the index — continue_operation no longer refuses.
    let oid = backend
        .continue_operation(&handle.id)
        .expect("continue after save_resolution");
    assert_eq!(oid.len(), 40);
}

#[test]
fn continue_operation_creates_two_parent_merge_commit() {
    let tr = with_conflicting_merge();
    let (backend, handle) = tr.open_with_backend();
    backend
        .accept_theirs(&handle.id, &PathBuf::from("README.md"))
        .unwrap();
    let oid = backend
        .continue_operation(&handle.id)
        .expect("continue_operation");
    assert_eq!(oid.len(), 40);

    // The new commit has two parents.
    let log = backend.log(&handle.id, None, 10).unwrap();
    assert_eq!(log[0].parents.len(), 2, "merge commit should have two parents");
    assert!(matches!(
        backend.repo_state(&handle.id).unwrap(),
        RepoState::Clean
    ));
}
