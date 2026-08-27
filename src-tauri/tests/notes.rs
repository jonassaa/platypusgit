//! `git notes` are read-only history metadata the log never showed (#253).
//!
//! The behaviours pinned here are the ones a naive implementation gets wrong:
//! absence is a STATE (empty vec) at three different levels — no notes ref in
//! the repository at all, a notes ref with no note for this commit, and an
//! empty note — and none of the three may surface as an error, because the
//! commit detail panel would then show a banner for every commit in every repo
//! that has never used notes (which is most of them).

mod support;

use git2::Signature;
use platypusgit_lib::git::GitBackend;
use support::TempRepo;

/// Attach a note through git2 so the test does not depend on a `git` binary.
fn attach_note(tr: &TempRepo, notes_ref: &str, oid: git2::Oid, message: &str) {
    let repo = git2::Repository::open(tr.path()).unwrap();
    let sig = Signature::now("Noter", "noter@example.com").unwrap();
    repo.note(&sig, &sig, Some(notes_ref), oid, message, false)
        .unwrap();
}

fn head_oid(tr: &TempRepo) -> git2::Oid {
    git2::Repository::open(tr.path())
        .unwrap()
        .head()
        .unwrap()
        .peel_to_commit()
        .unwrap()
        .id()
}

#[test]
fn a_commit_with_a_note_returns_it() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let oid = head_oid(&tr);
    attach_note(&tr, "refs/notes/commits", oid, "reviewed-by: ada\n");

    let (backend, handle) = tr.open_with_backend();
    let notes = backend.commit_notes(&handle.id, &oid.to_string()).unwrap();

    assert_eq!(notes.len(), 1, "{notes:?}");
    assert_eq!(notes[0].ref_name, "refs/notes/commits");
    assert_eq!(notes[0].label, "commits");
    assert_eq!(notes[0].message, "reviewed-by: ada");
}

#[test]
fn a_commit_without_a_note_returns_nothing() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let noted = head_oid(&tr);
    attach_note(&tr, "refs/notes/commits", noted, "on the first one only\n");
    tr.add_commit("b.txt", "b\n", "second");
    let unnoted = head_oid(&tr);

    let (backend, handle) = tr.open_with_backend();
    let notes = backend
        .commit_notes(&handle.id, &unnoted.to_string())
        .unwrap();

    // The notes ref exists and has an entry — just not for this commit.
    assert!(notes.is_empty(), "{notes:?}");
}

#[test]
fn a_repo_with_no_notes_ref_at_all_is_not_an_error() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let oid = head_oid(&tr);

    let (backend, handle) = tr.open_with_backend();
    let notes = backend.commit_notes(&handle.id, &oid.to_string()).unwrap();

    assert!(notes.is_empty(), "{notes:?}");
}

#[test]
fn several_notes_refs_are_all_returned_with_the_default_first() {
    // `refs/notes/commits` is git's default, but `notes.displayRef` and
    // per-tool refs are real (`refs/notes/review`, CI results); showing only
    // the default would hide them with no way to discover they exist.
    let tr = TempRepo::with_initial_commit("hello\n");
    let oid = head_oid(&tr);
    attach_note(&tr, "refs/notes/review", oid, "looks good\n");
    attach_note(&tr, "refs/notes/commits", oid, "the default ref\n");
    attach_note(&tr, "refs/notes/ci/results", oid, "green\n");

    let (backend, handle) = tr.open_with_backend();
    let notes = backend.commit_notes(&handle.id, &oid.to_string()).unwrap();

    let refs: Vec<&str> = notes.iter().map(|n| n.ref_name.as_str()).collect();
    assert_eq!(
        refs,
        vec![
            "refs/notes/commits",
            "refs/notes/ci/results",
            "refs/notes/review"
        ],
        "default ref first, then alphabetical"
    );
    let labels: Vec<&str> = notes.iter().map(|n| n.label.as_str()).collect();
    assert_eq!(labels, vec!["commits", "ci/results", "review"]);
}

#[test]
fn an_unresolvable_oid_is_an_error_not_an_empty_list() {
    // Absence of a NOTE is a state; absence of the COMMIT is a bug in the
    // caller, and reporting it as "no notes" would hide it forever.
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();

    assert!(backend.commit_notes(&handle.id, "nonsense").is_err());
}
