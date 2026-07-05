mod support;

use platypusgit_lib::git::GitBackend;
use support::fs::write_file;
use support::TempRepo;

#[test]
fn blame_attributes_each_line_to_the_commit_that_last_changed_it() {
    let tr = TempRepo::with_initial_commit("line-a\nline-b\n");
    let (backend, handle) = tr.open_with_backend();

    // second commit modifies line 2 only
    write_file(tr.path(), "README.md", "line-a\nline-b-edited\n");
    let commit2 = tr.commit_all("edit line 2");
    let initial = backend.log(&handle.id, None, 10).unwrap().last().unwrap().oid.clone();

    let lines = backend
        .blame_file(&handle.id, std::path::Path::new("README.md"))
        .unwrap();

    assert_eq!(lines.len(), 2);
    assert_eq!(lines[0].line_no, 1);
    assert_eq!(lines[0].oid, initial);
    assert_eq!(lines[1].line_no, 2);
    assert_eq!(lines[1].oid, commit2.to_string());
    assert_eq!(lines[1].content, "line-b-edited");
}
