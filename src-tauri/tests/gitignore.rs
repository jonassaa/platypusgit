mod support;

use platypusgit_lib::git::GitBackend;
use support::fs::{read_file, write_file};
use support::TempRepo;

#[test]
fn append_gitignore_creates_file_when_absent() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();

    backend.append_gitignore(&handle.id, "target/").unwrap();

    assert_eq!(read_file(tr.path(), ".gitignore"), "target/\n");
}

#[test]
fn append_gitignore_appends_trailing_newline_when_missing() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    write_file(tr.path(), ".gitignore", "*.log");

    backend.append_gitignore(&handle.id, "target/").unwrap();

    assert_eq!(read_file(tr.path(), ".gitignore"), "*.log\ntarget/\n");
}

#[test]
fn append_gitignore_dedupes_exact_match() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    write_file(tr.path(), ".gitignore", "target/\n");

    backend.append_gitignore(&handle.id, "target/").unwrap();

    assert_eq!(read_file(tr.path(), ".gitignore"), "target/\n");
}
