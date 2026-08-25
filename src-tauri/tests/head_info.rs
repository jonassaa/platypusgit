mod support;

use platypusgit_lib::git::GitBackend;
use support::TempRepo;

#[test]
fn on_a_branch_reports_the_branch_and_the_tip_oid() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    let info = backend.head_info(&handle.id).expect("head_info");
    assert_eq!(info.branch.as_deref(), Some("main"));
    let expected_oid = tr.repo.head().unwrap().target().unwrap().to_string();
    assert_eq!(info.head_oid.as_deref(), Some(expected_oid.as_str()));
}

#[test]
fn detached_head_reports_no_branch_but_the_oid() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let oid = tr.repo.head().unwrap().target().unwrap();
    tr.repo.set_head_detached(oid).unwrap();
    let (backend, handle) = tr.open_with_backend();
    let info = backend.head_info(&handle.id).expect("head_info");
    assert_eq!(info.branch, None);
    assert_eq!(info.head_oid.as_deref(), Some(oid.to_string().as_str()));
}

#[test]
fn unborn_branch_reports_neither_branch_nor_oid() {
    let tr = TempRepo::fresh();
    let (backend, handle) = tr.open_with_backend();
    let info = backend.head_info(&handle.id).expect("head_info");
    assert_eq!(info.branch, None);
    assert_eq!(info.head_oid, None);
}
