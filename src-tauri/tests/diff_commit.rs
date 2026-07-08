mod support;

use git2::Signature;
use platypusgit_lib::git::GitBackend;
use support::TempRepo;

/// `diff_commit` on an ordinary commit shows only what *that* commit changed
/// (its diff against its parent), not the accumulated tree.
#[test]
fn diff_commit_shows_only_that_commits_change() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    // Two more commits, each adding one file.
    let oids = support::linear_history(&tr, 2); // file0.txt, file1.txt

    let diffs = backend.diff_commit(&handle.id, &oids[1], 3).unwrap();

    assert_eq!(diffs.len(), 1, "only the file this commit touched");
    assert_eq!(diffs[0].path, "file1.txt");
    assert!(diffs[0].additions > 0);
    assert_eq!(diffs[0].deletions, 0);
}

/// A root commit (no parent) diffs against the empty tree → everything added.
#[test]
fn diff_commit_root_is_all_added() {
    let tr = TempRepo::with_initial_commit("line1\nline2\n");
    let (backend, handle) = tr.open_with_backend();
    // Oldest entry in the log is the root commit.
    let root = backend
        .log(&handle.id, None, 10)
        .unwrap()
        .last()
        .unwrap()
        .oid
        .clone();

    let diffs = backend.diff_commit(&handle.id, &root, 3).unwrap();

    let readme = diffs.iter().find(|d| d.path == "README.md").expect("README.md in root diff");
    assert!(readme.additions >= 2, "both lines added");
    assert_eq!(readme.deletions, 0);
}

/// A merge commit diffs against its *first* parent (git-show default): the
/// second parent's unique work shows as the net change, the first parent's does not.
#[test]
fn diff_commit_merge_uses_first_parent() {
    let tr = TempRepo::with_initial_commit("base\n");
    let (backend, handle) = tr.open_with_backend();

    // feature branch off the initial commit, adds feat.txt.
    backend.create_branch(&handle.id, "feature", None).unwrap();
    backend.checkout_branch(&handle.id, "feature").unwrap();
    // The backend's checkout wrote a fresh index to disk; tr.repo caches its
    // own index in memory, so force it to re-read before committing through it
    // (else the previous branch's staged files leak into this commit's tree).
    tr.repo.index().unwrap().read(true).unwrap();
    tr.add_commit("feat.txt", "feature\n", "feature work");

    // main diverges, adds main.txt.
    backend.checkout_branch(&handle.id, "main").unwrap();
    tr.repo.index().unwrap().read(true).unwrap();
    tr.add_commit("main.txt", "main\n", "main work");

    // Merge feature into main (no conflict — different files). Build the merged
    // tree in memory so we control the parent order: main tip is parent 0,
    // feature tip parent 1 (so first-parent diffing has a distinct answer).
    let merge_oid = {
        let feat_commit = tr
            .repo
            .find_reference("refs/heads/feature")
            .unwrap()
            .peel_to_commit()
            .unwrap();
        let main_tip = tr.repo.head().unwrap().peel_to_commit().unwrap();
        let mut merged = tr.repo.merge_commits(&main_tip, &feat_commit, None).unwrap();
        assert!(!merged.has_conflicts(), "different files must merge cleanly");
        let tree_oid = merged.write_tree_to(&tr.repo).unwrap();
        let tree = tr.repo.find_tree(tree_oid).unwrap();
        let sig = Signature::now("Test User", "test@example.com").unwrap();
        tr.repo
            .commit(Some("HEAD"), &sig, &sig, "merge feature", &tree, &[&main_tip, &feat_commit])
            .unwrap()
            .to_string()
    };

    let diffs = backend.diff_commit(&handle.id, &merge_oid, 3).unwrap();
    let paths: Vec<&str> = diffs.iter().map(|d| d.path.as_str()).collect();

    // feat.txt is what the merge brings in relative to the first parent (main).
    assert!(paths.contains(&"feat.txt"), "merge vs first parent shows feature's file, got {paths:?}");
    // main.txt is already in the first parent, so it's not a net change.
    assert!(!paths.contains(&"main.txt"), "first parent's own file is not a change, got {paths:?}");
}
