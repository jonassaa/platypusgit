mod support;

use platypusgit_lib::git::GitBackend;
use support::fs::write_file;
use support::TempRepo;

#[test]
fn file_history_returns_commits_that_touched_the_path() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();

    // Commit 2: touch foo.txt
    write_file(tr.path(), "foo.txt", "a\n");
    tr.commit_all("add foo");

    // Commit 3: touch bar.txt (should not appear in foo.txt history)
    write_file(tr.path(), "bar.txt", "b\n");
    tr.commit_all("add bar");

    // Commit 4: modify foo.txt
    write_file(tr.path(), "foo.txt", "a\nb\n");
    tr.commit_all("edit foo");

    let history = backend
        .file_history(&handle.id, std::path::Path::new("foo.txt"), 100)
        .unwrap();

    let summaries: Vec<&str> = history.iter().map(|c| c.summary.as_str()).collect();
    assert_eq!(summaries, vec!["edit foo", "add foo"]);
}
