//! `stash_rename` — store-then-drop, and the traps that shape it (#133).
//!
//! The load-bearing test here is `renames_the_top_entry`. `git stash store` is
//! a SILENT no-op when `refs/stash` already points at the commit being stored
//! (git elides a value-identical ref update and still exits 0), which is
//! exactly `stash@{0}`. Any implementation that stores the EXISTING oid and
//! then drops the original destroys the top stash, exits 0, and reports
//! success. That test is what makes the failure loud.

mod support;

use platypusgit_lib::error::AppError;
use platypusgit_lib::git::{types::StashSaveOptions, GitBackend};
use support::fs::{read_file, write_file};
use support::TempRepo;

fn opts(message: &str) -> StashSaveOptions {
    StashSaveOptions {
        message: Some(message.into()),
        include_untracked: false,
        keep_index: false,
    }
}

/// Two stashes: `stash@{0}` is "second", `stash@{1}` is "first".
fn two_stashes(tr: &TempRepo, backend: &impl GitBackend, id: &platypusgit_lib::git::types::RepoId) {
    write_file(tr.path(), "README.md", "first change\n");
    backend.stash_save(id, opts("first")).unwrap();
    write_file(tr.path(), "README.md", "second change\n");
    backend.stash_save(id, opts("second")).unwrap();
}

#[test]
fn renames_the_top_entry() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    two_stashes(&tr, &backend, &handle.id);

    backend
        .stash_rename(&handle.id, 0, "renamed top")
        .expect("rename");

    let after = backend.stashes(&handle.id).unwrap();
    // Count is the whole point: a naive store-then-drop leaves ONE here.
    assert_eq!(after.len(), 2, "the entry must not disappear");
    assert_eq!(after[0].message, "renamed top");
    assert_eq!(
        after[1].message,
        "On main: first",
        "the other entry keeps its message and position"
    );

    // And it is still a working stash, not just a reflog line.
    backend.stash_apply(&handle.id, 0).unwrap();
    assert_eq!(read_file(tr.path(), "README.md"), "second change\n");
}

/// Renaming a LOWER entry moves it to the top, and that is not a bug to fix.
///
/// `refs/stash` is a reflog and `git stash store` can only PREPEND — git offers
/// no insert-at-position. Restoring the old order would mean dropping and
/// re-storing every entry above the renamed one, turning a one-entry edit into
/// N drops, each of them unrecoverable. Editing `.git/logs/refs/stash` in place
/// would preserve the order but bypasses git's ref locking entirely, so a
/// concurrent git process could interleave with it.
///
/// So: the entry keeps its identity and its content, and it moves to the front.
/// Everything else keeps its message and its relative order. This is exactly
/// why the UI re-reads the list instead of patching its own copy.
#[test]
fn renaming_a_lower_entry_moves_it_to_the_top_and_disturbs_nothing_else() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    two_stashes(&tr, &backend, &handle.id);
    write_file(tr.path(), "README.md", "third change\n");
    backend.stash_save(&handle.id, opts("third")).unwrap();

    let before = backend.stashes(&handle.id).unwrap();
    assert_eq!(before.len(), 3);
    let target_oid = before[1].oid.clone();

    backend
        .stash_rename(&handle.id, 1, "renamed middle")
        .expect("rename");

    let after = backend.stashes(&handle.id).unwrap();
    assert_eq!(after.len(), 3, "no entry gained or lost");
    assert_eq!(after[0].message, "renamed middle");
    assert_eq!(
        after[1].message, "On main: third",
        "the untouched entries keep their messages and relative order"
    );
    assert_eq!(after[2].message, "On main: first");
    assert_ne!(
        after[0].oid, target_oid,
        "a rename writes a fresh commit — that is what keeps `store` from being elided"
    );

    // The renamed entry still carries the content it always did.
    backend.stash_apply(&handle.id, 0).unwrap();
    assert_eq!(read_file(tr.path(), "README.md"), "second change\n");
}

#[test]
fn the_renamed_entry_keeps_its_tree_parents_and_time() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    write_file(tr.path(), "README.md", "stashed\n");
    backend.stash_save(&handle.id, opts("wip")).unwrap();

    let before = backend.stashes(&handle.id).unwrap().remove(0);
    let old = tr
        .repo
        .find_commit(git2::Oid::from_str(&before.oid).unwrap())
        .unwrap();
    let (old_tree, old_parents, old_time) = (
        old.tree_id(),
        old.parent_ids().collect::<Vec<_>>(),
        old.time().seconds(),
    );

    backend.stash_rename(&handle.id, 0, "renamed").unwrap();

    let after = backend.stashes(&handle.id).unwrap().remove(0);
    let repo = git2::Repository::open(tr.path()).unwrap();
    let new = repo
        .find_commit(git2::Oid::from_str(&after.oid).unwrap())
        .unwrap();
    assert_eq!(new.tree_id(), old_tree);
    assert_eq!(new.parent_ids().collect::<Vec<_>>(), old_parents);
    assert_eq!(
        new.time().seconds(),
        old_time,
        "the entry keeps its own time — only the message changes"
    );
    assert_eq!(
        new.message().unwrap().trim(),
        "renamed",
        "the commit's own message tracks the reflog message, as `git stash push` writes it"
    );
}

