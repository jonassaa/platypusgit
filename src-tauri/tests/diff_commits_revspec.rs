mod support;

use platypusgit_lib::git::GitBackend;
use support::fs::write_file;
use support::TempRepo;

#[test]
fn diff_commits_accepts_head_revspec() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    write_file(tr.path(), "README.md", "hello\nworld\n");
    tr.commit_all("add world");

    let initial = backend
        .log(&handle.id, None, 10)
        .unwrap()
        .last()
        .unwrap()
        .oid
        .clone();

    // Should not error even though "HEAD" is not a 40-char hex OID.
    let diffs = backend
        .diff_commits(&handle.id, &initial, "HEAD", 3)
        .unwrap();
    assert!(!diffs.is_empty());
}