#[test]
fn a_message_with_a_line_break_is_refused_and_nothing_changes() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    write_file(tr.path(), "README.md", "stashed\n");
    backend.stash_save(&handle.id, opts("wip")).unwrap();
    let before = backend.stashes(&handle.id).unwrap();

    let err = backend
        .stash_rename(&handle.id, 0, "two\nlines")
        .unwrap_err();
    assert!(matches!(err, AppError::InvalidArgument(_)), "got {err:?}");

    let after = backend.stashes(&handle.id).unwrap();
    assert_eq!(after.len(), before.len());
    assert_eq!(after[0].oid, before[0].oid);
    assert_eq!(after[0].message, before[0].message);
}

#[test]
fn renaming_to_the_same_message_is_a_no_op() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    write_file(tr.path(), "README.md", "stashed\n");
    backend.stash_save(&handle.id, opts("wip")).unwrap();
    let before = backend.stashes(&handle.id).unwrap();

    backend
        .stash_rename(&handle.id, 0, &before[0].message)
        .expect("no-op rename");

    let after = backend.stashes(&handle.id).unwrap();
    assert_eq!(after.len(), 1, "no duplicate entry");
    assert_eq!(after[0].oid, before[0].oid, "no fresh commit written");
}

#[test]
fn an_out_of_range_index_is_refused_before_anything_is_written() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    write_file(tr.path(), "README.md", "stashed\n");
    backend.stash_save(&handle.id, opts("wip")).unwrap();

    assert!(backend.stash_rename(&handle.id, 5, "nope").is_err());
    assert_eq!(backend.stashes(&handle.id).unwrap().len(), 1);
}

/// The git behaviour the whole rename design is built around, pinned so it
/// cannot quietly stop being true.
///
/// `git stash store <oid>` when `refs/stash` ALREADY points at `<oid>` exits 0
/// and writes no reflog entry — git elides a value-identical ref update. That
/// is `stash@{0}`, so an implementation that stores the existing oid and then
/// drops the original destroys the top stash while reporting success. Ours
/// stores a fresh commit precisely so this case cannot arise; if a future git
/// changes the behaviour, this test says so and the rationale can be revisited.
#[test]
fn git_stash_store_is_a_silent_no_op_for_the_current_tip() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    write_file(tr.path(), "README.md", "stashed\n");
    backend.stash_save(&handle.id, opts("wip")).unwrap();

    let tip = backend.stashes(&handle.id).unwrap().remove(0).oid;
    let out = std::process::Command::new("git")
        .arg("-C")
        .arg(tr.path())
        .args(["stash", "store", "-m", "would-be-rename", "--"])
        .arg(&tip)
        .output()
        .unwrap();

    assert!(out.status.success(), "git reports success…");
    let after = backend.stashes(&handle.id).unwrap();
    assert_eq!(after.len(), 1, "…and yet nothing was stored");
    assert_eq!(after[0].message, "On main: wip", "the message is unchanged");
}

/// Storing a FRESH commit is what makes the same operation land — the other
/// half of the trap above, so the two are read together.
#[test]
fn a_fresh_commit_is_what_makes_the_store_land() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    write_file(tr.path(), "README.md", "stashed\n");
    backend.stash_save(&handle.id, opts("wip")).unwrap();

    let tip = backend.stashes(&handle.id).unwrap().remove(0).oid;
    let repo = git2::Repository::open(tr.path()).unwrap();
    let old = repo.find_commit(git2::Oid::from_str(&tip).unwrap()).unwrap();
    let parents: Vec<git2::Commit<'_>> = old.parents().collect();
    let parent_refs: Vec<&git2::Commit<'_>> = parents.iter().collect();
    let fresh = repo
        .commit(
            None,
            &old.author(),
            &old.committer(),
            "renamed",
            &old.tree().unwrap(),
            &parent_refs,
        )
        .unwrap();
    assert_ne!(fresh.to_string(), tip);

    let out = std::process::Command::new("git")
        .arg("-C")
        .arg(tr.path())
        .args(["stash", "store", "-m", "renamed", "--"])
        .arg(fresh.to_string())
        .output()
        .unwrap();
    assert!(out.status.success());

    let after = backend.stashes(&handle.id).unwrap();
    assert_eq!(after.len(), 2, "the store landed this time");
    assert_eq!(after[0].message, "renamed");
}
